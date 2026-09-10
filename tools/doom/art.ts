/**
 * Textures and sprites for the raycaster.
 *
 * Wall textures are sampled one column at a time by the renderer, so they have
 * to read well at a single pixel of width: broad vertical structure carries the
 * look, fine horizontal detail mostly disappears. They are all 64x64, which is
 * one world cell.
 *
 * Everything is deterministic — the grain comes from a hash of the pixel
 * position, not a random number generator — so rebuilding the project produces
 * byte-identical PNGs and the shadow git stays quiet.
 */

import { Canvas, type Colour } from '../../src/image/index.js';

export const TEX = 64;

/** Reproducible value noise in [0,1). */
function hash(x: number, y: number, seed = 1): number {
  let h = (x * 374761393 + y * 668265263 + seed * 1274126177) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Blend towards black or white by `amount`, for cheap shading. */
function shade(colour: string, amount: number): string {
  const n = parseInt(colour.slice(1), 16);
  const to = amount < 0 ? 0 : 255;
  const t = Math.abs(amount);
  const mix = (c: number): number => Math.round(c + (to - c) * t);
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/** Speckle a canvas with per-pixel grain so flat fills do not look like plastic. */
function grain(canvas: Canvas, seed: number, strength = 0.12, step = 2): void {
  for (let y = 0; y < canvas.height; y += step) {
    for (let x = 0; x < canvas.width; x += step) {
      const n = hash(x, y, seed);
      if (n > 0.55) {
        const at = (y * canvas.width + x) * 4;
        const a = canvas.pixels[at + 3]!;
        if (a === 0) continue;
        const d = (n - 0.55) * strength * 2;
        canvas.rect(x, y, step, step, {
          r: canvas.pixels[at]!,
          g: canvas.pixels[at + 1]!,
          b: canvas.pixels[at + 2]!,
          a: Math.round(255 * d),
        });
      }
    }
  }
}

// -- walls ----------------------------------------------------------------

export function brickWall(): Canvas {
  const canvas = new Canvas(TEX, TEX, '#5a1f18');
  const mortar = '#2a100c';
  for (let row = 0; row < 8; row++) {
    const y = row * 8;
    const offset = row % 2 === 0 ? 0 : 8;
    for (let x = 0; x < TEX; x += 16) {
      const bx = ((x + offset) % TEX) + 1;
      const tone = 0.16 * (hash(x, row, 7) - 0.5);
      canvas.rect(bx, y + 1, 14, 6, shade('#7a2a1e', tone));
    }
    canvas.rect(0, y, TEX, 1, mortar);
  }
  grain(canvas, 11);
  // A little ambient occlusion top and bottom reads as depth in the corridor.
  canvas.rect(0, 0, TEX, 2, '#00000060');
  canvas.rect(0, TEX - 3, TEX, 3, '#00000070');
  return canvas;
}

export function stoneWall(): Canvas {
  const canvas = new Canvas(TEX, TEX, '#4c4a47');
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      const tone = 0.2 * (hash(col, row, 3) - 0.5);
      canvas.rect(col * 16 + 1, row * 16 + 1, 14, 14, shade('#6b6862', tone));
      canvas.rect(col * 16 + 1, row * 16 + 1, 14, 2, shade('#6b6862', tone + 0.15));
      canvas.rect(col * 16 + 1, row * 16 + 13, 14, 2, shade('#6b6862', tone - 0.2));
    }
  }
  grain(canvas, 23, 0.18);
  canvas.rect(0, 0, TEX, 2, '#00000055');
  canvas.rect(0, TEX - 3, TEX, 3, '#00000070');
  return canvas;
}

export function techWall(): Canvas {
  const canvas = new Canvas(TEX, TEX, '#2b3138');
  canvas.rect(2, 2, 28, 60, '#39434c');
  canvas.rect(34, 2, 28, 60, '#39434c');
  // Rivets, which are the one detail that survives being sampled a column at a time.
  for (const cx of [6, 26, 38, 58]) {
    for (const cy of [6, 32, 58]) canvas.rect(cx, cy, 3, 3, '#1b2026');
  }
  // A lit strip gives the corridors a colour to bounce off.
  canvas.rect(30, 0, 4, TEX, '#0d1013');
  canvas.rect(31, 6, 2, 52, '#39d06a');
  canvas.rect(31, 6, 2, 52, '#8bffb0');
  grain(canvas, 41, 0.1);
  canvas.rect(0, TEX - 3, TEX, 3, '#00000070');
  return canvas;
}

export function doorWall(): Canvas {
  const canvas = new Canvas(TEX, TEX, '#6a5a24');
  canvas.rect(2, 2, 60, 60, '#8a7530');
  canvas.rect(4, 4, 56, 56, '#6a5a24', { thickness: 2 });
  // Hazard chevrons down the middle, so a door is obvious at a glance.
  for (let i = 0; i < 5; i++) {
    const y = 6 + i * 12;
    canvas.polygon(
      [
        [22, y],
        [42, y],
        [32, y + 8],
      ],
      '#d8c24a',
    );
  }
  canvas.rect(0, 0, 2, TEX, '#3a3112');
  canvas.rect(TEX - 2, 0, 2, TEX, '#3a3112');
  grain(canvas, 59, 0.08);
  return canvas;
}

export function exitWall(): Canvas {
  const canvas = new Canvas(TEX, TEX, '#2b3138');
  canvas.rect(4, 4, 56, 56, '#39434c');
  canvas.rect(10, 10, 44, 44, '#12331c');
  canvas.rect(14, 14, 36, 36, '#25c256');
  canvas.rect(14, 14, 36, 36, '#8bffb0', { thickness: 3 });
  // A blocky arrow: no font, so the glyph is drawn.
  canvas.polygon(
    [
      [24, 22],
      [34, 22],
      [34, 18],
      [44, 32],
      [34, 46],
      [34, 42],
      [24, 42],
    ],
    '#0b2412',
  );
  grain(canvas, 71, 0.08);
  return canvas;
}

// -- the enemy ------------------------------------------------------------

const IMP_SKIN = '#8a4326';
const IMP_DARK = '#5a2714';
const IMP_EYE = '#ffd23a';

/**
 * A hunched demon, facing the camera.
 *
 * Billboarded sprites are always seen head-on, so there is only one angle to
 * draw. `lean` swings the arms and shifts the weight for the walk cycle.
 */
function imp(lean: number, arms: 'down' | 'out' | 'up'): Canvas {
  const canvas = new Canvas(TEX, TEX, 'transparent');
  const sway = lean * 3;

  // legs
  canvas.rect(20 + sway, 44, 9, 18, IMP_DARK);
  canvas.rect(35 - sway, 44, 9, 18, IMP_DARK);
  canvas.rect(18 + sway, 58, 13, 5, '#3a1a0c');
  canvas.rect(33 - sway, 58, 13, 5, '#3a1a0c');

  // torso
  canvas.ellipse(32, 38, 15, 14, IMP_SKIN);
  canvas.ellipse(32, 40, 10, 9, IMP_DARK);

  // Arms hang clear of the torso, which spans x 17..47 -- tucked against it
  // they vanish into the silhouette at the sizes this is actually seen at.
  if (arms === 'out') {
    canvas.rect(4, 32, 16, 7, IMP_SKIN);
    canvas.rect(44, 32, 16, 7, IMP_SKIN);
    canvas.circle(6, 35, 6, IMP_DARK);
    canvas.circle(58, 35, 6, IMP_DARK);
  } else if (arms === 'up') {
    canvas.rect(8, 16, 9, 22, IMP_SKIN);
    canvas.rect(47, 16, 9, 22, IMP_SKIN);
    canvas.circle(12, 14, 8, '#ff8a2a');
    canvas.circle(52, 14, 8, '#ff8a2a');
    canvas.circle(12, 14, 4, '#ffe9a8');
    canvas.circle(52, 14, 4, '#ffe9a8');
  } else {
    canvas.rect(9 + sway, 30, 9, 20, IMP_SKIN);
    canvas.rect(46 - sway, 30, 9, 20, IMP_SKIN);
    canvas.circle(13 + sway, 51, 6, IMP_DARK);
    canvas.circle(50 - sway, 51, 6, IMP_DARK);
  }

  // Head and horns. The horns have to fit inside the canvas: run them off the
  // top and the renderer samples a flat-topped demon.
  canvas.ellipse(32, 20, 13, 12, IMP_SKIN);
  canvas.polygon(
    [
      [20, 12],
      [13, 1],
      [26, 8],
    ],
    IMP_DARK,
  );
  canvas.polygon(
    [
      [44, 12],
      [51, 1],
      [38, 8],
    ],
    IMP_DARK,
  );
  canvas.ellipse(26, 18, 4, 3, IMP_EYE);
  canvas.ellipse(38, 18, 4, 3, IMP_EYE);
  // A mouth full of teeth.
  canvas.rect(25, 26, 14, 5, '#2a0f06');
  for (let i = 0; i < 5; i++) canvas.rect(26 + i * 3, 26, 2, 3, '#e8ddc8');
  return canvas;
}

/** A corpse, flattening over three frames. */
function impDeath(stage: number): Canvas {
  const canvas = new Canvas(TEX, TEX, 'transparent');
  const t = stage / 2;
  const height = 26 - t * 20;
  const width = 16 + t * 12;
  canvas.ellipse(32, 62 - height / 2, width, height / 2, IMP_SKIN);
  canvas.ellipse(32, 62 - height / 2, width, height / 2, IMP_DARK, { thickness: 3 });
  // Blood pools out as it collapses.
  canvas.ellipse(32, 61, width + t * 10, 4 + t * 3, '#7a0f12');
  if (stage < 2) {
    canvas.ellipse(24, 60 - height * 0.6, 5, 4, IMP_EYE);
  }
  return canvas;
}

export function impFrames(): Canvas[] {
  // 0,1 walk  2 attack  3,4,5 death
  return [imp(1, 'down'), imp(-1, 'down'), imp(0, 'up'), impDeath(0), impDeath(1), impDeath(2)];
}

export function fireball(): Canvas[] {
  return [0, 1].map((frame) => {
    const canvas = new Canvas(24, 24, 'transparent');
    const wobble = frame === 0 ? 0 : 1;
    canvas.circle(12, 12, 11 - wobble, '#ff5a10');
    canvas.circle(12, 12, 7 + wobble, '#ffa032');
    canvas.circle(12, 12, 4, '#ffe9a8');
    return canvas;
  });
}

// -- pickups --------------------------------------------------------------

export function medkit(): Canvas {
  const canvas = new Canvas(32, 32, 'transparent');
  canvas.rect(2, 6, 28, 22, '#e8e4dc');
  canvas.rect(2, 6, 28, 22, '#9a9690', { thickness: 2 });
  canvas.rect(13, 10, 6, 14, '#d01d1d');
  canvas.rect(9, 14, 14, 6, '#d01d1d');
  return canvas;
}

export function ammoBox(): Canvas {
  const canvas = new Canvas(32, 32, 'transparent');
  canvas.rect(2, 10, 28, 18, '#5c6b32');
  canvas.rect(2, 10, 28, 18, '#39441f', { thickness: 2 });
  for (let i = 0; i < 4; i++) {
    canvas.rect(5 + i * 6, 4, 4, 8, '#c8a03a');
    canvas.rect(5 + i * 6, 4, 4, 3, '#e8c860');
  }
  return canvas;
}

/** The switch that ends the level. */
export function exitPad(): Canvas {
  const canvas = new Canvas(48, 48, 'transparent');
  canvas.ellipse(24, 40, 22, 8, '#0d2a15');
  canvas.ellipse(24, 38, 18, 6, '#25c256');
  canvas.rect(18, 10, 12, 28, '#39434c');
  canvas.rect(18, 10, 12, 28, '#1b2026', { thickness: 2 });
  canvas.rect(21, 14, 6, 10, '#25c256');
  canvas.rect(21, 26, 6, 8, '#8bffb0');
  return canvas;
}

// -- the weapon -----------------------------------------------------------

const GUN_W = 240;
const GUN_H = 190;

/**
 * The shotgun, seen down the barrels from the bottom of the screen.
 *
 * Composed so the muzzle stays inside the canvas: the flash has to have
 * somewhere to come from, and a barrel running off the top edge reads as a
 * pipe rather than a gun.
 */
export function gunFrames(): Canvas[] {
  const body = (recoil: number, flash: boolean): Canvas => {
    const canvas = new Canvas(GUN_W, GUN_H, 'transparent');
    const cx = GUN_W / 2;
    const y = 14 + recoil;

    if (flash) {
      canvas.polygon(
        [
          [cx - 58, y + 20],
          [cx, y - 30],
          [cx + 58, y + 20],
          [cx, y + 46],
        ],
        '#ffd25a',
      );
      canvas.circle(cx, y + 8, 26, '#fff3c0');
    }

    // Twin barrels, each with a highlight down one side so they read as
    // cylinders rather than flat bars.
    for (const side of [-1, 1]) {
      const bx = cx + (side < 0 ? -26 : 4);
      canvas.rect(bx, y, 22, 92, '#3a3f45');
      canvas.rect(bx, y, 7, 92, '#6b737d');
      canvas.rect(bx + 18, y, 4, 92, '#23272c');
    }
    canvas.rect(cx - 26, y, 52, 5, '#191c20'); // muzzle
    canvas.rect(cx - 29, y + 40, 58, 8, '#2a2e33'); // barrel band

    // Wooden forestock.
    canvas.rect(cx - 34, y + 88, 68, 30, '#8a6432');
    canvas.rect(cx - 34, y + 88, 68, 6, '#a67d42');
    canvas.rect(cx - 34, y + 112, 68, 6, '#5f4319');

    // Receiver, trigger guard, and a stock running down out of frame.
    canvas.rect(cx - 30, y + 116, 60, 30, '#4a4f56');
    canvas.rect(cx - 30, y + 116, 60, 5, '#6b727a');
    canvas.rect(cx - 24, y + 126, 16, 8, '#2a2e33');
    canvas.polygon(
      [
        [cx + 16, y + 140],
        [cx + 66, GUN_H],
        [cx - 10, GUN_H],
        [cx - 10, y + 152],
      ],
      '#7a5528',
    );
    canvas.rect(cx - 10, y + 146, 22, 14, '#2a2e33'); // trigger guard

    // Both fists on the gun, which is what sells the first-person view.
    canvas.ellipse(cx - 38, y + 102, 15, 16, '#d8a070');
    canvas.ellipse(cx - 38, y + 102, 15, 16, '#a8703f', { thickness: 3 });
    canvas.ellipse(cx + 34, y + 142, 15, 16, '#d8a070');
    canvas.ellipse(cx + 34, y + 142, 15, 16, '#a8703f', { thickness: 3 });
    return canvas;
  };

  return [body(0, false), body(12, true), body(7, false)];
}

// -- the status face ------------------------------------------------------

/** Health, as a face. `hurt` runs 0 (fine) to 3 (about to die). */
export function faceFrames(): Canvas[] {
  return [0, 1, 2, 3].map((hurt) => {
    const canvas = new Canvas(40, 40, 'transparent');
    const pale = ['#e8b078', '#dca070', '#c88a60', '#b07050'][hurt]!;
    canvas.rect(6, 2, 28, 36, pale);
    canvas.rect(4, 0, 32, 8, '#7a4a20'); // hair
    canvas.rect(6, 6, 28, 3, '#5a3416');
    // Eyes narrow as the damage piles up.
    const eyeH = 6 - hurt;
    canvas.rect(11, 13, 6, eyeH, '#ffffff');
    canvas.rect(23, 13, 6, eyeH, '#ffffff');
    canvas.rect(13, 13, 3, eyeH, '#2a2a2a');
    canvas.rect(25, 13, 3, eyeH, '#2a2a2a');
    canvas.rect(18, 20, 4, 7, '#b07048'); // nose
    // Grin, then grimace, then a gasp.
    if (hurt < 2) canvas.rect(13, 30, 14, 3, '#6a3020');
    else canvas.rect(15, 28, 10, 7, '#4a1810');
    for (let i = 0; i < hurt; i++) {
      canvas.rect(8 + i * 9, 22 + i * 3, 7, 3, '#a01818');
    }
    return canvas;
  });
}
