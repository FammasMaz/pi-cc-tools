// Parity harness: proves extensions/ptd-diff/* renders byte-identically to the
// installed pi-tool-display@0.5.0. Both copies are loaded through jiti with the
// SAME alias map (mimicking Pi's extension loader), so they share one
// pi-tui / pi-coding-agent instance and any difference is a porting defect.
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";

const PI_AGENT_ENTRY = join(
	homedir(),
	".local/lib/node_modules/@earendil-works/pi-coding-agent/dist/index.js",
);
const piRequire = createRequire(PI_AGENT_ENTRY);
const PI_TUI_ENTRY = piRequire.resolve("@earendil-works/pi-tui");

const jiti = createJiti(import.meta.url, {
	interopDefault: true,
	alias: {
		"@earendil-works/pi-coding-agent": PI_AGENT_ENTRY,
		"@earendil-works/pi-tui": PI_TUI_ENTRY,
	},
});

const PORTED_DIR = join(import.meta.dirname, "..", "extensions", "ptd-diff");
const ORIGINAL_DIR = join(
	homedir(),
	".pi/agent/npm/node_modules/pi-tool-display/src",
);

const ported = await jiti.import(join(PORTED_DIR, "diff-renderer.ts"));
const original = await jiti.import(join(ORIGINAL_DIR, "diff-renderer.ts"));
const portedTypes = await jiti.import(join(PORTED_DIR, "types.ts"));

const DEFAULTS = portedTypes.DEFAULT_TOOL_DISPLAY_CONFIG;

// Deterministic fake theme; both sides receive the same object.
const SLOT_FG = {
	toolDiffAdded: "\x1b[38;2;88;173;88m",
	toolDiffRemoved: "\x1b[38;2;196;98;98m",
	toolDiffContext: "\x1b[38;2;150;150;150m",
	toolOutput: "\x1b[38;2;200;200;200m",
	muted: "\x1b[38;2;120;120;120m",
	dim: "\x1b[38;2;90;90;90m",
	accent: "\x1b[38;2;120;160;220m",
	warning: "\x1b[38;2;220;180;80m",
	error: "\x1b[38;2;220;80;80m",
};
const SLOT_BG = {
	toolSuccessBg: "\x1b[48;2;32;35;42m",
	toolPendingBg: "\x1b[48;2;40;40;48m",
	toolErrorBg: "\x1b[48;2;60;30;30m",
	userMessageBg: "\x1b[48;2;30;30;38m",
};
const theme = {
	fg: (slot, text) => `${SLOT_FG[slot] ?? "\x1b[38;2;255;0;255m"}${text}\x1b[39m`,
	bg: (slot, text) => `${SLOT_BG[slot] ?? ""}${text}\x1b[49m`,
	bold: (text) => `\x1b[1m${text}\x1b[22m`,
	getFgAnsi: (slot) => SLOT_FG[slot] ?? "\x1b[38;2;255;0;255m",
	getBgAnsi: (slot) => SLOT_BG[slot] ?? "",
};

const cfg = (over = {}) => ({ ...DEFAULTS, ...over });

const CONFIGS = [
	["default", cfg()],
	["unified", cfg({ diffViewMode: "unified" })],
	["split", cfg({ diffViewMode: "split" })],
	["auto-lowmin", cfg({ diffSplitMinWidth: 70 })],
	["classic", cfg({ diffIndicatorMode: "classic" })],
	["none", cfg({ diffIndicatorMode: "none" })],
	["nowrap", cfg({ diffWordWrap: false })],
	["collapsed4", cfg({ diffCollapsedLines: 4 })],
];

const WIDTHS = [6, 12, 40, 60, 130];
const EXPANDED = [false, true];

const LONG = "const veryLongIdentifierName = someFunctionCall(argumentOne, argumentTwo, argumentThree) + anotherCall(x, y, z); // trailing commentary that keeps going";

const EDIT_FIXTURES = [
	[
		"unified-small",
		[
			"@@ -1,3 +1,3 @@",
			" const a = 1;",
			"-const b = 2;",
			"+const b = 42;",
			" const c = 3;",
		].join("\n"),
	],
	[
		"unified-multihunk",
		[
			"@@ -1,4 +1,4 @@",
			" import { x } from './x.js';",
			"-import { y } from './y.js';",
			"+import { y2 } from './y2.js';",
			" import { z } from './z.js';",
			" ",
			"@@ -20,3 +20,4 @@",
			" function foo() {",
			"-  return y(1);",
			"+  return y2(1);",
			"+  // extra line",
			" }",
		].join("\n"),
	],
	[
		"canonical-pipes",
		[
			"-|10|const old = compute();",
			"+|10|const fresh = compute();",
			"+|11|log(fresh);",
		].join("\n"),
	],
	[
		"hashline-anchors",
		[
			"-  12#a1b2c3:const removed = true;",
			"+  12#d4e5f6:const added = true;",
			"   13#ffffff:const kept = 1;",
		].join("\n"),
	],
	["empty", ""],
	[
		"long-lines",
		["@@ -1,2 +1,2 @@", `-${LONG}`, `+${LONG.replace("42", "43")} /* changed */`].join(
			"\n",
		),
	],
];

const SMALL_FILE = "line one\nline two\nline three\n";
const OLD_FILE = "alpha\nbeta\ngamma\ndelta\n";
const NEW_FILE = "alpha\nBETA\ngamma\ndelta\nepsilon\n";
const HUGE_OLD = Array.from({ length: 4001 }, (_, i) => `old line ${i}`).join("\n");
const LONG_FILE = `${LONG}\nshort\n${LONG}\n`;

const WRITE_FIXTURES = [
	["create-small", SMALL_FILE, { fileExistedBeforeWrite: false }],
	[
		"overwrite",
		NEW_FILE,
		{ previousContent: OLD_FILE, fileExistedBeforeWrite: true },
	],
	["empty-content", "", { fileExistedBeforeWrite: false }],
	[
		"huge-overwrite-omitted",
		"tiny\n",
		{ previousContent: HUGE_OLD, fileExistedBeforeWrite: true },
	],
	["create-long-lines", LONG_FILE, { fileExistedBeforeWrite: false }],
	[
		"pending-label",
		NEW_FILE,
		{
			previousContent: OLD_FILE,
			fileExistedBeforeWrite: true,
			headerLabel: "pending overwrite",
		},
	],
];

let cases = 0;
let failures = 0;
const failDetails = [];

function renderLines(component, width) {
	try {
		return component.render(width);
	} catch (error) {
		return [`<<render threw: ${error?.message ?? error}>>`];
	}
}

function compare(label, makePorted, makeOriginal, width) {
	cases++;
	const a = renderLines(makePorted(), width);
	const b = renderLines(makeOriginal(), width);
	if (JSON.stringify(a) !== JSON.stringify(b)) {
		failures++;
		if (failDetails.length < 5) {
			failDetails.push({ label, width, ported: a, original: b });
		}
	}
}

for (const [fixtureName, diff] of EDIT_FIXTURES) {
	const details = diff === "" ? {} : { diff };
	for (const [cfgName, config] of CONFIGS) {
		for (const expanded of EXPANDED) {
			const options = { expanded, filePath: "src/example.ts" };
			for (const width of WIDTHS) {
				compare(
					`edit/${fixtureName}/${cfgName}/exp=${expanded}`,
					() => ported.renderEditDiffResult(details, options, config, theme, "fallback text"),
					() => original.renderEditDiffResult(details, options, config, theme, "fallback text"),
					width,
				);
			}
		}
	}
}

for (const [fixtureName, content, extra] of WRITE_FIXTURES) {
	for (const [cfgName, config] of CONFIGS) {
		for (const expanded of EXPANDED) {
			const options = { expanded, filePath: "src/example.ts", ...extra };
			for (const width of WIDTHS) {
				compare(
					`write/${fixtureName}/${cfgName}/exp=${expanded}`,
					() => ported.renderWriteDiffResult(content, options, config, theme, "fallback text"),
					() => original.renderWriteDiffResult(content, options, config, theme, "fallback text"),
					width,
				);
			}
		}
	}
}

// undefined content → fallback path
compare(
	"write/undefined-content/default/exp=false",
	() => ported.renderWriteDiffResult(undefined, { expanded: false }, cfg(), theme, "fallback text"),
	() => original.renderWriteDiffResult(undefined, { expanded: false }, cfg(), theme, "fallback text"),
	80,
);

console.log(`parity cases: ${cases}, failures: ${failures}`);
for (const f of failDetails) {
	console.log(`\n--- MISMATCH ${f.label} width=${f.width}`);
	console.log("ported:  ", JSON.stringify(f.ported).slice(0, 400));
	console.log("original:", JSON.stringify(f.original).slice(0, 400));
}
process.exit(failures === 0 ? 0 : 1);
