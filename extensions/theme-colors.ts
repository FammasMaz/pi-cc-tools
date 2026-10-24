// Concrete colors from the active pi theme, and a Shiki theme built from them.
//
// Pi >= 1.4 exposes `theme.appearance` ("dark" | "light") and `theme.colors`
// (concrete colors for every token, with tokens set to "" filled from the
// terminal's reported default colors). Older pi versions only expose ANSI
// escapes, so every helper here returns null when that API is missing and the
// callers fall back to parsing `getFgAnsi()` / `getBgAnsi()`.

import * as PiTui from "@earendil-works/pi-tui";

export type Rgb = { r: number; g: number; b: number };

export function rgbToHex({ r, g, b }: Rgb): string {
	const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
	return `#${h(r)}${h(g)}${h(b)}`;
}

/** Linear sRGB mix: `amount` 0 returns `a`, 1 returns `b`. */
export function mixRgb(a: Rgb, b: Rgb, amount: number): Rgb {
	return {
		r: a.r + (b.r - a.r) * amount,
		g: a.g + (b.g - a.g) * amount,
		b: a.b + (b.b - a.b) * amount,
	};
}

function relativeLuminance({ r, g, b }: Rgb): number {
	const lin = (c: number) => {
		const v = c / 255;
		return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio, 1-21. */
export function contrastRatio(a: Rgb, b: Rgb): number {
	const la = relativeLuminance(a);
	const lb = relativeLuminance(b);
	return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * The color between `background` and `foreground` that has `ratio` contrast
 * against the background, so chrome keeps the same visual weight on dark,
 * light, and low-contrast themes. Returns the foreground if it cannot reach it.
 */
export function blendForContrast(background: Rgb, foreground: Rgb, ratio: number): Rgb {
	if (contrastRatio(background, foreground) <= ratio) return foreground;
	let lo = 0;
	let hi = 1;
	for (let i = 0; i < 18; i++) {
		const mid = (lo + hi) / 2;
		if (contrastRatio(background, mixRgb(background, foreground, mid)) < ratio) lo = mid;
		else hi = mid;
	}
	return mixRgb(background, foreground, hi);
}

/** Pi Color value ({ kind: "rgb" | "oklch" | "indexed", ... }) to RGB. */
function colorValueToRgb(color: any): Rgb | null {
	if (!color || typeof color !== "object") return null;
	const toRgb = (PiTui as any).colorToRgb;
	if (typeof toRgb === "function") {
		try {
			const rgb = toRgb(color);
			if (rgb && Number.isFinite(rgb.r)) return { r: rgb.r, g: rgb.g, b: rgb.b };
		} catch { /* fall through */ }
	}
	if (color.kind === "rgb" && Number.isFinite(color.r)) return { r: color.r, g: color.g, b: color.b };
	return null;
}

/** Concrete RGB for a theme token, or null on pi versions without `theme.colors`. */
export function themeTokenRgb(theme: any, token: string): Rgb | null {
	try {
		return colorValueToRgb(theme?.colors?.[token]);
	} catch {
		return null;
	}
}

/** "light" / "dark" as pi decides it, or undefined on pi versions without `theme.appearance`. */
export function themeAppearance(theme: any): "light" | "dark" | undefined {
	try {
		const appearance = theme?.appearance;
		return appearance === "light" || appearance === "dark" ? appearance : undefined;
	} catch {
		return undefined;
	}
}

// A copy of the active theme with every token set to "" (terminal default).
// Pi fills those from the terminal's reported default colors, which is the
// only public way to read the terminal background. Built from the active
// theme's own class so it reads the same module state as pi.
const probeCache = new WeakMap<object, any>();

function terminalDefaultsProbe(theme: any): any | null {
	try {
		const fg = theme?.fgAnsi;
		const bg = theme?.bgAnsi;
		const Ctor = theme?.constructor;
		if (!(fg instanceof Map) || !(bg instanceof Map) || typeof Ctor !== "function") return null;
		const key = fg as object;
		let probe = probeCache.get(key);
		if (!probe) {
			const blank = (map: Map<string, unknown>) => Object.fromEntries([...map.keys()].map((k) => [k, ""]));
			const mode = typeof theme.getColorMode === "function" ? theme.getColorMode() : "truecolor";
			probe = new Ctor(blank(fg), blank(bg), mode, { appearance: themeAppearance(theme) });
			probeCache.set(key, probe);
		}
		return probe;
	} catch {
		return null;
	}
}

/**
 * The terminal's default background and foreground as pi knows them (reported
 * by the terminal, or pi's guess for the theme's appearance). Null on pi
 * versions without `theme.colors`.
 */
export function terminalDefaultColors(theme: any): { background: Rgb; foreground: Rgb } | null {
	const probe = terminalDefaultsProbe(theme);
	if (!probe) return null;
	const background = themeTokenRgb(probe, "userMessageBg");
	const foreground = themeTokenRgb(probe, "text");
	return background && foreground ? { background, foreground } : null;
}

/** ANSI foreground escape for an RGB color in the theme's color mode (truecolor or 256). */
export function rgbFgAnsi(theme: any, c: Rgb): string {
	const mode = typeof theme?.getColorMode === "function" ? theme.getColorMode() : "truecolor";
	const fgAnsi = (PiTui as any).foregroundAnsi;
	const rgbColor = (PiTui as any).rgbColor;
	if (mode !== "truecolor" && typeof fgAnsi === "function" && typeof rgbColor === "function") {
		try {
			return fgAnsi(rgbColor(Math.round(c.r), Math.round(c.g), Math.round(c.b)), mode);
		} catch { /* fall through */ }
	}
	return `\x1b[38;2;${Math.round(c.r)};${Math.round(c.g)};${Math.round(c.b)}m`;
}

/** ANSI background escape for an RGB color in the theme's color mode (truecolor or 256). */
export function rgbBgAnsi(theme: any, c: Rgb): string {
	const mode = typeof theme?.getColorMode === "function" ? theme.getColorMode() : "truecolor";
	const bgAnsi = (PiTui as any).backgroundAnsi;
	const rgbColor = (PiTui as any).rgbColor;
	if (mode !== "truecolor" && typeof bgAnsi === "function" && typeof rgbColor === "function") {
		try {
			return bgAnsi(rgbColor(Math.round(c.r), Math.round(c.g), Math.round(c.b)), mode);
		} catch { /* fall through */ }
	}
	return `\x1b[48;2;${Math.round(c.r)};${Math.round(c.g)};${Math.round(c.b)}m`;
}

// ---------------------------------------------------------------------------
// Shiki theme from the pi theme's syntax colors, so diff previews highlight
// code the same way pi highlights Markdown code blocks. The scope mapping
// mirrors pi's own highlight.js mapping (keyword, type, number, string,
// comment, function, variable, operator, punctuation).
// ---------------------------------------------------------------------------

export interface ShikiThemeRegistration {
	name: string;
	type: "dark" | "light";
	fg: string;
	bg: string;
	settings: Array<{ scope?: string[]; settings: { foreground?: string; background?: string; fontStyle?: string } }>;
}

const SHIKI_SCOPES: Array<[token: string, scopes: string[], fontStyle?: string]> = [
	["syntaxComment", ["comment", "punctuation.definition.comment", "string.comment"]],
	["syntaxKeyword", [
		"keyword", "storage", "storage.type", "storage.modifier", "keyword.control",
		"variable.language", "entity.name.tag", "support.type.property-name.json",
	]],
	["syntaxOperator", ["keyword.operator", "keyword.operator.assignment", "keyword.operator.arithmetic", "keyword.operator.logical", "keyword.operator.comparison"]],
	["syntaxPunctuation", ["punctuation", "meta.brace", "meta.delimiter", "punctuation.definition.tag", "punctuation.separator", "punctuation.terminator"]],
	["syntaxString", ["string", "string.quoted", "string.template", "string.regexp"]],
	["syntaxNumber", ["constant.numeric", "constant.language", "constant.character", "constant.other", "support.constant"]],
	["syntaxFunction", ["entity.name.function", "support.function", "meta.function-call.generic", "variable.function"]],
	["syntaxType", [
		"entity.name.type", "entity.name.class", "entity.name.namespace", "entity.other.inherited-class",
		"support.type", "support.class", "storage.type.primitive", "storage.type.built-in",
	]],
	["syntaxVariable", ["variable.parameter", "entity.other.attribute-name", "meta.object-literal.key"]],
	["mdHeading", ["markup.heading", "entity.name.section"], "bold"],
	["mdLink", ["markup.underline.link", "string.other.link"]],
	["mdCode", ["markup.inline.raw", "markup.inline.raw.string", "markup.fenced_code", "markup.raw"]],
	["mdListBullet", ["punctuation.definition.list"]],
	["toolDiffAdded", ["markup.inserted"]],
	["toolDiffRemoved", ["markup.deleted"]],
];

let shikiCache: { key: string; theme: ShikiThemeRegistration } | null = null;

/** Shiki theme from the active pi theme, or null when concrete colors are unavailable. */
export function shikiThemeFromPiTheme(theme: any): ShikiThemeRegistration | null {
	const defaults = terminalDefaultColors(theme);
	const text = themeTokenRgb(theme, "text") ?? defaults?.foreground ?? null;
	const appearance = themeAppearance(theme);
	if (!text || !appearance) return null;
	const background = defaults?.background ?? (appearance === "light" ? { r: 255, g: 255, b: 255 } : { r: 0, g: 0, b: 0 });

	const entries: Array<[string, string]> = [];
	for (const [token] of SHIKI_SCOPES) {
		const rgb = themeTokenRgb(theme, token);
		if (rgb) entries.push([token, rgbToHex(rgb)]);
	}
	if (entries.length === 0) return null;
	const colors = Object.fromEntries(entries) as Record<string, string>;
	const fg = rgbToHex(text);
	const bg = rgbToHex(background);
	const key = `${appearance}|${fg}|${bg}|${entries.map(([k, v]) => `${k}=${v}`).join(",")}`;
	if (shikiCache?.key === key) return shikiCache.theme;

	let hash = 2166136261;
	for (let i = 0; i < key.length; i++) {
		hash ^= key.charCodeAt(i);
		hash = Math.imul(hash, 16777619) >>> 0;
	}
	const settings: ShikiThemeRegistration["settings"] = [{ settings: { foreground: fg, background: bg } }];
	for (const [token, scopes, fontStyle] of SHIKI_SCOPES) {
		const color = colors[token];
		if (!color) continue;
		settings.push({ scope: scopes, settings: fontStyle ? { foreground: color, fontStyle } : { foreground: color } });
	}
	settings.push({ scope: ["markup.bold"], settings: { fontStyle: "bold" } });
	settings.push({ scope: ["markup.italic"], settings: { fontStyle: "italic" } });

	const registration: ShikiThemeRegistration = {
		// Shiki caches themes by name, so the name changes with the colors.
		name: `pi-theme-${hash.toString(16).padStart(8, "0")}`,
		type: appearance,
		fg,
		bg,
		settings,
	};
	shikiCache = { key, theme: registration };
	return registration;
}
