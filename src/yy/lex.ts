/**
 * Tokenizer for GameMaker's `.yy` / `.yyp` dialect of JSON.
 *
 * Departures from JSON that this handles:
 *   - trailing commas after every object member and array element
 *   - `": "` (old format) and `":"` (current format) after keys
 *   - integers beyond Number.MAX_SAFE_INTEGER, and floats whose written
 *     precision is meaningful (`1.0` is not `1`)
 *   - a leading BOM, CRLF or LF line endings, and no trailing newline at EOF
 *
 * Every node carries the byte range it occupies in the source. Nothing is
 * decoded eagerly: scalars keep their verbatim source text. That is what lets
 * `YyDoc` edit a file by splicing bytes instead of re-serializing it, which is
 * the only way to survive GameMaker's per-version formatting drift.
 */

export type YyNode = YyScalar | YyObject | YyArray;

export interface YyScalar {
  kind: 'scalar';
  start: number;
  end: number;
  /** Verbatim source text, including quotes for strings. */
  raw: string;
}

export interface YyMember {
  /** Decoded key text, without surrounding quotes. */
  key: string;
  /** Start of the key's opening quote. Same as `start`. */
  keyStart: number;
  /** Start of the value, after the colon and any whitespace. */
  valueStart: number;
  value: YyNode;
  /** Start of the key's opening quote. */
  start: number;
  /** Just past the value, before any whitespace or comma. */
  valueEnd: number;
  /** Whether a comma follows. Current-format files always have one; older
   *  files omit it on the final member. */
  hasComma: boolean;
  /** `valueEnd`, or just past the trailing comma when there is one. Never
   *  includes surrounding whitespace. */
  end: number;
}

export interface YyObject {
  kind: 'object';
  start: number;
  end: number;
  /** True when the members begin on the same line as the opening brace. */
  inline: boolean;
  members: YyMember[];
  /** Just past the opening brace. */
  contentStart: number;
  /** Position of the closing brace. */
  contentEnd: number;
}

export interface YyElement {
  value: YyNode;
  start: number;
  /** Just past the value, before any whitespace or comma. */
  valueEnd: number;
  /** Whether a comma follows. */
  hasComma: boolean;
  /** `valueEnd`, or just past the trailing comma when there is one. */
  end: number;
}

export interface YyArray {
  kind: 'array';
  start: number;
  end: number;
  /** True when the elements begin on the same line as the opening bracket. */
  inline: boolean;
  elements: YyElement[];
  /** Just past the opening bracket. */
  contentStart: number;
  /** Position of the closing bracket. */
  contentEnd: number;
}

export class YyParseError extends Error {
  constructor(
    message: string,
    readonly offset: number,
  ) {
    super(`${message} at offset ${offset}`);
    this.name = 'YyParseError';
  }
}

const CH_TAB = 9;
const CH_LF = 10;
const CH_CR = 13;
const CH_SPACE = 32;
const CH_QUOTE = 34;
const CH_BACKSLASH = 92;
const CH_BOM = 0xfeff;

/** Decode a quoted source string into its text value. */
export function unquote(raw: string): string {
  const body = raw.slice(1, -1);
  if (body.indexOf('\\') === -1) return body;
  let out = '';
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== '\\') {
      out += body[i];
      continue;
    }
    const c = body[++i];
    switch (c) {
      case 'n': out += '\n'; break;
      case 't': out += '\t'; break;
      case 'r': out += '\r'; break;
      case 'b': out += '\b'; break;
      case 'f': out += '\f'; break;
      case 'u':
        out += String.fromCharCode(parseInt(body.slice(i + 1, i + 5), 16));
        i += 4;
        break;
      default: out += c;
    }
  }
  return out;
}

export function parseYy(src: string): YyNode {
  const n = src.length;
  let i = 0;

  function ws(): void {
    while (i < n) {
      const c = src.charCodeAt(i);
      if (c === CH_SPACE || c === CH_LF || c === CH_CR || c === CH_TAB || c === CH_BOM) i++;
      else break;
    }
  }

  function readString(): { raw: string; value: string } {
    const start = i;
    i++; // opening quote
    while (i < n && src.charCodeAt(i) !== CH_QUOTE) {
      if (src.charCodeAt(i) === CH_BACKSLASH) i += 2;
      else i++;
    }
    if (i >= n) throw new YyParseError('Unterminated string', start);
    i++; // closing quote
    const raw = src.slice(start, i);
    return { raw, value: unquote(raw) };
  }

  /** Numbers, `true`, `false`, `null` — kept verbatim. */
  function readLiteral(): string {
    const start = i;
    while (i < n) {
      const c = src[i];
      if (c === ',' || c === '}' || c === ']') break;
      const cc = src.charCodeAt(i);
      if (cc === CH_SPACE || cc === CH_LF || cc === CH_CR || cc === CH_TAB) break;
      i++;
    }
    if (i === start) throw new YyParseError(`Unexpected character ${JSON.stringify(src[i])}`, i);
    return src.slice(start, i);
  }

  function readObject(): YyObject {
    const start = i;
    i++; // {
    const contentStart = i;
    ws();
    const inline = src.slice(contentStart, i).indexOf('\n') === -1;
    const members: YyMember[] = [];
    for (;;) {
      ws();
      if (i >= n) throw new YyParseError('Unterminated object', start);
      if (src[i] === '}') break;
      const mStart = i;
      if (src.charCodeAt(i) !== CH_QUOTE) throw new YyParseError('Expected object key', i);
      const key = readString();
      ws();
      if (src[i] !== ':') throw new YyParseError('Expected ":" after object key', i);
      i++;
      ws();
      const valueStart = i;
      const value = readValue();
      const valueEnd = i;
      ws();
      const hasComma = src[i] === ',';
      if (hasComma) i++;
      members.push({
        key: key.value,
        keyStart: mStart,
        valueStart,
        value,
        start: mStart,
        valueEnd,
        hasComma,
        end: hasComma ? i : valueEnd,
      });
    }
    const contentEnd = i;
    i++; // }
    return { kind: 'object', start, end: i, inline, members, contentStart, contentEnd };
  }

  function readArray(): YyArray {
    const start = i;
    i++; // [
    const contentStart = i;
    ws();
    const inline = src.slice(contentStart, i).indexOf('\n') === -1;
    const elements: YyElement[] = [];
    for (;;) {
      ws();
      if (i >= n) throw new YyParseError('Unterminated array', start);
      if (src[i] === ']') break;
      const eStart = i;
      const value = readValue();
      const valueEnd = i;
      ws();
      const hasComma = src[i] === ',';
      if (hasComma) i++;
      elements.push({ value, start: eStart, valueEnd, hasComma, end: hasComma ? i : valueEnd });
    }
    const contentEnd = i;
    i++; // ]
    return { kind: 'array', start, end: i, inline, elements, contentStart, contentEnd };
  }

  function readValue(): YyNode {
    ws();
    if (i >= n) throw new YyParseError('Unexpected end of input', i);
    const c = src[i];
    if (c === '{') return readObject();
    if (c === '[') return readArray();
    const start = i;
    const raw = src.charCodeAt(i) === CH_QUOTE ? readString().raw : readLiteral();
    return { kind: 'scalar', start, end: i, raw };
  }

  const root = readValue();
  ws();
  if (i < n) throw new YyParseError('Trailing content after root value', i);
  return root;
}
