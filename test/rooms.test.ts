import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addRoomInstance,
  createObject,
  createRoom,
  GmProject,
  gmColour,
  listRoomInstances,
  ProjectError,
  roomOrder,
  setRoomOrder,
  setRoomProperties,
} from '../src/project/index.js';
import { YyDoc } from '../src/yy/index.js';

let root: string;
let project: GmProject;

/** A project with no rooms at all, so RoomOrderNodes is absent to begin with. */
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
  '  "resources":[],',
  '  "resourceType":"GMProject",',
  '  "resourceVersion":"2.0",',
  '}',
].join('\n');

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'gml-rooms-'));
  writeFileSync(join(root, 'TestGame.yyp'), YYP);
  mkdirSync(join(root, 'rooms'), { recursive: true });
  project = GmProject.open(root);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const roomDoc = (name: string): YyDoc => project.readDoc(`rooms/${name}/${name}.yy`);

describe('creating rooms', () => {
  it('creates a room with an instance layer and a background layer', () => {
    project.transact('room', (tx) => createRoom(project, tx, 'rm_one'));

    const doc = roomDoc('rm_one');
    const layers = doc.get(['layers']) as { resourceType: string; name: string }[];
    expect(layers.map((l) => l.resourceType)).toEqual([
      'GMRInstanceLayer',
      'GMRBackgroundLayer',
    ]);
    expect(doc.get(['roomSettings', 'Width'])).toBe(1366);
    expect(doc.get(['roomSettings', 'Height'])).toBe(768);
  });

  it('registers the room and starts a RoomOrderNodes list when there is none', () => {
    project.transact('room', (tx) => createRoom(project, tx, 'rm_one'));

    expect(project.has('rm_one')).toBe(true);
    expect(roomOrder(project)).toEqual(['rm_one']);
  });

  it('writes floats as floats, so the IDE does not rewrite the file', () => {
    project.transact('room', (tx) => createRoom(project, tx, 'rm_one'));

    const text = project.readText('rooms/rm_one/rm_one.yy') ?? '';
    expect(text).toContain('"volume":1.0');
    expect(text).toContain('"animationFPS":15.0');
    expect(text).toContain('"PhysicsWorldGravityY":10.0');
  });

  it('leaves views off unless asked for', () => {
    project.transact('room', (tx) => createRoom(project, tx, 'rm_one'));

    const doc = roomDoc('rm_one');
    expect(doc.get(['viewSettings', 'enableViews'])).toBe(false);
    expect((doc.get(['views']) as unknown[]).length).toBe(8);
  });

  it('enables view 0 and points it at the object to follow', () => {
    project.transact('room', (tx) => {
      createObject(project, tx, 'objHero');
      createRoom(project, tx, 'rm_one', {
        width: 4096,
        view: { width: 640, height: 360, follow: 'objHero', hborder: 200, vborder: 90 },
      });
    });

    const doc = roomDoc('rm_one');
    expect(doc.get(['viewSettings', 'enableViews'])).toBe(true);
    const views = doc.get(['views']) as {
      visible: boolean;
      wview: number;
      hview: number;
      hborder: number;
      vborder: number;
      objectId: { name: string } | null;
    }[];
    expect(views[0]!.visible).toBe(true);
    expect(views[0]!.objectId?.name).toBe('objHero');
    // `wview`/`hview` are width and height, but `hborder`/`vborder` are
    // horizontal and vertical -- the two prefixes mean different things in the
    // same object, and getting them the wrong way round leaves the camera
    // panning off the wrong edge.
    expect(views[0]!.wview).toBe(640);
    expect(views[0]!.hview).toBe(360);
    expect(views[0]!.hborder).toBe(200);
    expect(views[0]!.vborder).toBe(90);
    expect(views[1]!.visible).toBe(false);
    expect(views[1]!.objectId).toBeNull();
  });

  it('refuses to follow something that is not an object', () => {
    expect(() =>
      project.transact('room', (tx) =>
        createRoom(project, tx, 'rm_one', { view: { follow: 'objMissing' } }),
      ),
    ).toThrow(ProjectError);
  });

  it('rejects a duplicate name', () => {
    project.transact('room', (tx) => createRoom(project, tx, 'rm_one'));
    expect(() =>
      project.transact('again', (tx) => createRoom(project, tx, 'rm_one')),
    ).toThrow(ProjectError);
  });
});

describe('room order', () => {
  beforeEach(() => {
    project.transact('rooms', (tx) => {
      createRoom(project, tx, 'rm_one');
      createRoom(project, tx, 'rm_two');
    });
  });

  it('appends by default', () => {
    expect(roomOrder(project)).toEqual(['rm_one', 'rm_two']);
  });

  it('puts a room first when asked, which is what picks the starting room', () => {
    project.transact('third', (tx) =>
      createRoom(project, tx, 'rm_start', { orderIndex: 0 }),
    );
    expect(roomOrder(project)).toEqual(['rm_start', 'rm_one', 'rm_two']);
  });

  it('moves an existing room', () => {
    project.transact('move', (tx) => setRoomOrder(project, tx, 'rm_two', 0));
    expect(roomOrder(project)).toEqual(['rm_two', 'rm_one']);
  });

  it('is undoable', () => {
    project.transact('third', (tx) => createRoom(project, tx, 'rm_three'));
    expect(roomOrder(project)).toHaveLength(3);
    project.workspace.undo();
    expect(roomOrder(project)).toEqual(['rm_one', 'rm_two']);
    expect(project.has('rm_three')).toBe(false);
  });
});

describe('room properties', () => {
  beforeEach(() => {
    project.transact('room', (tx) => createRoom(project, tx, 'rm_one'));
  });

  it('resizes and sets persistence', () => {
    project.transact('resize', (tx) =>
      setRoomProperties(project, tx, 'rm_one', {
        width: 2048,
        height: 512,
        persistent: true,
      }),
    );
    const doc = roomDoc('rm_one');
    expect(doc.get(['roomSettings', 'Width'])).toBe(2048);
    expect(doc.get(['roomSettings', 'Height'])).toBe(512);
    expect(doc.get(['roomSettings', 'persistent'])).toBe(true);
  });

  it('recolours the background layer', () => {
    project.transact('sky', (tx) =>
      setRoomProperties(project, tx, 'rm_one', { background: '#5c94fc' }),
    );
    const layers = roomDoc('rm_one').get(['layers']) as { colour: number }[];
    expect(layers[1]!.colour).toBe(gmColour('#5c94fc'));
  });
});

describe('gmColour', () => {
  it('packs to ABGR, not RGBA', () => {
    // GameMaker's own value for opaque black.
    expect(gmColour('#000000')).toBe(4278190080);
    // Red lives in the low byte, so pure red is 0xFF0000FF.
    expect(gmColour('#ff0000')).toBe(4278190335);
    expect(gmColour('#0000ff')).toBe(4294901760);
  });
});

describe('instances in a new room', () => {
  it('accepts instances on the layer createRoom made', () => {
    project.transact('build', (tx) => {
      createObject(project, tx, 'objHero');
      createRoom(project, tx, 'rm_one');
      addRoomInstance(project, tx, 'rm_one', 'objHero', { x: 128, y: 64 });
    });

    const instances = listRoomInstances(project, 'rm_one');
    expect(instances).toHaveLength(1);
    expect(instances[0]).toMatchObject({ object: 'objHero', x: 128, y: 64, layer: 'Instances' });
  });
});
