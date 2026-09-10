if (keyboard_check_pressed(ord("R"))) {
	global.dm_health = 100;
	global.dm_ammo = 40;
	global.dm_kills = 0;
	global.dm_state = "play";
	room_restart();
}
