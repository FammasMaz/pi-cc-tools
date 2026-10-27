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

test("a click on any line of an expanded group closes the whole group", () => {
	const { ui } = fakeUi(false);
	const rows = group(ui);
	assert.ok(rows.handleMouse(click(rows, 1))?.handled);
	assert.ok(rows.tools.every((tool: any) => tool.expanded === true), "the sentence opens every call");
	const lines: string[] = rows.render(100);
	const inner = lines.findIndex((line) => plain(line).includes("Bash"));
	assert.ok(inner > 1, "a line inside the group, below the sentence");
	assert.ok(rows.handleMouse({ type: "click", button: "left", x: 30, y: inner, width: 100, height: lines.length, screenY: 10 + inner, clickCount: 1 })?.handled);
	assert.ok(rows.tools.every((tool: any) => tool.expanded !== true), "every call closed, not just the one clicked");
	assert.ok(rows.handleMouse(click(rows, 1))?.handled);
	assert.ok(rows.tools.every((tool: any) => tool.expanded === true), "and the next click opens it again");
});

test("a group that is partly open closes on the next click instead of opening the rest", () => {
	const { ui } = fakeUi(false);
	const rows = group(ui);
	rows.tools[0].setExpanded(true);
	rows.expanded = true;
	assert.ok(rows.handleMouse(click(rows, 1))?.handled);
	assert.ok(rows.tools.every((tool: any) => tool.expanded !== true));
});

test("a press and release one cell apart is a click; a longer move is a drag", () => {
	const { applyClickSlop } = extension;
	const press = { button: 0, x: 10, y: 5 };
	assert.deepEqual(applyClickSlop(press), press);
	assert.equal(applyClickSlop({ button: 32, x: 11, y: 5 }), undefined, "a one-cell move while pressed is dropped");
	assert.deepEqual(applyClickSlop({ button: 0, x: 11, y: 6, release: true }), { button: 0, x: 10, y: 5, release: true }, "the release is reported at the press");

	applyClickSlop({ button: 0, x: 10, y: 5 });
	assert.deepEqual(applyClickSlop({ button: 32, x: 14, y: 5 }), { button: 32, x: 14, y: 5 }, "a real drag passes through");
	assert.deepEqual(applyClickSlop({ button: 32, x: 10, y: 5 }), { button: 32, x: 10, y: 5 }, "and stays a drag even if it comes back");
	assert.deepEqual(applyClickSlop({ button: 0, x: 11, y: 5, release: true }), { button: 0, x: 11, y: 5, release: true });

	assert.deepEqual(applyClickSlop({ button: 64, x: 3, y: 3 }), { button: 64, x: 3, y: 3 }, "wheel untouched");
	assert.deepEqual(applyClickSlop({ button: 35, x: 4, y: 4 }), { button: 35, x: 4, y: 4 }, "plain moves untouched");
	assert.deepEqual(applyClickSlop({ button: 2, x: 5, y: 5 }), { button: 2, x: 5, y: 5 }, "right button untouched");
});

test("a row's padding is measured from its label, so a blinking dot does not move the lines below", () => {
	assert.equal(extension.toolRowPad(" ● Bash command"), 1);
	assert.equal(extension.toolRowPad("   Bash command"), 1, "dot blinked off");
	assert.equal(extension.toolRowPad(" \x1b[32m●\x1b[39m Bash"), 1);
	assert.equal(extension.toolRowPad(" · Agent"), 1);
});

// pi's ScrollView, reduced to what the hold uses.
function fakeView(following: boolean) {
	const calls: string[] = [];
	const view = {
		isFollowingEnd: following,
		scrollTop: 40,
		scrollTo(top: number, options?: { disableFollow?: boolean }) {
			calls.push(`scrollTo ${top}${options?.disableFollow ? " hold" : ""}`);
			this.scrollTop = top;
			if (options?.disableFollow) this.isFollowingEnd = false;
		},
		scrollToEnd() {
			calls.push("scrollToEnd");
			this.isFollowingEnd = true;
		},
	};
	return { view, calls, tui: { getPrimaryScrollView: () => view, requestRender() {} } };
}

test("the transcript holds still while the button is down, then follows its end again", () => {
	const { dispatchMouseWithClickFixes } = extension;
	const seen: any[] = [];
	const pass = (raw: any) => { seen.push(raw); return undefined; };
	const { view, calls, tui } = fakeView(true);
	dispatchMouseWithClickFixes(tui, { button: 0, x: 5, y: 3 }, pass);
	assert.deepEqual(calls, ["scrollTo 40 hold"], "pressing stops the view from following new output");
	dispatchMouseWithClickFixes(tui, { button: 0, x: 5, y: 3, release: true }, pass);
	assert.deepEqual(calls, ["scrollTo 40 hold", "scrollToEnd"], "releasing follows the end again");
	assert.equal(view.isFollowingEnd, true);
	assert.equal(seen.length, 2);
});

test("after a click that opens a row, or a scroll during the press, the view stays where it is", () => {
	const { dispatchMouseWithClickFixes } = extension;
	// The click opens a group, which keeps the row in place (no snap back to the end).
	const { ui } = fakeUi(false);
	const rows = group(ui);
	const opened = fakeView(true);
	dispatchMouseWithClickFixes(opened.tui, { button: 0, x: 5, y: 3 }, () => undefined);
	dispatchMouseWithClickFixes(opened.tui, { button: 0, x: 5, y: 3, release: true }, () => rows.handleMouse(click(rows, 1)));
	assert.ok(rows.tools.every((tool: any) => tool.expanded === true));
	assert.ok(!opened.calls.includes("scrollToEnd"), opened.calls.join(", "));
	// Something else scrolled the view while the button was down (a scrollbar drag).
	const dragged = fakeView(true);
	dispatchMouseWithClickFixes(dragged.tui, { button: 0, x: 99, y: 3 }, () => undefined);
	dragged.view.scrollTop = 12;
	dispatchMouseWithClickFixes(dragged.tui, { button: 0, x: 99, y: 3, release: true }, () => undefined);
	assert.ok(!dragged.calls.includes("scrollToEnd"), "no snap back after scrolling away");
	// A view that was not following is left alone.
	const still = fakeView(false);
	dispatchMouseWithClickFixes(still.tui, { button: 0, x: 5, y: 3 }, () => undefined);
	dispatchMouseWithClickFixes(still.tui, { button: 0, x: 5, y: 3, release: true }, () => undefined);
	assert.deepEqual(still.calls, []);
});
