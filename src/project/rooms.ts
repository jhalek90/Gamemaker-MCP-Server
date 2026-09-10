/**
 * Creating rooms.
 *
 * A room is the only resource that carries its own sub-resources — layers —
 * and the layer list is ordered by depth, so it cannot be generated from a
 * flat template. Every new room gets the two layers GameMaker itself creates
 * for a blank room: an instance layer at depth 0 and a background layer at
 * depth 100. `addRoomInstance` finds the instance layer by resourceType, so
 * the names here are conventional rather than load-bearing.
 *
 * The float literals are deliberate. GameMaker writes `"volume":1.0` and
 * `"animationFPS":15.0`; emitting `1` and `15` would make the IDE rewrite the
 * whole file on its next save, which is exactly the diff this project exists
 * to avoid.
 */

import type { Transaction } from '../tx/index.js';
import { emit, quote, raw, type YyValue } from '../yy/index.js';
import { parseColour, type Colour } from '../image/canvas.js';
import {
  GmProject,
  ProjectError,
  resourcePathFor,
  type ResourceRef,
} from './project.js';
import { registerResource } from './resources.js';

const VALID_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * GameMaker stores colours as ABGR integers, not RGBA — `4278190080` is
 * opaque black, and the red channel is the *low* byte.
 */
export function gmColour(colour: Colour): number {
  const { r, g, b, a } = parseColour(colour);
  return a * 2 ** 24 + b * 2 ** 16 + g * 256 + r;
}

export interface RoomViewOptions {
  /** Size of the visible area, in room pixels. Defaults to the room size. */
  width?: number;
  height?: number;
  /** Size drawn to the window. Defaults to the view size. */
  portWidth?: number;
  portHeight?: number;
  /** Object to keep in frame. */
  follow?: string;
  /**
   * How close to the edge the followed object may get before the view moves.
   * `hborder` is the slack on the left and right, `vborder` top and bottom.
   * Half the view width centres the object exactly, though a camera object
   * driving `camera_set_view_pos` gives more control than borders do.
   */
  hborder?: number;
  vborder?: number;
  /** Pixels per step the view may move; -1 is instant. */
  hspeed?: number;
  vspeed?: number;
}

export interface CreateRoomOptions {
  width?: number;
  height?: number;
  folder?: string;
  persistent?: boolean;
  /** Background layer colour. */
  background?: Colour;
  /** Turn on view 0, optionally following an object. */
  view?: RoomViewOptions;
  /**
   * Where the room sits in the project's room order. 0 makes it the room the
   * game starts in. Defaults to appending after the existing rooms.
   */
  orderIndex?: number;
}

export function createRoom(
  project: GmProject,
  tx: Transaction,
  name: string,
  options: CreateRoomOptions = {},
): ResourceRef {
  if (!VALID_NAME.test(name)) throw new ProjectError(`Invalid room name: ${JSON.stringify(name)}`);
  if (project.has(name, tx)) throw new ProjectError(`Resource already exists: ${name}`);

  const width = options.width ?? 1366;
  const height = options.height ?? 768;
  const ref: ResourceRef = { name, path: resourcePathFor('rooms', name), kind: 'rooms' };

  const follow = options.view?.follow;
  if (follow) {
    const target = project.find(follow, tx);
    if (!target) throw new ProjectError(`No such resource: ${follow}`);
    if (target.kind !== 'objects') throw new ProjectError(`${follow} is not an object`);
  }

  const view = options.view;
  const viewWidth = view?.width ?? width;
  const viewHeight = view?.height ?? height;
  const ports = { w: view?.portWidth ?? viewWidth, h: view?.portHeight ?? viewHeight };

  // A room always carries eight view slots, whether or not views are enabled.
  //
  // Two prefix conventions collide in this one object, which is easy to get
  // backwards: `hview`/`hport` are the *height* of the view and port, paired
  // with `wview`/`wport` for width -- but `hborder`/`hspeed` are *horizontal*,
  // paired with `vborder`/`vspeed` for vertical. So `hview` is 768 on a
  // 1366x768 view while `hborder` is the slack on the left and right.
  const views: YyValue[] = [];
  for (let i = 0; i < 8; i++) {
    const active = view !== undefined && i === 0;
    views.push({
      hborder: active ? (view.hborder ?? 32) : 32,
      hport: active ? ports.h : height,
      hspeed: active ? (view.hspeed ?? -1) : -1,
      hview: active ? viewHeight : height,
      inherit: false,
      objectId:
        active && follow ? { name: follow, path: resourcePathFor('objects', follow) } : null,
      vborder: active ? (view.vborder ?? 32) : 32,
      visible: active,
      vspeed: active ? (view.vspeed ?? -1) : -1,
      wport: active ? ports.w : width,
      wview: active ? viewWidth : width,
      xport: 0,
      xview: 0,
      yport: 0,
      yview: 0,
    });
  }

  const yy: Record<string, YyValue> = {
    $GMRoom: project.tagFor('GMRoom', 'v1'),
    '%Name': name,
    creationCodeFile: '',
    inheritCode: false,
    inheritCreationOrder: false,
    inheritLayers: false,
    instanceCreationOrder: [],
    isDnd: false,
    layers: [
      {
        $GMRInstanceLayer: '',
        '%Name': 'Instances',
        depth: 0,
        effectEnabled: true,
        effectType: null,
        gridX: 32,
        gridY: 32,
        hierarchyFrozen: false,
        inheritLayerDepth: false,
        inheritLayerSettings: false,
        inheritSubLayers: true,
        inheritVisibility: true,
        instances: [],
        layers: [],
        name: 'Instances',
        properties: [],
        resourceType: 'GMRInstanceLayer',
        resourceVersion: '2.0',
        userdefinedDepth: false,
        visible: true,
      },
      {
        $GMRBackgroundLayer: '',
        '%Name': 'Background',
        animationFPS: raw('15.0'),
        animationSpeedType: 0,
        colour: raw(String(gmColour(options.background ?? 'black'))),
        depth: 100,
        effectEnabled: true,
        effectType: null,
        gridX: 32,
        gridY: 32,
        hierarchyFrozen: false,
        hspeed: raw('0.0'),
        htiled: false,
        inheritLayerDepth: false,
        inheritLayerSettings: false,
        inheritSubLayers: true,
        inheritVisibility: true,
        layers: [],
        name: 'Background',
        properties: [],
        resourceType: 'GMRBackgroundLayer',
        resourceVersion: '2.0',
        spriteId: null,
        stretch: false,
        userdefinedAnimFPS: false,
        userdefinedDepth: false,
        visible: true,
        vspeed: raw('0.0'),
        vtiled: false,
        x: 0,
        y: 0,
      },
    ],
    name,
    parent: project.folderRef(options.folder, tx),
    parentRoom: null,
    physicsSettings: {
      inheritPhysicsSettings: false,
      PhysicsWorld: false,
      PhysicsWorldGravityX: raw('0.0'),
      PhysicsWorldGravityY: raw('10.0'),
      PhysicsWorldPixToMetres: raw('0.1'),
    },
    resourceType: 'GMRoom',
    resourceVersion: '2.0',
    roomSettings: {
      Height: height,
      inheritRoomSettings: false,
      persistent: options.persistent ?? false,
      Width: width,
    },
    sequenceId: null,
    views,
    viewSettings: {
      clearDisplayBuffer: true,
      clearViewBackground: false,
      enableViews: view !== undefined,
      inheritViewSettings: false,
    },
    volume: raw('1.0'),
  };

  const lines = ['{'];
  for (const [key, value] of Object.entries(yy)) {
    lines.push(`  ${quote(key)}:${emit(value, { eol: '\n', indent: '  ' })},`);
  }
  lines.push('}');
  tx.write(ref.path, lines.join('\n'));

  registerResource(project, tx, ref);
  addToRoomOrder(project, tx, ref, options.orderIndex);
  return ref;
}

/**
 * Put a room into `RoomOrderNodes`, which is what decides the starting room
 * and the order `room_goto_next` walks.
 */
export function addToRoomOrder(
  project: GmProject,
  tx: Transaction,
  ref: ResourceRef,
  index?: number,
): void {
  const yyp = project.yyp(tx);
  const entry = { roomId: { name: ref.name, path: ref.path } };

  // A project with no rooms yet has no RoomOrderNodes at all.
  if (!yyp.has(['RoomOrderNodes'])) {
    yyp.insert([], 'RoomOrderNodes', [entry]);
    tx.writeDoc(project.yypPath, yyp);
    return;
  }

  const nodes = yyp.get(['RoomOrderNodes']) as { roomId: { name: string } }[];
  if (nodes.some((node) => node.roomId?.name === ref.name)) return;
  const at = index === undefined ? nodes.length : Math.max(0, Math.min(index, nodes.length));
  yyp.insertAt(['RoomOrderNodes'], at, entry);
  tx.writeDoc(project.yypPath, yyp);
}

/** Position of each room in the project's room order; index 0 starts the game. */
export function roomOrder(project: GmProject, tx?: Transaction): string[] {
  const yyp = project.yyp(tx);
  if (!yyp.has(['RoomOrderNodes'])) return [];
  const nodes = yyp.get(['RoomOrderNodes']) as { roomId: { name: string } }[];
  return nodes.map((node) => node.roomId?.name).filter((name): name is string => Boolean(name));
}

/** Move a room to `index` in the room order. */
export function setRoomOrder(
  project: GmProject,
  tx: Transaction,
  roomName: string,
  index: number,
): void {
  const yyp = project.yyp(tx);
  const nodes = yyp.has(['RoomOrderNodes'])
    ? (yyp.get(['RoomOrderNodes']) as { roomId: { name: string } }[])
    : [];
  const from = nodes.findIndex((node) => node.roomId?.name === roomName);
  if (from === -1) throw new ProjectError(`${roomName} is not in the room order`);
  const ref = project.find(roomName, tx);
  if (!ref) throw new ProjectError(`No such resource: ${roomName}`);
  yyp.remove(['RoomOrderNodes', from]);
  const to = Math.max(0, Math.min(index, nodes.length - 1));
  yyp.insertAt(['RoomOrderNodes'], to, { roomId: { name: ref.name, path: ref.path } });
  tx.writeDoc(project.yypPath, yyp);
}

/** Change a room's size, persistence or background colour after creation. */
export function setRoomProperties(
  project: GmProject,
  tx: Transaction,
  roomName: string,
  properties: { width?: number; height?: number; persistent?: boolean; background?: Colour },
): void {
  const ref = project.find(roomName, tx);
  if (!ref) throw new ProjectError(`No such resource: ${roomName}`);
  if (ref.kind !== 'rooms') throw new ProjectError(`${roomName} is not a room`);
  const doc = project.readDoc(ref.path, tx);

  if (properties.width !== undefined) doc.set(['roomSettings', 'Width'], properties.width);
  if (properties.height !== undefined) doc.set(['roomSettings', 'Height'], properties.height);
  if (properties.persistent !== undefined) {
    doc.set(['roomSettings', 'persistent'], properties.persistent);
  }
  if (properties.background !== undefined) {
    const layers = doc.get(['layers']) as { resourceType: string }[];
    const index = layers.findIndex((l) => l.resourceType === 'GMRBackgroundLayer');
    if (index === -1) throw new ProjectError(`Room ${roomName} has no background layer`);
    doc.setRaw(['layers', index, 'colour'], String(gmColour(properties.background)));
  }
  tx.writeDoc(ref.path, doc);
}
