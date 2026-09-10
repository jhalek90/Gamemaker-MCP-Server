import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  bridgeProject,
  bridgeStatus,
  ejectBridge,
  injectBridge,
  loadManifest,
  BRIDGE_FOLDER,
  BRIDGE_PROTOCOL,
} from '../src/bridge/index.js';
import { GmProject, listEvents } from '../src/project/index.js';
import { checkProject, ProjectSymbols } from '../src/project/symbols.js';
import { GmlSpec, findRuntimes } from '../src/spec/index.js';

const SAMPLE = process.env.GML_MCP_SAMPLE_PROJECT;

let root: string;
let project: GmProject;

/** Every file with its bytes, for exact before/after comparison. */
function tree(dir = root, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.gml-mcp') continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      for (const [k, v] of tree(join(dir, entry.name), relative)) out.set(k, v);
    } else {
      out.set(relative, readFileSync(join(dir, entry.name), 'base64'));
    }
  }
  return out;
}

beforeEach(() => {
  if (!SAMPLE) return;
  root = mkdtempSync(join(tmpdir(), 'gml-mcp-bridge-'));
  cpSync(SAMPLE, root, { recursive: true });
  project = GmProject.open(root);
});

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('bridge source project', () => {
  it('has every resource the manifest names', () => {
    const manifest = loadManifest();
    const source = bridgeProject();
    for (const name of manifest.inject) {
      expect(source.has(name), `${name} should exist in the bridge project`).toBe(true);
    }
    expect(manifest.protocol).toBe(BRIDGE_PROTOCOL);
  });

  it('keeps development-only resources out of the inject list', () => {
    const manifest = loadManifest();
    // The dev scene draws test shapes and must never reach a user's game.
    expect(manifest.dev).toContain('obj_gmlmcp_devscene');
    for (const name of manifest.dev) expect(manifest.inject).not.toContain(name);
  });

  it.skipIf(findRuntimes().length === 0)('calls only functions that exist', () => {
    const source = bridgeProject();
    const spec = GmlSpec.load(findRuntimes()[0]!.specPath);
    const diagnostics = checkProject(source, spec, ProjectSymbols.scan(source));
    expect(diagnostics.map((d) => `${d.file}:${d.line} ${d.message}`)).toEqual([]);
  });
});

describe.skipIf(!SAMPLE)('injecting into a project', () => {
  it('reports status before and after', () => {
    expect(bridgeStatus(project).installed).toBe(false);
    project.transact('inject', (tx) => injectBridge(project, tx));
    expect(bridgeStatus(project).installed).toBe(true);
  });

  it('creates the resources and files it into a folder', () => {
    const created = project.transact('inject', (tx) => injectBridge(project, tx));
    expect(created).toContain('obj_gmlmcp_bridge');

    const object = project.readDoc('objects/obj_gmlmcp_bridge/obj_gmlmcp_bridge.yy');
    expect(object.get(['persistent'])).toBe(true);
    expect(object.get(['parent', 'path'])).toBe(`folders/${BRIDGE_FOLDER}.yy`);
    // Every event the source object defines should have come across.
    expect(listEvents(project, 'obj_gmlmcp_bridge')).toHaveLength(
      listEvents(bridgeProject(), 'obj_gmlmcp_bridge').length,
    );
  });

  it('adopts the target project conventions rather than copying .yy files', () => {
    project.transact('inject', (tx) => injectBridge(project, tx));
    const injected = project.readDoc('objects/obj_gmlmcp_bridge/obj_gmlmcp_bridge.yy');
    // Not a copy of the bridge project's file: the marker tag matches whatever
    // this project already uses, so a different GameMaker version stays happy.
    expect(injected.get(['$GMObject'])).toBe(project.tagFor('GMObject'));
  });

  it('restores the project byte-for-byte on eject', () => {
    const before = tree();
    project.transact('inject', (tx) => injectBridge(project, tx));
    expect(tree().size).toBeGreaterThan(before.size);

    project.transact('eject', (tx) => ejectBridge(project, tx));
    const after = tree();
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
    for (const [path, bytes] of before) expect(after.get(path), path).toBe(bytes);
  });

  it('is undoable like any other change', () => {
    const before = tree();
    project.transact('inject', (tx) => injectBridge(project, tx));
    project.workspace.undo();
    const after = tree();
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
    for (const [path, bytes] of before) expect(after.get(path), path).toBe(bytes);
  });

  it('re-injecting replaces the previous copy instead of duplicating it', () => {
    project.transact('inject', (tx) => injectBridge(project, tx));
    const first = tree();
    project.transact('re-inject', (tx) => injectBridge(project, tx));
    expect(bridgeStatus(project).installed).toBe(true);
    expect([...tree().keys()].sort()).toEqual([...first.keys()].sort());
  });

  it('refuses a partial bridge rather than guessing', () => {
    project.transact('inject', (tx) => injectBridge(project, tx));
    project.transact('break it', (tx) => {
      tx.delete('scripts/scr_gmlmcp_protocol/scr_gmlmcp_protocol.yy');
      const yyp = project.yyp(tx);
      const paths = (yyp.get(['resources']) as { id: { path: string } }[]).map((r) => r.id.path);
      yyp.remove(['resources', paths.indexOf('scripts/scr_gmlmcp_protocol/scr_gmlmcp_protocol.yy')]);
      tx.writeDoc(project.yypPath, yyp);
    });
    expect(() => project.transact('inject again', (tx) => injectBridge(project, tx))).toThrow(
      /partial bridge/,
    );
  });

  it('leaves nothing behind when never injected', () => {
    const before = tree();
    project.transact('eject', (tx) => ejectBridge(project, tx));
    expect([...tree().keys()].sort()).toEqual([...before.keys()].sort());
    expect(existsSync(join(root, 'objects/obj_gmlmcp_bridge'))).toBe(false);
  });
});
