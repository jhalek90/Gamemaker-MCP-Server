/**
 * Transactional writes over a GameMaker project.
 *
 * A transaction collects every file it intends to change, validates the lot,
 * snapshots the current state, then flushes in one burst. Nothing reaches disk
 * until the whole change set is known to be good.
 *
 * Batching is not just tidiness. Creating a single object touches the `.yy`,
 * the `.yyp` resource list, `.resource_order` and each event `.gml`; written
 * one at a time with the IDE open, GameMaker prompts to reload after each and
 * can reload a half-created resource. One burst is one coherent change.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { isYyDocument, YyDoc } from '../yy/index.js';
import { ShadowGit, type Snapshot } from './shadow.js';

export class TransactionError extends Error {
  constructor(
    message: string,
    readonly path?: string,
  ) {
    super(path ? `${message} (${path})` : message);
    this.name = 'TransactionError';
  }
}

export interface CommitResult {
  /** Snapshot recording the state before this transaction. */
  snapshot: string;
  written: string[];
  deleted: string[];
}

/** `null` marks a deletion. */
type PendingWrite = string | null;

export class Transaction {
  private readonly pending = new Map<string, PendingWrite>();
  private done = false;

  constructor(
    private readonly workspace: Workspace,
    readonly label: string,
  ) {}

  /** Queue a file write. Later writes to the same path replace earlier ones. */
  write(path: string, text: string): this {
    return this.stage(path, text);
  }

  /** Queue a `.yy` document write, using its preserved text. */
  writeDoc(path: string, doc: YyDoc): this {
    return this.stage(path, doc.text);
  }

  /** Queue a file deletion. */
  delete(path: string): this {
    return this.stage(path, null);
  }

  /**
   * Read a file as this transaction currently sees it — pending writes first,
   * then disk. Lets several steps build on each other before anything lands.
   */
  read(path: string): string | undefined {
    const key = this.workspace.normalize(path);
    if (this.pending.has(key)) return this.pending.get(key) ?? undefined;
    const absolute = this.workspace.resolve(key);
    return existsSync(absolute) ? readFileSync(absolute, 'utf8') : undefined;
  }

  /** Read a `.yy` file as a document, through pending writes. */
  readDoc(path: string): YyDoc | undefined {
    const text = this.read(path);
    return text === undefined ? undefined : YyDoc.parse(text);
  }

  /** Paths this transaction will touch, in sorted order. */
  get paths(): string[] {
    return [...this.pending.keys()].sort();
  }

  get isEmpty(): boolean {
    return this.pending.size === 0;
  }

  private stage(path: string, content: PendingWrite): this {
    if (this.done) throw new TransactionError('Transaction is already finished');
    this.pending.set(this.workspace.normalize(path), content);
    return this;
  }

  /**
   * Validate, snapshot, then apply. If applying fails part way through, the
   * snapshot is restored before the error propagates, so the project is never
   * left half-written.
   */
  commit(): CommitResult {
    if (this.done) throw new TransactionError('Transaction is already finished');
    this.done = true;

    const paths = this.paths;
    if (paths.length === 0) {
      // An operation that found nothing to do is a legitimate outcome, not a
      // failure: ejecting a bridge from a project that never had one should
      // report that, not throw. No snapshot is taken because nothing changed.
      return { snapshot: '', written: [], deleted: [] };
    }

    this.validate();

    const created = paths.filter(
      (p) => this.pending.get(p) !== null && !existsSync(this.workspace.resolve(p)),
    );
    const snapshot = this.workspace.shadow.snapshot(paths, created, this.label);

    const written: string[] = [];
    const deleted: string[] = [];
    try {
      for (const path of paths) {
        const absolute = this.workspace.resolve(path);
        const content = this.pending.get(path)!;
        if (content === null) {
          rmSync(absolute, { force: true });
          // A resource lives in its own folder. Deleting only the files would
          // leave an empty directory that GameMaker still shows in the asset
          // browser.
          pruneEmptyDirs(this.workspace.root, absolute);
          deleted.push(path);
        } else {
          mkdirSync(dirname(absolute), { recursive: true });
          writeFileSync(absolute, content, 'utf8');
          written.push(path);
        }
      }
    } catch (error) {
      // Put everything back before surfacing the failure.
      this.workspace.shadow.restore({
        id: snapshot,
        label: this.label,
        time: new Date(),
        paths,
        created,
      });
      throw new TransactionError(
        `Failed to apply transaction, rolled back: ${(error as Error).message}`,
      );
    }

    return { snapshot, written, deleted };
  }

  /** Discard the transaction without touching disk. */
  abort(): void {
    this.pending.clear();
    this.done = true;
  }

  /**
   * Reject a change set before any of it lands. A `.yy` file that does not
   * parse would be corrupt on disk, and GameMaker would refuse to load the
   * project — the exact failure this layer exists to prevent.
   */
  private validate(): void {
    for (const [path, content] of this.pending) {
      if (content === null) continue;
      if (!/\.(yy|yyp)$/i.test(path)) continue;
      if (!isYyDocument(content)) {
        throw new TransactionError('Refusing to write a non-JSON .yy container', path);
      }
      try {
        YyDoc.parse(content);
      } catch (error) {
        throw new TransactionError(
          `Refusing to write malformed .yy: ${(error as Error).message}`,
          path,
        );
      }
    }
  }
}

/**
 * Remove directories left empty by a deletion, walking up towards `root`.
 * Stops at the first non-empty directory, and never removes `root` itself.
 */
export function pruneEmptyDirs(root: string, from: string): void {
  const stop = resolve(root);
  let dir = dirname(resolve(from));
  while (dir !== stop && dir.startsWith(stop + sep)) {
    try {
      if (readdirSync(dir).length > 0) break;
      rmdirSync(dir);
    } catch {
      break;
    }
    dir = dirname(dir);
  }
}

export class Workspace {
  private constructor(
    readonly root: string,
    readonly shadow: ShadowGit,
  ) {}

  static open(root: string): Workspace {
    const absolute = resolve(root);
    if (!existsSync(absolute)) throw new TransactionError(`No such directory: ${absolute}`);
    return new Workspace(absolute, ShadowGit.open(absolute));
  }

  /** Start a transaction. `label` names the restore point. */
  begin(label: string): Transaction {
    return new Transaction(this, label);
  }

  /**
   * Run `body` in a transaction and commit it. If `body` throws, the
   * transaction is abandoned without touching disk.
   */
  transact<T>(label: string, body: (tx: Transaction) => T): T {
    const tx = this.begin(label);
    let result: T;
    try {
      result = body(tx);
    } catch (error) {
      tx.abort();
      throw error;
    }
    tx.commit();
    return result;
  }

  /** Project-relative, forward-slashed, and guaranteed inside the project. */
  normalize(path: string): string {
    const absolute = isAbsolute(path) ? resolve(path) : resolve(this.root, path);
    const rel = relative(this.root, absolute);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      throw new TransactionError('Path escapes the project root', path);
    }
    return rel.split(sep).join('/');
  }

  resolve(path: string): string {
    return join(this.root, path);
  }

  /** Restore points, newest first. */
  history(limit = 20): Snapshot[] {
    return this.shadow.list(limit);
  }

  /**
   * Undo the most recent transaction. Repeatable: each call steps one further
   * back through the history.
   */
  undo(): Snapshot | undefined {
    const snapshot = this.shadow.latest();
    if (!snapshot) return undefined;
    this.shadow.restore(snapshot);
    return snapshot;
  }
}
