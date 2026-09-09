/**
 * The GML API, read from the runtime's own `GmlSpec.xml`.
 *
 * This is Feather's type database, shipped with every GameMaker runtime. It
 * carries typed parameters, return types and descriptions for the whole
 * standard library, which makes it the authority on what GML actually
 * contains — for the exact runtime the user has installed, not a version we
 * guessed at.
 *
 * Read from the user's install rather than vendored: correct per version, and
 * it sidesteps redistributing GameMaker's documentation.
 */

import { readFileSync } from 'node:fs';
import { childrenNamed, findDescendant, parseXml, type XmlElement } from './xml.js';

export interface GmlParameter {
  name: string;
  type: string;
  optional: boolean;
  description: string;
}

export interface GmlFunction {
  kind: 'function';
  name: string;
  returns: string;
  deprecated: boolean;
  /** No side effects — safe to call speculatively. */
  pure: boolean;
  description: string;
  parameters: GmlParameter[];
}

export interface GmlVariable {
  kind: 'variable';
  name: string;
  type: string;
  deprecated: boolean;
  readable: boolean;
  writable: boolean;
  /** Belongs to an instance rather than being global. */
  instance: boolean;
  description: string;
}

export interface GmlConstant {
  kind: 'constant';
  name: string;
  type: string;
  /** Grouping such as `AssetType` or `BlendMode`. */
  class: string;
  deprecated: boolean;
  description: string;
}

export interface GmlStructure {
  kind: 'structure';
  name: string;
  fields: { name: string; type: string; description: string }[];
}

export interface GmlEnum {
  kind: 'enum';
  name: string;
  members: { name: string; value: string; description: string }[];
}

export type GmlEntry = GmlFunction | GmlVariable | GmlConstant | GmlStructure | GmlEnum;

export interface SearchResult {
  entry: GmlEntry;
  /** Higher is a better match. */
  score: number;
}

const bool = (element: XmlElement, name: string, fallback = false): boolean => {
  const value = element.attributes[name];
  return value === undefined ? fallback : value === 'true';
};

export class GmlSpec {
  private readonly byName = new Map<string, GmlEntry>();

  private constructor(
    /** `RuntimeVersion` attribute from the spec file. */
    readonly runtimeVersion: string,
    readonly functions: GmlFunction[],
    readonly variables: GmlVariable[],
    readonly constants: GmlConstant[],
    readonly structures: GmlStructure[],
    readonly enums: GmlEnum[],
  ) {
    for (const entry of [...functions, ...variables, ...constants, ...structures, ...enums]) {
      // Functions win a name collision: they are what code calls.
      if (!this.byName.has(entry.name) || entry.kind === 'function') {
        this.byName.set(entry.name, entry);
      }
    }
  }

  static load(specPath: string): GmlSpec {
    return GmlSpec.parse(readFileSync(specPath, 'utf8'));
  }

  static parse(xml: string): GmlSpec {
    const root = parseXml(xml);
    const section = (name: string): XmlElement[] => {
      const container = findDescendant(root, name);
      return container ? container.children : [];
    };

    const functions: GmlFunction[] = section('Functions')
      .filter((element) => element.name === 'Function')
      .map((element) => ({
        kind: 'function' as const,
        name: element.attributes.Name ?? '',
        returns: element.attributes.ReturnType ?? 'Any',
        deprecated: bool(element, 'Deprecated'),
        pure: bool(element, 'Pure'),
        description: childrenNamed(element, 'Description')[0]?.text ?? '',
        parameters: childrenNamed(element, 'Parameter').map((parameter) => ({
          name: parameter.attributes.Name ?? '',
          type: parameter.attributes.Type ?? 'Any',
          optional: bool(parameter, 'Optional'),
          description: parameter.text,
        })),
      }));

    const variables: GmlVariable[] = section('Variables')
      .filter((element) => element.name === 'Variable')
      .map((element) => ({
        kind: 'variable' as const,
        name: element.attributes.Name ?? '',
        type: element.attributes.Type ?? 'Any',
        deprecated: bool(element, 'Deprecated'),
        readable: bool(element, 'Get', true),
        writable: bool(element, 'Set', true),
        instance: bool(element, 'Instance'),
        description: element.text,
      }));

    const constants: GmlConstant[] = section('Constants')
      .filter((element) => element.name === 'Constant')
      .map((element) => ({
        kind: 'constant' as const,
        name: element.attributes.Name ?? '',
        type: element.attributes.Type ?? 'Any',
        class: element.attributes.Class ?? '',
        deprecated: bool(element, 'Deprecated'),
        description: element.text,
      }));

    const structures: GmlStructure[] = section('Structures')
      .filter((element) => element.name === 'Structure')
      .map((element) => ({
        kind: 'structure' as const,
        name: element.attributes.Name ?? '',
        fields: childrenNamed(element, 'Field').map((field) => ({
          name: field.attributes.Name ?? '',
          type: field.attributes.Type ?? 'Any',
          description: field.text,
        })),
      }));

    const enums: GmlEnum[] = section('Enumerations')
      .filter((element) => element.name === 'Enumeration')
      .map((element) => ({
        kind: 'enum' as const,
        name: element.attributes.Name ?? '',
        members: childrenNamed(element, 'Member').map((member) => ({
          name: member.attributes.Name ?? '',
          value: member.attributes.Value ?? '',
          description: member.text,
        })),
      }));

    return new GmlSpec(
      root.attributes.RuntimeVersion ?? 'unknown',
      functions,
      variables,
      constants,
      structures,
      enums,
    );
  }

  get size(): number {
    return this.byName.size;
  }

  /** Every name the standard library defines. */
  names(): string[] {
    return [...this.byName.keys()];
  }

  has(name: string): boolean {
    return this.byName.has(name);
  }

  lookup(name: string): GmlEntry | undefined {
    return this.byName.get(name);
  }

  /**
   * Rank entries against a query.
   *
   * Exact and prefix matches on the name come first, then substring matches,
   * then description hits — so `buffer write` finds `buffer_write` before
   * every function whose docs happen to mention buffers.
   */
  search(query: string, limit = 20): SearchResult[] {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    const terms = needle.split(/\s+/);
    const results: SearchResult[] = [];

    for (const entry of this.byName.values()) {
      const name = entry.name.toLowerCase();
      const description = 'description' in entry ? entry.description.toLowerCase() : '';
      let score = 0;

      if (name === needle) score = 1000;
      else if (name.startsWith(needle)) score = 500 - name.length;
      else if (name.includes(needle)) score = 250 - name.length;
      else if (terms.length > 1 && terms.every((term) => name.includes(term))) {
        score = 200 - name.length;
      } else if (terms.every((term) => description.includes(term))) score = 50;

      if (score > 0) {
        if ('deprecated' in entry && entry.deprecated) score -= 400;
        results.push({ entry, score });
      }
    }

    return results
      .sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name))
      .slice(0, limit);
  }

  /** Nearest names by edit distance, for "did you mean". */
  suggest(name: string, limit = 3): string[] {
    const target = name.toLowerCase();
    const scored: { name: string; distance: number }[] = [];
    for (const candidate of this.byName.keys()) {
      // Cheap gate: an edit distance beyond a third of the length is not a typo.
      if (Math.abs(candidate.length - target.length) > Math.ceil(target.length / 3)) continue;
      const distance = editDistance(target, candidate.toLowerCase(), Math.ceil(target.length / 3));
      if (distance !== undefined) scored.push({ name: candidate, distance });
    }
    return scored
      .sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name))
      .slice(0, limit)
      .map((s) => s.name);
  }
}

/** A function's call signature, e.g. `buffer_write(buffer: Id.Buffer, ...): Real`. */
export function signatureOf(entry: GmlFunction): string {
  const parameters = entry.parameters
    .map((p) => `${p.name}${p.optional ? '?' : ''}: ${p.type}`)
    .join(', ');
  return `${entry.name}(${parameters}): ${entry.returns}`;
}

/** One-line summary used in search results. */
export function summarize(entry: GmlEntry): string {
  switch (entry.kind) {
    case 'function':
      return signatureOf(entry);
    case 'variable':
      return `${entry.name}: ${entry.type}${entry.writable ? '' : ' (read-only)'}`;
    case 'constant':
      return `${entry.name}: ${entry.type}${entry.class ? ` [${entry.class}]` : ''}`;
    case 'structure':
      return `struct ${entry.name} { ${entry.fields.map((f) => f.name).join(', ')} }`;
    case 'enum':
      return `enum ${entry.name} { ${entry.members.map((m) => m.name).join(', ')} }`;
  }
}

/** Levenshtein distance, abandoned once it exceeds `max`. */
function editDistance(a: string, b: string, max: number): number | undefined {
  if (a === b) return 0;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost);
      current.push(value);
      if (value < best) best = value;
    }
    if (best > max) return undefined;
    previous = current;
  }
  const distance = previous[b.length]!;
  return distance > max ? undefined : distance;
}
