/// The marine: movement, shooting, and the first-person view.

// Must stay visible: GameMaker skips every Draw event, Draw GUI included, for
// an invisible instance -- and this object's Draw GUI *is* the whole game.
// There is no sprite, so being visible costs nothing.
visible = true;

dir   = 0;        // radians. The world is y-down, so this turns clockwise.
pitch = 0;        // vertical shear, in pixels

walk_speed = 3.2;
run_speed  = 5.4;
turn_speed = 0.045;
radius     = 18;

bob        = 0;
recoil     = 0;
flash      = 0;   // muzzle flash frames left
hurt_flash = 0;
fire_cool  = 0;

// Mouse look re-centres the cursor every frame to read a delta, which drags
// the pointer out of whatever else is on screen. So it stays off until you
// click in the window to claim it, and Escape gives it back.
mouse_look  = false;
mouse_ready = false;

/// Take damage. Death stops the level rather than ending the process, so the
/// player can see what killed them.
hurt = function(_amount) {
	if (global.dm_state != "play") return;
	global.dm_health -= _amount;
	hurt_flash = 12;
	if (global.dm_health <= 0) {
		global.dm_health = 0;
		global.dm_state = "dead";
	}
};

/// Fire the shotgun: a hitscan down a narrow cone, nearest target wins.
fire = function() {
	global.dm_ammo -= 1;
	fire_cool = 20;
	flash = 5;
	recoil = 12;

	var _best = noone;
	var _best_d = 100000;
	with (obj_dm_imp) {
		if (state == "dead") continue;
		var _d = point_distance(x, y, other.x, other.y);
		if (_d > 900 || _d >= _best_d) continue;
		if (abs(dm_angle_diff(arctan2(y - other.y, x - other.x), other.dir)) > 0.16) continue;
		if (!dm_los(other.x, other.y, x, y)) continue;
		_best_d = _d;
		_best = id;
	}
	if (_best != noone) with (_best) hurt(34);
};
