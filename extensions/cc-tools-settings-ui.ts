/**
 * Interactive /cc-tools settings overlay with live ASCII previews.
 */
import { getSettingsListTheme, type Theme } from "@earendil-works/pi-coding-agent";
import {
	SettingsList,
	type SettingItem,
} from "@earendil-works/pi-tui";

export type ToolStyle = "outlines" | "transparent" | "default";
export type BulletStyle = "fisheye" | "dash";
export type BranchPreset = "theme" | "fixed-72" | "fixed-110" | "fixed-40";
export type OutputMode = "hidden" | "summary" | "preview";
export type BashOutputMode = "opencode" | "summary" | "preview";

export interface CcToolsUiSnapshot {
	toolBackground: ToolStyle;
	groupToolCalls: boolean;
	extraToolOutputExpanded: boolean;
	themeAdaptive: boolean;
	liveToolPreview: boolean;
	assistantListBulletStyle: BulletStyle;
	branchPreset: BranchPreset;
	readOutputMode: OutputMode;
	bashOutputMode: BashOutputMode;
}

export interface CcToolsSettingsController {
	getSnapshot(): CcToolsUiSnapshot;
	/** Apply one setting immediately (persist + live UI). */
	apply(id: keyof CcToolsUiSnapshot | string, value: string, ctx: any): void;
}

const SETTING_ORDER: Array<{
	id: keyof CcToolsUiSnapshot;
	label: string;
	values: string[];
	describe: (snap: CcToolsUiSnapshot) => string;
	current: (snap: CcToolsUiSnapshot) => string;
}> = [
	{
		id: "toolBackground",
		label: "Tool style",
		values: ["outlines", "transparent", "default"],
		current: (s) => s.toolBackground,
		describe: (s) =>
			s.toolBackground === "outlines"
				? "Horizontal rules around each tool body"
				: s.toolBackground === "transparent"
					? "No borders — body is bare indented text"
					: "Rounded box around each tool body (pi default)",
	},
	{
		id: "groupToolCalls",
		label: "Group tools",
		values: ["on", "off"],
		current: (s) => (s.groupToolCalls ? "on" : "off"),
		describe: (s) =>
			s.groupToolCalls
				? "One header + ├/└ glance rows for concurrent tools"
				: "Each tool is a full separate row",
	},
	{
		id: "extraToolOutputExpanded",
		label: "Extra detail",
		values: ["on", "off"],
		current: (s) => (s.extraToolOutputExpanded ? "on" : "off"),
		describe: (s) =>
			s.extraToolOutputExpanded
				? "Ctrl+Shift+O ON — higher expand caps (e.g. 12000 lines)"
				: "Normal expand caps (Ctrl+O); extra-detail off",
	},
	{
		id: "branchPreset",
		label: "Branch color",
		values: ["theme", "fixed-72", "fixed-110", "fixed-40"],
		current: (s) => s.branchPreset,
		describe: (s) =>
			s.branchPreset === "theme"
				? "├ └ │ follow pi theme dim/muted"
				: `├ └ │ fixed gray rgb(${s.branchPreset.replace("fixed-", "")})`,
	},
	{
		id: "assistantListBulletStyle",
		label: "List bullets",
		values: ["fisheye", "dash"],
		current: (s) => s.assistantListBulletStyle,
		describe: (s) =>
			s.assistantListBulletStyle === "dash"
				? 'Assistant lists keep plain "-"'
				: "Assistant lists use monochrome ◉",
	},
	{
		id: "themeAdaptive",
		label: "Theme adaptive",
		values: ["on", "off"],
		current: (s) => (s.themeAdaptive ? "on" : "off"),
		describe: (s) =>
			s.themeAdaptive
				? "Borders/diffs/muted follow active pi theme"
				: "Fixed Claude palette (ignore pi theme colors)",
	},
	{
		id: "liveToolPreview",
		label: "Live preview",
		values: ["on", "off"],
		current: (s) => (s.liveToolPreview ? "on" : "off"),
		describe: (s) =>
			s.liveToolPreview
				? "While running: show a short output tail under the tool"
				: "While running: header only (no live tail)",
	},
	{
		id: "readOutputMode",
		label: "Read output",
		values: ["preview", "summary", "hidden"],
		current: (s) => s.readOutputMode,
		describe: (s) =>
			s.readOutputMode === "preview"
				? "Collapsed read shows first code lines"
				: s.readOutputMode === "summary"
					? "Collapsed read shows only line count"
					: "Collapsed read hides body entirely",
	},
	{
		id: "bashOutputMode",
		label: "Bash output",
		values: ["opencode", "preview", "summary"],
		current: (s) => s.bashOutputMode,
		describe: (s) =>
			s.bashOutputMode === "opencode"
				? "Rich bash body (summary + sample lines)"
				: s.bashOutputMode === "preview"
					? "Short bash preview (one result line)"
					: "Bash collapsed to exit/status only",
	},
];

function boolLabel(on: boolean): string {
	return on ? "on" : "off";
}

/** Visible width ignoring CSI SGR sequences. */
function visibleLen(text: string): number {
	return text.replace(/\x1b\[[0-9;]*m/g, "").length;
}

function padVisible(text: string, width: number): string {
	const len = visibleLen(text);
	if (len >= width) return text;
	return text + " ".repeat(width - len);
}

function safeFg(theme: Theme, key: string, text: string): string {
	try {
		const out = theme.fg(key as any, text);
		if (typeof out === "string" && out.length > 0) return out;
	} catch {
		/* fall through */
	}
	return text;
}

type Paint = {
	muted: (t: string) => string;
	accent: (t: string) => string;
	dim: (t: string) => string;
	title: (t: string) => string;
	ok: (t: string) => string;
	warn: (t: string) => string;
	branch: (t: string) => string;
	rule: (w?: number) => string;
};

function makePaint(theme: Theme, snap: CcToolsUiSnapshot): Paint {
	const muted = (t: string) => safeFg(theme, "muted", t);
	const accent = (t: string) => safeFg(theme, "accent", t);
	const dim = (t: string) => safeFg(theme, "dim", t);
	const title = (t: string) => {
		const bold = typeof theme.bold === "function" ? theme.bold(t) : t;
		return safeFg(theme, "toolTitle", bold);
	};
	const ok = (t: string) => safeFg(theme, "success", t);
	const warn = (t: string) => safeFg(theme, "warning", t);

	// Branch connectors: different visual weight per preset (even when theme keys collapse).
	const branch = (t: string): string => {
		if (snap.branchPreset === "theme") return dim(t);
		if (snap.branchPreset === "fixed-40") return muted(t);
		if (snap.branchPreset === "fixed-110") return accent(t);
		return muted(t); // fixed-72 default
	};

	const ruleChar = snap.themeAdaptive ? "─" : "═";
	const rule = (w = 40) => muted(ruleChar.repeat(Math.max(8, Math.min(w, 42))));

	return { muted, accent, dim, title, ok, warn, branch, rule };
}

function readBodyLines(snap: CcToolsUiSnapshot, p: Paint): string[] {
	if (snap.readOutputMode === "hidden") return [];
	if (snap.readOutputMode === "summary") return [p.muted("14 lines")];
	const lines = [
		p.dim("1  export function login() {"),
		p.dim("2    return token"),
	];
	if (snap.extraToolOutputExpanded) {
		lines.push(p.warn("… extra-detail ON  (expand cap ~12000)"));
	} else {
		lines.push(p.muted("… +12 lines  (ctrl+o expand)"));
	}
	return lines;
}

function bashBodyLines(snap: CcToolsUiSnapshot, p: Paint, opts?: { running?: boolean }): string[] {
	if (opts?.running) {
		// Live-running mock — only meaningful when liveToolPreview is on.
		if (!snap.liveToolPreview) {
			return [p.muted("(running…)  no live tail")];
		}
		return [
			p.muted("PASS auth.test.ts"),
			p.muted("PASS session.test.ts"),
			p.dim("… live tail"),
		];
	}

	if (snap.bashOutputMode === "summary") {
		return [p.muted("exit 0 · 1.2s")];
	}
	if (snap.bashOutputMode === "preview") {
		return [p.ok("✓ 12 passed (1.2s)")];
	}
	// opencode: richer
	return [
		p.ok("✓ 12 passed (1.2s)"),
		p.dim("  tests/auth.test.ts"),
		p.dim("  tests/session.test.ts"),
	];
}

/** Wrap tool body according to toolBackground style. */
function frameBody(snap: CcToolsUiSnapshot, p: Paint, body: string[], indent = ""): string[] {
	if (body.length === 0) return [];
	if (snap.toolBackground === "outlines") {
		// When already under a group branch (`│ `), skip an extra pipe so we don't
		// render `│ │ content`. Bare rows keep the classic │ body gutter.
		const gutter = indent.trim().length > 0 ? "  " : `${p.muted("│")}  `;
		const out = [indent + p.rule(40)];
		for (const line of body) out.push(`${indent}${gutter}${line}`);
		out.push(indent + p.rule(40));
		return out;
	}
	if (snap.toolBackground === "default") {
		const inner = 34;
		const out = [indent + p.muted("╭" + "─".repeat(inner + 2) + "╮")];
		for (const line of body) {
			out.push(`${indent}${p.muted("│")} ${padVisible(line, inner)} ${p.muted("│")}`);
		}
		out.push(indent + p.muted("╰" + "─".repeat(inner + 2) + "╯"));
		return out;
	}
	// transparent
	return body.map((line) => `${indent}  ${line}`);
}

function paintStandaloneTool(
	lines: string[],
	snap: CcToolsUiSnapshot,
	p: Paint,
	name: string,
	summary: string,
	body: string[],
): void {
	lines.push(`${p.ok("●")} ${p.title(name)}  ${p.accent(summary)}`);
	lines.push(...frameBody(snap, p, body));
}

function paintGrouped(lines: string[], snap: CcToolsUiSnapshot, p: Paint): void {
	const b = p.branch;
	lines.push(`${p.accent("◐")} ${p.title("2 tools")} ${p.muted("· 0.8s")}`);

	// Read glance + optional body under tee
	lines.push(`${b("├")} ${p.ok("●")} ${p.title("Read")}  ${p.accent("src/auth.ts")}`);
	const readBody = readBodyLines(snap, p);
	if (readBody.length > 0) {
		// In grouped mode, body hangs under the branch with the same tool chrome.
		const framed = frameBody(snap, p, readBody, `${b("│")} `);
		lines.push(...framed);
	}

	// Bash glance
	lines.push(`${b("└")} ${p.ok("●")} ${p.title("Bash")}  ${p.accent("npm test")}`);

	// Finished bash body (aligned under corner — use spaces matching "└ ")
	const bashFinished = bashBodyLines(snap, p);
	if (bashFinished.length > 0) {
		lines.push(...frameBody(snap, p, bashFinished, "  "));
	}

	// Optional second mock: running bash with live preview difference
	if (snap.liveToolPreview) {
		lines.push("");
		lines.push(p.dim("while running:"));
		lines.push(`${p.warn("●")} ${p.title("Bash")}  ${p.accent("npm test")} ${p.muted("(in flight)")}`);
		lines.push(...frameBody(snap, p, bashBodyLines(snap, p, { running: true }), "  "));
	}
}

function paintUngrouped(lines: string[], snap: CcToolsUiSnapshot, p: Paint): void {
	paintStandaloneTool(lines, snap, p, "Read", "src/auth.ts", readBodyLines(snap, p));
	lines.push("");
	paintStandaloneTool(lines, snap, p, "Bash", "npm test", bashBodyLines(snap, p));

	if (snap.liveToolPreview) {
		lines.push("");
		lines.push(p.dim("while running:"));
		paintStandaloneTool(
			lines,
			snap,
			p,
			"Bash",
			"npm test",
			bashBodyLines(snap, p, { running: true }),
		);
	}
}

/** ASCII mock of the tool chrome for the current snapshot. */
export function buildCcToolsPreview(snap: CcToolsUiSnapshot, theme: Theme, focusId?: string): string[] {
	const p = makePaint(theme, snap);
	const lines: string[] = [];

	lines.push(p.muted("Preview — updates when you cycle a value"));
	if (focusId) {
		const focused = SETTING_ORDER.find((s) => s.id === focusId);
		if (focused) {
			lines.push(p.accent(`changed: ${focused.label} → ${focused.current(snap)}`));
			lines.push(p.dim(focused.describe(snap)));
		}
	}
	lines.push("");

	if (snap.groupToolCalls) paintGrouped(lines, snap, p);
	else paintUngrouped(lines, snap, p);

	lines.push("");
	lines.push(p.title("Assistant list"));
	const bullet = snap.assistantListBulletStyle === "dash" ? "-" : "◉";
	lines.push(`  ${bullet} first item`);
	lines.push(`  ${bullet} second item`);

	lines.push("");
	// Footer chips — always reflect every setting so nothing is "invisible".
	const chips = [
		`style=${snap.toolBackground}`,
		`group=${boolLabel(snap.groupToolCalls)}`,
		`detail=${boolLabel(snap.extraToolOutputExpanded)}`,
		`branch=${snap.branchPreset}`,
		`bullets=${snap.assistantListBulletStyle}`,
		`theme=${boolLabel(snap.themeAdaptive)}`,
		`live=${boolLabel(snap.liveToolPreview)}`,
		`read=${snap.readOutputMode}`,
		`bash=${snap.bashOutputMode}`,
	];
	lines.push(p.dim(chips.join(" · ")));

	// Theme-adaptive visual cue: different rule style already; call it out.
	lines.push(
		p.dim(
			snap.themeAdaptive
				? "rules use ─ (theme-adaptive chrome)"
				: "rules use ═ (fixed Claude chrome)",
		),
	);

	return lines;
}

function toSettingItems(snap: CcToolsUiSnapshot): SettingItem[] {
	return SETTING_ORDER.map((def) => ({
		id: def.id,
		label: def.label,
		currentValue: def.current(snap),
		values: [...def.values],
		description: def.describe(snap),
	}));
}

type PanelComponent = {
	render: (width: number) => string[];
	invalidate: () => void;
	handleInput: (data: string) => void;
};

/**
 * Open the interactive settings overlay. Resolves when the user closes it.
 */
export async function openCcToolsSettingsPanel(
	ctx: any,
	controller: CcToolsSettingsController,
): Promise<void> {
	if (!ctx?.hasUI) {
		ctx?.ui?.notify?.("/cc-tools UI requires TUI mode", "error");
		return;
	}

	await ctx.ui.custom(
		(_tui: unknown, theme: Theme, _kb: unknown, done: (value?: undefined) => void) => {
			let snap = controller.getSnapshot();
			let lastChangedId: string | undefined;
			let list: SettingsList = createList();
			let cacheWidth: number | undefined;
			let cacheLines: string[] | undefined;

			function createList(): SettingsList {
				return new SettingsList(
					toSettingItems(snap),
					Math.min(SETTING_ORDER.length + 2, 12),
					getSettingsListTheme(),
					(id, newValue) => {
						controller.apply(id, newValue, ctx);
						snap = controller.getSnapshot();
						lastChangedId = id;
						// Recreate list so descriptions refresh with the new values.
						list = createList();
						// Keep selection near the changed row.
						const idx = SETTING_ORDER.findIndex((s) => s.id === id);
						if (idx >= 0 && typeof (list as any).setSelectedIndex === "function") {
							(list as any).setSelectedIndex(idx);
						}
						cacheWidth = undefined;
						cacheLines = undefined;
						ctx.ui.requestRender?.();
					},
					() => done(undefined),
					{ enableSearch: true },
				);
			}

			const panel: PanelComponent = {
				invalidate() {
					cacheWidth = undefined;
					cacheLines = undefined;
					list.invalidate();
				},
				handleInput(data: string) {
					list.handleInput(data);
					// Any input may change selection description rendering inside list.
					cacheWidth = undefined;
					cacheLines = undefined;
				},
				render(width: number) {
					if (cacheLines && cacheWidth === width) return cacheLines;

					const header = [
						safeFg(theme, "accent", theme.bold?.("cc-tools settings") ?? "cc-tools settings") +
							safeFg(theme, "muted", "  enter/space cycle · esc close · type to search"),
						"",
					];
					const listLines = list.render(width);
					const gap = [""];
					const hint = [
						safeFg(
							theme,
							"dim",
							"Changes apply live. Preview below mirrors the current combination.",
						),
						"",
					];
					const previewLines = buildCcToolsPreview(snap, theme, lastChangedId);

					const out = [...header, ...listLines, ...gap, ...hint, ...previewLines];
					cacheWidth = width;
					cacheLines = out;
					return out;
				},
			};

			return panel;
		},
		{
			overlay: true,
			overlayOptions: {
				anchor: "bottom-center",
				width: "100%",
				maxHeight: "90%",
				margin: { left: 0, right: 0, bottom: 0 },
			},
		},
	);
}
