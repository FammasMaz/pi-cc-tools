// Follow the terminal's own colors (Ghostty, Rex, kitty, WezTerm, ...).
//
// Pi's built-in `system` theme already builds every color from the palette the
// terminal reports (OSC 4/10/11) and rebuilds it when the terminal announces a
// light/dark switch (DEC mode 2031). Terminals announce nothing when you switch
// between two themes of the same kind, for example from one dark Rex theme to
// another. So whenever the terminal regains focus (you went to its settings and
// came back) we ask it for its color scheme (DSR 996). Pi's own handler treats
// the reply like a light/dark report and re-reads the palette, and it only
// re-renders when the colors actually changed.

const FOCUS_IN = "\x1b[I";
const FOCUS_OUT = "\x1b[O";
const ENABLE_FOCUS_REPORTING = "\x1b[?1004h";
const DISABLE_FOCUS_REPORTING = "\x1b[?1004l";
const REQUEST_COLOR_SCHEME = "\x1b[?996n";
const MIN_REQUEST_INTERVAL_MS = 250;

export const SYSTEM_THEME_NAME = "system";

export interface TerminalIo {
	/** Raw terminal input. Defaults to process.stdin. */
	input: { on(event: "data", listener: (chunk: unknown) => void): unknown };
	/** Writes escape sequences to the terminal. Defaults to process.stdout when it is a TTY. */
	write(data: string): void;
}

interface FocusResyncState {
	io?: TerminalIo;
	stdinListener?: (chunk: unknown) => void;
	unsubscribeInput?: () => void;
	exitHook?: () => void;
	lastRequestAt: number;
	isEnabled: () => boolean;
}

// Kept on globalThis so /reload (which re-evaluates this module) replaces the
// previous listeners instead of stacking them.
const STATE_KEY = Symbol.for("pi-claude-style-tools:terminal-theme-focus");

function state(): FocusResyncState {
	const g = globalThis as any;
	if (!g[STATE_KEY]) g[STATE_KEY] = { lastRequestAt: 0, isEnabled: () => false } satisfies FocusResyncState;
	return g[STATE_KEY] as FocusResyncState;
}

const processIo: TerminalIo = {
	input: process.stdin,
	write(data: string): void {
		try {
			if (process.stdout.isTTY) process.stdout.write(data);
		} catch { /* terminal gone */ }
	},
};

function write(data: string): void {
	(state().io ?? processIo).write(data);
}

/** Ask the terminal to report its light/dark scheme; pi re-reads the palette on the reply. */
export function requestTerminalColorScheme(): void {
	const s = state();
	const now = Date.now();
	if (now - s.lastRequestAt < MIN_REQUEST_INTERVAL_MS) return;
	s.lastRequestAt = now;
	write(REQUEST_COLOR_SCHEME);
}

/**
 * Re-read the terminal palette whenever the terminal regains focus.
 *
 * Fullscreen pi already turns on focus reporting and consumes the focus events
 * before extensions see them, so focus-in is detected by watching stdin
 * directly (without consuming anything). In regular mode we turn focus
 * reporting on ourselves and consume the events so they never reach the editor.
 */
export function startFocusResync(ui: any, isEnabled: () => boolean, io: TerminalIo = processIo): void {
	const s = state();
	s.isEnabled = isEnabled;
	if (s.io && s.io !== io) {
		// A different terminal (tests): start over instead of mixing listeners.
		s.stdinListener = undefined;
		s.exitHook = undefined;
	}
	s.io = io;

	if (!s.stdinListener) {
		s.stdinListener = (chunk: unknown) => {
			const text = typeof chunk === "string" ? chunk : Buffer.isBuffer(chunk) ? chunk.toString("latin1") : "";
			if (text.includes(FOCUS_IN) && state().isEnabled()) requestTerminalColorScheme();
		};
		io.input.on("data", s.stdinListener);
	}

	// Pi drops extension input listeners on /reload and session replacement; re-register each time.
	s.unsubscribeInput?.();
	s.unsubscribeInput = undefined;
	if (typeof ui?.onTerminalInput === "function") {
		try {
			s.unsubscribeInput = ui.onTerminalInput((data: string) =>
				data === FOCUS_IN || data === FOCUS_OUT ? { consume: true } : undefined,
			);
		} catch { /* not interactive */ }
	}

	write(ENABLE_FOCUS_REPORTING);
	if (!s.exitHook && io === processIo) {
		s.exitHook = () => write(DISABLE_FOCUS_REPORTING);
		process.once("exit", s.exitHook);
	}
}

/** Theme name pi currently uses ("system" when it follows the terminal). */
export function activeThemeName(ui: any): string | undefined {
	try {
		const name = ui?.theme?.name;
		return typeof name === "string" ? name : undefined;
	} catch {
		return undefined;
	}
}

/** True when this pi version has the built-in terminal-palette theme. */
export function systemThemeAvailable(ui: any): boolean {
	try {
		if (activeThemeName(ui) === SYSTEM_THEME_NAME) return true;
		const themes = ui?.getAllThemes?.();
		return Array.isArray(themes) && themes.some((t: any) => t?.name === SYSTEM_THEME_NAME);
	} catch {
		return false;
	}
}
