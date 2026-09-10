/**
 * The raycaster, as GML.
 *
 * The renderer is a textured DDA raycaster: one ray per screen column, walk
 * the grid until it hits something solid, and draw a vertical slice of the
 * wall texture scaled by the reciprocal of the distance. Sprites are drawn
 * afterwards as billboards, clipped column by column against the wall depths
 * recorded on the way through.
 *
 * The grid traversal is the Amanatides & Woo DDA ("A Fast Voxel Traversal
 * Algorithm for Ray Tracing", 1987). The way it is applied to a first-person
 * view — the camera plane, perpendicular wall distance to avoid fisheye, the
 * texture-column mapping and the per-column depth buffer for sprites — follows
 * the well-known technique used by Wolfenstein 3D and set out in Lode
 * Vandevenne's raycasting tutorial at https://lodev.org/cgtutor/raycasting.html
 *
 * That tutorial's own source is "Copyright (c) 2004-2020 by Lode Vandevenne.
 * All rights reserved." and carries no licence grant, so none of it is copied
 * here: the code below is written for GameMaker from the published technique.
 * The credit is owed regardless.
 */

// -- shared engine script -------------------------------------------------

export const ENGINE = `/// Raycaster constants and the handful of helpers everything shares.

#macro DM_CELL 64
#macro DM_TEX  64
/// Screen pixels per cast ray. Two is a good trade: half the rays of a
/// per-pixel cast, and at this resolution the seams are invisible.
#macro DM_COLW 2
/// tan(fov / 2). 0.66 is a touch over 66 degrees, which is what Doom used.
#macro DM_FOV  0.66
/// Height of the status bar. The weapon is anchored to the top of it.
#macro DM_BAR  100

#macro DM_BRICK 1
#macro DM_STONE 2
#macro DM_TECH  3
#macro DM_DOOR  4

/// @desc Is the cell at this grid position solid right now?
/// Outside the map counts as solid, so rays and bodies stop at the edge.
function dm_solid(_col, _row) {
	if (_col < 0 || _row < 0 || _col >= global.dm_cols || _row >= global.dm_rows) return true;
	return ds_grid_get(global.dm_grid, _col, _row) > 0;
}

/// @desc Is this world position inside a wall?
function dm_solid_at(_x, _y) {
	return dm_solid(floor(_x / DM_CELL), floor(_y / DM_CELL));
}

/// @desc Would a body of this radius overlap a wall at this position?
/// Four corners is enough: nothing here is larger than a cell.
function dm_blocked(_x, _y, _r) {
	return dm_solid_at(_x - _r, _y - _r) || dm_solid_at(_x + _r, _y - _r)
		|| dm_solid_at(_x - _r, _y + _r) || dm_solid_at(_x + _r, _y + _r);
}

/// @desc Is there a clear line between two world points?
///
/// Stepped rather than a proper DDA. Only the enemies use it, to decide
/// whether they can see the player, and a few pixels of slop there is
/// invisible while a second grid walk per enemy per frame is not.
function dm_los(_x1, _y1, _x2, _y2) {
	var _steps = max(1, floor(point_distance(_x1, _y1, _x2, _y2) / 16));
	var _dx = (_x2 - _x1) / _steps;
	var _dy = (_y2 - _y1) / _steps;
	for (var _i = 1; _i < _steps; _i++) {
		if (dm_solid_at(_x1 + _dx * _i, _y1 + _dy * _i)) return false;
	}
	return true;
}

/// @desc Signed difference between two angles, wrapped to +/- pi.
/// GML's mod keeps the sign of the dividend, so the usual one-liner is wrong
/// for negative angles.
function dm_angle_diff(_a, _b) {
	var _d = _a - _b;
	while (_d >  pi) _d -= 2 * pi;
	while (_d < -pi) _d += 2 * pi;
	return _d;
}

/// @desc Greyscale tint for something this far away.
function dm_shade(_dist, _floor) {
	var _lit = clamp(1.15 - _dist * 0.085, _floor, 1);
	return make_colour_rgb(255 * _lit, 255 * _lit, 255 * _lit);
}

/// @desc Draw one horizontal run of a billboarded sprite.
///
/// Split out because a sprite behind a pillar is drawn as several runs, and
/// the mapping from screen x back to texture u is easy to get subtly wrong.
function dm_billboard(_inst, _x0, _x1, _left, _size, _top, _tint) {
	if (_x1 <= _x0) return;
	var _tw = sprite_get_width(_inst.sprite_index);
	var _th = sprite_get_height(_inst.sprite_index);
	var _tl = clamp((_x0 - _left) / _size * _tw, 0, _tw);
	var _tr = clamp((_x1 - _left) / _size * _tw, 0, _tw);
	if (_tr - _tl < 0.01) return;
	draw_sprite_part_ext(_inst.sprite_index, floor(_inst.image_index), _tl, 0, _tr - _tl, _th,
		_x0, _top, _size / _tw, _size / _th, _tint, 1);
}
`;

// -- level state ----------------------------------------------------------

export const GAME_CREATE = `/// Level state: the collision grid, and the run's globals.

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
`;

export const GAME_STEP = `if (keyboard_check_pressed(ord("R"))) {
	global.dm_health = 100;
	global.dm_ammo = 40;
	global.dm_kills = 0;
	global.dm_state = "play";
	room_restart();
}
`;

export const GAME_END_STEP = `/// One snapshot an outside driver can read in a single request.
if (instance_exists(obj_dm_player)) {
	with (obj_dm_player) {
		global.dm_view = {
			x: x, y: y, dir: dir,
			col: floor(x / DM_CELL), row: floor(y / DM_CELL),
			health: global.dm_health, ammo: global.dm_ammo,
			kills: global.dm_kills, total: global.dm_total,
			state: global.dm_state,
			imps: instance_number(obj_dm_imp),
			fps: fps, fps_real: floor(fps_real),
		};
	}
}
`;

export const GAME_CLEANUP = `if (ds_exists(global.dm_grid, ds_type_grid)) ds_grid_destroy(global.dm_grid);
if (ds_exists(global.dm_open, ds_type_grid)) ds_grid_destroy(global.dm_open);
`;

// -- walls ----------------------------------------------------------------

/** Walls are never drawn by GameMaker; the raycaster reads them off the grid. */
export const wallCreate = (kind: string): string =>
  `kind = ${kind};
// Drawn by the raycaster, not by GameMaker: leaving these visible would paint
// the level twice, once flat behind the 3D view.
visible = false;
image_speed = 0;
`;

export const DOOR_CREATE = `kind = DM_DOOR;
visible = false;
image_speed = 0;

col = x div DM_CELL;
row = y div DM_CELL;
openness = 0;
hold = 0;
`;

export const DOOR_STEP = `/// Slide open for anything that comes close, and shut again behind it.

var _mid_x = x + DM_CELL / 2;
var _mid_y = y + DM_CELL / 2;

var _wanted = false;
if (instance_exists(obj_dm_player)) {
	_wanted = point_distance(_mid_x, _mid_y, obj_dm_player.x, obj_dm_player.y) < 96;
}
// Imps open doors too, or they pile up behind them and the level goes quiet.
if (!_wanted) {
	_wanted = collision_circle(_mid_x, _mid_y, 80, obj_dm_imp, false, true) != noone;
}

// The hold is what stops a door shutting on whoever opened it: anything near
// enough to trigger it is also near enough to keep it triggered.
if (_wanted) hold = 45; else if (hold > 0) hold -= 1;

var _target = (hold > 0) ? 1 : 0;
if (openness < _target) openness = min(1, openness + 0.05);
else if (openness > _target) openness = max(0, openness - 0.05);

ds_grid_set(global.dm_open, col, row, openness);
// Only passable once it is nearly all the way up.
ds_grid_set(global.dm_grid, col, row, (openness >= 0.95) ? 0 : kind);
`;

// -- the player -----------------------------------------------------------

export const PLAYER_CREATE = `/// The marine: movement, shooting, and the first-person view.

// Must stay visible: GameMaker skips every Draw event, Draw GUI included, for
// an invisible instance -- and this object's Draw GUI *is* the whole game.
// There is no sprite, so being visible costs nothing.
visible = true;

dir   = 0;        // radians. The world is y-down, so this turns clockwise.
pitch = 0;        // vertical shear, in pixels

walk_speed = 3.2;
run_speed  = 5.4;
turn_speed = 0.045;
radius     = 18;

bob        = 0;
recoil     = 0;
flash      = 0;   // muzzle flash frames left
hurt_flash = 0;
fire_cool  = 0;

// Mouse look re-centres the cursor every frame to read a delta, which drags
// the pointer out of whatever else is on screen. So it stays off until you
// click in the window to claim it, and Escape gives it back.
mouse_look  = false;
mouse_ready = false;

/// Take damage. Death stops the level rather than ending the process, so the
/// player can see what killed them.
hurt = function(_amount) {
	if (global.dm_state != "play") return;
	global.dm_health -= _amount;
	hurt_flash = 12;
	if (global.dm_health <= 0) {
		global.dm_health = 0;
		global.dm_state = "dead";
	}
};

/// Fire the shotgun: a hitscan down a narrow cone, nearest target wins.
fire = function() {
	global.dm_ammo -= 1;
	fire_cool = 20;
	flash = 5;
	recoil = 12;

	var _best = noone;
	var _best_d = 100000;
	with (obj_dm_imp) {
		if (state == "dead") continue;
		var _d = point_distance(x, y, other.x, other.y);
		if (_d > 900 || _d >= _best_d) continue;
		if (abs(dm_angle_diff(arctan2(y - other.y, x - other.x), other.dir)) > 0.16) continue;
		if (!dm_los(other.x, other.y, x, y)) continue;
		_best_d = _d;
		_best = id;
	}
	if (_best != noone) with (_best) hurt(34);
};
`;

export const PLAYER_STEP = `if (global.dm_state != "play") {
	recoil = max(0, recoil - 1);
	flash = max(0, flash - 1);
	exit;
}

// -- input: the real keyboard OR the external seam
var _fwd = 0, _str = 0, _turn = 0;
if (keyboard_check(ord("W")) || keyboard_check(vk_up))    _fwd += 1;
if (keyboard_check(ord("S")) || keyboard_check(vk_down))  _fwd -= 1;
if (keyboard_check(ord("A"))) _str -= 1;
if (keyboard_check(ord("D"))) _str += 1;
if (keyboard_check(vk_left))  _turn -= 1;
if (keyboard_check(vk_right)) _turn += 1;

_fwd  = clamp(_fwd  + global.dm_fwd,    -1, 1);
_str  = clamp(_str  + global.dm_strafe, -1, 1);
_turn = clamp(_turn + global.dm_turn,   -1, 1);

var _running = keyboard_check(vk_shift) || global.dm_run;
var _firing  = keyboard_check(vk_space) || global.dm_fire
	|| (mouse_look && mouse_check_button(mb_left));

// -- mouse look, only while the window is focused
//
// Reading a delta means putting the cursor back in the middle every frame, and
// doing that to an unfocused window would drag the pointer out of whatever the
// user is actually doing.
if (keyboard_check_pressed(vk_escape)) mouse_look = false;
if (!mouse_look && window_has_focus() && mouse_check_button_pressed(mb_left)) {
	// The click that captures the mouse should not also fire the gun.
	mouse_look = true;
	_firing = false;
}
if (mouse_look && window_has_focus()) {
	var _cx = window_get_width() div 2;
	var _cy = window_get_height() div 2;
	if (mouse_ready) {
		dir += (window_mouse_get_x() - _cx) * 0.003;
		pitch = clamp(pitch - (window_mouse_get_y() - _cy) * 0.9, -220, 220);
	}
	window_mouse_set(_cx, _cy);
	mouse_ready = true;
} else {
	mouse_ready = false;
}

dir += _turn * turn_speed;

// -- movement, sliding along walls rather than stopping dead on them
var _speed = _running ? run_speed : walk_speed;
var _dx = cos(dir);
var _dy = sin(dir);
// Right-hand vector: rotating forward by 90 degrees in a y-down world.
var _mx = (_dx * _fwd + -_dy * _str) * _speed;
var _my = (_dy * _fwd +  _dx * _str) * _speed;
if (_mx != 0 || _my != 0) {
	if (!dm_blocked(x + _mx, y, radius)) x += _mx;
	if (!dm_blocked(x, y + _my, radius)) y += _my;
	bob += _speed * 0.13;
}

// -- shooting
if (fire_cool > 0) fire_cool -= 1;
if (_firing && fire_cool <= 0 && global.dm_ammo > 0) fire();

recoil = max(0, recoil - 1.4);
flash = max(0, flash - 1);
hurt_flash = max(0, hurt_flash - 1);

// -- pickups and the exit
var _pick = collision_circle(x, y, 30, obj_dm_pickup, false, true);
if (_pick != noone) with (_pick) take();

if (collision_circle(x, y, 44, obj_dm_exit, false, true) != noone) {
	global.dm_state = "won";
}
`;

export const PLAYER_DRAW_GUI = `/// The first-person view: floor and ceiling, walls, sprites, then the weapon.

var _w = display_get_gui_width();
var _h = display_get_gui_height();
var _horizon = _h * 0.5 + pitch;
var _ncols = _w div DM_COLW;

// Nearest-neighbour, or sampling a one pixel wide slice of a texture picks up
// its neighbours and every wall shimmers.
gpu_set_tex_filter(false);

// -- floor and ceiling, as bands that darken towards the horizon
var _bands = 28;
for (var _b = 0; _b < _bands; _b++) {
	var _t0 = _b / _bands;
	var _t1 = (_b + 1) / _bands;
	var _lit = 0.12 + 0.88 * power(_t0, 0.7);

	draw_set_colour(make_colour_rgb(46 * _lit, 51 * _lit, 62 * _lit));
	draw_rectangle(0, _horizon - _horizon * _t1, _w, _horizon - _horizon * _t0 + 1, false);

	draw_set_colour(make_colour_rgb(58 * _lit, 48 * _lit, 38 * _lit));
	var _fh = _h - _horizon;
	draw_rectangle(0, _horizon + _fh * _t0, _w, _horizon + _fh * _t1 + 1, false);
}

// -- walls, one ray per column
var _pos_x = x / DM_CELL;
var _pos_y = y / DM_CELL;
var _dir_x = cos(dir);
var _dir_y = sin(dir);
var _plane_x = -_dir_y * DM_FOV;
var _plane_y =  _dir_x * DM_FOV;

var _zbuf = array_create(_ncols, 1000000);

for (var _col = 0; _col < _ncols; _col++) {
	var _screen_x = _col * DM_COLW;
	var _cam_x = 2 * (_screen_x + DM_COLW * 0.5) / _w - 1;
	var _ray_x = _dir_x + _plane_x * _cam_x;
	var _ray_y = _dir_y + _plane_y * _cam_x;

	var _map_x = floor(_pos_x);
	var _map_y = floor(_pos_y);
	var _delta_x = (_ray_x == 0) ? 1000000 : abs(1 / _ray_x);
	var _delta_y = (_ray_y == 0) ? 1000000 : abs(1 / _ray_y);

	var _step_x, _step_y, _side_x, _side_y;
	if (_ray_x < 0) { _step_x = -1; _side_x = (_pos_x - _map_x) * _delta_x; }
	else            { _step_x =  1; _side_x = (_map_x + 1 - _pos_x) * _delta_x; }
	if (_ray_y < 0) { _step_y = -1; _side_y = (_pos_y - _map_y) * _delta_y; }
	else            { _step_y =  1; _side_y = (_map_y + 1 - _pos_y) * _delta_y; }

	// Walk cell to cell along whichever axis has the nearer crossing.
	var _hit = 0;
	var _side = 0;
	var _guard = 0;
	while (_hit == 0 && _guard < 128) {
		_guard += 1;
		if (_side_x < _side_y) { _side_x += _delta_x; _map_x += _step_x; _side = 0; }
		else                   { _side_y += _delta_y; _map_y += _step_y; _side = 1; }
		if (_map_x < 0 || _map_y < 0 || _map_x >= global.dm_cols || _map_y >= global.dm_rows) break;
		_hit = ds_grid_get(global.dm_grid, _map_x, _map_y);
	}
	if (_hit <= 0) continue;

	// Distance to the wall measured along the view axis, not to the eye:
	// using the true distance is what produces fisheye.
	var _perp = (_side == 0) ? (_side_x - _delta_x) : (_side_y - _delta_y);
	if (_perp < 0.0001) _perp = 0.0001;
	_zbuf[_col] = _perp;

	var _line_h = _h / _perp;
	var _top = _horizon - _line_h * 0.5;

	// Where along the face of the cell the ray landed, as a texture column.
	var _wall_u = (_side == 0) ? (_pos_y + _perp * _ray_y) : (_pos_x + _perp * _ray_x);
	_wall_u -= floor(_wall_u);
	var _tex_x = floor(_wall_u * DM_TEX);
	if (_side == 0 && _ray_x > 0) _tex_x = DM_TEX - _tex_x - 1;
	if (_side == 1 && _ray_y < 0) _tex_x = DM_TEX - _tex_x - 1;
	_tex_x = clamp(_tex_x, 0, DM_TEX - 1);

	// Darken one axis flat, so corners between two lit walls still read.
	var _lit = clamp(1.15 - _perp * 0.085, 0.16, 1);
	if (_side == 1) _lit *= 0.72;
	var _tint = make_colour_rgb(255 * _lit, 255 * _lit, 255 * _lit);

	var _tex_top = 0;
	var _tex_h = DM_TEX;
	var _draw_y = _top;
	var _draw_h = _line_h;
	if (_hit == DM_DOOR) {
		// A door slides up into the ceiling: show the bottom slice of the
		// texture, filling the bottom of the column.
		var _open = ds_grid_get(global.dm_open, _map_x, _map_y);
		_tex_top = _open * DM_TEX;
		_tex_h = (1 - _open) * DM_TEX;
		_draw_y = _top + _open * _line_h;
		_draw_h = (1 - _open) * _line_h;
		if (_tex_h < 0.5) continue;
	}

	draw_sprite_part_ext(global.dm_tex[_hit], 0, _tex_x, _tex_top, 1, _tex_h,
		_screen_x, _draw_y, DM_COLW, _draw_h / _tex_h, _tint, 1);
}

// -- sprites, far to near, clipped against the wall depths
var _things = [];
with (obj_dm_thing) {
	array_push(_things, { inst: id, d: point_distance(x, y, other.x, other.y) });
}
array_sort(_things, function(_a, _b) { return sign(_b.d - _a.d); });

var _inv_det = 1 / (_plane_x * _dir_y - _dir_x * _plane_y);
for (var _i = 0; _i < array_length(_things); _i++) {
	var _e = _things[_i].inst;
	var _ex = _e.x / DM_CELL - _pos_x;
	var _ey = _e.y / DM_CELL - _pos_y;

	// Into camera space: _t_y is depth, _t_x is sideways offset.
	var _t_x = _inv_det * (_dir_y * _ex - _dir_x * _ey);
	var _t_y = _inv_det * (-_plane_y * _ex + _plane_x * _ey);
	if (_t_y <= 0.08) continue;

	var _size = (_h / _t_y) * _e.dm_scale;
	var _left = (_w * 0.5) * (1 + _t_x / _t_y) - _size * 0.5;
	// Things stand on the floor rather than floating on the horizon, so the
	// bottom of the sprite meets the floor line for its distance.
	var _top_y = _horizon + (_h / _t_y) * 0.5 - _size;
	var _tint = dm_shade(_t_y, 0.25);

	// Walk the columns it covers, drawing each unbroken visible run in one go.
	var _run = -1;
	var _px = floor(_left / DM_COLW) * DM_COLW;
	var _stop = _left + _size;
	while (_px <= _stop) {
		var _ci = _px div DM_COLW;
		var _vis = (_px >= 0 && _px < _w && _ci >= 0 && _ci < _ncols && _t_y < _zbuf[_ci]);
		if (_vis) {
			if (_run < 0) _run = _px;
		} else if (_run >= 0) {
			dm_billboard(_e, _run, _px, _left, _size, _top_y, _tint);
			_run = -1;
		}
		_px += DM_COLW;
	}
	if (_run >= 0) dm_billboard(_e, _run, _stop, _left, _size, _top_y, _tint);
}

// -- full screen tints: the muzzle lighting the room, and taking a hit
if (flash > 0) {
	draw_set_alpha(flash / 5 * 0.14);
	draw_set_colour(make_colour_rgb(255, 230, 150));
	draw_rectangle(0, 0, _w, _h, false);
	draw_set_alpha(1);
}
if (hurt_flash > 0) {
	draw_set_alpha(hurt_flash / 12 * 0.45);
	draw_set_colour(make_colour_rgb(190, 20, 20));
	draw_rectangle(0, 0, _w, _h, false);
	draw_set_alpha(1);
}

// -- crosshair
draw_set_colour(make_colour_rgb(210, 220, 210));
draw_set_alpha(0.7);
draw_rectangle(_w / 2 - 9, _horizon - 1, _w / 2 - 3, _horizon + 1, false);
draw_rectangle(_w / 2 + 3, _horizon - 1, _w / 2 + 9, _horizon + 1, false);
draw_rectangle(_w / 2 - 1, _horizon - 9, _w / 2 + 1, _horizon - 3, false);
draw_rectangle(_w / 2 - 1, _horizon + 3, _w / 2 + 1, _horizon + 9, false);
draw_set_alpha(1);

// -- the shotgun, bobbing with the walk
//
// Anchored so its bottom edge meets the top of the status bar. Hanging it off
// the bottom of the screen instead buries the receiver and the hands, and all
// that is left on screen is a pair of floating barrels.
var _scale = _h / 560;
var _gun_h = sprite_get_height(spr_dm_gun) * _scale;
var _frame = (flash > 0) ? 1 : ((recoil > 3) ? 2 : 0);
draw_sprite_ext(spr_dm_gun, _frame,
	_w * 0.5 + sin(bob) * 16,
	_h - DM_BAR - _gun_h + recoil * 1.8 + abs(cos(bob)) * 10,
	_scale, _scale, 0, c_white, 1);
`;

// -- the enemy ------------------------------------------------------------

export const IMP_CREATE = `/// An imp: closes on the player, throws fire, collapses when shot enough.

visible = false;      // the raycaster draws it
image_speed = 0;
dm_scale = 0.85;      // fraction of a cell tall

hp = 60;
state = "idle";       // idle | chase | attack | dead
anim = 0;
timer = 0;
cool = 0;
radius = 14;
walk_speed = 1.5;

hurt = function(_amount) {
	if (state == "dead") return;
	hp -= _amount;
	if (hp > 0) {
		state = "chase";   // being shot at is a reliable way to get noticed
		return;
	}
	state = "dead";
	timer = 0;
	global.dm_kills += 1;
};
`;

export const IMP_STEP = `if (state == "dead") {
	timer += 1;
	// Three frames of collapse, then it stays put as a corpse.
	image_index = 3 + min(2, timer div 8);
	exit;
}
if (global.dm_state != "play" || !instance_exists(obj_dm_player)) exit;

var _px = obj_dm_player.x;
var _py = obj_dm_player.y;
var _dist = point_distance(x, y, _px, _py);
var _sees = (_dist < 700) && dm_los(x, y, _px, _py);

if (state == "idle") {
	image_index = 0;
	if (_sees) state = "chase";
	exit;
}

if (cool > 0) cool -= 1;

if (state == "attack") {
	timer += 1;
	image_index = 2;
	// The wind-up is deliberate: it is the tell that lets you dodge.
	if (timer == 18) {
		var _shot = instance_create_layer(x, y, "Instances", obj_dm_fireball);
		_shot.dir = arctan2(_py - y, _px - x);
	}
	if (timer > 30) state = "chase";
	exit;
}

if (_sees && _dist < 520 && _dist > 90 && cool <= 0) {
	state = "attack";
	timer = 0;
	cool = 90;
	exit;
}

if (_sees) {
	var _angle = arctan2(_py - y, _px - x);
	var _mx = cos(_angle) * walk_speed;
	var _my = sin(_angle) * walk_speed;
	if (!dm_blocked(x + _mx, y, radius)) x += _mx;
	if (!dm_blocked(x, y + _my, radius)) y += _my;

	// Claw at point blank, rather than throwing fire from inside your face.
	if (_dist < 56 && cool <= 0) {
		with (obj_dm_player) hurt(9);
		cool = 45;
	}
}

anim += 0.12;
image_index = floor(anim) mod 2;
`;

export const FIREBALL_CREATE = `visible = false;
image_speed = 0.35;
dm_scale = 0.3;
dir = 0;
speed_px = 4.5;
life = 240;
`;

export const FIREBALL_STEP = `life -= 1;
if (life <= 0) { instance_destroy(); exit; }

var _mx = cos(dir) * speed_px;
var _my = sin(dir) * speed_px;
if (dm_blocked(x + _mx, y + _my, 4)) { instance_destroy(); exit; }
x += _mx;
y += _my;

if (instance_exists(obj_dm_player) && point_distance(x, y, obj_dm_player.x, obj_dm_player.y) < 26) {
	with (obj_dm_player) hurt(14);
	instance_destroy();
}
`;

// -- pickups and the exit -------------------------------------------------

export const HEALTH_CREATE = `visible = false;
image_speed = 0;
dm_scale = 0.35;

take = function() {
	if (global.dm_health >= 100) return;
	global.dm_health = min(100, global.dm_health + 25);
	instance_destroy();
};
`;

export const AMMO_CREATE = `visible = false;
image_speed = 0;
dm_scale = 0.35;

take = function() {
	global.dm_ammo += 12;
	instance_destroy();
};
`;

export const EXIT_CREATE = `visible = false;
image_speed = 0;
dm_scale = 0.7;
`;

// -- heads-up display -----------------------------------------------------

export const HUD_CREATE = `// Visible, or its Draw GUI never runs. See obj_dm_player's Create.
visible = true;
// Lower depth draws later, so the bar and the automap land on top of the view.
depth = -100;
`;

export const HUD_DRAW_GUI = `var _w = display_get_gui_width();
var _h = display_get_gui_height();

// -- status bar
var _bar = DM_BAR;
draw_set_colour(make_colour_rgb(26, 23, 20));
draw_rectangle(0, _h - _bar, _w, _h, false);
draw_set_colour(make_colour_rgb(74, 64, 52));
draw_rectangle(0, _h - _bar, _w, _h - _bar + 3, false);

draw_set_font(-1);
draw_set_valign(fa_top);
draw_set_halign(fa_center);

var _cells = [
	["AMMO",   string(global.dm_ammo),                                        _w * 0.16],
	["HEALTH", string(global.dm_health) + "%",                                _w * 0.36],
	["KILLS",  string(global.dm_kills) + "/" + string(global.dm_total),       _w * 0.64],
	["ARMS",   "2",                                                           _w * 0.84],
];
for (var _i = 0; _i < array_length(_cells); _i++) {
	var _c = _cells[_i];
	draw_set_colour(make_colour_rgb(150, 130, 100));
	draw_text_transformed(_c[2], _h - _bar + 12, _c[0], 1.4, 1.4, 0);
	// Health goes red as it runs out; everything else stays bone white.
	var _low = (_i == 1 && global.dm_health <= 30);
	draw_set_colour(_low ? make_colour_rgb(230, 60, 40) : make_colour_rgb(235, 225, 205));
	draw_text_transformed(_c[2], _h - _bar + 34, _c[1], 3, 3, 0);
}

// The face, which is the quickest read on how badly it is going.
var _face = clamp(3 - floor(global.dm_health / 26), 0, 3);
if (global.dm_state == "dead") _face = 3;
draw_sprite_ext(spr_dm_face, _face, _w * 0.5, _h - _bar + 12, 1.6, 1.6, 0, c_white, 1);

// -- automap
var _ms = 3;
var _mx = _w - global.dm_cols * _ms - 16;
var _my = 16;
draw_set_alpha(0.72);
draw_set_colour(c_black);
draw_rectangle(_mx - 5, _my - 5, _mx + global.dm_cols * _ms + 5, _my + global.dm_rows * _ms + 5, false);
draw_set_alpha(1);
for (var _r = 0; _r < global.dm_rows; _r++) {
	for (var _c2 = 0; _c2 < global.dm_cols; _c2++) {
		var _kind = ds_grid_get(global.dm_grid, _c2, _r);
		if (_kind <= 0) continue;
		draw_set_colour(_kind == DM_DOOR ? make_colour_rgb(200, 175, 60) : make_colour_rgb(110, 115, 125));
		draw_rectangle(_mx + _c2 * _ms, _my + _r * _ms, _mx + _c2 * _ms + _ms - 1, _my + _r * _ms + _ms - 1, false);
	}
}
draw_set_colour(make_colour_rgb(220, 70, 50));
with (obj_dm_imp) {
	if (state == "dead") continue;
	draw_rectangle(_mx + (x / DM_CELL) * _ms - 1, _my + (y / DM_CELL) * _ms - 1,
		_mx + (x / DM_CELL) * _ms + 1, _my + (y / DM_CELL) * _ms + 1, false);
}
if (instance_exists(obj_dm_player)) {
	with (obj_dm_player) {
		var _ax = _mx + (x / DM_CELL) * _ms;
		var _ay = _my + (y / DM_CELL) * _ms;
		draw_set_colour(make_colour_rgb(120, 240, 130));
		draw_rectangle(_ax - 2, _ay - 2, _ax + 2, _ay + 2, false);
		draw_line_width_colour(_ax, _ay, _ax + cos(dir) * 9, _ay + sin(dir) * 9, 2,
			make_colour_rgb(120, 240, 130), make_colour_rgb(120, 240, 130));
	}
}

// -- messages
draw_set_halign(fa_center);
if (global.dm_state == "won") {
	draw_set_colour(make_colour_rgb(120, 240, 130));
	draw_text_transformed(_w / 2, _h * 0.32, "LEVEL COMPLETE", 5, 5, 0);
	draw_set_colour(c_white);
	draw_text_transformed(_w / 2, _h * 0.32 + 90, "press R to play again", 2, 2, 0);
} else if (global.dm_state == "dead") {
	draw_set_colour(make_colour_rgb(220, 60, 40));
	draw_text_transformed(_w / 2, _h * 0.32, "YOU DIED", 5, 5, 0);
	draw_set_colour(c_white);
	draw_text_transformed(_w / 2, _h * 0.32 + 90, "press R to try again", 2, 2, 0);
} else {
	// Left-aligned: the loop above leaves halign centred, which drew this
	// line off the left edge of the screen.
	draw_set_halign(fa_left);
	draw_set_colour(make_colour_rgb(170, 170, 170));
	draw_set_alpha(0.85);
	draw_text(16, 14, "WASD move   mouse or arrows look   space or click fire   Esc release mouse   R restart");
	draw_set_alpha(1);
}
draw_set_halign(fa_left);
draw_set_colour(c_white);
`;
