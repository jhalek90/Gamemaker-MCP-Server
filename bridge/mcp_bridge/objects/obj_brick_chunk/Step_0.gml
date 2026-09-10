vsp = min(vsp + grav, 20);
x += hsp;
y += vsp;
image_angle += spin;

// Debris is decoration: it has no collision and simply falls out of the world.
if (y > room_height + 96) instance_destroy();
