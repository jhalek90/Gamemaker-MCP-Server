/// A small platformer character: run, jump, stomp, grow.
///
/// The numbers are tuned against a 64px tile. A jump clears a little over
/// three tiles of height and about five of distance, which is what makes the
/// pits and platforms in rm_level1 fair rather than fussy.

hsp = 0;
vsp = 0;
anim = 0;

grav        = 0.5;
fall_max    = 18;
walk_accel  = 0.7;
walk_max    = 6;
run_max     = 9.5;
drag_ground = 0.55;
drag_air    = 0.15;
jump_power  = -15;
jump_cut    = -4;    // vsp a released jump is clipped to
bounce_low  = -9;    // rebound off a stomped enemy
bounce_high = -13;   // ... with jump still held

facing   = 1;
grounded = false;
big      = false;
invuln   = 0;

state = "play";      // play | dead | won
state_timer = 0;
jump_was = false;
bot_hold = 0;

// A few frames of slack either side of leaving the ground. Neither is
// noticeable while playing; both stop the jump feeling like it ignored you.
coyote = 0;
buffer = 0;

sprite_index = spr_mario_small;
image_speed  = 0;
depth = -10;

/// Take a hit. Big shrinks back to small and gets a moment of mercy; small is
/// fatal. The sprites share a bottom-centre origin, so the swap keeps the feet
/// planted and no correction is needed here.
hurt = function() {
	if (invuln > 0 || state != "play") return;
	if (big) {
		big = false;
		invuln = 120;
	} else {
		die();
	}
};

/// Begin the death sequence. The Step event resets the room once it finishes.
die = function() {
	if (state != "play") return;
	state = "dead";
	state_timer = 0;
	hsp = 0;
	vsp = -12;
	image_index = 3;
};

/// Grow, from a mushroom.
grow = function() {
	big = true;
	invuln = max(invuln, 30);
};
