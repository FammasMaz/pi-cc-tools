import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import "./ts-resolve-loader.mjs";
register("./ts-resolve-loader.mjs", import.meta.url);

// Click-to-expand in fullscreen. The full behaviour (pi's ScrollView keeping the clicked row
// under the mouse) needs pi >= 1.4 and was checked live in Rex; these cover what the 0.79 dev
// dependency can run: which clicks toggle, that an expanding click stops the transcript from
// following its end, and the scroll position that reveals the new lines.
process.env.COLORTERM = "truecolor";
const agentDir = mkdtempSync(join(tmpdir(), "click-toggle-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = agentDir;
writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ terminalTheme: false }));

const { ToolExecutionComponent } = await import("@earendil-works/pi-coding-agent");
const { Container } = await import("@earendil-works/pi-tui");
const themes = await import("../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js");
themes.initTheme("dark", false);
const extension = await import("../extensions/index.ts");

const tools = new Map<string, any>();
extension.default({
	registerTool: (tool: any) => tools.set(tool.name, tool),
	registerCommand() {},
	registerShortcut() {},
	on() {},
	getThinkingLevel: () => "off",
	getAllTools: () => [...tools.values()],
} as any);

test.after(() => {
	if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
	rmSync(agentDir, { recursive: true, force: true });
});

const plain = (text: string) => text.replace(/\x1b\[[0-9;]*m|\x1b\][^\x07]*\x07/g, "").replace(/[\uE000\uE001]/g, "");

/** Pi's TUI as rows see it, with the fullscreen transcript's scroll view. */
function fakeUi(following: boolean) {
	const scrollCalls: Array<{ top: number; options?: unknown }> = [];
	const view = {
		isFollowingEnd: following,
		scrollTop: 40,
		scrollTo(top: number, options?: unknown) {
			scrollCalls.push({ top, options });
		},
	};
	return { ui: { requestRender() {}, getPrimaryScrollView: () => view }, scrollCalls };
}

function group(ui: any) {
	const chat = new Container();
	for (const [name, args, text] of [["read", { path: "a.ts" }, "1\n2"], ["bash", { command: "ls" }, "a"]] as const) {
		const row = new ToolExecutionComponent(name, `${name}-${Math.random()}`, args, { showImages: false }, tools.get(name), ui, agentDir) as any;
		row.setArgsComplete();
		row.updateResult({ content: [{ type: "text", text }], isError: false }, false);
		chat.addChild(row);
	}
	const [grouped] = chat.children as any[];
	return grouped;
}

/** A left click on the group's sentence (its first non-blank line), as pi dispatches it. */
function click(rows: any, clickCount: number) {
	const lines: string[] = rows.render(100); // also records where each row is, for hit-testing
	const y = lines.findIndex((line) => plain(line).trim());
	return { type: "click", button: "left", x: 5, y, width: 100, height: lines.length, screenY: 10 + y, clickCount };
}

test("a click toggles a group; the second click of a double-click does not undo it", () => {
	const { ui } = fakeUi(false);
	const rows = group(ui);
	assert.ok(rows.handleMouse(click(rows, 1))?.handled, "first click handled");
	assert.equal(rows.tools.every((tool: any) => tool.expanded === true), true, "expanded");
	assert.equal(rows.handleMouse(click(rows, 2)), undefined, "the double-click's second click is left to pi (word selection)");
	assert.equal(rows.tools.every((tool: any) => tool.expanded === true), true, "still expanded");
	assert.ok(rows.handleMouse(click(rows, 1))?.handled);
	assert.equal(rows.tools.some((tool: any) => tool.expanded === true), false, "a later single click collapses it");
});

test("expanding by click stops the transcript from following its end; collapsing leaves it alone", () => {
	const { ui, scrollCalls } = fakeUi(true);
	const rows = group(ui);
	rows.handleMouse(click(rows, 1));
	assert.deepEqual(scrollCalls, [{ top: 40, options: { disableFollow: true } }], "the row stays where it was clicked");
	rows.handleMouse(click(rows, 1));
	assert.equal(scrollCalls.length, 1, "no scrolling on collapse");
});

test("the new lines are revealed without pushing the clicked row's header off screen", () => {
	const reveal = extension.revealScrollTop;
	// A 10-line viewport scrolled to line 40, so lines 40-49 are visible.
	assert.equal(reveal(42, 5, 40, 10), 40, "fits below: nothing moves");
	assert.equal(reveal(47, 6, 40, 10), 43, "overflows by 3: scroll down 3");
	assert.equal(reveal(47, 30, 40, 10), 47, "taller than the screen: the header goes to the top, no further");
	assert.equal(reveal(30, 20, 40, 10), 40, "header above the screen: never scroll back up");
});

test("a wrapped last line continues under blank space, not under a connector", () => {
	const row = new ToolExecutionComponent("read", "read-err", { path: "missing.ts" }, { showImages: false }, tools.get("read"), { requestRender() {} } as any, agentDir) as any;
	row.setArgsComplete();
	row.updateResult({ content: [{ type: "text", text: "ENOENT: no such file or directory, open '/tmp/a/very/long/path/that/wraps/missing.ts'" }], isError: true }, false);
	row.setExpanded(true);
	const lines = row.render(50).map(plain).filter((line: string) => line.trim());
	const last = lines.findIndex((line: string) => line.includes("└"));
	assert.ok(last >= 0 && last < lines.length - 1, `the error wraps: ${JSON.stringify(lines)}`);
	const corner = lines[last].indexOf("└");
	for (const continuation of lines.slice(last + 1)) {
		assert.notEqual(continuation[corner], "│", JSON.stringify(lines));
	}
});
