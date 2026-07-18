/**
 * Interactive /cc-tools settings overlay with live ASCII previews.
 */
import { getSettingsListTheme, type Theme } from "@earendil-works/pi-coding-agent";
import {
	Container,
	SettingsList,
	Text,
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
				? "Horizontal rules around each tool row"
				: s.toolBackground === "transparent"
					? "No borders or backgrounds"
					: "Pi built-in tool backgrounds",
	},
	{
		id: "groupToolCalls",
		label: "Group tools",
		values: ["on", "off"],
		current: (s) => (s.groupToolCalls ? "on" : "off"),
		describe: () => "Collapse adjacent/concurrent tool calls under one header",
	},
	{
		id: "extraToolOutputExpanded",
		label: "Extra detail",
		values: ["on", "off"],
		current: (s) => (s.extraToolOutputExpanded ? "on" : "off"),
		describe: () => "Ctrl+Shift+O mode — higher expand caps for tool output",
	},
	{
		id: "branchPreset",
		label: "Branch color",
		values: ["theme", "fixed-72", "fixed-110", "fixed-40"],
		current: (s) => s.branchPreset,
		describe: (s) =>
			s.branchPreset === "theme"
				? "├ └ │ follow pi theme dim/muted"
				: `├ └ │ fixed rgb gray (${s.branchPreset.replace("fixed-", "")})`,
	},
	{
		id: "assistantListBulletStyle",
		label: "List bullets",
		values: ["fisheye", "dash"],
		current: (s) => s.assistantListBulletStyle,
		describe: (s) =>
			s.assistantListBulletStyle === "dash"
				? 'Assistant unordered lists keep plain "-"'
				: "Assistant unordered lists use monochrome ◉",
	},
	{
		id: "themeAdaptive",
		label: "Theme adaptive",
		values: ["on", "off"],
		current: (s) => (s.themeAdaptive ? "on" : "off"),
		describe: () => "Borders / diffs / muted text follow the active pi theme",
	},
	{
		id: "liveToolPreview",
		label: "Live preview",
		values: ["on", "off"],
		current: (s) => (s.liveToolPreview ? "on" : "off"),
		describe: () => "Show a few output lines while tools are still running",
	},
	{
		id: "readOutputMode",
		label: "Read output",
		values: ["preview", "summary", "hidden"],
		current: (s) => s.readOutputMode,
		describe: () => "How finished read tool results are shown when collapsed",
	},
	{
		id: "bashOutputMode",
		label: "Bash output",
		values: ["opencode", "preview", "summary"],
		current: (s) => s.bashOutputMode,
		describe: () => "How finished bash results are shown when collapsed",
	},
];

function boolLabel(on: boolean): string {
	return on ? "on" : "off";
}

function pad(text: string, width: number): string {
	if (text.length >= width) return text.slice(0, width);
	return text + " ".repeat(width - text.length);
}

/** ASCII mock of the tool chrome for the current snapshot. */
export function buildCcToolsPreview(snap: CcToolsUiSnapshot, theme: Theme, focusId?: string): string[] {
	const muted = (t: string) => theme.fg("muted", t);
	const accent = (t: string) => theme.fg("accent", t);
	const dim = (t: string) => theme.fg("dim", t);
	const title = (t: string) => theme.fg("toolTitle", theme.bold(t));
	const ok = (t: string) => theme.fg("success", t);

	const bullet = snap.assistantListBulletStyle === "dash" ? "-" : "◉";
	const branch = snap.branchPreset === "theme" ? dim : (t: string) => theme.fg("muted", t);
	const rule = (w: number) => muted("─".repeat(Math.max(8, Math.min(w, 42))));

	const lines: string[] = [];
	lines.push(muted("Preview  (updates when you change a value)"));
	if (focusId) {
		const focused = SETTING_ORDER.find((s) => s.id === focusId);
		if (focused) lines.push(dim(`focus: ${focused.label} = ${focused.current(snap)}`));
	}
	lines.push("");

	// Grouped header mock
	if (snap.groupToolCalls) {
		lines.push(`${accent("◐")} ${title("2 tools")} ${muted("· 0.8s")}`);
		lines.push(`${branch("├")} ${ok("●")} ${title("Read")}  ${accent("src/auth.ts")}`);
		if (snap.readOutputMode === "preview") {
			lines.push(`${branch("│")}    ${dim("1  export function login() {")}`);
			lines.push(`${branch("│")}    ${dim("2    return token")}`);
			if (snap.extraToolOutputExpanded) {
				lines.push(`${branch("│")}    ${muted("… extra-detail ON (higher expand cap)")}`);
			} else {
				lines.push(`${branch("│")}    ${muted("… +12 lines  (ctrl+o)")}`);
			}
		} else if (snap.readOutputMode === "summary") {
			lines.push(`${branch("│")}    ${muted("14 lines")}`);
		}
		lines.push(`${branch("└")} ${ok("●")} ${title("Bash")}  ${accent("npm test")}`);
	} else {
		// Ungrouped rows with optional outlines
		const paintTool = (name: string, summary: string, body: string[]) => {
			lines.push(`${ok("●")} ${title(name)}  ${accent(summary)}`);
			if (snap.toolBackground === "outlines") {
				lines.push(rule(40));
				for (const b of body) lines.push(`${muted("│")}  ${b}`);
				lines.push(rule(40));
			} else if (snap.toolBackground === "default") {
				lines.push(muted("╭" + "─".repeat(36) + "╮"));
				for (const b of body) lines.push(`${muted("│")}  ${pad(b, 34)}  ${muted("│")}`);
				lines.push(muted("╰" + "─".repeat(36) + "╯"));
			} else {
				for (const b of body) lines.push(`   ${b}`);
			}
			lines.push("");
		};

		const readBody =
			snap.readOutputMode === "hidden"
				? []
				: snap.readOutputMode === "summary"
					? [muted("14 lines")]
					: [dim("1  export function login() {"), dim("2    return token"), muted("… +12 lines")];
		paintTool("Read", "src/auth.ts", readBody);

		const bashBody =
			snap.bashOutputMode === "summary"
				? [muted("exit 0 · 1.2s")]
				: snap.bashOutputMode === "preview"
					? [ok("✓ 12 passed (1.2s)")]
					: [ok("✓ 12 passed (1.2s)"), dim("  tests/auth.test.ts")];
		if (snap.liveToolPreview && snap.bashOutputMode !== "summary") {
			// show a live-ish tail hint
			bashBody.unshift(muted("(live tail while running)"));
		}
		paintTool("Bash", "npm test", bashBody);
	}

	if (snap.groupToolCalls) {
		// body under bash in grouped mode
		if (snap.toolBackground === "outlines") {
			lines.push(rule(40));
			const bashLine =
				snap.bashOutputMode === "summary" ? muted("exit 0 · 1.2s") : ok("✓ 12 passed (1.2s)");
			lines.push(`${muted("│")}  ${bashLine}`);
			if (snap.liveToolPreview) lines.push(`${muted("│")}  ${muted("(live tail while running)")}`);
			lines.push(rule(40));
		} else {
			const bashLine =
				snap.bashOutputMode === "summary" ? muted("exit 0 · 1.2s") : ok("✓ 12 passed (1.2s)");
			lines.push(`     ${bashLine}`);
		}
		lines.push("");
	}

	// List bullet sample
	lines.push(title("Assistant list"));
	lines.push(`  ${bullet} first item`);
	lines.push(`  ${bullet} second item`);
	lines.push("");
	lines.push(
		dim(
			`theme-adaptive: ${boolLabel(snap.themeAdaptive)} · branch: ${snap.branchPreset} · style: ${snap.toolBackground}`,
		),
	);

	return lines;
}

function toSettingItems(snap: CcToolsUiSnapshot): SettingItem[] {
	return SETTING_ORDER.map((def) => ({
		id: def.id,
		label: def.label,
		currentValue: def.current(snap),
		values: def.values,
		description: def.describe(snap),
	}));
}

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

			const title = new Text("", 0, 0);
			const hint = new Text("", 0, 0);
			const preview = new Text("", 0, 0);

			const paintChrome = () => {
				title.setText(
					[
						theme.fg("accent", theme.bold("cc-tools settings")),
						theme.fg("muted", "  enter/space cycle · esc close · type to search"),
					].join(""),
				);
				hint.setText(
					theme.fg(
						"dim",
						"Changes apply live. Preview below mirrors the current combination.",
					),
				);
				preview.setText(buildCcToolsPreview(snap, theme, lastChangedId).join("\n"));
			};
			paintChrome();

			const list = new SettingsList(
				toSettingItems(snap),
				Math.min(SETTING_ORDER.length + 2, 12),
				getSettingsListTheme(),
				(id, newValue) => {
					controller.apply(id, newValue, ctx);
					snap = controller.getSnapshot();
					lastChangedId = id;
					// Refresh list values + descriptions for the new snapshot
					for (const def of SETTING_ORDER) {
						list.updateValue(def.id, def.current(snap));
					}
					// Rebuild items' descriptions by replacing list — SettingsList has no setItems.
					// updateValue only changes currentValue; description stays stale.
					// Work around: recreate is heavy; embed current value in preview instead.
					paintChrome();
					container.invalidate();
					ctx.ui.requestRender?.();
				},
				() => done(undefined),
				{ enableSearch: true },
			);

			const container = new Container();
			container.addChild(title);
			container.addChild(new Text("", 0, 0));
			container.addChild(list);
			container.addChild(new Text("", 0, 0));
			container.addChild(hint);
			container.addChild(new Text("", 0, 0));
			container.addChild(preview);

			return {
				render: (width: number) => container.render(width),
				invalidate: () => container.invalidate(),
				handleInput: (data: string) => list.handleInput(data),
			};
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
