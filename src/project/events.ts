/**
 * GameMaker object events: the mapping between `eventList` entries in a `.yy`
 * and the `.gml` files beside it.
 *
 * The type-to-prefix table was derived from the reference corpus rather than
 * from documentation: pairing `eventList` entries against sibling `.gml` files
 * across 4,975 objects produced exactly one prefix per event type, with no
 * disagreements. Types 11, 13 and 14 did not occur in the corpus and are
 * marked accordingly.
 */

export const EVENT_TYPES = {
  Create: 0,
  Destroy: 1,
  Alarm: 2,
  Step: 3,
  Collision: 4,
  Keyboard: 5,
  Mouse: 6,
  Other: 7,
  Draw: 8,
  KeyPress: 9,
  KeyRelease: 10,
  /** Deprecated in GameMaker; not seen in the corpus. */
  Trigger: 11,
  CleanUp: 12,
  /** Not seen in the corpus; prefix taken from GameMaker's documentation. */
  Gesture: 13,
  /** Not seen in the corpus; prefix taken from GameMaker's documentation. */
  PreCreate: 14,
} as const;

export type EventTypeName = keyof typeof EVENT_TYPES;

const PREFIX_BY_TYPE = new Map<number, EventTypeName>(
  Object.entries(EVENT_TYPES).map(([name, type]) => [type, name as EventTypeName]),
);

export interface GmEvent {
  /** `eventType` in the `.yy`. */
  type: number;
  /** `eventNum` in the `.yy`. Always 0 for collision events. */
  number: number;
  /** Name of the other object, for collision events only. */
  collisionWith?: string;
}

export class EventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EventError';
  }
}

/** Common events, spelled out so callers do not pass bare numbers around. */
export const Events = {
  create: (): GmEvent => ({ type: EVENT_TYPES.Create, number: 0 }),
  destroy: (): GmEvent => ({ type: EVENT_TYPES.Destroy, number: 0 }),
  cleanUp: (): GmEvent => ({ type: EVENT_TYPES.CleanUp, number: 0 }),
  /** 0 = Step, 1 = Begin Step, 2 = End Step. */
  step: (which: 0 | 1 | 2 = 0): GmEvent => ({ type: EVENT_TYPES.Step, number: which }),
  /** 0 = Draw, 64 = Draw GUI, 72 = Pre Draw, 73 = Post Draw, 74/75 = Begin/End. */
  draw: (which = 0): GmEvent => ({ type: EVENT_TYPES.Draw, number: which }),
  alarm: (index: number): GmEvent => ({ type: EVENT_TYPES.Alarm, number: index }),
  other: (index: number): GmEvent => ({ type: EVENT_TYPES.Other, number: index }),
  keyPress: (key: number): GmEvent => ({ type: EVENT_TYPES.KeyPress, number: key }),
  keyRelease: (key: number): GmEvent => ({ type: EVENT_TYPES.KeyRelease, number: key }),
  keyboard: (key: number): GmEvent => ({ type: EVENT_TYPES.Keyboard, number: key }),
  mouse: (index: number): GmEvent => ({ type: EVENT_TYPES.Mouse, number: index }),
  collision: (objectName: string): GmEvent => ({
    type: EVENT_TYPES.Collision,
    number: 0,
    collisionWith: objectName,
  }),
} as const;

/** The `.gml` file name an event's code lives in, e.g. `Step_0.gml`. */
export function eventFileName(event: GmEvent): string {
  const prefix = PREFIX_BY_TYPE.get(event.type);
  if (!prefix) throw new EventError(`Unknown event type ${event.type}`);
  if (event.type === EVENT_TYPES.Collision) {
    if (!event.collisionWith) {
      throw new EventError('Collision events need the other object name');
    }
    // Collision files are named after the other object, not a number.
    return `Collision_${event.collisionWith}.gml`;
  }
  return `${prefix}_${event.number}.gml`;
}

/** Inverse of `eventFileName`. Returns undefined for non-event files. */
export function parseEventFileName(fileName: string): GmEvent | undefined {
  if (!fileName.endsWith('.gml')) return undefined;
  const stem = fileName.slice(0, -4);
  const split = stem.lastIndexOf('_');
  if (split === -1) return undefined;
  const prefix = stem.slice(0, split);
  const suffix = stem.slice(split + 1);
  const type = EVENT_TYPES[prefix as EventTypeName];
  if (type === undefined) return undefined;
  if (type === EVENT_TYPES.Collision) {
    return { type, number: 0, collisionWith: suffix };
  }
  if (!/^\d+$/.test(suffix)) return undefined;
  return { type, number: Number(suffix) };
}

/** True when two events refer to the same slot on an object. */
export function sameEvent(a: GmEvent, b: GmEvent): boolean {
  if (a.type !== b.type) return false;
  if (a.type === EVENT_TYPES.Collision) return a.collisionWith === b.collisionWith;
  return a.number === b.number;
}

/** Human-readable label, e.g. `Step_0` or `Collision_objWall`. */
export function eventLabel(event: GmEvent): string {
  return eventFileName(event).slice(0, -4);
}
