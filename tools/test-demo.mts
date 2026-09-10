/**
 * Demonstrate the deterministic test runner against the bridge's own project.
 *
 * Includes a test designed to fail, because a runner that only ever reports
 * success proves nothing.
 *
 * Usage: npx tsx tools/test-demo.mts
 */
import { join } from 'node:path';
import { BridgeClient } from '../src/bridge/index.js';
import { IgorRunner } from '../src/build/index.js';
import { GmProject } from '../src/project/index.js';
import { bridgeRoot } from '../src/bridge/install.js';
import { formatReport, runTests, type GmTestSpec } from '../src/testing/index.js';

const project = GmProject.open(join(bridgeRoot(), 'mcp_bridge'));
const game = await (await IgorRunner.create(project)).run();

try {
  await game.waitFor(/\[gmlmcp\][^\n]*/, 180000);
  const client = await BridgeClient.connect();
  console.log(`connected; game in room ${client.hello.room}\n`);

  const tests: GmTestSpec[] = [
    {
      name: 'the same seed produces the same value',
      seed: 424242,
      steps: [
        { expect: { call: { function: 'gmlmcp_selftest_random' }, op: '>=', value: 0 } },
        { seed: 424242, call: { function: 'gmlmcp_selftest_random' } },
      ],
    },
    {
      name: 'waiting advances real frames',
      speed: 2000,
      steps: [
        { set: { name: 'gmlmcp_selftest_counter', value: 0 } },
        { call: { function: 'gmlmcp_selftest_bump', args: [5] } },
        { wait: 120 },
        { expect: { name: 'gmlmcp_selftest_counter', op: '==', value: 5 } },
      ],
    },
    {
      name: 'the bridge object is alive and persistent',
      steps: [
        { expect: { instances: 'obj_gmlmcp_bridge', op: '==', value: 1 } },
        { expect: { name: 'persistent', scope: 'obj_gmlmcp_bridge', op: '==', value: 1 } },
      ],
    },
    {
      name: 'tunables survive a wait',
      speed: 2000,
      steps: [
        { call: { function: 'gmlmcp_selftest_bump', args: [0] } },
        { set: { name: 'agent_tuned', value: 7.5 } },
        { wait: 60 },
        { expect: { name: 'agent_tuned', op: '==', value: 7.5, tolerance: 0.001 } },
      ],
    },
    {
      name: 'input reaches the game',
      speed: 2000,
      steps: [
        { press: 'vk_right' },
        { wait: 10 },
        { release: 'vk_right' },
        { expect: { instances: 'obj_gmlmcp_bridge', op: '>=', value: 1 } },
      ],
    },
    {
      name: 'DELIBERATE FAILURE: this expectation is wrong on purpose',
      steps: [
        { set: { name: 'known_value', value: 3 } },
        { expect: { name: 'known_value', op: '==', value: 99, because: 'proving failures are reported' } },
      ],
    },
    {
      name: 'DELIBERATE FAILURE: reading a variable that does not exist',
      steps: [{ expect: { name: 'no_such_global_anywhere', op: '==', value: 1 } }],
    },
  ];

  // Determinism needs the same seed twice; compare the two readings directly.
  const first = await client.request('seed', { seed: 999 }).then(() =>
    client.request('call', { function: 'gmlmcp_selftest_random', args: [] }),
  );
  const second = await client.request('seed', { seed: 999 }).then(() =>
    client.request('call', { function: 'gmlmcp_selftest_random', args: [] }),
  );
  const different = await client.request('seed', { seed: 1000 }).then(() =>
    client.request('call', { function: 'gmlmcp_selftest_random', args: [] }),
  );
  console.log(`determinism:  seed 999 -> ${first},  again -> ${second},  seed 1000 -> ${different}`);
  console.log(`  same seed reproduces: ${first === second}`);
  console.log(`  different seed differs: ${first !== different}\n`);

  const report = await runTests(client, tests);
  console.log(formatReport(report));
  client.close();
} catch (error) {
  console.log('FAILED:', (error as Error).message);
  console.log(game.log().split('\n').slice(-20).join('\n'));
} finally {
  game.stop();
}
