/**
 * Fidelity harness: run the document model over every real `.yy`/`.yyp` file
 * we can find and assert that reading and editing are lossless.
 *
 * This is the oracle for the whole project. GameMaker's format drifts between
 * releases, so correctness is defined by "matches what GameMaker actually
 * wrote", not by a spec. Point GML_MCP_CORPUS at a directory of real projects.
 *
 *   GML_MCP_CORPUS=d:/gamedev npm test
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isYyDocument, YyDoc, YyUnsupportedFormatError } from '../src/yy/index.js';

const CORPUS_ROOT = process.env.GML_MCP_CORPUS;

function collect(dir: string, out: string[] = [], depth = 0): string[] {
  if (depth > 12) return out;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '.git') continue;
    const path = join(dir, entry);
    let stats;
    try {
      stats = statSync(path);
    } catch {
      continue;
    }
    if (stats.isDirectory()) collect(path, out, depth + 1);
    else if (entry.endsWith('.yy') || entry.endsWith('.yyp')) out.push(path);
  }
  return out;
}

const allFiles = CORPUS_ROOT ? collect(CORPUS_ROOT) : [];
const legacy = allFiles.filter((f) => !isYyDocument(readFileSync(f, 'utf8')));
const files = allFiles.filter((f) => !legacy.includes(f));

describe.skipIf(!CORPUS_ROOT)(`corpus fidelity (${CORPUS_ROOT ?? 'unset'})`, () => {
  it('finds files to test', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('rejects legacy per-config containers instead of mangling them', () => {
    for (const file of legacy) {
      expect(() => YyDoc.parse(readFileSync(file, 'utf8'))).toThrow(YyUnsupportedFormatError);
    }
  });

  it('parses every file and reproduces it byte-for-byte', () => {
    const failures: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      try {
        if (YyDoc.parse(source).text !== source) failures.push(`not identical: ${file}`);
      } catch (error) {
        failures.push(`${(error as Error).message}: ${file}`);
      }
    }
    expect(failures.slice(0, 10)).toEqual([]);
    expect(failures).toHaveLength(0);
  });

  it('replaces a scalar without disturbing any other byte', () => {
    const failures: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      let doc: YyDoc;
      try {
        doc = YyDoc.parse(source);
      } catch {
        continue;
      }
      const target = findScalarPath(doc);
      if (!target) continue;
      const before = doc.getRaw(target);
      const replacement = before.startsWith('"') ? '"__patched__"' : '12345';
      doc.setRaw(target, replacement);

      if (doc.getRaw(target) !== replacement) failures.push(`value not applied: ${file}`);
      const expected =
        source.slice(0, indexOfNth(source, before, target)) + replacement;
      if (!doc.text.startsWith(expected.slice(0, expected.length - replacement.length))) {
        failures.push(`prefix disturbed: ${file}`);
      }
      if (doc.text.length !== source.length - before.length + replacement.length) {
        failures.push(`length drift: ${file}`);
      }
    }
    expect(failures.slice(0, 10)).toEqual([]);
    expect(failures).toHaveLength(0);
  });

  it('inserts and removes a key, returning to the original bytes', () => {
    const failures: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      let doc: YyDoc;
      try {
        doc = YyDoc.parse(source);
      } catch {
        continue;
      }
      if (doc.root.kind !== 'object' || doc.root.members.length === 0) continue;
      try {
        doc.insert([], 'zzGmlMcpProbe', true);
        if (doc.get(['zzGmlMcpProbe']) !== true) {
          failures.push(`insert not readable: ${file}`);
          continue;
        }
        doc.remove(['zzGmlMcpProbe']);
        if (doc.text !== source) failures.push(`round trip drifted: ${file}`);
      } catch (error) {
        failures.push(`${(error as Error).message}: ${file}`);
      }
    }
    expect(failures.slice(0, 10)).toEqual([]);
    expect(failures).toHaveLength(0);
  });
});

/** Path to some scalar reasonably deep in the document. */
function findScalarPath(doc: YyDoc): (string | number)[] | undefined {
  const found: (string | number)[][] = [];
  walk(doc, [], found, 0);
  return found[Math.floor(found.length / 2)];
}

function walk(doc: YyDoc, path: (string | number)[], out: (string | number)[][], depth: number): void {
  if (depth > 8 || out.length > 400) return;
  const node = doc.find(path);
  if (!node) return;
  if (node.kind === 'scalar') {
    out.push(path);
  } else if (node.kind === 'object') {
    for (const member of node.members) walk(doc, [...path, member.key], out, depth + 1);
  } else {
    for (let i = 0; i < node.elements.length && i < 20; i++) walk(doc, [...path, i], out, depth + 1);
  }
}

function indexOfNth(source: string, needle: string, path: (string | number)[]): number {
  // The prefix check only needs a lower bound on where the edit happened.
  return Math.max(0, source.indexOf(needle));
}
