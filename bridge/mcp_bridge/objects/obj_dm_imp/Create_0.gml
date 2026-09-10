/// An imp: closes on the player, throws fire, collapses when shot enough.

visible = false;      // the raycaster draws it
image_speed = 0;
dm_scale = 0.85;      // fraction of a cell tall

hp = 60;
state = "idle";       // idle | chase | attack | dead
anim = 0;
timer = 0;
cool = 0;
radius = 14;
walk_speed = 1.5;

hurt = function(_amount) {
	if (state == "dead") return;
	hp -= _amount;
	if (hp > 0) {
		state = "chase";   // being shot at is a reliable way to get noticed
		return;
	}
	state = "dead";
	timer = 0;
	global.dm_kills += 1;
};
