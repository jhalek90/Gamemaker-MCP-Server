// GML_MCP bridge - command handlers.
//
// GML has no eval, so the bridge cannot run arbitrary code sent over the
// wire. Every capability is an explicit verb operating on named assets;
// anything genuinely new needs a source edit and a recompile.

function gmlmcp_dispatch(_command, _args, _socket, _id) {
	switch (_command) {
		case "ping":       return gmlmcp_cmd_ping();
		case "get_var":    return gmlmcp_cmd_get_var(_args);
		case "set_var":    return gmlmcp_cmd_set_var(_args);
		case "instances":  return gmlmcp_cmd_instances(_args);
		case "call":       return gmlmcp_cmd_call(_args);
		case "create":     return gmlmcp_cmd_create(_args);
		case "destroy":    return gmlmcp_cmd_destroy(_args);
		case "goto_room":  return gmlmcp_cmd_goto_room(_args);
		case "speed":      return gmlmcp_cmd_speed(_args);
		case "tunables":   return gmlmcp_cmd_tunables(_args);
		case "screenshot": return gmlmcp_cmd_screenshot(_args, _socket, _id);
		default: throw "unknown command: " + string(_command);
	}
}

function gmlmcp_cmd_ping() {
	return {
		protocol: GMLMCP_PROTOCOL,
		save_directory: game_save_id,
		room: room_get_name(room),
		fps: fps,
		speed: game_get_speed(gamespeed_fps),
	};
}

/// @desc Resolve an instance id, or the first live instance of a named object.
function gmlmcp_resolve_instance(_scope) {
	if (is_real(_scope)) {
		if (!instance_exists(_scope)) throw "no instance with id " + string(_scope);
		return _scope;
	}
	var _object = asset_get_index(string(_scope));
	if (_object == -1) throw "no object named " + string(_scope);
	var _found = instance_find(_object, 0);
	if (!instance_exists(_found)) throw "no live instance of " + string(_scope);
	return _found;
}

function gmlmcp_cmd_get_var(_args) {
	var _name = string(_args[$ "name"]);
	var _scope = _args[$ "scope"] ?? "global";
	if (_scope == "global") {
		if (!variable_global_exists(_name)) throw "no global named " + _name;
		return variable_global_get(_name);
	}
	return variable_instance_get(gmlmcp_resolve_instance(_scope), _name);
}

function gmlmcp_cmd_set_var(_args) {
	var _name = string(_args[$ "name"]);
	var _value = _args[$ "value"];
	var _scope = _args[$ "scope"] ?? "global";
	if (_scope == "global") {
		variable_global_set(_name, _value);
	} else {
		variable_instance_set(gmlmcp_resolve_instance(_scope), _name, _value);
	}
	return { name: _name, value: _value };
}

function gmlmcp_cmd_instances(_args) {
	var _object = all;
	var _name = _args[$ "object"];
	if (!is_undefined(_name)) {
		_object = asset_get_index(string(_name));
		if (_object == -1) throw "no object named " + string(_name);
	}
	var _limit = _args[$ "limit"] ?? 50;
	var _count = instance_number(_object);
	var _list = [];
	for (var _i = 0; _i < _count; _i++) {
		if (array_length(_list) >= _limit) break;
		var _inst = instance_find(_object, _i);
		if (!instance_exists(_inst)) continue;
		array_push(_list, {
			id: real(_inst),
			object: object_get_name(_inst.object_index),
			x: _inst.x,
			y: _inst.y,
		});
	}
	return { count: _count, instances: _list };
}

/// @desc Call a named script function with JSON arguments.
function gmlmcp_cmd_call(_args) {
	var _name = string(_args[$ "function"]);
	var _target = asset_get_index(_name);
	if (_target == -1) throw "no script or function named " + _name;
	var _list = _args[$ "args"] ?? [];
	return script_execute_ext(_target, _list);
}

function gmlmcp_cmd_create(_args) {
	var _name = string(_args[$ "object"]);
	var _object = asset_get_index(_name);
	if (_object == -1) throw "no object named " + _name;
	var _layer = _args[$ "layer"] ?? layer_get_name(layer_get_id_at_depth(0));
	var _inst = instance_create_layer(_args[$ "x"] ?? 0, _args[$ "y"] ?? 0, _layer, _object);
	return { id: real(_inst) };
}

function gmlmcp_cmd_destroy(_args) {
	var _inst = gmlmcp_resolve_instance(_args[$ "id"]);
	instance_destroy(_inst);
	return { destroyed: real(_inst) };
}

function gmlmcp_cmd_goto_room(_args) {
	var _name = string(_args[$ "room"]);
	var _target = asset_get_index(_name);
	if (_target == -1) throw "no room named " + _name;
	room_goto(_target);
	return { room: _name };
}

function gmlmcp_cmd_speed(_args) {
	var _value = _args[$ "fps"];
	if (is_undefined(_value)) return { speed: game_get_speed(gamespeed_fps) };
	game_set_speed(_value, gamespeed_fps);
	return { speed: _value };
}

/// @desc Read or write the live tunables registry.
///
/// Game code registers values it wants adjustable at runtime. Changing them
/// needs no recompile, which is what makes an inspect-adjust-look loop
/// possible at all: GML cannot evaluate new code in a running game.
function gmlmcp_cmd_tunables(_args) {
	if (!variable_global_exists("gmlmcp_tunables")) global.gmlmcp_tunables = {};
	var _set = _args[$ "set"];
	if (!is_undefined(_set)) {
		var _names = variable_struct_get_names(_set);
		for (var _i = 0; _i < array_length(_names); _i++) {
			var _key = _names[_i];
			variable_struct_set(global.gmlmcp_tunables, _key, _set[$ _key]);
		}
	}
	return global.gmlmcp_tunables;
}

/// @desc Queue a screenshot, taken at the end of the frame.
///
/// screen_save captures the current back buffer, so calling it from an async
/// event would catch a partly drawn frame. The reply is sent once the image
/// exists.
function gmlmcp_cmd_screenshot(_args, _socket, _id) {
	var _name = _args[$ "name"] ?? ("gmlmcp_" + string(get_timer()) + ".png");
	array_push(obj_gmlmcp_bridge.shots, { socket: _socket, id: _id, name: _name });
	return GMLMCP_DEFERRED;
}
