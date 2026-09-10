/**
 * Play the raycaster through the bridge, and photograph it on the way.
 *
 *   npx tsx tools/doom/playtest.mts
 *
 * Movement goes through the game's `dm_*` input seam. The bot navigates by
 * consulting the same map the room was built from: it walks a route of cells,
 * turning to face each waypoint and shooting anything that gets in the way.
 */

import { join } from 'node:path';
import { bridgeRoot } from '../../src/bridge/install.js';
import { BridgeClient } from '../../src/bridge/index.js';
import { IgorRunner } from '../../src/build/index.js';
import { GmProject } from '../../src/project/index.js';
import { CELL, MAP } from './map.js';

interface View {
  x: number;
  y: number;
  dir: number;
  col: number;
  row: number;
  health: number;
  fps_real: number;
  ammo: number;
  kills: number;
  total: number;
  state: string;
  imps: number;
  fps: number;
}

/** Cells the player can walk through. Doors open on approach, so they count. */
const SOLID = new Set(['#', '=', '|']);
const walkable = (col: number, row: number): boolean =>
  row >= 0 && row < MAP.length && col >= 0 && col < MAP[0]!.length && !SOLID.has(MAP[row]![col]!);

/** Breadth-first route between two cells, as a list of waypoints. */
function route(from: [number, number], to: [number, number]): [number, number][] {
  const key = (c: number, r: number): string => `${c},${r}`;
  const prev = new Map<string, string>();
  const queue: [number, number][] = [from];
  const seen = new Set([key(...from)]);
  while (queue.length) {
    const [c, r] = queue.shift()!;
    if (c === to[0] && r === to[1]) break;
    for (const [dc, dr] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const n: [number, number] = [c + dc, r + dr];
      if (!walkable(...n) || seen.has(key(...n))) continue;
      seen.add(key(...n));
      prev.set(key(...n), key(c, r));
      queue.push(n);
    }
  }
  const path: [number, number][] = [];
  let at = key(...to);
  while (at !== key(...from)) {
    const [c, r] = at.split(',').map(Number) as [number, number];
    path.push([c, r]);
    const back = prev.get(at);
    if (!back) return [];
    at = back;
  }
  return path.reverse();
}

const find = (glyph: string): [number, number] => {
  for (let r = 0; r < MAP.length; r++) {
    const c = MAP[r]!.indexOf(glyph);
    if (c !== -1) return [c, r];
  }
  throw new Error(`no ${glyph} in the map`);
};

const project = GmProject.open(join(bridgeRoot(), 'mcp_bridge'));
const game = await IgorRunner.create(project).run();
const shots: string[] = [];

try {
  await game.waitFor(/\[gmlmcp\] listening/, 180000);
  const client = await BridgeClient.connect();

  const view = async (): Promise<View> =>
    (await client.request('get_var', { name: 'dm_view' })) as View;
  const set = (name: string, value: unknown): Promise<unknown> =>
    client.request('set_var', { name: `dm_${name}`, value });
  const wait = (frames: number): Promise<unknown> => client.request('wait', { frames });
  const shot = async (name: string): Promise<void> => {
    const r = (await client.request('screenshot', { name: `${name}.png` })) as {
      file: string;
      directory: string;
    };
    shots.push(r.directory + r.file);
  };

  await client.request('goto_room', { room: 'rm_doom_e1m1' });
  await wait(20);
  await shot('dm_01_spawn');

  const path = route(find('P'), find('X'));
  console.log(`route: ${path.length} cells from the spawn to the exit`);

  let outcome = 'ran out of ticks';
  let fpsLow = 999;
  let shotAt = new Set<string>();
  let waypoint = 0;

  for (let tick = 0; tick < 900 && waypoint < path.length; tick++) {
    const now = await view();
    // `fps` reads 0 until the engine has a full second to average over.
    if (tick > 20) fpsLow = Math.min(fpsLow, now.fps_real);

    if (now.state === 'won') {
      outcome = 'reached the exit';
      break;
    }
    if (now.state === 'dead') {
      outcome = `died at cell ${now.col},${now.row} with ${now.kills} kills`;
      break;
    }

    // Retire waypoints already reached, so a slightly wide turn does not
    // send the bot back on itself.
    while (waypoint < path.length) {
      const [wc, wr] = path[waypoint]!;
      const d = Math.hypot(now.x - (wc * CELL + CELL / 2), now.y - (wr * CELL + CELL / 2));
      if (d < 34) waypoint++;
      else break;
    }
    if (waypoint >= path.length) {
      outcome = 'walked the whole route';
      break;
    }

    const [wc, wr] = path[waypoint]!;
    const want = Math.atan2(wr * CELL + CELL / 2 - now.y, wc * CELL + CELL / 2 - now.x);
    let delta = want - now.dir;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;

    // Turn towards the waypoint; only walk once roughly facing it.
    await set('turn', Math.abs(delta) < 0.06 ? 0 : Math.sign(delta));
    await set('fwd', Math.abs(delta) < 0.5 ? 1 : 0);

    // Shoot whenever an imp is still standing and roughly in front.
    const firing = now.imps > 0 && now.ammo > 0;
    await set('fire', firing);

    if (now.kills > 0 && !shotAt.has('kill')) {
      shotAt.add('kill');
      await shot('dm_03_firefight');
    }
    if (now.health < 100 && !shotAt.has('hurt')) {
      shotAt.add('hurt');
      await shot('dm_04_hurt');
    }
    if (tick === 40) await shot('dm_02_corridor');

    await wait(3);
  }

  await set('fwd', 0);
  await set('turn', 0);
  await set('fire', false);
  await wait(10);
  await shot('dm_05_end');

  const final = await view();
  console.log(`\noutcome: ${outcome}`);
  console.log(
    `cell ${final.col},${final.row}   health ${final.health}   ammo ${final.ammo}` +
      `   kills ${final.kills}/${final.total}   state ${final.state}`,
  );
  console.log(`lowest fps seen: ${fpsLow}`);
  console.log('screenshots:');
  for (const s of shots) console.log('  ' + s);
  client.close();
} catch (error) {
  console.log('FAILED:', (error as Error).message);
  console.log(game.log().split('\n').slice(-25).join('\n'));
} finally {
  game.stop();
}
