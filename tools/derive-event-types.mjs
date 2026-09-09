/**
 * Derive the GameMaker eventType -> event-file-prefix mapping empirically.
 *
 * Usage: npx tsx tools/derive-event-types.mjs [corpus-dir]
 *
 * Regenerates the evidence behind the table in src/project/events.ts. Re-run
 * against a corpus including newer projects to check for drift.
 *
 * For each object folder, pair eventList entries from the .yy with the .gml
 * files beside it. Only count unambiguous cases: exactly one event with a
 * given eventNum, and exactly one file with that numeric suffix.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { YyDoc } from '../src/yy/index.js';

function collect(dir, out = [], depth = 0) {
  if (depth > 12) return out;
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '.git') continue;
    const path = join(dir, entry);
    let stats;
    try { stats = statSync(path); } catch { continue; }
    if (stats.isDirectory()) collect(path, out, depth + 1);
    else if (entry.endsWith('.yy') && path.includes(`${join('objects')}`)) out.push(path);
  }
  return out;
}

const pairs = new Map();      // "type|prefix" -> count
const collisionShape = new Map();
let objects = 0;

for (const file of collect(process.argv[2] ?? 'd:/gamedev')) {
  let doc;
  try { doc = YyDoc.parse(readFileSync(file, 'utf8')); } catch { continue; }
  let events;
  try { events = doc.get(['eventList']); } catch { continue; }
  if (!Array.isArray(events)) continue;
  objects++;

  const dir = join(file, '..');
  let files;
  try { files = readdirSync(dir).filter((f) => f.endsWith('.gml')); } catch { continue; }

  for (const event of events) {
    const type = event.eventType;
    const num = event.eventNum;
    if (event.collisionObjectId) {
      const hit = files.filter((f) => f.startsWith('Collision_'));
      if (hit.length) collisionShape.set(type, (collisionShape.get(type) ?? 0) + 1);
      continue;
    }
    const sameNum = events.filter((e) => e.eventNum === num && !e.collisionObjectId);
    const candidates = files.filter((f) => f.slice(0, -4).endsWith(`_${num}`));
    if (sameNum.length !== 1 || candidates.length !== 1) continue;
    const prefix = candidates[0].slice(0, -4).replace(new RegExp(`_${num}$`), '');
    const key = `${type}|${prefix}`;
    pairs.set(key, (pairs.get(key) ?? 0) + 1);
  }
}

const byType = new Map();
for (const [key, count] of pairs) {
  const [type, prefix] = key.split('|');
  if (!byType.has(type)) byType.set(type, []);
  byType.get(type).push([prefix, count]);
}

console.log(`objects scanned: ${objects}\n`);
console.log('eventType -> prefix (count), ambiguities shown:');
for (const type of [...byType.keys()].sort((a, b) => Number(a) - Number(b))) {
  const options = byType.get(type).sort((a, b) => b[1] - a[1]);
  const total = options.reduce((sum, [, n]) => sum + n, 0);
  const main = options[0];
  const rest = options.slice(1);
  console.log(
    `  ${String(type).padStart(2)} -> ${main[0].padEnd(12)} ${String(main[1]).padStart(6)}/${total}` +
      (rest.length ? `   also: ${rest.map(([p, n]) => `${p}(${n})`).join(' ')}` : ''),
  );
}
console.log('\ncollision (collisionObjectId set):');
for (const [type, count] of collisionShape) console.log(`  eventType ${type}: ${count}`);
