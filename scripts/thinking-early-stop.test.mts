import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import "./ts-resolve-loader.mjs";
register("./ts-resolve-loader.mjs", import.meta.url);

// Some OpenAI-compatible proxies (seen with symbiote → z-ai/glm-5.3-flash) send
// `finish_reason: "stop"` on empty chunks before the reasoning starts, so pi-ai
// sets stopReason "stop" for the whole stream. Pi also emits every
// message_update with a fresh `{ ...partial }` copy. The live thinking row must
// still stream, and the finished row must show the real elapsed time instead
// of a character-count estimate.
process.env.COLORTERM = "truecolor";
const agentDir = mkdtempSync(join(tmpdir(), "thinking-early-stop-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = agentDir;
writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ terminalTheme: false }));

const { AssistantMessageComponent } = await import("@earendil-works/pi-coding-agent");
const themes = await import("../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js");
themes.initTheme("dark", false);

const handlers = new Map<string, Array<(event: any, ctx: any) => any>>();
(await import("../extensions/index.ts")).default({
	registerTool() {},
	registerCommand() {},
	registerShortcut() {},
	on: (name: string, handler: any) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
	getThinkingLevel: () => "high",
	getAllTools: () => [],
} as any);

test.after(() => {
	if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
	rmSync(agentDir, { recursive: true, force: true });
});

const plain = (text: string) => text.replace(/\x1b\[[0-9;]*m|\x1b\][^\x07]*\x07/g, "").replace(/[\uE000\uE001]/g, "");
const ctx = { ui: { invalidate() {}, requestRender() {} } };

async function emit(name: string, event: any) {
	for (const handler of handlers.get(name) ?? []) await handler(event, ctx);
}

test("early finish_reason stop keeps thinking live and records the real duration", async () => {
	// The shared partial, as pi-ai mutates it; stopReason is already "stop".
	const partial: any = { role: "assistant", content: [], stopReason: "stop" };
	const component = new AssistantMessageComponent(undefined, true);
	const render = () => component.render(100).map((line: string) => plain(line).trimEnd()).join("\n");

	await emit("message_start", { message: { ...partial } });
	const thinking = { type: "thinking", thinking: "" };
	partial.content.push(thinking);
	let copy = { ...partial };
	await emit("message_update", { message: copy, assistantMessageEvent: { type: "thinking_start" } });
	component.updateContent(copy, true);

	// ~3000 chars would estimate to 20s at 150 chars/s; the real stream takes ms.
	const sentence = "The primes between one hundred and one hundred sixty need checking. ";
	for (let i = 0; i < 45; i++) {
		thinking.thinking += sentence;
		copy = { ...partial };
		await emit("message_update", { message: copy, assistantMessageEvent: { type: "thinking_delta", delta: sentence } });
		component.updateContent(copy, true);
	}
	const live = render();
	assert.match(live, /primes between one hundred/, `thinking streams while active:\n${live}`);
	assert.doesNotMatch(live, /Thought for/, `no finished summary while thinking:\n${live}`);

	const text = { type: "text", text: "" };
	partial.content.push(text);
	copy = { ...partial };
	await emit("message_update", { message: copy, assistantMessageEvent: { type: "text_start" } });
	text.text = "There are eleven.";
	copy = { ...partial };
	await emit("message_update", { message: copy, assistantMessageEvent: { type: "text_delta", delta: text.text } });
	component.updateContent(copy, true);
	const done = render();
	assert.match(done, /Thought for 1s/, `real elapsed time, not a 20s char estimate:\n${done}`);
	assert.match(done, /There are eleven\./);

	await emit("message_end", { message: partial });
	component.updateContent(partial, true);
	assert.match(render(), /Thought for 1s/);
});
