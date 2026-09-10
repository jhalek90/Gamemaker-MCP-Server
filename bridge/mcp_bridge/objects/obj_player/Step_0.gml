/// Movement, collision, and the three things that can end a life.

if (state != "play") {
	state_timer += 1;
	if (state == "won") {
		// Settle down the pole rather than freezing in mid-air.
		if (!place_meeting(x, y + 4, obj_solid)) y += 4;
		image_index = 0;
	}
	if (state == "dead") {
		// A short arc up and out before the level resets.
		vsp = min(vsp + grav, fall_max);
		y += vsp;
		if (state_timer > 80) {
			global.lives -= 1;
			global.coins = 0;
			if (global.lives <= 0) global.lives = 3;
			room_restart();
		}
	}
	exit;
}

// -- input
//
// Every button is the real keyboard OR a global an outside process can set.
// Simulated key presses do reach keyboard_check, so this is not a workaround
// for a broken path -- it is a seam that states intent directly, so a driver
// holding "right" for a known number of frames cannot be confused with, or
// disturbed by, a real keyboard. A human playing is unaffected.
var _left  = keyboard_check(vk_left)  || keyboard_check(ord("A")) || global.bot_left;
var _right = keyboard_check(vk_right) || keyboard_check(ord("D")) || global.bot_right;
var _run   = keyboard_check(vk_shift) || keyboard_check(ord("X")) || global.bot_run;
// A one-shot jump request, holding the button for the number of frames asked
// for. It is consumed the moment it is seen, so a driver that forgets to clear
// a flag cannot jam the button down -- and because one request describes the
// whole jump, a slow driver still gets full height instead of a stunted hop.
if (global.bot_jump_once > 0) {
	bot_hold = global.bot_jump_once;
	global.bot_jump_once = 0;
}
if (bot_hold > 0) bot_hold -= 1;

var _jump_held = keyboard_check(vk_space) || keyboard_check(vk_up)
	|| keyboard_check(ord("Z")) || keyboard_check(ord("W"))
	|| global.bot_jump || bot_hold > 0;

// Edge detection by hand, because keyboard_check_pressed knows nothing about
// the seam above.
//
var _jump_now = _jump_held && !jump_was;
jump_was = _jump_held;

var _dir = _right - _left;

// -- horizontal: accelerate toward the held direction, slide to a stop otherwise
var _top = _run ? run_max : walk_max;
if (_dir != 0) {
	facing = _dir;
	hsp += _dir * walk_accel;
	if (abs(hsp) > _top) hsp = _top * sign(hsp);
} else {
	var _drag = grounded ? drag_ground : drag_air;
	if (abs(hsp) <= _drag) hsp = 0; else hsp -= _drag * sign(hsp);
}

// -- jumping
if (grounded) coyote = 6; else if (coyote > 0) coyote -= 1;
if (_jump_now) buffer = 6; else if (buffer > 0) buffer -= 1;

if (buffer > 0 && coyote > 0) {
	vsp = jump_power;
	buffer = 0;
	coyote = 0;
	grounded = false;
}
// Letting go early clips the rise, so a tap is a hop and a hold is a leap.
if (!_jump_held && vsp < jump_cut) vsp = jump_cut;

vsp = min(vsp + grav, fall_max);

// -- horizontal collision: walk up to the wall a pixel at a time, then stop
if (hsp != 0 && place_meeting(x + hsp, y, obj_solid)) {
	var _step = sign(hsp);
	while (!place_meeting(x + _step, y, obj_solid)) x += _step;
	hsp = 0;
}
x += hsp;

// -- vertical collision
grounded = false;
if (vsp != 0 && place_meeting(x, y + vsp, obj_solid)) {
	var _step = sign(vsp);
	while (!place_meeting(x, y + _step, obj_solid)) y += _step;
	if (vsp > 0) {
		grounded = true;
	} else {
		// Came up into something. If it was a bonus block, pop it. The inset
		// keeps a brush past the corner of a block from counting as a hit.
		var _block = collision_rectangle(bbox_left + 8, bbox_top - 8, bbox_right - 8, bbox_top, obj_block, false, true);
		if (_block != noone) with (_block) bump();
	}
	vsp = 0;
}
y += vsp;

// -- enemies: coming down on the head is a stomp, anything else is a hit
//
// The test is where the feet are, not which way they are moving. Tying it to
// a downward vsp meant clipping an enemy on the way up counted as a hit, which
// reads as unfair -- you were plainly above it.
var _foe = instance_place(x, y, obj_goomba);
if (_foe != noone && _foe.state == "alive") {
	if (bbox_bottom < _foe.bbox_top + 26) {
		with (_foe) squash();
		vsp = _jump_held ? bounce_high : bounce_low;
		global.score += 100;
	} else {
		hurt();
	}
}

// -- the two ways the level ends
if (place_meeting(x, y, obj_goal)) {
	state = "won";
	state_timer = 0;
	hsp = 0;
	global.score += 1000;
}
if (y > room_height + 64) die();

// -- power state and animation
if (invuln > 0) {
	invuln -= 1;
	image_alpha = ((invuln div 4) mod 2 == 0) ? 0.35 : 1;
} else {
	image_alpha = 1;
}

sprite_index = big ? spr_mario_big : spr_mario_small;
image_xscale = facing;
if (!grounded) {
	image_index = 3;
} else if (hsp == 0) {
	anim = 0;
	image_index = 0;
} else {
	// The feet cycle in step with how fast the ground is going past.
	anim += abs(hsp) * 0.07;
	image_index = 1 + (floor(anim) mod 2);
}
