import { inflateSync } from 'node:zlib';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Canvas, drawFrame, encodePng, parseColour, readPngInfo } from '../src/image/index.js';
import { createSprite, GmProject, originPixels, ProjectError } from '../src/project/index.js';
import { YyDoc } from '../src/yy/index.js';

/** Decode our own PNG back to pixels, so the encoder is checked end to end. */
function decodePng(png: Buffer): { width: number; height: number; pixels: Buffer } {
  const { width, height } = readPngInfo(png);
  const parts: Buffer[] = [];
  let at = 8;
  while (at < png.length) {
    const length = png.readUInt32BE(at);
    const type = png.subarray(at + 4, at + 8).toString('ascii');
    if (type === 'IDAT') parts.push(png.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(parts));
  const stride = width * 4;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    expect(raw[y * (stride + 1)]).toBe(0); // filter type None
    raw.copy(pixels, y * stride, y * (stride + 1) + 1, (y + 1) * (stride + 1));
  }
  return { width, height, pixels };
}

const pixelAt = (canvas: Canvas, x: number, y: number): number[] => {
  const at = (y * canvas.width + x) * 4;
  return [...canvas.pixels.subarray(at, at + 4)];
};

describe('colours', () => {
  it('reads every accepted form', () => {
    expect(parseColour('#ff0000')).toEqual({ r: 255, g: 0, b: 0, a: 255 });
    expect(parseColour('#ff000080')).toEqual({ r: 255, g: 0, b: 0, a: 128 });
    expect(parseColour('#f00')).toEqual({ r: 255, g: 0, b: 0, a: 255 });
    expect(parseColour('black')).toEqual({ r: 0, g: 0, b: 0, a: 255 });
    expect(parseColour('transparent').a).toBe(0);
    expect(parseColour({ r: 1, g: 2, b: 3, a: 4 })).toEqual({ r: 1, g: 2, b: 3, a: 4 });
  });

  it('rejects nonsense', () => {
    expect(() => parseColour('#12345')).toThrow(TypeError);
  });
});

describe('png encoding', () => {
  it('round-trips pixels exactly', () => {
    const canvas = new Canvas(4, 3, 'transparent');
    canvas.rect(1, 1, 2, 1, '#102030');
    const decoded = decodePng(canvas.toPng());
    expect(decoded.width).toBe(4);
    expect(decoded.height).toBe(3);
    expect([...decoded.pixels]).toEqual([...canvas.pixels]);
  });

  it('produces a file other readers recognise', () => {
    const png = new Canvas(2, 2, 'red').toPng();
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(png.subarray(12, 16).toString('ascii')).toBe('IHDR');
    expect(png.subarray(png.length - 8, png.length - 4).toString('ascii')).toBe('IEND');
    expect(readPngInfo(png)).toEqual({ width: 2, height: 2 });
  });

  it('refuses a mismatched pixel buffer', () => {
    expect(() => encodePng(2, 2, new Uint8Array(4))).toThrow(RangeError);
  });

  it('rejects data that is not a PNG', () => {
    expect(() => readPngInfo(Buffer.from('not a png at all, really'))).toThrow(TypeError);
  });
});

describe('drawing', () => {
  it('fills a rectangle exactly, without bleeding', () => {
    const canvas = new Canvas(8, 8, 'transparent').rect(2, 2, 3, 3, 'red');
    expect(pixelAt(canvas, 2, 2)[3]).toBe(255);
    expect(pixelAt(canvas, 4, 4)[3]).toBe(255);
    expect(pixelAt(canvas, 5, 5)[3]).toBe(0);
    expect(pixelAt(canvas, 1, 1)[3]).toBe(0);
  });

  it('outlines when given a thickness', () => {
    const canvas = new Canvas(10, 10, 'transparent').rect(0, 0, 10, 10, 'red', { thickness: 2 });
    expect(pixelAt(canvas, 0, 0)[3]).toBe(255);
    expect(pixelAt(canvas, 1, 5)[3]).toBe(255);
    expect(pixelAt(canvas, 5, 5)[3]).toBe(0); // hollow centre
  });

  it('draws circles centred where asked', () => {
    const canvas = new Canvas(20, 20, 'transparent').circle(10, 10, 6, 'blue');
    expect(pixelAt(canvas, 10, 10)[3]).toBe(255);
    expect(pixelAt(canvas, 0, 0)[3]).toBe(0);
    expect(pixelAt(canvas, 19, 19)[3]).toBe(0);
  });

  it('anti-aliases curves, and does not when told not to', () => {
    const soft = new Canvas(20, 20, 'transparent').circle(10, 10, 6, 'blue');
    const hard = new Canvas(20, 20, 'transparent').circle(10, 10, 6, 'blue', { antialias: false });
    const partial = (canvas: Canvas): number => {
      let count = 0;
      for (let i = 3; i < canvas.pixels.length; i += 4) {
        const a = canvas.pixels[i]!;
        if (a > 0 && a < 255) count++;
      }
      return count;
    };
    expect(partial(soft)).toBeGreaterThan(0);
    expect(partial(hard)).toBe(0);
  });

  it('composites alpha over what is already there', () => {
    const canvas = new Canvas(4, 4, '#000000').rect(0, 0, 4, 4, '#ffffff80');
    const [r, , , a] = pixelAt(canvas, 1, 1);
    expect(a).toBe(255);
    expect(r).toBeGreaterThan(100);
    expect(r).toBeLessThan(160);
  });

  it('fills polygons', () => {
    const canvas = new Canvas(20, 20, 'transparent').polygon(
      [
        [2, 2],
        [18, 2],
        [10, 18],
      ],
      'green',
    );
    expect(pixelAt(canvas, 10, 5)[3]).toBeGreaterThan(0);
    expect(pixelAt(canvas, 2, 17)[3]).toBe(0);
  });

  it('needs at least three points for a polygon', () => {
    expect(() => new Canvas(4, 4).polygon([[0, 0], [1, 1]], 'red')).toThrow(RangeError);
  });

  it('measures the alpha bounds of what was drawn', () => {
    const canvas = new Canvas(20, 20, 'transparent').rect(4, 6, 5, 3, 'red');
    expect(canvas.alphaBounds()).toEqual({ left: 4, top: 6, right: 8, bottom: 8 });
  });

  it('reports whole-canvas bounds when nothing was drawn', () => {
    expect(new Canvas(8, 5, 'transparent').alphaBounds()).toEqual({
      left: 0, top: 0, right: 7, bottom: 4,
    });
  });

  it('draws shapes described as data', () => {
    const canvas = drawFrame(16, 16, {
      shapes: [
        { type: 'fill', colour: '#00000000' },
        { type: 'circle', x: 8, y: 8, radius: 5, colour: 'red' },
      ],
    });
    expect(pixelAt(canvas, 8, 8)[3]).toBe(255);
  });

  it('refuses an impossible canvas', () => {
    expect(() => new Canvas(0, 10)).toThrow(RangeError);
    expect(() => new Canvas(10, 2.5)).toThrow(RangeError);
  });
});

describe('origins', () => {
  it('places each preset', () => {
    expect(originPixels(0, 64, 32)).toEqual({ x: 0, y: 0 });
    expect(originPixels(4, 64, 32)).toEqual({ x: 32, y: 16 });
    expect(originPixels(8, 64, 32)).toEqual({ x: 64, y: 32 });
  });
});

describe('creating a sprite', () => {
  let root: string;
  let project: GmProject;

  const YYP = [
    '{', '  "$GMProject":"v1",', '  "%Name":"Game",', '  "Folders":[],',
    '  "name":"Game",', '  "resources":[],', '  "resourceType":"GMProject",',
    '  "resourceVersion":"2.0",', '}',
  ].join('\n');

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'gml-mcp-sprite-'));
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'Game.yyp'), YYP);
    project = GmProject.open(root);
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const make = (name: string, options: Parameters<typeof createSprite>[3]) =>
    project.transact(`create ${name}`, (tx) => createSprite(project, tx, name, options));

  it('writes the .yy, the frame image and the layer image', () => {
    make('spr_dot', { frames: [new Canvas(16, 16).circle(8, 8, 6, 'red')] });

    const doc = YyDoc.parse(readFileSync(join(root, 'sprites/spr_dot/spr_dot.yy'), 'utf8'));
    expect(doc.get(['width'])).toBe(16);
    expect(doc.get(['height'])).toBe(16);
    const frameGuid = doc.get(['frames', 0, 'name']) as string;
    const layerGuid = doc.get(['layers', 0, 'name']) as string;

    // GameMaker wants the image in both places for a single-layer sprite.
    expect(existsSync(join(root, `sprites/spr_dot/${frameGuid}.png`))).toBe(true);
    expect(existsSync(join(root, `sprites/spr_dot/layers/${frameGuid}/${layerGuid}.png`))).toBe(true);
  });

  it('registers itself in the project', () => {
    make('spr_dot', { frames: [new Canvas(8, 8, 'red')] });
    expect(project.find('spr_dot')?.path).toBe('sprites/spr_dot/spr_dot.yy');
  });

  it('links every frame from the sequence, in order', () => {
    const frames = [1, 2, 3].map((n) => new Canvas(8, 8).circle(4, 4, n, 'red'));
    make('spr_anim', { frames });

    const doc = YyDoc.parse(readFileSync(join(root, 'sprites/spr_anim/spr_anim.yy'), 'utf8'));
    const keyframes = ['sequence', 'tracks', 0, 'keyframes', 'Keyframes'] as const;
    expect(doc.length([...keyframes])).toBe(3);
    expect(doc.getRaw(['sequence', 'length'])).toBe('3.0');

    for (let i = 0; i < 3; i++) {
      expect(doc.get([...keyframes, i, 'Channels', '0', 'Id', 'name'])).toBe(
        doc.get(['frames', i, 'name']),
      );
      expect(doc.getRaw([...keyframes, i, 'Key'])).toBe(`${i}.0`);
    }
  });

  it('writes floats as floats, so GameMaker does not rewrite the file', () => {
    make('spr_dot', { frames: [new Canvas(8, 8, 'red')] });
    const doc = YyDoc.parse(readFileSync(join(root, 'sprites/spr_dot/spr_dot.yy'), 'utf8'));
    expect(doc.getRaw(['layers', 0, 'opacity'])).toBe('100.0');
    expect(doc.getRaw(['swfPrecision'])).toBe('0.5');
    expect(doc.getRaw(['sequence', 'volume'])).toBe('1.0');
  });

  it('measures the bounding box from the drawn pixels', () => {
    const canvas = new Canvas(32, 32, 'transparent').rect(8, 10, 6, 4, 'red');
    make('spr_box', { frames: [canvas] });
    const doc = YyDoc.parse(readFileSync(join(root, 'sprites/spr_box/spr_box.yy'), 'utf8'));
    expect(doc.get(['bbox_left'])).toBe(8);
    expect(doc.get(['bbox_top'])).toBe(10);
    expect(doc.get(['bbox_right'])).toBe(13);
    expect(doc.get(['bbox_bottom'])).toBe(13);
  });

  it('resolves the origin preset into pixels', () => {
    make('spr_dot', { frames: [new Canvas(64, 32, 'red')], origin: 'middleCentre' });
    const doc = YyDoc.parse(readFileSync(join(root, 'sprites/spr_dot/spr_dot.yy'), 'utf8'));
    expect(doc.get(['origin'])).toBe(4);
    expect(doc.get(['sequence', 'xorigin'])).toBe(32);
    expect(doc.get(['sequence', 'yorigin'])).toBe(16);
  });

  it('marks an explicit origin as custom', () => {
    make('spr_dot', { frames: [new Canvas(64, 32, 'red')], origin: { x: 7, y: 9 } });
    const doc = YyDoc.parse(readFileSync(join(root, 'sprites/spr_dot/spr_dot.yy'), 'utf8'));
    expect(doc.get(['origin'])).toBe(9);
    expect(doc.get(['sequence', 'xorigin'])).toBe(7);
  });

  it('refuses frames of differing sizes', () => {
    expect(() =>
      make('spr_bad', { frames: [new Canvas(8, 8, 'red'), new Canvas(16, 8, 'red')] }),
    ).toThrow(/16x8/);
  });

  it('refuses no frames, a bad name, and a duplicate', () => {
    expect(() => make('spr_none', { frames: [] })).toThrow(ProjectError);
    expect(() => make('9bad', { frames: [new Canvas(8, 8)] })).toThrow(ProjectError);
    make('spr_dot', { frames: [new Canvas(8, 8, 'red')] });
    expect(() => make('spr_dot', { frames: [new Canvas(8, 8, 'red')] })).toThrow(/already exists/);
  });

  it('is undoable, leaving no images behind', () => {
    make('spr_dot', { frames: [new Canvas(8, 8, 'red')] });
    project.workspace.undo();
    expect(existsSync(join(root, 'sprites/spr_dot'))).toBe(false);
    expect(project.has('spr_dot')).toBe(false);
    expect(readdirSync(root).filter((e) => e === 'sprites')).toEqual([]);
  });
});
