import assert from "node:assert/strict";
import test from "node:test";

import {
	buildBashCommandPresentation,
	limitBashOutline,
	omitBashHeadlineFromOutline,
} from "../extensions/bash-command.ts";

test("summarizes setup and preserves operative script structure", () => {
	const presentation = buildBashCommandPresentation(`set -euo pipefail
SESSION="validation-session"
EVIDENCE="/tmp/evidence"
printf 'Starting validation in %s\\n' "$WORKSPACE"
for phase in hashing indexing verifying; do
  printf 'Running %s\\n' "$phase"
done`);

	assert.equal(presentation.headline, `printf 'Starting validation in %s\\n' "$WORKSPACE" · 7 lines`);
	assert.deepEqual(presentation.outlineLines.slice(0, 3), [
		"setup: strict mode, SESSION, EVIDENCE",
		`printf 'Starting validation in %s\\n' "$WORKSPACE"`,
		"for phase in hashing indexing verifying; do",
	]);
	assert.deepEqual(omitBashHeadlineFromOutline(presentation).slice(0, 2), [
		"setup: strict mode, SESSION, EVIDENCE",
		"for phase in hashing indexing verifying; do",
	]);
});

test("folds heredoc bodies in the outline", () => {
	const presentation = buildBashCommandPresentation(`cat > /tmp/check.sh <<'SH'
echo one
echo two
SH
chmod +x /tmp/check.sh`);

	assert.deepEqual(presentation.outlineLines, [
		"cat > /tmp/check.sh <<'SH'",
		"... heredoc (2 lines)",
		"SH",
		"chmod +x /tmp/check.sh",
	]);
	assert.deepEqual(presentation.sourceLines.slice(1, 3), ["echo one", "echo two"]);
	assert.deepEqual(omitBashHeadlineFromOutline(presentation), [
		"... heredoc (2 lines)",
		"SH",
		"chmod +x /tmp/check.sh",
	]);
});

test("reserves the final outline row for an omission count", () => {
	assert.deepEqual(limitBashOutline(["one", "two", "three", "four"], 3), [
		"one",
		"two",
		"... 2 more actions",
	]);
	assert.deepEqual(limitBashOutline(["one", "two"], 0), []);
});
