if (place_meeting(x + hsp, y, obj_solid)) hsp = -hsp;
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
