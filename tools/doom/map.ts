/**
 * The level, as a grid.
 *
 * One character per world cell. Walls become instances placed in the room, so
 * the map is editable in GameMaker's room editor as well as here — the
 * renderer rebuilds its collision grid from whatever instances it finds at
 * room start, rather than from this file.
 *
 *   #  brick wall     =  stone wall      |  tech wall      +  door
 *   .  floor          P  player start    i  imp            X  exit
 *   h  health         a  ammo
 */

export const CELL = 64;

export const MAP: readonly string[] = [
  '#######============|||||||||||||',
  '#......==.........=||.........||',
  '#......==.........=||.........||',
  '#..P...+.....i.....+........a.||',
  '#......==....h....=||....i....||',
  '#......==.........=||.........||',
  '#......======+=====||.........||',
  '#......==.........=||||||+||||||',
  '#......==.........=||.........||',
  '#....i.==......a..=||.........||',
  '#..a...==....i....=||......h..||',
  '#......==.........=||..i......||',
  '###.###==.........=||......=..||',
  '###+###======+=====||.........||',
  '#.................#||.........||',
  '#.................#||||||+||||||',
  '#.................#||.........||',
  '#...=...=...=.....#||.........||',
  '#........i.........+..........||',
  '#.................#||...=.....||',
  '#...=h..=...=.i...#||....i....||',
  '#...............a.#||.....X...||',
  '#.................#||.........||',
  '###################|||||||||||||',
];

export const COLUMNS = MAP[0]!.length;
export const ROWS = MAP.length;
export const ROOM_WIDTH = COLUMNS * CELL;
export const ROOM_HEIGHT = ROWS * CELL;

/** Wall characters, and the object that carries each texture. */
export const WALLS: Record<string, string> = {
  '#': 'obj_dm_brick',
  '=': 'obj_dm_stone',
  '|': 'obj_dm_tech',
  '+': 'obj_dm_door',
};

/** Things that stand on the floor. */
export const THINGS: Record<string, string> = {
  P: 'obj_dm_player',
  i: 'obj_dm_imp',
  h: 'obj_dm_health',
  a: 'obj_dm_ammo',
  X: 'obj_dm_exit',
};

export interface Placement {
  object: string;
  x: number;
  y: number;
}

/**
 * Walk the map and turn every cell into an instance.
 *
 * Walls sit at the top-left of their cell so the grid maths is a plain
 * `x div CELL`; everything else is centred in its cell, because the renderer
 * treats those as points in space rather than as tiles.
 */
export function placements(): Placement[] {
  const out: Placement[] = [];
  MAP.forEach((row, r) => {
    if (row.length !== COLUMNS) {
      throw new Error(`Map row ${r} is ${row.length} cells, expected ${COLUMNS}`);
    }
    for (let c = 0; c < row.length; c++) {
      const glyph = row[c]!;
      const wall = WALLS[glyph];
      if (wall) {
        out.push({ object: wall, x: c * CELL, y: r * CELL });
        continue;
      }
      const thing = THINGS[glyph];
      if (thing) {
        out.push({ object: thing, x: c * CELL + CELL / 2, y: r * CELL + CELL / 2 });
      }
    }
  });
  return out;
}
