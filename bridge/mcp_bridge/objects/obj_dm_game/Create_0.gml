/// Level state: the collision grid, and the run's globals.

global.dm_cols = room_width div DM_CELL;
global.dm_rows = room_height div DM_CELL;

// The collision grid is built from the wall instances rather than from a
// table, so rearranging the level in GameMaker's room editor actually changes
// the level -- the map file and the running game cannot drift apart.
global.dm_grid = ds_grid_create(global.dm_cols, global.dm_rows);
ds_grid_clear(global.dm_grid, 0);
with (obj_dm_wall) {
	ds_grid_set(global.dm_grid, x div DM_CELL, y div DM_CELL, kind);
}

// How far each door has slid up, 0 shut to 1 fully open.
global.dm_open = ds_grid_create(global.dm_cols, global.dm_rows);
ds_grid_clear(global.dm_open, 0);

// Wall kind to texture, indexed by the kind constants.
global.dm_tex = [-1, spr_dm_brick, spr_dm_stone, spr_dm_tech, spr_dm_door];

global.dm_health = 100;
global.dm_ammo   = 40;
global.dm_kills  = 0;
global.dm_total  = instance_number(obj_dm_imp);
global.dm_state  = "play";   // play | dead | won

// The same external input seam the platformer uses: every control is the real
// keyboard OR one of these, so a driver can state exactly what it is holding
// without racing a real keyboard.
global.dm_fwd    = 0;        // -1 back, 1 forward
global.dm_strafe = 0;        // -1 left, 1 right
global.dm_turn   = 0;        // -1 left, 1 right
global.dm_run    = false;
global.dm_fire   = false;
