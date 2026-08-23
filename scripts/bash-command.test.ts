import assert from "node:assert/strict";
import test from "node:test";

import { buildBashCommandPresentation, buildBashPreview } from "../extensions/bash-command.ts";

test("headlines a script by its first operative line", () => {
	const presentation = buildBashCommandPresentation(`set -euo pipefail
SESSION="validation-session"
EVIDENCE="/tmp/evidence"
printf 'Starting validation in %s\\n' "$WORKSPACE"
for phase in hashing indexing verifying; do
  printf 'Running %s\\n' "$phase"
done`);

	assert.equal(presentation.headline, `printf 'Starting validation in %s\\n' "$WORKSPACE" · 7 lines`);
});

test("skips standalone shell structure when choosing a headline", () => {
	const presentation = buildBashCommandPresentation(`context_file=/tmp/context
{
echo '# Current source tree'
find src -type f | sort
}`);

	assert.equal(presentation.headline, "echo '# Current source tree' · 5 lines");
});

test("shows multiline scripts verbatim", () => {
	const presentation = buildBashCommandPresentation(`context_file=/tmp/context
{
echo '# Current source tree'
find src -type f | sort
}`);

	assert.deepEqual(buildBashPreview(presentation.sourceLines, 8), [
		"context_file=/tmp/context",
		"{",
		"echo '# Current source tree'",
		"find src -type f | sort",
		"}",
	]);
});

test("shows heredocs as ordinary source lines", () => {
	const presentation = buildBashCommandPresentation(`cat <<'END' | review-command
  Review this code.
  Check error handling.
END
jq '.result' result.json`);

	assert.equal(presentation.headline, "cat <<'END' | review-command · 5 lines");
	assert.deepEqual(buildBashPreview(presentation.sourceLines, 8), [
		"cat <<'END' | review-command",
		"  Review this code.",
		"  Check error handling.",
		"END",
		"jq '.result' result.json",
	]);
});

test("reserves the final preview row for an omission count", () => {
	assert.deepEqual(buildBashPreview(["one", "two", "three", "four"], 3), [
		"one",
		"two",
		"... 2 more lines",
	]);
	assert.deepEqual(buildBashPreview(["one", "two"], 0), []);
	assert.deepEqual(buildBashPreview(["one", "two"], 1), ["... 2 more lines"]);
});

test("normalizes line endings and unsafe control characters without changing indentation", () => {
	const presentation = buildBashCommandPresentation("\r\n\tprintf 'one'\x00\r\n  printf 'two'\r\n\r\n");

	assert.deepEqual(presentation.sourceLines, ["   printf 'one'", "  printf 'two'"]);
	assert.equal(presentation.headline, "printf 'one' · 2 lines");
});
