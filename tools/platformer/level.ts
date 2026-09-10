/**
 * The level, as a grid.
 *
 * One character per 64px tile, twelve rows deep and eighty across. Reading it
 * as text is the point: the pits, the coin runs over them and the staircase up
 * to the flag are all visible at a glance, and moving a platform is a one
 * character edit rather than a coordinate hunt.
 *
 *   #  ground        B  brick platform     ?  bonus block
 *   o  coin          e  enemy              P  player start    G  flagpole
 */

export const TILE = 64;

export const MAP: readonly string[] = [
  '                                                                                ',
  '                                                                                ',
  '                                                                                ',
  '                                                                                ',
  '                                oooo                                            ',
  '                                BBBB                                            ',
  '              ooo            oooo                  oooo                  #      ',
  '      ?       BBB            BBBB   ?              BBBB   ?             ##      ',
  '                    oooo                  oooo                  ooo    ###      ',
  '  P   ooo      e           e     e               e     e    e         ####   G  ',
  '####################    ##################    ##################   #############',
  '####################    ##################    ##################   #############',
];

/** What each map character places, and where in its tile it sits. */
export const LEGEND: Record<string, { object: string; ox: number; oy: number }> = {
  '#': { object: 'obj_ground', ox: 0, oy: 0 },
  B: { object: 'obj_brick', ox: 0, oy: 0 },
  '?': { object: 'obj_qblock', ox: 0, oy: 0 },
  // Origin is the middle of the sprite, so coins centre in their tile.
  o: { object: 'obj_coin', ox: TILE / 2, oy: TILE / 2 },
  // Everything that stands on the floor has a bottom-centre origin.
  e: { object: 'obj_goomba', ox: TILE / 2, oy: TILE },
  P: { object: 'obj_player', ox: TILE / 2, oy: TILE },
  G: { object: 'obj_goal', ox: TILE / 2, oy: TILE },
};

export const COLUMNS = MAP[0]!.length;
export const ROWS = MAP.length;
export const ROOM_WIDTH = COLUMNS * TILE;
export const ROOM_HEIGHT = ROWS * TILE;

/** Decorative clouds, in room pixels. */
export const CLOUDS: readonly [number, number][] = [
  [320, 90],
  [980, 60],
  [1720, 120],
  [2400, 70],
  [3080, 110],
  [3900, 80],
  [4520, 130],
];

export interface Placement {
  object: string;
  x: number;
  y: number;
}

/** Walk the map and turn every non-blank tile into an instance to create. */
export function placements(): Placement[] {
  const out: Placement[] = [];
  MAP.forEach((row, r) => {
    if (row.length !== COLUMNS) {
      throw new Error(`Map row ${r} is ${row.length} tiles, expected ${COLUMNS}`);
    }
    for (let c = 0; c < row.length; c++) {
      const glyph = row[c]!;
      const entry = LEGEND[glyph];
      if (!entry) continue;
      // Ground with ground directly above it is buried, so it loses its turf.
      const buried = glyph === '#' && MAP[r - 1]?.[c] === '#';
      out.push({
        object: buried ? 'obj_dirt' : entry.object,
        x: c * TILE + entry.ox,
        y: r * TILE + entry.oy,
      });
    }
  });
  return out;
}
