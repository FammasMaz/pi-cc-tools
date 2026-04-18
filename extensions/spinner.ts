import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Loader } from "@mariozechner/pi-tui";

// ---------------------------------------------------------------------------
// Patch the built-in Loader to use OpenBrawd-style animated characters
// instead of braille dots. Class fields are instance props so we override
// updateDisplay on the prototype to inject our characters.
// ---------------------------------------------------------------------------

const SPINNER_CHARS = ["·", "✢", "✳", "✶", "✻", "✽"];
const OB_FRAMES = [...SPINNER_CHARS, ...[...SPINNER_CHARS].reverse()];
const ANSI_RE = /\x1b\[[0-9;]*m/g;
const RAW_ANSI_RE = /\x1b\[[0-9;]*m/;
const RESET = "\x1b[0m";
const CLAUDE_ORANGE = "\x1b[38;2;215;119;87m";
const CLAUDE_ORANGE_EDGE = "\x1b[38;2;230;134;102m";
const CLAUDE_ORANGE_SHIMMER = "\x1b[38;2;245;149;117m";
const STATUS_DIM = "\x1b[38;2;153;153;153m";
const SHIMMER_INTERVAL_MS = 500;

const origUpdateDisplay = (Loader.prototype as any).updateDisplay;
(Loader.prototype as any).updateDisplay = function patchedUpdateDisplay() {
	const frame = OB_FRAMES[this.currentFrame % OB_FRAMES.length];
	const message = typeof this.message === "string" && RAW_ANSI_RE.test(this.message)
		? this.message
		: this.messageColorFn(this.message);
	this.setText(`${this.spinnerColorFn(frame)} ${message}`);
	if (this.ui) {
		this.ui.requestRender();
	}
};

// Override start() to use 120ms interval (OpenBrawd's speed) instead of 80ms
const origStart = Loader.prototype.start;
Loader.prototype.start = function patchedStart() {
	(this as any).updateDisplay();
	(this as any).intervalId = setInterval(() => {
		(this as any).currentFrame = ((this as any).currentFrame + 1) % OB_FRAMES.length;
		(this as any).updateDisplay();
	}, 250);
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

function stripAnsi(text: string): string {
	return text.replace(ANSI_RE, "");
}

function formatCount(value: number): string {
	return new Intl.NumberFormat("en-US").format(value);
}

function estimateResponseLength(message: any): number {
	if (!Array.isArray(message?.content)) return 0;
	return message.content.reduce((sum: number, block: any) =>
		sum + (block?.type === "text" && typeof block.text === "string" ? block.text.length : 0), 0);
}

function statusText(text: string): string {
	return `${STATUS_DIM}${text}${RESET}`;
}

function colorizeShimmerSegment(segment: string): string {
	const chars = Array.from(segment);
	if (chars.length === 0) return "";
	const center = Math.floor(chars.length / 2);
	return chars
		.map((char, index) => `${index === center ? CLAUDE_ORANGE_SHIMMER : CLAUDE_ORANGE_EDGE}${char}`)
		.join("");
}

function renderShimmerText(text: string, tick: number): string {
	const chars = Array.from(stripAnsi(text));
	if (chars.length === 0) return "";
	const cycleLength = chars.length + 20;
	const glimmerIndex = chars.length + 10 - (tick % cycleLength);
	const shimmerStart = glimmerIndex - 1;
	const shimmerEnd = glimmerIndex + 1;
	if (shimmerStart >= chars.length || shimmerEnd < 0) return `${CLAUDE_ORANGE}${text}${RESET}`;
	const before = chars.slice(0, Math.max(0, shimmerStart)).join("");
	const shimmer = chars.slice(Math.max(0, shimmerStart), Math.min(chars.length, shimmerEnd + 1)).join("");
	const after = chars.slice(Math.min(chars.length, shimmerEnd + 1)).join("");
	return `${CLAUDE_ORANGE}${before}${colorizeShimmerSegment(shimmer)}${CLAUDE_ORANGE}${after}${RESET}`;
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

/** Threshold before showing elapsed time in status parentheses (matches OpenBrawd's 30s) */
const SHOW_TIMER_AFTER_MS = 30_000;

/** How long to display "thought for Ns" after thinking ends */
const THOUGHT_DISPLAY_MS = 2_000; // used only on turn_end linger

/** Minimum thinking duration before showing "thought for Ns" (skip sub-100ms flickers) */
const MIN_THINKING_SHOW_MS = 100;

export default function (pi: ExtensionAPI) {
	let turnStartTime = 0;
	let tickTimer: ReturnType<typeof setInterval> | null = null;
	let currentVerb = "";
	let responseLength = 0;
	let shimmerTick = 0;

	// Thinking state machine (mirrors OpenBrawd's approach)
	let thinkingStatus: "thinking" | number /* duration ms */ | null = null;
	let thinkingStartTime = 0;
	let showDurationTimer: ReturnType<typeof setTimeout> | null = null;
	let clearStatusTimer: ReturnType<typeof setTimeout> | null = null;

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

	/**
	 * Build the working message:
	 *   Verb… (thinking with medium effort · ↓ 123 tokens · 1:45)
	 *
	 * The Loader provides the animated glyph prefix automatically.
	 */
	function buildWorkingMessage(): string {
		const elapsed = Date.now() - turnStartTime;
		const tokenCount = Math.max(0, Math.round(responseLength / 4));

		// --- Status parts (go inside parentheses, joined with " · ") ---
		const statusParts: string[] = [];

		// Thinking / thought-for indicator
		if (thinkingStatus === "thinking") {
			const effort = getEffortSuffix();
			statusParts.push(`thinking${effort}`);
		} else if (typeof thinkingStatus === "number") {
			const dur = Math.max(1, Math.round(thinkingStatus / 1000));
			statusParts.push(`thought for ${dur}s`);
		}

		if (tokenCount > 0) {
			statusParts.push(`↓ ${formatCount(tokenCount)} tokens`);
		}

		// Elapsed time (shown after threshold, or whenever we're actively showing status)
		if (elapsed > SHOW_TIMER_AFTER_MS || thinkingStatus !== null || tokenCount > 0) {
			statusParts.push(formatDuration(elapsed));
		}

		// --- Assemble ---
		let msg = renderShimmerText(`${currentVerb}…`, shimmerTick);
		if (statusParts.length > 0) {
			msg += statusText(` (${statusParts.join(" · ")})`);
		}

		return msg;
	}

	function updateDisplay(): void {
		if (!activeCtx?.hasUI) return;
		const msg = buildWorkingMessage();
		try {
			activeCtx.ui.setWorkingMessage(msg);
		} catch { /* noop */ }
	}

	function startTicking(): void {
		stopTicking();
		tickTimer = setInterval(() => {
			shimmerTick++;
			updateDisplay();
		}, SHIMMER_INTERVAL_MS);
		updateDisplay(); // immediate first update
	}

	function stopTicking(): void {
		if (tickTimer) {
			clearInterval(tickTimer);
			tickTimer = null;
		}
	}

	function clearThinkingTimers(): void {
		if (showDurationTimer) {
			clearTimeout(showDurationTimer);
			showDurationTimer = null;
		}
		if (clearStatusTimer) {
			clearTimeout(clearStatusTimer);
			clearStatusTimer = null;
		}
	}

	function clearDisplay(): void {
		stopTicking();
		clearThinkingTimers();
		thinkingStatus = null;
		responseLength = 0;
		shimmerTick = 0;
		if (!activeCtx?.hasUI) return;
		try {
			activeCtx.ui.setWorkingMessage(); // restore default
		} catch { /* noop */ }
	}

	/**
	 * Transition thinking state machine when thinking ends.
	 * Shows "thought for Ns" until the next thinking_start or turn_end.
	 */
	function onThinkingEnd(): void {
		if (thinkingStatus !== "thinking") return;

		const duration = Date.now() - thinkingStartTime;

		if (duration < MIN_THINKING_SHOW_MS) {
			// Too brief — skip "thought for" entirely to avoid flicker
			thinkingStatus = null;
			return;
		}

		// Freeze the duration — stays visible until next thinking_start or turn_end
		thinkingStatus = duration;
	}

	// --- Event handlers ---

	pi.on("turn_start", async (_event, ctx) => {
		activeCtx = ctx;
		turnStartTime = Date.now();
		currentVerb = pickVerb();
		responseLength = 0;
		shimmerTick = 0;
		thinkingStatus = null;
		clearThinkingTimers();
		startTicking();
	});

	pi.on("message_update", async (event, ctx) => {
		activeCtx = ctx;
		const evt = event.assistantMessageEvent;
		responseLength = estimateResponseLength(event.message);

		if (evt.type === "thinking_start") {
			if (thinkingStatus !== "thinking") {
				clearThinkingTimers();
				thinkingStatus = "thinking";
				thinkingStartTime = Date.now();
			}
		}

		if (evt.type === "thinking_end") {
			onThinkingEnd();
		}
	});

	pi.on("turn_end", async () => {
		// If we're showing "thought for Ns", let it linger briefly so the user sees it
		if (typeof thinkingStatus === "number") {
			// Keep ticking for the remaining display time, then clear
			const remaining = THOUGHT_DISPLAY_MS;
			setTimeout(() => clearDisplay(), remaining);
		} else {
			clearDisplay();
		}
	});

	pi.on("agent_end", async () => {
		clearDisplay();
	});

	pi.on("session_shutdown", async () => {
		clearDisplay();
		activeCtx = null;
	});
}
