/**
 * A GameMaker project on disk: the `.yyp` graph and the resources it names.
 *
 * Reads go through the project; writes go through a `Transaction` obtained
 * from `project.workspace`, so a whole change set lands at once or not at all.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Workspace, type Transaction } from '../tx/index.js';
import { YyDoc, type YyPath } from '../yy/index.js';

/** Top-level directories GameMaker keeps resources in. */
export const RESOURCE_KINDS = [
  'animcurves',
  'extensions',
  'fonts',
  'notes',
  'objects',
  'particles',
  'paths',
  'rooms',
  'scripts',
  'sequences',
  'shaders',
  'sounds',
  'sprites',
  'tilesets',
  'timelines',
] as const;

export type ResourceKind = (typeof RESOURCE_KINDS)[number];

export interface ResourceRef {
  name: string;
  /** Project-relative path to the `.yy`, forward-slashed. */
  path: string;
  kind: ResourceKind;
}

/** A place where one resource points at another. */
export interface Reference {
  /** File containing the reference. */
  path: string;
  /** Path to the `{name, path}` object inside that file. */
  at: YyPath;
}

export class ProjectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectError';
  }
}

export class GmProject {
  private constructor(
    readonly root: string,
    /** Project-relative path of the `.yyp`. */
    readonly yypPath: string,
    readonly name: string,
    readonly workspace: Workspace,
  ) {}

  static open(root: string): GmProject {
    const workspace = Workspace.open(root);
    const yyp = readdirSync(workspace.root).filter((f) => f.endsWith('.yyp'));
    if (yyp.length === 0) throw new ProjectError(`No .yyp found in ${workspace.root}`);
    if (yyp.length > 1) throw new ProjectError(`Multiple .yyp files in ${workspace.root}`);
    return new GmProject(workspace.root, yyp[0]!, yyp[0]!.slice(0, -4), workspace);
  }

  /** Start a transaction. `label` names the restore point. */
  begin(label: string): Transaction {
    return this.workspace.begin(label);
  }

  /** Run `body` in a transaction and commit it. */
  transact<T>(label: string, body: (tx: Transaction) => T): T {
    return this.workspace.transact(label, body);
  }

  // -- files --------------------------------------------------------------

  /** Read a `.yy` document, seeing pending writes when a transaction is given. */
  readDoc(path: string, tx?: Transaction): YyDoc {
    const text = tx ? tx.read(path) : this.readText(path);
    if (text === undefined) throw new ProjectError(`No such file: ${path}`);
    return YyDoc.parse(text);
  }

  readText(path: string): string | undefined {
    const absolute = join(this.root, path);
    return existsSync(absolute) ? readFileSync(absolute, 'utf8') : undefined;
  }

  exists(path: string): boolean {
    return existsSync(join(this.root, path));
  }

  /** The project file. */
  yyp(tx?: Transaction): YyDoc {
    return this.readDoc(this.yypPath, tx);
  }

  /** `<project>.resource_order`, which newer GameMaker versions omit. */
  get resourceOrderPath(): string {
    return `${this.name}.resource_order`;
  }

  hasResourceOrder(tx?: Transaction): boolean {
    return tx
      ? tx.read(this.resourceOrderPath) !== undefined
      : this.exists(this.resourceOrderPath);
  }

  // -- resources ----------------------------------------------------------

  resources(tx?: Transaction): ResourceRef[] {
    const entries = this.yyp(tx).get(['resources']) as { id: { name: string; path: string } }[];
    return entries.map((entry) => ({
      name: entry.id.name,
      path: entry.id.path,
      kind: kindOfPath(entry.id.path),
    }));
  }

  find(name: string, tx?: Transaction): ResourceRef | undefined {
    return this.resources(tx).find((r) => r.name === name);
  }

  has(name: string, tx?: Transaction): boolean {
    return this.find(name, tx) !== undefined;
  }

  /** Every `.yy` in the project, project-relative. */
  yyFiles(): string[] {
    const out: string[] = [this.yypPath];
    for (const kind of RESOURCE_KINDS) {
      const dir = join(this.root, kind);
      if (!existsSync(dir)) continue;
      for (const entry of readdirSync(dir)) {
        const file = `${kind}/${entry}/${entry}.yy`;
        if (existsSync(join(this.root, file))) out.push(file);
      }
    }
    return out;
  }

  /**
   * The `$GMType` tag value used by resources of `resourceType` already in
   * this project.
   *
   * GameMaker versions the marker key per resource type and changes it over
   * time — `"$GMScript":"v1"` but `"$GMObject":""` in the same project, and
   * `"$GMSprite":"v2"` elsewhere. Copying what the project already uses beats
   * guessing from an IDE version number.
   */
  tagFor(resourceType: string, fallback = ''): string {
    let kind: ResourceKind | undefined;
    try {
      kind = kindOfResourceType(resourceType);
    } catch {
      // Not a top-level resource — `GMEvent`, for instance, lives inside an
      // object's eventList. Fall through to the nested search below.
      kind = undefined;
    }

    if (kind) {
      for (const ref of this.resources()) {
        if (ref.kind !== kind) continue;
        const text = this.readText(ref.path);
        if (text === undefined) continue;
        try {
          const value = YyDoc.parse(text).get([`$${resourceType}`]);
          if (typeof value === 'string') return value;
        } catch {
          continue;
        }
      }
      return fallback;
    }

    const marker = new RegExp(`"\\$${resourceType}":"([^"]*)"`);
    for (const file of this.yyFiles()) {
      const match = marker.exec(this.readText(file) ?? '');
      if (match) return match[1]!;
    }
    return fallback;
  }

  /** The `{name, path}` object a resource at the project root uses as parent. */
  rootFolderRef(): { name: string; path: string } {
    return { name: this.name, path: this.yypPath };
  }

  /** Asset-browser folders declared in the `.yyp`. */
  folders(tx?: Transaction): { name: string; path: string }[] {
    const entries = this.yyp(tx).get(['Folders']) as { name: string; folderPath: string }[];
    return entries.map((entry) => ({ name: entry.name, path: entry.folderPath }));
  }

  /**
   * Resolve a folder to the `{name, path}` a resource uses as its `parent`.
   *
   * Accepts `"Buildings"`, `"Buildings/Towers"` or the full
   * `"folders/Buildings.yy"`. Passing nothing parents to the project root.
   */
  folderRef(folder?: string, tx?: Transaction): { name: string; path: string } {
    if (!folder) return this.rootFolderRef();
    const path = normalizeFolderPath(folder);
    const known = this.folders(tx).find((f) => f.path === path);
    if (!known) {
      throw new ProjectError(
        `No such folder: ${path}. Create it first, or omit to use the project root.`,
      );
    }
    return { name: known.name, path: known.path };
  }

  // -- references ---------------------------------------------------------

  /**
   * Every place another resource points at `target`.
   *
   * References are always `{"name": ..., "path": ...}` objects — `spriteId`,
   * `parentObjectId`, `collisionObjectId`, room instance `objectId`, and so
   * on. Matching structurally on the path avoids the false positives a plain
   * text search would produce.
   */
  references(target: ResourceRef, options: { includeSelf?: boolean } = {}): Reference[] {
    const found: Reference[] = [];
    for (const file of this.yyFiles()) {
      if (!options.includeSelf && file === target.path) continue;
      const text = this.readText(file);
      // Cheap pre-filter: parsing every .yy in a large project is wasteful
      // when almost none of them mention the target.
      if (text === undefined || !text.includes(target.path)) continue;
      let doc: YyDoc;
      try {
        doc = YyDoc.parse(text);
      } catch {
        continue;
      }
      walkReferences(doc, [], target.path, found, file, file === this.yypPath);
    }
    return found;
  }
}

/**
 * `.yyp` sections that catalogue resources rather than point at them.
 *
 * `resources` holds each resource's own registration, which has the same
 * `{name, path}` shape as a real reference. Counting it would make every
 * resource look permanently referenced and block deletion.
 */
const YYP_CATALOGUE_SECTIONS = new Set([
  'resources',
  'Folders',
  'IncludedFiles',
  'AudioGroups',
  'TextureGroups',
]);

function walkReferences(
  doc: YyDoc,
  path: YyPath,
  targetPath: string,
  out: Reference[],
  file: string,
  isYyp: boolean,
): void {
  if (isYyp && path.length > 0 && YYP_CATALOGUE_SECTIONS.has(String(path[0]))) return;
  const node = doc.find(path);
  if (!node) return;
  if (node.kind === 'object') {
    const keys = node.members.map((m) => m.key);
    if (keys.includes('path') && keys.includes('name')) {
      if (doc.get([...path, 'path']) === targetPath) {
        out.push({ path: file, at: [...path] });
        return;
      }
    }
    for (const member of node.members) {
      walkReferences(doc, [...path, member.key], targetPath, out, file, isYyp);
    }
  } else if (node.kind === 'array') {
    for (let i = 0; i < node.elements.length; i++) {
      walkReferences(doc, [...path, i], targetPath, out, file, isYyp);
    }
  }
}

export function kindOfPath(path: string): ResourceKind {
  const kind = path.split('/')[0] as ResourceKind;
  if (!RESOURCE_KINDS.includes(kind)) {
    throw new ProjectError(`Unrecognised resource path: ${path}`);
  }
  return kind;
}

const KIND_BY_RESOURCE_TYPE: Record<string, ResourceKind> = {
  GMObject: 'objects',
  GMScript: 'scripts',
  GMSprite: 'sprites',
  GMRoom: 'rooms',
  GMSound: 'sounds',
  GMFont: 'fonts',
  GMShader: 'shaders',
  GMTileSet: 'tilesets',
  GMPath: 'paths',
  GMTimeline: 'timelines',
  GMNotes: 'notes',
  GMAnimCurve: 'animcurves',
  GMSequence: 'sequences',
  GMParticleSystem: 'particles',
  GMExtension: 'extensions',
};

export function kindOfResourceType(resourceType: string): ResourceKind {
  const kind = KIND_BY_RESOURCE_TYPE[resourceType];
  if (!kind) throw new ProjectError(`Unrecognised resource type: ${resourceType}`);
  return kind;
}

export function resourcePathFor(kind: ResourceKind, name: string): string {
  return `${kind}/${name}/${name}.yy`;
}

/** `Buildings` or `Buildings/Towers` or `folders/Buildings.yy` -> `folders/Buildings.yy`. */
export function normalizeFolderPath(folder: string): string {
  const trimmed = folder.replace(/^\/+|\/+$/g, '');
  const withoutPrefix = trimmed.startsWith('folders/') ? trimmed.slice('folders/'.length) : trimmed;
  const withoutSuffix = withoutPrefix.endsWith('.yy')
    ? withoutPrefix.slice(0, -'.yy'.length)
    : withoutPrefix;
  if (!withoutSuffix) throw new ProjectError(`Invalid folder path: ${folder}`);
  return `folders/${withoutSuffix}.yy`;
}

/** Leaf name of a folder path, e.g. `folders/A/B.yy` -> `B`. */
export function folderName(folderPath: string): string {
  return folderPath.slice(0, -'.yy'.length).split('/').pop()!;
}
