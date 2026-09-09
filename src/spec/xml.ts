/**
 * A minimal XML reader, enough for GameMaker's `GmlSpec.xml`.
 *
 * Handles elements, attributes, text, entities, self-closing tags, comments
 * and CDATA. It does not handle namespaces, DTDs or processing instructions
 * beyond skipping the declaration — none of which appear in the spec.
 *
 * Written rather than pattern-matched because the file contains 26
 * self-closing `<Function/>` tags and 106 multi-line descriptions, both of
 * which a regex quietly gets wrong.
 */

export interface XmlElement {
  name: string;
  attributes: Record<string, string>;
  children: XmlElement[];
  /** Direct text content, entity-decoded and trimmed. */
  text: string;
}

export class XmlParseError extends Error {
  constructor(message: string, offset: number) {
    super(`${message} at offset ${offset}`);
    this.name = 'XmlParseError';
  }
}

const NAMED_ENTITIES: Record<string, string> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export function decodeEntities(text: string): string {
  if (text.indexOf('&') === -1) return text;
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body] ?? whole;
  });
}

export function parseXml(source: string): XmlElement {
  let i = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  const n = source.length;

  const isSpace = (c: string) => c === ' ' || c === '\t' || c === '\n' || c === '\r';
  function ws(): void {
    while (i < n && isSpace(source[i]!)) i++;
  }

  function readName(): string {
    const start = i;
    while (i < n && !isSpace(source[i]!) && source[i] !== '>' && source[i] !== '/' && source[i] !== '=') {
      i++;
    }
    if (i === start) throw new XmlParseError('Expected a name', i);
    return source.slice(start, i);
  }

  /** Skip anything that is not an element: declarations, comments, doctypes. */
  function skipNonElement(): boolean {
    if (source.startsWith('<?', i)) {
      const end = source.indexOf('?>', i);
      i = end === -1 ? n : end + 2;
      return true;
    }
    if (source.startsWith('<!--', i)) {
      const end = source.indexOf('-->', i);
      i = end === -1 ? n : end + 3;
      return true;
    }
    if (source.startsWith('<!DOCTYPE', i)) {
      const end = source.indexOf('>', i);
      i = end === -1 ? n : end + 1;
      return true;
    }
    return false;
  }

  function readElement(): XmlElement {
    if (source[i] !== '<') throw new XmlParseError('Expected "<"', i);
    i++;
    const name = readName();
    const attributes: Record<string, string> = {};

    for (;;) {
      ws();
      if (i >= n) throw new XmlParseError(`Unterminated tag <${name}>`, i);
      if (source[i] === '/' && source[i + 1] === '>') {
        i += 2;
        return { name, attributes, children: [], text: '' };
      }
      if (source[i] === '>') {
        i++;
        break;
      }
      const attribute = readName();
      ws();
      if (source[i] !== '=') throw new XmlParseError(`Expected "=" after ${attribute}`, i);
      i++;
      ws();
      const quote = source[i];
      if (quote !== '"' && quote !== "'") throw new XmlParseError('Expected a quoted value', i);
      i++;
      const start = i;
      while (i < n && source[i] !== quote) i++;
      attributes[attribute] = decodeEntities(source.slice(start, i));
      i++;
    }

    const children: XmlElement[] = [];
    let text = '';
    for (;;) {
      if (i >= n) throw new XmlParseError(`Unclosed element <${name}>`, i);
      if (source.startsWith('</', i)) {
        i += 2;
        const closing = readName();
        if (closing !== name) {
          throw new XmlParseError(`Expected </${name}> but found </${closing}>`, i);
        }
        ws();
        if (source[i] !== '>') throw new XmlParseError(`Expected ">" closing ${name}`, i);
        i++;
        return { name, attributes, children, text: text.trim() };
      }
      if (source.startsWith('<![CDATA[', i)) {
        const end = source.indexOf(']]>', i);
        const stop = end === -1 ? n : end;
        text += source.slice(i + 9, stop);
        i = end === -1 ? n : end + 3;
        continue;
      }
      if (source[i] === '<') {
        if (skipNonElement()) continue;
        children.push(readElement());
        continue;
      }
      const start = i;
      while (i < n && source[i] !== '<') i++;
      text += decodeEntities(source.slice(start, i));
    }
  }

  for (;;) {
    ws();
    if (i >= n) throw new XmlParseError('No root element', i);
    if (skipNonElement()) continue;
    return readElement();
  }
}

/** Direct children with the given tag name. */
export function childrenNamed(element: XmlElement, name: string): XmlElement[] {
  return element.children.filter((child) => child.name === name);
}

/** First descendant with the given tag name, breadth-first. */
export function findDescendant(element: XmlElement, name: string): XmlElement | undefined {
  const queue = [...element.children];
  while (queue.length) {
    const next = queue.shift()!;
    if (next.name === name) return next;
    queue.push(...next.children);
  }
  return undefined;
}
