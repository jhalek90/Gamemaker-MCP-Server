/**
 * A git repository that shadows the project without being part of it.
 *
 * The repo lives at `.gml-mcp/shadow.git` with the project root as its work
 * tree. It records what the agent is about to change, so any transaction can
 * be rolled back, and gives `undo` real depth rather than a fixed number of
 * backup copies.
 *
 * Deliberately NOT the user's own repository. Running `git commit` inside
 * someone's working tree while they have their own staged changes is a bad
 * surprise, and `git stash` collisions are worse. A separate GIT_DIR costs
 * nothing and works identically whether or not the project is versioned.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pruneEmptyDirs } from './workspace.js';

/** Metadata recorded with each snapshot, carried in the commit body. */
export interface Snapshot {
  /** Commit hash. */
  id: string;
  label: string;
  time: Date;
  /** Project-relative paths this transaction touched. */
  paths: string[];
  /** Subset of `paths` that did not exist before the transaction. */
  created: string[];
}

const BRANCH = 'refs/heads/gml-mcp';
const TRAILER = 'gml-mcp-tx:';
/** Keep argument lists comfortably under the Windows command length limit. */
const PATHS_PER_CALL = 100;

export class GitUnavailableError extends Error {
  constructor(cause: string) {
    super(`git is required for undo support but could not be run: ${cause}`);
    this.name = 'GitUnavailableError';
  }
}

export class ShadowGit {
  private constructor(
    readonly root: string,
    readonly gitDir: string,
  ) {}

  /** Open the shadow repo for `root`, creating it on first use. */
  static open(root: string): ShadowGit {
    const gitDir = join(root, '.gml-mcp', 'shadow.git');
    const shadow = new ShadowGit(root, gitDir);
    if (!existsSync(gitDir)) shadow.initialize();
    return shadow;
  }

  private initialize(): void {
    mkdirSync(dirname(this.gitDir), { recursive: true });
    try {
      execFileSync('git', ['init', '--quiet', '--bare', this.gitDir], { stdio: 'ignore' });
    } catch (error) {
      throw new GitUnavailableError((error as Error).message);
    }
    // A bare repo refuses work-tree operations; we supply the work tree per
    // call, so clear the flag.
    this.git(['config', 'core.bare', 'false']);
    // Critical: git must not touch line endings. 39% of .yy files in the
    // reference corpus are CRLF, and autocrlf would rewrite them on restore.
    this.git(['config', 'core.autocrlf', 'false']);
    this.git(['config', 'core.safecrlf', 'false']);
    this.git(['config', 'user.name', 'GML_MCP']);
    this.git(['config', 'user.email', 'gml-mcp@localhost']);
    this.git(['symbolic-ref', 'HEAD', BRANCH]);
    writeFileSync(join(this.root, '.gml-mcp', '.gitignore'), '*\n');
  }

  private git(args: string[], encoding: 'utf8' | 'buffer' = 'utf8'): string | Buffer {
    return execFileSync('git', ['--git-dir', this.gitDir, '--work-tree', this.root, ...args], {
      cwd: this.root,
      encoding: encoding === 'utf8' ? 'utf8' : undefined,
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    }) as string | Buffer;
  }

  private text(args: string[]): string {
    return (this.git(args, 'utf8') as string).trim();
  }

  private tryText(args: string[]): string | undefined {
    try {
      return this.text(args);
    } catch {
      return undefined;
    }
  }

  /**
   * Record the CURRENT on-disk content of `paths` as a restore point.
   *
   * Called before a transaction writes anything, so the snapshot holds the
   * pre-edit state. `created` names paths that do not exist yet, which undo
   * removes rather than restores.
   */
  snapshot(paths: readonly string[], created: readonly string[], label: string): string {
    const present = paths.filter((p) => !created.includes(p) && existsSync(join(this.root, p)));
    for (let i = 0; i < present.length; i += PATHS_PER_CALL) {
      // -f because the project's own .gitignore is irrelevant here: we must
      // be able to restore anything we are about to overwrite.
      this.git(['add', '-f', '--', ...present.slice(i, i + PATHS_PER_CALL)]);
    }
    const meta = JSON.stringify({ paths: [...paths], created: [...created] });
    this.git(['commit', '--quiet', '--allow-empty', '-m', label, '-m', `${TRAILER} ${meta}`]);
    return this.text(['rev-parse', 'HEAD']);
  }

  /**
   * Snapshots, newest first.
   *
   * Commits are separated with NUL (`-z`) and fields by newline. Both the
   * subject and the body are written by `snapshot`, so neither contains a
   * newline and this stays unambiguous without exotic delimiters.
   */
  list(limit = 20): Snapshot[] {
    const out = this.tryText(['log', '-z', '--format=%H%n%aI%n%s%n%b', '-n', String(limit)]);
    if (!out) return [];
    return out
      .split('\0')
      .filter((entry) => entry.trim())
      .map((entry) => {
        const [id, time, label, ...body] = entry.trim().split('\n');
        const line = body.find((l) => l.trimStart().startsWith(TRAILER));
        let paths: string[] = [];
        let created: string[] = [];
        if (line) {
          try {
            const parsed = JSON.parse(line.trimStart().slice(TRAILER.length));
            paths = parsed.paths ?? [];
            created = parsed.created ?? [];
          } catch {
            // A commit whose metadata we cannot read restores nothing, which
            // is the safe direction to fail in.
          }
        }
        return { id: id!, label: label ?? '', time: new Date(time!), paths, created };
      });
  }

  latest(): Snapshot | undefined {
    return this.list(1)[0];
  }

  /**
   * Put the files named by `snapshot` back the way they were, then forget the
   * snapshot so a second undo reaches the one before it.
   */
  restore(snapshot: Snapshot): void {
    for (const path of snapshot.paths) {
      const absolute = join(this.root, path);
      if (snapshot.created.includes(path)) {
        rmSync(absolute, { force: true });
        pruneEmptyDirs(this.root, absolute);
        continue;
      }
      let content: Buffer;
      try {
        content = this.git(['cat-file', '-p', `${snapshot.id}:${path}`], 'buffer') as Buffer;
      } catch {
        // Not in the snapshot tree: nothing recorded, so leave it alone.
        continue;
      }
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, content);
    }
    this.drop(snapshot.id);
  }

  /** Move the branch back past `id`, without touching the work tree. */
  private drop(id: string): void {
    const parent = this.tryText(['rev-parse', `${id}^`]);
    if (parent) this.git(['update-ref', BRANCH, parent]);
    else this.git(['update-ref', '-d', BRANCH]);
  }

  /** Files changed by the snapshot, as a unified diff against its parent. */
  diff(id: string): string {
    return this.tryText(['diff', `${id}^`, id]) ?? '';
  }
}
