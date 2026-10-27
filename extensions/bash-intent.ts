// Short purpose labels for bash rows ("Bash npm test — Run the test suite").
//
// Three modes, chosen with the `bashIntent` setting and applied when the extension loads
// (pi start or /reload):
//   off    no labels (default)
//   model  the model writes the label as an extra `displaySummary` argument of each bash call.
//          This adds a field to the bash tool and a line to the model's instructions.
//   local  Apple's on-device model writes the label on this Mac (macOS 26+, Apple silicon).
//          Nothing the model sees changes: the label lives only in this extension.
//
// Local mode runs a small Swift helper (HELPER_SOURCE below, compiled on first use and cached). Labels are requested when a command starts, never for commands that are only being
// redrawn, and are cached on disk so a resumed session shows them without asking again.

import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir, release } from "node:os";
import { join } from "node:path";

export type BashIntentMode = "off" | "model" | "local";
export const BASH_INTENT_MODES: readonly BashIntentMode[] = ["off", "model", "local"];

/** `true` (the original boolean setting) means "model"; anything unknown means off. */
export function normalizeBashIntentMode(value: unknown): BashIntentMode {
	if (value === true || value === "model") return "model";
	if (value === "local") return "local";
	return "off";
}

/** Why local labels cannot run here, or undefined when they can. */
export function localIntentUnsupportedReason(): string | undefined {
	if (process.env.PI_CC_UI_INTENT_HELPER) return undefined;
	if (process.platform !== "darwin" || process.arch !== "arm64") return "local labels need a Mac with Apple silicon";
	const darwin = Number.parseInt(release().split(".")[0] ?? "0", 10);
	if (!(darwin >= 25)) return "local labels need macOS 26 or newer";
	return undefined;
}

/** Tidy a label from either source: no control characters, one line, at most 96 characters. */
export function cleanIntentLabel(raw: unknown): string {
	if (typeof raw !== "string") return "";
	let label = raw
		.replace(/\x1b(?:\[[0-?]*[ -/]*[@-~]|\][\s\S]*?(?:\x07|\x1b\\)|[()][ -~]|[78=>])/g, "")
		.replace(/\x9b[0-?]*[ -/]*[@-~]|\x9d[\s\S]*?(?:\x07|\x9c)/g, "")
		.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, "")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, "")
		.replace(/\.$/, "")
		.trim();
	const codePoints = [...label];
	if (codePoints.length > 96) label = `${codePoints.slice(0, 95).join("")}…`;
	return label;
}

// ---------------------------------------------------------------------------
// Local labels
// ---------------------------------------------------------------------------

// The helper's Swift source, kept here so it ships inside this file and is compiled as is.
const HELPER_SOURCE = String.raw`// Labels shell commands with Apple's on-device model (FoundationModels, macOS 26+ on Apple
// silicon) for pi-claude-code-ui's "bashIntent": "local" mode. The extension compiles this
// file on first use and keeps one helper per pi session; macOS loads the model when a label
// is requested and unloads it on its own after about a minute without requests.
//
// Protocol, one JSON object per line:
//   stdin:  {"id": 1, "command": "npm test"}
//   stdout: {"ready": true} once at start, or {"unavailable": "<reason>"} and exit,
//           then {"id": 1, "summary": "Run the test suite"} or {"id": 1, "error": "<reason>"}.
// The helper exits when stdin closes.

import Foundation
import FoundationModels

struct LabelRequest: Decodable {
	let id: Int
	let command: String
}

func emit(_ object: [String: Any]) {
	guard let data = try? JSONSerialization.data(withJSONObject: object) else { return }
	FileHandle.standardOutput.write(data + Data("\n".utf8))
}

let instructions = """
	You label shell commands for a terminal UI. Reply with only what the command does, \
	in at most eight words, starting with an imperative verb such as Run, Show, List, Find or Build. \
	No quotes, no command syntax, no final period.
	"""

@main
struct BashIntentHelper {
	static func main() async {
		let model = SystemLanguageModel.default
		guard case .available = model.availability else {
			emit(["unavailable": String(describing: model.availability)])
			return
		}
		emit(["ready": true])
		let decoder = JSONDecoder()
		while let line = readLine(strippingNewline: true) {
			guard let request = try? decoder.decode(LabelRequest.self, from: Data(line.utf8)) else { continue }
			// A fresh session per command, so earlier labels never leak into the next one.
			let session = LanguageModelSession(model: model, instructions: instructions)
			do {
				let options = GenerationOptions(sampling: .greedy, maximumResponseTokens: 24)
				let response = try await session.respond(to: "Command: \(request.command.prefix(2000))", options: options)
				emit(["id": request.id, "summary": response.content])
			} catch {
				emit(["id": request.id, "error": String(describing: error)])
			}
		}
	}
}
`;
const MAX_CACHE_ENTRIES = 2000;
const MAX_PENDING = 20;
const MAX_WATCHED = 200;

function cacheDir(): string {
	return process.env.PI_CC_UI_CACHE_DIR || join(homedir(), "Library", "Caches", "pi-claude-code-ui");
}

const commandKey = (command: string) => createHash("sha256").update(command).digest("hex").slice(0, 24);

interface LocalIntentState {
	enabled: boolean;
	status: "idle" | "starting" | "ready" | "failed";
	child?: ChildProcessWithoutNullStreams;
	buffer: string;
	nextId: number;
	/** id → command, for requests the helper has not answered yet. */
	inFlight: Map<number, string>;
	/** Commands waiting for the helper to start. */
	queue: string[];
	/** command key → label, in least-recently-used order (disk cache). */
	labels: Map<string, string>;
	cacheLoaded: boolean;
	saveTimer?: ReturnType<typeof setTimeout>;
	/** command → redraw callbacks of rows that show it. */
	watchers: Map<string, Set<() => void>>;
	onProblem?: (message: string) => void;
	reportedProblem: boolean;
	crashes: number;
}

// On globalThis so /reload (which re-evaluates this module) replaces the previous helper.
const STATE_KEY = Symbol.for("pi-claude-style-tools:bash-intent-local");

function state(): LocalIntentState {
	const g = globalThis as any;
	if (!g[STATE_KEY]) {
		g[STATE_KEY] = {
			enabled: false,
			status: "idle",
			buffer: "",
			nextId: 1,
			inFlight: new Map(),
			queue: [],
			labels: new Map(),
			cacheLoaded: false,
			watchers: new Map(),
			reportedProblem: false,
			crashes: 0,
		} satisfies LocalIntentState;
	}
	return g[STATE_KEY] as LocalIntentState;
}

/** Turn local labels on or off for this session; stops any helper from a previous load. */
export function configureLocalIntents(enabled: boolean, onProblem?: (message: string) => void): void {
	const s = state();
	stopHelper(s);
	s.enabled = enabled;
	s.onProblem = onProblem;
	s.reportedProblem = false;
	s.crashes = 0;
	s.status = "idle";
	s.queue = [];
	s.inFlight.clear();
}

function report(s: LocalIntentState, message: string): void {
	if (s.reportedProblem) return;
	s.reportedProblem = true;
	try {
		s.onProblem?.(message);
	} catch { /* no UI */ }
}

function fail(s: LocalIntentState, message: string): void {
	s.status = "failed";
	stopHelper(s);
	s.queue = [];
	s.inFlight.clear();
	for (const callbacks of s.watchers.values()) callbacks.clear();
	s.watchers.clear();
	report(s, message);
}

function stopHelper(s: LocalIntentState): void {
	const child = s.child;
	s.child = undefined;
	if (!child) return;
	try {
		child.stdin.end();
		child.kill();
	} catch { /* already gone */ }
}

function loadCache(s: LocalIntentState): void {
	if (s.cacheLoaded) return;
	s.cacheLoaded = true;
	try {
		const raw = JSON.parse(readFileSync(join(cacheDir(), "bash-intents.json"), "utf8"));
		if (raw?.version === 1 && raw.labels && typeof raw.labels === "object") {
			for (const [key, label] of Object.entries(raw.labels)) {
				if (typeof label === "string") s.labels.set(key, label);
			}
		}
	} catch { /* no cache yet */ }
}

function saveCacheSoon(s: LocalIntentState): void {
	if (s.saveTimer) return;
	s.saveTimer = setTimeout(() => {
		s.saveTimer = undefined;
		saveCacheNow(s);
	}, 1500);
	s.saveTimer.unref?.();
}

function saveCacheNow(s: LocalIntentState): void {
	try {
		const dir = cacheDir();
		mkdirSync(dir, { recursive: true });
		const file = join(dir, "bash-intents.json");
		writeFileSync(`${file}.tmp`, JSON.stringify({ version: 1, labels: Object.fromEntries(s.labels) }));
		renameSync(`${file}.tmp`, file);
	} catch { /* the cache is only an optimization */ }
}

process.once("exit", () => {
	const s = (globalThis as any)[STATE_KEY] as LocalIntentState | undefined;
	if (s?.saveTimer) {
		clearTimeout(s.saveTimer);
		s.saveTimer = undefined;
		saveCacheNow(s);
	}
	if (s) stopHelper(s);
});

/** The label for a command, if one is known (this session or an earlier one). */
export function localIntentFor(command: string): string | undefined {
	const s = state();
	if (!command) return undefined;
	loadCache(s);
	return s.labels.get(commandKey(command));
}

/** Redraw a row when its command's label arrives. */
export function watchLocalIntent(command: string, redraw: () => void): void {
	const s = state();
	if (!s.enabled || s.status === "failed" || !command) return;
	let callbacks = s.watchers.get(command);
	if (!callbacks) {
		if (s.watchers.size >= MAX_WATCHED) {
			const oldest = s.watchers.keys().next().value;
			if (oldest !== undefined) s.watchers.delete(oldest);
		}
		callbacks = new Set();
		s.watchers.set(command, callbacks);
	}
	callbacks.add(redraw);
}

/** Ask for a label for a command that is starting now. Does nothing if one is cached. */
export function requestLocalIntent(command: string): void {
	const s = state();
	if (!s.enabled || s.status === "failed" || !command.trim()) return;
	if (localIntentFor(command) !== undefined) return;
	if ([...s.inFlight.values()].includes(command) || s.queue.includes(command)) return;
	if (s.status === "ready" && s.child) {
		send(s, command);
		return;
	}
	s.queue.push(command);
	if (s.queue.length > MAX_PENDING) s.queue.shift();
	if (s.status === "idle") void startHelper(s);
}

function send(s: LocalIntentState, command: string): void {
	const id = s.nextId++;
	s.inFlight.set(id, command);
	try {
		s.child?.stdin.write(`${JSON.stringify({ id, command })}\n`);
	} catch {
		s.inFlight.delete(id);
	}
}

function deliver(s: LocalIntentState, command: string, label: string): void {
	const key = commandKey(command);
	s.labels.delete(key);
	s.labels.set(key, label);
	while (s.labels.size > MAX_CACHE_ENTRIES) {
		const oldest = s.labels.keys().next().value;
		if (oldest === undefined) break;
		s.labels.delete(oldest);
	}
	saveCacheSoon(s);
	const callbacks = s.watchers.get(command);
	s.watchers.delete(command);
	for (const redraw of callbacks ?? []) {
		try {
			redraw();
		} catch { /* row is gone */ }
	}
}

function onHelperLine(s: LocalIntentState, line: string): void {
	let message: any;
	try {
		message = JSON.parse(line);
	} catch {
		return;
	}
	if (message?.ready === true) {
		s.status = "ready";
		const queued = s.queue;
		s.queue = [];
		for (const command of queued) send(s, command);
		return;
	}
	if (typeof message?.unavailable === "string") {
		fail(s, `Local bash labels are off: Apple's on-device model is not available (${message.unavailable}). Turn on Apple Intelligence, or use /cc-tools intent model|off.`);
		return;
	}
	const command = s.inFlight.get(message?.id);
	if (command === undefined) return;
	s.inFlight.delete(message.id);
	const label = cleanIntentLabel(message.summary);
	if (label) deliver(s, command, label);
	else s.watchers.delete(command);
}

async function helperPath(): Promise<string> {
	const override = process.env.PI_CC_UI_INTENT_HELPER;
	if (override) return override;
	const hash = createHash("sha256").update(HELPER_SOURCE).update(process.arch).digest("hex").slice(0, 12);
	const dir = cacheDir();
	const binary = join(dir, `bash-intent-helper-${hash}`);
	if (existsSync(binary)) return binary;
	mkdirSync(dir, { recursive: true });
	const source = join(dir, `bash-intent-helper-${hash}.swift`);
	writeFileSync(source, HELPER_SOURCE);
	const tmp = `${binary}.${process.pid}.tmp`;
	await new Promise<void>((resolve, reject) => {
		execFile(
			"xcrun",
			["swiftc", "-O", "-parse-as-library", "-suppress-warnings", "-target", "arm64-apple-macos26.0", source, "-o", tmp],
			{ timeout: 180_000 },
			(error, _stdout, stderr) => (error ? reject(new Error(String(stderr || error.message).trim().split("\n").slice(-3).join(" "))) : resolve()),
		);
	});
	renameSync(tmp, binary);
	return binary;
}

async function startHelper(s: LocalIntentState): Promise<void> {
	s.status = "starting";
	let path: string;
	try {
		path = await helperPath();
	} catch (error) {
		fail(s, `Local bash labels are off: building the helper needs the Xcode command line tools (xcode-select --install). ${(error as Error).message}`.trim());
		return;
	}
	if (!s.enabled || s.status !== "starting") return;
	let child: ChildProcessWithoutNullStreams;
	try {
		child = spawn(path, [], { stdio: ["pipe", "pipe", "pipe"] });
	} catch (error) {
		fail(s, `Local bash labels are off: the helper did not start (${(error as Error).message}).`);
		return;
	}
	s.child = child;
	s.buffer = "";
	child.stdout.setEncoding("utf8");
	child.stdout.on("data", (chunk: string) => {
		s.buffer += chunk;
		let newline = s.buffer.indexOf("\n");
		while (newline !== -1) {
			const line = s.buffer.slice(0, newline);
			s.buffer = s.buffer.slice(newline + 1);
			if (line.trim()) onHelperLine(s, line);
			newline = s.buffer.indexOf("\n");
		}
	});
	child.stderr.resume();
	child.on("error", (error) => {
		if (s.child === child) fail(s, `Local bash labels are off: the helper failed (${error.message}).`);
	});
	child.on("exit", (code, signal) => {
		if (s.child !== child) return;
		s.child = undefined;
		s.inFlight.clear();
		if (s.status === "failed") return;
		// An unexpected exit: start again on the next command, and give up after the second.
		s.crashes++;
		if (s.crashes >= 2) fail(s, `Local bash labels are off: the helper stopped (${signal ?? `exit ${code}`}).`);
		else s.status = "idle";
	});
	// Never keep pi alive just for the helper.
	child.unref();
	(child.stdin as any).unref?.();
	(child.stdout as any).unref?.();
	(child.stderr as any).unref?.();
}

/** For tests: forget everything, including the on-disk cache state in memory. */
export function resetLocalIntentsForTests(): void {
	const s = state();
	stopHelper(s);
	if (s.saveTimer) clearTimeout(s.saveTimer);
	delete (globalThis as any)[STATE_KEY];
}

/** For tests: write pending labels to disk now. */
export function flushLocalIntentCacheForTests(): void {
	const s = state();
	if (s.saveTimer) clearTimeout(s.saveTimer);
	s.saveTimer = undefined;
	saveCacheNow(s);
}
