import assert from "node:assert/strict";
import test, { mock } from "node:test";
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

// The counter eases toward each new total over about a second; tests move the clock instead
// of waiting for it.
// (A real-looking clock: the spinner treats a start time of 0 as "not started".)
mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_800_000_000_000 });

const themeModule = await import("../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js");
const { easeTokenCount } = await import("../extensions/spinner.ts");
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
function readCount(): number | undefined {
	const match = /↓ ([\d,]+) tokens/.exec(working.replace(/\x1b\[[0-9;]*m/g, ""));
	return match ? Number(match[1].replaceAll(",", "")) : undefined;
}
// The count the line settles on: let the counter finish easing, then force a redraw the way a
// status change does.
async function shown(): Promise<number | undefined> {
	mock.timers.tick(3_000);
	await update({ type: "thinking_start", contentIndex: 99 });
	await update({ type: "thinking_end", contentIndex: 99, content: "" });
	return readCount();
}

test.after(async () => {
	await fire("agent_end", { messages: [] });
	mock.timers.reset();
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

test("the counter counts up to a new total instead of jumping there", async () => {
	await fire("message_end", { message: { role: "assistant", content: [], usage: { output: 1_000 } } });
	const target = 1_000; // the reported count replaces the 10 streamed (estimated) tokens
	const seen: number[] = [];
	for (let frame = 0; frame < 40; frame++) {
		mock.timers.tick(50);
		const count = readCount();
		if (count !== undefined) seen.push(count);
	}
	assert.ok(seen.length > 5, `the line redraws while counting: ${seen.join(", ")}`);
	assert.ok(seen.some((count) => count > 10 && count < target), `in-between values are shown: ${seen.join(", ")}`);
	for (let i = 1; i < seen.length; i++) assert.ok(seen[i] >= seen[i - 1], `never counts backwards: ${seen.join(", ")}`);
	assert.ok(seen.every((count) => count <= target), "never past the real total");
	assert.equal(seen.at(-1), target, "arrives within two seconds");
	await fire("turn_end");
});

test("easing: large gaps move fast, small ones by at least a token, never past the target", () => {
	assert.equal(easeTokenCount(0, 1_000, 50), 283, "28% of the gap in one 50 ms frame");
	assert.equal(easeTokenCount(997, 1_000, 50), 998, "at least one token per frame");
	assert.equal(easeTokenCount(999, 1_000, 5_000), 1_000, "never past the target");
	assert.equal(easeTokenCount(500, 400, 50), 472, "eases down after a downward correction too");
	assert.equal(easeTokenCount(42, 42, 50), 42);
});
