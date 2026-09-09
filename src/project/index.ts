export { GmProject, ProjectError, RESOURCE_KINDS, kindOfPath, kindOfResourceType, resourcePathFor, normalizeFolderPath, folderName } from './project.js';
export type { ResourceKind, ResourceRef, Reference } from './project.js';
export { EVENT_TYPES, Events, EventError, eventFileName, parseEventFileName, sameEvent, eventLabel } from './events.js';
export type { GmEvent, EventTypeName } from './events.js';
export { createObject, createScript, addEvent, removeEvent, listEvents, deleteResource, renameResource, registerResource, setSpriteProperties, createFolder } from './resources.js';
export type { CreateObjectOptions, DeleteOptions, SpriteProperties } from './resources.js';
export { ProjectSymbols, checkGml, checkProject, stripCommentsAndStrings, gmlFiles } from './symbols.js';
export type { Diagnostic, SymbolDefinition } from './symbols.js';
