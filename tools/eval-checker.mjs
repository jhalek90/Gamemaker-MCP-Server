/**
 * Measure the GML checker's false-positive rate on real projects.
 *
 * Working, shipped projects should produce almost no diagnostics: anything
 * they report is by definition a false positive (the game builds). A checker
 * that cries wolf teaches an agent to ignore it, so this number matters more
 * than recall.
 *
 * Usage: npx tsx tools/eval-checker.mjs [projects-dir]
 */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { GmProject } from '../src/project/index.js';
import { checkProject, ProjectSymbols } from '../src/project/symbols.js';
import { gmlFiles } from '../src/project/symbols.js';
import { GmlSpec, requireRuntime } from '../src/spec/index.js';

const ROOT = process.argv[2];
if (!ROOT) {
  console.error('usage: node tools/eval-checker.mjs <folder of GameMaker projects>');
  process.exit(1);
}
const spec = GmlSpec.load(requireRuntime().specPath);

function findProjects(dir, out = [], depth = 0) {
  if (depth > 3) return out;
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  const yyp = entries.filter((e) => e.endsWith('.yyp'));
  if (yyp.length === 1) { out.push(dir); return out; }
  for (const entry of entries) {
    if (entry === '.git' || entry === 'node_modules') continue;
    try { if (statSync(join(dir, entry)).isDirectory()) findProjects(join(dir, entry), out, depth + 1); }
    catch { /* unreadable */ }
  }
  return out;
}

const projects = findProjects(ROOT);
console.log(`spec: ${spec.functions.length} functions; projects found: ${projects.length}\n`);

let totalFiles = 0;
let totalCalls = 0;
let totalDiagnostics = 0;
const byName = new Map();
const rows = [];

for (const dir of projects) {
  let project;
  try { project = GmProject.open(dir); } catch { continue; }
  let diagnostics;
  const files = gmlFiles(project.root);
  if (files.length === 0) continue;
  try {
    const symbols = ProjectSymbols.scan(project);
    diagnostics = checkProject(project, spec, symbols);
  } catch (error) {
    console.log(`  !! ${dir}: ${error.message}`);
    continue;
  }
  totalFiles += files.length;
  totalDiagnostics += diagnostics.length;
  for (const d of diagnostics) byName.set(d.name, (byName.get(d.name) ?? 0) + 1);
  rows.push({ name: dir.split(/[\\/]/).slice(-1)[0], files: files.length, hits: diagnostics.length });
}

rows.sort((a, b) => b.hits - a.hits);
console.log('worst offenders:');
for (const row of rows.slice(0, 12)) {
  console.log(`  ${String(row.hits).padStart(6)}  ${String(row.files).padStart(5)} files  ${row.name}`);
}
const clean = rows.filter((r) => r.hits === 0).length;
console.log(`\nprojects fully clean: ${clean}/${rows.length}`);
console.log(`total .gml files: ${totalFiles}`);
console.log(`total diagnostics: ${totalDiagnostics}`);

console.log('\nmost frequent unknown names (these are the false positives to fix):');
for (const [name, count] of [...byName].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
  console.log(`  ${String(count).padStart(5)}  ${name}`);
}
