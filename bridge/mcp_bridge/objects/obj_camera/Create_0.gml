/// Keeps the view centred on the player and inside the room.
///
/// A room view can follow an object on its own, but only by borders: it holds
/// still until the target gets within `hborder` of an edge and then drags
/// along behind. Driving the camera directly is both simpler to reason about
/// and what "centred" actually means.

target = obj_player;

/// 1 snaps to the player; lower numbers trail behind. Snapping is exact, which
/// is what a tile-precise platformer wants.
follow = 1;
