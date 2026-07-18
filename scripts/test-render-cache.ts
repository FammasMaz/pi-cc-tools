import { AssistantMessageComponent, CustomMessageComponent, ToolExecutionComponent, UserMessageComponent } from "@earendil-works/pi-coding-agent";
import { Container } from "@earendil-works/pi-tui";
import { initTheme, theme } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";

initTheme("dark", false);

// Load the extension onto a fake pi so the render patches apply.
const fakePi = {
	tools: new Map(), commands: new Map(), handlers: new Map<string, any[]>(),
	registerTool(d: any) { this.tools.set(d.name, d); },
	registerCommand(n: string, c: any) { this.commands.set(n, c); },
	registerShortcut(_k: string, _s: any) {},
	on(n: string, h: any) { this.handlers.set(n, [...(this.handlers.get(n) ?? []), h]); },
	getThinkingLevel() { return "off"; },
	getAllTools() { return [...this.tools.values()]; },
};
const magicContextToolNames = ["ctx_search", "ctx_memory", "ctx_note", "ctx_expand", "ctx_reduce", "todowrite"];
const oldMagicRenderCall = () => new Container();
const oldMagicRenderResult = () => new Container();
for (const name of magicContextToolNames) {
	fakePi.registerTool({
		name,
		label: name,
		description: `${name} test tool`,
		parameters: {},
		execute: async (_id: string, params: any) => ({ content: [{ type: "text", text: `${name}:${params.value}` }] }),
		renderCall: oldMagicRenderCall,
		renderResult: oldMagicRenderResult,
	});
}
const ext = await import("../extensions/index.ts");
ext.default(fakePi as any);

const W = 120;

// Snapshot string-array output for comparison (copy so later mutations don't matter).
const snap = (v: string[]) => v.join("\n");
const eq = (a: string[], b: string[], label: string) => {
	if (snap(a) !== snap(b)) throw new Error(`MISMATCH: ${label}`);
};
const neq = (a: string[], b: string[], label: string) => {
	if (snap(a) === snap(b)) throw new Error(`UNEXPECTED EQUAL: ${label}`);
};

// ---------------------------------------------------------------------------
// 1. Assistant message: cache hit is byte-identical; updateContent invalidates.
// ---------------------------------------------------------------------------
{
	const msg = {
		role: "assistant",
		content: [{ type: "text", text: "Hello world\n\n- one\n- two\n\n```ts\nconst x = 1;\n```" }],
		stopReason: "end_turn",
	};
	const c = new AssistantMessageComponent(msg as any, false);
	const a = c.render(W);
	const b = c.render(W); // warm → cache hit
	eq(b, a, "assistant: warm cache hit must equal cold render");

	// Mutate content via updateContent; cache must invalidate.
	const msg2 = {
		role: "assistant",
		content: [{ type: "text", text: "Completely different content that should produce different lines." }],
		stopReason: "end_turn",
	};
	c.updateContent(msg2 as any);
	const d = c.render(W);
	neq(d, a, "assistant: updateContent did NOT invalidate the render cache (stale output)");
	const e = c.render(W); // warm again after recompute
	eq(e, d, "assistant: warm cache hit after updateContent must equal the recompute");
	console.log("OK  assistant message: cache identical + updateContent invalidates");
}

// ---------------------------------------------------------------------------
// 2. User message: immutable content → deterministic across renders.
// ---------------------------------------------------------------------------
{
	const c = new UserMessageComponent("User asks a question with **bold** and `code`.");
	const a = c.render(W);
	const b = c.render(W);
	eq(b, a, "user: warm cache hit must equal cold render");
	console.log("OK  user message: cache identical across renders");
}

// ---------------------------------------------------------------------------
// 3. Custom message: rebuild() invalidates.
// ---------------------------------------------------------------------------
{
	const message = { customType: "subagent-notification", content: "✓ Done\n⎿ transcript: foo" };
	const c = new CustomMessageComponent(message as any, undefined as any);
	const a = c.render(W);
	const b = c.render(W);
	eq(b, a, "custom: warm cache hit must equal cold render");
	// invalidate() → rebuild() → cache cleared
	c.invalidate();
	const d = c.render(W);
	eq(d, a, "custom: after invalidate output should still be equivalent (same content)");
	const e = c.render(W);
	eq(e, d, "custom: warm cache hit after invalidate must equal recompute");
	console.log("OK  custom message: cache identical + rebuild invalidates");
}

// ---------------------------------------------------------------------------
// 4. Parent Container.render must NOT mutate the cached child array.
//    Render child, capture cached ref, wrap in a parent, render parent, then
//    re-render child and confirm the cached array is unchanged.
// ---------------------------------------------------------------------------
{
	const msg = { role: "assistant", content: [{ type: "text", text: "Line one\nLine two\nLine three" }], stopReason: "end_turn" };
	const child = new AssistantMessageComponent(msg as any, false);
	const first = child.render(W); // populates cache, returns cached ref
	const snapshot = snap(first);
	const parent = new Container();
	parent.addChild(child);
	parent.render(W); // spreads child's cached array — must not mutate it
	if (snap(first) !== snapshot) throw new Error("parent render mutated the child's cached array");
	if (snap(child.render(W)) !== snapshot) throw new Error("child cached array changed after parent render");
	console.log("OK  parent does not mutate cached child array");
}

// ---------------------------------------------------------------------------
// 5. Custom (subagent) message framing follows toolBackgroundMode. Switching
//    mode must invalidate the cached framing. Uses an isolated temp HOME so the
//    real ~/.pi/settings.json is never touched.
// ---------------------------------------------------------------------------
{
	const realHome = process.env.HOME;
	const tmpHome = `${realHome}/.pi-cache-test-home-${Date.now()}`;
	const fs = await import("node:fs");
	fs.mkdirSync(`${tmpHome}/.pi`, { recursive: true });
	process.env.HOME = tmpHome;
	try {
		const ccTools = (fakePi as any).commands.get("cc-tools");
		if (!ccTools) throw new Error("cc-tools command not registered");
		const ctx = { hasUI: true, ui: { theme, notify() {}, getToolsExpanded() { return false; }, setToolsExpanded() {} } } as any;
		const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
		// A full-width rule line (borderLine) is all '─' chars; branch connectors '└' are not.
		const hasFullWidthRule = (lines: string[]) =>
			lines.some((l) => { const p = stripAnsi(l); return /^─+$/.test(p) && p.length > 5; });

		// Start in outlines mode (default). Render subagent msg → has full-width border rules.
		ccTools.handler("outlines", ctx);
		const message = { customType: "subagent-notification", content: "✓ Done\n⎿ transcript: foo" };
		const c = new CustomMessageComponent(message as any, undefined as any);
		const outlines = c.render(W);
		const outlinesWarm = c.render(W);
		eq(outlinesWarm, outlines, "custom: warm cache identical in outlines mode");
		if (!hasFullWidthRule(outlines)) {
			throw new Error("outlines mode did not produce full-width border rule lines");
		}

		// Switch to default mode (no borders). Cache must miss and reframe.
		ccTools.handler("default", ctx);
		const def = c.render(W);
		neq(def, outlines, "custom: switching toolBackgroundMode did NOT reframe (stale cache)");
		if (hasFullWidthRule(def)) {
			throw new Error("default mode still shows full-width border rule lines");
		}
		const defWarm = c.render(W);
		eq(defWarm, def, "custom: warm cache identical in default mode");

		// Switch back to outlines — must reframe again.
		ccTools.handler("outlines", ctx);
		const outlinesAgain = c.render(W);
		eq(outlinesAgain, outlines, "custom: switching back to outlines did not restore original framing");
		console.log("OK  custom message: toolBackgroundMode change invalidates framing");
	} finally {
		process.env.HOME = realHome;
		fs.rmSync(tmpHome, { recursive: true, force: true });
	}
}

// ---------------------------------------------------------------------------
// 6. Magic Context tool definitions are re-registered with local renderers.
// ---------------------------------------------------------------------------
{
	const sessionStartHandlers = (fakePi as any).handlers.get("session_start") ?? [];
	if (sessionStartHandlers.length === 0) throw new Error("session_start handler not registered");
	for (const handler of sessionStartHandlers) await handler({}, { hasUI: false });
	for (const name of magicContextToolNames) {
		const tool = (fakePi as any).tools.get(name);
		if (!tool) throw new Error(`${name} was not preserved during override registration`);
		if (tool.renderCall === oldMagicRenderCall || tool.renderResult === oldMagicRenderResult) {
			throw new Error(`${name} kept its old Magic Context renderer`);
		}
		const result = await tool.execute("test", { value: "ok" }, undefined, undefined, {});
		if (result.content?.[0]?.text !== `${name}:ok`) throw new Error(`${name} execute behavior changed`);
	}
	console.log("OK  Magic Context tools: local renderers replace extension defaults");
}

// ---------------------------------------------------------------------------
// 7. Magic Context todo overlay receives local branch chrome and one indent.
// ---------------------------------------------------------------------------
{
	const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
	const widget = new Container();
	widget.addChild({
		render: () => [
			theme.fg("accent", "● Todos — 1/2 completed"),
			`${theme.fg("dim", "├─")} ${theme.fg("success", "✓")} #done Done`,
			`${theme.fg("dim", "└─")} ${theme.fg("warning", "◐")} #next Next`,
		],
		invalidate() {},
	} as any);
	const lines = widget.render(W);
	const plain = lines.map(stripAnsi);
	if (plain[0] !== " ● Todos — 1/2 completed") throw new Error("todo overlay heading did not gain one indent");
	if (plain[1] !== " ├ ✓ done Done" || plain[2] !== " └ ◐ next Next") {
		throw new Error("todo overlay branch rows did not strip arm, indent, and remove todo ID hashes");
	}
	if (!lines[1].includes("\x1b[38;")) throw new Error("todo overlay branch did not receive branch chrome");
	console.log("OK  todo overlay: branch chrome + one indent");
}

// ---------------------------------------------------------------------------
// 7. Hermes auto-review notice is restyled locally without changing Hermes.
// ---------------------------------------------------------------------------
{
	const notices: string[] = [];
	const ui = {
		theme,
		notify(message: string) { notices.push(message); },
		getToolsExpanded() { return false; },
		setToolsExpanded() {},
	};
	const turnStart = (fakePi as any).handlers.get("turn_start")?.[0];
	if (!turnStart) throw new Error("turn_start handler not registered");
	await turnStart({}, { hasUI: true, ui });
	ui.notify("💾 Memory auto-reviewed and updated");
	const notice = notices.at(-1) ?? "";
	if (!notice.includes("✻ Memory auto-reviewed and updated") || !notice.includes("\x1b[38;") || notice.includes("\x1b[2m")) {
		throw new Error("Hermes auto-review notice did not adopt thinking-text color without extra dimming");
	}
	console.log("OK  Hermes notice: thinking-text color without extra dimming");
}

// ---------------------------------------------------------------------------
// 8. Advisor call rows show configured model, never a duplicate title.
// ---------------------------------------------------------------------------
{
	const realHome = process.env.HOME;
	const tmpHome = `${realHome}/.pi-advisor-render-test-${Date.now()}`;
	const fs = await import("node:fs");
	fs.mkdirSync(`${tmpHome}/.config/rpiv-advisor`, { recursive: true });
	const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
	const definition = {
		name: "advisor",
		label: "Advisor",
		description: "test advisor",
		parameters: {},
		execute: async () => ({ content: [] }),
	};
	const ui = { theme, getToolsExpanded() { return false; }, notify() {}, setToolsExpanded() {} };
	const renderAdvisor = () => {
		const component = new ToolExecutionComponent(
			"advisor",
			"advisor-test",
			{},
			{ showImages: false },
			definition as any,
			ui as any,
			process.cwd(),
		);
		const renderCall = (component as any).getCallRenderer();
		const rendered = renderCall({}, theme, {
			state: {},
			lastComponent: undefined,
			cwd: process.cwd(),
			isPartial: false,
			argsComplete: true,
		});
		return rendered.render(W).map(stripAnsi).join("\n");
	};
	process.env.HOME = tmpHome;
	try {
		fs.writeFileSync(
			`${tmpHome}/.config/rpiv-advisor/advisor.json`,
			JSON.stringify({ modelKey: "openai-codex/gpt-5.6-sol", effort: "high" }),
		);
		const configured = renderAdvisor();
		if (!configured.includes("Advisor openai-codex/gpt-5.6-sol (high)")) {
			throw new Error("advisor call did not show configured model and effort");
		}
		if (configured.includes("Advisor Advisor")) throw new Error("advisor title duplicated");

		fs.writeFileSync(
			`${tmpHome}/.config/rpiv-advisor/advisor.json`,
			JSON.stringify({ modelKey: "openai-codex/gpt-5.6-sol" }),
		);
		const modelOnly = renderAdvisor();
		if (!modelOnly.includes("Advisor openai-codex/gpt-5.6-sol") || modelOnly.includes("(high)")) {
			throw new Error("advisor call did not support model-only config");
		}

		fs.rmSync(`${tmpHome}/.config/rpiv-advisor/advisor.json`);
		const unconfigured = renderAdvisor();
		if ((unconfigured.match(/Advisor/g) ?? []).length !== 1) {
			throw new Error("advisor fallback did not render title only");
		}
		console.log("OK  advisor call: model + effort + title-only fallback");
	} finally {
		process.env.HOME = realHome;
		fs.rmSync(tmpHome, { recursive: true, force: true });
	}
}

// ---------------------------------------------------------------------------
// 9. Assistant list-bullet setting controls final rendered glyph.
// ---------------------------------------------------------------------------
{
	const realHome = process.env.HOME;
	const tmpHome = `${realHome}/.pi-bullet-render-test-${Date.now()}`;
	const fs = await import("node:fs");
	fs.mkdirSync(`${tmpHome}/.pi`, { recursive: true });
	const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
	const ccTools = (fakePi as any).commands.get("cc-tools");
	if (!ccTools) throw new Error("cc-tools command not registered");
	const ctx = { hasUI: false } as any;
	const piCircleStyle = (_marker: string) => "\x1b[90m○\x1b[0m ";
	process.env.HOME = tmpHome;
	try {
		await ccTools.handler("bullets dash", ctx);
		const dash = stripAnsi(ext.renderAssistantListBullet("- ", piCircleStyle));
		if (dash !== "- ") {
			throw new Error(`dash setting did not replace Pi theme circle: ${JSON.stringify(dash)}`);
		}

		await ccTools.handler("bullets fisheye", ctx);
		const fisheye = stripAnsi(ext.renderAssistantListBullet("- ", piCircleStyle));
		if (fisheye !== "◉ ") {
			throw new Error(`fisheye setting did not replace Pi theme circle: ${JSON.stringify(fisheye)}`);
		}
		console.log("OK  assistant lists: dash/fisheye replace final themed glyph");
	} finally {
		process.env.HOME = realHome;
		fs.rmSync(tmpHome, { recursive: true, force: true });
	}
}

console.log("\nAll correctness checks passed.");
