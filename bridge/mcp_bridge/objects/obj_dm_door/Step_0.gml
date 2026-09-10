/// Slide open for anything that comes close, and shut again behind it.

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
