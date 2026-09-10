if (!instance_exists(target)) exit;

var _cam = view_camera[0];
var _w = camera_get_view_width(_cam);
var _h = camera_get_view_height(_cam);

// The player's origin is at its feet, so aim at the middle of the body rather
// than at y, or the view sits low by half a sprite.
var _tx = target.x;
var _ty = target.bbox_top + (target.bbox_bottom - target.bbox_top) * 0.5;

// Centre, then clamp to the room. Without the clamp the view runs off the ends
// of the level and shows empty space either side. max(0, ...) keeps it sane if
// the room is ever smaller than the view.
var _x = clamp(_tx - _w * 0.5, 0, max(0, room_width  - _w));
var _y = clamp(_ty - _h * 0.5, 0, max(0, room_height - _h));

if (follow < 1) {
	_x = lerp(camera_get_view_x(_cam), _x, follow);
	_y = lerp(camera_get_view_y(_cam), _y, follow);
}

// Whole pixels, so the tile art does not shimmer as the view moves.
camera_set_view_pos(_cam, floor(_x), floor(_y));
