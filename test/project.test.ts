import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addEvent,
  createObject,
  createScript,
  deleteResource,
  Events,
  GmProject,
  listEvents,
  ProjectError,
  removeEvent,
  renameResource,
  setSpriteProperties,
} from '../src/project/index.js';
import { YyDoc } from '../src/yy/index.js';

let root: string;
let project: GmProject;

const YYP = [
  '{',
  '  "$GMProject":"v1",',
  '  "%Name":"TestGame",',
  '  "Folders":[],',
  '  "IncludedFiles":[],',
  '  "MetaData":{',
  '    "IDEVersion":"2026.0.0.16",',
  '  },',
  '  "name":"TestGame",',
  '  "resources":[',
  '    {"id":{"name":"objPlayer","path":"objects/objPlayer/objPlayer.yy",},},',
  '    {"id":{"name":"sprPlayer","path":"sprites/sprPlayer/sprPlayer.yy",},},',
  '  ],',
  '  "resourceType":"GMProject",',
  '  "resourceVersion":"2.0",',
  '}',
].join('\n');

const OBJ_PLAYER = [
  '{',
  '  "$GMObject":"",',
  '  "%Name":"objPlayer",',
  '  "eventList":[',
  '    {"$GMEvent":"v1","%Name":"","collisionObjectId":null,"eventNum":0,"eventType":0,"isDnD":false,"name":"","resourceType":"GMEvent","resourceVersion":"2.0",},',
  '  ],',
  '  "name":"objPlayer",',
  '  "parent":{"name":"TestGame","path":"TestGame.yyp",},',
  '  "resourceType":"GMObject",',
  '  "resourceVersion":"2.0",',
  '  "spriteId":{"name":"sprPlayer","path":"sprites/sprPlayer/sprPlayer.yy",},',
  '  "visible":true,',
  '}',
].join('\n');

const SPR_PLAYER = [
  '{',
  '  "$GMSprite":"v2",',
  '  "%Name":"sprPlayer",',
  '  "bboxMode":0,',
  '  "bbox_bottom":31,',
  '  "bbox_left":0,',
  '  "bbox_right":31,',
  '  "bbox_top":0,',
  '  "collisionKind":1,',
  '  "collisionTolerance":0,',
  '  "height":32,',
  '  "name":"sprPlayer",',
  '  "origin":0,',
  '  "parent":{"name":"TestGame","path":"TestGame.yyp",},',
  '  "resourceType":"GMSprite",',
  '  "resourceVersion":"2.0",',
  '  "sequence":{',
  '    "$GMSequence":"v1",',
  '    "%Name":"sprPlayer",',
  '    "name":"sprPlayer",',
  '  },',
  '  "width":32,',
  '}',
].join('\n');

const ORDER = [
  '{',
  '  "FolderOrderSettings":[],',
  '  "ResourceOrderSettings":[',
  '    {"name":"objPlayer","order":1,"path":"objects/objPlayer/objPlayer.yy",},',
  '    {"name":"sprPlayer","order":2,"path":"sprites/sprPlayer/sprPlayer.yy",},',
  '  ],',
  '}',
].join('\n');

function seed(path: string, text: string): void {
  const absolute = join(root, path);
  mkdirSync(join(absolute, '..'), { recursive: true });
  writeFileSync(absolute, text);
}

function read(path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'gml-mcp-project-'));
  seed('TestGame.yyp', YYP);
  seed('TestGame.resource_order', ORDER);
  seed('objects/objPlayer/objPlayer.yy', OBJ_PLAYER);
  seed('objects/objPlayer/Create_0.gml', 'hp = 100;\n');
  seed('sprites/sprPlayer/sprPlayer.yy', SPR_PLAYER);
  project = GmProject.open(root);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('project graph', () => {
  it('reads the resource list', () => {
    expect(project.name).toBe('TestGame');
    expect(project.resources().map((r) => r.name)).toEqual(['objPlayer', 'sprPlayer']);
    expect(project.find('objPlayer')?.kind).toBe('objects');
  });

  it('copies the $GMType tag the project already uses', () => {
    expect(project.tagFor('GMObject')).toBe('');
    expect(project.tagFor('GMSprite')).toBe('v2');
  });

  it('finds references structurally', () => {
    const refs = project.references(project.find('sprPlayer')!);
    expect(refs).toHaveLength(1);
    expect(refs[0]!.path).toBe('objects/objPlayer/objPlayer.yy');
    expect(refs[0]!.at).toEqual(['spriteId']);
  });
});

describe('creating resources', () => {
  it('creates an object and registers it in sorted position', () => {
    const tx = project.begin('add objEnemy');
    createObject(project, tx, 'objEnemy', { sprite: 'sprPlayer', persistent: true });
    tx.commit();

    const yy = YyDoc.parse(read('objects/objEnemy/objEnemy.yy'));
    expect(yy.get(['name'])).toBe('objEnemy');
    expect(yy.get(['%Name'])).toBe('objEnemy');
    expect(yy.get(['persistent'])).toBe(true);
    expect(yy.get(['spriteId', 'path'])).toBe('sprites/sprPlayer/sprPlayer.yy');

    const paths = project.resources().map((r) => r.path);
    expect(paths).toEqual([...paths].sort());
    expect(paths).toContain('objects/objEnemy/objEnemy.yy');
  });

  it('adds an entry to .resource_order with the next order number', () => {
    const tx = project.begin('add');
    createObject(project, tx, 'objEnemy');
    tx.commit();

    const order = YyDoc.parse(read('TestGame.resource_order'));
    const entries = order.get(['ResourceOrderSettings']) as { name: string; order: number }[];
    expect(entries.map((e) => e.name)).toContain('objEnemy');
    expect(entries.find((e) => e.name === 'objEnemy')!.order).toBe(3);
  });

  it('creates an object with events', () => {
    const tx = project.begin('add with events');
    createObject(project, tx, 'objEnemy', {
      events: [
        { event: Events.create(), code: 'speed = 4;\n' },
        { event: Events.step(), code: 'x += speed;\n' },
      ],
    });
    tx.commit();

    expect(read('objects/objEnemy/Create_0.gml')).toBe('speed = 4;\n');
    expect(read('objects/objEnemy/Step_0.gml')).toBe('x += speed;\n');
    expect(listEvents(project, 'objEnemy')).toHaveLength(2);
  });

  it('creates a script', () => {
    const tx = project.begin('add script');
    createScript(project, tx, 'scr_util', 'function clamp01(v) { return clamp(v, 0, 1); }\n');
    tx.commit();

    expect(YyDoc.parse(read('scripts/scr_util/scr_util.yy')).get(['name'])).toBe('scr_util');
    expect(read('scripts/scr_util/scr_util.gml')).toContain('clamp01');
    expect(project.has('scr_util')).toBe(true);
  });

  it('rejects duplicate and invalid names', () => {
    const tx = project.begin('bad');
    expect(() => createObject(project, tx, 'objPlayer')).toThrow(ProjectError);
    expect(() => createObject(project, tx, '9lives')).toThrow(ProjectError);
    expect(() => createObject(project, tx, 'obj-enemy')).toThrow(ProjectError);
  });

  it('leaves the project untouched when a later step fails', () => {
    const before = read('TestGame.yyp');
    const tx = project.begin('doomed');
    createObject(project, tx, 'objA');
    expect(() => createObject(project, tx, 'objPlayer')).toThrow(ProjectError);
    tx.abort();
    expect(read('TestGame.yyp')).toBe(before);
    expect(existsSync(join(root, 'objects/objA'))).toBe(false);
  });
});

describe('events', () => {
  it('adds an event and its file', () => {
    const tx = project.begin('add step');
    addEvent(project, tx, 'objPlayer', Events.step(), 'x += 1;\n');
    tx.commit();

    expect(read('objects/objPlayer/Step_0.gml')).toBe('x += 1;\n');
    expect(listEvents(project, 'objPlayer')).toHaveLength(2);
  });

  it('replaces code without duplicating the eventList entry', () => {
    project.transact('a', (tx) => addEvent(project, tx, 'objPlayer', Events.create(), 'hp = 5;\n'));
    expect(read('objects/objPlayer/Create_0.gml')).toBe('hp = 5;\n');
    expect(listEvents(project, 'objPlayer')).toHaveLength(1);
  });

  it('names collision events after the other object', () => {
    const tx = project.begin('collide');
    createObject(project, tx, 'objWall');
    addEvent(project, tx, 'objPlayer', Events.collision('objWall'), 'speed = 0;\n');
    tx.commit();

    expect(read('objects/objPlayer/Collision_objWall.gml')).toBe('speed = 0;\n');
    const events = listEvents(project, 'objPlayer');
    expect(events.find((e) => e.collisionWith === 'objWall')).toBeDefined();
    const yy = YyDoc.parse(read('objects/objPlayer/objPlayer.yy'));
    expect(yy.get(['eventList', 1, 'collisionObjectId', 'path'])).toBe(
      'objects/objWall/objWall.yy',
    );
  });

  it('removes an event and its file', () => {
    const tx = project.begin('drop create');
    removeEvent(project, tx, 'objPlayer', Events.create());
    tx.commit();

    expect(existsSync(join(root, 'objects/objPlayer/Create_0.gml'))).toBe(false);
    expect(listEvents(project, 'objPlayer')).toHaveLength(0);
  });

  it('refuses to remove an event the object does not have', () => {
    const tx = project.begin('nope');
    expect(() => removeEvent(project, tx, 'objPlayer', Events.draw())).toThrow(ProjectError);
  });
});

describe('sprite properties', () => {
  it('edits origin, bbox and collision settings', () => {
    const tx = project.begin('sprite');
    setSpriteProperties(project, tx, 'sprPlayer', {
      origin: 4,
      collisionKind: 0,
      bbox: { left: 4, top: 4, right: 27, bottom: 27 },
    });
    tx.commit();

    const yy = YyDoc.parse(read('sprites/sprPlayer/sprPlayer.yy'));
    expect(yy.get(['origin'])).toBe(4);
    expect(yy.get(['collisionKind'])).toBe(0);
    expect(yy.get(['bbox_left'])).toBe(4);
    expect(yy.get(['bbox_bottom'])).toBe(27);
    // untouched fields keep their exact source text
    expect(yy.getRaw(['width'])).toBe('32');
  });

  it('refuses a non-sprite', () => {
    const tx = project.begin('wrong kind');
    expect(() => setSpriteProperties(project, tx, 'objPlayer', { origin: 4 })).toThrow(
      ProjectError,
    );
  });
});

describe('delete', () => {
  it('refuses while the resource is still referenced', () => {
    const tx = project.begin('delete sprite');
    expect(() => deleteResource(project, tx, 'sprPlayer')).toThrow(/still referenced/);
  });

  it('deletes an unreferenced resource and its files', () => {
    const tx = project.begin('delete object');
    deleteResource(project, tx, 'objPlayer');
    tx.commit();

    expect(existsSync(join(root, 'objects/objPlayer/objPlayer.yy'))).toBe(false);
    expect(existsSync(join(root, 'objects/objPlayer/Create_0.gml'))).toBe(false);
    expect(project.has('objPlayer')).toBe(false);

    const order = YyDoc.parse(read('TestGame.resource_order'));
    const entries = order.get(['ResourceOrderSettings']) as { name: string }[];
    expect(entries.map((e) => e.name)).not.toContain('objPlayer');
  });

  it('deletes a referenced resource when forced', () => {
    const tx = project.begin('force delete');
    deleteResource(project, tx, 'sprPlayer', { force: true });
    tx.commit();
    expect(project.has('sprPlayer')).toBe(false);
  });
});

describe('rename', () => {
  it('moves files, updates the .yyp and rewrites references', () => {
    const tx = project.begin('rename sprite');
    renameResource(project, tx, 'sprPlayer', 'sprHero');
    tx.commit();

    expect(existsSync(join(root, 'sprites/sprPlayer'))).toBe(false);
    const yy = YyDoc.parse(read('sprites/sprHero/sprHero.yy'));
    expect(yy.get(['name'])).toBe('sprHero');
    expect(yy.get(['%Name'])).toBe('sprHero');
    expect(yy.get(['sequence', 'name'])).toBe('sprHero');

    expect(project.has('sprHero')).toBe(true);
    expect(project.has('sprPlayer')).toBe(false);

    const player = YyDoc.parse(read('objects/objPlayer/objPlayer.yy'));
    expect(player.get(['spriteId', 'name'])).toBe('sprHero');
    expect(player.get(['spriteId', 'path'])).toBe('sprites/sprHero/sprHero.yy');
  });

  it('renames a script and its .gml', () => {
    project.transact('mk', (tx) => createScript(project, tx, 'scr_a', 'function a() {}\n'));
    project.transact('rn', (tx) => renameResource(project, tx, 'scr_a', 'scr_b'));

    expect(existsSync(join(root, 'scripts/scr_a'))).toBe(false);
    expect(read('scripts/scr_b/scr_b.gml')).toBe('function a() {}\n');
    expect(YyDoc.parse(read('scripts/scr_b/scr_b.yy')).get(['name'])).toBe('scr_b');
  });

  it('keeps object event files, which are not named after the object', () => {
    project.transact('rn', (tx) => renameResource(project, tx, 'objPlayer', 'objHero'));
    expect(read('objects/objHero/Create_0.gml')).toBe('hp = 100;\n');
    expect(YyDoc.parse(read('objects/objHero/objHero.yy')).get(['name'])).toBe('objHero');
  });

  it('is undoable as a whole', () => {
    const before = {
      yyp: read('TestGame.yyp'),
      obj: read('objects/objPlayer/objPlayer.yy'),
      spr: read('sprites/sprPlayer/sprPlayer.yy'),
    };
    project.transact('rn', (tx) => renameResource(project, tx, 'sprPlayer', 'sprHero'));
    project.workspace.undo();

    expect(read('TestGame.yyp')).toBe(before.yyp);
    expect(read('objects/objPlayer/objPlayer.yy')).toBe(before.obj);
    expect(read('sprites/sprPlayer/sprPlayer.yy')).toBe(before.spr);
    expect(existsSync(join(root, 'sprites/sprHero'))).toBe(false);
  });
});
