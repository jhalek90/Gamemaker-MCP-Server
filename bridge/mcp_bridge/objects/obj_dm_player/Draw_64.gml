/// The first-person view: floor and ceiling, walls, sprites, then the weapon.

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
