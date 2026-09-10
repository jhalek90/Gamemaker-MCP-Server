/**
 * Build the raycaster demo into a GameMaker project.
 *
 *   npx tsx tools/doom/build.mts             build into bridge/mcp_bridge
 *   npx tsx tools/doom/build.mts --compile   ... and compile it
 *   npx tsx tools/doom/build.mts <path>      ... into another project
 *
 * One transaction, so `workspace.undo()` takes the whole demo back out.
 */

import { join } from 'node:path';
import { bridgeRoot } from '../../src/bridge/install.js';
import { IgorRunner, formatBuildDiagnostics } from '../../src/build/index.js';
import {
  addRoomInstance,
  checkProject,
  createFolder,
  createObject,
  createRoom,
  createScript,
  createSprite,
  deleteResource,
  Events,
  GmProject,
  roomOrder,
} from '../../src/project/index.js';
import { GmlSpec, requireRuntime } from '../../src/spec/index.js';
import type { Transaction } from '../../src/tx/index.js';
import * as art from './art.js';
import * as gml from './gml.js';
import { placements, ROOM_HEIGHT, ROOM_WIDTH } from './map.js';

const FOLDER = 'Doom';
const ROOM = 'rm_doom_e1m1';
const SCRIPT = 'scr_dm_engine';

const SPRITES = [
  'spr_dm_brick',
  'spr_dm_stone',
  'spr_dm_tech',
  'spr_dm_door',
  'spr_dm_imp',
  'spr_dm_fireball',
  'spr_dm_health',
  'spr_dm_ammo',
  'spr_dm_exit',
  'spr_dm_gun',
  'spr_dm_face',
];

// Parents first; the reverse of this order is safe to delete.
const OBJECTS = [
  'obj_dm_wall',
  'obj_dm_brick',
  'obj_dm_stone',
  'obj_dm_tech',
  'obj_dm_door',
  'obj_dm_thing',
  'obj_dm_pickup',
  'obj_dm_health',
  'obj_dm_ammo',
  'obj_dm_imp',
  'obj_dm_fireball',
  'obj_dm_exit',
  'obj_dm_player',
  'obj_dm_game',
  'obj_dm_hud',
];

const argument = process.argv
  .slice(2)
  .find((a) => !a.startsWith('--'));
const project = GmProject.open(argument ?? join(bridgeRoot(), 'mcp_bridge'));
console.log(`building into ${project.root}`);

function buildSprites(tx: Transaction): void {
  // Wall textures are sampled a column at a time, so the mask never matters;
  // what does matter is that they are exactly one cell square.
  const wall = { origin: 'topLeft', bboxMode: 1, collisionKind: 1, folder: FOLDER } as const;
  createSprite(project, tx, 'spr_dm_brick', { frames: [art.brickWall()], ...wall });
  createSprite(project, tx, 'spr_dm_stone', { frames: [art.stoneWall()], ...wall });
  createSprite(project, tx, 'spr_dm_tech', { frames: [art.techWall()], ...wall });
  createSprite(project, tx, 'spr_dm_door', { frames: [art.doorWall()], ...wall });

  createSprite(project, tx, 'spr_dm_imp', { frames: art.impFrames(), ...wall });
  createSprite(project, tx, 'spr_dm_fireball', { frames: art.fireball(), playbackSpeed: 12, ...wall });
  createSprite(project, tx, 'spr_dm_health', { frames: [art.medkit()], ...wall });
  createSprite(project, tx, 'spr_dm_ammo', { frames: [art.ammoBox()], ...wall });
  createSprite(project, tx, 'spr_dm_exit', { frames: [art.exitPad()], ...wall });

  // These two are drawn with draw_sprite_ext, so their origins are used.
  createSprite(project, tx, 'spr_dm_gun', {
    frames: art.gunFrames(),
    origin: 'topCentre',
    bboxMode: 1,
    collisionKind: 1,
    folder: FOLDER,
  });
  createSprite(project, tx, 'spr_dm_face', {
    frames: art.faceFrames(),
    origin: 'topCentre',
    bboxMode: 1,
    collisionKind: 1,
    folder: FOLDER,
  });
}

function buildObjects(tx: Transaction): void {
  // Walls: the parent carries no sprite, so the grid can be built by asking
  // every wall instance what kind it is, whatever texture it wears.
  createObject(project, tx, 'obj_dm_wall', { folder: FOLDER });
  for (const [name, sprite, kind] of [
    ['obj_dm_brick', 'spr_dm_brick', 'DM_BRICK'],
    ['obj_dm_stone', 'spr_dm_stone', 'DM_STONE'],
    ['obj_dm_tech', 'spr_dm_tech', 'DM_TECH'],
  ] as const) {
    createObject(project, tx, name, {
      sprite,
      parentObject: 'obj_dm_wall',
      folder: FOLDER,
      events: [{ event: Events.create(), code: gml.wallCreate(kind) }],
    });
  }
  createObject(project, tx, 'obj_dm_door', {
    sprite: 'spr_dm_door',
    parentObject: 'obj_dm_wall',
    folder: FOLDER,
    events: [
      { event: Events.create(), code: gml.DOOR_CREATE },
      { event: Events.step(), code: gml.DOOR_STEP },
    ],
  });

  // Everything the raycaster billboards hangs off one parent, so the renderer
  // can gather the whole scene in a single `with`.
  createObject(project, tx, 'obj_dm_thing', { folder: FOLDER });
  createObject(project, tx, 'obj_dm_pickup', { parentObject: 'obj_dm_thing', folder: FOLDER });
  createObject(project, tx, 'obj_dm_health', {
    sprite: 'spr_dm_health',
    parentObject: 'obj_dm_pickup',
    folder: FOLDER,
    events: [{ event: Events.create(), code: gml.HEALTH_CREATE }],
  });
  createObject(project, tx, 'obj_dm_ammo', {
    sprite: 'spr_dm_ammo',
    parentObject: 'obj_dm_pickup',
    folder: FOLDER,
    events: [{ event: Events.create(), code: gml.AMMO_CREATE }],
  });

  createObject(project, tx, 'obj_dm_imp', {
    sprite: 'spr_dm_imp',
    parentObject: 'obj_dm_thing',
    folder: FOLDER,
    events: [
      { event: Events.create(), code: gml.IMP_CREATE },
      { event: Events.step(), code: gml.IMP_STEP },
    ],
  });
  createObject(project, tx, 'obj_dm_fireball', {
    sprite: 'spr_dm_fireball',
    parentObject: 'obj_dm_thing',
    folder: FOLDER,
    events: [
      { event: Events.create(), code: gml.FIREBALL_CREATE },
      { event: Events.step(), code: gml.FIREBALL_STEP },
    ],
  });
  createObject(project, tx, 'obj_dm_exit', {
    sprite: 'spr_dm_exit',
    parentObject: 'obj_dm_thing',
    folder: FOLDER,
    events: [{ event: Events.create(), code: gml.EXIT_CREATE }],
  });

  createObject(project, tx, 'obj_dm_player', {
    folder: FOLDER,
    events: [
      { event: Events.create(), code: gml.PLAYER_CREATE },
      { event: Events.step(), code: gml.PLAYER_STEP },
      { event: Events.draw(64), code: gml.PLAYER_DRAW_GUI },
    ],
  });

  createObject(project, tx, 'obj_dm_game', {
    folder: FOLDER,
    events: [
      { event: Events.create(), code: gml.GAME_CREATE },
      { event: Events.step(), code: gml.GAME_STEP },
      { event: Events.step(2), code: gml.GAME_END_STEP },
      { event: Events.cleanUp(), code: gml.GAME_CLEANUP },
    ],
  });

  createObject(project, tx, 'obj_dm_hud', {
    folder: FOLDER,
    events: [
      { event: Events.create(), code: gml.HUD_CREATE },
      { event: Events.draw(64), code: gml.HUD_DRAW_GUI },
    ],
  });
}

const built = project.transact('build the raycaster demo', (tx) => {
  for (const name of [ROOM, ...[...OBJECTS].reverse(), ...SPRITES, SCRIPT]) {
    if (project.has(name, tx)) deleteResource(project, tx, name, { force: true });
  }

  createFolder(project, tx, FOLDER);
  createScript(project, tx, SCRIPT, gml.ENGINE, { folder: FOLDER });
  buildSprites(tx);
  buildObjects(tx);

  createRoom(project, tx, ROOM, {
    width: ROOM_WIDTH,
    height: ROOM_HEIGHT,
    folder: FOLDER,
    background: '#000000',
    // The view never shows anything -- every pixel is drawn in Draw GUI, and
    // every instance is invisible -- but it is what sets the window size, and
    // with it the GUI size the renderer works in. Without one, the window
    // opens at the full 2048x1536 of the map.
    view: { width: 1366, height: 768 },
    orderIndex: 0,
  });

  let placed = 0;
  for (const spot of placements()) {
    addRoomInstance(project, tx, ROOM, spot.object, { x: spot.x, y: spot.y });
    placed++;
  }
  for (const name of ['obj_dm_game', 'obj_dm_hud']) {
    addRoomInstance(project, tx, ROOM, name, { x: 0, y: 0 });
    placed++;
  }
  if (project.has('obj_gmlmcp_bridge', tx)) {
    addRoomInstance(project, tx, ROOM, 'obj_gmlmcp_bridge', { x: 0, y: 0 });
    placed++;
  }
  return placed;
});

console.log(
  `${SPRITES.length} sprites, ${OBJECTS.length} objects, ${built} instances in ${ROOM} (${ROOM_WIDTH}x${ROOM_HEIGHT})`,
);
console.log(`room order: ${roomOrder(project).join(', ')}`);

const spec = GmlSpec.load(requireRuntime().specPath);
const mine = checkProject(project, spec).filter((d) => d.file.includes('_dm_'));
if (mine.length) {
  console.log(`\n${mine.length} check diagnostic(s):`);
  for (const d of mine.slice(0, 30)) console.log(`  ${d.file}:${d.line}  ${d.message}`);
} else {
  console.log('\ncheck: clean');
}

if (process.argv.includes('--compile')) {
  const build = await IgorRunner.create(project).compile();
  console.log(
    `compile: ok=${build.ok} ${build.durationMs}ms  ${formatBuildDiagnostics(build.diagnostics)}`,
  );
  if (!build.ok) {
    console.log(build.log.split('\n').slice(-30).join('\n'));
    process.exit(1);
  }
}
