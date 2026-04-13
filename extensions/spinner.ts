import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

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
	 * Build the working message in OpenBrawd style:
	 *   Verb… (thinking with medium effort · 1:45)
	 *
	 * The parenthesized status part appears only when there's something to show.
	 */
	function buildWorkingMessage(): string {
		const elapsed = Date.now() - turnStartTime;

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

		// Elapsed time (shown after threshold, or always if verbose/thinking)
		if (elapsed > SHOW_TIMER_AFTER_MS || thinkingStatus !== null) {
			statusParts.push(formatDuration(elapsed));
		}

		// --- Assemble ---
		let msg = `${currentVerb}…`;
		if (statusParts.length > 0) {
			msg += ` (${statusParts.join(" · ")})`;
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
		tickTimer = setInterval(updateDisplay, 200);
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
		thinkingStatus = null;
		clearThinkingTimers();
		startTicking();
	});

	pi.on("message_update", async (event, ctx) => {
		activeCtx = ctx;
		const evt = event.assistantMessageEvent;

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
