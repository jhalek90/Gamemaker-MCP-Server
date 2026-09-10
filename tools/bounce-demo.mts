/**
 * Build `spr_bounce`: a 100x100, 16 frame bouncing ball, drawn from primitives.
 *
 *   npx tsx tools/bounce-demo.mts
 *
 * Kept because it is the smallest end-to-end example of the sprite pipeline —
 * a plain function of the frame index, straight into a real GameMaker sprite —
 * and because the animation itself is worth reading. Height follows projectile
 * motion rather than a sine wave, which is what makes it read as gravity, and
 * the ball is in contact for exactly one frame of sixteen. Written for this
 * project; no third party code.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { bridgeRoot } from '../src/bridge/install.js';
import { Canvas } from '../src/image/index.js';
import { createSprite, deleteResource, GmProject } from '../src/project/index.js';

const SIZE = 100;
const FRAMES = 16;
const RADIUS = 20;
const FLOOR = 88;      // y of the ground line
const RISE = 46;       // how far above resting the apex sits

/**
 * Frame `i` of a bouncing ball.
 *
 * Height follows real projectile motion: h = 1 - 4(t - 0.5)^2, with the floor
 * at t=0 and t=1 and the apex in the middle. That puts the ball fast at the
 * bottom and slow at the top, which is what makes a bounce read as gravity
 * rather than a hover. Frame 0 is the contact, so the cycle loops seamlessly.
 */
function frame(i: number): Canvas {
  const t = i / FRAMES;
  const height = 1 - 4 * (t - 0.5) ** 2;

  // Contact lasts a single frame, which is what a bounce actually is: the
  // ball is moving fastest at the floor. The neighbouring frames stretch
  // instead, giving the classic stretch-squash-stretch read.
  const impact = Math.max(0, 1 - height / 0.18);
  const speed = Math.min(1, Math.abs(8 * (t - 0.5)) / 4);
  const squash = 0.44 * impact;
  const stretch = 0.18 * speed * (1 - impact);

  const rx = RADIUS * (1 + squash - stretch);
  const ry = RADIUS * (1 - squash + stretch);
  // Keep the ball resting on the floor rather than sinking through it.
  const cy = FLOOR - ry - height * RISE;
  const cx = SIZE / 2;

  const canvas = new Canvas(SIZE, SIZE, 'transparent');

  // A shadow that tightens as the ball rises sells the height.
  const shadowScale = 1 - height * 0.55;
  const shadowAlpha = Math.round(45 + 70 * (1 - height));
  canvas.ellipse(
    cx,
    FLOOR + 3,
    rx * shadowScale,
    5 * shadowScale,
    `#000000${shadowAlpha.toString(16).padStart(2, '0')}`,
  );

  canvas.line(6, FLOOR + 8, SIZE - 6, FLOOR + 8, '#3a3a3a', { thickness: 2 });

  canvas.ellipse(cx, cy, rx, ry, '#e6194b');
  canvas.ellipse(cx, cy, rx, ry, '#8f0f2e', { thickness: 3 });
  // Highlight, offset up-left, shrinking as the ball squashes.
  canvas.ellipse(cx - rx * 0.32, cy - ry * 0.34, rx * 0.24, ry * 0.2, '#ffffffcc');

  return canvas;
}

const frames = Array.from({ length: FRAMES }, (_, i) => frame(i));

const project = GmProject.open(join(bridgeRoot(), 'mcp_bridge'));
if (project.has('spr_bounce')) {
  project.transact('replace spr_bounce', (tx) => deleteResource(project, tx, 'spr_bounce', { force: true }));
}
{
  const ref = project.transact('create spr_bounce', (tx) =>
    createSprite(project, tx, 'spr_bounce', {
      frames,
      origin: 'middleCentre',
      playbackSpeed: 16,
    }),
  );
  console.log(`created ${ref.name}: ${SIZE}x${SIZE}, ${FRAMES} frames -> ${ref.path}`);
}

// A contact sheet, so all sixteen frames can be seen at once.
const COLUMNS = 8;
const sheet = new Canvas(SIZE * COLUMNS, SIZE * Math.ceil(FRAMES / COLUMNS), '#f4f4f4');
frames.forEach((f, i) => {
  sheet.blit(f, (i % COLUMNS) * SIZE, Math.floor(i / COLUMNS) * SIZE);
});
const sheetPath = process.argv[2] ?? 'bounce_sheet.png';
writeFileSync(sheetPath, sheet.toPng());
console.log('contact sheet:', sheetPath);
