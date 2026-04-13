import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { extname, relative } from "node:path";

import type {
	BashToolDetails,
	EditToolDetails,
	ExtensionAPI,
	GrepToolDetails,
	ReadToolDetails,
	Theme,
} from "@mariozechner/pi-coding-agent";
import {
	AssistantMessageComponent,
	createBashTool,
	createEditTool,
	createFindTool,
	createGrepTool,
	createLsTool,
	createReadTool,
	createWriteTool,
} from "@mariozechner/pi-coding-agent";
import { Box, Container, Markdown, Spacer, Text, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

import { codeToANSI } from "@shikijs/cli";
import * as Diff from "diff";
import type { BundledLanguage, BundledTheme } from "shiki";

const RESET = "\x1b[0m";
const BORDER_COLOR = "\x1b[38;5;238m";
const TRANSPARENT_BG = "\x1b[49m";
const TRANSPARENT_RESET = `${RESET}${TRANSPARENT_BG}`;
const ANSI_RE = /\x1b\[[0-9;]*m/g;
const PATCH_FLAG = Symbol.for("pi-claude-style-tools:patched-container-render");

let toolBackgroundMode: "default" | "transparent" | "outlines" = "outlines";

interface SettingsFile {
	toolBackground?: "default" | "transparent" | "outlines";
	readOutputMode?: "hidden" | "summary" | "preview";
	searchOutputMode?: "hidden" | "count" | "preview";
	mcpOutputMode?: "hidden" | "summary" | "preview";
	previewLines?: number;
	expandedPreviewMaxLines?: number;
	bashOutputMode?: "opencode" | "summary" | "preview";
	bashCollapsedLines?: number;
	showTruncationHints?: boolean;
	diffCollapsedLines?: number;
	diffTheme?: string;
	diffColors?: Record<string, string>;
}

function readSettings(): SettingsFile {
	const paths = [`${process.cwd()}/.pi/settings.json`, `${process.env.HOME ?? ""}/.pi/settings.json`];
	for (const path of paths) {
		try {
			if (!path || !existsSync(path)) continue;
			const raw = JSON.parse(readFileSync(path, "utf8"));
			if (raw && typeof raw === "object") return raw as SettingsFile;
		} catch {
			// ignore invalid settings files
		}
	}
	return {};
}

function writeSettingsKey(key: string, value: unknown): void {
	const home = process.env.HOME ?? "";
	if (!home) return;
	const dir = `${home}/.pi`;
	const path = `${dir}/settings.json`;
	let settings: Record<string, unknown> = {};
	try {
		if (existsSync(path)) settings = JSON.parse(readFileSync(path, "utf8")) ?? {};
	} catch { /* start fresh */ }
	settings[key] = value;
	try {
		mkdirSync(dir, { recursive: true });
		writeFileSync(path, JSON.stringify(settings, null, 2) + "\n");
	} catch { /* best effort */ }
}

let toolBackgroundOverride: "default" | "transparent" | "outlines" | null = null;

function syncToolBackgroundMode(): void {
	if (toolBackgroundOverride) {
		toolBackgroundMode = toolBackgroundOverride;
		return;
	}
	const settings = readSettings();
	// Backward compat: "border" was renamed to "outlines"
	const raw = settings.toolBackground === "border" ? "outlines" : settings.toolBackground;
	toolBackgroundMode = raw ?? "outlines";
}

function applyToolBackgroundMode(theme: unknown): void {
	syncToolBackgroundMode();
	if (toolBackgroundMode === "default") return;

	const themeAny = theme as any;
	if (themeAny.bgColors instanceof Map) {
		themeAny.bgColors.set("toolPendingBg", TRANSPARENT_BG);
		themeAny.bgColors.set("toolSuccessBg", TRANSPARENT_BG);
		themeAny.bgColors.set("toolErrorBg", TRANSPARENT_BG);
	} else if (themeAny.bgColors && typeof themeAny.bgColors === "object") {
		themeAny.bgColors.toolPendingBg = TRANSPARENT_BG;
		themeAny.bgColors.toolSuccessBg = TRANSPARENT_BG;
		themeAny.bgColors.toolErrorBg = TRANSPARENT_BG;
	}
}

function stripAnsi(text: string): string {
	return text.replace(ANSI_RE, "");
}

function isBlankLine(text: string): boolean {
	return stripAnsi(text).trim().length === 0;
}

function borderLine(width: number): string {
	return `${BORDER_COLOR}${"─".repeat(Math.max(1, width))}${TRANSPARENT_RESET}`;
}

function clampLineWidth(line: string, width: number): string {
	if (width <= 0) return "";
	return visibleWidth(line) > width ? truncateToWidth(line, width) : line;
}

function isToolExecutionLike(value: unknown): value is { toolName: string; toolCallId: string } {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Record<string, unknown>;
	return typeof candidate.toolName === "string" && typeof candidate.toolCallId === "string";
}

function patchGlobalToolBorders(): void {
	const proto = Container.prototype as any;
	if (proto[PATCH_FLAG]) return;

	const originalRender = proto.render;
	proto.render = function patchedContainerRender(width: number): string[] {
		const rendered = originalRender.call(this, width);
		if (!Array.isArray(rendered) || rendered.length === 0) return rendered;
		if (toolBackgroundMode === "default") return rendered;
		if (!isToolExecutionLike(this)) return rendered;

		// Strip leading/trailing blank lines for both border and transparent modes
		let start = 0;
		while (start < rendered.length && isBlankLine(rendered[start])) start++;
		let end = rendered.length - 1;
		while (end >= start && isBlankLine(rendered[end])) end--;
		if (start > end) return rendered;

		const core = rendered.slice(start, end + 1).map((line) => clampLineWidth(line, width));
		const spacerLine = " ".repeat(width);

		if (toolBackgroundMode === "outlines") {
			const ruleWidth = Math.max(1, width);
			return [spacerLine, borderLine(ruleWidth), ...core, borderLine(ruleWidth)];
		}

		// transparent: just the core content with top spacer
		return [spacerLine, ...core];
	};

	proto[PATCH_FLAG] = true;
}

function summarizeText(text: string, max = 60): string {
	const oneLine = text.replace(/\n/g, " ").trim();
	if (oneLine.length <= max) return oneLine;
	return `${oneLine.slice(0, Math.max(0, max - 3))}...`;
}

const ASSISTANT_PATCH_FLAG = Symbol.for("pi-claude-style-tools:patched-assistant-message");

class DottedParagraph {
	private md: InstanceType<typeof Markdown>;

	constructor(text: string, markdownTheme: ConstructorParameters<typeof Markdown>[3]) {
		this.md = new Markdown(text, 0, 0, markdownTheme);
	}

	invalidate(): void {
		this.md.invalidate();
	}

	render(width: number): string[] {
		// " ● " = 1 margin + dot + space = 3 visible chars
		const PREFIX_W = 3;
		if (width <= PREFIX_W) return [" ● "];
		const lines = this.md.render(width - PREFIX_W);
		let dotPlaced = false;
		return lines.map((line: string) => {
			if (!dotPlaced && stripAnsi(line).trim()) {
				dotPlaced = true;
				return ` ● ${line}`;
			}
			return `   ${line}`;
		});
	}
}

class ThinkingParagraph {
	private md: InstanceType<typeof Markdown>;

	constructor(
		text: string,
		_markdownTheme: ConstructorParameters<typeof Markdown>[3],
		_defaultTextStyle?: ConstructorParameters<typeof Markdown>[4],
	) {
		// Use a plain theme that strips all color/formatting from thinking blocks.
		// Code blocks, headings, etc. render as plain dimmed text.
		// We use identity functions (passthrough) so only the defaultTextStyle
		// (italic) applies uniformly. No extra formatting escapes that could
		// create brightness differences.
		const id = (s: string) => s;
		const plainTheme: ConstructorParameters<typeof Markdown>[3] = {
			heading: id,
			link: id,
			linkUrl: id,
			code: id,
			codeBlock: id,
			codeBlockBorder: id,
			quote: id,
			quoteBorder: id,
			hr: id,
			listBullet: id,
			bold: id,
			italic: id,
			strikethrough: id,
			underline: id,
			// Override code highlighting to return plain lines (no syntax colors)
			highlightCode: (code: string, _lang?: string) => code.split("\n"),
		};
		// Keep italic + dim as the base style for all text
		const plainStyle: ConstructorParameters<typeof Markdown>[4] = {
			italic: true,
		};
		this.md = new Markdown(text, 0, 0, plainTheme, plainStyle);
	}

	invalidate(): void {
		this.md.invalidate();
	}

	render(width: number): string[] {
		// " ✽ " = 1 margin + symbol + space = 3 visible chars
		const PREFIX_W = 3;
		if (width <= PREFIX_W) return [" ✽ "];
		const lines = this.md.render(width - PREFIX_W);
		let symbolPlaced = false;
		return lines.map((line: string) => {
			if (!symbolPlaced && stripAnsi(line).trim()) {
				symbolPlaced = true;
				return ` ✽ ${line}`;
			}
			return `   ${line}`;
		});
	}
}

function patchAssistantMessages(): void {
	const proto = AssistantMessageComponent.prototype as any;
	if (proto[ASSISTANT_PATCH_FLAG]) return;
	const originalUpdateContent = proto.updateContent;
	proto.updateContent = function patchedUpdateContent(message: any) {
		if (!message || !Array.isArray(message.content)) {
			return originalUpdateContent.call(this, message);
		}
		// Call original to build all children (text, thinking, spacers, errors)
		originalUpdateContent.call(this, message);
		// Replace text-block Markdown children with DottedParagraph wrappers
		const container = (this as any).contentContainer;
		if (!container?.children) return;
		const mdTheme = (this as any).markdownTheme;
		for (let i = container.children.length - 1; i >= 0; i--) {
			const child = container.children[i];
			if (child instanceof Markdown) {
				const text = (child as any).text;
				if (!text) continue;
				const isThinking = !!(child as any).defaultTextStyle?.italic;
				if (isThinking) {
					const style = (child as any).defaultTextStyle;
					container.children[i] = new ThinkingParagraph(text, mdTheme, style);
				} else {
					container.children[i] = new DottedParagraph(text, mdTheme);
				}
			}
		}
	};
	proto[ASSISTANT_PATCH_FLAG] = true;
}

function shortPath(cwd: string, filePath: string): string {
	if (!filePath) return "";
	const rel = relative(cwd, filePath);
	if (!rel.startsWith("..") && !rel.startsWith("/")) return rel || ".";
	const home = process.env.HOME ?? "";
	return home ? filePath.replace(home, "~") : filePath;
}

// ---------------------------------------------------------------------------
// Status dot — flickers green/gray while pending
// ---------------------------------------------------------------------------

function isBlinkOn(): boolean {
	return Math.floor(Date.now() / 500) % 2 === 0;
}

function toolHeader(tool: string, summary: string, theme: Theme, prefix = ""): string {
	const label = theme.fg("toolTitle", theme.bold(tool));
	const suffix = summary ? ` ${theme.fg("accent", summary)}` : "";
	return `${prefix}${label}${suffix}`;
}

function setToolStatus(ctx: any, status: "pending" | "success" | "error"): void {
	ctx.state._toolStatus = status;
}

function toolStatusDot(ctx: any, theme: Theme): string {
	const status = ctx.state?._toolStatus as "pending" | "success" | "error" | undefined;
	if (status === "success") return `${theme.fg("success", "●")} `;
	if (status === "error") return `${theme.fg("error", "●")} `;
	setupBlinkTimer(ctx);
	return `${blinkDot(ctx, theme)} `;
}

// ---------------------------------------------------------------------------
// Branch connector — visual tree from header to output
// ---------------------------------------------------------------------------

function branchIndent(text: string): string {
	return `   ${text}`;
}

function branchLead(text: string): string {
	return `${FG_RULE}└─${TRANSPARENT_RESET} ${text}`;
}

function withBranch(content: string, _theme: Theme, _isError = false): string {
	if (!content || !content.trim()) return "";
	const lines = content.split("\n");
	const first = lines[0] ?? "";
	if (lines.length === 1) return branchLead(first);
	const rest = lines.slice(1).map((line) => branchIndent(line));
	return `${branchLead(first)}\n${rest.join("\n")}`;
}

// ---------------------------------------------------------------------------
// Blink timer for partial (running) states
// ---------------------------------------------------------------------------

function setupBlinkTimer(ctx: any): void {
	if (ctx.state._blinkTimer) return;
	ctx.state._blinkPhase = true;
	const timer = setInterval(() => {
		ctx.state._blinkPhase = !ctx.state._blinkPhase;
		try { ctx.invalidate(); } catch { /* noop */ }
	}, 500);
	ctx.state._blinkTimer = timer;
}

function clearBlinkTimer(ctx: any): void {
	if (ctx.state._blinkTimer) {
		clearInterval(ctx.state._blinkTimer);
		ctx.state._blinkTimer = null;
	}
}

function blinkDot(ctx: any, theme: Theme): string {
	return ctx.state._blinkPhase ? theme.fg("success", "●") : theme.fg("muted", "○");
}

// ---------------------------------------------------------------------------
// File icons — Nerd Font glyphs (requires Nerd Font terminal)
// ---------------------------------------------------------------------------

const NF_DIR = `\x1b[38;2;100;140;220m\ue5ff\x1b[0m`;
const NF_DEFAULT = `\x1b[38;2;80;80;80m\uf15b\x1b[0m`;

const EXT_ICON: Record<string, string> = {
	ts: `\x1b[38;2;49;120;198m\ue628\x1b[0m`,
	tsx: `\x1b[38;2;49;120;198m\ue7ba\x1b[0m`,
	js: `\x1b[38;2;241;224;90m\ue74e\x1b[0m`,
	jsx: `\x1b[38;2;97;218;251m\ue7ba\x1b[0m`,
	py: `\x1b[38;2;55;118;171m\ue73c\x1b[0m`,
	rs: `\x1b[38;2;222;165;132m\ue7a8\x1b[0m`,
	go: `\x1b[38;2;0;173;216m\ue724\x1b[0m`,
	java: `\x1b[38;2;204;62;68m\ue738\x1b[0m`,
	rb: `\x1b[38;2;204;52;45m\ue739\x1b[0m`,
	swift: `\x1b[38;2;255;172;77m\ue755\x1b[0m`,
	c: `\x1b[38;2;85;154;211m\ue61e\x1b[0m`,
	cpp: `\x1b[38;2;85;154;211m\ue61d\x1b[0m`,
	html: `\x1b[38;2;228;77;38m\ue736\x1b[0m`,
	css: `\x1b[38;2;66;165;245m\ue749\x1b[0m`,
	scss: `\x1b[38;2;207;100;154m\ue749\x1b[0m`,
	vue: `\x1b[38;2;65;184;131m\ue6a0\x1b[0m`,
	svelte: `\x1b[38;2;255;62;0m\ue697\x1b[0m`,
	json: `\x1b[38;2;241;224;90m\ue60b\x1b[0m`,
	yaml: `\x1b[38;2;160;116;196m\ue6a8\x1b[0m`,
	yml: `\x1b[38;2;160;116;196m\ue6a8\x1b[0m`,
	toml: `\x1b[38;2;160;116;196m\ue6b2\x1b[0m`,
	md: `\x1b[38;2;66;165;245m\ue73e\x1b[0m`,
	sh: `\x1b[38;2;137;180;130m\ue795\x1b[0m`,
	bash: `\x1b[38;2;137;180;130m\ue795\x1b[0m`,
	zsh: `\x1b[38;2;137;180;130m\ue795\x1b[0m`,
	lua: `\x1b[38;2;81;160;207m\ue620\x1b[0m`,
	php: `\x1b[38;2;137;147;186m\ue73d\x1b[0m`,
	sql: `\x1b[38;2;218;218;218m\ue706\x1b[0m`,
	xml: `\x1b[38;2;228;77;38m\ue619\x1b[0m`,
	graphql: `\x1b[38;2;224;51;144m\ue662\x1b[0m`,
	dockerfile: `\x1b[38;2;56;152;236m\ue7b0\x1b[0m`,
	lock: `\x1b[38;2;130;130;130m\uf023\x1b[0m`,
	png: `\x1b[38;2;160;116;196m\uf1c5\x1b[0m`,
	jpg: `\x1b[38;2;160;116;196m\uf1c5\x1b[0m`,
	svg: `\x1b[38;2;255;180;50m\uf1c5\x1b[0m`,
	gif: `\x1b[38;2;160;116;196m\uf1c5\x1b[0m`,
};

const NAME_ICON: Record<string, string> = {
	"package.json": `\x1b[38;2;137;180;130m\ue71e\x1b[0m`,
	"tsconfig.json": `\x1b[38;2;49;120;198m\ue628\x1b[0m`,
	".gitignore": `\x1b[38;2;222;165;132m\ue702\x1b[0m`,
	"dockerfile": `\x1b[38;2;56;152;236m\ue7b0\x1b[0m`,
	"makefile": `\x1b[38;2;130;130;130m\ue615\x1b[0m`,
	"readme.md": `\x1b[38;2;66;165;245m\ue73e\x1b[0m`,
	"license": `\x1b[38;2;218;218;218m\ue60a\x1b[0m`,
};

function fileIcon(fp: string): string {
	const base = fp.split('/').pop()?.toLowerCase() ?? '';
	if (NAME_ICON[base]) return `${NAME_ICON[base]} `;
	const ext = base.includes('.') ? base.split('.').pop() ?? '' : '';
	return EXT_ICON[ext] ? `${EXT_ICON[ext]} ` : `${NF_DEFAULT} `;
}

function dirIcon(): string {
	return `${NF_DIR} `;
}

function lineCount(text: string): number {
	if (!text) return 0;
	return text.split("\n").length;
}

function makeText(last: unknown, text: string): Text {
	const component = last instanceof Text ? last : new Text("", 0, 0);
	component.setText(text);
	return component;
}

function previewLimit(): number {
	const value = readSettings().previewLines;
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 8;
}

function expandedPreviewLimit(): number {
	const value = readSettings().expandedPreviewMaxLines;
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 4000;
}

function bashCollapsedLimit(): number {
	const value = readSettings().bashCollapsedLines;
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 10;
}

function diffCollapsedLimit(): number {
	const value = readSettings().diffCollapsedLines;
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 24;
}

function collapsedPreviewCount(expanded: boolean, fallback: number): number {
	return expanded ? expandedPreviewLimit() : fallback;
}

function buildPreviewText(lines: string[], expanded: boolean, theme: Theme, fallbackCollapsed = 8): string {
	if (lines.length === 0) return theme.fg("muted", "(no output)");
	const maxLines = collapsedPreviewCount(expanded, fallbackCollapsed);
	const shown = lines.slice(0, maxLines);
	let text = shown.join("\n");
	const remaining = lines.length - shown.length;
	if (remaining > 0) {
		text += `\n${theme.fg("muted", `... (${remaining} more lines${expanded ? "" : " • Ctrl+O to expand"})`)}`;
	}
	if (expanded && lines.length > maxLines) {
		text += `\n${theme.fg("warning", `(display capped at ${maxLines} lines)`)}`;
	}
	return text;
}

// ===========================================================================
// Diff rendering — adapted from /tmp/pi-diff
// ===========================================================================

interface DiffPreset {
	name: string;
	description: string;
	shikiTheme?: string;
	bgAdd?: string;
	bgDel?: string;
	bgAddHighlight?: string;
	bgDelHighlight?: string;
	bgGutterAdd?: string;
	bgGutterDel?: string;
	bgEmpty?: string;
	fgAdd?: string;
	fgDel?: string;
	fgDim?: string;
	fgLnum?: string;
	fgRule?: string;
	fgStripe?: string;
	fgSafeMuted?: string;
}

interface DiffUserConfig {
	diffTheme?: string;
	diffColors?: Record<string, string>;
}

const DIFF_PRESETS: Record<string, DiffPreset> = {
	default: {
		name: "default",
		description: "Original pi-diff colors",
		bgAdd: "#162620",
		bgDel: "#2d1919",
		bgAddHighlight: "#234b32",
		bgDelHighlight: "#502323",
		bgGutterAdd: "#12201a",
		bgGutterDel: "#261616",
		bgEmpty: "#121212",
		fgDim: "#505050",
		fgLnum: "#646464",
		fgRule: "#323232",
		fgStripe: "#282828",
		fgSafeMuted: "#8b949e",
	},
	midnight: {
		name: "midnight",
		description: "Subtle tints for black backgrounds",
		bgAdd: "#0d1a12",
		bgDel: "#1a0d0d",
		bgAddHighlight: "#1a3825",
		bgDelHighlight: "#381a1a",
		bgGutterAdd: "#091208",
		bgGutterDel: "#120908",
		bgEmpty: "#080808",
		fgDim: "#404040",
		fgLnum: "#505050",
		fgRule: "#282828",
		fgStripe: "#1e1e1e",
		fgSafeMuted: "#8b949e",
	},
	neon: {
		name: "neon",
		description: "Higher contrast backgrounds",
		bgAdd: "#1a3320",
		bgDel: "#331a16",
		bgAddHighlight: "#2d5c3a",
		bgDelHighlight: "#5c2d2d",
		bgGutterAdd: "#142818",
		bgGutterDel: "#28120e",
		bgEmpty: "#141414",
		fgDim: "#606060",
		fgLnum: "#787878",
		fgRule: "#404040",
		fgStripe: "#303030",
		fgSafeMuted: "#9da5ae",
	},
};

function loadDiffConfig(): DiffUserConfig {
	const settings = readSettings();
	return { diffTheme: settings.diffTheme, diffColors: settings.diffColors };
}

function parseAnsiRgb(ansi: string): { r: number; g: number; b: number } | null {
	const esc = "\u001b";
	const m = ansi.match(new RegExp(`${esc}\\[(?:38|48);2;(\\d+);(\\d+);(\\d+)m`));
	return m ? { r: +m[1], g: +m[2], b: +m[3] } : null;
}

function hexToBgAnsi(hex: string): string {
	if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return "";
	const r = Number.parseInt(hex.slice(1, 3), 16);
	const g = Number.parseInt(hex.slice(3, 5), 16);
	const b = Number.parseInt(hex.slice(5, 7), 16);
	return `\x1b[48;2;${r};${g};${b}m`;
}

function hexToFgAnsi(hex: string): string {
	if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return "";
	const r = Number.parseInt(hex.slice(1, 3), 16);
	const g = Number.parseInt(hex.slice(3, 5), 16);
	const b = Number.parseInt(hex.slice(5, 7), 16);
	return `\x1b[38;2;${r};${g};${b}m`;
}

let DIFF_THEME: BundledTheme = (process.env.DIFF_THEME as BundledTheme | undefined) ?? "github-dark";

const SPLIT_MIN_WIDTH = 150;
const SPLIT_MIN_CODE_WIDTH = 60;
const SPLIT_MAX_WRAP_RATIO = 0.2;
const SPLIT_MAX_WRAP_LINES = 8;
const MAX_TERM_WIDTH = 210;
const DEFAULT_TERM_WIDTH = 200;
const MAX_PREVIEW_LINES = 60;
const MAX_RENDER_LINES = 150;
const MAX_HL_CHARS = 80_000;
const CACHE_LIMIT = 192;
const WORD_DIFF_MIN_SIM = 0.15;
const MAX_WRAP_ROWS_WIDE = 3;
const MAX_WRAP_ROWS_MED = 2;
const MAX_WRAP_ROWS_NARROW = 1;

let D_RST = "\x1b[0m";
const D_BOLD = "\x1b[1m";
const D_DIM = "\x1b[2m";

// Diff backgrounds — defaults are transparent; autoDeriveBgFromTheme fills them
// using pi-tool-display's mix ratios against the theme's toolSuccessBg.
let BG_ADD = "\x1b[49m";
let BG_DEL = "\x1b[49m";
let BG_ADD_W = "\x1b[49m";
let BG_DEL_W = "\x1b[49m";
let BG_GUTTER_ADD = "\x1b[49m";
let BG_GUTTER_DEL = "\x1b[49m";
let BG_EMPTY = "\x1b[49m";
let BG_BASE = "\x1b[49m";

let FG_ADD = "\x1b[38;2;100;180;120m";
let FG_DEL = "\x1b[38;2;200;100;100m";
let FG_DIM = "\x1b[38;2;80;80;80m";
let FG_LNUM = "\x1b[38;2;100;100;100m";
let FG_RULE = "\x1b[38;2;50;50;50m";
let FG_SAFE_MUTED = "\x1b[38;2;139;148;158m";
let FG_STRIPE = "\x1b[38;2;40;40;40m";

let DIVIDER = `${FG_RULE}│${D_RST}`;

interface DiffColors {
	fgAdd: string;
	fgDel: string;
	fgCtx: string;
}

let DEFAULT_DIFF_COLORS: DiffColors = { fgAdd: FG_ADD, fgDel: FG_DEL, fgCtx: FG_DIM };
let autoDerivePending = true;
let hasExplicitBgConfig = false;

function mixBg(
	base: { r: number; g: number; b: number },
	accent: { r: number; g: number; b: number },
	intensity: number,
): string {
	const r = Math.round(base.r + (accent.r - base.r) * intensity);
	const g = Math.round(base.g + (accent.g - base.g) * intensity);
	const b = Math.round(base.b + (accent.b - base.b) * intensity);
	return `\x1b[48;2;${r};${g};${b}m`;
}

// pi-tool-display tint targets for diff palette derivation
const ADDITION_TINT_TARGET = { r: 84, g: 190, b: 118 };
const DELETION_TINT_TARGET = { r: 232, g: 95, b: 122 };
// Fallback base that matches most dark themes (NOT black)
const FALLBACK_BASE_BG = { r: 32, g: 35, b: 42 };
const UNIVERSAL_DIFF_ADD_FG = { r: 110, g: 210, b: 130 };
const UNIVERSAL_DIFF_DEL_FG = { r: 225, g: 110, b: 110 };

function mixRgb(
	a: { r: number; g: number; b: number },
	b: { r: number; g: number; b: number },
	ratio: number,
): { r: number; g: number; b: number } {
	return {
		r: a.r + (b.r - a.r) * ratio,
		g: a.g + (b.g - a.g) * ratio,
		b: a.b + (b.b - a.b) * ratio,
	};
}

function rgbToBgAnsi(c: { r: number; g: number; b: number }): string {
	return `\x1b[48;2;${Math.round(c.r)};${Math.round(c.g)};${Math.round(c.b)}m`;
}

function autoDeriveBgFromTheme(_theme: any): void {
	// Universal diff palette: stable red/green across dark themes.
	const base = FALLBACK_BASE_BG;
	const addFg = UNIVERSAL_DIFF_ADD_FG;
	const delFg = UNIVERSAL_DIFF_DEL_FG;
	const addTint = mixRgb(addFg, ADDITION_TINT_TARGET, 0.35);
	const delTint = mixRgb(delFg, DELETION_TINT_TARGET, 0.65);

	FG_ADD = `\x1b[38;2;${Math.round(addFg.r)};${Math.round(addFg.g)};${Math.round(addFg.b)}m`;
	FG_DEL = `\x1b[38;2;${Math.round(delFg.r)};${Math.round(delFg.g)};${Math.round(delFg.b)}m`;
	BG_ADD = rgbToBgAnsi(mixRgb(base, addTint, 0.24));
	BG_DEL = rgbToBgAnsi(mixRgb(base, delTint, 0.12));
	BG_ADD_W = rgbToBgAnsi(mixRgb(base, addTint, 0.44));
	BG_DEL_W = rgbToBgAnsi(mixRgb(base, delTint, 0.26));
	BG_GUTTER_ADD = rgbToBgAnsi(mixRgb(base, addTint, 0.14));
	BG_GUTTER_DEL = rgbToBgAnsi(mixRgb(base, delTint, 0.08));
	BG_EMPTY = TRANSPARENT_BG;
	BG_BASE = TRANSPARENT_BG;
	D_RST = TRANSPARENT_RESET;
	DIVIDER = `${FG_RULE}│${D_RST}`;
	DEFAULT_DIFF_COLORS = { fgAdd: FG_ADD, fgDel: FG_DEL, fgCtx: FG_DIM };
}

function applyDiffPalette(): void {
	const config = loadDiffConfig();
	const preset = config.diffTheme ? DIFF_PRESETS[config.diffTheme] : null;
	if (preset) hasExplicitBgConfig = true;
	const overrides = config.diffColors ?? {};
	if (Object.keys(overrides).length > 0) hasExplicitBgConfig = true;

	const applyBg = (key: string, presetValue: string | undefined, set: (value: string) => void) => {
		const hex = overrides[key] ?? presetValue;
		if (!hex) return;
		const ansi = hexToBgAnsi(hex);
		if (ansi) set(ansi);
	};
	const applyFg = (key: string, presetValue: string | undefined, set: (value: string) => void) => {
		const hex = overrides[key] ?? presetValue;
		if (!hex) return;
		const ansi = hexToFgAnsi(hex);
		if (ansi) set(ansi);
	};

	applyBg("bgAdd", preset?.bgAdd, (v) => {
		BG_ADD = v;
	});
	applyBg("bgDel", preset?.bgDel, (v) => {
		BG_DEL = v;
	});
	applyBg("bgAddHighlight", preset?.bgAddHighlight, (v) => {
		BG_ADD_W = v;
	});
	applyBg("bgDelHighlight", preset?.bgDelHighlight, (v) => {
		BG_DEL_W = v;
	});
	applyBg("bgGutterAdd", preset?.bgGutterAdd, (v) => {
		BG_GUTTER_ADD = v;
	});
	applyBg("bgGutterDel", preset?.bgGutterDel, (v) => {
		BG_GUTTER_DEL = v;
	});
	applyBg("bgEmpty", preset?.bgEmpty, (v) => {
		BG_EMPTY = v;
	});

	applyFg("fgAdd", preset?.fgAdd, (v) => {
		FG_ADD = v;
	});
	applyFg("fgDel", preset?.fgDel, (v) => {
		FG_DEL = v;
	});
	applyFg("fgDim", preset?.fgDim, (v) => {
		FG_DIM = v;
	});
	applyFg("fgLnum", preset?.fgLnum, (v) => {
		FG_LNUM = v;
	});
	applyFg("fgRule", preset?.fgRule, (v) => {
		FG_RULE = v;
	});
	applyFg("fgStripe", preset?.fgStripe, (v) => {
		FG_STRIPE = v;
	});
	applyFg("fgSafeMuted", preset?.fgSafeMuted, (v) => {
		FG_SAFE_MUTED = v;
	});

	const shiki = overrides.shikiTheme ?? preset?.shikiTheme;
	if (shiki) DIFF_THEME = shiki as BundledTheme;

	DIVIDER = `${FG_RULE}│${D_RST}`;
	DEFAULT_DIFF_COLORS = { fgAdd: FG_ADD, fgDel: FG_DEL, fgCtx: FG_DIM };
	autoDerivePending = true;
}

function resolveDiffColors(theme?: any): DiffColors {
	if (autoDerivePending && theme?.getFgAnsi) {
		autoDeriveBgFromTheme(theme);
		autoDerivePending = false;
	}
	return DEFAULT_DIFF_COLORS;
}

interface DiffLine {
	type: "add" | "del" | "ctx" | "sep";
	oldNum: number | null;
	newNum: number | null;
	content: string;
}

interface ParsedDiff {
	lines: DiffLine[];
	added: number;
	removed: number;
	chars: number;
}

function diffStrip(value: string): string {
	return value.replace(ANSI_RE, "");
}

function tabs(text: string): string {
	return text.replace(/\t/g, "  ");
}

function termW(): number {
	const raw =
		process.stdout.columns ||
		(process.stderr as any).columns ||
		Number.parseInt(process.env.COLUMNS ?? "", 10) ||
		DEFAULT_TERM_WIDTH;
	return Math.max(80, Math.min(raw - 4, MAX_TERM_WIDTH));
}

function adaptiveWrapRows(tw?: number): number {
	const width = tw ?? termW();
	if (width >= 180) return MAX_WRAP_ROWS_WIDE;
	if (width >= 120) return MAX_WRAP_ROWS_MED;
	return MAX_WRAP_ROWS_NARROW;
}

function fit(value: string, width: number): string {
	if (width <= 0) return "";
	const plain = diffStrip(value);
	if (plain.length <= width) return value + " ".repeat(width - plain.length);
	const showWidth = width > 2 ? width - 1 : width;
	let vis = 0;
	let i = 0;
	while (i < value.length && vis < showWidth) {
		if (value[i] === "\x1b") {
			const end = value.indexOf("m", i);
			if (end !== -1) {
				i = end + 1;
				continue;
			}
		}
		vis++;
		i++;
	}
	return width > 2 ? `${value.slice(0, i)}${D_RST}${FG_DIM}›${D_RST}` : `${value.slice(0, i)}${D_RST}`;
}

function ansiState(text: string): string {
	const matches = text.match(/\x1b\[[0-9;]*m/g) ?? [];
	let fg = "";
	let bg = "";
	for (const seq of matches) {
		const params = seq.slice(2, -1);
		if (params === "0") {
			fg = "";
			bg = "";
		} else if (params === "39") {
			fg = "";
		} else if (params.startsWith("38;")) {
			fg = seq;
		} else if (params.startsWith("48;")) {
			bg = seq;
		}
	}
	return bg + fg;
}

function normalizeShikiContrast(ansi: string): string {
	return ansi.replace(/\x1b\[([0-9;]*)m/g, (seq, params: string) => {
		if (params === "30" || params === "90" || params === "38;5;0" || params === "38;5;8") return FG_SAFE_MUTED;
		if (!params.startsWith("38;2;")) return seq;
		const parts = params.split(";").map(Number);
		if (parts.length !== 5 || parts.some((n) => !Number.isFinite(n))) return seq;
		const [, , r, g, b] = parts;
		const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
		return luminance < 72 ? FG_SAFE_MUTED : seq;
	});
}

function wrapAnsi(text: string, width: number, maxRows = adaptiveWrapRows(), fillBg = ""): string[] {
	if (width <= 0) return [""];
	const plain = diffStrip(text);
	if (plain.length <= width) {
		const pad = width - plain.length;
		return pad > 0 ? [text + fillBg + " ".repeat(pad) + (fillBg ? D_RST : "")] : [text];
	}

	const rows: string[] = [];
	let row = "";
	let vis = 0;
	let i = 0;
	let onLastRow = false;
	let effectiveWidth = width;

	while (i < text.length) {
		if (!onLastRow && rows.length >= maxRows - 1) {
			onLastRow = true;
			effectiveWidth = width > 2 ? width - 1 : width;
		}
		if (text[i] === "\x1b") {
			const end = text.indexOf("m", i);
			if (end !== -1) {
				row += text.slice(i, end + 1);
				i = end + 1;
				continue;
			}
		}
		if (vis >= effectiveWidth) {
			if (onLastRow) {
				let hasMore = false;
				for (let j = i; j < text.length; j++) {
					if (text[j] === "\x1b") {
						const e2 = text.indexOf("m", j);
						if (e2 !== -1) {
							j = e2;
							continue;
						}
					}
					hasMore = true;
					break;
				}
				if (hasMore && width > 2) row += `${D_RST}${FG_DIM}›${D_RST}`;
				else row += fillBg + " ".repeat(Math.max(0, width - vis)) + D_RST;
				rows.push(row);
				return rows;
			}
			const state = ansiState(row);
			rows.push(row + D_RST);
			row = state + fillBg;
			vis = 0;
			if (rows.length >= maxRows - 1) {
				onLastRow = true;
				effectiveWidth = width > 2 ? width - 1 : width;
			}
		}
		row += text[i];
		vis++;
		i++;
	}

	if (row.length > 0 || rows.length === 0) {
		rows.push(row + fillBg + " ".repeat(Math.max(0, width - vis)) + D_RST);
	}
	return rows;
}

function lnum(n: number | null, width: number, fg = FG_LNUM): string {
	if (n === null) return " ".repeat(width);
	const value = String(n);
	return `${fg}${" ".repeat(Math.max(0, width - value.length))}${value}${D_RST}`;
}

function stripes(width: number): string {
	return BG_BASE + FG_STRIPE + "╱".repeat(width) + D_RST;
}

function renderDiffStatBar(added: number, removed: number, width = termW()): string {
	const total = added + removed;
	if (total === 0 || width < 20) return "";
	const slots = Math.max(8, Math.min(20, Math.floor(width / 14)));
	let addSlots = Math.max(0, Math.min(slots, Math.round((added / total) * slots)));
	if (added > 0 && addSlots === 0) addSlots = 1;
	if (removed > 0 && addSlots >= slots) addSlots = slots - 1;
	const removeSlots = Math.max(0, slots - addSlots);
	const addBar = addSlots > 0 ? `${FG_ADD}${"━".repeat(addSlots)}${D_RST}` : "";
	const removeBar = removeSlots > 0 ? `${FG_DEL}${"━".repeat(removeSlots)}${D_RST}` : "";
	return `${FG_DIM}[${D_RST}${addBar}${removeBar}${FG_DIM}]${D_RST}`;
}

function summarizeDiff(added: number, removed: number): string {
	const parts: string[] = [];
	if (added > 0) parts.push(`${FG_ADD}+${added}${D_RST}`);
	if (removed > 0) parts.push(`${FG_DEL}-${removed}${D_RST}`);
	if (!parts.length) return `${FG_DIM}no changes${D_RST}`;
	const bar = renderDiffStatBar(added, removed);
	return bar ? `${parts.join(" ")} ${bar}` : parts.join(" ");
}

function diffSummaryWithMeta(added: number, removed: number, hunks: number, mode: string): string {
	const base = summarizeDiff(added, removed);
	const extras: string[] = [];
	if (hunks > 0) extras.push(`${FG_DIM}${hunks} hunk${hunks === 1 ? "" : "s"}${D_RST}`);
	if (mode) extras.push(`${FG_DIM}${mode}${D_RST}`);
	return extras.length ? `${base} ${FG_DIM}•${D_RST} ${extras.join(` ${FG_DIM}•${D_RST} `)}` : base;
}

function collapsedDiffHint(remainingLines: number, hiddenHunks: number): string {
	const width = termW();
	const candidates = [
		`… (${remainingLines} more diff lines${hiddenHunks > 0 ? ` • ${hiddenHunks} more hunks` : ""} • Ctrl+O to expand)`,
		`… (${remainingLines} more lines${hiddenHunks > 0 ? ` • ${hiddenHunks} hunks` : ""})`,
		`… (+${remainingLines}${hiddenHunks > 0 ? ` • +${hiddenHunks}h` : ""})`,
		"…",
	];
	for (const candidate of candidates) {
		if (visibleWidth(candidate) <= width) return candidate;
	}
	return truncateToWidth("…", width, "");
}

function diffRule(width: number): string {
	return `${BG_BASE}${FG_RULE}${"─".repeat(width)}${D_RST}`;
}

function shouldUseSplit(diff: ParsedDiff, tw: number, maxRows = MAX_PREVIEW_LINES): boolean {
	if (!diff.lines.length) return false;
	if (tw < SPLIT_MIN_WIDTH) return false;
	const nw = Math.max(2, String(Math.max(...diff.lines.map((l) => l.oldNum ?? l.newNum ?? 0), 0)).length);
	const half = Math.floor((tw - 1) / 2);
	const gw = nw + 5;
	const cw = Math.max(12, half - gw);
	if (cw < SPLIT_MIN_CODE_WIDTH) return false;
	const vis = diff.lines.slice(0, maxRows);
	let contentLines = 0;
	let wrapCandidates = 0;
	for (const line of vis) {
		if (line.type === "sep") continue;
		contentLines++;
		if (tabs(line.content).length > cw) wrapCandidates++;
	}
	if (contentLines === 0) return true;
	const wrapRatio = wrapCandidates / contentLines;
	if (wrapCandidates >= SPLIT_MAX_WRAP_LINES) return false;
	if (wrapRatio >= SPLIT_MAX_WRAP_RATIO) return false;
	return true;
}

const EXT_LANG: Record<string, BundledLanguage> = {
	ts: "typescript",
	tsx: "tsx",
	js: "javascript",
	jsx: "jsx",
	mjs: "javascript",
	cjs: "javascript",
	py: "python",
	rb: "ruby",
	rs: "rust",
	go: "go",
	java: "java",
	c: "c",
	cpp: "cpp",
	h: "c",
	hpp: "cpp",
	cs: "csharp",
	swift: "swift",
	kt: "kotlin",
	html: "html",
	css: "css",
	scss: "scss",
	json: "json",
	yaml: "yaml",
	yml: "yaml",
	toml: "toml",
	md: "markdown",
	sql: "sql",
	sh: "bash",
	bash: "bash",
	zsh: "bash",
	lua: "lua",
	php: "php",
	dart: "dart",
	xml: "xml",
	graphql: "graphql",
	svelte: "svelte",
	vue: "vue",
};

function lang(filePath: string): BundledLanguage | undefined {
	return EXT_LANG[extname(filePath).slice(1).toLowerCase()];
}

void codeToANSI("", "typescript", DIFF_THEME).catch(() => {});

const hlCache = new Map<string, string[]>();

function touchCache(key: string, value: string[]): string[] {
	hlCache.delete(key);
	hlCache.set(key, value);
	while (hlCache.size > CACHE_LIMIT) {
		const first = hlCache.keys().next().value;
		if (first === undefined) break;
		hlCache.delete(first);
	}
	return value;
}

async function hlBlock(code: string, language: BundledLanguage | undefined): Promise<string[]> {
	if (!code) return [""];
	if (!language || code.length > MAX_HL_CHARS) return code.split("\n");
	const key = `${DIFF_THEME}\0${language}\0${code}`;
	const hit = hlCache.get(key);
	if (hit) return touchCache(key, hit);
	try {
		const ansi = normalizeShikiContrast(await codeToANSI(code, language, DIFF_THEME));
		const out = (ansi.endsWith("\n") ? ansi.slice(0, -1) : ansi).split("\n");
		return touchCache(key, out);
	} catch {
		return code.split("\n");
	}
}

function parseDiff(oldContent: string, newContent: string, ctxLines = 3): ParsedDiff {
	const patch = Diff.structuredPatch("", "", oldContent, newContent, "", "", { context: ctxLines });
	const lines: DiffLine[] = [];
	let added = 0;
	let removed = 0;
	for (let hi = 0; hi < patch.hunks.length; hi++) {
		if (hi > 0) {
			const prev = patch.hunks[hi - 1];
			const gap = patch.hunks[hi].oldStart - (prev.oldStart + prev.oldLines);
			lines.push({ type: "sep", oldNum: null, newNum: gap > 0 ? gap : null, content: "" });
		}
		const hunk = patch.hunks[hi];
		let oldLine = hunk.oldStart;
		let newLine = hunk.newStart;
		for (const raw of hunk.lines) {
			if (raw === "\\ No newline at end of file") continue;
			const ch = raw[0];
			const text = raw.slice(1);
			if (ch === "+") {
				lines.push({ type: "add", oldNum: null, newNum: newLine++, content: text });
				added++;
			} else if (ch === "-") {
				lines.push({ type: "del", oldNum: oldLine++, newNum: null, content: text });
				removed++;
			} else {
				lines.push({ type: "ctx", oldNum: oldLine++, newNum: newLine++, content: text });
			}
		}
	}
	return { lines, added, removed, chars: oldContent.length + newContent.length };
}

function wordDiffAnalysis(
	oldText: string,
	newText: string,
): { similarity: number; oldRanges: Array<[number, number]>; newRanges: Array<[number, number]> } {
	if (!oldText && !newText) return { similarity: 1, oldRanges: [], newRanges: [] };
	const parts = Diff.diffWords(oldText, newText);
	const oldRanges: Array<[number, number]> = [];
	const newRanges: Array<[number, number]> = [];
	let oldPos = 0;
	let newPos = 0;
	let same = 0;
	for (const part of parts) {
		if (part.removed) {
			oldRanges.push([oldPos, oldPos + part.value.length]);
			oldPos += part.value.length;
		} else if (part.added) {
			newRanges.push([newPos, newPos + part.value.length]);
			newPos += part.value.length;
		} else {
			const len = part.value.length;
			same += len;
			oldPos += len;
			newPos += len;
		}
	}
	const maxLen = Math.max(oldText.length, newText.length);
	return { similarity: maxLen > 0 ? same / maxLen : 1, oldRanges, newRanges };
}

function injectBg(ansiLine: string, ranges: Array<[number, number]>, baseBg: string, hlBg: string): string {
	if (!ranges.length) return baseBg + ansiLine + D_RST;
	let out = baseBg;
	let vis = 0;
	let inHL = false;
	let rangeIndex = 0;
	let i = 0;
	while (i < ansiLine.length) {
		if (ansiLine[i] === "\x1b") {
			const end = ansiLine.indexOf("m", i);
			if (end !== -1) {
				const seq = ansiLine.slice(i, end + 1);
				out += seq;
				if (seq === "\x1b[0m") out += inHL ? hlBg : baseBg;
				i = end + 1;
				continue;
			}
		}
		while (rangeIndex < ranges.length && vis >= ranges[rangeIndex][1]) rangeIndex++;
		const want = rangeIndex < ranges.length && vis >= ranges[rangeIndex][0] && vis < ranges[rangeIndex][1];
		if (want !== inHL) {
			inHL = want;
			out += inHL ? hlBg : baseBg;
		}
		out += ansiLine[i];
		vis++;
		i++;
	}
	return out + D_RST;
}

function plainWordDiff(oldText: string, newText: string): { old: string; new: string } {
	const parts = Diff.diffWords(oldText, newText);
	let oldOut = "";
	let newOut = "";
	for (const part of parts) {
		if (part.removed) oldOut += `${BG_DEL_W}${part.value}${D_RST}${BG_DEL}`;
		else if (part.added) newOut += `${BG_ADD_W}${part.value}${D_RST}${BG_ADD}`;
		else {
			oldOut += part.value;
			newOut += part.value;
		}
	}
	return { old: oldOut, new: newOut };
}

async function renderUnified(
	diff: ParsedDiff,
	language: BundledLanguage | undefined,
	max = MAX_RENDER_LINES,
	dc: DiffColors = DEFAULT_DIFF_COLORS,
): Promise<string> {
	if (!diff.lines.length) return "";
	const vis = diff.lines.slice(0, max);
	const tw = termW();
	const nw = Math.max(2, String(Math.max(...vis.map((l) => l.oldNum ?? l.newNum ?? 0), 0)).length);
	const gw = nw + 5;
	const cw = Math.max(20, tw - gw);
	const canHL = diff.chars <= MAX_HL_CHARS && vis.length <= MAX_RENDER_LINES;

	const oldSrc: string[] = [];
	const newSrc: string[] = [];
	for (const line of vis) {
		if (line.type === "ctx" || line.type === "del") oldSrc.push(line.content);
		if (line.type === "ctx" || line.type === "add") newSrc.push(line.content);
	}
	const [oldHL, newHL] = canHL
		? await Promise.all([hlBlock(oldSrc.join("\n"), language), hlBlock(newSrc.join("\n"), language)])
		: [oldSrc, newSrc];

	let oldIndex = 0;
	let newIndex = 0;
	let index = 0;
	const out: string[] = [diffRule(tw)];

	function emitRow(num: number | null, sign: string, gutterBg: string, signFg: string, body: string, bodyBg = ""): void {
		const borderFg = sign === "-" ? dc.fgDel : sign === "+" ? dc.fgAdd : "";
		const border = borderFg ? `${borderFg}▌${D_RST}` : `${BG_BASE} `;
		const numFg = borderFg || FG_LNUM;
		const gutter = `${border}${gutterBg}${lnum(num, nw, numFg)}${signFg}${sign}${D_RST} ${DIVIDER} `;
		const cont = `${border}${gutterBg}${" ".repeat(nw + 1)}${D_RST} ${DIVIDER} `;
		const rows = wrapAnsi(tabs(body), cw, adaptiveWrapRows(), bodyBg);
		out.push(`${gutter}${rows[0]}${D_RST}`);
		for (let r = 1; r < rows.length; r++) out.push(`${cont}${rows[r]}${D_RST}`);
	}

	while (index < vis.length) {
		const line = vis[index];
		if (line.type === "sep") {
			const gap = line.newNum;
			const label = gap && gap > 0 ? ` ${gap} unmodified lines ` : "···";
			const totalW = Math.min(tw, 72);
			const pad = Math.max(0, totalW - label.length - 2);
			const half1 = Math.floor(pad / 2);
			const half2 = pad - half1;
			out.push(`${BG_BASE}${FG_DIM}${"─".repeat(half1)}${label}${"─".repeat(half2)}${D_RST}`);
			index++;
			continue;
		}
		if (line.type === "ctx") {
			const hl = oldHL[oldIndex] ?? line.content;
			emitRow(line.newNum, " ", BG_BASE, dc.fgCtx, `${BG_BASE}${D_DIM}${hl}`, BG_BASE);
			oldIndex++;
			newIndex++;
			index++;
			continue;
		}

		const dels: Array<{ l: DiffLine; hl: string }> = [];
		while (index < vis.length && vis[index].type === "del") {
			dels.push({ l: vis[index], hl: oldHL[oldIndex] ?? vis[index].content });
			oldIndex++;
			index++;
		}
		const adds: Array<{ l: DiffLine; hl: string }> = [];
		while (index < vis.length && vis[index].type === "add") {
			adds.push({ l: vis[index], hl: newHL[newIndex] ?? vis[index].content });
			newIndex++;
			index++;
		}

		const isPaired = dels.length === 1 && adds.length === 1;
		const wd = isPaired ? wordDiffAnalysis(dels[0].l.content, adds[0].l.content) : null;
		if (isPaired && wd && wd.similarity >= WORD_DIFF_MIN_SIM && canHL) {
			emitRow(dels[0].l.oldNum, "-", BG_GUTTER_DEL, `${dc.fgDel}${D_BOLD}`, injectBg(dels[0].hl, wd.oldRanges, BG_DEL, BG_DEL_W), BG_DEL);
			emitRow(adds[0].l.newNum, "+", BG_GUTTER_ADD, `${dc.fgAdd}${D_BOLD}`, injectBg(adds[0].hl, wd.newRanges, BG_ADD, BG_ADD_W), BG_ADD);
			continue;
		}
		if (isPaired && wd && wd.similarity >= WORD_DIFF_MIN_SIM && !canHL) {
			const pwd = plainWordDiff(dels[0].l.content, adds[0].l.content);
			emitRow(dels[0].l.oldNum, "-", BG_GUTTER_DEL, `${dc.fgDel}${D_BOLD}`, `${BG_DEL}${pwd.old}`, BG_DEL);
			emitRow(adds[0].l.newNum, "+", BG_GUTTER_ADD, `${dc.fgAdd}${D_BOLD}`, `${BG_ADD}${pwd.new}`, BG_ADD);
			continue;
		}
		for (const d of dels) emitRow(d.l.oldNum, "-", BG_GUTTER_DEL, `${dc.fgDel}${D_BOLD}`, `${BG_DEL}${canHL ? d.hl : d.l.content}`, BG_DEL);
		for (const a of adds) emitRow(a.l.newNum, "+", BG_GUTTER_ADD, `${dc.fgAdd}${D_BOLD}`, `${BG_ADD}${canHL ? a.hl : a.l.content}`, BG_ADD);
	}

	out.push(diffRule(tw));
	if (diff.lines.length > vis.length) out.push(`${BG_BASE}${FG_DIM}  ${collapsedDiffHint(diff.lines.length - vis.length, 0)}${D_RST}`);
	return out.join("\n");
}

async function renderSplit(
	diff: ParsedDiff,
	language: BundledLanguage | undefined,
	max = MAX_PREVIEW_LINES,
	dc: DiffColors = DEFAULT_DIFF_COLORS,
): Promise<string> {
	const tw = termW();
	if (!shouldUseSplit(diff, tw, max)) return renderUnified(diff, language, max, dc);
	if (!diff.lines.length) return "";

	type Row = { left: DiffLine | null; right: DiffLine | null };
	const rows: Row[] = [];
	let i = 0;
	while (i < diff.lines.length) {
		const line = diff.lines[i];
		if (line.type === "sep" || line.type === "ctx") {
			rows.push({ left: line, right: line });
			i++;
			continue;
		}
		const dels: DiffLine[] = [];
		const adds: DiffLine[] = [];
		while (i < diff.lines.length && diff.lines[i].type === "del") dels.push(diff.lines[i++]);
		while (i < diff.lines.length && diff.lines[i].type === "add") adds.push(diff.lines[i++]);
		const n = Math.max(dels.length, adds.length);
		for (let j = 0; j < n; j++) rows.push({ left: dels[j] ?? null, right: adds[j] ?? null });
	}

	const vis = rows.slice(0, max);
	const half = Math.floor((tw - 1) / 2);
	const nw = Math.max(2, String(Math.max(...diff.lines.map((l) => l.oldNum ?? l.newNum ?? 0), 0)).length);
	const gw = nw + 5;
	const cw = Math.max(12, half - gw);
	const canHL = diff.chars <= MAX_HL_CHARS && vis.length * 2 <= MAX_RENDER_LINES * 2;

	const leftSrc: string[] = [];
	const rightSrc: string[] = [];
	for (const row of vis) {
		if (row.left && row.left.type !== "sep") leftSrc.push(row.left.content);
		if (row.right && row.right.type !== "sep") rightSrc.push(row.right.content);
	}
	const [leftHL, rightHL] = canHL
		? await Promise.all([hlBlock(leftSrc.join("\n"), language), hlBlock(rightSrc.join("\n"), language)])
		: [leftSrc, rightSrc];

	let leftIndex = 0;
	let rightIndex = 0;

	type HalfResult = { gutter: string; contGutter: string; bodyRows: string[] };
	function halfBuild(
		line: DiffLine | null,
		hl: string,
		ranges: Array<[number, number]> | null,
		side: "left" | "right",
	): HalfResult {
		if (!line) {
			const gPat = FG_STRIPE + "╱".repeat(nw + 2) + D_RST;
			const gutter = ` ${gPat}${FG_RULE}│${D_RST} `;
			return { gutter, contGutter: gutter, bodyRows: [stripes(cw)] };
		}
		if (line.type === "sep") {
			const gap = line.newNum;
			const label = gap && gap > 0 ? `··· ${gap} lines ···` : "···";
			const gutter = `${BG_BASE} ${FG_DIM}${fit("", nw + 2)}${D_RST}${FG_RULE}│${D_RST} `;
			return { gutter, contGutter: gutter, bodyRows: [`${BG_BASE}${FG_DIM}${fit(label, cw)}${D_RST}`] };
		}
		const isDel = line.type === "del";
		const isAdd = line.type === "add";
		const gBg = isDel ? BG_GUTTER_DEL : isAdd ? BG_GUTTER_ADD : BG_BASE;
		const cBg = isDel ? BG_DEL : isAdd ? BG_ADD : BG_BASE;
		const sFg = isDel ? dc.fgDel : isAdd ? dc.fgAdd : dc.fgCtx;
		const sign = isDel ? "-" : isAdd ? "+" : " ";
		const num = isDel ? line.oldNum : isAdd ? line.newNum : side === "left" ? line.oldNum : line.newNum;
		const borderFg = isDel ? dc.fgDel : isAdd ? dc.fgAdd : "";
		const border = borderFg ? `${borderFg}▌${D_RST}` : ` ${BG_BASE}`;
		const numFg = borderFg || FG_LNUM;
		let body: string;
		if (ranges && ranges.length > 0) body = injectBg(hl, ranges, cBg, isDel ? BG_DEL_W : BG_ADD_W);
		else if (isDel || isAdd) body = `${cBg}${hl}`;
		else body = `${BG_BASE}${D_DIM}${hl}`;
		const gutter = `${border}${gBg}${lnum(num, nw, numFg)}${sFg}${D_BOLD}${sign}${D_RST} ${FG_RULE}│${D_RST} `;
		const contGutter = `${border}${gBg}${" ".repeat(nw + 1)}${D_RST} ${FG_RULE}│${D_RST} `;
		return { gutter, contGutter, bodyRows: wrapAnsi(tabs(body), cw, adaptiveWrapRows(), cBg) };
	}

	const out: string[] = [];
	const hdrOld = `${BG_BASE}${" ".repeat(Math.max(0, nw - 2))}${dc.fgDel}${D_DIM}old${D_RST}`;
	const hdrNew = `${BG_BASE}${" ".repeat(Math.max(0, nw - 2))}${dc.fgAdd}${D_DIM}new${D_RST}`;
	out.push(`${BG_BASE}${hdrOld}${" ".repeat(Math.max(0, half - nw - 1))}${FG_RULE}┊${D_RST}${hdrNew}`);
	out.push(`${diffRule(half)}${FG_RULE}┊${D_RST}${diffRule(half)}`);

	for (const row of vis) {
		const leftLine = row.left;
		const rightLine = row.right;
		const paired = Boolean(leftLine && rightLine && leftLine.type === "del" && rightLine.type === "add");
		const wd = paired && leftLine && rightLine ? wordDiffAnalysis(leftLine.content, rightLine.content) : null;
		let leftResult: HalfResult;
		let rightResult: HalfResult;
		if (paired && wd && leftLine && rightLine && wd.similarity >= WORD_DIFF_MIN_SIM && canHL) {
			leftResult = halfBuild(leftLine, leftHL[leftIndex++] ?? leftLine.content, wd.oldRanges, "left");
			rightResult = halfBuild(rightLine, rightHL[rightIndex++] ?? rightLine.content, wd.newRanges, "right");
		} else if (paired && wd && leftLine && rightLine && wd.similarity >= WORD_DIFF_MIN_SIM && !canHL) {
			const pwd = plainWordDiff(leftLine.content, rightLine.content);
			leftIndex++;
			rightIndex++;
			leftResult = halfBuild(leftLine, pwd.old, null, "left");
			rightResult = halfBuild(rightLine, pwd.new, null, "right");
		} else {
			leftResult = halfBuild(
				row.left,
				row.left && row.left.type !== "sep" ? (leftHL[leftIndex++] ?? row.left.content) : "",
				null,
				"left",
			);
			rightResult = halfBuild(
				row.right,
				row.right && row.right.type !== "sep" ? (rightHL[rightIndex++] ?? row.right.content) : "",
				null,
				"right",
			);
		}
		const maxRows = Math.max(leftResult.bodyRows.length, rightResult.bodyRows.length);
		for (let rowIndex = 0; rowIndex < maxRows; rowIndex++) {
			const lg = rowIndex === 0 ? leftResult.gutter : leftResult.contGutter;
			const rg = rowIndex === 0 ? rightResult.gutter : rightResult.contGutter;
			const lb = leftResult.bodyRows[rowIndex] ?? (!row.left ? stripes(cw) : `${BG_EMPTY}${" ".repeat(cw)}${D_RST}`);
			const rb = rightResult.bodyRows[rowIndex] ?? (!row.right ? stripes(cw) : `${BG_EMPTY}${" ".repeat(cw)}${D_RST}`);
			out.push(`${lg}${lb}${DIVIDER}${rg}${rb}`);
		}
	}

	out.push(`${diffRule(half)}${FG_RULE}┊${D_RST}${diffRule(half)}`);
	if (rows.length > vis.length) out.push(`${BG_BASE}${FG_DIM}  ${collapsedDiffHint(rows.length - vis.length, 0)}${D_RST}`);
	return out.join("\n");
}

function getEditOperations(input: any): Array<{ oldText: string; newText: string }> {
	if (Array.isArray(input?.edits)) {
		return input.edits
			.map((edit: any) => ({
				oldText: typeof edit?.oldText === "string" ? edit.oldText : typeof edit?.old_text === "string" ? edit.old_text : "",
				newText: typeof edit?.newText === "string" ? edit.newText : typeof edit?.new_text === "string" ? edit.new_text : "",
			}))
			.filter((edit: { oldText: string; newText: string }) => edit.oldText && edit.oldText !== edit.newText);
	}
	const oldText = typeof input?.oldText === "string" ? input.oldText : typeof input?.old_text === "string" ? input.old_text : "";
	const newText = typeof input?.newText === "string" ? input.newText : typeof input?.new_text === "string" ? input.new_text : "";
	return oldText && oldText !== newText ? [{ oldText, newText }] : [];
}

function summarizeEditOperations(operations: Array<{ oldText: string; newText: string }>) {
	const diffs = operations.map((edit) => parseDiff(edit.oldText, edit.newText));
	const totalAdded = diffs.reduce((sum, diff) => sum + diff.added, 0);
	const totalRemoved = diffs.reduce((sum, diff) => sum + diff.removed, 0);
	const totalLines = diffs.reduce((sum, diff) => sum + diff.lines.length, 0);
	const totalHunks = diffs.reduce((sum, diff) => sum + diff.lines.filter((l) => l.type === "sep").length + (diff.lines.length ? 1 : 0), 0);
	return { diffs, totalAdded, totalRemoved, totalLines, totalHunks, summary: summarizeDiff(totalAdded, totalRemoved) };
}

function stripThinkingPresentationArtifacts(text: string): string {
	let current = text.replace(/\x1b\[[0-9;]*m/g, "");
	while (true) {
		const next = current.replace(/^(?:thinking:\s*)+/i, "").trimStart();
		if (next === current) return current;
		current = next;
	}
}

function prefixThinkingLine(text: string, _theme: Theme | undefined): string {
	const normalized = stripThinkingPresentationArtifacts(text).trim();
	if (!normalized) return text;
	// Plain text — no ANSI colors, no theme. The ThinkingParagraph handles styling.
	return `Thinking: ${normalized}`;
}

function registerThinkingLabels(pi: ExtensionAPI): void {
	const patchMessage = (event: any, theme?: Theme) => {
		const message = event?.message;
		if (!message || message.role !== "assistant" || !Array.isArray(message.content)) return;
		for (const block of message.content) {
			if (block && block.type === "thinking" && typeof block.thinking === "string") {
				block.thinking = prefixThinkingLine(block.thinking, theme);
			}
		}
	};
	pi.on("message_update", async (event, ctx) => patchMessage(event, ctx.ui?.theme));
	pi.on("message_end", async (event, ctx) => patchMessage(event, ctx.ui?.theme));
	pi.on("context", async (event) => {
		if (!Array.isArray((event as any).messages)) return;
		for (const msg of (event as any).messages) {
			if (!msg || msg.role !== "assistant" || !Array.isArray(msg.content)) continue;
			for (const block of msg.content) {
				if (block && block.type === "thinking" && typeof block.thinking === "string") {
					block.thinking = stripThinkingPresentationArtifacts(block.thinking);
				}
			}
		}
	});
}

function getMode<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
	return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function isMcpToolCandidate(tool: unknown): boolean {
	const rec = tool as Record<string, unknown> | undefined;
	const name = typeof rec?.name === "string" ? rec.name : "";
	const description = typeof rec?.description === "string" ? rec.description : "";
	return name === "mcp" || /\bmcp\b/i.test(description);
}

// ===========================================================================
// Extension
// ===========================================================================

export default function (pi: ExtensionAPI) {
	patchGlobalToolBorders();
	patchAssistantMessages();
	applyDiffPalette();
	registerThinkingLabels(pi);

	// /cc-tools command — toggle tool border style at runtime
	const TOOL_MODES = ["outlines", "transparent", "default"] as const;
	pi.registerCommand("cc-tools", {
		description: "Switch tool display style: outlines (lines around tools), transparent (no chrome), default (pi built-in backgrounds)",
		getArgumentCompletions(prefix) {
			return TOOL_MODES
				.filter((m) => m.startsWith(prefix))
				.map((m) => ({
					value: m,
					label: m,
					description:
						m === "outlines" ? "Horizontal rules around each tool (default)"
						: m === "transparent" ? "No borders or backgrounds"
						: "Pi built-in tool backgrounds",
				}));
		},
		async handler(args, ctx) {
			const mode = args.trim().toLowerCase();
			if (!mode) {
				if (ctx.hasUI) ctx.ui.notify(`Tool style: ${toolBackgroundMode}`, "info");
				return;
			}
			if (!(TOOL_MODES as readonly string[]).includes(mode)) {
				if (ctx.hasUI) ctx.ui.notify(`Unknown mode "${mode}". Options: ${TOOL_MODES.join(", ")}`, "error");
				return;
			}
			toolBackgroundOverride = mode as typeof toolBackgroundMode;
			toolBackgroundMode = toolBackgroundOverride;
			writeSettingsKey("toolBackground", mode);
			if (ctx.hasUI) {
				applyToolBackgroundMode(ctx.ui.theme);
				ctx.ui.notify(`Tool style → ${mode}`, "info");
			}
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		applyToolBackgroundMode(ctx.ui.theme);
	});

	pi.on("turn_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		applyToolBackgroundMode(ctx.ui.theme);
	});

	const cwd = process.cwd();
	const sp = (path: string) => shortPath(cwd, path);

	const readTool = createReadTool(cwd);
	pi.registerTool({
		name: "read",
		label: "read",
		description: readTool.description,
		parameters: readTool.parameters,
		async execute(toolCallId, params, signal, onUpdate) {
			return readTool.execute(toolCallId, params, signal, onUpdate);
		},
		renderCall(args, theme, ctx) {
			setToolStatus(ctx, "pending");
			let summary = sp(args.path ?? "");
			if (args.offset || args.limit) {
				const parts: string[] = [];
				if (args.offset) parts.push(`offset=${args.offset}`);
				if (args.limit) parts.push(`limit=${args.limit}`);
				summary += ` ${theme.fg("muted", `(${parts.join(", ")})`)}`;
			}
			return makeText(ctx.lastComponent, toolHeader("Read", summary, theme, toolStatusDot(ctx, theme)));
		},
		renderResult(result, { expanded, isPartial }, theme, ctx) {
			if (isPartial) {
				setupBlinkTimer(ctx);
				return makeText(ctx.lastComponent, theme.fg("dim", "Reading..."));
			}
			clearBlinkTimer(ctx);
			setToolStatus(ctx, ctx.isError ? "error" : "success");
			const details = result.details as ReadToolDetails | undefined;
			const content = result.content[0];
			if (content?.type === "image") return makeText(ctx.lastComponent, withBranch(theme.fg("success", "Image loaded"), theme));
			if (content?.type !== "text") return makeText(ctx.lastComponent, withBranch(theme.fg("error", "No text content"), theme));
			const lines = content.text.split("\n");
			let text = theme.fg("muted", `${lines.length} lines loaded`);
			if (details?.truncation?.truncated) text += theme.fg("warning", " (truncated)");
			if (!expanded) return makeText(ctx.lastComponent, withBranch(`${text}${theme.fg("muted", " • Ctrl+O to expand")}`, theme));
			const shown = lines.slice(0, previewLimit());
			text += `\n${buildPreviewText(shown.map((line) => theme.fg("dim", line || " ")), false, theme, previewLimit())}`;
			return makeText(ctx.lastComponent, withBranch(text, theme));
		},
	});

	const bashTool = createBashTool(cwd);
	pi.registerTool({
		name: "bash",
		label: "bash",
		description: bashTool.description,
		parameters: bashTool.parameters,
		async execute(toolCallId, params, signal, onUpdate) {
			return bashTool.execute(toolCallId, params, signal, onUpdate);
		},
		renderCall(args, theme, ctx) {
			setToolStatus(ctx, "pending");
			return makeText(ctx.lastComponent, toolHeader("Bash", summarizeText(args.command, 72), theme, toolStatusDot(ctx, theme)));
		},
		renderResult(result, { expanded, isPartial }, theme, ctx) {
			const details = result.details as BashToolDetails | undefined;
			const output = result.content[0]?.type === "text" ? result.content[0].text : "";
			const nonEmpty = output.split("\n").filter((line) => line.trim().length > 0);
			if (isPartial) {
				setupBlinkTimer(ctx);
				return makeText(ctx.lastComponent, theme.fg("warning", `Running... (${nonEmpty.length} lines)`));
			}
			clearBlinkTimer(ctx);
			setToolStatus(ctx, ctx.isError ? "error" : "success");
			const exitMatch = output.match(/exit code: (\d+)/);
			const exitCode = exitMatch ? Number.parseInt(exitMatch[1], 10) : null;
			let text = exitCode === null || exitCode === 0 ? theme.fg("success", "Done") : theme.fg("error", `Exit ${exitCode}`);
			text += theme.fg("muted", ` (${nonEmpty.length} lines)`);
			if (details?.truncation?.truncated) text += theme.fg("warning", " [truncated]");
			if (!expanded && nonEmpty.length > 0) return makeText(ctx.lastComponent, withBranch(`${text}${theme.fg("muted", " • Ctrl+O to expand")}`, theme));
			if (!expanded) return makeText(ctx.lastComponent, withBranch(text, theme));
			const collapsed = bashCollapsedLimit();
			text += `\n${buildPreviewText(nonEmpty.map((line) => theme.fg("dim", line)), false, theme, collapsed)}`;
			return makeText(ctx.lastComponent, withBranch(text, theme));
		},
	});

	const grepTool = createGrepTool(cwd);
	pi.registerTool({
		name: "grep",
		label: "grep",
		description: grepTool.description,
		parameters: grepTool.parameters,
		async execute(toolCallId, params, signal, onUpdate) {
			return grepTool.execute(toolCallId, params, signal, onUpdate);
		},
		renderCall(args, theme, ctx) {
			setToolStatus(ctx, "pending");
			let summary = `\"${summarizeText(args.pattern, 40)}\"`;
			if (args.path) summary += ` in ${args.path}`;
			return makeText(ctx.lastComponent, toolHeader("Grep", summary, theme, toolStatusDot(ctx, theme)));
		},
		renderResult(result, { expanded, isPartial }, theme, ctx) {
			if (isPartial) {
				setupBlinkTimer(ctx);
				return makeText(ctx.lastComponent, theme.fg("dim", "Searching..."));
			}
			clearBlinkTimer(ctx);
			setToolStatus(ctx, ctx.isError ? "error" : "success");
			const details = result.details as GrepToolDetails | undefined;
			const matches = (result.content[0]?.type === "text" ? result.content[0].text : "")
				.split("\n")
				.filter((line) => line.trim().length > 0);
			if (matches.length === 0) return makeText(ctx.lastComponent, withBranch(theme.fg("muted", "no matches"), theme));
			let text = theme.fg("muted", `${matches.length} matches`);
			if (details?.truncation?.truncated) text += theme.fg("warning", " (truncated)");
			if (!expanded) return makeText(ctx.lastComponent, withBranch(`${text}${theme.fg("muted", " • Ctrl+O to expand")}`, theme));
			text += `\n${buildPreviewText(matches.map((line) => theme.fg("dim", line)), false, theme, previewLimit())}`;
			return makeText(ctx.lastComponent, withBranch(text, theme));
		},
	});

	const findTool = createFindTool(cwd);
	pi.registerTool({
		name: "find",
		label: "find",
		description: findTool.description,
		parameters: findTool.parameters,
		async execute(toolCallId, params, signal, onUpdate) {
			return findTool.execute(toolCallId, params, signal, onUpdate);
		},
		renderCall(args, theme, ctx) {
			setToolStatus(ctx, "pending");
			let summary = `\"${summarizeText(args.pattern, 40)}\"`;
			if (args.path) summary += ` in ${args.path}`;
			return makeText(ctx.lastComponent, toolHeader("Find", summary, theme, toolStatusDot(ctx, theme)));
		},
		renderResult(result, { expanded, isPartial }, theme, ctx) {
			if (isPartial) {
				setupBlinkTimer(ctx);
				return makeText(ctx.lastComponent, theme.fg("dim", "Finding..."));
			}
			clearBlinkTimer(ctx);
			setToolStatus(ctx, ctx.isError ? "error" : "success");
			const items = (result.content[0]?.type === "text" ? result.content[0].text : "")
				.split("\n")
				.filter((line) => line.trim().length > 0);
			if (items.length === 0) return makeText(ctx.lastComponent, withBranch(theme.fg("muted", "no files found"), theme));
			let text = theme.fg("muted", `${items.length} files`);
			if (!expanded) return makeText(ctx.lastComponent, withBranch(`${text}${theme.fg("muted", " • Ctrl+O to expand")}`, theme));
			// Expanded: grouped find results with icons
			const maxShow = previewLimit();
			const shown = items.slice(0, maxShow);
			const findLines: string[] = [];
			for (let i = 0; i < shown.length; i++) {
				const item = shown[i].trim();
				const icon = fileIcon(item);
				findLines.push(`  ${icon}${theme.fg("dim", item)}`);
			}
			const remaining = items.length - shown.length;
			if (remaining > 0) {
				findLines.push(`  ${theme.fg("muted", `… ${remaining} more files`)}`);
			}
			text += `\n${findLines.join('\n')}`;
			return makeText(ctx.lastComponent, withBranch(text, theme));
		},
	});

	const lsTool = createLsTool(cwd);
	pi.registerTool({
		name: "ls",
		label: "ls",
		description: lsTool.description,
		parameters: lsTool.parameters,
		async execute(toolCallId, params, signal, onUpdate) {
			return lsTool.execute(toolCallId, params, signal, onUpdate);
		},
		renderCall(args, theme, ctx) {
			setToolStatus(ctx, "pending");
			return makeText(ctx.lastComponent, toolHeader("List", sp(args.path ?? "."), theme, toolStatusDot(ctx, theme)));
		},
		renderResult(result, { expanded, isPartial }, theme, ctx) {
			if (isPartial) {
				setupBlinkTimer(ctx);
				return makeText(ctx.lastComponent, theme.fg("dim", "Listing..."));
			}
			clearBlinkTimer(ctx);
			setToolStatus(ctx, ctx.isError ? "error" : "success");
			const items = (result.content[0]?.type === "text" ? result.content[0].text : "")
				.split("\n")
				.filter((line) => line.trim().length > 0);
			if (items.length === 0) return makeText(ctx.lastComponent, withBranch(theme.fg("muted", "empty directory"), theme));
			let text = theme.fg("muted", `${items.length} entries`);
			if (!expanded) return makeText(ctx.lastComponent, withBranch(`${text}${theme.fg("muted", " • Ctrl+O to expand")}`, theme));
			// Expanded: tree-view with icons
			const maxShow = previewLimit();
			const shown = items.slice(0, maxShow);
			const treeLines: string[] = [];
			for (let i = 0; i < shown.length; i++) {
				const item = shown[i];
				const isDir = item.endsWith("/");
				const isLast = i === shown.length - 1 && items.length <= maxShow;
				const prefix = isLast ? `${FG_RULE}\u2514\u2500\u2500${D_RST} ` : `${FG_RULE}\u251c\u2500\u2500${D_RST} `;
				const icon = isDir ? dirIcon() : fileIcon(item);
				const name = isDir ? theme.fg("accent", theme.bold(item)) : theme.fg("dim", item);
				treeLines.push(`${prefix}${icon}${name}`);
			}
			const remaining = items.length - shown.length;
			if (remaining > 0) {
				treeLines.push(`${FG_RULE}\u2514\u2500\u2500${D_RST} ${theme.fg("muted", `\u2026 ${remaining} more entries`)}`);
			}
			text += `\n${treeLines.join('\n')}`;
			return makeText(ctx.lastComponent, withBranch(text, theme));
		},
	});

	const writeTool = createWriteTool(cwd);
	pi.registerTool({
		name: "write",
		label: "write",
		description: writeTool.description,
		parameters: writeTool.parameters,
		async execute(toolCallId, params, signal, onUpdate, _ctx) {
			const fp = params.path ?? (params as any).file_path ?? "";
			let old: string | null = null;
			try {
				if (fp && existsSync(fp)) old = readFileSync(fp, "utf-8");
			} catch {
				old = null;
			}
			const result = await writeTool.execute(toolCallId, params, signal, onUpdate);
			const content = params.content ?? "";
			if (old !== null && old !== content) {
				const diff = parseDiff(old, content);
				(result as any).details = { _type: "diff", summary: summarizeDiff(diff.added, diff.removed), diff, language: lang(fp) };
			} else if (old === null) {
				(result as any).details = { _type: "new", lines: lineCount(content), content, filePath: fp };
			} else if (old === content) {
				(result as any).details = { _type: "noChange" };
			}
			return result;
		},
		renderCall(args, theme, ctx) {
			const fp = args?.path ?? (args as any)?.file_path ?? "";
			const isNew = !fp || !existsSync(fp);
			const label = isNew ? "Create" : "Write";
			setToolStatus(ctx, "pending");
			const hdr = toolHeader(label, `${sp(fp)} ${theme.fg("muted", `(${lineCount(args.content ?? "")} lines)`)}`, theme, toolStatusDot(ctx, theme));
			if (args?.content && ctx.argsComplete && isNew) {
				const previewKey = `create:${fp}:${String(args.content).length}:${ctx.expanded}`;
				if (ctx.state._previewKey !== previewKey) {
					ctx.state._previewKey = previewKey;
					ctx.state._previewText = hdr;
					const lg = lang(fp);
					hlBlock(args.content, lg)
						.then((lines) => {
							if (ctx.state._previewKey !== previewKey) return;
							const maxShow = ctx.expanded ? lines.length : 16;
							let out = `${hdr}\n${theme.fg("success", `${lines.length} lines`)}`;
							for (const line of lines.slice(0, maxShow)) out += `\n${line}`;
							if (lines.length > maxShow) out += `\n${theme.fg("muted", `… ${lines.length - maxShow} more lines`)}`;
							ctx.state._previewText = out;
							ctx.invalidate();
						})
						.catch(() => {});
				}
				return makeText(ctx.lastComponent, ctx.state._previewText ?? hdr);
			}
			return makeText(ctx.lastComponent, hdr);
		},
		renderResult(result, { isPartial }, theme, ctx) {
			if (isPartial) {
				setupBlinkTimer(ctx);
				return makeText(ctx.lastComponent, theme.fg("dim", "Writing..."));
			}
			clearBlinkTimer(ctx);
			setToolStatus(ctx, ctx.isError ? "error" : "success");
			if (ctx.isError) {
				const e =
					result.content
						?.filter((c: any) => c.type === "text")
						.map((c: any) => c.text || "")
						.join("\n") ?? "Error";
				return makeText(ctx.lastComponent, theme.fg("error", e));
			}
			const d = (result as any).details;
			if (d?._type === "diff") {
				const hunks = d.diff?.lines?.filter((l: any) => l.type === "sep").length + (d.diff?.lines?.length ? 1 : 0);
				const mode = shouldUseSplit(d.diff, termW(), ctx.expanded ? MAX_RENDER_LINES : diffCollapsedLimit()) ? "split" : "unified";
				const richSummary = diffSummaryWithMeta(d.diff.added, d.diff.removed, hunks, mode);
				const key = `wd:${termW()}:${d.summary}:${d.diff?.lines?.length ?? 0}:${d.language ?? ""}:${ctx.expanded}`;
				if (ctx.state._wdk !== key) {
					ctx.state._wdk = key;
					ctx.state._wdt = withBranch(`${richSummary}\n${theme.fg("muted", "rendering diff…")}`, theme);
					const dc = resolveDiffColors(theme);
					renderSplit(d.diff, d.language, ctx.expanded ? MAX_RENDER_LINES : diffCollapsedLimit(), dc)
						.then((rendered) => {
							if (ctx.state._wdk !== key) return;
							ctx.state._wdt = withBranch(`${richSummary}\n${rendered}`, theme);
							ctx.invalidate();
						})
						.catch(() => {
							if (ctx.state._wdk !== key) return;
							ctx.state._wdt = withBranch(richSummary, theme);
							ctx.invalidate();
						});
				}
				return makeText(ctx.lastComponent, ctx.state._wdt ?? withBranch(richSummary, theme));
			}
			if (d?._type === "noChange") return makeText(ctx.lastComponent, withBranch(theme.fg("muted", "✓ no changes"), theme));
			if (d?._type === "new") {
				// New file: render as all-green diff (every line is +)
				const syntheticDiff = parseDiff("", d.content);
				const hunks = 1;
				const richSummary = diffSummaryWithMeta(syntheticDiff.added, 0, hunks, "new file");
				const pk = `nf:${d.filePath}:${d.lines}:${ctx.expanded}:${termW()}`;
				if (ctx.state._nfk !== pk) {
					ctx.state._nfk = pk;
					ctx.state._nft = withBranch(`${theme.fg("success", `✓ new file`)} ${richSummary}\n${theme.fg("muted", "rendering diff…")}`, theme);
					const dc = resolveDiffColors(theme);
					renderSplit(syntheticDiff, lang(d.filePath), ctx.expanded ? MAX_RENDER_LINES : diffCollapsedLimit(), dc)
						.then((rendered) => {
							if (ctx.state._nfk !== pk) return;
							ctx.state._nft = withBranch(`${theme.fg("success", `✓ new file`)} ${richSummary}\n${rendered}`, theme);
							ctx.invalidate();
						})
						.catch(() => {
							if (ctx.state._nfk !== pk) return;
							ctx.state._nft = withBranch(`${theme.fg("success", `✓ new file`)} ${richSummary}`, theme);
							ctx.invalidate();
						});
				}
				return makeText(ctx.lastComponent, ctx.state._nft ?? withBranch(`${theme.fg("success", `✓ new file (${d.lines} lines)`)}`, theme));
			}
			return makeText(ctx.lastComponent, withBranch(theme.fg("success", "Written"), theme));
		},
	});

	const editTool = createEditTool(cwd);
	pi.registerTool({
		name: "edit",
		label: "edit",
		description: editTool.description,
		parameters: editTool.parameters,
		async execute(toolCallId, params, signal, onUpdate, _ctx) {
			const fp = params.path ?? (params as any).file_path ?? "";
			const operations = getEditOperations(params);
			const result = await editTool.execute(toolCallId, params, signal, onUpdate);
			if (operations.length === 0) return result;
			const { diffs, summary, totalLines, totalHunks } = summarizeEditOperations(operations);
			if (operations.length === 1) {
				let editLine = 0;
				try {
					if (fp && existsSync(fp)) {
						const f = readFileSync(fp, "utf-8");
						const idx = f.indexOf(operations[0].newText);
						if (idx >= 0) editLine = f.slice(0, idx).split("\n").length;
					}
				} catch {
					editLine = 0;
				}
				(result as any).details = { _type: "editInfo", summary, editLine, hunks: totalHunks, added: diffs[0]?.added ?? 0, removed: diffs[0]?.removed ?? 0 };
				return result;
			}
			(result as any).details = { _type: "multiEditInfo", summary, editCount: operations.length, diffLineCount: totalLines, hunks: totalHunks, totalAdded: diffs.reduce((sum, diff) => sum + diff.added, 0), totalRemoved: diffs.reduce((sum, diff) => sum + diff.removed, 0) };
			return result;
		},
		renderCall(args, theme, ctx) {
			const fp = args?.path ?? (args as any)?.file_path ?? "";
			const operations = getEditOperations(args);
			const summary = operations.length > 1 ? `${sp(fp)} ${theme.fg("muted", `(${operations.length} edits)`)}` : sp(fp);
			setToolStatus(ctx, "pending");
			const hdr = toolHeader("Edit", summary, theme, toolStatusDot(ctx, theme));
			if (!(ctx.argsComplete && operations.length > 0)) return makeText(ctx.lastComponent, hdr);
			const key = JSON.stringify({ fp, operations, expanded: ctx.expanded });
			if (ctx.state._pk !== key) {
				ctx.state._pk = key;
				ctx.state._pt = `${hdr}\n${theme.fg("muted", "(rendering…)")}`;
				const lg = lang(fp);
				const dc = resolveDiffColors(theme);
				if (operations.length === 1) {
					const diff = parseDiff(operations[0].oldText, operations[0].newText);
					renderSplit(diff, lg, ctx.expanded ? MAX_PREVIEW_LINES : 32, dc)
						.then((rendered) => {
							if (ctx.state._pk !== key) return;
							ctx.state._pt = `${hdr}\n${summarizeDiff(diff.added, diff.removed)}\n${rendered}`;
							ctx.invalidate();
						})
						.catch(() => {});
				} else {
					const { diffs, summary: editSummary } = summarizeEditOperations(operations);
					const maxShown = ctx.expanded ? operations.length : Math.min(operations.length, 3);
					const previewLines = ctx.expanded
						? Math.max(6, Math.floor(MAX_RENDER_LINES / Math.max(1, maxShown)))
						: Math.max(8, Math.floor(MAX_PREVIEW_LINES / Math.max(1, maxShown)));
					Promise.all(
						diffs.slice(0, maxShown).map((diff, index) =>
							renderSplit(diff, lg, previewLines, dc)
								.then((rendered) => `Edit ${index + 1}/${operations.length}\n${rendered}`)
								.catch(() => `Edit ${index + 1}/${operations.length} ${summarizeDiff(diff.added, diff.removed)}`),
						),
					)
						.then((sections) => {
							if (ctx.state._pk !== key) return;
							const remainder = operations.length - maxShown;
							const suffix = remainder > 0
								? `\n${theme.fg("muted", `… ${remainder} more edit blocks${ctx.expanded ? "" : " • Ctrl+O to expand"}`)}`
								: "";
							ctx.state._pt = `${hdr}\n${operations.length} edits ${editSummary}\n\n${sections.join("\n\n")}${suffix}`;
							ctx.invalidate();
						})
						.catch(() => {});
				}
			}
			return makeText(ctx.lastComponent, ctx.state._pt ?? hdr);
		},
		renderResult(result, { isPartial }, theme, ctx) {
			if (isPartial) {
				setupBlinkTimer(ctx);
				return makeText(ctx.lastComponent, theme.fg("dim", "Editing..."));
			}
			clearBlinkTimer(ctx);
			setToolStatus(ctx, ctx.isError ? "error" : "success");
			if (ctx.isError) {
				const e =
					result.content
						?.filter((c: any) => c.type === "text")
						.map((c: any) => c.text || "")
						.join("\n") ?? "Error";
				return makeText(ctx.lastComponent, theme.fg("error", e));
			}
			if ((result as any).details?._type === "editInfo") {
				const { editLine, hunks, added, removed } = (result as any).details;
				const loc = editLine > 0 ? ` ${theme.fg("muted", `at line ${editLine}`)}` : "";
				const summary = diffSummaryWithMeta(added ?? 0, removed ?? 0, hunks ?? 0, "");
				return makeText(ctx.lastComponent, withBranch(`${summary}${loc}`, theme));
			}
			if ((result as any).details?._type === "multiEditInfo") {
				const { editCount, diffLineCount, hunks, totalAdded, totalRemoved } = (result as any).details;
				const summary = diffSummaryWithMeta(totalAdded ?? 0, totalRemoved ?? 0, hunks ?? 0, "");
				return makeText(ctx.lastComponent, withBranch(`${editCount} edits ${summary}${typeof diffLineCount === "number" ? ` ${theme.fg("muted", `(${diffLineCount} diff lines)`)}` : ""}`, theme));
			}
			return makeText(ctx.lastComponent, withBranch(theme.fg("success", "Applied"), theme));
		},
	});

	const wrappedMcpTools = new Set<string>();
	const registerMcpToolOverrides = (): void => {
		let allTools: unknown[] = [];
		try {
			allTools = typeof (pi as any).getAllTools === "function" ? (pi as any).getAllTools() : [];
		} catch {
			allTools = [];
		}
		for (const tool of allTools) {
			if (!isMcpToolCandidate(tool)) continue;
			const record = tool as Record<string, unknown>;
			const name = typeof record.name === "string" ? record.name : "";
			if (!name || wrappedMcpTools.has(name)) continue;
			const execute = typeof record.execute === "function" ? (record.execute as any) : null;
			if (!execute) continue;
			const label = typeof record.label === "string" ? record.label : name === "mcp" ? "MCP" : `MCP ${name}`;
			const description = typeof record.description === "string" ? record.description : "MCP tool";
			(pi as any).registerTool({
				name,
				label,
				description,
				parameters: record.parameters,
				prepareArguments: typeof record.prepareArguments === "function" ? record.prepareArguments : undefined,
				async execute(toolCallId: string, params: any, signal: AbortSignal | undefined, onUpdate: any, ctx: any) {
					return await Promise.resolve(execute(toolCallId, params, signal, onUpdate, ctx));
				},
				renderCall(args: any, theme: Theme, ctx: any) {
					const target = name === "mcp"
						? typeof args?.tool === "string"
							? `${args.server ? `${args.server}:` : ""}${args.tool}`
							: typeof args?.connect === "string"
								? `connect ${args.connect}`
								: typeof args?.search === "string"
									? `search ${JSON.stringify(args.search)}`
									: "status"
						: label;
					return makeText(ctx.lastComponent, `${theme.fg("toolTitle", theme.bold("MCP"))} ${theme.fg("accent", target)}`);
				},
				renderResult(result: any, { expanded, isPartial }: any, theme: Theme, ctx: any) {
					if (isPartial) return makeText(ctx.lastComponent, theme.fg("dim", "running..."));
					const mode = getMode(readSettings().mcpOutputMode, ["hidden", "summary", "preview"] as const, "preview");
					if (mode === "hidden") return makeText(ctx.lastComponent, "");
					const raw = result.content?.filter((c: any) => c.type === "text").map((c: any) => c.text || "").join("\n") ?? "";
					const lines = raw.split("\n").filter((line: string) => line.trim().length > 0);
					let text = theme.fg("muted", `${lines.length} line${lines.length === 1 ? "" : "s"} returned`);
					if (mode === "summary") return makeText(ctx.lastComponent, text);
					text += `\n${buildPreviewText(lines.map((line: string) => theme.fg("toolOutput", line)), expanded, theme, previewLimit())}`;
					return makeText(ctx.lastComponent, text);
				},
			});
			wrappedMcpTools.add(name);
		}
	};

	pi.on("session_start", async () => {
		registerMcpToolOverrides();
	});
	pi.on("before_agent_start", async () => {
		registerMcpToolOverrides();
	});
}
