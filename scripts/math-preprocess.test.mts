import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";

import "./ts-resolve-loader.mjs";
register("./ts-resolve-loader.mjs", import.meta.url);

// extensions/index.ts is the extension's single default-export entry point; the
// math preprocessing internals live inside it and are reached through the
// __mathPreprocessInternals namespace added for these regression tests (issue #33).
const { __mathPreprocessInternals } = await import("../extensions/index.ts");

interface Segment {
	kind: string;
	md?: { render: (width: number) => string[] };
	raw?: string;
}

// MarkdownTheme requires every styling hook; identity functions keep assertions
// on plain text so ANSI styling cannot hide substring mismatches.
function identityTheme(): Record<string, (text: string) => string> {
	const identity = (text: string) => text;
	return {
		heading: identity,
		link: identity,
		linkUrl: identity,
		code: identity,
		codeBlock: identity,
		codeBlockBorder: identity,
		quote: identity,
		quoteBorder: identity,
		hr: identity,
		listBullet: identity,
		bold: identity,
		italic: identity,
		strikethrough: identity,
		underline: identity,
	};
}

function buildSegments(text: string): Segment[] {
	return __mathPreprocessInternals.buildParagraphSegments(
		text,
		identityTheme() as never,
		undefined,
	) as Segment[];
}

function renderedText(segments: Segment[]): string {
	return segments
		.map((segment) => (segment.kind === "markdown" ? segment.md!.render(120).join("\n") : segment.raw ?? ""))
		.join("\n")
		.split("\n")
		.map((line) => line.replace(/[ \t]+$/, ""))
		.join("\n");
}

test("display math scanning preserves fenced blocks containing $$", () => {
	const text = 'Check:\n\n```bash\necho "pid $$"\nkill -0 $$ && echo alive\n```\n';
	const segments = buildSegments(text);
	assert.deepEqual(
		segments.map((segment) => segment.kind),
		["markdown"],
		"a fenced $$ must not split the paragraph into math segments",
	);
	const output = renderedText(segments);
	assert.ok(output.includes('echo "pid $$"'), `fence line missing: ${output}`);
	assert.ok(output.includes("kill -0 $$ && echo alive"), `fence line missing: ${output}`);
});

test("display math scanning preserves fenced blocks containing \\[ ... \\]", () => {
	const text = "Search:\n\n```bash\ngrep -E '\\[ERROR\\] code=[0-9]+' app.log\n```\n";
	const segments = buildSegments(text);
	assert.deepEqual(
		segments.map((segment) => segment.kind),
		["markdown"],
		"a fenced \\[ … \\] must not split the paragraph into math segments",
	);
	assert.ok(
		renderedText(segments).includes("grep -E '\\[ERROR\\] code=[0-9]+' app.log"),
		"fence line missing",
	);
});

test("math candidates inside inline code spans do not split the paragraph", () => {
	const text = 'Run `echo "pid $$"` and `grep \'\\[a-z\\]\'` for details.\n';
	const segments = buildSegments(text);
	assert.ok(
		segments.every((segment) => segment.kind === "markdown"),
		"inline code spans must never be cut into math segments",
	);
	const output = renderedText(segments);
	assert.ok(output.includes('echo "pid $$"'), `inline span mangled: ${output}`);
	assert.ok(output.includes("grep '[a-z]'") || output.includes("grep '\\[a-z\\]'"), `span lost: ${output}`);
});

test("genuine display math after a fenced block is still honored", () => {
	const text = '```bash\nkill -0 $$ && echo alive\n```\n\nThe PID result:\n\n$$\nE = mc^2\n$$\n';
	const segments = buildSegments(text);
	const kinds = segments.map((segment) => segment.kind);
	assert.ok(kinds.includes("math"), `math segment missing: ${kinds.join(",")}`);
	const math = segments.find((segment) => segment.kind === "math") as { raw: string };
	assert.equal(math.raw, "E = mc^2");
	assert.ok(
		renderedText(segments).includes("kill -0 $$ && echo alive"),
		"fence must survive alongside real math",
	);
});

test("genuine display math before a fenced block is still honored", () => {
	const text = 'Math:\n\n$$\n\\alpha + \\beta\n$$\n\nShell:\n\n```bash\nkill -0 $$\n```\n';
	const segments = buildSegments(text);
	const kinds = segments.map((segment) => segment.kind);
	assert.ok(kinds.includes("math"), `math segment missing: ${kinds.join(",")}`);
	assert.equal((segments.find((segment) => segment.kind === "math") as { raw: string }).raw, "\\alpha + \\beta");
	assert.ok(renderedText(segments).includes("\n```bash\n") || renderedText(segments).includes("\n  ```bash\n"), `fence lost: ${renderedText(segments)}`);
});

test("inline code spans keep $-variables byte-for-byte", () => {
	const text = "Run `echo \"$base $scope\"` to verify.\n";
	const segments = buildSegments(text);
	assert.ok(
		segments.every((segment) => segment.kind === "markdown"),
		"inline code spans must never be cut into math segments",
	);
	const output = renderedText(segments);
	// pi-tui renders inline code with its own padding; assert on the span body
	assert.ok(output.includes('echo "$base $scope"'), `inline span mangled: ${output}`);
});

test("fenced \$\$ code stays intact across many fences in one paragraph", () => {
	const text = [
		"```bash",
		'echo "one $$"',
		"```",
		"",
		"Prose with $$E=mc^2$$ inline.",
		"",
		"```bash",
		"kill -0 $$",
		"```",
		"",
	].join("\n");
	const segments = buildSegments(text);
	const output = renderedText(segments);
	assert.ok(output.includes('echo "one $$"'), `first fence damaged: ${output}`);
	assert.ok(output.includes("kill -0 $$"), `second fence damaged: ${output}`);
	assert.ok(output.includes("E=mc") || output.includes("E = mc"), `prose math lost: ${output}`);
});
