life -= 1;
if (life <= 0) { instance_destroy(); exit; }

var _mx = cos(dir) * speed_px;
var _my = sin(dir) * speed_px;
if (dm_blocked(x + _mx, y + _my, 4)) { instance_destroy(); exit; }
x += _mx;
y += _my;

if (instance_exists(obj_dm_player) && point_distance(x, y, obj_dm_player.x, obj_dm_player.y) < 26) {
	with (obj_dm_player) hurt(14);
	instance_destroy();
}
