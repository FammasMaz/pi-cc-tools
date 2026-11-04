import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import "./ts-resolve-loader.mjs";
register("./ts-resolve-loader.mjs", import.meta.url);
register("./tool-ctx-forward.loader.mjs", {
	parentURL: import.meta.url,
	data: { shimURL: new URL("./tool-ctx-forward.shim.mjs", import.meta.url).href },
});

// Issue #44: the read/bash/grep/find/ls/write/edit overrides called Pi's built-in
// tools with four arguments, dropping the 5th `ctx`. Pi 1.5 builds PI_SESSION_ID /
// PI_MODEL / ... and resolves the working directory from ctx, so every override
// must forward it unchanged. The shim loader swaps in recording tool factories.
process.env.COLORTERM = "truecolor";
const agentDir = mkdtempSync(join(tmpdir(), "tool-ctx-forward-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = agentDir;
writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ terminalTheme: false }));

const tools = new Map<string, any>();
(await import("../extensions/index.ts")).default({
	registerTool: (tool: any) => tools.set(tool.name, tool),
	registerCommand() {},
	registerShortcut() {},
	on() {},
	getThinkingLevel: () => "off",
	getAllTools: () => [...tools.values()],
} as any);

const received: Map<string, { argc: number; ctx: unknown }> = (globalThis as any).__piToolCtxReceived;
assert.ok(received, "shim loader must have replaced the Pi tool factories");

test.after(() => {
	if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
	rmSync(agentDir, { recursive: true, force: true });
});

const ctx = { cwd: "/tmp/session-cwd", model: { provider: "p", id: "m" }, sessionManager: {} };
const paramsFor: Record<string, unknown> = {
	read: { path: "x.txt" },
	bash: { command: "true" },
	grep: { pattern: "x" },
	find: { pattern: "*" },
	ls: {},
	write: { path: "x.txt", content: "" },
	edit: { path: "x.txt", oldText: "a", newText: "b" },
};

for (const name of ["read", "bash", "grep", "find", "ls", "write", "edit"]) {
	test(`${name} override forwards ctx to Pi's built-in tool`, async () => {
		const tool = tools.get(name);
		assert.ok(tool, `${name} override registered`);
		await tool.execute(`call-${name}`, paramsFor[name], undefined, undefined, ctx);
		const call = received.get(name);
		assert.ok(call, `${name} built-in execute was called`);
		assert.equal(call.argc, 5, `${name} must call the built-in with 5 arguments`);
		assert.equal(call.ctx, ctx, `${name} must pass the 5th ctx argument through unchanged`);
	});
}
