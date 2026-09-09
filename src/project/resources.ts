/**
 * Resource create / rename / delete, and object event editing.
 *
 * Every operation stages its work into a caller-supplied `Transaction`, so a
 * caller can compose several (create an object, add three events, register a
 * script) and have the whole set land in one burst — or not at all. Nothing
 * here writes to disk directly.
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Transaction } from '../tx/index.js';
import { comparePaths, emit, quote, type YyValue } from '../yy/index.js';
import {
  eventFileName,
  parseEventFileName,
  sameEvent,
  EVENT_TYPES,
  type GmEvent,
} from './events.js';
import {
  folderName,
  GmProject,
  normalizeFolderPath,
  ProjectError,
  resourcePathFor,
  type ResourceKind,
  type ResourceRef,
} from './project.js';

/** GameMaker resource names: letters, digits and underscore, not leading digit. */
const VALID_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function requireValidName(name: string): void {
  if (!VALID_NAME.test(name)) {
    throw new ProjectError(
      `Invalid resource name ${JSON.stringify(name)}: use letters, digits and underscore, not starting with a digit`,
    );
  }
}

function requireAbsent(project: GmProject, tx: Transaction, name: string): void {
  if (project.has(name, tx)) throw new ProjectError(`Resource already exists: ${name}`);
}

function requireResource(project: GmProject, tx: Transaction | undefined, name: string): ResourceRef {
  const ref = project.find(name, tx);
  if (!ref) throw new ProjectError(`No such resource: ${name}`);
  return ref;
}

// -- registration ---------------------------------------------------------

/**
 * Add a resource to the `.yyp` and, when the project has one, to
 * `.resource_order`.
 *
 * `resources` is kept sorted by path because GameMaker sorts it on save;
 * inserting anywhere else would show up as a diff the next time the IDE
 * writes the file.
 */
export function registerResource(project: GmProject, tx: Transaction, ref: ResourceRef): void {
  const yyp = project.yyp(tx);
  const paths = (yyp.get(['resources']) as { id: { path: string } }[]).map((r) => r.id.path);
  let index = paths.findIndex((p) => comparePaths(p, ref.path) > 0);
  if (index === -1) index = paths.length;
  yyp.insertAt(['resources'], index, { id: { name: ref.name, path: ref.path } });
  tx.writeDoc(project.yypPath, yyp);

  if (!project.hasResourceOrder(tx)) return;
  const order = project.readDoc(project.resourceOrderPath, tx);
  const entries = order.get(['ResourceOrderSettings']) as { order: number }[];
  const next = entries.reduce((max, e) => Math.max(max, e.order ?? 0), 0) + 1;
  order.push(['ResourceOrderSettings'], { name: ref.name, order: next, path: ref.path });
  tx.writeDoc(project.resourceOrderPath, order);
}

function unregisterResource(project: GmProject, tx: Transaction, ref: ResourceRef): void {
  const yyp = project.yyp(tx);
  const paths = (yyp.get(['resources']) as { id: { path: string } }[]).map((r) => r.id.path);
  const index = paths.indexOf(ref.path);
  if (index !== -1) {
    yyp.remove(['resources', index]);
    tx.writeDoc(project.yypPath, yyp);
  }

  if (!project.hasResourceOrder(tx)) return;
  const order = project.readDoc(project.resourceOrderPath, tx);
  const entries = order.get(['ResourceOrderSettings']) as { path: string }[];
  const at = entries.findIndex((e) => e.path === ref.path);
  if (at !== -1) {
    order.remove(['ResourceOrderSettings', at]);
    tx.writeDoc(project.resourceOrderPath, order);
  }
}

// -- creation -------------------------------------------------------------

export interface CreateObjectOptions {
  /** Sprite resource name to assign. */
  sprite?: string;
  /** Parent object resource name. */
  parentObject?: string;
  persistent?: boolean;
  visible?: boolean;
  solid?: boolean;
  /** Event code, keyed by event. */
  events?: { event: GmEvent; code: string }[];
  /** Asset-browser folder, e.g. `Enemies` or `Actors/Enemies`. */
  folder?: string;
}

export function createObject(
  project: GmProject,
  tx: Transaction,
  name: string,
  options: CreateObjectOptions = {},
): ResourceRef {
  requireValidName(name);
  requireAbsent(project, tx, name);

  const ref: ResourceRef = { name, path: resourcePathFor('objects', name), kind: 'objects' };
  const events = options.events ?? [];

  const yy: Record<string, YyValue> = {
    $GMObject: project.tagFor('GMObject'),
    '%Name': name,
    eventList: events.map((e) => eventEntry(project, e.event)),
    managed: true,
    name,
    overriddenProperties: [],
    parent: project.folderRef(options.folder, tx),
    parentObjectId: options.parentObject ? refTo(project, tx, options.parentObject) : null,
    persistent: options.persistent ?? false,
    physicsAngularDamping: 0.1,
    physicsDensity: 0.5,
    physicsFriction: 0.2,
    physicsGroup: 1,
    physicsKinematic: false,
    physicsLinearDamping: 0.1,
    physicsObject: false,
    physicsRestitution: 0.1,
    physicsSensor: false,
    physicsShape: 1,
    physicsShapePoints: [],
    physicsStartAwake: true,
    properties: [],
    resourceType: 'GMObject',
    resourceVersion: '2.0',
    solid: options.solid ?? false,
    spriteId: options.sprite ? refTo(project, tx, options.sprite) : null,
    spriteMaskId: null,
    visible: options.visible ?? true,
  };

  tx.write(ref.path, renderYy(yy));
  for (const { event, code } of events) {
    tx.write(`objects/${name}/${eventFileName(event)}`, code);
  }
  registerResource(project, tx, ref);
  return ref;
}

export function createScript(
  project: GmProject,
  tx: Transaction,
  name: string,
  code: string,
  options: { folder?: string } = {},
): ResourceRef {
  requireValidName(name);
  requireAbsent(project, tx, name);

  const ref: ResourceRef = { name, path: resourcePathFor('scripts', name), kind: 'scripts' };
  tx.write(
    ref.path,
    renderYy({
      $GMScript: project.tagFor('GMScript', 'v1'),
      '%Name': name,
      isCompatibility: false,
      isDnD: false,
      name,
      parent: project.folderRef(options.folder, tx),
      resourceType: 'GMScript',
      resourceVersion: '2.0',
    }),
  );
  tx.write(`scripts/${name}/${name}.gml`, code);
  registerResource(project, tx, ref);
  return ref;
}


/**
 * Create an asset-browser folder, and any parent folders it needs.
 *
 * Folders are declared only in the `.yyp`; the `folders/` directory itself is
 * not created on disk. GameMaker sorts `Folders` by path on save, so entries
 * are inserted in sorted position.
 */
export function createFolder(project: GmProject, tx: Transaction, folder: string): string {
  const path = normalizeFolderPath(folder);
  const yyp = project.yyp(tx);
  const existing = (yyp.get(['Folders']) as { folderPath: string }[]).map((f) => f.folderPath);
  if (existing.includes(path)) return path;

  // `Actors/Enemies` needs `Actors` to exist first.
  const segments = path.slice('folders/'.length, -'.yy'.length).split('/');
  const wanted: string[] = [];
  for (let i = 1; i <= segments.length; i++) {
    wanted.push(`folders/${segments.slice(0, i).join('/')}.yy`);
  }

  for (const target of wanted) {
    if (existing.includes(target)) continue;
    let index = existing.findIndex((p) => comparePaths(p, target) > 0);
    if (index === -1) index = existing.length;
    yyp.insertAt(['Folders'], index, {
      $GMFolder: project.tagFor('GMFolder'),
      '%Name': folderName(target),
      folderPath: target,
      name: folderName(target),
      resourceType: 'GMFolder',
      resourceVersion: '2.0',
    });
    existing.splice(index, 0, target);
  }
  tx.writeDoc(project.yypPath, yyp);
  return path;
}

// -- events ---------------------------------------------------------------

function eventEntry(project: GmProject, event: GmEvent): YyValue {
  const collision =
    event.type === EVENT_TYPES.Collision && event.collisionWith
      ? { name: event.collisionWith, path: resourcePathFor('objects', event.collisionWith) }
      : null;
  return {
    $GMEvent: project.tagFor('GMEvent', 'v1'),
    '%Name': '',
    collisionObjectId: collision,
    eventNum: event.number,
    eventType: event.type,
    isDnD: false,
    name: '',
    resourceType: 'GMEvent',
    resourceVersion: '2.0',
  };
}

/** Add an event to an object, or replace its code if it already exists. */
export function addEvent(
  project: GmProject,
  tx: Transaction,
  objectName: string,
  event: GmEvent,
  code: string,
): void {
  const ref = requireResource(project, tx, objectName);
  if (ref.kind !== 'objects') throw new ProjectError(`${objectName} is not an object`);
  if (event.type === EVENT_TYPES.Collision && !event.collisionWith) {
    throw new ProjectError('Collision events need the other object name');
  }

  const doc = project.readDoc(ref.path, tx);
  const existing = (doc.get(['eventList']) as EventListEntry[]).findIndex((entry) =>
    sameEvent(toEvent(entry), event),
  );
  if (existing === -1) {
    doc.push(['eventList'], eventEntry(project, event));
    tx.writeDoc(ref.path, doc);
  }
  tx.write(`objects/${objectName}/${eventFileName(event)}`, code);
}

export function removeEvent(
  project: GmProject,
  tx: Transaction,
  objectName: string,
  event: GmEvent,
): void {
  const ref = requireResource(project, tx, objectName);
  const doc = project.readDoc(ref.path, tx);
  const index = (doc.get(['eventList']) as EventListEntry[]).findIndex((entry) =>
    sameEvent(toEvent(entry), event),
  );
  if (index === -1) throw new ProjectError(`${objectName} has no ${eventFileName(event)}`);
  doc.remove(['eventList', index]);
  tx.writeDoc(ref.path, doc);
  tx.delete(`objects/${objectName}/${eventFileName(event)}`);
}

interface EventListEntry {
  eventType: number;
  eventNum: number;
  collisionObjectId: { name: string } | null;
}

function toEvent(entry: EventListEntry): GmEvent {
  return {
    type: entry.eventType,
    number: entry.eventNum,
    collisionWith: entry.collisionObjectId?.name,
  };
}

/** Events an object currently defines. */
export function listEvents(project: GmProject, objectName: string, tx?: Transaction): GmEvent[] {
  const ref = requireResource(project, tx, objectName);
  const doc = project.readDoc(ref.path, tx);
  return (doc.get(['eventList']) as EventListEntry[]).map(toEvent);
}

// -- sprites --------------------------------------------------------------

export interface SpriteProperties {
  /** 0 top-left, 1 top-centre, ... 4 centre, 9 custom. */
  origin?: number;
  /** 0 automatic, 1 full image, 2 manual. */
  bboxMode?: number;
  /** 0 precise, 1 rectangle, 2 ellipse, 3 diamond. */
  collisionKind?: number;
  collisionTolerance?: number;
  bbox?: { left: number; top: number; right: number; bottom: number };
}

/**
 * Edit a sprite's collision and origin settings.
 *
 * Creating sprites is deliberately not here: it needs frame and layer GUIDs,
 * PNGs written to two places, and a large `sequence` block, and there is no
 * way to exercise that end to end until there is an image pipeline feeding it.
 */
export function setSpriteProperties(
  project: GmProject,
  tx: Transaction,
  name: string,
  properties: SpriteProperties,
): void {
  const ref = requireResource(project, tx, name);
  if (ref.kind !== 'sprites') throw new ProjectError(`${name} is not a sprite`);
  const doc = project.readDoc(ref.path, tx);

  if (properties.origin !== undefined) doc.set(['origin'], properties.origin);
  if (properties.bboxMode !== undefined) doc.set(['bboxMode'], properties.bboxMode);
  if (properties.collisionKind !== undefined) doc.set(['collisionKind'], properties.collisionKind);
  if (properties.collisionTolerance !== undefined) {
    doc.set(['collisionTolerance'], properties.collisionTolerance);
  }
  if (properties.bbox) {
    doc.set(['bbox_left'], properties.bbox.left);
    doc.set(['bbox_top'], properties.bbox.top);
    doc.set(['bbox_right'], properties.bbox.right);
    doc.set(['bbox_bottom'], properties.bbox.bottom);
  }
  tx.writeDoc(ref.path, doc);
}

// -- delete and rename ----------------------------------------------------

export interface DeleteOptions {
  /**
   * Delete even though other resources still point at it. Those references
   * are left dangling, which GameMaker reports as a broken project.
   */
  force?: boolean;
}

export function deleteResource(
  project: GmProject,
  tx: Transaction,
  name: string,
  options: DeleteOptions = {},
): void {
  const ref = requireResource(project, tx, name);
  const referrers = project.references(ref);
  if (referrers.length && !options.force) {
    const where = [...new Set(referrers.map((r) => r.path))].slice(0, 5).join(', ');
    throw new ProjectError(
      `${name} is still referenced by ${referrers.length} place(s): ${where}. ` +
        'Pass force to delete anyway.',
    );
  }
  for (const file of resourceFiles(project, ref)) tx.delete(file);
  unregisterResource(project, tx, ref);
}

/**
 * Rename a resource and every reference to it.
 *
 * Touches the resource's own `.yy` (`name` and `%Name`), its folder and file
 * names, the `.yyp` entry, `.resource_order`, and the `{name, path}` object at
 * every referring site. All in one transaction, because a rename that lands
 * half-way leaves the project unloadable.
 */
export function renameResource(
  project: GmProject,
  tx: Transaction,
  oldName: string,
  newName: string,
): ResourceRef {
  requireValidName(newName);
  const ref = requireResource(project, tx, oldName);
  requireAbsent(project, tx, newName);

  const next: ResourceRef = {
    name: newName,
    path: resourcePathFor(ref.kind, newName),
    kind: ref.kind,
  };

  // Rewrite references first, while the old path still resolves.
  for (const reference of project.references(ref)) {
    const doc = project.readDoc(reference.path, tx);
    doc.set([...reference.at, 'name'], newName);
    doc.set([...reference.at, 'path'], next.path);
    tx.writeDoc(reference.path, doc);
  }

  for (const file of resourceFiles(project, ref)) {
    const contents = tx.read(file);
    if (contents === undefined) continue;
    tx.delete(file);
    tx.write(renamedPath(file, ref, next), contents);
  }

  const doc = project.readDoc(next.path, tx);
  doc.set(['name'], newName);
  if (doc.has(['%Name'])) doc.set(['%Name'], newName);
  // A sprite's embedded sequence carries the sprite's name too.
  if (doc.has(['sequence', 'name'])) doc.set(['sequence', 'name'], newName);
  if (doc.has(['sequence', '%Name'])) doc.set(['sequence', '%Name'], newName);
  tx.writeDoc(next.path, doc);

  unregisterResource(project, tx, ref);
  registerResource(project, tx, next);
  return next;
}

/** Files belonging to a resource: its folder contents, project-relative. */
function resourceFiles(project: GmProject, ref: ResourceRef): string[] {
  const folder = `${ref.kind}/${ref.name}`;
  const out: string[] = [];
  const walk = (relative: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(join(project.root, relative), { withFileTypes: true }).map((e) =>
        e.isDirectory() ? `${e.name}/` : e.name,
      );
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.endsWith('/')) walk(`${relative}/${entry.slice(0, -1)}`);
      else out.push(`${relative}/${entry}`);
    }
  };
  walk(folder);
  return out;
}

/** Map a file inside the old resource folder to its path under the new name. */
function renamedPath(file: string, from: ResourceRef, to: ResourceRef): string {
  const rest = file.slice(`${from.kind}/${from.name}/`.length);
  // The .yy, and a script's .gml, are named after the resource. Event files
  // and sprite frame PNGs are not.
  const renamedLeaf =
    rest === `${from.name}.yy`
      ? `${to.name}.yy`
      : rest === `${from.name}.gml`
        ? `${to.name}.gml`
        : rest;
  return `${to.kind}/${to.name}/${renamedLeaf}`;
}

// -- helpers --------------------------------------------------------------

function refTo(project: GmProject, tx: Transaction, name: string): YyValue {
  const ref = requireResource(project, tx, name);
  return { name: ref.name, path: ref.path };
}

/**
 * Render a whole new `.yy` file.
 *
 * Top-level members go one per line, which is what GameMaker writes for the
 * root object of every current-format resource. Nested values use the shared
 * emitter. Exact layout matters less here than anywhere else: the file is new,
 * so there is no prior formatting to preserve, and the IDE normalizes it on
 * the next save.
 */
function renderYy(members: Record<string, YyValue>): string {
  const lines = ['{'];
  for (const [key, value] of Object.entries(members)) {
    lines.push(`  ${quote(key)}:${emit(value, { eol: '\n', indent: '  ' })},`);
  }
  lines.push('}');
  return lines.join('\n');
}
