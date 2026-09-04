import assert from "node:assert/strict";
import test from "node:test";

import {
	buildBashCommandPresentation,
	buildBashPreview,
	describeBashSource,
	formatBashDuration,
	getLastBashOutputLine,
} from "../extensions/bash-command.ts";

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

test("describes visible source without repeating its headline", () => {
	assert.equal(describeBashSource(buildBashCommandPresentation("git status --short")), "command");
	assert.equal(describeBashSource(buildBashCommandPresentation("echo one\necho two")), "script · 2 lines");
});

test("formats live and completed durations compactly", () => {
	assert.equal(formatBashDuration(400), "<1s");
	assert.equal(formatBashDuration(12_900), "12s");
	assert.equal(formatBashDuration(64_000), "1m 04s");
	assert.equal(formatBashDuration(3_780_000), "1h 03m");
});

test("selects the latest non-empty bash output line", () => {
	assert.equal(getLastBashOutputLine("building\n\n  testing target 3  \n"), "testing target 3");
	assert.equal(getLastBashOutputLine("\n\t\n"), undefined);
});

test("treats carriage-return progress as live output and removes terminal escapes", () => {
	assert.equal(
		getLastBashOutputLine("\u001b[32mCompiling\u001b[0m\r\u001b]0;tests\u0007Running suite 4/9\r"),
		"Running suite 4/9",
	);
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
