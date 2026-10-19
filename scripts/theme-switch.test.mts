import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import "./ts-resolve-loader.mjs";
register("./ts-resolve-loader.mjs", import.meta.url);

// On /theme or a light/dark switch Pi swaps the global theme and calls ui.invalidate().
// Rows drawn before the switch must repaint exactly as rows drawn after it.
process.env.COLORTERM = "truecolor";
const { ToolExecutionComponent } = await import("@earendil-works/pi-coding-agent");
const { Container } = await import("@earendil-works/pi-tui");
const themes = await import("../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js");
themes.initTheme("dark", false);

const tools = new Map<string, any>();
const fakePi = { registerTool: (tool: any) => tools.set(tool.name, tool), registerCommand() {}, registerShortcut() {}, on() {}, getThinkingLevel: () => "off", getAllTools: () => [...tools.values()] };
(await import("../extensions/index.ts")).default(fakePi as any);

const cwd = mkdtempSync(join(tmpdir(), "theme-switch-"));
const ui = { requestRender() {} } as any;
test.after(() => {
	themes.setTheme("dark", false);
	rmSync(cwd, { recursive: true, force: true });
});

async function settle(component: any, width = 120): Promise<string> {
	for (let previous = "", same = 0, i = 0; i < 400; i++) {
		const current = component.render(width).join("\n");
		same = current === previous && !current.includes("rendering") ? same + 1 : 0;
		if (same >= 3) return current;
		previous = current;
		await new Promise((done) => setTimeout(done, 10));
	}
	throw new Error("row never settled");
}

function editRow(path: string) {
	const row = new ToolExecutionComponent("edit", `edit-${Math.random()}`, { path, edits: [{ oldText: "const r10 = 10;", newText: "const r10 = 1000;" }] }, { showImages: false }, tools.get("edit"), ui, cwd) as any;
	row.setArgsComplete();
	return row;
}

function groupedRows(expanded: boolean) {
	const chat = new Container();
	for (const [name, args, text] of [["grep", { pattern: "foo" }, "a.ts:1: foo"], ["read", { path: "b.ts" }, "line1\nline2"]] as const) {
		const row = new ToolExecutionComponent(name, `${name}-${Math.random()}`, args, { showImages: false }, tools.get(name), ui, cwd) as any;
		row.setArgsComplete();
		row.updateResult({ content: [{ type: "text", text }], isError: false }, false);
		chat.addChild(row);
	}
	const [group] = chat.children as any[];
	assert.ok(Array.isArray(group?.tools), "rows are grouped");
	if (expanded) group.setExpanded(true);
	return chat;
}

test("an edit diff drawn before a theme switch repaints with the new diff palette", async () => {
	themes.setTheme("dark", false);
	const path = join(cwd, "a.ts");
	writeFileSync(path, `${Array.from({ length: 30 }, (_, i) => `const r${i} = ${i};`).join("\n")}\n`);
	const row = editRow(path);
	const dark = await settle(row);
	themes.setTheme("light", false);
	row.invalidate();
	const repainted = await settle(row);
	assert.notEqual(repainted, dark, "the light palette differs");
	assert.equal(repainted, await settle(editRow(path)));
});

for (const expanded of [false, true]) {
	test(`grouped rows repaint after a theme switch (${expanded ? "expanded" : "collapsed"})`, () => {
		themes.setTheme("dark", false);
		const chat = groupedRows(expanded);
		const dark = chat.render(100).join("\n");
		themes.setTheme("light", false);
		chat.invalidate();
		const repainted = chat.render(100).join("\n");
		assert.notEqual(repainted, dark, "the light palette differs");
		assert.equal(repainted, groupedRows(expanded).render(100).join("\n"));
	});
}
