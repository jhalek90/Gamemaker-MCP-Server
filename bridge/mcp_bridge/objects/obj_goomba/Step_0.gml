if (state == "squashed") {
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
