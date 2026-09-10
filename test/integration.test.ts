/**
 * Exercise resource operations against a real GameMaker project.
 *
 * The fixture in `project.test.ts` is hand-written and therefore agrees with
 * our assumptions by construction. This runs the same operations over a copy
 * of an actual project, which does not.
 *
 *   GML_MCP_SAMPLE_PROJECT=/path/to/a/GameMakerProject npm test
 */

import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createFolder,
  createObject,
  createScript,
  deleteResource,
  Events,
  GmProject,
  renameResource,
} from '../src/project/index.js';
import { YyDoc } from '../src/yy/index.js';

const SAMPLE = process.env.GML_MCP_SAMPLE_PROJECT;

let root: string;
let project: GmProject;

function read(path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

/** Every file in the project, with its bytes, for exact before/after compare. */
function snapshotTree(dir = root, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.gml-mcp') continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      for (const [k, v] of snapshotTree(join(dir, entry.name), relative)) out.set(k, v);
    } else {
      out.set(relative, readFileSync(join(dir, entry.name), 'base64'));
    }
  }
  return out;
}

beforeEach(() => {
  if (!SAMPLE) return;
  root = mkdtempSync(join(tmpdir(), 'gml-mcp-sample-'));
  cpSync(SAMPLE, root, { recursive: true });
  project = GmProject.open(root);
});

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe.skipIf(!SAMPLE)(`real project (${SAMPLE ?? 'unset'})`, () => {
  it('opens and lists resources', () => {
    expect(project.resources().length).toBeGreaterThan(0);
    expect(project.yypPath.endsWith('.yyp')).toBe(true);
  });

  it('adds an object with events and leaves every other file untouched', () => {
    const before = snapshotTree();
    project.transact('add obj_bridge', (tx) => {
      createObject(project, tx, 'obj_bridge', {
        events: [
          { event: Events.create(), code: 'server = network_create_server_raw(1, 5959, 4);\n' },
          { event: Events.step(), code: '// poll\n' },
        ],
      });
    });

    const after = snapshotTree();
    const added = [...after.keys()].filter((k) => !before.has(k));
    const changed = [...after.keys()].filter((k) => before.has(k) && before.get(k) !== after.get(k));

    expect(added.sort()).toEqual([
      'objects/obj_bridge/Create_0.gml',
      'objects/obj_bridge/Step_0.gml',
      'objects/obj_bridge/obj_bridge.yy',
    ]);
    // Only the project registry files may change.
    expect(changed.sort()).toEqual(
      [project.yypPath, project.resourceOrderPath].filter((p) => before.has(p)).sort(),
    );
    expect(project.has('obj_bridge')).toBe(true);
  });

  it('produces a .yy GameMaker would accept', () => {
    project.transact('add', (tx) => createObject(project, tx, 'obj_probe'));
    const created = YyDoc.parse(read('objects/obj_probe/obj_probe.yy'));
    const existing = project.resources().find((r) => r.kind === 'objects' && r.name !== 'obj_probe');

    expect(created.get(['resourceType'])).toBe('GMObject');
    expect(created.get(['name'])).toBe('obj_probe');
    if (existing) {
      // The generated file should carry the same marker tag the project uses.
      // Its `parent` is NOT compared: projects using folders park objects in
      // different folders, and a new resource defaults to the project root.
      const sample = YyDoc.parse(read(existing.path));
      expect(created.get(['$GMObject'])).toBe(sample.get(['$GMObject']));
    }
    expect(created.get(['parent', 'path'])).toBe(project.yypPath);
  });

  it('places a resource in a folder when asked', () => {
    project.transact('foldered', (tx) => {
      createFolder(project, tx, 'AgentBuilt/Bridge');
      createObject(project, tx, 'obj_foldered', { folder: 'AgentBuilt/Bridge' });
    });

    const yy = YyDoc.parse(read('objects/obj_foldered/obj_foldered.yy'));
    expect(yy.get(['parent', 'path'])).toBe('folders/AgentBuilt/Bridge.yy');
    expect(yy.get(['parent', 'name'])).toBe('Bridge');

    // Both the folder and its parent are declared, in sorted position.
    const folders = project.folders().map((f) => f.path);
    expect(folders).toContain('folders/AgentBuilt.yy');
    expect(folders).toContain('folders/AgentBuilt/Bridge.yy');
    expect(folders).toEqual([...folders].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())));
  });

  it('rejects an unknown folder rather than inventing one', () => {
    expect(() =>
      project.transact('bad folder', (tx) =>
        createObject(project, tx, 'obj_nowhere', { folder: 'DoesNotExist' }),
      ),
    ).toThrow(/No such folder/);
  });

  it('renames a resource and rewrites every reference', () => {
    // Prefer something other resources point at, so the rewrite is exercised.
    const all = project.resources();
    const target = all.find((r) => project.references(r).length > 0) ?? all[0];
    if (!target) return; // an empty project has nothing to rename
    const renamed = `${target.name}_renamed`;
    const referrers = project.references(target).map((r) => r.path);

    project.transact('rename', (tx) => renameResource(project, tx, target.name, renamed));

    expect(existsSync(join(root, `${target.kind}/${target.name}`))).toBe(false);
    expect(project.has(renamed)).toBe(true);
    expect(project.has(target.name)).toBe(false);
    for (const file of referrers) {
      expect(read(file)).not.toContain(target.path);
      expect(read(file)).toContain(`${target.kind}/${renamed}/${renamed}.yy`);
    }
  });

  it('restores the project byte-for-byte after undo', () => {
    const before = snapshotTree();

    project.transact('churn', (tx) => {
      createObject(project, tx, 'obj_temp', { events: [{ event: Events.create(), code: 'x=0;\n' }] });
      createScript(project, tx, 'scr_temp', 'function tmp() {}\n');
    });
    expect(snapshotTree().size).toBeGreaterThan(before.size);

    project.workspace.undo();

    const after = snapshotTree();
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
    for (const [path, bytes] of before) expect(after.get(path)).toBe(bytes);
  });

  it('refuses to delete a resource that is still referenced', () => {
    const referenced = project
      .resources()
      .find((r) => project.references(r).length > 0);
    if (!referenced) return;
    expect(() =>
      project.transact('delete', (tx) => deleteResource(project, tx, referenced.name)),
    ).toThrow(/still referenced/);
  });
});
