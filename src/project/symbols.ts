/**
 * What a project's own GML defines, and a checker for what it calls.
 *
 * The point is to catch invented functions. An agent that is confident will
 * not consult a reference, so grounding has to happen after the fact: scan
 * what the code calls, and report anything that exists in neither the runtime
 * spec nor the project.
 *
 * The checker is deliberately conservative. A false positive costs more than a
 * false negative here — an agent that learns to distrust the checker will
 * ignore the real findings too — so anything ambiguous is treated as valid.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { GmlSpec } from '../spec/index.js';
import type { GmProject } from './project.js';

/** Control-flow and declaration keywords that are followed by `(`. */
const KEYWORDS = new Set([
  'if', 'else', 'while', 'for', 'do', 'until', 'repeat', 'switch', 'case',
  'default', 'break', 'continue', 'return', 'exit', 'with', 'var', 'globalvar',
  'function', 'constructor', 'new', 'delete', 'throw', 'try', 'catch', 'finally',
  'static', 'enum', 'and', 'or', 'not', 'xor', 'div', 'mod', 'begin', 'end',
  'then', 'self', 'other', 'all', 'noone', 'global', 'undefined', 'true', 'false',
]);

export interface SymbolDefinition {
  name: string;
  kind: 'function' | 'macro' | 'enum' | 'global' | 'resource';
  /** Project-relative file it is declared in, when known. */
  file?: string;
}

export interface Diagnostic {
  file: string;
  line: number;
  column: number;
  name: string;
  message: string;
  /** Near matches from the spec and the project. */
  suggestions: string[];
}

/**
 * Blank out comments and string literals, preserving length so byte offsets
 * still map to the original source.
 *
 * GML strings come in several forms: `"..."` with escapes, verbatim `@"..."`
 * and `@'...'`, and template `$"...{expr}..."`. Template interpolations are
 * left intact, since they contain real code.
 */
export function stripCommentsAndStrings(code: string): string {
  const out = code.split('');
  const blank = (from: number, to: number): void => {
    for (let i = from; i < to && i < out.length; i++) {
      if (out[i] !== '\n') out[i] = ' ';
    }
  };

  let i = 0;
  while (i < code.length) {
    const ch = code[i]!;
    const next = code[i + 1];

    if (ch === '/' && next === '/') {
      const end = code.indexOf('\n', i);
      blank(i, end === -1 ? code.length : end);
      i = end === -1 ? code.length : end;
      continue;
    }
    // `#region Some free text (with parens)` — the label is prose, not code.
    if (ch === '#' && /^#(?:region|endregion)\b/.test(code.slice(i, i + 11))) {
      const end = code.indexOf('\n', i);
      blank(i, end === -1 ? code.length : end);
      i = end === -1 ? code.length : end;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = code.indexOf('*/', i + 2);
      blank(i, end === -1 ? code.length : end + 2);
      i = end === -1 ? code.length : end + 2;
      continue;
    }
    // Verbatim strings: no escape processing.
    if (ch === '@' && (next === '"' || next === "'")) {
      const end = code.indexOf(next, i + 2);
      blank(i, end === -1 ? code.length : end + 1);
      i = end === -1 ? code.length : end + 1;
      continue;
    }
    // Template string: blank the literal text but keep `{expr}` contents,
    // which are real code and can contain real calls.
    if (ch === '$' && next === '"') {
      let j = i + 2;
      blank(i, j);
      let depth = 0;
      let literalStart = j;
      while (j < code.length) {
        const c = code[j]!;
        if (c === '\\') {
          j += 2;
          continue;
        }
        if (c === '{') {
          if (depth === 0) {
            blank(literalStart, j);
            out[j] = ' ';
          }
          depth++;
        } else if (c === '}' && depth > 0) {
          depth--;
          if (depth === 0) {
            out[j] = ' ';
            literalStart = j + 1;
          }
        } else if (c === '"' && depth === 0) {
          break;
        }
        j++;
      }
      blank(literalStart, j);
      if (j < code.length) out[j] = ' ';
      i = j + 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < code.length) {
        if (code[j] === '\\') {
          j += 2;
          continue;
        }
        if (code[j] === ch) break;
        j++;
      }
      blank(i, Math.min(j + 1, code.length));
      i = j + 1;
      continue;
    }
    i++;
  }
  return out.join('');
}

/** Names this file assigns to, so locally-held function values are not flagged. */
function locallyBound(code: string): Set<string> {
  const bound = new Set<string>();
  // Functions declared in the very file being checked. The project symbol
  // table is built from disk, so a file that has not been written yet — the
  // usual case when checking an agent's edit — would not be represented.
  for (const match of code.matchAll(/\bfunction\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
    bound.add(match[1]!);
  }
  for (const match of code.matchAll(/\b(?:var|static|globalvar)\s+([A-Za-z_][A-Za-z0-9_]*)/g)) {
    bound.add(match[1]!);
  }
  // `foo = function() {}`, `foo = method(...)`, and plain assignment.
  for (const match of code.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*=[^=]/g)) bound.add(match[1]!);
  // Struct-literal methods: `{ tick: function() {} }`.
  for (const match of code.matchAll(
    /([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(?:function\b|method\s*\()/g,
  )) {
    bound.add(match[1]!);
  }
  // Function parameters, including default values.
  for (const match of code.matchAll(/\bfunction\s*[A-Za-z0-9_]*\s*\(([^)]*)\)/g)) {
    for (const parameter of match[1]!.split(',')) {
      const name = /^\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(parameter);
      if (name) bound.add(name[1]!);
    }
  }
  return bound;
}

export class ProjectSymbols {
  private constructor(readonly definitions: Map<string, SymbolDefinition>) {}

  /** Scan every `.gml` in the project, plus resources and extensions. */
  static scan(project: GmProject): ProjectSymbols {
    const definitions = new Map<string, SymbolDefinition>();
    const define = (name: string, kind: SymbolDefinition['kind'], file?: string): void => {
      if (name && !definitions.has(name)) definitions.set(name, { name, kind, file });
    };

    for (const resource of project.resources()) {
      define(resource.name, 'resource', resource.path);
      // Extensions declare whole APIs — Steamworks alone contributes hundreds
      // of functions that exist in no .gml and in no runtime spec.
      if (resource.path.startsWith('extensions/')) {
        for (const declared of extensionSymbols(project, resource.path)) {
          define(declared.name, declared.kind, resource.path);
        }
      }
    }

    for (const file of gmlFiles(project.root)) {
      let raw: string;
      try {
        raw = readFileSync(join(project.root, file), 'utf8');
      } catch {
        continue;
      }
      const code = stripCommentsAndStrings(raw);
      for (const match of code.matchAll(/\bfunction\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
        define(match[1]!, 'function', file);
      }
      // Methods on structs and constructors: `static tick = function() {}`.
      // Sibling methods and subclasses call these bare, and resolving that
      // properly needs type inference we do not have — so treat every such
      // name as callable rather than report calls we cannot prove wrong.
      for (const match of code.matchAll(
        /(?:\bstatic\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*[=:]\s*(?:function\b|method\s*\()/g,
      )) {
        define(match[1]!, 'function', file);
      }
      for (const match of code.matchAll(/#macro\s+(?:[A-Za-z_][A-Za-z0-9_]*:)?([A-Za-z_][A-Za-z0-9_]*)/g)) {
        define(match[1]!, 'macro', file);
      }
      for (const match of code.matchAll(/\benum\s+([A-Za-z_][A-Za-z0-9_]*)/g)) {
        define(match[1]!, 'enum', file);
      }
      for (const match of code.matchAll(/\bglobal\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)/g)) {
        define(match[1]!, 'global', file);
      }
    }
    return new ProjectSymbols(definitions);
  }

  has(name: string): boolean {
    return this.definitions.has(name);
  }

  get(name: string): SymbolDefinition | undefined {
    return this.definitions.get(name);
  }

  names(): string[] {
    return [...this.definitions.keys()];
  }

  get size(): number {
    return this.definitions.size;
  }
}

/**
 * Functions and constants an extension declares.
 *
 * They live in the extension's `.yy` as objects tagged
 * `GMExtensionFunction` / `GMExtensionConstant`, nested under a `files` array
 * whose shape has changed between GameMaker versions — so walk the decoded
 * tree looking for the tag rather than following a fixed path.
 */
function extensionSymbols(
  project: GmProject,
  path: string,
): { name: string; kind: SymbolDefinition['kind'] }[] {
  let decoded: unknown;
  try {
    decoded = project.readDoc(path).get([]);
  } catch {
    return [];
  }

  const found: { name: string; kind: SymbolDefinition['kind'] }[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    const type = record.resourceType;
    if (typeof record.name === 'string') {
      if (type === 'GMExtensionFunction') found.push({ name: record.name, kind: 'function' });
      else if (type === 'GMExtensionConstant') found.push({ name: record.name, kind: 'macro' });
    }
    for (const value of Object.values(record)) visit(value);
  };
  visit(decoded);
  return found;
}

/** Every `.gml` file under `root`, project-relative. */
export function gmlFiles(root: string, relative = '', depth = 0): string[] {
  if (depth > 8) return [];
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(join(root, relative));
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === '.gml-mcp' || entry === '.git' || entry === 'node_modules') continue;
    const next = relative ? `${relative}/${entry}` : entry;
    try {
      if (statSync(join(root, next)).isDirectory()) out.push(...gmlFiles(root, next, depth + 1));
      else if (entry.endsWith('.gml')) out.push(next);
    } catch {
      continue;
    }
  }
  return out;
}

/**
 * Report calls to functions that exist in neither the runtime spec nor the
 * project.
 *
 * Skipped deliberately, to avoid crying wolf: anything after a `.` (a struct
 * or instance method), anything the file assigns to (a function held in a
 * variable), keywords, and declaration sites themselves.
 */
export function checkGml(
  code: string,
  file: string,
  spec: GmlSpec,
  symbols: ProjectSymbols,
): Diagnostic[] {
  const source = stripCommentsAndStrings(code);
  const bound = locallyBound(source);
  const diagnostics: Diagnostic[] = [];

  for (const match of source.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
    const name = match[1]!;
    const at = match.index!;

    if (KEYWORDS.has(name) || bound.has(name)) continue;
    if (spec.has(name) || symbols.has(name)) continue;

    // A method call on something else is not ours to validate.
    const before = source.slice(0, at).trimEnd();
    if (before.endsWith('.')) continue;
    // `function foo(` is a declaration, not a call.
    if (/\b(?:function|enum|constructor)\s*$/.test(before)) continue;

    const upTo = code.slice(0, at);
    const line = upTo.split('\n').length;
    const column = at - (upTo.lastIndexOf('\n') + 1) + 1;

    const suggestions = [
      ...spec.suggest(name, 2),
      ...symbols.names().filter((candidate) => nearby(name, candidate)).slice(0, 1),
    ];

    diagnostics.push({
      file,
      line,
      column,
      name,
      message: `Unknown function '${name}'`,
      suggestions: [...new Set(suggestions)],
    });
  }
  return diagnostics;
}

/** Cheap similarity check for project symbols, which are few enough to scan. */
function nearby(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 2) return false;
  const lower = a.toLowerCase();
  const other = b.toLowerCase();
  return lower !== other && (other.startsWith(lower.slice(0, 4)) || lower.startsWith(other.slice(0, 4)));
}

/** Check every `.gml` file in a project. */
export function checkProject(
  project: GmProject,
  spec: GmlSpec,
  symbols = ProjectSymbols.scan(project),
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const file of gmlFiles(project.root)) {
    let code: string;
    try {
      code = readFileSync(join(project.root, file), 'utf8');
    } catch {
      continue;
    }
    diagnostics.push(...checkGml(code, file, spec, symbols));
  }
  return diagnostics;
}
