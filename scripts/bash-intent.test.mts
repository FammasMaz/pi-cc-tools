import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import "./ts-resolve-loader.mjs";
register("./ts-resolve-loader.mjs", import.meta.url);

const agentDir = mkdtempSync(join(tmpdir(), "bash-intent-agent-"));
const cwd = mkdtempSync(join(tmpdir(), "bash-intent-cwd-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
const previousCwd = process.cwd();
process.env.PI_CODING_AGENT_DIR = agentDir;
process.chdir(cwd);
// bashIntent is opt-in; these tests turn it on.
writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ bashIntent: true }));

const tools = new Map<string, any>();
const fakePi = {
	registerTool: (tool: any) => tools.set(tool.name, tool),
	registerCommand() {},
	registerShortcut() {},
	on() {},
	getThinkingLevel: () => "off",
	getAllTools: () => [...tools.values()],
};
(await import("../extensions/index.ts")).default(fakePi as any);
const { ToolExecutionComponent } = await import("@earendil-works/pi-coding-agent");
const { Container } = await import("@earendil-works/pi-tui");
const themes = await import("../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js");
themes.initTheme("dark", false);
const ui = { requestRender() {} } as any;
const plain = (text: string) => text.replace(/\x1b\[[0-9;]*m|\x1b\][^\x07]*\x07/g, "").replace(/[\uE000\uE001]/g, "");

test.after(() => {
	process.chdir(previousCwd);
	if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
	rmSync(agentDir, { recursive: true, force: true });
	rmSync(cwd, { recursive: true, force: true });
});

test("bash accepts optional user-facing intent without changing command execution", async () => {
	const bash = tools.get("bash");
	assert.ok(bash.parameters.properties.displaySummary, "bash exposes displaySummary");
	assert.ok(!bash.parameters.required?.includes("displaySummary"), "displaySummary remains optional");
	assert.match((bash.promptGuidelines ?? []).join("\n"), /displaySummary/);

	const params = { command: "printf intent-safe", displaySummary: "Check shell output" };
	const result = await bash.execute("bash-intent", params, undefined, undefined);
	assert.equal(result.content[0].text, "intent-safe");
	assert.equal(params.displaySummary, "Check shell output", "execution does not mutate model arguments");
});


test("a labelled bash row shows the label in place of the command; expanding shows the command", () => {
	const row = new ToolExecutionComponent(
		"bash",
		"bash-intent-row",
		{ command: "npm test", displaySummary: "Check the test suite" },
		{ showImages: false },
		tools.get("bash"),
		ui,
		cwd,
	) as any;
	row.setArgsComplete();
	row.updateResult({ content: [{ type: "text", text: "pass" }], details: undefined, isError: false }, false);
	const collapsed = row.render(100).map(plain).join("\n");
	assert.match(collapsed, /● Bash Check the test suite/);
	assert.doesNotMatch(collapsed, /npm test/, "the command is hidden while collapsed");
	const headerLine = row.render(100).find((line: string) => plain(line).includes("Check the test suite")) ?? "";
	assert.ok(headerLine.includes(`${themes.theme.getFgAnsi("text")}Check the test suite`), "the label is plain text, not the command color");
	assert.ok(!headerLine.includes(`${themes.theme.getFgAnsi("accent")}Check the test suite`));
	row.setExpanded(true);
	const expanded = row.render(100).map(plain).join("\n");
	assert.match(expanded, /● Bash Check the test suite/);
	assert.match(expanded, /npm test/, "expanding shows the command");
});

test("bash rows preserve visible words while removing terminal controls and normalizing whitespace", () => {
	const row = new ToolExecutionComponent(
		"bash",
		"bash-intent-controls",
		{
			command: "npm test",
			displaySummary: "Run\n\ttests \x1b]8;;https://example.test\x1b\\first\x1b]8;;\x1b\\ \x9b31mred \x1b(Bcharset \x00 value",
		},
		{ showImages: false },
		tools.get("bash"),
		ui,
		cwd,
	) as any;
	row.setArgsComplete();
	const line = row.render(100).map(plain).find((value: string) => value.includes("Bash")) ?? "";
	assert.match(line, /Bash Run tests first red charset value/);
	assert.doesNotMatch(line, /[\x00-\x1f\x7f-\x9f]/);
});


test("by default bash keeps its stock schema and guidance", () => {
	const disabledAgentDir = mkdtempSync(join(tmpdir(), "bash-intent-disabled-"));
	writeFileSync(join(disabledAgentDir, "settings.json"), "{}");
	try {
		const output = execFileSync(process.execPath, [
			"--experimental-strip-types",
			"--input-type=module",
			"-e",
			`import { register } from "node:module";
import "./scripts/ts-resolve-loader.mjs";
register("./scripts/ts-resolve-loader.mjs", import.meta.url);
const tools = new Map();
const pi = { registerTool: (tool) => tools.set(tool.name, tool), registerCommand() {}, registerShortcut() {}, on() {}, getThinkingLevel: () => "off", getAllTools: () => [...tools.values()] };
(await import("./extensions/index.ts")).default(pi);
const bash = tools.get("bash");
console.log(JSON.stringify({ hasDisplaySummary: !!bash.parameters.properties.displaySummary, promptGuidelines: bash.promptGuidelines }));`,
		], {
			cwd: previousCwd,
			env: { ...process.env, PI_CODING_AGENT_DIR: disabledAgentDir },
			encoding: "utf8",
		});
		const result = JSON.parse(output.trim().split("\n").at(-1) ?? "{}");
		assert.equal(result.hasDisplaySummary, false);
		assert.ok(!result.promptGuidelines?.join("\n").includes("displaySummary"));
	} finally {
		rmSync(disabledAgentDir, { recursive: true, force: true });
	}
});


test("Bash file-edit rows append intent without replacing their file target", () => {
	const row = new ToolExecutionComponent(
		"bash",
		"bash-intent-file-edit",
		{ command: "sed -i.bak 's/old/new/' stats.py", displaySummary: "Update the statistic" },
		{ showImages: false },
		tools.get("bash"),
		ui,
		cwd,
	) as any;
	row.setArgsComplete();
	const line = row.render(100).map(plain).find((value: string) => value.includes("Edit")) ?? "";
	assert.match(line, /Edit \(sed\) stats\.py — Update the statistic/);
});

test("group summaries stay unchanged while expanded Bash rows show intent", () => {
	const chat = new Container();
	const read = new ToolExecutionComponent(
		"read",
		"bash-intent-group-read",
		{ path: "package.json" },
		{ showImages: false },
		tools.get("read"),
		ui,
		cwd,
	) as any;
	read.setArgsComplete();
	const row = new ToolExecutionComponent(
		"bash",
		"bash-intent-grouped",
		{ command: "npm test", displaySummary: "Check the test suite" },
		{ showImages: false },
		tools.get("bash"),
		ui,
		cwd,
	) as any;
	row.setArgsComplete();
	chat.addChild(read);
	chat.addChild(row);
	const [group] = chat.children as any[];
	assert.doesNotMatch(group.render(100).map(plain).join("\n"), /Check the test suite/);
	group.setExpanded(true);
	const expanded = group.render(100).map(plain).join("\n");
	assert.match(expanded, /● Bash Check the test suite/);
	assert.match(expanded, /npm test/, "the expanded group shows the command under its label");
});
