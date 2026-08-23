import assert from "node:assert/strict";
import test from "node:test";

import {
	buildBashCommandPresentation,
	buildBashOutlinePreview,
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

test("shows a short heredoc body without its delimiter", () => {
	const presentation = buildBashCommandPresentation(`cat > /tmp/check.sh <<'SH'
echo one
echo two
SH
chmod +x /tmp/check.sh`);

	assert.equal(presentation.headline, "cat > /tmp/check.sh <<'SH' · script: 2 lines");
	assert.deepEqual(omitBashHeadlineFromOutline(presentation), [
		"script · 2 lines",
		"  echo one",
		"  echo two",
		"chmod +x /tmp/check.sh",
	]);
	assert.deepEqual(buildBashOutlinePreview(presentation, 4), [
		"script · 2 lines",
		"  echo one",
		"  echo two",
		"chmod +x /tmp/check.sh",
	]);
});

test("headlines a piped heredoc by its consumer and shows one line of stdin", () => {
	const presentation = buildBashCommandPresentation(
		`cat <<'_CONSULT_LLM_END_' | consult-llm -f README.md\nReview the rendering for clarity.\n_CONSULT_LLM_END_`,
	);

	assert.equal(presentation.headline, "consult-llm -f README.md · stdin: 1 line");
	assert.deepEqual(buildBashOutlinePreview(presentation, 4), [
		"stdin · 1 line",
		"  Review the rendering for clarity.",
	]);
});

test("bounds long heredocs and reserves a row for a following action", () => {
	const body = Array.from({ length: 12 }, (_, index) => `prompt line ${index + 1}`).join("\n");
	const presentation = buildBashCommandPresentation(`cat <<'EOF' | consult-llm
${body}
EOF
jq '.result' result.json`);

	assert.deepEqual(buildBashOutlinePreview(presentation, 4), [
		"stdin · 12 lines",
		"  prompt line 1",
		"  ... 11 more lines",
		"jq '.result' result.json",
	]);
});

test("uses two body rows when a long heredoc is the only preview item", () => {
	const body = Array.from({ length: 6 }, (_, index) => `line ${index + 1}`).join("\n");
	const presentation = buildBashCommandPresentation(`cat <<'EOF'\n${body}\nEOF`);

	assert.deepEqual(buildBashOutlinePreview(presentation, 4), [
		"stdin · 6 lines",
		"  line 1",
		"  line 2",
		"  ... 4 more lines",
	]);
});

test("ignores standalone shell structure in the headline and outline", () => {
	const presentation = buildBashCommandPresentation(`context_file=/tmp/context
{
echo '# Current source tree'
find src -type f | sort
}`);

	assert.equal(presentation.headline, "echo '# Current source tree' · 5 lines");
	assert.deepEqual(presentation.outlineLines, [
		"setup: context_file",
		"echo '# Current source tree'",
		"find src -type f | sort",
	]);
	assert.deepEqual(buildBashOutlinePreview(presentation, 4), ["setup: context_file", "find src -type f | sort"]);
});

test("describes omitted outline rows as lines", () => {
	assert.deepEqual(limitBashOutline(["one", "two", "three", "four"], 3), [
		"one",
		"two",
		"... 2 more lines",
	]);
	assert.deepEqual(limitBashOutline(["one", "two"], 0), []);
});
