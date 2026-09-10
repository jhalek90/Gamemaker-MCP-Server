/**
 * Build sprites from shapes, then prove GameMaker loads and draws them.
 *
 *   npx tsx tools/sprite-demo.mts                 work on a throwaway copy
 *   npx tsx tools/sprite-demo.mts --in-place      work on bridge/mcp_bridge itself
 *   npx tsx tools/sprite-demo.mts <project path>  work on that project
 *
 * In-place is for checking what GameMaker's IDE does with the generated
 * files: open the project, run this, save, and see whether the .yy shows a
 * diff. Everything lands in one transaction, so `workspace.undo()` removes
 * the lot.
 */
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bridgeRoot } from '../src/bridge/install.js';
import { BridgeClient } from '../src/bridge/index.js';
import { IgorRunner, formatBuildDiagnostics } from '../src/build/index.js';
import { Canvas } from '../src/image/index.js';
import {
  addRoomInstance,
  createObject,
  createSprite,
  Events,
  GmProject,
  listRoomInstances,
} from '../src/project/index.js';

const argument = process.argv[2];
const inPlace = argument !== undefined;
const source = join(bridgeRoot(), 'mcp_bridge');
const root =
  argument === undefined
    ? mkdtempSync(join(tmpdir(), 'gml-sprites-'))
    : argument === '--in-place'
      ? source
      : argument;
if (argument === undefined) cpSync(source, root, { recursive: true });

const project = GmProject.open(root);
console.log(`${inPlace ? 'working in place on' : 'working on a copy at'} ${project.root}\n`);

// -- draw the sprites -----------------------------------------------------

const ball = new Canvas(64, 64).circle(32, 32, 30, '#e6194b').circle(24, 24, 9, '#ffffffcc');

const crate = new Canvas(64, 64)
  .rect(0, 0, 64, 64, '#9a6324')
  .rect(0, 0, 64, 64, '#5c3a15', { thickness: 4 })
  .line(4, 4, 60, 60, '#5c3a15', { thickness: 3 })
  .line(60, 4, 4, 60, '#5c3a15', { thickness: 3 });

const arrow = new Canvas(48, 48).polygon(
  [
    [4, 18],
    [28, 18],
    [28, 6],
    [44, 24],
    [28, 42],
    [28, 30],
    [4, 30],
  ],
  '#4363d8',
);

// Three frames of a pulsing dot, to show multi-frame sprites work.
const pulse = [12, 20, 28].map((radius) =>
  new Canvas(64, 64).circle(32, 32, radius, '#3cb44b').circle(32, 32, radius, '#1a5a24', { thickness: 3 }),
);

const DRAW_GUI = `draw_set_colour(c_black);
draw_text(40, 40, "sprites built from shapes, drawn by GameMaker");

draw_sprite(spr_ball, 0, 120, 140);
draw_sprite(spr_crate, 0, 200, 110);
draw_sprite(spr_arrow, 0, 340, 140);

draw_text(40, 220, "spr_pulse, all three frames:");
for (var _i = 0; _i < sprite_get_number(spr_pulse); _i++) {
	draw_sprite(spr_pulse, _i, 60 + _i * 80, 250);
}

draw_text(40, 340, "sizes: " + string(sprite_get_width(spr_ball)) + "x" + string(sprite_get_height(spr_ball))
	+ "   origin: " + string(sprite_get_xoffset(spr_ball)) + "," + string(sprite_get_yoffset(spr_ball))
	+ "   frames: " + string(sprite_get_number(spr_pulse)));
`;

const already = project.has('spr_ball');
if (already) {
  console.log('sprites already present; leaving them alone\n');
} else {
  // One transaction, so a single undo reverses everything this script did.
  const made = project.transact('sprite demo: shapes, object and placement', (tx) => {
    const refs = [
      createSprite(project, tx, 'spr_ball', { frames: [ball], origin: 'middleCentre' }),
      createSprite(project, tx, 'spr_crate', { frames: [crate] }),
      createSprite(project, tx, 'spr_arrow', { frames: [arrow], origin: 'middleCentre' }),
      createSprite(project, tx, 'spr_pulse', { frames: pulse, playbackSpeed: 8 }),
    ];
    createObject(project, tx, 'obj_sprite_demo', {
      // Draw GUI, so it sits over whatever else the room draws.
      events: [{ event: Events.draw(64), code: DRAW_GUI }],
    });
    return refs.map((r) => r.name);
  });
  console.log('created:', made.join(', '), '+ obj_sprite_demo');
}

if (!listRoomInstances(project, 'Room1').some((i) => i.object === 'obj_sprite_demo')) {
  project.transact('place the sprite demo', (tx) =>
    addRoomInstance(project, tx, 'Room1', 'obj_sprite_demo', { x: 0, y: 0 }),
  );
  console.log('placed obj_sprite_demo in Room1');
}

// -- does GameMaker accept them? -----------------------------------------

const runner = IgorRunner.create(project);
const build = await runner.compile();
console.log(`\ncompile: ok=${build.ok} ${build.durationMs}ms  ${formatBuildDiagnostics(build.diagnostics)}`);
if (!build.ok) {
  console.log(build.log.split('\n').slice(-25).join('\n'));
  if (!inPlace) rmSync(root, { recursive: true, force: true });
  process.exit(1);
}

const game = await runner.run();
try {
  await game.waitFor(/\[gmlmcp\][^\n]*/, 180000);
  const client = await BridgeClient.connect();
  // Say which room this demo is about. The project holds several rooms now and
  // the first one is a different demo entirely, so trusting the room order
  // photographs the wrong game.
  await client.request('goto_room', { room: 'Room1' });
  await client.request('wait', { frames: 10 });
  const shot = (await client.request('screenshot', { name: 'sprites.png' })) as {
    file: string;
    directory: string;
  };
  console.log('screenshot:', shot.directory + shot.file);
  client.close();
} catch (error) {
  console.log('FAILED:', (error as Error).message);
  console.log(game.log().split('\n').slice(-20).join('\n'));
} finally {
  game.stop();
  if (!inPlace) {
    for (let i = 0; i < 10; i++) {
      try {
        rmSync(root, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  }
}
