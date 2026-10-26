process.env.FORCE_COLOR = "3"; // this file asserts truecolor output
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { register } from "node:module";
import test from "node:test";

import "./ts-resolve-loader.mjs";
register("./ts-resolve-loader.mjs", import.meta.url);

const colors = await import("../extensions/theme-colors.ts");
const terminal = await import("../extensions/terminal-theme.ts");

type Rgb = { r: number; g: number; b: number };
const hex = (h: string): Rgb => ({ r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16) });

// Stand-in for pi >= 1.4's Theme: tokens set to "" resolve to the terminal's
// reported default colors in `colors`, like pi's own class does.
let terminalColors = { background: hex("#161616"), foreground: hex("#d6d2cc") };
class FakeTheme {
	fgAnsi = new Map<string, string>();
	bgAnsi = new Map<string, string>();
	private values: Record<string, string> = {};
	private readonly own?: "dark" | "light";
	constructor(fg: Record<string, string>, bg: Record<string, string>, _mode: string, options: { appearance?: "dark" | "light" } = {}) {
		for (const [k, v] of Object.entries(fg)) { this.fgAnsi.set(k, v ? `fg:${v}` : "\x1b[39m"); this.values[k] = v; }
		for (const [k, v] of Object.entries(bg)) { this.bgAnsi.set(k, v ? `bg:${v}` : "\x1b[49m"); this.values[k] = v; }
		this.own = options.appearance;
	}
	get appearance() { return this.own ?? "dark"; }
	get colors() {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(this.values)) {
			const rgb = v ? hex(v) : this.bgAnsi.has(k) ? terminalColors.background : terminalColors.foreground;
			out[k] = { kind: "rgb", ...rgb };
		}
		return out;
	}
	getColorMode() { return "truecolor"; }
}

const charcoal = () => new FakeTheme(
	{ text: "", syntaxKeyword: "#8ba1b5", syntaxString: "#94a57e", syntaxComment: "#a09d99", toolDiffAdded: "#94a57e", toolDiffRemoved: "#de8168" },
	{ userMessageBg: "#282e34", toolSuccessBg: "#2a2f24" },
	"truecolor",
	{ appearance: "dark" },
);

test("chrome blend keeps rgb 72's weight on dark themes and the same contrast on light ones", () => {
	const dark = colors.blendForContrast(hex("#161616"), hex("#d6d2cc"), 2.0);
	assert.ok(Math.abs(dark.r - 72) <= 2, `branch on #161616 is ~rgb 72, got ${colors.rgbToHex(dark)}`);
	const light = colors.blendForContrast(hex("#f0f9f6"), hex("#2f4640"), 2.0);
	assert.ok(Math.abs(colors.contrastRatio(hex("#f0f9f6"), light) - 2.0) < 0.01);
	// A terminal whose text cannot reach the target contrast gets its text color.
	assert.deepEqual(colors.blendForContrast(hex("#808080"), hex("#909090"), 2.0), hex("#909090"));
});

test("terminal default colors come from the active theme's \"\" tokens", () => {
	const theme = charcoal();
	assert.deepEqual(colors.terminalDefaultColors(theme), { background: hex("#161616"), foreground: hex("#d6d2cc") });
	terminalColors = { background: hex("#121212"), foreground: hex("#dedede") };
	assert.deepEqual(colors.terminalDefaultColors(theme)?.background, hex("#121212"), "follows the terminal's new colors");
	terminalColors = { background: hex("#161616"), foreground: hex("#d6d2cc") };
	assert.equal(colors.terminalDefaultColors({ getFgAnsi: () => "" }), null, "null on pi versions without concrete colors");
});

test("diff highlighting uses the pi theme's syntax colors", async () => {
	const theme = colors.shikiThemeFromPiTheme(charcoal());
	assert.ok(theme);
	assert.equal(theme.type, "dark");
	assert.equal(theme.fg, "#d6d2cc", "plain code uses the terminal's text color");
	assert.equal(theme.bg, "#161616");
	assert.equal(colors.shikiThemeFromPiTheme(charcoal())?.name, theme.name, "same colors, same theme name");
	const other = new FakeTheme({ text: "", syntaxKeyword: "#ff0000" }, { userMessageBg: "" }, "truecolor", { appearance: "dark" });
	assert.notEqual(colors.shikiThemeFromPiTheme(other)?.name, theme.name, "new colors get a new name (Shiki caches by name)");
	assert.equal(colors.shikiThemeFromPiTheme({ getFgAnsi: () => "" }), null);

	const { codeToANSI } = await import("@shikijs/cli");
	const ansi = await codeToANSI("def f():\n    return 'x'  # done\n", "python", theme as any);
	assert.match(ansi, /\x1b\[38;2;139;161;181mdef/, "keyword in syntaxKeyword");
	assert.match(ansi, /\x1b\[38;2;148;165;126m'x'/, "string in syntaxString");
	assert.match(ansi, /\x1b\[38;2;160;157;153m# done/, "comment in syntaxComment");
});

test("focus-in asks the terminal for its color scheme, and focus events never reach the editor", () => {
	const input = new EventEmitter();
	const writes: string[] = [];
	let listener: ((data: string) => unknown) | undefined;
	let enabled = true;
	const ui = { onTerminalInput: (fn: (data: string) => unknown) => { listener = fn; return () => { listener = undefined; }; } };

	const io = { input, write: (d: string) => { writes.push(d); } };
	terminal.startFocusResync(ui, () => enabled, io);
	assert.deepEqual(writes, ["\x1b[?1004h"], "turns on focus reporting");

	input.emit("data", "\x1b[I");
	assert.deepEqual(writes.slice(1), ["\x1b[?996n"], "focus-in requests a color scheme report");
	input.emit("data", Buffer.from("\x1b[I"));
	assert.equal(writes.length, 2, "bursts are throttled");

	assert.deepEqual(listener?.("\x1b[I"), { consume: true });
	assert.deepEqual(listener?.("\x1b[O"), { consume: true });
	assert.equal(listener?.("a"), undefined, "ordinary input passes through");

	// Re-registering (session switch, /reload) keeps a single stdin listener.
	terminal.startFocusResync(ui, () => enabled, io);
	assert.equal(input.listenerCount("data"), 1);

	enabled = false;
	const before = writes.length;
	input.emit("data", "\x1b[I");
	assert.equal(writes.length, before, "nothing is requested while the option is off");
});
