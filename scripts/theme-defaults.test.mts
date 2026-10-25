import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import "./ts-resolve-loader.mjs";
register("./ts-resolve-loader.mjs", import.meta.url);

// Defaults that need no configuration: pi follows the terminal's colors, and branch
// connectors are a faint mark that stays visible on dark and light themes.
process.env.COLORTERM = "truecolor";
const agentDir = mkdtempSync(join(tmpdir(), "theme-defaults-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = agentDir;
const settingsPath = join(agentDir, "settings.json");
writeFileSync(settingsPath, JSON.stringify({ theme: "dark" }));
const settings = () => JSON.parse(readFileSync(settingsPath, "utf8"));

const { ToolExecutionComponent } = await import("@earendil-works/pi-coding-agent");
const { Container } = await import("@earendil-works/pi-tui");
const themes = await import("../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js");
const { contrastRatio } = await import("../extensions/theme-colors.ts");
themes.initTheme("dark", false);

const tools = new Map<string, any>();
const handlers = new Map<string, Array<(event: unknown, ctx: unknown) => unknown>>();
const commands = new Map<string, any>();
const fakePi = {
	registerTool: (tool: any) => tools.set(tool.name, tool),
	registerCommand: (name: string, command: any) => commands.set(name, command),
	registerShortcut() {},
	on: (event: string, handler: any) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
	getThinkingLevel: () => "off",
	getAllTools: () => [...tools.values()],
};
(await import("../extensions/index.ts")).default(fakePi as any);

// Pi's interactive UI as extensions see it: the active theme (with its name), the
// installed themes, and setTheme().
let active = "dark";
let hasSystemTheme = true;
const setThemeCalls: string[] = [];
const notes: Array<{ message: string; type?: string }> = [];
const ui = {
	theme: new Proxy({}, { get: (_target, prop) => (prop === "name" ? active : Reflect.get(themes.theme as any, prop)) }),
	getAllThemes: () => [{ name: "dark" }, { name: "light" }, ...(hasSystemTheme ? [{ name: "system" }] : [])],
	setTheme(name: string) {
		setThemeCalls.push(name);
		active = name;
		return { success: true };
	},
	notify(message: string, type?: string) {
		notes.push({ message, type });
	},
	onTerminalInput: () => () => {},
	setToolsExpanded() {},
	getToolsExpanded: () => false,
	invalidate() {},
	requestRender() {},
};
const ctx = { hasUI: true, ui };
async function sessionStart() {
	for (const handler of handlers.get("session_start") ?? []) await handler({ reason: "startup" }, ctx);
}

test.after(() => {
	// The focus listener puts stdin in flowing mode; let the test process exit.
	process.stdin.removeAllListeners("data");
	process.stdin.pause();
	themes.setTheme("dark", false);
	if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
	rmSync(agentDir, { recursive: true, force: true });
});

// These run in order: the extension caches settings for a few seconds, so the cases that
// rely on the setting being unset come before the ones that write it.

test("terminal colors stay quiet on pi versions without the system theme", async () => {
	hasSystemTheme = false;
	await sessionStart();
	hasSystemTheme = true;
	assert.deepEqual(setThemeCalls, []);
	assert.deepEqual(notes.filter((n) => n.type === "error"), [], "no error at startup when nobody asked for it");
});

test("pi --use-theme still picks the theme for that run", async () => {
	process.argv.push("--use-theme", "light");
	try {
		await sessionStart();
	} finally {
		process.argv.splice(-2, 2);
	}
	assert.deepEqual(setThemeCalls, []);
});

test("by default pi switches to the terminal's colors and remembers the previous theme", async () => {
	await sessionStart();
	assert.deepEqual(setThemeCalls, ["system"]);
	assert.equal(settings().terminalThemePrevious, "dark");
	assert.equal(settings().terminalTheme, undefined, "the default is not written to the settings file");
	assert.ok(!notes.some((n) => n.message.includes("/cc-theme terminal off")), "notice waits for the transcript to render");
	await new Promise((done) => setTimeout(done, 5));
	assert.ok(notes.some((n) => n.message.includes("/cc-theme terminal off")), "says how to turn it off");

	await sessionStart();
	assert.deepEqual(setThemeCalls, ["system"], "already on the system theme: nothing to do");
});

test("/cc-theme terminal off restores the previous theme and keeps it across starts", async () => {
	await commands.get("cc-theme").handler("terminal off", ctx);
	assert.deepEqual(setThemeCalls, ["system", "dark"]);
	assert.equal(settings().terminalTheme, false, "off is stored explicitly, since unset means on");

	await sessionStart();
	assert.deepEqual(setThemeCalls, ["system", "dark"], "the next start leaves the theme alone");
});

test("/cc-theme terminal on switches back", async () => {
	await commands.get("cc-theme").handler("terminal on", ctx);
	assert.deepEqual(setThemeCalls, ["system", "dark", "system"]);
	assert.equal(settings().terminalTheme, true);
});

// Connectors: pi 0.79 (the dev dependency) does not report the terminal's colors, so this
// exercises the fallback: 2:1 contrast against black or white. Pi >= 1.4 uses the terminal's
// real background (see terminal-theme.test.mts for the blend).
function connectorColors(themeName: string): Array<{ r: number; g: number; b: number }> {
	themes.setTheme(themeName, false);
	const chat = new Container();
	for (const [name, args, text] of [["grep", { pattern: "foo" }, "a.ts:1: foo"], ["read", { path: "b.ts" }, "line1"]] as const) {
		const row = new ToolExecutionComponent(name, `${name}-${Math.random()}`, args, { showImages: false }, tools.get(name), { requestRender() {} } as any, agentDir) as any;
		row.setArgsComplete();
		row.updateResult({ content: [{ type: "text", text }], isError: false }, false);
		chat.addChild(row);
	}
	(chat.children[0] as any).setExpanded?.(true);
	const out = chat.render(100).join("\n");
	return [...out.matchAll(/\x1b\[38;2;(\d+);(\d+);(\d+)m[├└]/g)].map((m) => ({ r: +m[1], g: +m[2], b: +m[3] }));
}

test("branch connectors are a faint mark on dark and light themes", () => {
	const dark = connectorColors("dark");
	assert.ok(dark.length > 0, "connectors rendered");
	for (const c of dark) assert.deepEqual(c, { r: 72, g: 72, b: 72 });

	const light = connectorColors("light");
	assert.ok(light.length > 0, "connectors rendered");
	for (const c of light) {
		const ratio = contrastRatio(c, { r: 255, g: 255, b: 255 });
		assert.ok(Math.abs(ratio - 2) < 0.05, `2:1 on white, got ${ratio.toFixed(2)}`);
	}
});

test("a running bash command does not repeat its script under the row by default", async () => {
	for (const handler of handlers.get("agent_start") ?? []) await handler({}, { ui: {}, hasUI: false });
	try {
		themes.setTheme("dark", false);
		const command = "for f in *.py; do\n  echo $f\ndone";
		const row = new ToolExecutionComponent("bash", "bash-default", { command }, { showImages: false }, tools.get("bash"), { requestRender() {} } as any, agentDir) as any;
		row.setArgsComplete();
		row.markExecutionStarted();
		const lines = row.render(100).map((line: string) => line.replace(/\x1b\[[0-9;]*m/g, "")).filter((line: string) => line.trim());
		assert.equal(lines.length, 1, `only the header: ${JSON.stringify(lines)}`);
		assert.match(lines[0], /Bash for f in \*\.py; do/);
	} finally {
		for (const handler of handlers.get("agent_end") ?? []) await handler({}, { ui: {}, hasUI: false });
	}
});

test("a running command shows no output lines under its row by default", async () => {
	for (const handler of handlers.get("agent_start") ?? []) await handler({}, { ui: {}, hasUI: false });
	try {
		themes.setTheme("dark", false);
		const row = new ToolExecutionComponent("bash", "bash-live", { command: "make" }, { showImages: false }, tools.get("bash"), { requestRender() {} } as any, agentDir) as any;
		row.setArgsComplete();
		row.markExecutionStarted();
		row.updateResult({ content: [{ type: "text", text: "compiling a.c\ncompiling b.c\nlinking" }], isError: false }, true);
		const lines = row.render(100).map((line: string) => line.replace(/\x1b\[[0-9;]*m/g, "")).filter((line: string) => line.trim());
		assert.equal(lines.length, 1, `only the header: ${JSON.stringify(lines)}`);
		assert.match(lines[0], /Bash make/);
		assert.ok(!lines.some((line: string) => line.includes("linking")));
	} finally {
		for (const handler of handlers.get("agent_end") ?? []) await handler({}, { ui: {}, hasUI: false });
	}
});
