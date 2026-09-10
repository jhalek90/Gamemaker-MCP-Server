/**
 * Every sprite the platformer needs, drawn from primitives.
 *
 * There is no font and no image import in this pipeline, so anything that
 * reads as a letter — the `?` on a bonus block — is drawn as a grid of blocks
 * through `pixels`. That turns out to suit the whole game: quantising every
 * edge to a 4px grid gives a consistent chunky look rather than a mix of
 * smooth ellipses and hard rectangles.
 */

import { Canvas, type Colour } from '../../src/image/index.js';

export const TILE = 64;

/** Snap to the 4px grid the art is drawn on. */
const q = (value: number): number => Math.round(value / 4) * 4;

/**
 * Paint a character grid. Each row is one pixel row, each character indexes
 * `palette`; a space, or any character the palette does not name, is skipped.
 */
export function pixels(
  canvas: Canvas,
  grid: readonly string[],
  palette: Record<string, Colour>,
  scale: number,
  ox = 0,
  oy = 0,
): Canvas {
  grid.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const colour = palette[row[x]!];
      if (colour === undefined) continue;
      canvas.rect(ox + x * scale, oy + y * scale, scale, scale, colour);
    }
  });
  return canvas;
}

// -- the hero -------------------------------------------------------------

const SKIN = '#f8b878';
const SKIN_SHADE = '#d08840';
const SUIT = '#d82800';
const SUIT_SHADE = '#901800';
const DENIM = '#2038c8';
const DENIM_SHADE = '#101c78';
const HAIR = '#6c3000';
const BUTTON = '#f8d038';
const EYE = '#101010';
const BOOT = '#5c2c08';

/**
 * The player, facing right. `image_xscale` flips it in game, so there is only
 * ever one direction to draw.
 *
 * Small and big share this one routine: the head keeps roughly its pixel size
 * while the torso and legs stretch, which is what makes big Mario read as the
 * same character rather than a zoomed one.
 *
 * Frames: 0 idle, 1 and 2 the two halves of the walk cycle, 3 airborne.
 */
export function hero(width: number, height: number, frame: number, big: boolean): Canvas {
  const canvas = new Canvas(width, height, 'transparent');
  const w = width;

  // Head geometry is nearly fixed; the body absorbs the extra height.
  const headH = q(big ? height * 0.30 : height * 0.42);
  const capH = q(headH * 0.34);
  const brimH = q(headH * 0.16);
  const faceTop = capH + brimH;
  const torsoTop = headH;
  const torsoH = q((height - headH) * (big ? 0.5 : 0.45));
  const legTop = torsoTop + torsoH;
  const bootTop = q(height - (big ? height * 0.11 : height * 0.14));

  // -- cap
  canvas.rect(q(w * 0.22), 0, q(w * 0.56), capH, SUIT);
  canvas.rect(q(w * 0.14), capH, q(w * 0.82), brimH, SUIT);
  canvas.rect(q(w * 0.58), capH, q(w * 0.38), brimH, SUIT_SHADE);

  // -- face
  const faceH = headH - faceTop;
  canvas.rect(q(w * 0.20), faceTop, q(w * 0.60), faceH, SKIN);
  canvas.rect(q(w * 0.10), faceTop, q(w * 0.14), q(faceH * 0.75), HAIR); // sideburn
  canvas.rect(q(w * 0.76), faceTop + q(faceH * 0.30), q(w * 0.16), q(faceH * 0.34), SKIN); // nose
  canvas.rect(q(w * 0.54), faceTop + q(faceH * 0.16), 4, q(faceH * 0.36), EYE);
  // Moustache, sitting under the nose rather than across the whole face, so
  // the eye above it stays readable at 48px wide.
  canvas.rect(q(w * 0.32), headH - q(faceH * 0.24), q(w * 0.56), q(faceH * 0.24), HAIR);

  // -- torso: red shirt, blue dungarees over the top
  canvas.rect(q(w * 0.16), torsoTop, q(w * 0.68), torsoH, SUIT);
  const bibTop = torsoTop + q(torsoH * 0.30);
  canvas.rect(q(w * 0.28), bibTop, q(w * 0.44), legTop - bibTop, DENIM);
  canvas.rect(q(w * 0.30), torsoTop, 4, bibTop - torsoTop, DENIM); // straps
  canvas.rect(q(w * 0.62), torsoTop, 4, bibTop - torsoTop, DENIM);
  canvas.rect(q(w * 0.30), bibTop, 4, 4, BUTTON);
  canvas.rect(q(w * 0.62), bibTop, 4, 4, BUTTON);

  // -- arms, which carry most of the pose
  const armH = q(torsoH * 0.55);
  const armW = q(w * 0.16);
  if (frame === 3) {
    // Airborne: leading arm up, trailing arm back.
    canvas.rect(q(w * 0.80), torsoTop - q(armH * 0.4), armW, armH, SUIT);
    canvas.rect(q(w * 0.80), torsoTop - q(armH * 0.4) - 4, armW, 4, SKIN);
    canvas.rect(q(w * 0.02), torsoTop + q(armH * 0.5), armW, armH, SUIT_SHADE);
    canvas.rect(q(w * 0.02), torsoTop + q(armH * 0.5) + armH, armW, 4, SKIN);
  } else {
    const swing = frame === 1 ? q(armH * 0.25) : frame === 2 ? -q(armH * 0.25) : 0;
    canvas.rect(q(w * 0.82), torsoTop + q(torsoH * 0.15) + swing, armW, armH, SUIT);
    canvas.rect(q(w * 0.82), torsoTop + q(torsoH * 0.15) + swing + armH, armW, 4, SKIN);
    canvas.rect(q(w * 0.02), torsoTop + q(torsoH * 0.15) - swing, armW, armH, SUIT_SHADE);
    canvas.rect(q(w * 0.02), torsoTop + q(torsoH * 0.15) - swing + armH, armW, 4, SKIN);
  }

  // -- legs and boots
  const legH = bootTop - legTop;
  const bootH = height - bootTop;
  const legW = q(w * 0.22);
  // Idle stands square; the walk frames stride; the jump tucks one leg up.
  const strides: [number, number][] =
    frame === 1
      ? [
          [q(w * 0.10), q(w * 0.52)],
          [0, 0],
        ]
      : frame === 2
        ? [
            [q(w * 0.30), q(w * 0.30)],
            [0, 0],
          ]
        : frame === 3
          ? [
              [q(w * 0.08), q(w * 0.50)],
              [q(legH * 0.35), 0],
            ]
          : [
              [q(w * 0.18), q(w * 0.46)],
              [0, 0],
            ];
  const [[leftX, rightX], [leftLift, rightLift]] = strides;

  canvas.rect(leftX!, legTop, legW, legH - leftLift!, DENIM_SHADE);
  canvas.rect(leftX! - 4, bootTop - leftLift!, legW + 8, bootH, BOOT);
  canvas.rect(rightX!, legTop, legW, legH - rightLift!, DENIM);
  canvas.rect(rightX! - 4, bootTop - rightLift!, legW + 8, bootH, BOOT);

  // A darker edge down the back keeps the silhouette from going flat.
  canvas.rect(0, torsoTop, 4, torsoH, SUIT_SHADE);
  canvas.rect(q(w * 0.28), bibTop, 4, legTop - bibTop, DENIM_SHADE);

  return canvas;
}

/** The four poses, sized for either power state. */
export function heroFrames(big: boolean): Canvas[] {
  const width = 48;
  const height = big ? 128 : 64;
  return [0, 1, 2, 3].map((frame) => hero(width, height, frame, big));
}

// -- blocks ---------------------------------------------------------------

/**
 * Ground. `grass` is false for tiles with another tile on top of them, so a
 * stack reads as one mass of earth with a single turf line rather than as a
 * pile of separate slabs.
 */
export function groundBlock(grass = true): Canvas {
  const canvas = new Canvas(TILE, TILE, '#a05010');
  if (grass) {
    canvas.rect(0, 0, TILE, 14, '#3ca030');
    canvas.rect(0, 12, TILE, 4, '#207818');
  }
  canvas.rect(0, TILE - 6, TILE, 6, '#703408');
  // Scattered grit, placed on a fixed pattern so every tile matches.
  for (const [x, y] of [
    [10, 26],
    [40, 22],
    [22, 40],
    [50, 44],
    [30, 52],
  ] as const) {
    canvas.rect(x, y, 6, 6, '#8a3c0c');
  }
  canvas.rect(0, 0, TILE, TILE, '#00000030', { thickness: 2 });
  return canvas;
}

/** Mortared brick, the breakable-looking platform. */
export function brickBlock(): Canvas {
  const canvas = new Canvas(TILE, TILE, '#c05820');
  const mortar = '#7a3210';
  for (let row = 0; row < 4; row++) {
    const y = row * 16;
    canvas.rect(0, y, TILE, 3, mortar);
    // Alternate rows are offset by half a brick.
    const offset = row % 2 === 0 ? 0 : 16;
    for (let x = offset; x <= TILE; x += 32) canvas.rect(x, y, 3, 16, mortar);
  }
  canvas.rect(0, 0, TILE, 3, '#e07840');
  canvas.rect(0, TILE - 3, TILE, 3, mortar);
  return canvas;
}

/** A quarter of a brick, thrown out when one is smashed. */
export function brickChunk(): Canvas {
  const size = 32;
  const canvas = new Canvas(size, size, 'transparent');
  const mortar = '#7a3210';
  canvas.rect(3, 3, 26, 26, '#c05820');
  canvas.rect(3, 3, 26, 3, '#e07840');
  canvas.rect(3, 26, 26, 3, mortar);
  canvas.rect(3, 14, 26, 3, mortar);
  canvas.rect(14, 3, 3, 11, mortar);
  return canvas;
}

const QUESTION = [
  ' #### ',
  '##  ##',
  '    ##',
  '   ## ',
  '  ##  ',
  '  ##  ',
  '      ',
  '  ##  ',
];

/** Bonus block. Four frames of shimmer, so it draws the eye. */
export function questionBlock(): Canvas[] {
  return [0, 1, 2, 3].map((frame) => {
    const canvas = new Canvas(TILE, TILE, '#e89828');
    canvas.rect(0, 0, TILE, TILE, '#f8c040', { thickness: 4 });
    canvas.rect(0, 0, TILE, 4, '#ffe890');
    canvas.rect(0, TILE - 4, TILE, 4, '#a05808');
    for (const [x, y] of [
      [6, 6],
      [TILE - 14, 6],
      [6, TILE - 14],
      [TILE - 14, TILE - 14],
    ] as const) {
      canvas.rect(x, y, 8, 8, '#7c3c04');
    }
    // The glyph lifts and brightens across the cycle.
    const lift = [0, -2, -4, -2][frame]!;
    const glyph = ['#7c3c04', '#8c4808', '#ffffff', '#8c4808'][frame]!;
    pixels(canvas, QUESTION, { '#': glyph }, 5, 17, 12 + lift);
    return canvas;
  });
}

/** What a bonus block becomes once it has been hit. */
export function usedBlock(): Canvas {
  const canvas = new Canvas(TILE, TILE, '#9a5a20');
  canvas.rect(0, 0, TILE, TILE, '#7c4414', { thickness: 4 });
  canvas.rect(0, 0, TILE, 4, '#b87840');
  canvas.rect(0, TILE - 4, TILE, 4, '#5c3008');
  return canvas;
}

// -- pickups and enemies --------------------------------------------------

/** A coin spinning about its vertical axis: the width oscillates, the height does not. */
export function coinFrames(): Canvas[] {
  const size = 32;
  const count = 6;
  return Array.from({ length: count }, (_, i) => {
    const canvas = new Canvas(size, size, 'transparent');
    // cos gives the foreshortening of a disc turning edge-on and back.
    const squeeze = Math.abs(Math.cos((i / count) * Math.PI));
    // Never thinner than a few pixels: a true edge-on frame is one pixel wide
    // and reads as the sprite failing to draw rather than as a spin.
    const rx = Math.max(5, 14 * squeeze);
    canvas.ellipse(16, 16, rx, 14, '#f8d030');
    canvas.ellipse(16, 16, rx, 14, '#b08000', { thickness: 2 });
    if (rx > 6) {
      canvas.ellipse(16, 16, rx * 0.45, 8, '#ffefa0');
    }
    return canvas;
  });
}

/** The mushroom that makes you big. */
export function mushroom(): Canvas {
  const size = 48;
  const canvas = new Canvas(size, size, 'transparent');
  // The cap goes down first; the stem sits in front of it, or the face is lost.
  canvas.ellipse(24, 20, 22, 17, '#e02020');
  canvas.ellipse(24, 20, 22, 17, '#901010', { thickness: 3 });
  for (const [x, y, r] of [
    [12, 15, 5],
    [25, 10, 6],
    [37, 16, 5],
  ] as const) {
    canvas.circle(x, y, r, '#ffffff');
  }
  canvas.rect(11, 28, 26, 20, '#f8e0b0'); // stem
  canvas.rect(11, 28, 26, 20, '#b08850', { thickness: 3 });
  canvas.rect(16, 34, 5, 7, '#101010'); // eyes
  canvas.rect(27, 34, 5, 7, '#101010');
  return canvas;
}

/**
 * The walking enemy: two waddle frames and a flattened one.
 *
 * Frame 2 is what a stomp leaves behind, so it has to sit on the same
 * baseline — the sprite origin is bottom-centre and the squashed body is
 * drawn against the bottom edge.
 */
export function goombaFrames(): Canvas[] {
  const w = 56;
  const h = 48;
  const body = (feetOffset: number): Canvas => {
    const canvas = new Canvas(w, h, 'transparent');
    canvas.rect(6 + feetOffset, h - 8, 18, 8, '#4c2408'); // feet
    canvas.rect(32 - feetOffset, h - 8, 18, 8, '#4c2408');
    canvas.ellipse(28, 24, 26, 20, '#a05820'); // cap
    canvas.ellipse(28, 24, 26, 20, '#6c3410', { thickness: 3 });
    canvas.ellipse(28, 34, 18, 10, '#e0b070'); // face
    // Angry eyes: white with a black pupil and a heavy brow.
    canvas.ellipse(20, 26, 6, 7, '#ffffff');
    canvas.ellipse(36, 26, 6, 7, '#ffffff');
    canvas.rect(19, 24, 4, 7, '#101010');
    canvas.rect(35, 24, 4, 7, '#101010');
    canvas.polygon(
      [
        [13, 17],
        [26, 24],
        [26, 27],
        [13, 21],
      ],
      '#3c1c04',
    );
    canvas.polygon(
      [
        [43, 17],
        [30, 24],
        [30, 27],
        [43, 21],
      ],
      '#3c1c04',
    );
    return canvas;
  };

  const squashed = new Canvas(w, h, 'transparent');
  squashed.ellipse(28, h - 7, 27, 7, '#8a4818');
  squashed.ellipse(28, h - 7, 27, 7, '#5c2c0c', { thickness: 3 });
  squashed.rect(4, h - 8, 14, 8, '#4c2408');
  squashed.rect(38, h - 8, 14, 8, '#4c2408');

  return [body(0), body(6), squashed];
}

// -- scenery --------------------------------------------------------------

/** The end-of-level flagpole. Origin is bottom-centre, so it plants on a tile. */
export function flagpole(): Canvas {
  const w = 96;
  const h = 384;
  const canvas = new Canvas(w, h, 'transparent');
  canvas.rect(30, 12, 10, h - 28, '#c0c0c0'); // pole
  canvas.rect(30, 12, 4, h - 28, '#f0f0f0');
  canvas.circle(35, 12, 11, '#3cd048'); // finial
  canvas.circle(35, 12, 11, '#187018', { thickness: 3 });
  canvas.rect(14, h - 16, 42, 16, '#404040'); // base
  canvas.polygon(
    [
      [40, 30],
      [92, 54],
      [40, 78],
    ],
    '#f0f0f0',
  );
  canvas.polygon(
    [
      [40, 30],
      [92, 54],
      [40, 78],
    ],
    '#b0b0b0',
    { thickness: 2 },
  );
  canvas.circle(56, 54, 11, '#e02020');
  return canvas;
}

export function cloud(): Canvas {
  const canvas = new Canvas(192, 96, 'transparent');
  for (const [x, y, r] of [
    [56, 56, 30],
    [96, 44, 36],
    [140, 58, 28],
    [118, 64, 26],
  ] as const) {
    canvas.ellipse(x, y, r, r * 0.8, '#ffffff');
  }
  return canvas;
}

/** A rolling hill for the far background. */
export function hill(): Canvas {
  const canvas = new Canvas(256, 160, 'transparent');
  canvas.ellipse(128, 168, 128, 110, '#2c9020');
  canvas.ellipse(90, 130, 16, 12, '#1c6c14');
  canvas.ellipse(160, 148, 22, 14, '#1c6c14');
  return canvas;
}
