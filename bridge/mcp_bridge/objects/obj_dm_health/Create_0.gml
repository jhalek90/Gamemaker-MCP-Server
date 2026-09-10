visible = false;
image_speed = 0;
dm_scale = 0.35;

take = function() {
	if (global.dm_health >= 100) return;
	global.dm_health = min(100, global.dm_health + 25);
	instance_destroy();
};
