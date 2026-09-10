var _w = display_get_gui_width();

draw_set_halign(fa_left);
draw_set_valign(fa_top);

draw_set_colour(c_white);
draw_text_transformed(24,  18, "COINS " + string(global.coins), 2, 2, 0);
draw_text_transformed(280, 18, "LIVES " + string(global.lives), 2, 2, 0);
draw_text_transformed(520, 18, "SCORE " + string(global.score), 2, 2, 0);

draw_set_colour(c_black);
draw_text(24, 56, "arrows or A/D to move    Z, W or space to jump    X or shift to run    R to restart");

if (!instance_exists(obj_player)) exit;

draw_set_halign(fa_center);
if (obj_player.state == "won") {
	draw_set_colour(c_yellow);
	draw_text_transformed(_w / 2, 230, "LEVEL COMPLETE", 5, 5, 0);
	draw_set_colour(c_white);
	draw_text_transformed(_w / 2, 320, "press R to play again", 2, 2, 0);
} else if (obj_player.state == "dead") {
	draw_set_colour(c_white);
	draw_text_transformed(_w / 2, 250, "OUCH", 5, 5, 0);
}
draw_set_halign(fa_left);
draw_set_colour(c_white);
