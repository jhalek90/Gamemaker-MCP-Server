import { describe, expect, it } from 'vitest';
import { compare, formatReport, runTest, runTests, type GmTestSpec } from '../src/testing/index.js';
import { BridgeError } from '../src/bridge/index.js';

/** Stands in for a running game, recording what the runner asked it to do. */
function fakeGame(state: Record<string, unknown> = {}) {
  const sent: { command: string; args: Record<string, unknown> }[] = [];
  let frames = 0;
  const client = {
    isOpen: true,
    async request(command: string, args: Record<string, unknown> = {}): Promise<unknown> {
      sent.push({ command, args });
      switch (command) {
        case 'ping':
          return { frames, speed: 60, room: 'Room1', save_directory: 'C:/save/' };
        case 'wait':
          frames += Number(args.frames ?? 0);
          return { frames };
        case 'set_var':
          state[String(args.name)] = args.value;
          return { name: args.name, value: args.value };
        case 'get_var':
          if (!(String(args.name) in state)) throw new BridgeError(`no global named ${args.name}`);
          return state[String(args.name)];
        case 'instances':
          return { count: Number(state[`__count_${args.object}`] ?? 0) };
        case 'call':
          return state[`__call_${args.function}`];
        case 'screenshot':
          return { file: String(args.name ?? 'shot.png'), directory: 'C:/save/' };
        default:
          return {};
      }
    },
    close() {},
  };
  return { client: client as never, sent, state };
}

describe('comparison', () => {
  it('handles the ordering operators', () => {
    expect(compare(5, '>', 3)).toBe(true);
    expect(compare(3, '>', 5)).toBe(false);
    expect(compare(5, '>=', 5)).toBe(true);
    expect(compare(1, '<', 2)).toBe(true);
    expect(compare(2, '<=', 2)).toBe(true);
  });

  it('compares structures by value', () => {
    expect(compare({ a: 1 }, '==', { a: 1 })).toBe(true);
    expect(compare([1, 2], '==', [1, 2])).toBe(true);
    expect(compare({ a: 1 }, '!=', { a: 2 })).toBe(true);
  });

  it('allows a tolerance, because physics is rarely exact', () => {
    expect(compare(1.0001, '==', 1)).toBe(false);
    expect(compare(1.0001, '==', 1, 0.001)).toBe(true);
    expect(compare(1.5, '==', 1, 0.001)).toBe(false);
  });

  it('checks membership', () => {
    expect(compare([1, 2, 3], 'contains', 2)).toBe(true);
    expect(compare('hello world', 'contains', 'world')).toBe(true);
    expect(compare([1, 2], 'contains', 9)).toBe(false);
  });

  it('checks existence in both directions', () => {
    expect(compare(0, 'exists', true)).toBe(true);
    expect(compare(undefined, 'exists', true)).toBe(false);
    expect(compare(undefined, 'exists', false)).toBe(true);
  });
});

describe('running a test', () => {
  it('passes when every expectation holds', async () => {
    const { client } = fakeGame({ hp: 10 });
    const result = await runTest(client, {
      name: 'hp starts at 10',
      steps: [{ expect: { name: 'hp', op: '==', value: 10 } }],
    });
    expect(result.passed).toBe(true);
    expect(result.failure).toBeUndefined();
  });

  it('reports which step failed and why', async () => {
    const { client } = fakeGame({ hp: 10 });
    const result = await runTest(client, {
      name: 'hp is wrong',
      steps: [{ wait: 1 }, { expect: { name: 'hp', op: '==', value: 3 } }],
    });
    expect(result.passed).toBe(false);
    expect(result.failure?.step).toBe(2);
    expect(result.failure?.detail).toContain('expected global.hp == 3, got 10');
  });

  it('uses a custom message when given one', async () => {
    const { client } = fakeGame({ hp: 10 });
    const result = await runTest(client, {
      name: 'custom',
      steps: [{ expect: { name: 'hp', op: '==', value: 3, because: 'the potion should have healed' } }],
    });
    expect(result.failure?.detail).toBe('the potion should have healed');
  });

  it('stops at the first failure, since later steps build on earlier ones', async () => {
    const { client, sent } = fakeGame({ hp: 10 });
    await runTest(client, {
      name: 'stops early',
      steps: [
        { expect: { name: 'hp', op: '==', value: 3 } },
        { set: { name: 'never_set', value: 1 } },
      ],
    });
    expect(sent.some((s) => s.args.name === 'never_set')).toBe(false);
  });

  it('turns a missing variable into a failure, not a crash', async () => {
    const { client } = fakeGame({});
    const result = await runTest(client, {
      name: 'missing',
      steps: [{ expect: { name: 'nothing_here', op: '==', value: 1 } }],
    });
    expect(result.passed).toBe(false);
    expect(result.failure?.detail).toContain('no global named nothing_here');
  });

  it('treats a missing variable as a legitimate answer to exists', async () => {
    const { client } = fakeGame({});
    const result = await runTest(client, {
      name: 'absent',
      steps: [{ expect: { name: 'nothing_here', op: 'exists', value: false } }],
    });
    expect(result.passed).toBe(true);
  });

  it('seeds and clears input before running, for repeatability', async () => {
    const { client, sent } = fakeGame({});
    await runTest(client, { name: 'setup', seed: 7, speed: 500, steps: [] });
    expect(sent.find((s) => s.command === 'seed')?.args.seed).toBe(7);
    expect(sent.find((s) => s.command === 'speed')?.args.fps).toBe(500);
    expect(sent.some((s) => s.command === 'input' && s.args.clear === true)).toBe(true);
  });

  it('restores the original speed and clears input afterwards', async () => {
    const { client, sent } = fakeGame({});
    await runTest(client, { name: 'cleanup', speed: 5000, steps: [] });
    // The last speed request should put it back to what ping reported.
    const speeds = sent.filter((s) => s.command === 'speed');
    expect(speeds[speeds.length - 1]!.args.fps).toBe(60);
    expect(sent.filter((s) => s.command === 'input' && s.args.clear === true).length).toBe(2);
  });

  it('counts the frames a test advanced', async () => {
    const { client } = fakeGame({});
    const result = await runTest(client, {
      name: 'frames',
      steps: [{ wait: 30 }, { wait: 12 }],
    });
    expect(result.frames).toBe(42);
  });

  it('collects screenshots it captured', async () => {
    const { client } = fakeGame({});
    const result = await runTest(client, {
      name: 'shots',
      steps: [{ screenshot: 'one.png' }, { screenshot: 'two.png' }],
    });
    expect(result.screenshots).toEqual(['C:/save/one.png', 'C:/save/two.png']);
  });

  it('counts instances and calls functions', async () => {
    const { client } = fakeGame({ __count_objEnemy: 3, __call_get_score: 120 });
    const result = await runTest(client, {
      name: 'other subjects',
      steps: [
        { expect: { instances: 'objEnemy', op: '==', value: 3 } },
        { expect: { call: { function: 'get_score' }, op: '>', value: 100 } },
      ],
    });
    expect(result.passed).toBe(true);
  });

  it('rejects an expectation that names nothing', async () => {
    const { client } = fakeGame({});
    const result = await runTest(client, {
      name: 'empty expectation',
      steps: [{ expect: { op: '==', value: 1 } }],
    });
    expect(result.failure?.detail).toContain('names nothing to check');
  });
});

describe('reporting', () => {
  it('summarises passes and failures', async () => {
    const { client } = fakeGame({ hp: 10 });
    const specs: GmTestSpec[] = [
      { name: 'good', steps: [{ expect: { name: 'hp', op: '==', value: 10 } }] },
      { name: 'bad', steps: [{ expect: { name: 'hp', op: '==', value: 1 } }] },
    ];
    const report = await runTests(client, specs);
    expect(report.passed).toBe(1);
    expect(report.failed).toBe(1);

    const text = formatReport(report);
    expect(text).toContain('PASS  good');
    expect(text).toContain('FAIL  bad');
    expect(text).toContain('1 passed, 1 failed');
  });
});
