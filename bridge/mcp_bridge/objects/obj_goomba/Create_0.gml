/// A patrolling enemy. Walks, turns at walls and ledges, flattens when stomped.

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
