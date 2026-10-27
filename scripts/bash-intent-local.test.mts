import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import "./ts-resolve-loader.mjs";
register("./ts-resolve-loader.mjs", import.meta.url);

// bashIntent "local": labels come from a helper process on this machine (Apple's on-device model
// in real use; a stand-in script here), and nothing the model sees changes.
const agentDir = mkdtempSync(join(tmpdir(), "bash-intent-local-agent-"));
const cwd = mkdtempSync(join(tmpdir(), "bash-intent-local-cwd-"));
const cacheDir = mkdtempSync(join(tmpdir(), "bash-intent-local-cache-"));
const helperDir = mkdtempSync(join(tmpdir(), "bash-intent-local-helper-"));
const requestLog = join(helperDir, "requests.log");
const previous = { agentDir: process.env.PI_CODING_AGENT_DIR, cwd: process.cwd() };

// Same protocol as the Swift helper: {"ready":true}, then one {"id","summary"} per request.
const helper = join(helperDir, "fake-helper.mjs");
writeFileSync(helper, `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";
if (process.env.FAKE_INTENT_UNAVAILABLE) {
	process.stdout.write(JSON.stringify({ unavailable: "appleIntelligenceNotEnabled" }) + "\\n");
	process.exit(0);
}
process.stdout.write(JSON.stringify({ ready: true }) + "\\n");
createInterface({ input: process.stdin }).on("line", (line) => {
	const request = JSON.parse(line);
	appendFileSync(${JSON.stringify(requestLog)}, request.command + "\\n");
	const summary = request.command.startsWith("echo") ? '"Print a greeting."' : "Run the \\u001b[31mtest\\u001b[0m suite";
	setTimeout(() => process.stdout.write(JSON.stringify({ id: request.id, summary }) + "\\n"), 20);
});
`);
chmodSync(helper, 0o755);

process.env.PI_CODING_AGENT_DIR = agentDir;
process.env.PI_CC_UI_CACHE_DIR = cacheDir;
process.env.PI_CC_UI_INTENT_HELPER = helper;
process.chdir(cwd);
writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ bashIntent: "local", terminalTheme: false }));

const tools = new Map<string, any>();
const commands = new Map<string, any>();
const handlers = new Map<string, Array<(event: unknown, ctx: unknown) => unknown>>();
(await import("../extensions/index.ts")).default({
	registerTool: (tool: any) => tools.set(tool.name, tool),
	registerCommand: (name: string, command: any) => commands.set(name, command),
	registerShortcut() {},
	on: (event: string, handler: any) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
	getThinkingLevel: () => "off",
	getAllTools: () => [...tools.values()],
} as any);
const intent = await import("../extensions/bash-intent.ts");
const { ToolExecutionComponent } = await import("@earendil-works/pi-coding-agent");
const themes = await import("../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js");
themes.initTheme("dark", false);
const plain = (text: string) => text.replace(/\x1b\[[0-9;]*m|\x1b\][^\x07]*\x07/g, "").replace(/[\uE000\uE001]/g, "");
const requests = () => (existsSync(requestLog) ? readFileSync(requestLog, "utf8").split("\n").filter(Boolean) : []);
const until = async (check: () => boolean, ms = 10_000) => {
	for (const end = Date.now() + ms; Date.now() < end; ) {
		if (check()) return true;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	return check();
};

test.after(() => {
	intent.resetLocalIntentsForTests();
	process.chdir(previous.cwd);
	if (previous.agentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = previous.agentDir;
	delete process.env.PI_CC_UI_CACHE_DIR;
	delete process.env.PI_CC_UI_INTENT_HELPER;
	for (const dir of [agentDir, cwd, cacheDir, helperDir]) rmSync(dir, { recursive: true, force: true });
});

function bashRow(command: string, redraws: { count: number }) {
	const row = new ToolExecutionComponent("bash", `bash-${Math.random()}`, { command }, { showImages: false }, tools.get("bash"), { requestRender() {} } as any, cwd) as any;
	const invalidate = row.invalidate.bind(row);
	row.invalidate = () => {
		redraws.count++;
		invalidate();
	};
	row.setArgsComplete();
	return row;
}
const header = (row: any) => plain(row.render(100).find((line: string) => plain(line).includes("Bash")) ?? "").trim();

test("settings: true still means model; unknown values mean off", () => {
	assert.equal(intent.normalizeBashIntentMode(true), "model");
	assert.equal(intent.normalizeBashIntentMode("model"), "model");
	assert.equal(intent.normalizeBashIntentMode("local"), "local");
	assert.equal(intent.normalizeBashIntentMode(false), "off");
	assert.equal(intent.normalizeBashIntentMode(undefined), "off");
	assert.equal(intent.normalizeBashIntentMode("apple"), "off");
});

test("labels lose quotes, control codes and a final period, and stay short", () => {
	assert.equal(intent.cleanIntentLabel('"Print a greeting."'), "Print a greeting");
	assert.equal(intent.cleanIntentLabel("Run the \x1b[31mtest\x1b[0m\nsuite"), "Run the test suite");
	assert.equal([...intent.cleanIntentLabel("word ".repeat(40))].length, 96);
	assert.equal(intent.cleanIntentLabel(42), "");
});

test("local mode leaves the bash tool exactly as stock", () => {
	const bash = tools.get("bash");
	assert.equal(bash.parameters.properties.displaySummary, undefined, "no extra argument for the model");
	assert.doesNotMatch(JSON.stringify(bash.promptGuidelines ?? []), /displaySummary/, "no extra instruction for the model");
});

test("a command that runs gets a label from the helper; the model's arguments are untouched", async () => {
	const params = { command: "echo hi" };
	const redraws = { count: 0 };
	const row = bashRow(params.command, redraws);
	row.markExecutionStarted();
	assert.equal(header(row), "● Bash echo hi", "the command shows until the label arrives");
	const result = await tools.get("bash").execute("call-1", params, undefined, undefined);
	assert.equal(result.content[0].text.trim(), "hi", "the command ran normally");
	assert.deepEqual(params, { command: "echo hi" }, "arguments not modified");
	assert.ok(await until(() => redraws.count > 0), "the row is redrawn when the label arrives");
	row.updateResult(result, false);
	assert.match(header(row), /^● Bash Print a greeting\b/, "then the label takes its place");
	assert.deepEqual(requests(), ["echo hi"]);
});

test("labels are cached: the same command again, and rows that are only redrawn, ask for nothing", async () => {
	await tools.get("bash").execute("call-2", { command: "echo hi" }, undefined, undefined);
	const resumed = bashRow("npm test", { count: 0 });
	resumed.updateResult({ content: [{ type: "text", text: "ok" }], isError: false }, false);
	assert.ok(header(resumed).startsWith("● Bash npm test"), `a redrawn row with no label keeps its command: ${header(resumed)}`);
	await new Promise((resolve) => setTimeout(resolve, 100));
	assert.deepEqual(requests(), ["echo hi"], "no new requests");
	intent.flushLocalIntentCacheForTests();
	const cached = JSON.parse(readFileSync(join(cacheDir, "bash-intents.json"), "utf8"));
	assert.deepEqual(Object.values(cached.labels), ["Print a greeting"], "stored on disk for resumed sessions");
	assert.ok(!JSON.stringify(cached).includes("echo hi"), "the cache stores a hash, not the command");
});

test("control codes in a label never reach the terminal", async () => {
	const redraws = { count: 0 };
	const row = bashRow("npm test", redraws);
	row.markExecutionStarted();
	header(row);
	await tools.get("bash").execute("call-3", { command: "npm test" }, undefined, undefined).catch(() => undefined);
	assert.ok(await until(() => redraws.count > 0));
	const line = row.render(100).find((l: string) => plain(l).includes("Bash")) ?? "";
	assert.match(plain(line), /Bash Run the test suite/);
	assert.ok(!line.includes("\x1b[31m"), "the helper's color codes are stripped");
});

test("/cc-tools intent saves the mode and says when it applies", async () => {
	const notes: Array<{ message: string; type?: string }> = [];
	const ctx = { hasUI: true, ui: { notify: (message: string, type?: string) => notes.push({ message, type }) } };
	const run = (args: string) => commands.get("cc-tools").handler(args, ctx);
	await run("intent model");
	assert.equal(JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8")).bashIntent, "model");
	assert.match(notes.at(-1)!.message, /Bash labels → model\. Applies after \/reload or on the next start\./);
	await run("intent status");
	assert.match(notes.at(-1)!.message, /Bash labels: local .*Saved: model, applies after \/reload/);
	await run("intent local");
	assert.match(notes.at(-1)!.message, /already active/);
	await run("intent sometimes");
	assert.equal(notes.at(-1)!.type, "error");
	const completions = commands.get("cc-tools").getArgumentCompletions("intent ").map((c: any) => c.label);
	assert.deepEqual(completions, ["off", "model", "local", "status"]);
});

test("when Apple's model is unavailable, labels turn off with one notice", async () => {
	const notices: string[] = [];
	process.env.FAKE_INTENT_UNAVAILABLE = "1";
	try {
		intent.configureLocalIntents(true, (message) => notices.push(message));
		intent.requestLocalIntent("ls -la");
		intent.requestLocalIntent("pwd");
		assert.ok(await until(() => notices.length > 0));
		await new Promise((resolve) => setTimeout(resolve, 100));
		assert.equal(notices.length, 1);
		assert.match(notices[0], /Apple's on-device model is not available \(appleIntelligenceNotEnabled\)/);
		intent.requestLocalIntent("whoami");
		assert.ok(!requests().includes("whoami"), "no more requests this session");
	} finally {
		delete process.env.FAKE_INTENT_UNAVAILABLE;
	}
});
