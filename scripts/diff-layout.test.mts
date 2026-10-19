import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import "./ts-resolve-loader.mjs";
register("./ts-resolve-loader.mjs", import.meta.url);

// Issue #34: the `diffLayout` setting chooses between auto, always-split and always-unified diffs.
const agentDir = mkdtempSync(join(tmpdir(), "diff-layout-agent-"));
const cwd = mkdtempSync(join(tmpdir(), "diff-layout-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = agentDir;

const { ToolExecutionComponent } = await import("@earendil-works/pi-coding-agent");
const { initTheme } = await import("../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js");
initTheme("dark", false);
Object.defineProperty(process.stdout, "columns", { configurable: true, value: 240 });

const tools = new Map<string, any>();
const fakePi = { registerTool: (tool: any) => tools.set(tool.name, tool), registerCommand() {}, registerShortcut() {}, on() {}, getThinkingLevel: () => "off", getAllTools: () => [...tools.values()] };
(await import("../extensions/index.ts")).default(fakePi as any);
const edit = tools.get("edit");

const strip = (text: string) => text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, "");
// readSettings caches for 5 s; step the clock past it whenever the settings file changes.
const realNow = Date.now;
let clockOffset = 0;
Date.now = () => realNow() + clockOffset;
function setLayout(layout?: string) {
	writeFileSync(join(agentDir, "settings.json"), JSON.stringify(layout ? { diffLayout: layout } : {}));
	clockOffset += 60_000;
}

let calls = 0;
async function renderEdit(width: number, change = { oldText: "const row30 = 30;", newText: "const row30 = 3000;" }): Promise<string[]> {
	const path = join(cwd, `file${calls}.ts`);
	const rows = Array.from({ length: 60 }, (_, i) => `const row${i} = ${i};`);
	rows[30] = change.oldText;
	writeFileSync(path, `${rows.join("\n")}\n`);
	const args = { path, edits: [change] };
	const row = new ToolExecutionComponent("edit", `call-${calls++}`, args, { showImages: false }, edit, { requestRender() {} } as any, cwd) as any;
	row.setArgsComplete();
	for (let previous = "", same = 0, i = 0; i < 400; i++) {
		const current = row.render(width).join("\n");
		same = current === previous && !current.includes("rendering") ? same + 1 : 0;
		if (same >= 3) return strip(current).split("\n");
		previous = current;
		await new Promise((done) => setTimeout(done, 10));
	}
	throw new Error("edit row never settled");
}

// Split puts the removed and added line side by side on one row; unified stacks them.
const isSplit = (lines: string[]) => lines.some((line) => line.includes("row30 = 30;") && line.includes("row30 = 3000;"));
const isUnified = (lines: string[]) => lines.some((line) => line.includes("row30 = 30;") && !line.includes("row30 = 3000;"))
	&& lines.some((line) => line.includes("row30 = 3000;") && !line.includes("row30 = 30;"));

test.after(() => {
	Date.now = realNow;
	if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
	rmSync(agentDir, { recursive: true, force: true });
	rmSync(cwd, { recursive: true, force: true });
});

test("auto (default) stays unified below the split width and splits on wide rows", async () => {
	setLayout();
	assert.ok(isUnified(await renderEdit(120)), "120 columns is below the auto split threshold");
	assert.ok(isSplit(await renderEdit(200)), "200 columns fits a clean split");
	setLayout("auto");
	assert.ok(isUnified(await renderEdit(120)));
});

test("split forces side-by-side where auto would stack", async () => {
	setLayout("split");
	assert.ok(isSplit(await renderEdit(120)));
	assert.ok(isSplit(await renderEdit(60)));
});

test("split still stacks when two code columns cannot fit", async () => {
	setLayout("split");
	const lines = await renderEdit(30);
	assert.ok(!isSplit(lines));
});

test("unified never splits, even on wide rows", async () => {
	setLayout("unified");
	assert.ok(isUnified(await renderEdit(200)));
});

test("an unknown value falls back to auto", async () => {
	setLayout("sideways");
	assert.ok(isUnified(await renderEdit(120)));
	assert.ok(isSplit(await renderEdit(200)));
});

test("split wraps long lines in full instead of cutting them off (#34)", async () => {
	setLayout("split");
	const oldText = "const message = 'the quick brown fox jumps over the lazy dog and keeps running across the field until the end';";
	const newText = oldText.replace("lazy dog", "sleepy cat");
	for (const width of [80, 100]) {
		const lines = await renderEdit(width, { oldText, newText });
		const body = lines.filter((line) => line.includes("│▌"));
		assert.ok(body.length > 1, `${width}: the changed line wraps onto continuation rows`);
		assert.ok(!body.some((line) => line.includes("›")), `${width}: nothing is cut off`);
		const [left, right] = [0, 1].map((side) => body.map((line) => line.split("│▌")[side].replace(/^(?:.*▌)?[^│]*│ /, "").trimEnd()).join(""));
		assert.match(left.replace(/\s+/g, ""), /lazydogandkeepsrunningacrossthefielduntiltheend';$/);
		assert.match(right.replace(/\s+/g, ""), /sleepycatandkeepsrunningacrossthefielduntiltheend';$/);
	}
});
