/// Coins, lives, score, and everything drawn over the top.
///
/// Persistent, so a room restart continues the run instead of starting a new
/// game. The guard matters only on a cold start.

if (!variable_global_exists("coins")) {
	global.coins = 0;
	global.lives = 3;
	global.score = 0;
}

// The external input seam. Left alone, these stay false and the game plays
// exactly as a keyboard-only game would.
global.bot_left  = false;
global.bot_right = false;
global.bot_jump  = false;
global.bot_run   = false;
global.bot_jump_once = 0;

global.botview = {};
