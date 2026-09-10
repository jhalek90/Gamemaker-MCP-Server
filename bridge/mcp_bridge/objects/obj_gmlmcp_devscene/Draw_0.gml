/// Dev-only scene, so a screenshot has something recognisable in it.
/// Excluded from injection: this never travels into a user's project.

draw_set_colour(c_white);
draw_rectangle(0, 0, room_width, room_height, false);

draw_set_colour(c_red);    draw_circle(300, 300, 120, false);
draw_set_colour(c_lime);   draw_rectangle(500, 200, 780, 400, false);
draw_set_colour(c_blue);   draw_triangle(900, 400, 1100, 400, 1000, 180, false);

draw_set_colour(c_black);
draw_set_font(-1);
draw_text(120, 520, "GML_MCP bridge - dev scene");
draw_text(120, 560, "tunables: " + json_stringify(global.gmlmcp_tunables ?? {}));
draw_text(120, 600, "room: " + room_get_name(room) + "   frame: " + string(current_time div 100));
