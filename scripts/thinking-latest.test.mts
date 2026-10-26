import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import "./ts-resolve-loader.mjs";
register("./ts-resolve-loader.mjs", import.meta.url);

// thinkingMode "latest": only the latest assistant message keeps its thinking. Earlier ones drop
// it entirely (no "Thought for Xs"), and the tool rows their thinking used to separate merge.
process.env.COLORTERM = "truecolor";
const agentDir = mkdtempSync(join(tmpdir(), "thinking-latest-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = agentDir;
const settingsPath = join(agentDir, "settings.json");
writeFileSync(settingsPath, JSON.stringify({ terminalTheme: false, thinkingMode: "latest" }));

const { AssistantMessageComponent, ToolExecutionComponent } = await import("@earendil-works/pi-coding-agent");
const { Container } = await import("@earendil-works/pi-tui");
const themes = await import("../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js");
themes.initTheme("dark", false);

const tools = new Map<string, any>();
const commands = new Map<string, any>();
(await import("../extensions/index.ts")).default({
	registerTool: (tool: any) => tools.set(tool.name, tool),
	registerCommand: (name: string, command: any) => commands.set(name, command),
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
const ui = { requestRender() {} };

/** An assistant message as pi adds it: thinking, then text and/or tool calls. */
function assistant(thought: string, extra: any[]) {
	const message = { role: "assistant", content: [{ type: "thinking", thinking: thought }, ...extra], stopReason: "toolUse" };
	return new AssistantMessageComponent(message as any, true);
}

function tool(path: string) {
	const row = new ToolExecutionComponent("read", `read-${path}`, { path }, { showImages: false }, tools.get("read"), ui as any, agentDir) as any;
	row.setArgsComplete();
	row.updateResult({ content: [{ type: "text", text: "1\n2" }], isError: false }, false);
	return row;
}

/** The chat the way pi builds it, one message after another. */
function buildChat() {
	const chat = new Container();
	const call = (id: string) => ({ type: "toolCall", id, name: "read", arguments: {} });
	chat.addChild(assistant("Look at a.ts first.", [call("1")]));
	chat.addChild(tool("a.ts"));
	chat.addChild(assistant("Now b.ts.", [call("2")]));
	chat.addChild(tool("b.ts"));
	chat.addChild(assistant("And c.ts.", [call("3")]));
	chat.addChild(tool("c.ts"));
	chat.addChild(assistant("Time to answer.", [{ type: "text", text: "All three files are fine." }]));
	return chat;
}

const visible = (chat: any) => chat.render(100).map((line: string) => plain(line).trimEnd()).filter((line: string) => line.trim());

test("earlier messages drop their thinking and the reads around it merge into one group", () => {
	const lines = visible(buildChat());
	const text = lines.join("\n");
	assert.equal((text.match(/Thought for|Thinking/g) ?? []).length, 1, `only the latest message shows its thinking:\n${text}`);
	assert.match(text, /Read 3 files/, `one group for the three reads:\n${text}`);
	assert.ok(lines.findIndex((line: string) => /Thought for|Thinking/.test(line)) > lines.findIndex((line: string) => /Read 3 files/.test(line)), "the latest thinking comes after the reads");
	assert.match(text, /All three files are fine\./);
});

test("text in an earlier message still separates tool rows", () => {
	const chat = new Container();
	const call = (id: string) => ({ type: "toolCall", id, name: "read", arguments: {} });
	chat.addChild(assistant("First.", [call("1")]));
	chat.addChild(tool("a.ts"));
	chat.addChild(assistant("Second.", [{ type: "text", text: "Checking b.ts next." }, call("2")]));
	chat.addChild(tool("b.ts"));
	chat.addChild(assistant("Done.", [{ type: "text", text: "Fine." }]));
	const text = visible(chat).join("\n");
	assert.doesNotMatch(text, /Read 2 files/, text);
	assert.match(text, /Checking b\.ts next\./);
	assert.equal((text.match(/Thought for|Thinking/g) ?? []).length, 1, text);
});

test("switching back to live restores every thinking row in its place", async () => {
	const chat = buildChat();
	const handler = commands.get("cc-tools").handler;
	const notes: string[] = [];
	const ctx = { hasUI: true, ui: { notify: (m: string) => notes.push(m), setToolsExpanded() {}, getToolsExpanded: () => false } };
	await handler("thinking live", ctx);
	const lines = visible(chat);
	const order = lines.filter((line: string) => /Thought for|Thinking|Read a\.ts|Read b\.ts|Read c\.ts/.test(line))
		.map((line: string) => (/Read (\w)\.ts/.exec(line)?.[1] ?? "thought"));
	assert.deepEqual(order, ["thought", "a", "thought", "b", "thought", "c", "thought"], lines.join("\n"));

	await handler("thinking latest", ctx);
	assert.match(visible(chat).join("\n"), /Read 3 files/, "and merges again");
	assert.ok(notes.some((note) => /Thinking → latest/.test(note)));
});

test("the default (live) mode keeps every thinking row", async () => {
	writeFileSync(settingsPath, JSON.stringify({ terminalTheme: false }));
	await new Promise((resolve) => setTimeout(resolve, 0));
	const handler = commands.get("cc-tools").handler;
	await handler("thinking live", { hasUI: false, ui: {} });
	const text = visible(buildChat()).join("\n");
	assert.equal((text.match(/Thought for|Thinking/g) ?? []).length, 4, text);
	assert.doesNotMatch(text, /Read 3 files/);
});
