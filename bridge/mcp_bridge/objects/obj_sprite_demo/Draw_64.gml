draw_set_colour(c_black);
draw_text(40, 40, "sprites built from shapes, drawn by GameMaker");

draw_sprite(spr_ball, 0, 120, 140);
draw_sprite(spr_crate, 0, 200, 110);
draw_sprite(spr_arrow, 0, 340, 140);

draw_text(40, 220, "spr_pulse, all three frames:");
for (var _i = 0; _i < sprite_get_number(spr_pulse); _i++) {
	draw_sprite(spr_pulse, _i, 60 + _i * 80, 250);
}

draw_text(40, 340, "sizes: " + string(sprite_get_width(spr_ball)) + "x" + string(sprite_get_height(spr_ball))
	+ "   origin: " + string(sprite_get_xoffset(spr_ball)) + "," + string(sprite_get_yoffset(spr_ball))
	+ "   frames: " + string(sprite_get_number(spr_pulse)));
