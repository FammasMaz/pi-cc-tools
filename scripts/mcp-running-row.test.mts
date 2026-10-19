import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";

import "./ts-resolve-loader.mjs";
register("./ts-resolve-loader.mjs", import.meta.url);

// Direct MCP tools (`mcp__<server>__<tool>`) must name the tool in their header, and a
// running row must draw its call once: the first pending blink used to invalidate the
// row from inside its own updateDisplay, leaving the call region in the box twice.
const { ToolExecutionComponent } = await import("@earendil-works/pi-coding-agent");
const { Container } = await import("@earendil-works/pi-tui");
const { initTheme } = await import("../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js");
initTheme("dark", false);

const names = ["mcp__subagents__Agent", "mcp__magic-context__ctx_reduce", "mcp__subagents__get_subagent_result"];
const mcpTools = names.map((name) => ({ name, label: name, description: "Tool from an MCP server", parameters: {}, execute: async () => ({ content: [] }) }));
const tools = new Map<string, any>();
const handlers = new Map<string, Array<(event: unknown, ctx: unknown) => unknown>>();
const fakePi = {
	registerTool: (tool: any) => tools.set(tool.name, tool),
	registerCommand() {},
	registerShortcut() {},
	on: (event: string, handler: any) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
	getThinkingLevel: () => "off",
	getAllTools: () => [...mcpTools, ...tools.values()],
};
(await import("../extensions/index.ts")).default(fakePi as any);
async function fire(event: string) {
	for (const handler of handlers.get(event) ?? []) await handler({}, { ui: {}, hasUI: false });
}
await fire("session_start");

const strip = (text: string) => text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, "");
const ui = { requestRender() {} };
const visible = (lines: string[]) => strip(lines.join("\n")).split("\n").map((line) => line.trim()).filter(Boolean);

function row(name: string, args: Record<string, unknown>, expanded = false) {
	const definition = tools.get(name) ?? mcpTools.find((tool) => tool.name === name);
	const component = new ToolExecutionComponent(name, `${name}-${Math.random()}`, args, undefined, definition, ui as any, process.cwd()) as any;
	component.setExpanded(expanded);
	return component;
}

test("a direct MCP tool header names the server, tool and its main argument", () => {
	const agent = row("mcp__subagents__Agent", { description: "Debug GSM-T NaN", prompt: "long prompt" });
	agent.setArgsComplete();
	assert.deepEqual(visible(agent.render(110)), ["● MCP subagents:Agent Debug GSM-T NaN"]);
	const reduce = row("mcp__magic-context__ctx_reduce", { drop: "3-5,8" });
	reduce.setArgsComplete();
	assert.deepEqual(visible(reduce.render(110)), ["● MCP magic-context:ctx_reduce 3-5,8"]);
	const fallback = row("mcp__subagents__get_subagent_result", { wait: true });
	fallback.setArgsComplete();
	assert.deepEqual(visible(fallback.render(110)), ["● MCP subagents:get_subagent_result wait: true"]);
});

test("the gateway mcp tool keeps its server:tool summary", () => {
	const gateway = row("mcp", { tool: "ctx_reduce", server: "magic-context" });
	gateway.setArgsComplete();
	assert.deepEqual(visible(gateway.render(110)), ["● MCP magic-context:ctx_reduce"]);
});

for (const expanded of [false, true]) {
	test(`a running row draws its call once (${expanded ? "expanded" : "collapsed"})`, async () => {
		await fire("agent_start");
		try {
			for (const [name, args, title] of [
				["mcp__subagents__Agent", { description: "Debug" }, "MCP subagents:Agent"],
				["grep", { pattern: "x" }, "Grep"],
				["bash", { command: "sleep 5" }, "Bash"],
			] as const) {
				const running = row(name, args, expanded);
				running.setArgsComplete();
				running.markExecutionStarted();
				const box = running.children.find((child: any) => Array.isArray(child.children) && child.children.length > 0);
				assert.equal(box?.children.length, 1, `${name}: one call region before the result`);
				const headers = visible(running.render(110)).filter((line) => line.includes(title));
				assert.equal(headers.length, 1, `${name}: ${headers.join(" | ")}`);
			}
		} finally {
			await fire("agent_end");
		}
	});
}

test("a group of direct MCP tools lists the tool names, not the mcp prefix", () => {
	const chat = new Container();
	for (const [name, args] of [["mcp__subagents__Agent", { description: "Debug" }], ["mcp__magic-context__ctx_reduce", { drop: "1" }]] as const) {
		const component = row(name, args);
		component.setArgsComplete();
		component.updateResult({ content: [{ type: "text", text: "ok" }], isError: false }, false);
		chat.addChild(component);
	}
	const [group] = chat.children as any[];
	assert.ok(Array.isArray(group?.tools), "the two rows are grouped");
	const [header] = visible(group.render(110));
	assert.match(header, /Multiple Tools: 2 done • Agent, Ctx Reduce/);
});
