/**
 * Every line of GML the platformer runs, as event source.
 *
 * Keeping it here rather than inline in the builder means the whole game is
 * readable in one pass, and `gml_check` sees exactly what GameMaker will
 * compile.
 */

// -- player ---------------------------------------------------------------

export const PLAYER_CREATE = `/// A small platformer character: run, jump, stomp, grow.
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
`;

export const PLAYER_STEP = `/// Movement, collision, and the three things that can end a life.

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
`;

// -- enemy ----------------------------------------------------------------

export const GOOMBA_CREATE = `/// A patrolling enemy. Walks, turns at walls and ledges, flattens when stomped.

hsp = -1.6;
vsp = 0;
grav = 0.5;
anim = 0;
timer = 0;
state = "alive";     // alive | squashed

// Frame 2 is the flattened body, so the walk cycle is driven by hand rather
// than letting image_speed run through every frame.
image_speed = 0;
depth = -5;

squash = function() {
	if (state != "alive") return;
	state = "squashed";
	timer = 0;
	hsp = 0;
	image_index = 2;
};
`;

export const GOOMBA_STEP = `if (state == "squashed") {
	timer += 1;
	if (timer > 40) instance_destroy();
	exit;
}

// Turn at a wall, or at the edge of the level.
if (place_meeting(x + hsp, y, obj_solid)) hsp = -hsp;
if ((x < 40 && hsp < 0) || (x > room_width - 40 && hsp > 0)) hsp = -hsp;

// Turn at a ledge, so the level's pits do not quietly empty themselves.
if (place_meeting(x, y + 1, obj_solid)) {
	var _ahead = (hsp > 0) ? bbox_right + 6 : bbox_left - 6;
	if (!position_meeting(_ahead, bbox_bottom + 4, obj_solid)) hsp = -hsp;
}
x += hsp;

vsp = min(vsp + grav, 16);
if (vsp != 0 && place_meeting(x, y + vsp, obj_solid)) {
	var _step = sign(vsp);
	while (!place_meeting(x, y + _step, obj_solid)) y += _step;
	vsp = 0;
}
y += vsp;

anim += 0.08;
image_index = floor(anim) mod 2;
image_xscale = (hsp > 0) ? 1 : -1;

if (y > room_height + 128) instance_destroy();
`;

// -- pickups --------------------------------------------------------------

export const COIN_CREATE = `image_speed = 0.4;
depth = -2;

// Offset the spin by where the coin sits, so a row of them shimmers in a wave
// instead of every coin in the level flashing edge-on at the same instant.
// Derived from position rather than randomised, so it stays deterministic.
image_index = ((x div 64) + (y div 64)) mod sprite_get_number(sprite_index);
`;

export const COIN_COLLECT = `global.coins += 1;
global.score += 200;
instance_destroy();
`;

export const BRICK_CREATE = `/// A breakable platform.
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
`;

export const BRICK_STEP = `// Settle back down after a nudge.
if (bump_offset < 0) bump_offset = min(0, bump_offset + 2);
`;

export const BRICK_DRAW = `// Drawn by hand so the block can lift off its collision box when bumped.
draw_sprite(sprite_index, image_index, x, y + bump_offset);
`;

export const CHUNK_CREATE = `hsp = 0;
vsp = 0;
spin = 8;
grav = 0.5;
image_speed = 0;
depth = -20;
`;

export const CHUNK_STEP = `vsp = min(vsp + grav, 20);
x += hsp;
y += vsp;
image_angle += spin;

// Debris is decoration: it has no collision and simply falls out of the world.
if (y > room_height + 96) instance_destroy();
`;

export const QBLOCK_CREATE = `/// A bonus block. Hit it from below once, and it gives up what it holds.

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
`;

export const QBLOCK_STEP = `// Settle back down after being hit.
if (bump_offset < 0) bump_offset = min(0, bump_offset + 2);
`;

export const QBLOCK_DRAW = `// Drawn by hand so the block can lift off its collision box when bumped.
draw_sprite(sprite_index, image_index, x, y + bump_offset);
`;

export const MUSHROOM_CREATE = `hsp = 3;
vsp = 0;
grav = 0.5;
depth = -3;
`;

export const MUSHROOM_STEP = `if (place_meeting(x + hsp, y, obj_solid)) hsp = -hsp;
if ((x < 40 && hsp < 0) || (x > room_width - 40 && hsp > 0)) hsp = -hsp;
x += hsp;

vsp = min(vsp + grav, 16);
if (vsp != 0 && place_meeting(x, y + vsp, obj_solid)) {
	var _step = sign(vsp);
	while (!place_meeting(x, y + _step, obj_solid)) y += _step;
	vsp = 0;
}
y += vsp;

if (y > room_height + 128) instance_destroy();
`;

export const MUSHROOM_COLLECT = `with (other) grow();
global.score += 500;
instance_destroy();
`;

// -- scenery --------------------------------------------------------------

export const GOAL_CREATE = `image_speed = 0;
depth = 20;
`;

export const CLOUD_CREATE = `image_speed = 0;
// Behind the action but in front of the room's background layer, which sits
// at depth 100.
depth = 90;
`;

// -- camera ---------------------------------------------------------------

export const CAMERA_CREATE = `/// Keeps the view centred on the player and inside the room.
///
/// A room view can follow an object on its own, but only by borders: it holds
/// still until the target gets within \`hborder\` of an edge and then drags
/// along behind. Driving the camera directly is both simpler to reason about
/// and what "centred" actually means.

target = obj_player;

/// 1 snaps to the player; lower numbers trail behind. Snapping is exact, which
/// is what a tile-precise platformer wants.
follow = 1;
`;

export const CAMERA_END_STEP = `if (!instance_exists(target)) exit;

var _cam = view_camera[0];
var _w = camera_get_view_width(_cam);
var _h = camera_get_view_height(_cam);

// The player's origin is at its feet, so aim at the middle of the body rather
// than at y, or the view sits low by half a sprite.
var _tx = target.x;
var _ty = target.bbox_top + (target.bbox_bottom - target.bbox_top) * 0.5;

// Centre, then clamp to the room. Without the clamp the view runs off the ends
// of the level and shows empty space either side. max(0, ...) keeps it sane if
// the room is ever smaller than the view.
var _x = clamp(_tx - _w * 0.5, 0, max(0, room_width  - _w));
var _y = clamp(_ty - _h * 0.5, 0, max(0, room_height - _h));

if (follow < 1) {
	_x = lerp(camera_get_view_x(_cam), _x, follow);
	_y = lerp(camera_get_view_y(_cam), _y, follow);
}

// Whole pixels, so the tile art does not shimmer as the view moves.
camera_set_view_pos(_cam, floor(_x), floor(_y));
`;

// -- the run --------------------------------------------------------------

export const GAME_CREATE = `/// Coins, lives, score, and everything drawn over the top.
///
/// Persistent, so a room restart continues the run instead of starting a new
/// game. The guard matters only on a cold start.

if (!variable_global_exists("coins")) {
	global.coins = 0;
	global.lives = 3;
	global.score = 0;
}

// The external input seam. Left alone, these stay false and the game plays
// exactly as a keyboard-only game would.
global.bot_left  = false;
global.bot_right = false;
global.bot_jump  = false;
global.bot_run   = false;
global.bot_jump_once = 0;

global.botview = {};
`;

/// One struct holding everything an outside driver needs, refreshed after the
/// player has moved. Reading it is a single request; reading the same facts a
/// variable at a time cost enough round trips that the game moved on between
/// the question and the answer.
export const GAME_END_STEP = `if (instance_exists(obj_player)) {
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
`;

export const GAME_STEP = `if (keyboard_check_pressed(ord("R"))) {
	global.coins = 0;
	global.score = 0;
	global.lives = 3;
	room_restart();
}
`;

export const GAME_DRAW_GUI = `var _w = display_get_gui_width();

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
`;
