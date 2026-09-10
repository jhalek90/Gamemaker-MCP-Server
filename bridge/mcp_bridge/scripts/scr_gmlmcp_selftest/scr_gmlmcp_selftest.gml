// Dev-only self-test helpers. Excluded from injection.
//
// These exist so the test runner's determinism claim can be checked against
// something that actually consumes randomness.

/// @desc A value derived from the current random sequence.
function gmlmcp_selftest_random() {
	return irandom(1000000);
}

/// @desc Advance a counter, so waits can be shown to advance real frames.
function gmlmcp_selftest_bump(_by) {
	if (!variable_global_exists("gmlmcp_selftest_counter")) global.gmlmcp_selftest_counter = 0;
	global.gmlmcp_selftest_counter += (_by ?? 1);
	return global.gmlmcp_selftest_counter;
}
