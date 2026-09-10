/**
 * Creating sprites.
 *
 * Deliberately left out of M1 because it needs more than a `.yy`: frame and
 * layer GUIDs, PNGs written to two places, and a `sequence` block whose
 * keyframes reference the frames by id. The structure was read off real
 * sprites rather than guessed — a single-frame sprite and a three-frame one
 * differ only in `sequence.length` and the number of keyframes, so it
 * generates cleanly once that is known.
 *
 * On disk a sprite looks like:
 *
 *   sprites/sprThing/sprThing.yy
 *   sprites/sprThing/<frameGuid>.png                    composite for the frame
 *   sprites/sprThing/layers/<frameGuid>/<layerGuid>.png the single image layer
 */

import { randomUUID } from 'node:crypto';
import { Canvas } from '../image/canvas.js';
import { readPngInfo } from '../image/png.js';
import { emit, quote, raw, type YyValue } from '../yy/index.js';
import { GmProject, ProjectError, resourcePathFor, type ResourceRef } from './project.js';
import { registerResource } from './resources.js';
import type { Transaction } from '../tx/index.js';

/** Where GameMaker puts the origin, by index. 9 means custom. */
export const ORIGINS = {
  topLeft: 0,
  topCentre: 1,
  topRight: 2,
  middleLeft: 3,
  middleCentre: 4,
  middleRight: 5,
  bottomLeft: 6,
  bottomCentre: 7,
  bottomRight: 8,
  custom: 9,
} as const;

export type OriginName = keyof typeof ORIGINS;

export interface CreateSpriteOptions {
  /** One entry per animation frame. At least one is required. */
  frames: (Canvas | Buffer)[];
  /** Named preset, an index, or explicit pixels. */
  origin?: OriginName | number | { x: number; y: number };
  /** 0 automatic, 1 full image, 2 manual. Automatic measures the alpha. */
  bboxMode?: number;
  /** 0 precise, 1 rectangle, 2 ellipse, 3 diamond. */
  collisionKind?: number;
  /** Animation speed in frames per second. */
  playbackSpeed?: number;
  folder?: string;
}

/** Pixel position of an origin preset for a sprite of this size. */
export function originPixels(
  origin: number,
  width: number,
  height: number,
): { x: number; y: number } {
  const xs = [0, width / 2, width];
  const ys = [0, height / 2, height];
  if (origin < 0 || origin > 8) return { x: 0, y: 0 };
  return { x: Math.round(xs[origin % 3]!), y: Math.round(ys[Math.floor(origin / 3)]!) };
}

export function createSprite(
  project: GmProject,
  tx: Transaction,
  name: string,
  options: CreateSpriteOptions,
): ResourceRef {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new ProjectError(`Invalid sprite name: ${JSON.stringify(name)}`);
  }
  if (project.has(name, tx)) throw new ProjectError(`Resource already exists: ${name}`);
  if (!options.frames.length) throw new ProjectError('A sprite needs at least one frame');

  // Every frame must agree on size; GameMaker has one width and height for
  // the whole sprite.
  const images = options.frames.map((frame) =>
    frame instanceof Canvas ? { png: frame.toPng(), canvas: frame } : { png: frame, canvas: undefined },
  );
  const sizes = images.map((image) => readPngInfo(image.png));
  const { width, height } = sizes[0]!;
  for (const [index, size] of sizes.entries()) {
    if (size.width !== width || size.height !== height) {
      throw new ProjectError(
        `Frame ${index} is ${size.width}x${size.height}, but frame 0 is ${width}x${height}`,
      );
    }
  }

  const ref: ResourceRef = { name, path: resourcePathFor('sprites', name), kind: 'sprites' };
  const layerGuid = randomUUID();
  const frameGuids = images.map(() => randomUUID());

  // A single-layer sprite writes the same image twice: once as the frame's
  // composite, once as the layer's own content. GameMaker expects both.
  for (const [index, image] of images.entries()) {
    tx.writeBinary(`sprites/${name}/${frameGuids[index]}.png`, image.png);
    tx.writeBinary(`sprites/${name}/layers/${frameGuids[index]}/${layerGuid}.png`, image.png);
  }

  const bboxMode = options.bboxMode ?? 0;
  const bbox =
    bboxMode === 0 && images[0]!.canvas
      ? images[0]!.canvas.alphaBounds()
      : { left: 0, top: 0, right: width - 1, bottom: height - 1 };

  const originIndex =
    typeof options.origin === 'object'
      ? ORIGINS.custom
      : typeof options.origin === 'number'
        ? options.origin
        : ORIGINS[options.origin ?? 'topLeft'];
  const originPoint =
    typeof options.origin === 'object'
      ? options.origin
      : originPixels(originIndex, width, height);

  const parent = project.folderRef(options.folder, tx);
  const playbackSpeed = options.playbackSpeed ?? (images.length > 1 ? 15 : 30);

  const yy: Record<string, YyValue> = {
    $GMSprite: project.tagFor('GMSprite', 'v2'),
    '%Name': name,
    bboxMode,
    bbox_bottom: bbox.bottom,
    bbox_left: bbox.left,
    bbox_right: bbox.right,
    bbox_top: bbox.top,
    collisionKind: options.collisionKind ?? 1,
    collisionTolerance: 0,
    DynamicTexturePage: false,
    edgeFiltering: false,
    For3D: false,
    frames: frameGuids.map((guid) => ({
      $GMSpriteFrame: project.tagFor('GMSpriteFrame', 'v1'),
      '%Name': guid,
      name: guid,
      resourceType: 'GMSpriteFrame',
      resourceVersion: '2.0',
    })),
    gridX: 0,
    gridY: 0,
    height,
    HTile: false,
    layers: [
      {
        $GMImageLayer: project.tagFor('GMImageLayer', ''),
        '%Name': layerGuid,
        blendMode: 0,
        displayName: 'default',
        isLocked: false,
        name: layerGuid,
        // Floats GameMaker writes with a decimal point; emitting `100` here
        // would be rewritten on the next save.
        opacity: raw('100.0'),
        resourceType: 'GMImageLayer',
        resourceVersion: '2.0',
        visible: true,
      },
    ],
    name,
    nineSlice: null,
    origin: originIndex,
    parent,
    preMultiplyAlpha: false,
    resourceType: 'GMSprite',
    resourceVersion: '2.0',
    sequence: sequenceFor(project, name, ref.path, frameGuids, originPoint, playbackSpeed),
    swatchColours: null,
    swfPrecision: raw('0.5'),
    textureGroupId: { name: 'Default', path: 'texturegroups/Default' },
    type: 0,
    VTile: false,
    width,
  };

  tx.write(ref.path, renderSpriteYy(yy));
  registerResource(project, tx, ref);
  return ref;
}

/**
 * The embedded sequence that drives frame playback.
 *
 * One track holds one keyframe per frame, each pointing at a frame GUID.
 * `length` is the frame count, and `Key` is the frame's position on the
 * timeline — both written as floats.
 */
function sequenceFor(
  project: GmProject,
  name: string,
  spritePath: string,
  frameGuids: readonly string[],
  origin: { x: number; y: number },
  playbackSpeed: number,
): YyValue {
  const emptyStore = (of: string): YyValue => ({
    [`$KeyframeStore<${of}>`]: '',
    Keyframes: [],
    resourceType: `KeyframeStore<${of}>`,
    resourceVersion: '2.0',
  });

  return {
    $GMSequence: project.tagFor('GMSequence', 'v1'),
    '%Name': name,
    autoRecord: true,
    backdropHeight: 768,
    backdropImageOpacity: raw('0.5'),
    backdropImagePath: '',
    backdropWidth: 1366,
    backdropXOffset: raw('0.0'),
    backdropYOffset: raw('0.0'),
    events: emptyStore('MessageEventKeyframe'),
    eventStubScript: null,
    eventToFunction: {},
    length: raw(`${frameGuids.length}.0`),
    lockOrigin: false,
    moments: emptyStore('MomentsEventKeyframe'),
    name,
    playback: 1,
    playbackSpeed: raw(`${playbackSpeed}.0`),
    playbackSpeedType: 0,
    resourceType: 'GMSequence',
    resourceVersion: '2.0',
    showBackdrop: true,
    showBackdropImage: false,
    timeUnits: 1,
    tracks: [
      {
        $GMSpriteFramesTrack: '',
        builtinName: 0,
        events: [],
        inheritsTrackColour: true,
        interpolation: 1,
        isCreationTrack: false,
        keyframes: {
          '$KeyframeStore<SpriteFrameKeyframe>': '',
          Keyframes: frameGuids.map((guid, index) => ({
            '$Keyframe<SpriteFrameKeyframe>': '',
            Channels: {
              '0': {
                $SpriteFrameKeyframe: '',
                Id: { name: guid, path: spritePath },
                resourceType: 'SpriteFrameKeyframe',
                resourceVersion: '2.0',
              },
            },
            Disabled: false,
            id: randomUUID(),
            IsCreationKey: false,
            Key: raw(`${index}.0`),
            Length: raw('1.0'),
            resourceType: 'Keyframe<SpriteFrameKeyframe>',
            resourceVersion: '2.0',
            Stretch: false,
          })),
          resourceType: 'KeyframeStore<SpriteFrameKeyframe>',
          resourceVersion: '2.0',
        },
        modifiers: [],
        name: 'frames',
        resourceType: 'GMSpriteFramesTrack',
        resourceVersion: '2.0',
        spriteId: null,
        trackColour: 0,
        tracks: [],
        traits: 0,
      },
    ],
    visibleRange: null,
    volume: raw('1.0'),
    xorigin: origin.x,
    yorigin: origin.y,
  };
}

/** Top-level members one per line, matching what GameMaker writes. */
function renderSpriteYy(members: Record<string, YyValue>): string {
  const lines = ['{'];
  for (const [key, value] of Object.entries(members)) {
    lines.push(`  ${quote(key)}:${emit(value, { eol: '\n', indent: '  ' })},`);
  }
  lines.push('}');
  return lines.join('\n');
}
