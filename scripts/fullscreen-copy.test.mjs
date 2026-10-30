// Fullscreen copy leaves decoration out: drives Pi's real TuiAltScreen render, mouse
// selection and copy-on-select path over transcript rows rendered by the extension.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = process.env.PI_AGENT_ROOT ?? resolve(require.resolve("@earendil-works/pi-coding-agent/dist/index.js"), "../..");
const extensionPath = resolve(fileURLToPath(new URL("../extensions/index.ts", import.meta.url)));
const { initTheme } = await import(`${root}/dist/modes/interactive/theme/theme.js`);
initTheme("dark", false);
const PiTui = await import(`${root}/node_modules/@earendil-works/pi-tui/dist/index.js`);
const { Container, ProcessTerminal, TuiAltScreen, sliceByColumn, stripTerminalSequences } = PiTui;
const { AssistantMessageComponent, ToolExecutionComponent, UserMessageComponent } = await import(`${root}/dist/modes/interactive/components/index.js`);
if (typeof TuiAltScreen?.prototype?.getActiveSelectionText !== "function") {
	throw new Error("fullscreen copy test needs a Pi TUI with TuiAltScreen selection; set PI_AGENT_ROOT to a current Pi install");
}
const loader = await import(`${root}/dist/core/extensions/loader.js`);
const { extensions, errors } = await loader.loadExtensions([extensionPath], process.cwd());
if (errors?.length) {
	console.error(errors);
	process.exit(1);
}

const COLUMNS = 70;
const ROWS = 80;
const written = [];
const terminal = Object.create(ProcessTerminal.prototype, {
	columns: { get: () => COLUMNS },
	rows: { get: () => ROWS },
});
const stdoutWrite = process.stdout.write;
function render(tui) {
	process.stdout.write = (chunk) => { written.push(String(chunk)); return true; };
	try {
		tui.doRender();
	} finally {
		process.stdout.write = stdoutWrite;
	}
}

let copied;
const tui = new TuiAltScreen(terminal, false, undefined, {
	mouse: true,
	copySelection: async (text) => { copied = text; return true; },
});
tui.altScreenActive = true;
tui.flash = () => {};
// Frames are drawn explicitly below, inside the stdout capture.
tui.requestRender = () => {};

const markdown = [
	"Here is a paragraph of text.",
	"",
	"```ts",
	"const a = 1;",
	"if (a) {",
	"  go(); // │ stays",
	"}",
	"```",
	"",
	"```text",
	"plain fence",
	"```",
	"",
	"| a | b |",
	"|---|---|",
	"| 1 | 2 |",
	"",
	"Done.",
].join("\n");
const user = new UserMessageComponent("Please fix the copy issue\nsecond line");
const assistant = new AssistantMessageComponent({ role: "assistant", content: [{ type: "text", text: markdown }], stopReason: "stop" }, true);
assistant.updateContent(assistant.lastMessage, false);
const thinking = new AssistantMessageComponent({
	role: "assistant",
	content: [{ type: "thinking", thinking: "Check the box.\n\n```js\nlet x = 2;\n```\n\nThen answer." }, { type: "text", text: "Answer." }],
	stopReason: "stop",
}, false);
thinking.updateContent(thinking.lastMessage, false);
const bash = extensions[0].tools.get("bash");
const tool = new ToolExecutionComponent("bash", "copy-bash", { command: "ls" }, undefined, bash?.definition ?? bash, { requestRender() {} }, process.cwd());
tool.updateResult({ content: [{ type: "text", text: "file1\nfile2" }], isError: false }, false);
tool.setExpanded(true);
const chat = new Container();
chat.addChild(user);
chat.addChild(assistant);
chat.addChild(thinking);
chat.addChild(tool);
tui.addChild(chat);
render(tui);

const screen = () => tui.previousScreen.map((line) => stripTerminalSequences(line));
const rowOf = (text, from = 0) => {
	const row = screen().findIndex((line, index) => index >= from && line.includes(text));
	assert.notEqual(row, -1, `row containing ${JSON.stringify(text)} not on screen:\n${screen().join("\n")}`);
	return row;
};
const colOf = (row, text) => screen()[row].indexOf(text);
function drag(from, to) {
	copied = undefined;
	tui.handleMouseEvent({ button: 0, x: from.x, y: from.y, release: false });
	tui.handleMouseEvent({ button: 32, x: to.x, y: to.y, release: false });
	tui.handleMouseEvent({ button: 0, x: to.x, y: to.y, release: true });
	render(tui);
	return { copied, active: tui.getActiveSelectionText() };
}

const failures = [];
function check(name, fn) {
	try {
		fn();
		console.log(`ok ${name}`);
	} catch (error) {
		failures.push(`${name}: ${error.message}`);
	}
}

check("box and gutters render on screen", () => {
	const text = screen().join("\n");
	assert.match(text, /╭· ts/);
	assert.match(text, /│ {3}const a = 1;/);
	assert.match(text, / ● Here is a paragraph/);
	assert.match(text, / ❯ Please fix/);
});

check("terminal output carries no copy markers", () => {
	const out = written.join("");
	assert.ok(stripTerminalSequences(out).includes("Here is a paragraph"), "frame was not written through ProcessTerminal.write");
	assert.ok(out.includes("│"), "box borders missing from terminal output");
	assert.ok(!out.includes("\x1b]8686;"), "copy markers reached the terminal");
});

check("whole assistant message copies without box or gutter", () => {
	const top = rowOf("Here is a paragraph");
	const bottom = rowOf("Done.", top);
	const result = drag({ x: 0, y: top }, { x: COLUMNS - 1, y: bottom });
	assert.equal(result.copied, result.active, "copy-on-select and getActiveSelectionText disagree");
	assert.equal(result.copied, [
		"Here is a paragraph of text.",
		"",
		"const a = 1;",
		"if (a) {",
		"  go(); // │ stays",
		"}",
		"",
		"plain fence",
		"",
		// Pi's own table drawing is content, not this extension's decoration.
		"┌───┬───┐",
		"│ a │ b │",
		"├───┼───┤",
		"│ 1 │ 2 │",
		"└───┴───┘",
		"",
		"Done.",
	].join("\n"));
});

check("code rows copy exactly the code", () => {
	const first = rowOf("const a = 1;");
	const last = rowOf("}", first + 1);
	const result = drag({ x: 0, y: first }, { x: COLUMNS - 1, y: last });
	assert.equal(result.copied, "const a = 1;\nif (a) {\n  go(); // │ stays\n}");
});

check("selection starting mid-line keeps only the selected code", () => {
	const row = rowOf("go();");
	const start = colOf(row, "go();");
	const result = drag({ x: start, y: row }, { x: COLUMNS - 1, y: row });
	assert.equal(result.copied, "go(); // │ stays");
});

check("selection ending inside the right border stops at the code", () => {
	const row = rowOf("const a = 1;");
	const border = screen()[row].lastIndexOf("│");
	const result = drag({ x: colOf(row, "const"), y: row }, { x: border, y: row });
	assert.equal(result.copied, "const a = 1;");
});

check("decoration-only selection still copies what is on screen", () => {
	const row = rowOf("╭· ts");
	const result = drag({ x: 0, y: row }, { x: COLUMNS - 1, y: row });
	assert.ok(result.copied?.includes("╭· ts"), JSON.stringify(result.copied));
});

check("expanded thinking copies without ∴, label, or box", () => {
	const first = rowOf("Thinking: Check the box.");
	const last = rowOf("Then answer.", first);
	const result = drag({ x: 0, y: first }, { x: COLUMNS - 1, y: last });
	assert.equal(result.copied, "Check the box.\n\nlet x = 2;\n\nThen answer.");
});

check("past prompt copies without the ❯ pad", () => {
	const first = rowOf("Please fix the copy issue");
	const last = rowOf("second line", first);
	const result = drag({ x: 0, y: first }, { x: COLUMNS - 1, y: last });
	assert.equal(result.copied, "Please fix the copy issue\nsecond line");
});

check("rows without markers copy exactly as Pi builds them", () => {
	const first = rowOf("Bash");
	const last = rowOf("file2", first);
	const result = drag({ x: 0, y: first }, { x: COLUMNS - 1, y: last });
	// Pi's own algorithm over the same rows: slice each row, strip escapes, trim the end.
	const expected = [];
	for (let row = first; row <= last; row++) {
		expected.push(stripTerminalSequences(sliceByColumn(tui.previousScreen[row], 0, COLUMNS, true)).trimEnd());
	}
	assert.equal(result.copied, expected.join("\n"));
	assert.match(result.copied, /● Bash ls/);
});

if (failures.length > 0) {
	console.error(`\n${failures.length} failure(s):\n${failures.join("\n")}`);
	process.exit(1);
}
console.log("fullscreen copy: all checks passed");
