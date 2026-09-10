/** Render every sprite onto one sheet, so the art can be judged before it lands in the project. */
import { writeFileSync } from 'node:fs';
import { Canvas } from '../../src/image/index.js';
import * as art from './art.js';

const sheet = new Canvas(1100, 620, '#5c94fc');
sheet.rect(0, 560, 1100, 60, '#3ca030');

let x = 20;
const place = (canvas: Canvas, y: number): void => {
  sheet.blit(canvas, x, y);
  x += canvas.width + 12;
};

for (const frame of art.heroFrames(false)) place(frame, 470);
x += 20;
for (const frame of art.heroFrames(true)) place(frame, 406);
x += 20;
for (const frame of art.goombaFrames()) place(frame, 486);

x = 20;
for (const frame of art.coinFrames()) place(frame, 340);
place(art.mushroom(), 320);
place(art.groundBlock(), 300);
place(art.brickBlock(), 300);
for (const frame of art.questionBlock()) place(frame, 300);
place(art.usedBlock(), 300);

sheet.blit(art.flagpole(), 900, 180);
sheet.blit(art.cloud(), 20, 40);
sheet.blit(art.hill(), 620, 400);

const out = process.argv[2] ?? 'preview.png';
writeFileSync(out, sheet.toPng());
console.log('wrote', out);
