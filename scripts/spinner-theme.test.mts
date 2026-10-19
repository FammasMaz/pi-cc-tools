import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import "./ts-resolve-loader.mjs";
register("./ts-resolve-loader.mjs", import.meta.url);

// Pi hands extensions its global theme Proxy as ctx.ui.theme: the same object before and
// after /theme or a light/dark switch. The spinner verb color must follow the new theme.
const agentDir = mkdtempSync(join(tmpdir(), "spinner-theme-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = agentDir;

const themeModule = await import("../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js");
themeModule.initTheme("dark", false);
const handlers = new Map<string, Array<(event: unknown, ctx: unknown) => unknown>>();
const fakePi = {
	on: (event: string, handler: any) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
	registerCommand() {},
	registerShortcut() {},
	getThinkingLevel: () => "off",
};
(await import("../extensions/spinner.ts")).default(fakePi as any);

const messages: string[] = [];
const ctx = {
	hasUI: true,
	ui: {
		theme: themeModule.theme,
		setWorkingMessage: (message?: string) => { if (message) messages.push(message); },
		setWorkingIndicator() {},
		setStatus() {},
		notify() {},
	},
};
async function fire(event: string, payload: unknown = {}) {
	for (const handler of handlers.get(event) ?? []) await handler(payload, ctx);
}
const verbColor = () => {
	const last = messages.at(-1) ?? "";
	return /^(\x1b\[[0-9;]*m)/.exec(last)?.[1];
};

test.after(async () => {
	await fire("agent_end", { messages: [] });
	if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
	rmSync(agentDir, { recursive: true, force: true });
});

test("the spinner verb follows a theme switch on the same theme proxy", async () => {
	await fire("agent_start");
	await fire("turn_start");
	const dark = verbColor();
	assert.ok(dark, "a colored working message was set");
	assert.equal(dark, themeModule.theme.getFgAnsi("borderAccent"));

	themeModule.setTheme("light", false);
	const light = themeModule.theme.getFgAnsi("borderAccent");
	assert.notEqual(light, dark, "the two built-in themes use different accents");
	await fire("turn_start");
	assert.equal(verbColor(), light);
});
