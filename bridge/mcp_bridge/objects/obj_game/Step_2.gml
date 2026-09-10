if (instance_exists(obj_player)) {
	with (obj_player) {
		global.botview = {
			x: x, y: y, hsp: hsp, vsp: vsp,
			grounded: grounded, big: big, state: state,
			jump_was: jump_was, bot_jump: global.bot_jump,
			coins: global.coins, score: global.score, lives: global.lives,
			cam_x: camera_get_view_x(view_camera[0]),
			cam_y: camera_get_view_y(view_camera[0]),
		};
	}
}
