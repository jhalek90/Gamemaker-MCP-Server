/** Lay every Doom sprite out on one sheet, to judge before it lands in the project. */
import { writeFileSync } from 'node:fs';
import { Canvas } from '../../src/image/index.js';
import * as art from './art.js';

function zoom(source: Canvas, factor: number): Canvas {
  const out = new Canvas(source.width * factor, source.height * factor, 'transparent');
  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      const at = (y * source.width + x) * 4;
      const a = source.pixels[at + 3]!;
      if (a === 0) continue;
      out.rect(x * factor, y * factor, factor, factor, {
        r: source.pixels[at]!, g: source.pixels[at + 1]!, b: source.pixels[at + 2]!, a,
      });
    }
  }
  return out;
}

const sheet = new Canvas(1240, 780, '#20242a');
let x = 16;
for (const w of [art.brickWall(), art.stoneWall(), art.techWall(), art.doorWall(), art.exitWall()]) {
  sheet.blit(zoom(w, 2), x, 16);
  x += 64 * 2 + 12;
}
x = 16;
for (const f of art.impFrames()) { sheet.blit(zoom(f, 2), x, 170); x += 64 * 2 + 8; }
x = 16;
for (const f of art.fireball()) { sheet.blit(zoom(f, 3), x, 320); x += 24 * 3 + 10; }
sheet.blit(zoom(art.medkit(), 3), 190, 320);
sheet.blit(zoom(art.ammoBox(), 3), 300, 320);
sheet.blit(zoom(art.exitPad(), 3), 410, 320);
for (const [i, f] of art.faceFrames().entries()) sheet.blit(zoom(f, 2), 580 + i * 96, 320);
x = 16;
for (const f of art.gunFrames()) { sheet.blit(f, x, 470); x += 230; }
writeFileSync(process.argv[2]!, sheet.toPng());
console.log('ok');
