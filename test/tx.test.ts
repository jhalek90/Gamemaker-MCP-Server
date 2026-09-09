import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TransactionError, Workspace } from '../src/tx/index.js';
import { YyDoc } from '../src/yy/index.js';

let root: string;
let workspace: Workspace;

const OBJECT_YY = '{\n  "$GMObject":"",\n  "%Name":"objCar",\n  "visible":true,\n}';

function seed(path: string, text: string): void {
  const absolute = join(root, path);
  mkdirSync(join(absolute, '..'), { recursive: true });
  writeFileSync(absolute, text);
}

function onDisk(path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'gml-mcp-tx-'));
  seed('objects/objCar/objCar.yy', OBJECT_YY);
  seed('objects/objCar/Step_0.gml', 'x += 1;\n');
  workspace = Workspace.open(root);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('transactions', () => {
  it('applies a multi-file change set', () => {
    const tx = workspace.begin('edit objCar');
    const doc = tx.readDoc('objects/objCar/objCar.yy')!;
    doc.set(['visible'], false);
    tx.writeDoc('objects/objCar/objCar.yy', doc);
    tx.write('objects/objCar/Step_0.gml', 'x += 2;\n');
    const result = tx.commit();

    expect(result.written).toHaveLength(2);
    expect(onDisk('objects/objCar/objCar.yy')).toContain('"visible":false');
    expect(onDisk('objects/objCar/Step_0.gml')).toBe('x += 2;\n');
  });

  it('writes nothing until commit', () => {
    const tx = workspace.begin('deferred');
    tx.write('objects/objCar/Step_0.gml', 'never;\n');
    expect(onDisk('objects/objCar/Step_0.gml')).toBe('x += 1;\n');
    tx.abort();
    expect(onDisk('objects/objCar/Step_0.gml')).toBe('x += 1;\n');
  });

  it('reads through pending writes so steps can build on each other', () => {
    const tx = workspace.begin('chained');
    tx.write('scripts/scr_new/scr_new.gml', 'function a() {}\n');
    expect(tx.read('scripts/scr_new/scr_new.gml')).toBe('function a() {}\n');
    const doc = tx.readDoc('objects/objCar/objCar.yy')!;
    expect(doc.get(['%Name'])).toBe('objCar');
  });

  it('creates parent directories', () => {
    workspace.begin('new script').write('scripts/scr_a/scr_a.gml', 'noop();\n').commit();
    expect(onDisk('scripts/scr_a/scr_a.gml')).toBe('noop();\n');
  });

  it('deletes files', () => {
    workspace.begin('remove').delete('objects/objCar/Step_0.gml').commit();
    expect(existsSync(join(root, 'objects/objCar/Step_0.gml'))).toBe(false);
  });

  it('rejects a malformed .yy before anything lands', () => {
    const tx = workspace.begin('bad');
    tx.write('objects/objCar/objCar.yy', '{ "unterminated": ');
    tx.write('objects/objCar/Step_0.gml', 'should_not_land();\n');
    expect(() => tx.commit()).toThrow(TransactionError);
    expect(onDisk('objects/objCar/objCar.yy')).toBe(OBJECT_YY);
    expect(onDisk('objects/objCar/Step_0.gml')).toBe('x += 1;\n');
  });

  it('refuses paths outside the project', () => {
    expect(() => workspace.begin('escape').write('../evil.txt', 'x')).toThrow(TransactionError);
  });

  it('refuses to be reused after commit', () => {
    const tx = workspace.begin('once');
    tx.write('a.gml', 'x;\n');
    tx.commit();
    expect(() => tx.write('b.gml', 'y;\n')).toThrow(TransactionError);
  });
});

describe('undo', () => {
  it('restores modified files', () => {
    workspace.begin('change').write('objects/objCar/Step_0.gml', 'x += 99;\n').commit();
    expect(onDisk('objects/objCar/Step_0.gml')).toBe('x += 99;\n');

    const undone = workspace.undo();
    expect(undone?.label).toBe('change');
    expect(onDisk('objects/objCar/Step_0.gml')).toBe('x += 1;\n');
  });

  it('removes files the transaction created', () => {
    workspace.begin('add').write('scripts/scr_new/scr_new.gml', 'fn();\n').commit();
    expect(existsSync(join(root, 'scripts/scr_new/scr_new.gml'))).toBe(true);

    workspace.undo();
    expect(existsSync(join(root, 'scripts/scr_new/scr_new.gml'))).toBe(false);
  });

  it('restores files the transaction deleted', () => {
    workspace.begin('drop').delete('objects/objCar/Step_0.gml').commit();
    expect(existsSync(join(root, 'objects/objCar/Step_0.gml'))).toBe(false);

    workspace.undo();
    expect(onDisk('objects/objCar/Step_0.gml')).toBe('x += 1;\n');
  });

  it('steps back through several transactions', () => {
    workspace.begin('first').write('objects/objCar/Step_0.gml', 'v1;\n').commit();
    workspace.begin('second').write('objects/objCar/Step_0.gml', 'v2;\n').commit();
    workspace.begin('third').write('objects/objCar/Step_0.gml', 'v3;\n').commit();
    expect(onDisk('objects/objCar/Step_0.gml')).toBe('v3;\n');

    expect(workspace.undo()?.label).toBe('third');
    expect(onDisk('objects/objCar/Step_0.gml')).toBe('v2;\n');
    expect(workspace.undo()?.label).toBe('second');
    expect(onDisk('objects/objCar/Step_0.gml')).toBe('v1;\n');
    expect(workspace.undo()?.label).toBe('first');
    expect(onDisk('objects/objCar/Step_0.gml')).toBe('x += 1;\n');
  });

  it('reports nothing to undo once history is exhausted', () => {
    workspace.begin('only').write('a.gml', 'x;\n').commit();
    expect(workspace.undo()).toBeDefined();
    expect(workspace.undo()).toBeUndefined();
  });

  it('preserves CRLF and BOM through snapshot and restore', () => {
    const crlf = '{\r\n  "$GMObject":"",\r\n  "%Name":"objCrlf",\r\n}';
    seed('objects/objCrlf/objCrlf.yy', '﻿' + crlf);

    const tx = workspace.begin('touch crlf');
    const doc = tx.readDoc('objects/objCrlf/objCrlf.yy')!;
    expect(doc.eol).toBe('\r\n');
    expect(doc.hasBom).toBe(true);
    doc.insert([], 'visible', true);
    tx.writeDoc('objects/objCrlf/objCrlf.yy', doc);
    tx.commit();
    expect(onDisk('objects/objCrlf/objCrlf.yy')).toContain('\r\n  "visible":true,');

    workspace.undo();
    expect(onDisk('objects/objCrlf/objCrlf.yy')).toBe('﻿' + crlf);
  });

  it('lists history newest first', () => {
    workspace.begin('one').write('a.gml', '1;\n').commit();
    workspace.begin('two').write('b.gml', '2;\n').commit();
    expect(workspace.history().map((s) => s.label)).toEqual(['two', 'one']);
  });

  it('keeps the snapshot store out of the project tree', () => {
    workspace.begin('any').write('a.gml', '1;\n').commit();
    expect(existsSync(join(root, '.gml-mcp', 'shadow.git'))).toBe(true);
    expect(readFileSync(join(root, '.gml-mcp', '.gitignore'), 'utf8')).toBe('*\n');
  });
});

describe('validation', () => {
  it('accepts a document produced by YyDoc', () => {
    const doc = YyDoc.parse(OBJECT_YY);
    doc.insert([], 'solid', false);
    const tx = workspace.begin('valid');
    tx.writeDoc('objects/objCar/objCar.yy', doc);
    expect(() => tx.commit()).not.toThrow();
  });

  it('refuses legacy per-config containers', () => {
    const tx = workspace.begin('legacy');
    tx.write('options/main/inherited/options_main.inherited.yy', '1.0.0←abc|{"a":1}');
    expect(() => tx.commit()).toThrow(/non-JSON/);
  });
});
