if (global.dm_state != "play") {
	recoil = max(0, recoil - 1);
	flash = max(0, flash - 1);
	exit;
}

// -- input: the real keyboard OR the external seam
var _fwd = 0, _str = 0, _turn = 0;
if (keyboard_check(ord("W")) || keyboard_check(vk_up))    _fwd += 1;
if (keyboard_check(ord("S")) || keyboard_check(vk_down))  _fwd -= 1;
if (keyboard_check(ord("A"))) _str -= 1;
if (keyboard_check(ord("D"))) _str += 1;
if (keyboard_check(vk_left))  _turn -= 1;
if (keyboard_check(vk_right)) _turn += 1;

_fwd  = clamp(_fwd  + global.dm_fwd,    -1, 1);
_str  = clamp(_str  + global.dm_strafe, -1, 1);
_turn = clamp(_turn + global.dm_turn,   -1, 1);

var _running = keyboard_check(vk_shift) || global.dm_run;
var _firing  = keyboard_check(vk_space) || global.dm_fire
	|| (mouse_look && mouse_check_button(mb_left));

// -- mouse look, only while the window is focused
//
// Reading a delta means putting the cursor back in the middle every frame, and
// doing that to an unfocused window would drag the pointer out of whatever the
// user is actually doing.
if (keyboard_check_pressed(vk_escape)) mouse_look = false;
if (!mouse_look && window_has_focus() && mouse_check_button_pressed(mb_left)) {
	// The click that captures the mouse should not also fire the gun.
	mouse_look = true;
	_firing = false;
}
if (mouse_look && window_has_focus()) {
	var _cx = window_get_width() div 2;
	var _cy = window_get_height() div 2;
	if (mouse_ready) {
		dir += (window_mouse_get_x() - _cx) * 0.003;
		pitch = clamp(pitch - (window_mouse_get_y() - _cy) * 0.9, -220, 220);
	}
	window_mouse_set(_cx, _cy);
	mouse_ready = true;
} else {
	mouse_ready = false;
}

dir += _turn * turn_speed;

// -- movement, sliding along walls rather than stopping dead on them
var _speed = _running ? run_speed : walk_speed;
var _dx = cos(dir);
var _dy = sin(dir);
// Right-hand vector: rotating forward by 90 degrees in a y-down world.
var _mx = (_dx * _fwd + -_dy * _str) * _speed;
var _my = (_dy * _fwd +  _dx * _str) * _speed;
if (_mx != 0 || _my != 0) {
	if (!dm_blocked(x + _mx, y, radius)) x += _mx;
	if (!dm_blocked(x, y + _my, radius)) y += _my;
	bob += _speed * 0.13;
}

// -- shooting
if (fire_cool > 0) fire_cool -= 1;
if (_firing && fire_cool <= 0 && global.dm_ammo > 0) fire();

recoil = max(0, recoil - 1.4);
flash = max(0, flash - 1);
hurt_flash = max(0, hurt_flash - 1);

// -- pickups and the exit
var _pick = collision_circle(x, y, 30, obj_dm_pickup, false, true);
if (_pick != noone) with (_pick) take();

if (collision_circle(x, y, 44, obj_dm_exit, false, true) != noone) {
	global.dm_state = "won";
}
