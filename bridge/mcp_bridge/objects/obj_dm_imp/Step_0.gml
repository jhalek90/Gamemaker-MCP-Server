if (state == "dead") {
	timer += 1;
	// Three frames of collapse, then it stays put as a corpse.
	image_index = 3 + min(2, timer div 8);
	exit;
}
if (global.dm_state != "play" || !instance_exists(obj_dm_player)) exit;

var _px = obj_dm_player.x;
var _py = obj_dm_player.y;
var _dist = point_distance(x, y, _px, _py);
var _sees = (_dist < 700) && dm_los(x, y, _px, _py);

if (state == "idle") {
	image_index = 0;
	if (_sees) state = "chase";
	exit;
}

if (cool > 0) cool -= 1;

if (state == "attack") {
	timer += 1;
	image_index = 2;
	// The wind-up is deliberate: it is the tell that lets you dodge.
	if (timer == 18) {
		var _shot = instance_create_layer(x, y, "Instances", obj_dm_fireball);
		_shot.dir = arctan2(_py - y, _px - x);
	}
	if (timer > 30) state = "chase";
	exit;
}

if (_sees && _dist < 520 && _dist > 90 && cool <= 0) {
	state = "attack";
	timer = 0;
	cool = 90;
	exit;
}

if (_sees) {
	var _angle = arctan2(_py - y, _px - x);
	var _mx = cos(_angle) * walk_speed;
	var _my = sin(_angle) * walk_speed;
	if (!dm_blocked(x + _mx, y, radius)) x += _mx;
	if (!dm_blocked(x, y + _my, radius)) y += _my;

	// Claw at point blank, rather than throwing fire from inside your face.
	if (_dist < 56 && cool <= 0) {
		with (obj_dm_player) hurt(9);
		cool = 45;
	}
}

anim += 0.12;
image_index = floor(anim) mod 2;
