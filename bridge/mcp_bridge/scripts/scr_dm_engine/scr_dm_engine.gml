/// Raycaster constants and the handful of helpers everything shares.

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
