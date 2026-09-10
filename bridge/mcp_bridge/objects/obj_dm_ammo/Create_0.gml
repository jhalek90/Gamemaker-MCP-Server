visible = false;
image_speed = 0;
dm_scale = 0.35;

take = function() {
	global.dm_ammo += 12;
	instance_destroy();
};
