import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import {
	AssistantMessageComponent,
	ToolExecutionComponent,
	createBashTool,
	createEditTool,
	createFindTool,
	createGrepTool,
	createLsTool,
	createReadTool,
	createWriteTool,
} from "@earendil-works/pi-coding-agent";
import { Container } from "@earendil-works/pi-tui";
import { initTheme } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";

type Mode = "baseline" | "patched" | "full";
type ToolDefinition = {
	name: string;
	renderCall?: (...args: any[]) => any;
	renderResult?: (...args: any[]) => any;
	execute?: (...args: any[]) => Promise<any> | any;
	description?: string;
	parameters?: unknown;
};

type AssistantMessage = {
	role: "assistant";
	content: Array<{ type: "text"; text: string } | { type: "thinking"; thinking: string }>;
	stopReason?: string;
	errorMessage?: string;
};

type ToolScenario = {
	name: string;
	args: Record<string, any>;
	result: { content: Array<{ type: "text"; text: string }>; details?: any; isError?: boolean };
};

type BenchmarkCase = {
	name: string;
	componentCount: number;
	firstRenderMs: number;
	warmAvgMs: number;
	tailInvalidateAvgMs: number;
	renderedLines: number;
};

const mode = ((process.argv[2] ?? "baseline") as Mode);
const width = Number(process.argv[3] ?? "120");
const warmRepeats = Number(process.argv[4] ?? "12");
const tailRepeats = Number(process.argv[5] ?? "8");

try {
	Object.defineProperty(process.stdout, "columns", { configurable: true, value: width });
} catch {
	// ignore
}

initTheme("dark", false);

function nowMs(): number {
	return performance.now();
}

function elapsedMs<T>(fn: () => T): { value: T; ms: number } {
	const start = nowMs();
	const value = fn();
	return { value, ms: nowMs() - start };
}

function averageMs(iterations: number, fn: () => void): number {
	let total = 0;
	for (let i = 0; i < iterations; i++) {
		const start = nowMs();
		fn();
		total += nowMs() - start;
	}
	return total / iterations;
}

async function averageMsAsync(iterations: number, fn: () => Promise<void>): Promise<number> {
	let total = 0;
	for (let i = 0; i < iterations; i++) {
		const start = nowMs();
		await fn();
		total += nowMs() - start;
	}
	return total / iterations;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildWorkspace(): string {
	const root = mkdtempSync(join(tmpdir(), "pi-cc-tools-bench-"));
	mkdirSync(join(root, "src"), { recursive: true });
	mkdirSync(join(root, "docs"), { recursive: true });
	mkdirSync(join(root, "tests"), { recursive: true });

	for (let i = 0; i < 24; i++) {
		writeFileSync(join(root, "src", `module-${i}.ts`), makeTsFile(i));
		writeFileSync(join(root, "docs", `guide-${i}.md`), makeDocFile(i));
	}

	writeFileSync(join(root, "README.md"), makeDocFile(999));
	writeFileSync(join(root, "tests", "sample.test.ts"), makeTsFile(777));
	return root;
}

function makeTsFile(index: number): string {
	const lines: string[] = [];
	lines.push(`export function feature${index}(input: string): string {`);
	lines.push(`\tconst parts = input.split(":");`);
	lines.push(`\tconst id = parts[0] ?? "module-${index}";`);
	lines.push(`\tconst body = parts.slice(1).join(":");`);
	for (let i = 0; i < 80; i++) {
		lines.push(`\tconst row${i} = ${JSON.stringify(`module-${index} line ${i} benchmark payload with alpha beta gamma delta`)};`);
	}
	lines.push(`\treturn [id, body].filter(Boolean).join(" :: ");`);
	lines.push(`}`);
	return lines.join("\n") + "\n";
}

function makeDocFile(index: number): string {
	return [
		`# Benchmark Guide ${index}`,
		"",
		"## Summary",
		"",
		"This benchmark document exists to create realistic read and markdown payloads.",
		"",
		"- item one with some repeated wording for wrapping behavior",
		"- item two with more repeated wording for wrapping behavior",
		"- item three with even more repeated wording for wrapping behavior",
		"",
		"```ts",
		`const example${index} = { status: \"ok\", note: \"benchmark payload\" };`,
		"```",
		"",
		"A long trailing paragraph to give markdown wrapping more material across multiple renders.",
	].join("\n") + "\n";
}

class FakePi {
	tools = new Map<string, ToolDefinition>();
	events = new Map<string, Array<(...args: any[]) => any>>();
	commands = new Map<string, any>();

	registerTool(definition: ToolDefinition): void {
		this.tools.set(definition.name, definition);
	}

	registerCommand(name: string, command: any): void {
		this.commands.set(name, command);
	}

	on(name: string, handler: (...args: any[]) => any): void {
		const handlers = this.events.get(name) ?? [];
		handlers.push(handler);
		this.events.set(name, handlers);
	}

	getThinkingLevel(): string {
		return "off";
	}

	getAllTools(): ToolDefinition[] {
		return [...this.tools.values()];
	}
}

async function loadToolDefinitions(cwd: string, benchMode: Mode): Promise<Map<string, ToolDefinition>> {
	if (benchMode === "baseline") {
		return new Map<string, ToolDefinition>([
			["read", createReadTool(cwd)],
			["bash", createBashTool(cwd)],
			["grep", createGrepTool(cwd)],
			["find", createFindTool(cwd)],
			["ls", createLsTool(cwd)],
			["write", createWriteTool(cwd)],
			["edit", createEditTool(cwd)],
		]);
	}

	const pi = new FakePi();
	if (benchMode === "full") {
		const spinner = await import("../extensions/spinner.ts");
		spinner.default(pi as any);
	}
	const extension = await import("../extensions/index.ts");
	extension.default(pi as any);
	return pi.tools;
}

function sampleParagraph(seed: number): string {
	return [
		`### Assistant section ${seed}`,
		"",
		"This is a synthetic assistant block used for benchmarking render cost over long histories.",
		"",
		`- point ${seed}a with repeated words repeated words repeated words`,
		`- point ${seed}b with repeated words repeated words repeated words`,
		"",
		"```ts",
		`const value${seed} = { status: \"ok\", payload: \"benchmark\" };`,
		"```",
		"",
		"Final paragraph with enough text to wrap across several terminal lines and trigger markdown layout work.",
	].join("\n");
}

function makeAssistantMessage(seed: number): AssistantMessage {
	return {
		role: "assistant",
		content: [
			{ type: "thinking", thinking: `Thinking through case ${seed}.\n\n${sampleParagraph(seed + 1000)}` },
			{ type: "text", text: sampleParagraph(seed) },
		],
	};
}

function makeDiff(seed: number, lines = 18) {
	const diffLines: Array<{ type: "ctx" | "add" | "del" | "sep"; oldNum: number | null; newNum: number | null; content: string }> = [];
	let oldNum = 1;
	let newNum = 1;
	for (let i = 0; i < lines; i++) {
		if (i > 0 && i % 6 === 0) {
			diffLines.push({ type: "sep", oldNum: null, newNum: 3, content: "" });
			oldNum += 3;
			newNum += 3;
		}
		diffLines.push({ type: "ctx", oldNum, newNum, content: `const stable${seed}_${i} = ${JSON.stringify(`stable-${seed}-${i}`)};` });
		oldNum++;
		newNum++;
		diffLines.push({ type: "del", oldNum, newNum: null, content: `const old${seed}_${i} = ${JSON.stringify(`old-${seed}-${i}`)};` });
		oldNum++;
		diffLines.push({ type: "add", oldNum: null, newNum, content: `const next${seed}_${i} = ${JSON.stringify(`next-${seed}-${i} with benchmark payload`)};` });
		newNum++;
	}
	return {
		lines: diffLines,
		added: lines,
		removed: lines,
		chars: diffLines.reduce((sum, line) => sum + line.content.length, 0),
	};
}

function makeToolScenario(cwd: string, index: number): ToolScenario {
	const selector = index % 6;
	const filePath = join(cwd, "src", `module-${index % 24}.ts`);
	const docPath = join(cwd, "docs", `guide-${index % 24}.md`);
	const diff = makeDiff(index, 10 + (index % 5));

	switch (selector) {
		case 0:
			return {
				name: "read",
				args: { path: filePath },
				result: {
					content: [{ type: "text", text: makeTsFile(index % 24) }],
					details: { truncation: { truncated: false } },
				},
			};
		case 1:
			return {
				name: "grep",
				args: { pattern: "benchmark payload", path: cwd },
				result: {
					content: [{ type: "text", text: `${filePath}:12:benchmark payload\n${docPath}:4:benchmark payload\n${filePath}:40:benchmark payload` }],
					details: { truncation: { truncated: false } },
				},
			};
		case 2:
			return {
				name: "find",
				args: { pattern: "**/*.ts", path: cwd },
				result: {
					content: [{ type: "text", text: [`src/module-${index % 24}.ts`, `src/module-${(index + 1) % 24}.ts`, `tests/sample.test.ts`].join("\n") }],
				},
			};
		case 3:
			return {
				name: "ls",
				args: { path: cwd },
				result: {
					content: [{ type: "text", text: ["docs/", "src/", "tests/", "README.md"].join("\n") }],
				},
			};
		case 4:
			return {
				name: "write",
				args: { path: filePath, content: makeTsFile((index + 1) % 24) },
				result: {
					content: [{ type: "text", text: `Successfully wrote ${900 + index} bytes to ${filePath}` }],
					details: { _type: "diff", summary: `+${diff.added} -${diff.removed}`, diff, language: "typescript" },
				},
			};
		default:
			return {
				name: "edit",
				args: {
					path: filePath,
					edits: [
						{ oldText: "const parts = input.split(\":\");", newText: "const parts = input.trim().split(\":\");" },
						{ oldText: "return [id, body].filter(Boolean).join(\" :: \" );", newText: "return [id, body].filter(Boolean).join(\" :: \" );" },
					],
				},
				result: {
					content: [{ type: "text", text: `Successfully replaced 2 block(s) in ${filePath}.` }],
					details: {
						_type: "multiEditInfo",
						summary: `+${diff.added} -${diff.removed}`,
						editCount: 2,
						diffLineCount: diff.lines.length,
						hunks: 3,
						totalAdded: diff.added,
						totalRemoved: diff.removed,
					},
				},
			};
	}
}

async function buildToolTree(toolDefinitions: Map<string, ToolDefinition>, cwd: string, count: number): Promise<{ root: Container; tail: any }> {
	const root = new Container();
	const fakeUi = { requestRender() {}, previousLines: [] as string[] };
	let tail: any = null;

	for (let i = 0; i < count; i++) {
		const scenario = makeToolScenario(cwd, i);
		const toolDef = toolDefinitions.get(scenario.name);
		const component = new ToolExecutionComponent(
			scenario.name,
			`tool-${scenario.name}-${i}`,
			scenario.args,
			{ showImages: false },
			toolDef,
			fakeUi as any,
			cwd,
		);
		component.markExecutionStarted();
		component.setArgsComplete();
		component.updateResult(scenario.result as any, false);
		root.addChild(component);
		tail = component;
	}

	await sleep(1200);
	return { root, tail };
}

function buildAssistantTree(count: number): { root: Container; tail: any } {
	const root = new Container();
	let tail: any = null;
	for (let i = 0; i < count; i++) {
		const component = new AssistantMessageComponent(makeAssistantMessage(i) as any, false);
		root.addChild(component);
		tail = component;
	}
	return { root, tail };
}

async function runCase(name: string, builder: () => Promise<{ root: Container; tail: any }>): Promise<BenchmarkCase> {
	const built = await builder();
	const { value: firstLines, ms: firstRenderMs } = elapsedMs(() => built.root.render(width));
	await sleep(1200);
	const warmAvgMs = averageMs(warmRepeats, () => {
		built.root.render(width);
	});
	const tailInvalidateAvgMs = averageMs(tailRepeats, () => {
		built.tail?.invalidate?.();
		built.root.render(width);
	});
	return {
		name,
		componentCount: built.root.children.length,
		firstRenderMs,
		warmAvgMs,
		tailInvalidateAvgMs,
		renderedLines: firstLines.length,
	};
}

async function runExecuteBench(toolDefinitions: Map<string, ToolDefinition>, cwd: string) {
	const writeTool = toolDefinitions.get("write");
	const editTool = toolDefinitions.get("edit");
	if (!writeTool?.execute || !editTool?.execute) return null;

	const writeFile = join(cwd, "src", "exec-bench-write.ts");
	const editFile = join(cwd, "src", "exec-bench-edit.ts");
	writeFileSync(writeFile, makeTsFile(500));
	writeFileSync(editFile, makeTsFile(501));

	const writeAvgMs = await averageMsAsync(8, async () => {
		const next = makeTsFile(600 + Math.floor(Math.random() * 20));
		await writeTool.execute?.("exec-write", { path: writeFile, content: next }, undefined, undefined, undefined);
	});

	const editAvgMs = await averageMsAsync(6, async ( ) => {
		const iteration = Math.floor(Math.random() * 1000);
		writeFileSync(editFile, makeTsFile(700 + iteration));
		await editTool.execute?.(
			`exec-edit-${iteration}`,
			{
				path: editFile,
				edits: [
					{ oldText: "const parts = input.split(\":\");", newText: "const parts = input.trim().split(\":\");" },
				],
			},
			undefined,
			undefined,
			undefined,
		);
	});

	return { writeAvgMs, editAvgMs };
}

async function main() {
	const cwd = buildWorkspace();
	const toolDefinitions = await loadToolDefinitions(cwd, mode);
	const executeBench = await runExecuteBench(toolDefinitions, cwd);

	const cases = [
		await runCase("assistant-history-120", async () => buildAssistantTree(120)),
		await runCase("tool-history-120", async () => buildToolTree(toolDefinitions, cwd, 120)),
		await runCase("tool-history-240", async () => buildToolTree(toolDefinitions, cwd, 240)),
	];

	const output = {
		mode,
		width,
		warmRepeats,
		tailRepeats,
		executeBench,
		cases,
		heapUsedMb: Number((process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)),
	};

	console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
