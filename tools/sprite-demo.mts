/**
 * Build sprites from shapes, then prove GameMaker loads and draws them.
 *
 * Usage: npx tsx tools/sprite-demo.mts
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
} from '../src/project/index.js';

const root = mkdtempSync(join(tmpdir(), 'gml-sprites-'));
cpSync(join(bridgeRoot(), 'mcp_bridge'), root, { recursive: true });
const project = GmProject.open(root);

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

const created = project.transact('create shape sprites', (tx) => {
  const refs = [
    createSprite(project, tx, 'spr_ball', { frames: [ball], origin: 'middleCentre' }),
    createSprite(project, tx, 'spr_crate', { frames: [crate] }),
    createSprite(project, tx, 'spr_arrow', { frames: [arrow], origin: 'middleCentre' }),
    createSprite(project, tx, 'spr_pulse', { frames: pulse, playbackSpeed: 8 }),
  ];

  // Something to draw them. Draw GUI so it sits over the dev scene.
  createObject(project, tx, 'obj_sprite_demo', {
    events: [
      {
        event: Events.draw(64),
        code: `draw_set_colour(c_black);
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
`,
      },
    ],
  });
  return refs.map((r) => r.name);
});
console.log('created:', created.join(', '), '+ obj_sprite_demo');

project.transact('place demo', (tx) => {
  addRoomInstance(project, tx, 'Room1', 'obj_sprite_demo', { x: 0, y: 0 });
});

// -- does GameMaker accept them? -----------------------------------------

const runner = IgorRunner.create(project);
const build = await runner.compile();
console.log(`compile: ok=${build.ok} ${build.durationMs}ms  ${formatBuildDiagnostics(build.diagnostics)}`);
if (!build.ok) {
  console.log(build.log.split('\n').slice(-25).join('\n'));
  rmSync(root, { recursive: true, force: true });
  process.exit(1);
}

const game = await runner.run();
try {
  await game.waitFor(/\[gmlmcp\][^\n]*/, 180000);
  const client = await BridgeClient.connect();
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
  for (let i = 0; i < 10; i++) {
    try {
      rmSync(root, { recursive: true, force: true });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}
