import { describe, expect, it } from 'vitest';
import { YyDoc, insertIndexFor, isSorted, raw, sortKey } from '../src/yy/index.js';

const OBJECT_YY = [
  '{',
  '  "$GMObject":"",',
  '  "%Name":"objCar",',
  '  "eventList":[',
  '    {"$GMEvent":"v1","eventNum":0,"eventType":0,"resourceVersion":"2.0",},',
  '  ],',
  '  "name":"objCar",',
  '  "parent":{',
  '    "name":"NN_driving",',
  '    "path":"NN_driving.yyp",',
  '  },',
  '  "physicsDensity":0.5,',
  '  "spriteId":{"name":"sprCar","path":"sprites/sprCar/sprCar.yy",},',
  '  "visible":true,',
  '}',
].join('\n');

describe('key ordering', () => {
  it('sorts _ above letters, matching GameMaker', () => {
    expect(sortKey('bbox_bottom') > sortKey('bboxMode')).toBe(true);
    expect(isSorted(['bboxMode', 'bbox_bottom', 'collisionKind'])).toBe(true);
  });

  it('places marker keys first', () => {
    expect(isSorted(['$GMObject', '%Name', 'eventList', 'name'])).toBe(true);
  });

  it('finds the insertion index', () => {
    expect(insertIndexFor(['a', 'm', 'z'], 'n')).toBe(2);
    expect(insertIndexFor(['m', 'z'], 'a')).toBe(0);
    expect(insertIndexFor(['a', 'm'], 'z')).toBe(2);
  });
});

describe('YyDoc reading', () => {
  it('reads values by path', () => {
    const doc = YyDoc.parse(OBJECT_YY);
    expect(doc.get(['%Name'])).toBe('objCar');
    expect(doc.get(['visible'])).toBe(true);
    expect(doc.get(['spriteId', 'name'])).toBe('sprCar');
    expect(doc.get(['eventList', 0, 'eventType'])).toBe(0);
    expect(doc.length(['eventList'])).toBe(1);
  });

  it('preserves numeric literals verbatim', () => {
    const doc = YyDoc.parse('{\n  "imageSpeed":1.0,\n  "big":12345678901234567890,\n}');
    expect(doc.getRaw(['imageSpeed'])).toBe('1.0');
    expect(doc.getRaw(['big'])).toBe('12345678901234567890');
  });

  it('detects line endings and BOM', () => {
    expect(YyDoc.parse('{\r\n  "a":1,\r\n}').eol).toBe('\r\n');
    expect(YyDoc.parse('{\n  "a":1,\n}').eol).toBe('\n');
    expect(YyDoc.parse('﻿{"a":1,}').hasBom).toBe(true);
  });
});

describe('YyDoc writing', () => {
  it('changes only the bytes it must', () => {
    const doc = YyDoc.parse(OBJECT_YY);
    doc.set(['visible'], false);
    expect(doc.text).toBe(OBJECT_YY.replace('"visible":true', '"visible":false'));
  });

  it('keeps 1.0 as 1.0 when using raw()', () => {
    const doc = YyDoc.parse('{\n  "a":1.0,\n  "b":2.0,\n}');
    doc.set(['a'], raw('3.0'));
    expect(doc.text).toBe('{\n  "a":3.0,\n  "b":2.0,\n}');
  });

  it('inserts a key at its sorted position in an expanded object', () => {
    const doc = YyDoc.parse(OBJECT_YY);
    doc.insert([], 'solid', false);
    expect(doc.text).toContain('  "physicsDensity":0.5,\n  "solid":false,\n  "spriteId":');
  });

  it('inserts into an inline object without breaking the line', () => {
    const doc = YyDoc.parse(OBJECT_YY);
    doc.insert(['spriteId'], 'alpha', 1);
    expect(doc.text).toContain('"spriteId":{"alpha":1,"name":"sprCar",');
  });

  it('appends to an expanded array with matching indentation', () => {
    const doc = YyDoc.parse(OBJECT_YY);
    doc.push(['eventList'], { $GMEvent: 'v1', eventNum: 0, eventType: 3 });
    const lines = doc.text.split('\n');
    const added = lines.find((l) => l.includes('"eventType":3'))!;
    expect(added.startsWith('    {')).toBe(true);
    expect(added.endsWith(',')).toBe(true);
    expect(doc.length(['eventList'])).toBe(2);
  });

  it('uses the document line ending for inserted text', () => {
    const doc = YyDoc.parse('{\r\n  "a":1,\r\n  "z":2,\r\n}');
    doc.insert([], 'm', 5);
    expect(doc.text).toBe('{\r\n  "a":1,\r\n  "m":5,\r\n  "z":2,\r\n}');
  });

  it('removes a member without leaving a blank line', () => {
    const doc = YyDoc.parse(OBJECT_YY);
    doc.remove(['physicsDensity']);
    expect(doc.text).not.toContain('physicsDensity');
    expect(doc.text).toContain('  },\n  "spriteId":');
    expect(doc.text).not.toMatch(/\n\s*\n/);
  });

  it('removes the first member cleanly', () => {
    const doc = YyDoc.parse('{\n  "a":1,\n  "b":2,\n}');
    doc.remove(['a']);
    expect(doc.text).toBe('{\n  "b":2,\n}');
  });

  it('removes an array element', () => {
    const doc = YyDoc.parse('{\n  "xs":[\n    {"i":0,},\n    {"i":1,},\n  ],\n}');
    doc.remove(['xs', 0]);
    expect(doc.text).toBe('{\n  "xs":[\n    {"i":1,},\n  ],\n}');
  });

  it('survives repeated edits', () => {
    const doc = YyDoc.parse(OBJECT_YY);
    doc.set(['visible'], false).insert([], 'solid', true).remove(['physicsDensity']);
    expect(doc.get(['visible'])).toBe(false);
    expect(doc.get(['solid'])).toBe(true);
    expect(doc.has(['physicsDensity'])).toBe(false);
    expect(doc.get(['%Name'])).toBe('objCar');
  });
});
