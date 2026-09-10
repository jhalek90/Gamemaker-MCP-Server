/**
 * Build the whole platformer into a GameMaker project.
 *
 *   npx tsx tools/platformer/build.mts             build into bridge/mcp_bridge
 *   npx tsx tools/platformer/build.mts --compile   ... and compile it
 *   npx tsx tools/platformer/build.mts <path>      ... into another project
 *
 * Everything lands in one transaction, so `workspace.undo()` removes the game
 * and leaves the project exactly as it was.
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
  createSprite,
  deleteResource,
  Events,
  GmProject,
  setSpriteProperties,
} from '../../src/project/index.js';
import { GmlSpec, requireRuntime } from '../../src/spec/index.js';
import type { Transaction } from '../../src/tx/index.js';
import * as art from './art.js';
import * as gml from './gml.js';
import { CLOUDS, placements, ROOM_HEIGHT, ROOM_WIDTH } from './level.js';

const FOLDER = 'Platformer';
const ROOM = 'rm_level1';

const SPRITES = [
  'spr_mario_small',
  'spr_mario_big',
  'spr_goomba',
  'spr_coin',
  'spr_mushroom',
  'spr_ground',
  'spr_dirt',
  'spr_brick',
  'spr_brick_chunk',
  'spr_qblock',
  'spr_qblock_used',
  'spr_flagpole',
  'spr_cloud',
];

// Ordered so that nothing is created before something it points at: children
// after their parent object, collision events after the object they name.
const OBJECTS = [
  'obj_solid',
  'obj_player',
  'obj_ground',
  'obj_dirt',
  'obj_block',
  'obj_brick',
  'obj_brick_chunk',
  'obj_mushroom',
  'obj_qblock',
  'obj_goomba',
  'obj_coin',
  'obj_goal',
  'obj_cloud',
  'obj_camera',
  'obj_game',
];

const argument = process.argv.find((a) => !a.startsWith('--') && a !== process.argv[0] && a !== process.argv[1]);
const root = argument ?? join(bridgeRoot(), 'mcp_bridge');
const project = GmProject.open(root);
console.log(`building into ${project.root}`);

// -- sprites --------------------------------------------------------------

function buildSprites(tx: Transaction): void {
  const block = { origin: 'topLeft', bboxMode: 1, collisionKind: 1, folder: FOLDER } as const;

  createSprite(project, tx, 'spr_mario_small', {
    frames: art.heroFrames(false),
    origin: 'bottomCentre',
    bboxMode: 1,
    collisionKind: 1,
    folder: FOLDER,
  });
  createSprite(project, tx, 'spr_mario_big', {
    frames: art.heroFrames(true),
    origin: 'bottomCentre',
    bboxMode: 1,
    collisionKind: 1,
    folder: FOLDER,
  });
  createSprite(project, tx, 'spr_goomba', {
    frames: art.goombaFrames(),
    origin: 'bottomCentre',
    bboxMode: 1,
    collisionKind: 1,
    folder: FOLDER,
  });
  createSprite(project, tx, 'spr_coin', {
    frames: art.coinFrames(),
    origin: 'middleCentre',
    bboxMode: 1,
    collisionKind: 1,
    playbackSpeed: 14,
    folder: FOLDER,
  });
  createSprite(project, tx, 'spr_mushroom', {
    frames: [art.mushroom()],
    origin: 'bottomCentre',
    bboxMode: 1,
    collisionKind: 1,
    folder: FOLDER,
  });
  createSprite(project, tx, 'spr_ground', { frames: [art.groundBlock()], ...block });
  createSprite(project, tx, 'spr_dirt', { frames: [art.groundBlock(false)], ...block });
  createSprite(project, tx, 'spr_brick', { frames: [art.brickBlock()], ...block });
  // Debris spins about its own centre, so its origin is the middle.
  createSprite(project, tx, 'spr_brick_chunk', {
    frames: [art.brickChunk()],
    origin: 'middleCentre',
    bboxMode: 1,
    collisionKind: 1,
    folder: FOLDER,
  });
  createSprite(project, tx, 'spr_qblock', {
    frames: art.questionBlock(),
    playbackSpeed: 6,
    ...block,
  });
  createSprite(project, tx, 'spr_qblock_used', { frames: [art.usedBlock()], ...block });
  createSprite(project, tx, 'spr_cloud', { frames: [art.cloud()], ...block });

  // The flagpole's origin is the pole itself, not the middle of the image, so
  // it plants on the centre of a tile with the banner hanging off to one side.
  createSprite(project, tx, 'spr_flagpole', {
    frames: [art.flagpole()],
    origin: { x: 35, y: 384 },
    collisionKind: 1,
    folder: FOLDER,
  });
  // Only the pole should count as touching the flag, so the mask is set by
  // hand rather than taken from the whole image.
  setSpriteProperties(project, tx, 'spr_flagpole', {
    bboxMode: 2,
    bbox: { left: 20, top: 8, right: 50, bottom: 383 },
  });
}

// -- objects --------------------------------------------------------------

function buildObjects(tx: Transaction): void {
  // No sprite of its own: it exists so that everything solid can be collided
  // with in one call, through its children.
  createObject(project, tx, 'obj_solid', { folder: FOLDER });

  createObject(project, tx, 'obj_player', {
    sprite: 'spr_mario_small',
    folder: FOLDER,
    events: [
      { event: Events.create(), code: gml.PLAYER_CREATE },
      { event: Events.step(), code: gml.PLAYER_STEP },
    ],
  });

  createObject(project, tx, 'obj_ground', {
    sprite: 'spr_ground',
    parentObject: 'obj_solid',
    folder: FOLDER,
  });
  createObject(project, tx, 'obj_dirt', {
    sprite: 'spr_dirt',
    parentObject: 'obj_solid',
    folder: FOLDER,
  });
  // Solid, and answers to being hit from below. Both kinds of block define a
  // bump() method, so the player only has to look for one parent.
  createObject(project, tx, 'obj_block', { parentObject: 'obj_solid', folder: FOLDER });

  createObject(project, tx, 'obj_brick_chunk', {
    sprite: 'spr_brick_chunk',
    folder: FOLDER,
    events: [
      { event: Events.create(), code: gml.CHUNK_CREATE },
      { event: Events.step(), code: gml.CHUNK_STEP },
    ],
  });

  createObject(project, tx, 'obj_brick', {
    sprite: 'spr_brick',
    parentObject: 'obj_block',
    folder: FOLDER,
    events: [
      { event: Events.create(), code: gml.BRICK_CREATE },
      { event: Events.step(), code: gml.BRICK_STEP },
      { event: Events.draw(), code: gml.BRICK_DRAW },
    ],
  });

  createObject(project, tx, 'obj_mushroom', {
    sprite: 'spr_mushroom',
    folder: FOLDER,
    events: [
      { event: Events.create(), code: gml.MUSHROOM_CREATE },
      { event: Events.step(), code: gml.MUSHROOM_STEP },
      { event: Events.collision('obj_player'), code: gml.MUSHROOM_COLLECT },
    ],
  });

  createObject(project, tx, 'obj_qblock', {
    sprite: 'spr_qblock',
    parentObject: 'obj_block',
    folder: FOLDER,
    events: [
      { event: Events.create(), code: gml.QBLOCK_CREATE },
      { event: Events.step(), code: gml.QBLOCK_STEP },
      { event: Events.draw(), code: gml.QBLOCK_DRAW },
    ],
  });

  createObject(project, tx, 'obj_goomba', {
    sprite: 'spr_goomba',
    folder: FOLDER,
    events: [
      { event: Events.create(), code: gml.GOOMBA_CREATE },
      { event: Events.step(), code: gml.GOOMBA_STEP },
    ],
  });

  createObject(project, tx, 'obj_coin', {
    sprite: 'spr_coin',
    folder: FOLDER,
    events: [
      { event: Events.create(), code: gml.COIN_CREATE },
      { event: Events.collision('obj_player'), code: gml.COIN_COLLECT },
    ],
  });

  createObject(project, tx, 'obj_goal', {
    sprite: 'spr_flagpole',
    folder: FOLDER,
    events: [{ event: Events.create(), code: gml.GOAL_CREATE }],
  });

  createObject(project, tx, 'obj_cloud', {
    sprite: 'spr_cloud',
    folder: FOLDER,
    events: [{ event: Events.create(), code: gml.CLOUD_CREATE }],
  });

  createObject(project, tx, 'obj_camera', {
    folder: FOLDER,
    events: [
      { event: Events.create(), code: gml.CAMERA_CREATE },
      { event: Events.step(2), code: gml.CAMERA_END_STEP },
    ],
  });

  createObject(project, tx, 'obj_game', {
    persistent: true,
    folder: FOLDER,
    events: [
      { event: Events.create(), code: gml.GAME_CREATE },
      { event: Events.step(), code: gml.GAME_STEP },
      { event: Events.step(2), code: gml.GAME_END_STEP },
      { event: Events.draw(64), code: gml.GAME_DRAW_GUI },
    ],
  });
}

// -- build ----------------------------------------------------------------

const built = project.transact('build the platformer', (tx) => {
  // Rebuildable: drop a previous run first, room before objects before
  // sprites, so nothing is deleted while something still points at it.
  for (const name of [ROOM, ...[...OBJECTS].reverse(), ...SPRITES]) {
    if (project.has(name, tx)) deleteResource(project, tx, name, { force: true });
  }

  createFolder(project, tx, FOLDER);
  buildSprites(tx);
  buildObjects(tx);

  createRoom(project, tx, ROOM, {
    width: ROOM_WIDTH,
    height: ROOM_HEIGHT,
    folder: FOLDER,
    background: '#5c94fc',
    // Views on, but with no follow target: obj_camera drives the view itself,
    // and a follow object here would fight it.
    view: { width: 1366, height: 768 },
    // First in the room order, so running the project starts the game.
    orderIndex: 0,
  });

  let placed = 0;
  for (const spot of placements()) {
    addRoomInstance(project, tx, ROOM, spot.object, { x: spot.x, y: spot.y });
    placed++;
  }
  for (const [x, y] of CLOUDS) {
    addRoomInstance(project, tx, ROOM, 'obj_cloud', { x, y });
    placed++;
  }
  addRoomInstance(project, tx, ROOM, 'obj_camera', { x: 0, y: 0 });
  addRoomInstance(project, tx, ROOM, 'obj_game', { x: 0, y: 0 });
  // The MCP bridge, so the game can be driven and screenshotted from here.
  if (project.has('obj_gmlmcp_bridge', tx)) {
    addRoomInstance(project, tx, ROOM, 'obj_gmlmcp_bridge', { x: 0, y: 0 });
  }
  return placed + 1;
});

console.log(`${SPRITES.length} sprites, ${OBJECTS.length} objects, ${built} instances in ${ROOM}`);
console.log(`room ${ROOM_WIDTH}x${ROOM_HEIGHT}`);

// -- check ----------------------------------------------------------------

const spec = GmlSpec.load(requireRuntime().specPath);
// The bridge's own scripts are checked elsewhere; only the game matters here.
const mine = checkProject(project, spec).filter((d) => !d.file.includes('gmlmcp'));
if (mine.length) {
  console.log(`\n${mine.length} check diagnostic(s):`);
  for (const d of mine.slice(0, 25)) {
    console.log(`  ${d.file}:${d.line}  ${d.message}`);
  }
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
