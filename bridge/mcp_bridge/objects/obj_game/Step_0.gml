if (keyboard_check_pressed(ord("R"))) {
	global.coins = 0;
	global.score = 0;
	global.lives = 3;
	room_restart();
}
