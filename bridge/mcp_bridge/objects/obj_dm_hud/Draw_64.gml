var _w = display_get_gui_width();
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
