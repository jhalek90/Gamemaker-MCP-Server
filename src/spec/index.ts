export { parseXml, decodeEntities, childrenNamed, findDescendant, XmlParseError } from './xml.js';
export type { XmlElement } from './xml.js';
export { GmlSpec, signatureOf, summarize } from './spec.js';
export type { GmlEntry, GmlFunction, GmlVariable, GmlConstant, GmlStructure, GmlEnum, GmlParameter, SearchResult } from './spec.js';
export { findRuntimes, requireRuntime, runtimeSearchPaths, compareVersions, RuntimeNotFoundError } from './runtime.js';
export type { GmRuntime } from './runtime.js';
