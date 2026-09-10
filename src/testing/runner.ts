/**
 * Running tests against a live game.
 *
 * Tests are declarative rather than code, because an agent talks to this
 * server over MCP and cannot ship a function across that boundary. A spec is
 * a list of steps — seed, input, wait, expect — which is enough to express
 * "hold right for a second and check the player moved" without inventing a
 * scripting language.
 *
 * Determinism comes from three things: a fixed random seed, input delivered
 * on exact frames, and waits measured in frames rather than wall clock. The
 * game speed can then be raised so a second of play costs a fraction of a
 * second to run.
 */

import { BridgeClient, BridgeError } from '../bridge/index.js';

export type CompareOp = '==' | '!=' | '>' | '>=' | '<' | '<=' | 'contains' | 'exists';

export interface Expectation {
  /** Variable to read. */
  name?: string;
  /** `global`, an object name, or an instance id. Defaults to `global`. */
  scope?: string;
  /** Call a function and check its result instead of reading a variable. */
  call?: { function: string; args?: unknown[] };
  /** Count live instances of this object instead. */
  instances?: string;
  op?: CompareOp;
  value?: unknown;
  /** Allowed difference for numeric comparison; physics is rarely exact. */
  tolerance?: number;
  /** Shown instead of the generated description when this fails. */
  because?: string;
}

export interface TestStep {
  seed?: number;
  /** Frames per second. Raise it to simulate faster than real time. */
  speed?: number;
  set?: { name: string; value: unknown; scope?: string };
  press?: string | string[];
  release?: string | string[];
  clearInput?: boolean;
  /** Let the game run this many frames. */
  wait?: number;
  call?: { function: string; args?: unknown[] };
  /** Change room. */
  goto?: string;
  screenshot?: string;
  expect?: Expectation;
}

export interface GmTestSpec {
  name: string;
  /** Applied before the first step. */
  seed?: number;
  speed?: number;
  steps: TestStep[];
}

export interface TestFailure {
  /** 1-based index of the failing step. */
  step: number;
  detail: string;
}

export interface TestResult {
  name: string;
  passed: boolean;
  failure?: TestFailure;
  durationMs: number;
  /** Frames the game advanced during the test. */
  frames: number;
  /** Screenshots captured, as absolute paths. */
  screenshots: string[];
}

export interface TestReport {
  passed: number;
  failed: number;
  results: TestResult[];
  durationMs: number;
}

interface PingResult {
  frames: number;
  speed: number;
  room: string;
  save_directory: string;
}

/** Run one spec, stopping at the first failed expectation. */
export async function runTest(client: BridgeClient, spec: GmTestSpec): Promise<TestResult> {
  const started = Date.now();
  const screenshots: string[] = [];
  const before = (await client.request('ping')) as PingResult;
  let failure: TestFailure | undefined;

  try {
    if (spec.seed !== undefined) await client.request('seed', { seed: spec.seed });
    if (spec.speed !== undefined) await client.request('speed', { fps: spec.speed });
    // Start from a known input state, or a key left down by an earlier test
    // silently changes this one.
    await client.request('input', { clear: true });

    for (let i = 0; i < spec.steps.length; i++) {
      const detail = await runStep(client, spec.steps[i]!, screenshots);
      if (detail) {
        failure = { step: i + 1, detail };
        break;
      }
    }
  } catch (error) {
    failure ??= { step: 0, detail: (error as Error).message };
  } finally {
    // Leave the game as it was found, so tests do not contaminate each other.
    try {
      await client.request('input', { clear: true });
      await client.request('speed', { fps: before.speed });
    } catch {
      /* the game may already be gone */
    }
  }

  const after = (await client.request('ping').catch(() => before)) as PingResult;
  return {
    name: spec.name,
    passed: failure === undefined,
    failure,
    durationMs: Date.now() - started,
    frames: after.frames - before.frames,
    screenshots,
  };
}

/** Returns a failure description, or undefined when the step succeeded. */
async function runStep(
  client: BridgeClient,
  step: TestStep,
  screenshots: string[],
): Promise<string | undefined> {
  if (step.seed !== undefined) await client.request('seed', { seed: step.seed });
  if (step.speed !== undefined) await client.request('speed', { fps: step.speed });
  if (step.clearInput) await client.request('input', { clear: true });
  if (step.set) {
    await client.request('set_var', {
      scope: step.set.scope ?? 'global',
      name: step.set.name,
      value: step.set.value,
    });
  }
  if (step.press !== undefined) await client.request('input', { press: step.press });
  if (step.release !== undefined) await client.request('input', { release: step.release });
  if (step.goto) await client.request('goto_room', { room: step.goto });
  if (step.call) {
    await client.request('call', { function: step.call.function, args: step.call.args ?? [] });
  }
  if (step.wait !== undefined) await client.request('wait', { frames: step.wait });
  if (step.screenshot !== undefined) {
    const shot = (await client.request('screenshot', { name: step.screenshot })) as {
      file: string;
      directory: string;
    };
    screenshots.push(`${shot.directory}${shot.file}`);
  }
  if (step.expect) return checkExpectation(client, step.expect);
  return undefined;
}

async function checkExpectation(
  client: BridgeClient,
  expectation: Expectation,
): Promise<string | undefined> {
  const op = expectation.op ?? '==';
  let actual: unknown;
  let subject: string;

  try {
    if (expectation.instances !== undefined) {
      subject = `instance count of ${expectation.instances}`;
      const result = (await client.request('instances', {
        object: expectation.instances,
        limit: 1,
      })) as { count: number };
      actual = result.count;
    } else if (expectation.call) {
      subject = `${expectation.call.function}()`;
      actual = await client.request('call', {
        function: expectation.call.function,
        args: expectation.call.args ?? [],
      });
    } else if (expectation.name !== undefined) {
      const scope = expectation.scope ?? 'global';
      subject = `${scope}.${expectation.name}`;
      actual = await client.request('get_var', { scope, name: expectation.name });
    } else {
      return 'expectation names nothing to check (use name, call or instances)';
    }
  } catch (error) {
    // A missing variable is a legitimate answer to `exists`, not an error.
    if (op === 'exists') {
      return expectation.value === false
        ? undefined
        : `expected it to exist, but: ${(error as Error).message}`;
    }
    if (error instanceof BridgeError) return error.message;
    throw error;
  }

  if (compare(actual, op, expectation.value, expectation.tolerance)) return undefined;
  return (
    expectation.because ??
    `expected ${subject} ${op} ${JSON.stringify(expectation.value)}, got ${JSON.stringify(actual)}`
  );
}

export function compare(
  actual: unknown,
  op: CompareOp,
  expected: unknown,
  tolerance?: number,
): boolean {
  switch (op) {
    case 'exists':
      return expected === false ? actual === undefined : actual !== undefined;
    case '==':
      if (typeof actual === 'number' && typeof expected === 'number' && tolerance !== undefined) {
        return Math.abs(actual - expected) <= tolerance;
      }
      return JSON.stringify(actual) === JSON.stringify(expected);
    case '!=':
      return !compare(actual, '==', expected, tolerance);
    case '>':
      return Number(actual) > Number(expected);
    case '>=':
      return Number(actual) >= Number(expected);
    case '<':
      return Number(actual) < Number(expected);
    case '<=':
      return Number(actual) <= Number(expected);
    case 'contains':
      if (Array.isArray(actual)) return actual.some((item) => compare(item, '==', expected));
      return String(actual).includes(String(expected));
  }
}

export async function runTests(
  client: BridgeClient,
  specs: readonly GmTestSpec[],
): Promise<TestReport> {
  const started = Date.now();
  const results: TestResult[] = [];
  for (const spec of specs) results.push(await runTest(client, spec));
  return {
    passed: results.filter((r) => r.passed).length,
    failed: results.filter((r) => !r.passed).length,
    results,
    durationMs: Date.now() - started,
  };
}

export function formatReport(report: TestReport): string {
  const lines = report.results.map((result) => {
    const head = `${result.passed ? 'PASS' : 'FAIL'}  ${result.name}  (${result.frames} frames, ${result.durationMs}ms)`;
    if (result.passed) return head;
    return `${head}\n      step ${result.failure?.step}: ${result.failure?.detail}`;
  });
  lines.push(
    '',
    `${report.passed} passed, ${report.failed} failed in ${(report.durationMs / 1000).toFixed(1)}s`,
  );
  const shots = report.results.flatMap((r) => r.screenshots);
  if (shots.length) lines.push(`screenshots: ${shots.join(', ')}`);
  return lines.join('\n');
}
