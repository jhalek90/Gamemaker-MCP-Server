/**
 * A regression suite for the game, run through the server's own test runner.
 *
 *   npx tsx tools/platformer/specs.mts
 *
 * Each spec re-enters the room first, so a brick smashed by one test is back
 * for the next. Globals survive that, because obj_game is persistent, so
 * anything a test counts is reset explicitly.
 *
 * Input goes through the game's `bot_*` seam rather than `press`/`release`.
 * Both work; the seam is used because it states intent directly and cannot be
 * perturbed by whatever else has the keyboard while a suite runs.
 */

import { join } from 'node:path';
import { bridgeRoot } from '../../src/bridge/install.js';
import { BridgeClient } from '../../src/bridge/index.js';
import { IgorRunner } from '../../src/build/index.js';
import { GmProject } from '../../src/project/index.js';
import { formatReport, runTests, type GmTestSpec, type TestStep } from '../../src/testing/index.js';
import { MAP, TILE } from './level.js';

const BRICKS = MAP.join('').split('').filter((c) => c === 'B').length;
const GOOMBAS = MAP.join('').split('').filter((c) => c === 'e').length;

/** Tile centre, for something standing on the floor of that tile. */
const at = (col: number, row: number): { x: number; y: number } => ({
  x: col * TILE + TILE / 2,
  y: (row + 1) * TILE,
});

/**
 * Put the player at an exact spot, in a known power state, in a reset room.
 *
 * Coordinates rather than tiles, because two of these tests need the player
 * dropped in mid-air. Watch what else lives in the tile you pick: standing a
 * test subject on a goomba's spawn costs it the mushroom before the test even
 * begins.
 */
function place(x: number, y: number, big: boolean): TestStep[] {
  return [
    { goto: 'rm_level1' },
    { wait: 6 },
    { set: { name: 'coins', value: 0 } },
    { set: { name: 'score', value: 0 } },
    { set: { name: 'bot_right', value: false } },
    { set: { name: 'big', value: big, scope: 'obj_player' } },
    // Height first, then column. Each set is its own request with frames
    // running in between, so the player briefly exists at the halfway point:
    // moving across at the old height can drop him onto an enemy and kill him
    // before the test has begun.
    { set: { name: 'y', value: y, scope: 'obj_player' } },
    { set: { name: 'x', value: x, scope: 'obj_player' } },
    { wait: 3 },
  ];
}

// Bricks run along row 7 at columns 14-16, sitting directly on big Mario's
// head where he stands on row 10. Column 16 is the one clear of the goomba
// that spawns at column 15.
const UNDER_BRICK = at(16, 9);
// Death takes 80 frames to trigger a room restart, so every check for "dead"
// has to land inside that window or it sees the replacement player.
const BEFORE_RESTART = 40;

const SPECS: GmTestSpec[] = [
  {
    name: 'big Mario smashes a brick with his head',
    steps: [
      ...place(UNDER_BRICK.x, UNDER_BRICK.y, true),
      { expect: { instances: 'obj_brick', op: '==', value: BRICKS } },
      { set: { name: 'bot_jump_once', value: 26 } },
      { wait: 20 },
      {
        expect: {
          instances: 'obj_brick',
          op: '==',
          value: BRICKS - 1,
          because: 'the brick above him should be gone',
        },
      },
      { expect: { instances: 'obj_brick_chunk', op: '==', value: 4, because: 'it breaks into four' } },
      { screenshot: 'brick_smashed.png' },
    ],
  },
  {
    name: 'small Mario only nudges the same brick',
    steps: [
      ...place(UNDER_BRICK.x, UNDER_BRICK.y, false),
      { set: { name: 'bot_jump_once', value: 26 } },
      { wait: 30 },
      {
        expect: {
          instances: 'obj_brick',
          op: '==',
          value: BRICKS,
          because: 'small Mario is not strong enough to break it',
        },
      },
      { expect: { instances: 'obj_brick_chunk', op: '==', value: 0 } },
    ],
  },
  {
    name: 'a coin is collected on contact',
    steps: [
      ...place(at(6, 9).x, at(6, 9).y, false),
      { wait: 5 },
      { expect: { name: 'coins', op: '>=', value: 1 } },
    ],
  },
  {
    name: 'landing on a goomba flattens it',
    steps: [
      // Dropped onto the goomba that spawns at column 15, from just above it.
      // A longer drop gives the goomba time to walk out from under the landing
      // spot, which turns a stomp into a glancing hit and a dead player.
      ...place(at(15, 9).x - 12, 580, false),
      { wait: 15 },
      {
        expect: {
          name: 'score',
          op: '==',
          value: 100,
          because: 'a stomp scores 100, and nothing else is worth 100',
        },
      },
      { expect: { name: 'state', scope: 'obj_player', op: '==', value: 'play' } },
      { wait: 55 },
      {
        expect: {
          instances: 'obj_goomba',
          op: '==',
          value: GOOMBAS - 1,
          because: 'a squashed goomba disappears shortly after',
        },
      },
    ],
  },
  {
    name: 'walking into a goomba is fatal while small',
    steps: [
      // Start a few tiles short of the goomba and walk into it.
      ...place(at(12, 9).x, at(12, 9).y, false),
      { set: { name: 'bot_right', value: true } },
      { wait: BEFORE_RESTART },
      { set: { name: 'bot_right', value: false } },
      { expect: { name: 'state', scope: 'obj_player', op: '==', value: 'dead' } },
    ],
  },
  {
    name: 'a pit is fatal',
    steps: [
      // Column 21 is inside the first pit.
      ...place(at(21, 9).x, at(21, 9).y, false),
      { wait: 40 },
      { expect: { name: 'state', scope: 'obj_player', op: '==', value: 'dead' } },
    ],
  },
  {
    name: 'a bonus block gives a mushroom, and it makes you big',
    steps: [
      // The bonus block at column 36; the nearest goomba is thirteen tiles
      // away, which is several hundred frames of walking.
      ...place(at(36, 9).x, at(36, 9).y, false),
      { set: { name: 'bot_jump_once', value: 26 } },
      { wait: 20 },
      { expect: { instances: 'obj_mushroom', op: '==', value: 1 } },
      { expect: { name: 'big', scope: 'obj_player', op: '==', value: false } },
      // A mushroom always walks right, and always slower than the player, so
      // chasing it never works. Get ahead of it and let it come to you.
      { set: { name: 'bot_right', value: true } },
      { wait: 25 },
      { set: { name: 'bot_right', value: false } },
      { wait: 90 },
      { expect: { name: 'big', scope: 'obj_player', op: '==', value: true } },
      { screenshot: 'grew.png' },
    ],
  },
  {
    name: 'touching the flag wins the level',
    steps: [
      ...place(at(77, 9).x, at(77, 9).y, false),
      { wait: 6 },
      { expect: { name: 'state', scope: 'obj_player', op: '==', value: 'won' } },
      { screenshot: 'won.png' },
    ],
  },
];

const project = GmProject.open(join(bridgeRoot(), 'mcp_bridge'));
const game = await IgorRunner.create(project).run();
try {
  await game.waitFor(/\[gmlmcp\] listening/, 180000);
  const client = await BridgeClient.connect();
  const report = await runTests(client, SPECS);
  console.log(formatReport(report));
  client.close();
  if (report.failed > 0) process.exitCode = 1;
} catch (error) {
  console.log('FAILED:', (error as Error).message);
  console.log(game.log().split('\n').slice(-20).join('\n'));
  process.exitCode = 1;
} finally {
  game.stop();
}
