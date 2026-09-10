/**
 * Driving Igor, GameMaker's build tool.
 *
 * The CLI is undocumented and shifts between releases, so options are probed
 * from Igor's own usage output rather than assumed. Two findings from probing
 * the 2024.14 runtime shaped this:
 *
 *   - `windows Package` does NOT compile. It exits 0 with a syntax error
 *     present and produces nothing. `windows PackageZip` is the cheapest
 *     command that actually runs the asset compiler.
 *   - A clean VM build of a small project takes about 3 seconds, which is
 *     fast enough to sit inside an edit loop.
 *
 * Builds use a cache and temp directory under `.gml-mcp/build/`, never the
 * IDE's. Sharing them means the agent and the open IDE fight over the same
 * files mid-build.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import type { GmProject } from '../project/index.js';
import { ProjectSymbols } from '../project/symbols.js';
import { requireRuntime, type GmRuntime } from '../spec/index.js';
import { parseBuildOutput, type BuildDiagnostic } from './diagnostics.js';

export class BuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BuildError';
  }
}

export interface BuildOptions {
  /** Project configuration, as named in the `.yyp`. */
  config?: string;
  runtime?: GmRuntime;
  /** VM builds far faster than YYC and needs no Visual Studio. */
  target?: 'VM' | 'YYC';
  /** GameMaker user folder, holding the licence. Detected when omitted. */
  userFolder?: string;
  timeoutMs?: number;
  /** Discard the build cache; slower, but rules out stale results. */
  ignoreCache?: boolean;
}

export interface BuildResult {
  ok: boolean;
  exitCode: number | null;
  diagnostics: BuildDiagnostic[];
  durationMs: number;
  /** Full combined stdout and stderr. */
  log: string;
  /** The command line, for reproducing a failure by hand. */
  command: string;
  timedOut: boolean;
}

/**
 * The user folder holding the GameMaker licence.
 *
 * Several may exist — GameMaker leaves an `unknownUser_unknownUserID` folder
 * behind — and only the signed-in one has `licence.plist`.
 */
export function findUserFolder(): string | undefined {
  const override = process.env.GML_MCP_USER_FOLDER;
  if (override) return existsSync(override) ? override : undefined;

  const os = platform();
  const roots =
    os === 'win32'
      ? [join(process.env.APPDATA ?? join(homedir(), 'AppData/Roaming'), 'GameMakerStudio2')]
      : os === 'darwin'
        ? [join(homedir(), '.config/GameMakerStudio2'), join(homedir(), 'Library/Application Support/GameMakerStudio2')]
        : [join(homedir(), '.config/GameMakerStudio2')];

  const candidates: string[] = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root)) {
      const path = join(root, entry);
      if (existsSync(join(path, 'local_settings.json'))) candidates.push(path);
    }
  }
  return (
    candidates.find((path) => existsSync(join(path, 'licence.plist'))) ?? candidates[0]
  );
}

export class IgorRunner {
  private constructor(
    readonly project: GmProject,
    readonly runtime: GmRuntime,
    readonly userFolder: string,
  ) {}

  static create(project: GmProject, options: BuildOptions = {}): IgorRunner {
    const runtime = options.runtime ?? requireRuntime();
    if (!runtime.igorPath) {
      throw new BuildError(
        `Runtime ${runtime.version} has no Igor executable. Reinstall the runtime from the IDE.`,
      );
    }
    const userFolder = options.userFolder ?? findUserFolder();
    if (!userFolder) {
      throw new BuildError(
        'No GameMaker user folder found. Sign in to the IDE once, or set GML_MCP_USER_FOLDER.',
      );
    }
    return new IgorRunner(project, runtime, userFolder);
  }

  /** Directory holding this project's agent-owned build artefacts. */
  get buildDir(): string {
    return join(this.project.root, '.gml-mcp', 'build');
  }

  /**
   * Compile the project and report diagnostics.
   *
   * Uses `PackageZip`, which is the cheapest command that actually invokes
   * the asset compiler — `Package` returns success without compiling.
   */
  async compile(options: BuildOptions = {}): Promise<BuildResult> {
    const cache = join(this.buildDir, 'cache');
    const temp = join(this.buildDir, 'temp');
    const out = join(this.buildDir, 'out');
    for (const directory of [cache, temp, out]) mkdirSync(directory, { recursive: true });
    const artefact = join(out, `${this.project.name}.zip`);

    const args = [
      `--project=${join(this.project.root, this.project.yypPath)}`,
      `--config=${options.config ?? 'Default'}`,
      `--rp=${this.runtime.path}`,
      `--user=${this.userFolder}`,
      `--cache=${cache}`,
      `--temp=${temp}`,
      `--of=${artefact}`,
      `--tf=${artefact}`,
      `-r`,
      options.target ?? 'VM',
    ];
    if (options.ignoreCache) args.push('--ic');
    args.push('--', workerName(), 'PackageZip');

    return this.invoke(args, options.timeoutMs ?? 10 * 60 * 1000);
  }

  private async invoke(args: string[], timeoutMs: number): Promise<BuildResult> {
    const igor = this.runtime.igorPath!;
    const started = Date.now();
    const command = [igor, ...args].map((part) => (part.includes(' ') ? `"${part}"` : part)).join(' ');

    return new Promise<BuildResult>((resolve) => {
      const child = spawn(igor, args, { cwd: this.project.root, windowsHide: true });
      let log = '';
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeoutMs);

      child.stdout.on('data', (chunk: Buffer) => (log += chunk.toString()));
      child.stderr.on('data', (chunk: Buffer) => (log += chunk.toString()));

      const finish = (exitCode: number | null): void => {
        clearTimeout(timer);
        let symbols: ProjectSymbols | undefined;
        try {
          symbols = ProjectSymbols.scan(this.project);
        } catch {
          symbols = undefined;
        }
        const diagnostics = parseBuildOutput(log, this.project, symbols);
        resolve({
          ok: exitCode === 0 && !timedOut && !diagnostics.some((d) => d.severity === 'error'),
          exitCode,
          diagnostics,
          durationMs: Date.now() - started,
          log,
          command,
          timedOut,
        });
      };

      child.on('error', (error) => {
        log += `\n${error.message}`;
        finish(null);
      });
      child.on('close', finish);
    });
  }
}

/** Igor's worker names are lowercase platform identifiers. */
function workerName(): string {
  const os = platform();
  if (os === 'darwin') return 'mac';
  if (os === 'linux') return 'linux';
  return 'windows';
}
