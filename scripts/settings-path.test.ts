import assert from "node:assert/strict";
import test from "node:test";

import { getUserSettingsPath } from "../extensions/settings-path.ts";

test("uses Pi's configured agent directory", () => {
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = "/tmp/pi-config";

	try {
		assert.equal(getUserSettingsPath(), "/tmp/pi-config/settings.json");
	} finally {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
	}
});
