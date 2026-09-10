image_speed = 0.4;
depth = -2;

// Offset the spin by where the coin sits, so a row of them shimmers in a wave
// instead of every coin in the level flashing edge-on at the same instant.
// Derived from position rather than randomised, so it stays deterministic.
image_index = ((x div 64) + (y div 64)) mod sprite_get_number(sprite_index);
