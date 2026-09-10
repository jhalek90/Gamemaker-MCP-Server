/**
 * Play the level, from here, through the bridge.
 *
 * Rather than replaying a fixed key sequence — which only proves that one
 * recording still works — this reads the player's position back every few
 * frames and decides what to press, consulting the same map the room was
 * built from. If the level is completable, the bot finishes it; if a pit is
 * too wide or a platform out of reach, it gets stuck and says where.
 *
 *   npx tsx tools/platformer/playtest.mts [outputDirectory]
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { bridgeRoot } from '../../src/bridge/install.js';
import { BridgeClient } from '../../src/bridge/index.js';
import { IgorRunner } from '../../src/build/index.js';
import { GmProject } from '../../src/project/index.js';
import { MAP, ROWS, TILE } from './level.js';

const SOLID = new Set(['#', 'B', '?']);
const outDir = process.argv[2] ?? '.';
mkdirSync(outDir, { recursive: true });

const solidAt = (col: number, row: number): boolean => {
  if (row < 0 || row >= ROWS) return false;
  return SOLID.has(MAP[row]![col] ?? ' ');
};

/** Columns holding a bonus block, so the bot knows to jump into them. */
const BONUS_COLUMNS = MAP.flatMap((row, r) =>
  [...row].map((c, i) => (c === '?' ? { col: i, row: r } : undefined)),
).filter((v): v is { col: number; row: number } => v !== undefined);

const project = GmProject.open(join(bridgeRoot(), 'mcp_bridge'));
const game = await IgorRunner.create(project).run();
const shots: string[] = [];

try {
  await game.waitFor(/\[gmlmcp\] listening/, 180000);
  const client = await BridgeClient.connect();

  interface View {
    x: number;
    y: number;
    hsp: number;
    vsp: number;
    grounded: boolean;
    big: boolean;
    state: string;
    jump_was: boolean;
    bot_jump: boolean;
    coins: number;
    score: number;
    lives: number;
    cam_x: number;
    cam_y: number;
  }
  /** The whole world state the bot needs, in one round trip. */
  const view = async (): Promise<View> =>
    (await client.request('get_var', { name: 'botview' })) as View;
  const wait = (frames: number): Promise<unknown> => client.request('wait', { frames });
  // The game's input seam: globals the player's Step reads alongside the real
  // keyboard. Simulated key presses work too, but driving these says exactly
  // what is held, for exactly how long.
  const hold = (button: string, down: boolean): Promise<unknown> =>
    client.request('set_var', { name: `bot_${button}`, value: down });
  /** One request describes a whole jump: press, and hold for this many frames. */
  const jumpFor = (frames: number): Promise<unknown> =>
    client.request('set_var', { name: 'bot_jump_once', value: frames });
  const shot = async (name: string): Promise<void> => {
    const result = (await client.request('screenshot', { name: `${name}.png` })) as {
      file: string;
      directory: string;
    };
    shots.push(result.directory + result.file);
  };

  // The project holds more than one demo now, so say which room this is about
  // rather than trusting whichever one happens to be first in the room order.
  await client.request('goto_room', { room: 'rm_level1' });
  await wait(10);
  await shot('01_start');

  // Only a modest speed-up: the game keeps running between requests, so at
  // 900fps the world would race ahead of every decision the bot made.
  await client.request('speed', { fps: 180 });

  await hold('right', true);

  let jumpFrames = 0;
  let bestX = 0;
  let stuck = 0;
  let holdingRight = true;
  let waited = false;
  // A short trace, printed when the run ends badly. Guessing at why a bot fell
  // in a hole is much slower than reading back what it saw.
  const trace: string[] = [];
  const onScreen: number[] = [];
  let grew = false;
  let stomped = false;
  let crossedFirstPit = false;
  let score = 0;
  let outcome = 'ran out of ticks';

  for (let tick = 0; tick < 900; tick++) {
    const now = await view();
    const { x, y, grounded, big, state } = now;

    if (state === 'won') {
      outcome = 'reached the flag';
      break;
    }
    if (state === 'dead') {
      outcome = `died at x=${Math.round(x)} (tile ${Math.floor(x / TILE)})`;
      break;
    }

    if (big && !grew) {
      grew = true;
      await shot('03_big');
    }
    // A stomp is worth exactly 100; a coin is 200 and a mushroom 500.
    if (!stomped && now.score - score === 100) {
      stomped = true;
      await shot('06_stomped');
    }
    score = now.score;
    if (!crossedFirstPit && x > 24 * TILE) {
      crossedFirstPit = true;
      await shot('04_past_first_pit');
    }

    // A mushroom walks at 2px a frame and the player runs at 6, so charging
    // on means never catching it. Standing still and letting it come is what
    // a person does, and it is the only way the bot ever gets big.
    let wantRight = true;
    if (!big) {
      const shrooms = (await client.request('instances', { object: 'obj_mushroom' })) as {
        instances: { x: number }[];
      };
      const behind = shrooms.instances.find((m) => m.x < x);
      if (behind) {
        wantRight = false;
        stuck = 0;
        if (!waited) {
          waited = true;
          await shot('02_waiting_for_mushroom');
        }
      }
    }
    // Only change direction with both feet down. Committing to a run while
    // still in the air is how the bot sailed off the edge of a pit it had
    // never decided to jump: the arc from some earlier jump carried it there.
    if (grounded && wantRight !== holdingRight) {
      holdingRight = wantRight;
      await hold('right', wantRight);
    }

    // Decide whether to jump. Jumping is the one real judgement call.
    const col = Math.floor(x / TILE);
    const footRow = Math.floor((y - 1) / TILE);
    let jump = false;

    if (jumpFrames > 0) {
      // Still committed to the last jump; the game is holding the button.
      jumpFrames -= 1;
    } else if (grounded) {
      // A wall or step directly ahead.
      if (solidAt(col + 1, footRow)) jump = true;
      // A gap in the floor starting in the very next tile. Jumping earlier
      // than that peaks too soon and lands back inside the pit -- the arc is
      // fixed, so the take-off point is the whole decision.
      const gap =
        !solidAt(col + 1, footRow + 1) && !solidAt(col + 2, footRow + 1);
      if (wantRight && gap) jump = true;
      const goombas = (await client.request('instances', { object: 'obj_goomba' })) as {
        instances: { x: number; y: number }[];
      };
      // A bonus block overhead, while still small: that is where big comes from.
      const foeClose = goombas.instances.some(
        (g) => Math.abs(g.x - x) < 300 && Math.abs(g.y - y) < 80,
      );
      if (
        !big &&
        !foeClose &&
        BONUS_COLUMNS.some((b) => b.col >= col && b.col <= col + 1 && b.row < footRow)
      ) {
        jump = true;
      }
      // An enemy close enough that going over the top is the way past.
      const near = goombas.instances.filter(
        (g) => g.x - x > -30 && g.x - x < 240 && Math.abs(g.y - y) < 80,
      );
      if (near.length > 0) jump = true;
      // Nothing else worked and we have stopped moving.
      if (stuck > 12) jump = true;
    }

    if (jump) {
      await jumpFor(26);
      jumpFrames = 4;
    }

    trace.push(
      `x=${Math.round(x)} col=${col} foot=${footRow} ground=${grounded ? 1 : 0}` +
        ` big=${big ? 1 : 0} right=${wantRight ? 1 : 0} jump=${jump ? 1 : 0} air=${jumpFrames}` +
        ` hsp=${now.hsp.toFixed(1)} vsp=${now.vsp.toFixed(1)}` +
        ` onscreen=${Math.round(x - now.cam_x)}/1366`,
    );
    if (trace.length > 14) trace.shift();

    onScreen.push(Math.round(x - now.cam_x));

    if (x > bestX + 4) {
      bestX = x;
      stuck = 0;
    } else {
      stuck += 1;
      if (stuck > 60) {
        outcome = `stuck at x=${Math.round(x)} (tile ${col}, row ${footRow})`;
        break;
      }
    }

    await wait(3);
  }

  await hold('right', false);
  await client.request('speed', { fps: 60 });
  await wait(5);
  await shot('05_finish');

  const final = await view();
  console.log(`\noutcome: ${outcome}`);
  console.log(
    `reached x=${Math.round(final.x)} of ${80 * TILE}  (tile ${Math.floor(final.x / TILE)} of 80)`,
  );
  console.log(`coins ${final.coins}   score ${final.score}   lives ${final.lives}`);
  if (onScreen.length) {
    const sorted = [...onScreen].sort((a, b) => a - b);
    const mid = sorted[Math.floor(sorted.length / 2)]!;
    console.log(
      `player on screen: min ${sorted[0]} median ${mid} max ${sorted.at(-1)} of 1366` +
        `  (centre is 683; the ends of the level pull it off-centre by design)`,
    );
  }
  if (outcome !== 'reached the flag') {
    console.log('last ticks:');
    for (const line of trace) console.log('  ' + line);
  }
  console.log('screenshots:');
  for (const s of shots) console.log('  ' + s);
  writeFileSync(join(outDir, 'shots.txt'), shots.join('\n'));

  client.close();
} catch (error) {
  console.log('FAILED:', (error as Error).message);
  console.log(game.log().split('\n').slice(-25).join('\n'));
} finally {
  game.stop();
}
