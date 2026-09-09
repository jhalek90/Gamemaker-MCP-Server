/**
 * Locate installed GameMaker runtimes.
 *
 * Everything version-specific — the GML spec, the Igor build tool — lives
 * inside a runtime directory, so nothing here is hardcoded. A machine can have
 * an IDE version that differs from its cached runtimes, which is why the
 * runtime is discovered rather than inferred from the IDE.
 */

import { existsSync, readdirSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

export interface GmRuntime {
  /** e.g. `2024.14.4.268` */
  version: string;
  /** Absolute path to the runtime directory. */
  path: string;
  /** Absolute path to `GmlSpec.xml`. */
  specPath: string;
  /** Absolute path to `Igor`, when it can be found. */
  igorPath?: string;
  /** True for a Long Term Support install. */
  lts: boolean;
}

export class RuntimeNotFoundError extends Error {
  constructor(searched: string[]) {
    super(
      'No GameMaker runtime found. Set GML_MCP_RUNTIME to a runtime directory. ' +
        `Searched: ${searched.join(', ')}`,
    );
    this.name = 'RuntimeNotFoundError';
  }
}

/** Directories GameMaker caches runtimes in, per platform. */
export function runtimeSearchPaths(): { path: string; lts: boolean }[] {
  const os = platform();
  if (os === 'win32') {
    const programData = process.env.ProgramData ?? 'C:/ProgramData';
    return [
      { path: join(programData, 'GameMakerStudio2', 'Cache', 'runtimes'), lts: false },
      { path: join(programData, 'GameMakerStudio2-LTS', 'Cache', 'runtimes'), lts: true },
    ];
  }
  if (os === 'darwin') {
    return [
      { path: '/Users/Shared/GameMakerStudio2/Cache/runtimes', lts: false },
      { path: '/Users/Shared/GameMakerStudio2-LTS/Cache/runtimes', lts: true },
    ];
  }
  return [
    { path: join(homedir(), '.local/share/GameMakerStudio2/Cache/runtimes'), lts: false },
    { path: join(homedir(), '.local/share/GameMakerStudio2-LTS/Cache/runtimes'), lts: true },
  ];
}

/**
 * Igor moved between releases, so probe rather than assume. Newer runtimes use
 * `bin/igor/<os>/<arch>/Igor.exe`; older ones put it directly in `bin`.
 */
function findIgor(runtimePath: string): string | undefined {
  const os = platform();
  const folder = os === 'win32' ? 'windows' : os === 'darwin' ? 'osx' : 'ubuntu';
  const executable = os === 'win32' ? 'Igor.exe' : 'Igor';
  const candidates = [
    join(runtimePath, 'bin', 'igor', folder, 'x64', executable),
    join(runtimePath, 'bin', 'igor', folder, 'arm64', executable),
    join(runtimePath, 'bin', 'igor', folder, executable),
    join(runtimePath, 'bin', executable),
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

function describe(runtimePath: string, lts: boolean): GmRuntime | undefined {
  const specPath = join(runtimePath, 'GmlSpec.xml');
  if (!existsSync(specPath)) return undefined;
  const folder = runtimePath.split(/[\\/]/).pop() ?? '';
  return {
    version: folder.startsWith('runtime-') ? folder.slice('runtime-'.length) : folder,
    path: runtimePath,
    specPath,
    igorPath: findIgor(runtimePath),
    lts,
  };
}

/** Compare dotted numeric versions, newest first. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const left = pa[i] ?? 0;
    const right = pb[i] ?? 0;
    if (Number.isNaN(left) || Number.isNaN(right)) return a.localeCompare(b);
    if (left !== right) return right - left;
  }
  return 0;
}

/** Every runtime we can find, newest first. */
export function findRuntimes(): GmRuntime[] {
  const override = process.env.GML_MCP_RUNTIME;
  if (override) {
    const described = describe(override, /-LTS/i.test(override));
    return described ? [described] : [];
  }

  const found: GmRuntime[] = [];
  for (const { path, lts } of runtimeSearchPaths()) {
    if (!existsSync(path)) continue;
    for (const entry of readdirSync(path)) {
      const described = describe(join(path, entry), lts);
      if (described) found.push(described);
    }
  }
  return found.sort((a, b) => compareVersions(a.version, b.version));
}

/** The newest runtime, preferring non-LTS. Throws when none is installed. */
export function requireRuntime(): GmRuntime {
  const runtimes = findRuntimes();
  const chosen = runtimes.find((r) => !r.lts) ?? runtimes[0];
  if (!chosen) throw new RuntimeNotFoundError(runtimeSearchPaths().map((p) => p.path));
  return chosen;
}
