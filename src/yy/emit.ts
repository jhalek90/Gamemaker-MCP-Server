/**
 * Serialization for NEW subtrees only.
 *
 * We never re-serialize a file we parsed — see `YyDoc`. This module exists
 * solely to render values that have no existing source text: a freshly created
 * resource, a new room instance, a new event entry.
 *
 * That narrow scope is deliberate. GameMaker's own formatting rules are not
 * expressible as a clean function (a corpus sweep of 35,919 files put a
 * depth-plus-array-context rule at ~82% byte-exact, with keys like `Channels`
 * and `ConfigValues` needing hardcoded exceptions), and they shift between
 * releases. Getting the layout of a brand-new subtree slightly wrong is
 * harmless: it is valid, GameMaker reads it, and the IDE normalizes it on the
 * next save. Getting an EXISTING file's layout wrong corrupts a user's diff.
 */

import { sortKey } from './sort.js';

/** Wraps verbatim source text, bypassing all encoding. */
export class Raw {
  constructor(readonly text: string) {}
}

/**
 * Emit a number exactly as written. Use for any field where GameMaker's
 * written precision matters — `"imageSpeed":1.0` must not become `1`, or every
 * instance in every room shows up in the diff.
 */
export function raw(text: string): Raw {
  return new Raw(text);
}

export type YyValue =
  | Raw
  | string
  | number
  | boolean
  | null
  | YyValue[]
  | { [key: string]: YyValue };

const ESCAPES: Record<string, string> = {
  '\\': '\\\\',
  '"': '\\"',
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
  '\b': '\\b',
  '\f': '\\f',
};

export function quote(text: string): string {
  let out = '"';
  for (const ch of text) {
    const esc = ESCAPES[ch];
    if (esc) out += esc;
    else if (ch < ' ') out += '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0');
    else out += ch;
  }
  return out + '"';
}

export interface EmitOptions {
  /** Line ending of the target document. */
  eol: string;
  /** Indentation of the line the value will be placed on. */
  indent: string;
}

/**
 * Render `value` as GameMaker-style text.
 *
 * Layout follows the dominant pattern in the corpus: objects inline, arrays
 * inline unless their elements are objects, trailing comma on everything.
 */
export function emit(value: YyValue, options: EmitOptions): string {
  return render(value, options.indent, options.eol);
}

function render(value: YyValue, indent: string, eol: string): string {
  if (value instanceof Raw) return value.text;
  if (value === null) return 'null';
  if (typeof value === 'string') return quote(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`Cannot emit non-finite number: ${value}`);
    // Integers reach GameMaker as bare integers; anything else keeps the
    // precision JavaScript prints. Callers who need `1.0` must use raw().
    return String(value);
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const expand = value.every((el) => isPlainObject(el));
    if (!expand) return '[' + value.map((el) => render(el, indent, eol) + ',').join('') + ']';
    const inner = indent + '  ';
    return (
      '[' + eol +
      value.map((el) => inner + render(el, inner, eol) + ',' + eol).join('') +
      indent + ']'
    );
  }

  const keys = Object.keys(value).sort((a, b) => {
    const ka = sortKey(a);
    const kb = sortKey(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  if (keys.length === 0) return '{}';
  return (
    '{' +
    keys.map((k) => quote(k) + ':' + render(value[k]!, indent, eol) + ',').join('') +
    '}'
  );
}

function isPlainObject(value: YyValue): value is { [key: string]: YyValue } {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Raw)
  );
}
