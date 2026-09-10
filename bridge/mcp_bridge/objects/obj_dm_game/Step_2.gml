/// One snapshot an outside driver can read in a single request.
if (instance_exists(obj_dm_player)) {
	with (obj_dm_player) {
		global.dm_view = {
			x: x, y: y, dir: dir,
			col: floor(x / DM_CELL), row: floor(y / DM_CELL),
			health: global.dm_health, ammo: global.dm_ammo,
			kills: global.dm_kills, total: global.dm_total,
			state: global.dm_state,
			imps: instance_number(obj_dm_imp),
			fps: fps, fps_real: floor(fps_real),
		};
	}
}
