import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import "./ts-resolve-loader.mjs";
register("./ts-resolve-loader.mjs", import.meta.url);

// The working line's "↓ N tokens", like pi-polish: it counts thinking and tool-call
// arguments as they stream (not just visible text), adds each finished message's real
// usage.output, and keeps counting across the turns of one request.
const agentDir = mkdtempSync(join(tmpdir(), "spinner-tokens-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = agentDir;

const themeModule = await import("../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js");
themeModule.initTheme("dark", false);
const handlers = new Map<string, Array<(event: unknown, ctx: unknown) => unknown>>();
(await import("../extensions/spinner.ts")).default({
	on: (event: string, handler: any) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
	registerCommand() {},
	registerShortcut() {},
	getThinkingLevel: () => "off",
} as any);

let working = "";
const ctx = {
	hasUI: true,
	ui: {
		theme: themeModule.theme,
		setWorkingMessage: (message?: string) => { working = message ?? ""; },
		setWorkingIndicator() {},
		setStatus() {},
		notify() {},
	},
};
async function fire(event: string, payload: unknown = {}) {
	for (const handler of handlers.get(event) ?? []) await handler(payload, ctx);
}
const update = (assistantMessageEvent: unknown) => fire("message_update", { assistantMessageEvent });
// The refresh loop redraws once a second; force a redraw the way a status change does.
async function shown(): Promise<number | undefined> {
	await update({ type: "thinking_start", contentIndex: 99 });
	await update({ type: "thinking_end", contentIndex: 99, content: "" });
	const match = /↓ ([\d.]+)(k?) tokens/.exec(working.replace(/\x1b\[[0-9;]*m/g, ""));
	if (!match) return undefined;
	return Math.round(Number(match[1]) * (match[2] ? 1000 : 1));
}

test.after(async () => {
	await fire("agent_end", { messages: [] });
	if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
	rmSync(agentDir, { recursive: true, force: true });
});

test("thinking and tool-call arguments count while they stream", async () => {
	await fire("agent_start");
	await fire("turn_start");
	await update({ type: "start" });
	await update({ type: "thinking_start", contentIndex: 0 });
	await update({ type: "thinking_delta", contentIndex: 0, delta: "x".repeat(400) });
	assert.equal(await shown(), 100, "400 characters of thinking ≈ 100 tokens");
	await update({ type: "toolcall_start", contentIndex: 1 });
	await update({ type: "toolcall_delta", contentIndex: 1, delta: "y".repeat(200) });
	assert.equal(await shown(), 150, "tool-call arguments count too");
});

test("a finished message counts its real output tokens, and the next turn keeps counting", async () => {
	await fire("message_end", { message: { role: "assistant", content: [], usage: { output: 331 } } });
	assert.equal(await shown(), 331, "the estimate is replaced by usage.output");
	await fire("turn_end");
	await fire("turn_start");
	await update({ type: "start" });
	await update({ type: "text_start", contentIndex: 0 });
	await update({ type: "text_delta", contentIndex: 0, delta: "z".repeat(80) });
	assert.equal(await shown(), 351, "the second turn adds to the first");
	await fire("message_end", { message: { role: "assistant", content: [{ type: "text", text: "z".repeat(80) }] } });
	assert.equal(await shown(), 351, "no usage reported: the estimate stands");
});

test("a new request starts from zero", async () => {
	await fire("turn_end");
	await fire("agent_end", { messages: [] });
	await fire("before_agent_start");
	await fire("agent_start");
	await fire("turn_start");
	await update({ type: "start" });
	await update({ type: "text_start", contentIndex: 0 });
	await update({ type: "text_delta", contentIndex: 0, delta: "w".repeat(40) });
	assert.equal(await shown(), 10);
});

test("a long running command is cut without a second ellipsis", async () => {
	await fire("turn_start");
	await fire("tool_execution_start", { toolCallId: "t1", toolName: "bash", args: { command: `echo ${"x".repeat(80)}` } });
	const text = working.replace(/\x1b\[[0-9;]*m/g, "");
	assert.match(text, /^Running echo x+…( \(|$)/, text);
	assert.ok(!text.includes("……"), text);
	await fire("tool_execution_end", { toolCallId: "t1" });
});
