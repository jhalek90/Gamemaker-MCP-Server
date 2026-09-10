draw_set_colour(c_black);
draw_text(40, 24, "spr_bounce: " + string(sprite_get_number(spr_bounce)) + " frames, "
	+ string(sprite_get_width(spr_bounce)) + "x" + string(sprite_get_height(spr_bounce))
	+ ", origin " + string(sprite_get_xoffset(spr_bounce)) + "," + string(sprite_get_yoffset(spr_bounce)));

// Every frame, laid out as GameMaker sees them.
for (var _i = 0; _i < sprite_get_number(spr_bounce); _i++) {
	draw_sprite(spr_bounce, _i, 70 + (_i mod 8) * 100, 100 + (_i div 8) * 105);
}

// And the animation actually playing, at three sizes.
var _f = (current_time div 62) mod sprite_get_number(spr_bounce);
draw_text(40, 330, "playing:");
draw_sprite_ext(spr_bounce, _f, 120, 420, 1, 1, 0, c_white, 1);
draw_sprite_ext(spr_bounce, _f, 260, 420, 2, 2, 0, c_white, 1);
draw_sprite_ext(spr_bounce, _f, 460, 420, 3, 3, 0, c_white, 1);
draw_text(40, 560, "frame " + string(_f));
