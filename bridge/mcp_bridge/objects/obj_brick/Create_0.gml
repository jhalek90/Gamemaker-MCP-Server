/// A breakable platform.
///
/// Big Mario smashes it from below; small Mario only nudges it. That is the
/// classic rule, and it quietly makes the mushroom worth chasing -- being big
/// is not just an extra hit, it opens up parts of the level.

bump_offset = 0;

bump = function() {
	if (instance_exists(obj_player) && obj_player.big) {
		shatter();
		return;
	}
	bump_offset = -12;
};

/// Four chunks arcing away, and the block is gone.
shatter = function() {
	var _pieces = [
		[16, 16, -2.2, -9.5],
		[48, 16,  2.2, -9.5],
		[16, 48, -3.0, -6.5],
		[48, 48,  3.0, -6.5],
	];
	for (var _i = 0; _i < 4; _i++) {
		var _p = _pieces[_i];
		var _c = instance_create_layer(x + _p[0], y + _p[1], "Instances", obj_brick_chunk);
		_c.hsp  = _p[2];
		_c.vsp  = _p[3];
		_c.spin = (_p[2] < 0) ? 8 : -8;
	}
	global.score += 50;
	instance_destroy();
};
