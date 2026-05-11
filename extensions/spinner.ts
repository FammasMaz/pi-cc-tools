import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Loader } from "@mariozechner/pi-tui";

// ---------------------------------------------------------------------------
// Patch built-in Loader with Claude/OpenBrawd-style glyphs.
// Keep animation cadence constant so the spinner doesn't appear to slow down
// or freeze as the session grows.
// ---------------------------------------------------------------------------

const RAW_ANSI_RE = /\x1b\[[0-9;]*m/;
const RESET = "\x1b[0m";
const CLAUDE_ORANGE = "\x1b[38;2;215;119;87m";
const STATUS_DIM = "\x1b[38;2;153;153;153m";

// Match OpenBrawd's spinner glyph set, with the final Ghostty frame restored
// to ✽ because the user's font-codepoint-map now centers it correctly.
function getDefaultSpinnerCharacters(): string[] {
	if (process.env.TERM === "xterm-ghostty") {
		return ["·", "✢", "✳", "✶", "✻", "✽"];
	}
	return process.platform === "darwin"
		? ["·", "✢", "✳", "✶", "✻", "✽"]
		: ["·", "✢", "*", "✶", "✻", "✽"];
}

const SPINNER_CHARS = getDefaultSpinnerCharacters();
const OB_FRAMES = [...SPINNER_CHARS, ...[...SPINNER_CHARS].reverse()];
const LOADER_INTERVAL_MS = 250;
const LOADER_LAST_TEXT = Symbol.for("pi-claude-style-tools:loader-last-text");
const LOADER_ACTIVE = Symbol.for("pi-claude-style-tools:loader-active");
const LOADER_GENERATION = Symbol.for("pi-claude-style-tools:loader-generation");
const ACTIVE_UI_SYMBOL = Symbol.for("pi-claude-style-tools:active-ui");

function getLoaderIntervalMs(_loader: any): number {
	return LOADER_INTERVAL_MS;
}

function unrefTimer(timer: ReturnType<typeof setTimeout> | null | undefined): void {
	(timer as any)?.unref?.();
}

(Loader.prototype as any).updateDisplay = function patchedUpdateDisplay() {
	const frame = OB_FRAMES[this.currentFrame % OB_FRAMES.length];
	const message = typeof this.message === "string" && RAW_ANSI_RE.test(this.message)
		? this.message
		: this.messageColorFn(this.message);
	const nextText = `${this.spinnerColorFn(frame)} ${message}`;
	if ((this as any)[LOADER_LAST_TEXT] === nextText) return;
	(this as any)[LOADER_LAST_TEXT] = nextText;
	this.setText(nextText);
	if (this.ui && !(this.ui as any).stopped) {
		(globalThis as any)[ACTIVE_UI_SYMBOL] = this.ui;
		this.ui.requestRender();
	}
};

Loader.prototype.start = function patchedStart() {
	this.stop();
	(this as any)[LOADER_ACTIVE] = true;
	const generation = ((this as any)[LOADER_GENERATION] ?? 0) + 1;
	(this as any)[LOADER_GENERATION] = generation;
	delete (this as any)[LOADER_LAST_TEXT];
	(this as any).updateDisplay();
	const scheduleNext = () => {
		if ((this as any)[LOADER_ACTIVE] !== true || (this as any)[LOADER_GENERATION] !== generation) return;
		const intervalMs = getLoaderIntervalMs(this);
		const timer = setTimeout(() => {
			(this as any).intervalId = null;
			if ((this as any)[LOADER_ACTIVE] !== true || (this as any)[LOADER_GENERATION] !== generation) return;
			(this as any).currentFrame = ((this as any).currentFrame + 1) % OB_FRAMES.length;
			(this as any).updateDisplay();
			scheduleNext();
		}, intervalMs);
		unrefTimer(timer);
		(this as any).intervalId = timer;
	};
	scheduleNext();
};

Loader.prototype.stop = function patchedStop() {
	(this as any)[LOADER_ACTIVE] = false;
	(this as any)[LOADER_GENERATION] = ((this as any)[LOADER_GENERATION] ?? 0) + 1;
	if ((this as any).intervalId) {
		clearTimeout((this as any).intervalId);
		(this as any).intervalId = null;
	}
};

// ---------------------------------------------------------------------------
// Spinner verbs — fun/whimsical loading messages (different set from OpenBrawd)
// ---------------------------------------------------------------------------

const SPINNER_VERBS = [
	"Accomplishing",
	"Actioning",
	"Actualizing",
	"Architecting",
	"Baking",
	"Beaming",
	"Beboppin'",
	"Befuddling",
	"Billowing",
	"Blanching",
	"Bloviating",
	"Boogieing",
	"Boondoggling",
	"Booping",
	"Bootstrapping",
	"Brewing",
	"Bunning",
	"Burrowing",
	"Calculating",
	"Canoodling",
	"Caramelizing",
	"Cascading",
	"Catapulting",
	"Cerebrating",
	"Channeling",
	"Choreographing",
	"Churning",
	"Coalescing",
	"Cogitating",
	"Combobulating",
	"Composing",
	"Computing",
	"Concocting",
	"Considering",
	"Contemplating",
	"Cooking",
	"Crafting",
	"Creating",
	"Crunching",
	"Crystallizing",
	"Cultivating",
	"Deciphering",
	"Deliberating",
	"Determining",
	"Dilly-dallying",
	"Discombobulating",
	"Doodling",
	"Drizzling",
	"Ebbing",
	"Effecting",
	"Elucidating",
	"Embellishing",
	"Enchanting",
	"Envisioning",
	"Evaporating",
	"Fermenting",
	"Fiddle-faddling",
	"Finagling",
	"Flambéing",
	"Flibbertigibbeting",
	"Flowing",
	"Flummoxing",
	"Fluttering",
	"Forging",
	"Forming",
	"Frolicking",
	"Frosting",
	"Gallivanting",
	"Galloping",
	"Garnishing",
	"Generating",
	"Gesticulating",
	"Germinating",
	"Grooving",
	"Gusting",
	"Harmonizing",
	"Hashing",
	"Hatching",
	"Herding",
	"Hullaballooing",
	"Hyperspacing",
	"Ideating",
	"Imagining",
	"Improvising",
	"Incubating",
	"Inferring",
	"Infusing",
	"Ionizing",
	"Jitterbugging",
	"Julienning",
	"Kneading",
	"Leavening",
	"Levitating",
	"Lollygagging",
	"Manifesting",
	"Marinating",
	"Meandering",
	"Metamorphosing",
	"Misting",
	"Moonwalking",
	"Moseying",
	"Mulling",
	"Mustering",
	"Musing",
	"Nebulizing",
	"Nesting",
	"Noodling",
	"Nucleating",
	"Orbiting",
	"Orchestrating",
	"Osmosing",
	"Perambulating",
	"Percolating",
	"Perusing",
	"Philosophising",
	"Photosynthesizing",
	"Pollinating",
	"Pondering",
	"Pontificating",
	"Pouncing",
	"Precipitating",
	"Prestidigitating",
	"Processing",
	"Proofing",
	"Propagating",
	"Puttering",
	"Puzzling",
	"Quantumizing",
	"Razzle-dazzling",
	"Razzmatazzing",
	"Recombobulating",
	"Reticulating",
	"Roosting",
	"Ruminating",
	"Sautéing",
	"Scampering",
	"Schlepping",
	"Scurrying",
	"Seasoning",
	"Shenaniganing",
	"Shimmying",
	"Simmering",
	"Skedaddling",
	"Sketching",
	"Slithering",
	"Smooshing",
	"Sock-hopping",
	"Spelunking",
	"Spinning",
	"Sprouting",
	"Stewing",
	"Sublimating",
	"Swirling",
	"Swooping",
	"Symbioting",
	"Synthesizing",
	"Tempering",
	"Thinking",
	"Thundering",
	"Tinkering",
	"Tomfoolering",
	"Topsy-turvying",
	"Transfiguring",
	"Transmuting",
	"Twisting",
	"Undulating",
	"Unfurling",
	"Unravelling",
	"Vibing",
	"Waddling",
	"Wandering",
	"Warping",
	"Whatchamacalliting",
	"Whirlpooling",
	"Whirring",
	"Whisking",
	"Wibbling",
	"Working",
	"Wrangling",
	"Zesting",
	"Zigzagging",
];

// ---------------------------------------------------------------------------
// Spinner glyph characters are now patched into the Loader above.
// No separate glyph prefix needed.
// ---------------------------------------------------------------------------

function pickVerb(): string {
	return SPINNER_VERBS[Math.floor(Math.random() * SPINNER_VERBS.length)];
}

/** Format elapsed ms as compact duration: 5s, 1m 23s, 1h 2m 3s */
function formatDuration(ms: number): string {
	const totalSec = Math.floor(ms / 1000);
	const h = Math.floor(totalSec / 3600);
	const m = Math.floor((totalSec % 3600) / 60);
	const s = totalSec % 60;
	if (h > 0) return `${h}h ${m}m ${s}s`;
	if (m > 0) return `${m}m ${s}s`;
	return `${s}s`;
}

function formatCount(value: number): string {
	return new Intl.NumberFormat("en-US").format(value);
}

function estimateResponseLength(message: any): number {
	if (!Array.isArray(message?.content)) return 0;
	return message.content.reduce((sum: number, block: any) =>
		sum + (block?.type === "text" && typeof block.text === "string" ? block.text.length : 0), 0);
}

function textBlockLengths(message: any): number[] {
	if (!Array.isArray(message?.content)) return [];
	const lengths: number[] = [];
	for (let i = 0; i < message.content.length; i++) {
		const block = message.content[i];
		if (block?.type === "text" && typeof block.text === "string") {
			lengths[i] = block.text.length;
		}
	}
	return lengths;
}

function statusText(text: string): string {
	return `${STATUS_DIM}${text}${RESET}`;
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

/** Threshold before showing elapsed time in status parentheses */
const SHOW_TIMER_AFTER_MS = 30_000;

/** How long to preserve "thought for Ns" across turns */
const THOUGHT_DISPLAY_MS = 3_500;

/** Minimum thinking duration before showing "thought for Ns" */
const MIN_THINKING_SHOW_MS = 100;

/** Message refresh cadence. Keep constant so status updates don't stall on long sessions. */
const WORKING_MESSAGE_INTERVAL_MS = 1_000;

/** Completion message linger */
const TURN_COMPLETION_MS = 2_500;


export default function (pi: ExtensionAPI) {
	let agentStartTime = 0;
	let turnStartTime = 0;
	let refreshTimer: ReturnType<typeof setTimeout> | null = null;
	let completionTimer: ReturnType<typeof setTimeout> | null = null;
	let thoughtStatusTimer: ReturnType<typeof setTimeout> | null = null;
	let currentVerb = "";
	let responseLength = 0;
	let responseTextBlockLengths: number[] = [];
	let thinkingStatus: "thinking" | number /* duration ms */ | null = null;
	let thinkingStartTime = 0;
	let thoughtForSetAt = 0;
	let activeTurnId = 0;
	let turnActive = false;
	let lastWorkingMessage: string | null = null;
	let activeCtx: { ui: any; hasUI: boolean } | null = null;

	function getEffortSuffix(): string {
		try {
			const level = pi.getThinkingLevel();
			if (!level || level === "off") return "";
			return ` with ${level} effort`;
		} catch {
			return "";
		}
	}

	function buildWorkingMessage(): string {
		const elapsed = Date.now() - (agentStartTime || turnStartTime);
		const tokenCount = Math.max(0, Math.round(responseLength / 4));
		const statusParts: string[] = [];

		if (thinkingStatus === "thinking") {
			statusParts.push(`thinking${getEffortSuffix()}`);
		} else if (typeof thinkingStatus === "number") {
			statusParts.push(`thought for ${Math.max(1, Math.round(thinkingStatus / 1000))}s`);
		}

		if (tokenCount > 0) {
			statusParts.push(`↓ ${formatCount(tokenCount)} tokens`);
		}

		if (elapsed > SHOW_TIMER_AFTER_MS || thinkingStatus !== null || tokenCount > 0) {
			statusParts.push(formatDuration(elapsed));
		}

		let message = `${CLAUDE_ORANGE}${currentVerb}…${RESET}`;
		if (statusParts.length > 0) {
			message += statusText(` (${statusParts.join(" · ")})`);
		}
		return message;
	}

	function setResponseTextBlockLength(index: number, length: number): void {
		const previous = responseTextBlockLengths[index] ?? 0;
		responseTextBlockLengths[index] = Math.max(0, length);
		responseLength = Math.max(0, responseLength + responseTextBlockLengths[index] - previous);
	}

	function resetResponseTracking(message?: any): void {
		responseTextBlockLengths = message ? textBlockLengths(message) : [];
		responseLength = message ? estimateResponseLength(message) : 0;
	}

	function syncWorkingMessage(force = false): void {
		if (!activeCtx?.hasUI) return;
		const nextMessage = buildWorkingMessage();
		if (!force && nextMessage === lastWorkingMessage) return;
		lastWorkingMessage = nextMessage;
		try {
			activeCtx.ui.setWorkingMessage(nextMessage);
		} catch { /* noop */ }
	}

	function restoreDefaultWorkingMessage(): void {
		lastWorkingMessage = null;
		if (!activeCtx?.hasUI) return;
		try {
			activeCtx.ui.setWorkingMessage();
		} catch { /* noop */ }
	}

	function getWorkingMessageIntervalMs(): number {
		const elapsed = Date.now() - (agentStartTime || turnStartTime);
		const tokenCount = Math.max(0, Math.round(responseLength / 4));
		if (thinkingStatus === null && tokenCount === 0 && elapsed <= SHOW_TIMER_AFTER_MS) {
			return Math.max(250, SHOW_TIMER_AFTER_MS - elapsed + 1);
		}
		return Math.max(250, WORKING_MESSAGE_INTERVAL_MS - (elapsed % WORKING_MESSAGE_INTERVAL_MS));
	}

	function scheduleRefreshTick(): void {
		if (!turnActive || refreshTimer) return;
		const intervalMs = getWorkingMessageIntervalMs();
		refreshTimer = setTimeout(() => {
			refreshTimer = null;
			syncWorkingMessage();
			scheduleRefreshTick();
		}, intervalMs);
		unrefTimer(refreshTimer);
	}

	function startRefreshLoop(): void {
		stopRefreshLoop();
		syncWorkingMessage(true);
		scheduleRefreshTick();
	}

	function rescheduleRefreshLoop(): void {
		if (!turnActive) return;
		stopRefreshLoop();
		scheduleRefreshTick();
	}

	function stopRefreshLoop(): void {
		if (refreshTimer) {
			clearTimeout(refreshTimer);
			refreshTimer = null;
		}
	}

	function clearCompletionTimer(): void {
		if (completionTimer) {
			clearTimeout(completionTimer);
			completionTimer = null;
		}
	}

	function clearThoughtStatusTimer(): void {
		if (thoughtStatusTimer) {
			clearTimeout(thoughtStatusTimer);
			thoughtStatusTimer = null;
		}
	}

	function scheduleThoughtStatusClear(): void {
		clearThoughtStatusTimer();
		if (typeof thinkingStatus !== "number") return;
		const remaining = THOUGHT_DISPLAY_MS - (Date.now() - thoughtForSetAt);
		if (remaining <= 0) {
			thinkingStatus = null;
			if (turnActive) syncWorkingMessage(true);
			else if (!completionTimer) restoreDefaultWorkingMessage();
			return;
		}
		thoughtStatusTimer = setTimeout(() => {
			thoughtStatusTimer = null;
			if (typeof thinkingStatus !== "number") return;
			if (Date.now() - thoughtForSetAt < THOUGHT_DISPLAY_MS) {
				scheduleThoughtStatusClear();
				return;
			}
			thinkingStatus = null;
			if (turnActive) syncWorkingMessage(true);
			else if (!completionTimer) restoreDefaultWorkingMessage();
		}, remaining);
		unrefTimer(thoughtStatusTimer);
	}

	function clearDisplay(): void {
		stopRefreshLoop();
		clearCompletionTimer();
		clearThoughtStatusTimer();
		agentStartTime = 0;
		turnStartTime = 0;
		thinkingStatus = null;
		thoughtForSetAt = 0;
		resetResponseTracking();
		restoreDefaultWorkingMessage();
	}

	function onThinkingEnd(): void {
		if (thinkingStatus !== "thinking") return;
		const duration = Date.now() - thinkingStartTime;
		if (duration < MIN_THINKING_SHOW_MS) {
			thinkingStatus = null;
			clearThoughtStatusTimer();
			return;
		}
		thinkingStatus = duration;
		thoughtForSetAt = Date.now();
		scheduleThoughtStatusClear();
	}

	pi.on("before_agent_start", async () => {
		// Start once per top-level request. Steering/follow-up messages while the
		// agent is active must not reset the timer.
		if (!agentStartTime) agentStartTime = Date.now();
	});

	pi.on("agent_start", async () => {
		if (!agentStartTime) agentStartTime = Date.now();
	});

	pi.on("turn_start", async (_event, ctx) => {
		activeTurnId++;
		turnActive = true;
		activeCtx = ctx;
		turnStartTime = Date.now();
		if (!agentStartTime) agentStartTime = turnStartTime;
		currentVerb = pickVerb();
		resetResponseTracking();
		clearCompletionTimer();
		if (typeof thinkingStatus !== "number" || Date.now() - thoughtForSetAt >= THOUGHT_DISPLAY_MS) {
			thinkingStatus = null;
			clearThoughtStatusTimer();
		} else {
			scheduleThoughtStatusClear();
		}
		startRefreshLoop();
	});

	pi.on("message_update", async (event, ctx) => {
		activeCtx = ctx;
		const evt = event.assistantMessageEvent;
		let statusChanged = false;
		const previousTokenCount = Math.max(0, Math.round(responseLength / 4));

		if (evt.type === "start") {
			resetResponseTracking();
		} else if (evt.type === "text_start") {
			setResponseTextBlockLength(evt.contentIndex, 0);
		} else if (evt.type === "text_delta") {
			const previous = responseTextBlockLengths[evt.contentIndex] ?? 0;
			setResponseTextBlockLength(evt.contentIndex, previous + (typeof evt.delta === "string" ? evt.delta.length : 0));
		} else if (evt.type === "text_end") {
			setResponseTextBlockLength(evt.contentIndex, typeof evt.content === "string" ? evt.content.length : 0);
		} else if (evt.type === "done") {
			resetResponseTracking(evt.message);
		} else if (evt.type === "error") {
			resetResponseTracking(evt.error);
		}

		if (evt.type === "thinking_start") {
			clearThoughtStatusTimer();
			thinkingStatus = "thinking";
			thinkingStartTime = Date.now();
			statusChanged = true;
		}
		if (evt.type === "thinking_end") {
			onThinkingEnd();
			statusChanged = true;
		}

		if (statusChanged) {
			syncWorkingMessage(true);
			rescheduleRefreshLoop();
			return;
		}

		const nextTokenCount = Math.max(0, Math.round(responseLength / 4));
		if (previousTokenCount === 0 && nextTokenCount > 0) {
			rescheduleRefreshLoop();
		}
	});

	pi.on("turn_end", async (_event, ctx) => {
		turnActive = false;
		activeCtx = ctx;
		const turnId = activeTurnId;
		const elapsed = Date.now() - (agentStartTime || turnStartTime);
		stopRefreshLoop();
		clearCompletionTimer();

		if (typeof thinkingStatus === "number" && Date.now() - thoughtForSetAt >= THOUGHT_DISPLAY_MS) {
			thinkingStatus = null;
			clearThoughtStatusTimer();
		}

		if (activeCtx?.hasUI) {
			const message = `${STATUS_DIM}✻ Worked for ${formatDuration(elapsed)}${RESET}`;
			lastWorkingMessage = message;
			try {
				activeCtx.ui.setWorkingMessage(message);
			} catch { /* noop */ }
			completionTimer = setTimeout(() => {
				completionTimer = null;
				if (activeTurnId !== turnId) return;
				restoreDefaultWorkingMessage();
			}, TURN_COMPLETION_MS);
			unrefTimer(completionTimer);
		} else if (typeof thinkingStatus !== "number") {
			restoreDefaultWorkingMessage();
		}

		responseLength = 0;
		responseTextBlockLengths = [];
	});

	pi.on("agent_end", async () => {
		turnActive = false;
		agentStartTime = 0;
		// Preserve the just-finished "Worked for …" line. Pi emits agent_end
		// immediately after the final turn, so clearing here made the completion
		// status disappear before users could see it.
		if (completionTimer) return;
		clearDisplay();
	});

	pi.on("session_shutdown", async () => {
		turnActive = false;
		clearDisplay();
		activeCtx = null;
	});
}
