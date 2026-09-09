import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GmProject } from '../src/project/index.js';
import { checkGml, ProjectSymbols, stripCommentsAndStrings } from '../src/project/symbols.js';
import { GmlSpec } from '../src/spec/index.js';

const SPEC = GmlSpec.parse(`<?xml version="1.0"?>
<GameMakerLanguageSpec RuntimeVersion="test">
  <Functions>
    <Function Name="show_debug_message" ReturnType="Undefined" Pure="false" Deprecated="false">
      <Parameter Name="msg" Type="Any" Optional="false">Message.</Parameter>
    </Function>
    <Function Name="instance_create_layer" ReturnType="Id.Instance" Pure="false" Deprecated="false"/>
    <Function Name="array_length" ReturnType="Real" Pure="true" Deprecated="false"/>
  </Functions>
  <Variables/><Constants/><Structures/><Enumerations/>
</GameMakerLanguageSpec>`);

let root: string;
let project: GmProject;

function seed(path: string, text: string): void {
  const absolute = join(root, path);
  mkdirSync(join(absolute, '..'), { recursive: true });
  writeFileSync(absolute, text);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'gml-mcp-symbols-'));
  seed(
    'Game.yyp',
    '{\n  "$GMProject":"v1",\n  "%Name":"Game",\n  "Folders":[],\n  "name":"Game",\n  "resources":[\n' +
      '    {"id":{"name":"objPlayer","path":"objects/objPlayer/objPlayer.yy",},},\n' +
      '    {"id":{"name":"scr_util","path":"scripts/scr_util/scr_util.yy",},},\n' +
      '  ],\n  "resourceType":"GMProject",\n  "resourceVersion":"2.0",\n}',
  );
  seed('objects/objPlayer/objPlayer.yy', '{\n  "name":"objPlayer",\n  "eventList":[],\n}');
  seed('scripts/scr_util/scr_util.yy', '{\n  "name":"scr_util",\n}');
  seed(
    'scripts/scr_util/scr_util.gml',
    [
      '#macro MAX_HP 100',
      'enum Facing { left, right }',
      'function clamp01(v) { return v; }',
      'function Vec2(x, y) constructor {',
      '  static length = function() { return 0; };',
      '}',
      'global.score = 0;',
      'var handlers = { onTick: function() {} };',
    ].join('\n'),
  );
  project = GmProject.open(root);
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('stripCommentsAndStrings', () => {
  const stripped = (code: string) => stripCommentsAndStrings(code);

  it('removes line and block comments', () => {
    expect(stripped('a(); // fake_call()')).not.toContain('fake_call');
    expect(stripped('a(); /* fake_call() */ b();')).not.toContain('fake_call');
  });

  it('removes string contents', () => {
    expect(stripped('show("fake_call()")')).not.toContain('fake_call');
    expect(stripped("show('fake_call()')")).not.toContain('fake_call');
    expect(stripped('show(@"fake_call()")')).not.toContain('fake_call');
  });

  it('keeps template interpolations, which are real code', () => {
    const out = stripped('var s = $"hp is {get_hp()} now";');
    expect(out).toContain('get_hp()');
    expect(out).not.toContain('hp is');
  });

  it('removes #region labels, which are prose', () => {
    expect(stripped('#region Inventory structs (Item template here)')).not.toContain('structs');
  });

  it('preserves length and line structure', () => {
    const code = 'a();\n// comment here\nb();';
    expect(stripped(code)).toHaveLength(code.length);
    expect(stripped(code).split('\n')).toHaveLength(3);
  });
});

describe('ProjectSymbols', () => {
  it('finds declarations of every kind', () => {
    const symbols = ProjectSymbols.scan(project);
    expect(symbols.get('clamp01')?.kind).toBe('function');
    expect(symbols.get('MAX_HP')?.kind).toBe('macro');
    expect(symbols.get('Facing')?.kind).toBe('enum');
    expect(symbols.get('score')?.kind).toBe('global');
    expect(symbols.get('objPlayer')?.kind).toBe('resource');
  });

  it('treats struct and constructor methods as callable', () => {
    const symbols = ProjectSymbols.scan(project);
    // Sibling methods call these bare; we cannot prove such a call wrong.
    expect(symbols.has('length')).toBe(true);
    expect(symbols.has('onTick')).toBe(true);
  });

  it('records where a symbol came from', () => {
    expect(ProjectSymbols.scan(project).get('clamp01')?.file).toBe(
      'scripts/scr_util/scr_util.gml',
    );
  });
});

describe('checkGml', () => {
  const check = (code: string) =>
    checkGml(code, 'objects/objPlayer/Step_0.gml', SPEC, ProjectSymbols.scan(project));

  it('accepts runtime and project functions', () => {
    expect(check('show_debug_message("hi");\nclamp01(0.5);\narray_length([]);')).toEqual([]);
  });

  it('flags a function that exists nowhere', () => {
    const [diagnostic] = check('network_send_packet_raw(1, 2);');
    expect(diagnostic).toMatchObject({ name: 'network_send_packet_raw', line: 1 });
    expect(diagnostic!.message).toContain('Unknown function');
  });

  it('reports the right line and column', () => {
    const [diagnostic] = check('var a = 1;\nvar b = 2;\n  made_up_thing();');
    expect(diagnostic).toMatchObject({ line: 3, column: 3 });
  });

  it('suggests a near miss', () => {
    const [diagnostic] = check('instance_create_layerr(0, 0, "L", objPlayer);');
    expect(diagnostic!.suggestions).toContain('instance_create_layer');
  });

  it('ignores method calls on structs and instances', () => {
    expect(check('inventory.add_item(1);\nself.tick();\nclamp01(1).bar();')).toEqual([]);
  });

  it('ignores keywords and control flow', () => {
    expect(check('if (true) { while (false) { } }\nswitch (1) { }\nrepeat (3) { }')).toEqual([]);
  });

  it('ignores functions held in local variables', () => {
    expect(check('var cb = argument0;\ncb();')).toEqual([]);
    expect(check('handler = function() {};\nhandler();')).toEqual([]);
  });

  it('ignores declarations, which are not calls', () => {
    expect(check('function my_new_helper(a, b) { return a; }\nmy_new_helper(1, 2);')).toEqual([]);
  });

  it('does not look inside comments or strings', () => {
    expect(check('// totally_fake_function()\nvar s = "another_fake()";')).toEqual([]);
  });
});
