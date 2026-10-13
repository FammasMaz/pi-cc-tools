import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import "./ts-resolve-loader.mjs";
register("./ts-resolve-loader.mjs", import.meta.url);

// Issue #35: a finished edit must keep showing the diff it showed when it was first drawn, at the same line numbers:
// after expanding it, after a resize, and when the session is resumed.
const { ToolExecutionComponent } = await import("@earendil-works/pi-coding-agent");
const { initTheme } = await import("../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js");
initTheme("dark", false);
Object.defineProperty(process.stdout, "columns", { configurable: true, value: 120 });

const tools = new Map<string, any>();
const fakePi = { registerTool: (tool: any) => tools.set(tool.name, tool), registerCommand() {}, registerShortcut() {}, on() {}, getThinkingLevel: () => "off", getAllTools: () => [...tools.values()] };
(await import("../extensions/index.ts")).default(fakePi as any);
const edit = tools.get("edit");

const cwd = mkdtempSync(join(tmpdir(), "edit-resume-"));
const fakeUi = { requestRender() {} };
const strip = (text: string) => text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, "");
const rows = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => `const row${from + i} = ${from + i};`);
const WIDTH = 110;
let calls = 0;

type Edits = Array<{ oldText: string; newText: string }>;

// The full row, colors included, once its diff has finished drawing.
async function settle(component: any, width = WIDTH): Promise<string> {
	for (let previous = "", same = 0, i = 0; i < 400; i++) {
		const current = component.render(width).join("\n");
		same = current === previous && !current.includes("rendering") ? same + 1 : 0;
		if (same >= 3) return current;
		previous = current;
		await new Promise((done) => setTimeout(done, 10));
	}
	throw new Error("edit row never settled");
}

function newCall(edits: Edits, lines = rows(0, 120), path = join(cwd, `file${calls}.ts`)) {
	writeFileSync(path, `${lines.join("\n")}\n`);
	const args = { path, edits };
	const id = `call-${calls++}`;
	return { id, args, path, row: () => new ToolExecutionComponent("edit", id, args, { showImages: false }, edit, fakeUi as any, cwd) as any };
}

// What Pi does once the model has finished writing the call: draw it, then run it.
async function run(call: ReturnType<typeof newCall>, live: any) {
	let result: any;
	try {
		result = { ...(await edit.execute(call.id, call.args, undefined, undefined, {})), isError: false };
	} catch (error) {
		result = { content: [{ type: "text", text: (error as Error).message }], isError: true };
	}
	live.updateResult(result, false);
	// What Pi stores in the session file and hands back on resume.
	return JSON.parse(JSON.stringify({ role: "toolResult", toolCallId: call.id, toolName: "edit", ...result }));
}

async function liveThenResume(edits: Edits, options: { lines?: string[]; expanded?: boolean; legacy?: boolean } = {}) {
	const call = newCall(edits, options.lines);
	const live = call.row();
	live.setArgsComplete();
	await settle(live);
	live.markExecutionStarted();
	const message = await run(call, live);
	// A result saved before this fix has no saved line numbers.
	if (options.legacy) delete message.details?.preview;
	const firstFrame = await settle(live);
	const resume = (expanded = !!options.expanded) => {
		const row = call.row();
		row.setExpanded(expanded);
		row.updateResult(message);
		return row;
	};
	live.setExpanded(!!options.expanded);
	return { call, live, message, firstFrame, resume, liveText: await settle(live), resumedText: await settle(resume()) };
}

test.after(() => rmSync(cwd, { recursive: true, force: true }));

test("a resumed single edit shows the diff it showed live", async () => {
	const { liveText, resumedText, message } = await liveThenResume([{ oldText: "const row40 = 40;", newText: "const row40 = 4000;\nconst extra = true;" }]);
	assert.match(strip(liveText), /at line 41/);
	assert.match(strip(liveText), /41-.*row40 = 40;/);
	assert.equal(resumedText, liveText);
	// Only line numbers are saved, not another copy of the text.
	assert.deepEqual(message.details.preview, [{ oldLine: 41, newLine: 41 }]);
});

test("a resumed multi-edit keeps every block and its line number", async () => {
	const { liveText, resumedText } = await liveThenResume([
		{ oldText: "const row90 = 90;", newText: "const row90 = 9000;" },
		{ oldText: "const row10 = 10;", newText: "const row10 = 1000;\nconst added = 1;" },
	]);
	assert.match(strip(liveText), /Edit 1\/2.*at line 92/);
	assert.match(strip(liveText), /Edit 2\/2.*at line 11/);
	assert.equal(resumedText, liveText);
});

test("expanding, collapsing and resizing a finished edit keep its line numbers", async () => {
	const { live, firstFrame, resume } = await liveThenResume([{ oldText: "const row40 = 40;", newText: "const row40 = 4000;" }]);
	live.setExpanded(true);
	const expanded = await settle(live);
	assert.match(strip(expanded), /at line 41/);
	assert.equal(await settle(resume(true)), expanded);
	live.setExpanded(false);
	assert.equal(await settle(live), firstFrame);
	const narrow = await settle(live, WIDTH - 20);
	assert.match(strip(narrow), /at line 41/);
	assert.equal(await settle(resume(), WIDTH - 20), narrow);
});

test("a resumed edit does not depend on what the file holds by then", async () => {
	const { call, liveText, resume } = await liveThenResume([{ oldText: "const row40 = 40;", newText: "const row40 = 4000;" }]);
	writeFileSync(call.path, `${"\n".repeat(70)}const row40 = 40;\n`);
	assert.equal(await settle(resume()), liveText);
	rmSync(call.path);
	assert.equal(await settle(resume()), liveText);
});

test("an edit that runs before its row was ever painted still gets its line numbers", async () => {
	const call = newCall([{ oldText: "const row40 = 40;", newText: "const row40 = 4000;" }]);
	const live = call.row();
	live.setArgsComplete();
	live.markExecutionStarted();
	const message = await run(call, live);
	const liveText = await settle(live);
	assert.match(strip(liveText), /at line 41/);
	const resumed = call.row();
	resumed.updateResult(message);
	assert.equal(await settle(resumed), liveText);
});

test("two edits of one file in the same turn resume as they were drawn, before either ran", async () => {
	const path = join(cwd, "shared.ts");
	const first = newCall([{ oldText: "const row10 = 10;", newText: "const row10 = 1000;\nconst added1 = 1;\nconst added2 = 2;" }], rows(0, 120), path);
	const second = newCall([{ oldText: "const row80 = 80;", newText: "const row80 = 8000;" }], rows(0, 120), path);
	const lives = [first.row(), second.row()];
	for (const live of lives) live.setArgsComplete();
	for (const live of lives) live.markExecutionStarted();
	const messages = await Promise.all([run(first, lives[0]), run(second, lives[1])]);
	const liveTexts = [await settle(lives[0]), await settle(lives[1])];
	// Row 80 sits on line 81 of the file the model wrote both edits against; it has moved to 83 by the time it is replaced.
	assert.match(strip(liveTexts[1]), /at line 81/);
	for (const [i, call] of [first, second].entries()) {
		const resumed = call.row();
		resumed.updateResult(messages[i]);
		assert.equal(await settle(resumed), liveTexts[i]);
	}
});

// Results saved before this fix carry no line numbers; they are worked out from the patch Pi saved with the result.
const legacyCases: Array<[string, Edits, RegExp, string[]?]> = [
	["a single edit", [{ oldText: "const row40 = 40;", newText: "const row40 = 4000;\nconst extra = true;" }], /at line 41/],
	["a multi-edit", [{ oldText: "const row90 = 90;", newText: "const row90 = 9000;" }, { oldText: "const row10 = 10;", newText: "const row10 = 1000;\nconst added = 1;" }], /Edit 1\/2.*at line 92/],
	["an edit starting mid-line", [{ oldText: "row40 = 40", newText: "row40 = 4000" }], /at line 41/],
	["a deletion", [{ oldText: "const row40 = 40;\n", newText: "" }], /at line 41/],
	["oldText reaching past the patch context", [{ oldText: rows(50, 69).join("\n"), newText: rows(50, 69).join("\n").replace("row59 = 59", "row59 = 5900") }], /at line 60/],
	["oldText reaching past the patch context from mid-line", [{ oldText: ["= 58;", ...rows(59, 75)].join("\n"), newText: ["= 58;", ...rows(59, 75)].join("\n").replace("row60 = 60", "row60 = 6000") }], /at line 61/],
	["oldText spanning two separate changes", [{ oldText: rows(40, 70).join("\n"), newText: rows(40, 70).join("\n").replace("row42 = 42", "row42 = 4200").replace("row66 = 66", "row66 = 6600") }], /at line 43/],
	["an append after a long unchanged tail", [{ oldText: rows(108, 120).join("\n"), newText: `${rows(108, 120).join("\n")}\nconst appended = true;` }], /at line 1[12]\d/],
	["oldText that only matches fuzzily", [{ oldText: rows(50, 70).join("\n"), newText: rows(50, 70).join("\n").replace("row60 = 60", "row60 = 6000") }], /at line 61/, [...rows(0, 59), "const row59 = 59;  ", ...rows(60, 120)]],
];
for (const [name, edits, expected, lines] of legacyCases) {
	test(`a result saved before this fix resumes as it was drawn: ${name}`, async () => {
		const { liveText, resumedText, message } = await liveThenResume(edits, { lines, legacy: true });
		assert.equal(message.details.preview, undefined);
		assert.match(strip(liveText), expected);
		assert.equal(resumedText, liveText);
	});
}

test("a resumed failed edit matches the live row, whatever the file holds by then", async () => {
	const { call, liveText, resumedText, resume } = await liveThenResume([{ oldText: "const missing = 1;", newText: "const found = 1;" }]);
	assert.match(strip(liveText), /const missing = 1;/);
	assert.match(strip(liveText), /Could not find the exact text/);
	assert.equal(resumedText, liveText);
	writeFileSync(call.path, `${"\n".repeat(40)}const missing = 1;\n`);
	assert.equal(await settle(resume()), liveText);
});

test("a call aborted while streaming stays header-only on resume, as it was live", async () => {
	const call = newCall([{ oldText: "const row40 = 40;", newText: "const row40 = 4000;" }]);
	const aborted = { content: [{ type: "text", text: "Operation aborted" }], isError: true };
	const live = call.row();
	live.updateResult(aborted);
	const resumed = call.row();
	resumed.updateResult(aborted);
	const liveText = await settle(live);
	assert.doesNotMatch(strip(liveText), /row40 = 4000/);
	assert.equal(await settle(resumed), liveText);
});
