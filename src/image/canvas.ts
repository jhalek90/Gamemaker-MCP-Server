/**
 * A small RGBA raster, enough to draw the shapes a placeholder sprite needs.
 *
 * Shapes are anti-aliased by coverage sampling, which reads far better at the
 * sizes sprites usually are. Pixel art wants the opposite, so `antialias:
 * false` gives hard edges instead.
 */

import { encodePng } from './png.js';

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export type Colour = string | Rgba;

const NAMED: Record<string, string> = {
  transparent: '#00000000',
  black: '#000000',
  white: '#ffffff',
  red: '#e6194b',
  green: '#3cb44b',
  blue: '#4363d8',
  yellow: '#ffe119',
  orange: '#f58231',
  purple: '#911eb4',
  cyan: '#42d4f4',
  magenta: '#f032e6',
  lime: '#bfef45',
  pink: '#fabed4',
  teal: '#469990',
  brown: '#9a6324',
  grey: '#a9a9a9',
  gray: '#a9a9a9',
};

/** Accepts `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, a name, or an object. */
export function parseColour(colour: Colour): Rgba {
  if (typeof colour !== 'string') return colour;
  const text = (NAMED[colour.toLowerCase()] ?? colour).replace('#', '');
  const expand = (value: string): number => parseInt(value.repeat(2), 16);
  if (text.length === 3 || text.length === 4) {
    return {
      r: expand(text[0]!),
      g: expand(text[1]!),
      b: expand(text[2]!),
      a: text.length === 4 ? expand(text[3]!) : 255,
    };
  }
  if (text.length === 6 || text.length === 8) {
    return {
      r: parseInt(text.slice(0, 2), 16),
      g: parseInt(text.slice(2, 4), 16),
      b: parseInt(text.slice(4, 6), 16),
      a: text.length === 8 ? parseInt(text.slice(6, 8), 16) : 255,
    };
  }
  throw new TypeError(`Unrecognised colour: ${colour}`);
}

export interface DrawOptions {
  /** Outline instead of filling. */
  thickness?: number;
  antialias?: boolean;
}

/** Subsamples per axis when anti-aliasing; 4 means 16 samples per pixel. */
const SUBSAMPLES = 4;

export class Canvas {
  readonly pixels: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
    background: Colour = 'transparent',
  ) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
      throw new RangeError(`Canvas size must be positive integers, got ${width}x${height}`);
    }
    this.pixels = new Uint8Array(width * height * 4);
    this.fill(background);
  }

  /** Replace every pixel, ignoring what was there. */
  fill(colour: Colour): this {
    const { r, g, b, a } = parseColour(colour);
    for (let i = 0; i < this.pixels.length; i += 4) {
      this.pixels[i] = r;
      this.pixels[i + 1] = g;
      this.pixels[i + 2] = b;
      this.pixels[i + 3] = a;
    }
    return this;
  }

  /** Composite a colour onto one pixel, source-over, scaled by `coverage`. */
  blend(x: number, y: number, colour: Rgba, coverage = 1): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height || coverage <= 0) return;
    const alpha = (colour.a / 255) * Math.min(1, coverage);
    if (alpha <= 0) return;

    const at = (y * this.width + x) * 4;
    const destAlpha = this.pixels[at + 3]! / 255;
    const outAlpha = alpha + destAlpha * (1 - alpha);
    if (outAlpha <= 0) return;

    for (let channel = 0; channel < 3; channel++) {
      const source = channel === 0 ? colour.r : channel === 1 ? colour.g : colour.b;
      const dest = this.pixels[at + channel]!;
      this.pixels[at + channel] = Math.round(
        (source * alpha + dest * destAlpha * (1 - alpha)) / outAlpha,
      );
    }
    this.pixels[at + 3] = Math.round(outAlpha * 255);
  }

  /**
   * Fill every pixel whose centre — or, when anti-aliasing, whose sampled
   * area — falls inside `inside`.
   */
  private shape(
    bounds: { left: number; top: number; right: number; bottom: number },
    inside: (x: number, y: number) => boolean,
    colour: Colour,
    antialias: boolean,
  ): void {
    const rgba = parseColour(colour);
    const x0 = Math.max(0, Math.floor(bounds.left));
    const y0 = Math.max(0, Math.floor(bounds.top));
    const x1 = Math.min(this.width - 1, Math.ceil(bounds.right));
    const y1 = Math.min(this.height - 1, Math.ceil(bounds.bottom));

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (!antialias) {
          if (inside(x + 0.5, y + 0.5)) this.blend(x, y, rgba, 1);
          continue;
        }
        let hits = 0;
        for (let sy = 0; sy < SUBSAMPLES; sy++) {
          for (let sx = 0; sx < SUBSAMPLES; sx++) {
            if (inside(x + (sx + 0.5) / SUBSAMPLES, y + (sy + 0.5) / SUBSAMPLES)) hits++;
          }
        }
        if (hits > 0) this.blend(x, y, rgba, hits / (SUBSAMPLES * SUBSAMPLES));
      }
    }
  }

  rect(x: number, y: number, width: number, height: number, colour: Colour, options: DrawOptions = {}): this {
    const { thickness } = options;
    const antialias = options.antialias ?? false; // axis-aligned edges need none
    const inner = thickness ? { x: x + thickness, y: y + thickness, w: width - thickness * 2, h: height - thickness * 2 } : undefined;
    this.shape(
      { left: x, top: y, right: x + width, bottom: y + height },
      (px, py) => {
        if (px < x || py < y || px >= x + width || py >= y + height) return false;
        if (!inner) return true;
        return !(px >= inner.x && py >= inner.y && px < inner.x + inner.w && py < inner.y + inner.h);
      },
      colour,
      antialias,
    );
    return this;
  }

  circle(cx: number, cy: number, radius: number, colour: Colour, options: DrawOptions = {}): this {
    return this.ellipse(cx, cy, radius, radius, colour, options);
  }

  ellipse(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    colour: Colour,
    options: DrawOptions = {},
  ): this {
    const antialias = options.antialias ?? true;
    const inner = options.thickness ? { rx: rx - options.thickness, ry: ry - options.thickness } : undefined;
    const within = (px: number, py: number, a: number, b: number): boolean =>
      a > 0 && b > 0 && ((px - cx) / a) ** 2 + ((py - cy) / b) ** 2 <= 1;
    this.shape(
      { left: cx - rx, top: cy - ry, right: cx + rx, bottom: cy + ry },
      (px, py) =>
        within(px, py, rx, ry) && !(inner && within(px, py, inner.rx, inner.ry)),
      colour,
      antialias,
    );
    return this;
  }

  /** Fill a polygon using the even-odd rule. */
  polygon(points: readonly [number, number][], colour: Colour, options: DrawOptions = {}): this {
    if (points.length < 3) throw new RangeError('A polygon needs at least three points');
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    this.shape(
      { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) },
      (px, py) => {
        let inside = false;
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
          const [xi, yi] = points[i]!;
          const [xj, yj] = points[j]!;
          if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
        }
        return inside;
      },
      colour,
      options.antialias ?? true,
    );
    return this;
  }

  line(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    colour: Colour,
    options: DrawOptions = {},
  ): this {
    const thickness = Math.max(1, options.thickness ?? 1);
    const dx = x1 - x0;
    const dy = y1 - y0;
    const lengthSquared = dx * dx + dy * dy;
    const half = thickness / 2;
    this.shape(
      {
        left: Math.min(x0, x1) - half,
        top: Math.min(y0, y1) - half,
        right: Math.max(x0, x1) + half,
        bottom: Math.max(y0, y1) + half,
      },
      (px, py) => {
        // Distance from the point to the segment, clamped to its ends.
        const t =
          lengthSquared === 0
            ? 0
            : Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / lengthSquared));
        const nx = x0 + t * dx - px;
        const ny = y0 + t * dy - py;
        return nx * nx + ny * ny <= half * half;
      },
      colour,
      options.antialias ?? true,
    );
    return this;
  }

  /** Composite another canvas onto this one at `x`, `y`. */
  blit(source: Canvas, x: number, y: number): this {
    for (let sy = 0; sy < source.height; sy++) {
      const ty = y + sy;
      if (ty < 0 || ty >= this.height) continue;
      for (let sx = 0; sx < source.width; sx++) {
        const at = (sy * source.width + sx) * 4;
        const alpha = source.pixels[at + 3]!;
        if (alpha === 0) continue;
        this.blend(
          x + sx,
          ty,
          { r: source.pixels[at]!, g: source.pixels[at + 1]!, b: source.pixels[at + 2]!, a: alpha },
          1,
        );
      }
    }
    return this;
  }

  /** Tight bounds of everything at or above `threshold` alpha. */
  alphaBounds(threshold = 1): { left: number; top: number; right: number; bottom: number } {
    let left = this.width;
    let top = this.height;
    let right = -1;
    let bottom = -1;
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.pixels[(y * this.width + x) * 4 + 3]! < threshold) continue;
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
    // A fully transparent image has no bounds; report the whole canvas, which
    // is what GameMaker stores for an empty sprite.
    if (right < 0) return { left: 0, top: 0, right: this.width - 1, bottom: this.height - 1 };
    return { left, top, right, bottom };
  }

  toPng(): Buffer {
    return encodePng(this.width, this.height, this.pixels);
  }
}
