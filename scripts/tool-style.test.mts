import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import "./ts-resolve-loader.mjs";
register("./ts-resolve-loader.mjs", import.meta.url);

// Row layout and wording: grouped rows read as one sentence, every row starts in the
// same column, prompts are one ❯ line, bash file edits show as edits, and
// pi-subagents' rows, notices and widget use the tool-row markers.
process.env.COLORTERM = "truecolor";
const agentDir = mkdtempSync(join(tmpdir(), "tool-style-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = agentDir;
// bashCommandPreviewLines is off by default (see theme-defaults.test.mts); on here to check its colors.
writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ terminalTheme: false, bashCommandPreviewLines: 8 }));
const cwd = mkdtempSync(join(tmpdir(), "tool-style-cwd-"));
const previousCwd = process.cwd();
process.chdir(cwd);

const { ToolExecutionComponent, UserMessageComponent, CustomMessageComponent } = await import("@earendil-works/pi-coding-agent");
const { Container } = await import("@earendil-works/pi-tui");
const themes = await import("../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js");
themes.initTheme("dark", false);

const tools = new Map<string, any>();
const handlers = new Map<string, Array<(event: unknown, ctx: unknown) => unknown>>();
const fakePi = {
	registerTool: (tool: any) => tools.set(tool.name, tool),
	registerCommand() {},
	registerShortcut() {},
	on: (event: string, handler: any) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
	getThinkingLevel: () => "off",
	getAllTools: () => [...tools.values()],
};
(await import("../extensions/index.ts")).default(fakePi as any);

test.after(() => {
	process.chdir(previousCwd);
	if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
	rmSync(agentDir, { recursive: true, force: true });
	rmSync(cwd, { recursive: true, force: true });
});

const plain = (text: string) => text.replace(/\x1b\[[0-9;]*m|\x1b\][^\x07]*\x07/g, "").replace(/[\uE000\uE001]/g, "");
const visible = (lines: string[]) => lines.map((line) => plain(line).trimEnd()).filter((line) => line.trim());
const ui = { requestRender() {} } as any;

async function settle(component: any, width = 100): Promise<string[]> {
	for (let previous = "", same = 0, i = 0; i < 400; i++) {
		const lines = component.render(width);
		const current = lines.join("\n");
		same = current === previous && !current.includes("rendering") ? same + 1 : 0;
		if (same >= 3) return visible(lines);
		previous = current;
		await new Promise((done) => setTimeout(done, 10));
	}
	throw new Error("row never settled");
}

function finishedRow(name: string, args: any, text = "ok", details?: unknown, definition = tools.get(name)) {
	const row = new ToolExecutionComponent(name, `${name}-${Math.random()}`, args, { showImages: false }, definition, ui, cwd) as any;
	row.setArgsComplete();
	row.updateResult({ content: [{ type: "text", text }], details, isError: false }, false);
	return row;
}

test("a group of calls reads as one sentence, with the calls behind ctrl+o", () => {
	const chat = new Container();
	chat.addChild(finishedRow("read", { path: "a.ts" }, "1\n2"));
	chat.addChild(finishedRow("read", { path: "b.ts" }, "1"));
	chat.addChild(finishedRow("bash", { command: "npm test" }, "pass"));
	const [group] = chat.children as any[];
	const lines = visible(group.render(100));
	assert.equal(lines.length, 1, `one row: ${lines.join(" / ")}`);
	assert.match(lines[0], /^ ● Read 2 files, ran 1 shell command\b/);
	group.setExpanded(true);
	const expanded = visible(group.render(100));
	assert.ok(expanded.some((line) => /npm test/.test(line)), `expanded shows each call: ${expanded.join(" / ")}`);
	// Children hang under the sentence's first letter; each child's └ under the child's label.
	const child = expanded.findIndex((line) => /● Read a\.ts/.test(line));
	assert.equal(expanded[child].search(/[├└]/), expanded[0].indexOf("Read"), expanded.join(" / "));
	assert.equal(expanded[child + 1].indexOf("└"), expanded[child].indexOf("Read a.ts"), expanded.join(" / "));
});

test("a tool without its own summary shows its argument, not its name twice", () => {
	const [line] = visible(finishedRow("ctx_reduce", { drop: "3-5" }, "done", undefined, undefined).render(100));
	assert.match(line, /^ ● Ctx Reduce 3-5$/);
});

test("edit rows start in the same column as every other row", async () => {
	writeFileSync(join(cwd, "s.py"), "a = 1\nb = 2\n");
	const edit = new ToolExecutionComponent("edit", "edit-1", { path: "s.py", edits: [{ oldText: "b = 2", newText: "b = 3" }] }, { showImages: false }, tools.get("edit"), ui, cwd) as any;
	edit.setArgsComplete();
	const editLines = (await settle(edit)).filter((line) => !/^─+$/.test(line.trim()));
	const readLine = visible(finishedRow("read", { path: "s.py" }, "a = 1").render(100))[0];
	assert.equal(editLines[0].indexOf("●"), readLine.indexOf("●"), `${JSON.stringify(editLines.slice(0, 3))} vs ${JSON.stringify(readLine)}`);
	const branch = editLines.find((line) => /[├└]/.test(line)) ?? "";
	assert.equal(branch.search(/[├└]/), readLine.indexOf("Read"), "connectors hang under the label's first letter");
});

test("a past prompt is one line marked ❯", () => {
	const lines = visible(new UserMessageComponent("fix the failing test").render(60));
	assert.deepEqual(lines.map((line) => line.trimEnd()), [" ❯ fix the failing test"]);
});

test("a bash command that only edits a file is drawn as an edit with its diff", async () => {
	writeFileSync(join(cwd, "stats.py"), "def mean(values):\n    return 0\n");
	const command = "sed -i.bak 's/return 0/return 1/' stats.py";
	const result = await tools.get("bash").execute("bash-sed", { command }, undefined, undefined);
	assert.equal(readFileSync(join(cwd, "stats.py"), "utf8"), "def mean(values):\n    return 1\n", "the command ran unchanged");
	const [edit] = result.details.fileEdits;
	assert.equal(edit.path, "stats.py");
	assert.equal(edit.diff.added, 1);
	assert.equal(edit.diff.removed, 1);
	const row = new ToolExecutionComponent("bash", "bash-sed", { command }, { showImages: false }, tools.get("bash"), ui, cwd) as any;
	row.setArgsComplete();
	row.updateResult(result, false);
	const lines = await settle(row);
	assert.match(lines[0], /^ ● Edit \(sed\) stats\.py/);
	assert.ok(lines.some((line) => /return 1/.test(line)), "shows the changed line");
	// Never grouped with neighbouring calls.
	const chat = new Container();
	chat.addChild(finishedRow("read", { path: "a.ts" }));
	chat.addChild(row);
	assert.equal(chat.children.length, 2);
});

test("pi-subagents' Agent rows, notices and widget use tool-row markers", () => {
	const done = visible(finishedRow("Agent", { description: "Check the tests", subagent_type: "Explore" }, "All pass.", {
		status: "completed", toolUses: 2, tokens: "12.3k tokens", durationMs: 5200,
	}, undefined).render(100));
	assert.match(done[0], /^ ● Agent Check the tests \(Explore\)/);
	assert.match(done[1], /^ {3}└ Done · 2 tool uses · 12\.3k tokens · 5s/);

	const notice = new CustomMessageComponent({
		role: "custom", customType: "subagent-notification", display: true, content: "done",
		details: { description: "Check the tests", status: "completed", toolUses: 1, totalTokens: 28500, durationMs: 5000, turnCount: 1, resultPreview: "Both tests pass.\nmore" },
	} as any, () => undefined) as any;
	const noticeLines = visible(notice.render(80));
	assert.ok(noticeLines.includes(" ● Agent Check the tests completed"), noticeLines.join(" / "));
	assert.ok(noticeLines.includes("   ├ 1 tool use · 28.5k tokens · 5s"), noticeLines.join(" / "));
	assert.ok(noticeLines.includes("   └ Both tests pass."));

	// The live widget, as pi-subagents draws it.
	let factory: any;
	const sessionUi: any = {
		setWidget: (key: string, content: any) => { if (key === "agents") factory = content; },
		notify() {}, getEditorComponent: () => undefined, setEditorComponent() {}, theme: themes.theme,
	};
	for (const handler of handlers.get("session_start") ?? []) handler({ reason: "startup" }, { hasUI: true, ui: sessionUi });
	const t = themes.theme;
	let frame = "⠹";
	sessionUi.setWidget("agents", () => ({
		render: () => [
			t.fg("accent", "●") + " " + t.fg("accent", "Agents"),
			t.fg("dim", "└─") + ` ${t.fg("accent", frame)} ${t.bold("Agent")}  ${t.fg("muted", "Check")}`,
			"   " + t.fg("dim", "  ⎿  running command…"),
		],
		invalidate() {},
	}));
	const component = factory({}, t);
	const widget = visible(component.render(80));
	assert.equal(widget[0], " ● Agents");
	assert.equal(widget[1], "   └ ⠹ Agent  Check");
	assert.equal(widget[2], "       running command…");
	// pi-subagents' own spinner passes through, so it keeps animating on its timer.
	frame = "⠼";
	assert.equal(visible(component.render(80))[1], "   └ ⠼ Agent  Check");

	// A failed agent, as pi-subagents draws it: the start of a multi-line error is in the row.
	const error = "All 3 credential(s) exhausted for codex\n\nCredential issues (require attention)".slice(0, 60);
	sessionUi.setWidget("agents", () => ({
		render: () => [
			t.fg("dim", "○") + " " + t.fg("dim", "Agents"),
			t.fg("dim", "└─") + ` ${t.fg("error", "✗")} Explore  ${t.fg("dim", "Spinner test")} ${t.fg("dim", "·")} ${t.fg("dim", "2.9s")}${t.fg("error", ` error: ${error}`)}`,
		],
		invalidate() {},
	}));
	const failedRaw = factory({}, t).render(120);
	const failed = visible(failedRaw);
	assert.equal(failed.length, 2, JSON.stringify(failed));
	assert.equal(failed[1], "   └ ● Explore  Spinner test · 2.9s error: All 3 credential(s) exhausted for codex Credential issues (");
	assert.ok(failedRaw[1].includes(`${t.getFgAnsi("error")}\x1b[1m●`) || failedRaw[1].includes(`${t.getFgAnsi("error")}●`), JSON.stringify(failedRaw[1]));
	assert.ok(!failedRaw[1].includes("\n"));
});

test("the status line under a command is dim, as in pi-polish; errors stay red", () => {
	const dim = themes.theme.getFgAnsi("dim");
	const error = themes.theme.getFgAnsi("error");
	const statusOf = (row: any) => row.render(100).find((line: string) => /[├└]/.test(plain(line))) ?? "";
	const grep = statusOf(finishedRow("grep", { pattern: "foo" }, "a.ts:1: foo\nb.ts:2: foo"));
	assert.ok(grep.includes(`${dim}2 matches`), JSON.stringify(grep));
	const bash = statusOf(finishedRow("bash", { command: "ls" }, "a\nb"));
	assert.ok(bash.includes(`${dim}Done`), JSON.stringify(bash));
	const failed = new ToolExecutionComponent("read", "read-err", { path: "missing.ts" }, { showImages: false }, tools.get("read"), ui, cwd) as any;
	failed.setArgsComplete();
	failed.updateResult({ content: [{ type: "text", text: "ENOENT: no such file" }], isError: true }, false);
	const errorLine = statusOf(failed);
	assert.ok(errorLine.includes(error) && !errorLine.includes(`${dim}ENOENT`), JSON.stringify(errorLine));
});

test("a running command's source keeps its color; only status lines are dim", async () => {
	const fire = async (event: string) => {
		for (const handler of handlers.get(event) ?? []) await handler({}, { ui: {}, hasUI: false });
	};
	const accent = themes.theme.getFgAnsi("accent");
	const dim = themes.theme.getFgAnsi("dim");
	await fire("agent_start");
	try {
		const row = new ToolExecutionComponent("bash", "bash-running", { command: "for f in *.py; do\n  echo $f\ndone" }, { showImages: false }, tools.get("bash"), ui, cwd) as any;
		row.setArgsComplete();
		row.markExecutionStarted();
		const lines = row.render(100);
		// The command preview under the header (the header's own summary is the first line).
		const source = lines.find((line: string) => /[├└│]/.test(plain(line)) && plain(line).includes("for f in")) ?? "";
		assert.ok(source, `command preview shown: ${JSON.stringify(lines.map(plain))}`);
		assert.ok(source.includes(`${accent}for f in`) && !source.includes(`${dim}for f in`), JSON.stringify(source));
	} finally {
		await fire("agent_end");
	}
});
