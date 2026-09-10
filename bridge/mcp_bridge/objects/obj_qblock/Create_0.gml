/// A bonus block. Hit it from below once, and it gives up what it holds.

used = false;
bump_offset = 0;
image_speed = 0.15;

bump = function() {
	if (used) return;
	used = true;
	sprite_index = spr_qblock_used;
	image_speed = 0;
	image_index = 0;
	bump_offset = -14;

	// The classic rule: a mushroom while small, a coin once you are already big.
	if (instance_exists(obj_player) && obj_player.big) {
		global.coins += 1;
		global.score += 200;
	} else {
		var _m = instance_create_layer(x + 32, y, "Instances", obj_mushroom);
		_m.hsp = 3;
	}
};
