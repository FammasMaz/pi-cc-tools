export interface BashOutlineAction {
	kind: "action";
	line: string;
}

export interface BashOutlineHeredoc {
	kind: "heredoc";
	label: string;
	bodyLines: string[];
}

export type BashOutlineItem = BashOutlineAction | BashOutlineHeredoc;

export interface BashCommandPresentation {
	headline: string;
	headlineSourceLine: string;
	outlineItems: BashOutlineItem[];
	outlineLines: string[];
	sourceLines: string[];
	sourceLineCount: number;
}

const CONTROL_CHAR_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;
const ASSIGNMENT_RE = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;
const HEREDOC_RE = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/;

function normalizeLine(line: string): string {
	return line.replace(/\t/g, "   ").replace(CONTROL_CHAR_RE, "").replace(/\s+/g, " ").trim();
}

function preserveLine(line: string): string {
	return line.replace(/\t/g, "   ").replace(CONTROL_CHAR_RE, "").trimEnd();
}

function summarize(text: string, max = 180): string {
	if (text.length <= max) return text;
	const head = Math.max(1, Math.ceil((max - 3) * 0.65));
	const tail = Math.max(1, max - 3 - head);
	return `${text.slice(0, head)}...${text.slice(-tail)}`;
}

function isStructuralLine(line: string): boolean {
	return /^(?:\{|\}|do|done|then|fi|esac)$/.test(normalizeLine(line));
}

function setupDescription(line: string): string | undefined {
	const normalized = normalizeLine(line);
	if (/^set\s+/.test(normalized)) return "strict mode";
	const assignment = ASSIGNMENT_RE.exec(normalized);
	if (assignment) return assignment[1];
	if (/^cd\s+/.test(normalized)) return summarize(normalized, 80);
	if (/^(?:source|\.)\s+/.test(normalized)) return summarize(normalized, 80);
	if (/^(?:export|trap)\s+/.test(normalized)) return summarize(normalized, 80);
	return undefined;
}

function findHeredocEnd(lines: string[], start: number, delimiter: string): number | undefined {
	for (let index = start + 1; index < lines.length; index++) {
		if (lines[index].trim() === delimiter) return index;
	}
	return undefined;
}

function heredocLabel(line: string, delimiter: string): string {
	if (/\.(?:ba)?sh\b/.test(line) || /^(?:SH|BASH|SCRIPT)$/.test(delimiter)) return "script";
	return "stdin";
}

function heredocConsumer(line: string, match: RegExpExecArray): string | undefined {
	const prefix = line.slice(0, match.index).trim();
	if (prefix !== "cat") return undefined;
	const suffix = line.slice(match.index + match[0].length);
	const consumer = /^\s*\|\s*(.+)$/.exec(suffix)?.[1];
	return consumer ? normalizeLine(consumer) : undefined;
}

function flattenOutline(items: BashOutlineItem[]): string[] {
	return items.flatMap((item) => {
		if (item.kind === "action") return [item.line];
		const count = item.bodyLines.length;
		return [
			`${item.label} · ${count} ${count === 1 ? "line" : "lines"}`,
			...item.bodyLines.map((line) => `  ${line}`),
		];
	});
}

function buildOutline(sourceLines: string[]): BashOutlineItem[] {
	const items: BashOutlineItem[] = [];
	const setup: string[] = [];
	const flushSetup = () => {
		if (setup.length === 0) return;
		items.push({ kind: "action", line: `setup: ${setup.join(", ")}` });
		setup.length = 0;
	};

	for (let index = 0; index < sourceLines.length; index++) {
		const line = sourceLines[index];
		const trimmed = line.trim();
		if (trimmed.length === 0 || trimmed.startsWith("#") || isStructuralLine(line)) continue;

		const description = setupDescription(line);
		if (description && items.length === 0) {
			if (!setup.includes(description)) setup.push(description);
			continue;
		}
		flushSetup();
		items.push({ kind: "action", line: normalizeLine(line) });

		const match = HEREDOC_RE.exec(line);
		if (!match) continue;
		const end = findHeredocEnd(sourceLines, index, match[2]);
		if (end === undefined) continue;
		items.push({
			kind: "heredoc",
			label: heredocLabel(line, match[2]),
			bodyLines: sourceLines.slice(index + 1, end).map(preserveLine),
		});
		index = end;
	}
	flushSetup();
	return items;
}

function headlineFor(sourceLines: string[], outlineItems: BashOutlineItem[]): { text: string; sourceLine: string } {
	const meaningful = sourceLines.filter((line) => {
		const trimmed = line.trim();
		return trimmed.length > 0 && !trimmed.startsWith("#") && !isStructuralLine(line);
	});
	const operative = meaningful.find((line) => setupDescription(line) === undefined) ?? meaningful[0] ?? "command";
	const sourceLine = normalizeLine(operative);
	const heredoc = HEREDOC_RE.exec(operative);
	if (heredoc) {
		const sourceIndex = sourceLines.indexOf(operative);
		const end = findHeredocEnd(sourceLines, sourceIndex, heredoc[2]);
		if (end !== undefined) {
			const bodyLineCount = end - sourceIndex - 1;
			const label = heredocLabel(operative, heredoc[2]);
			const command = heredocConsumer(operative, heredoc) ?? sourceLine;
			return {
				text: `${summarize(command)} · ${label}: ${bodyLineCount} ${bodyLineCount === 1 ? "line" : "lines"}`,
				sourceLine,
			};
		}
	}
	let text = summarize(sourceLine);
	if (sourceLines.length > 1) text += ` · ${sourceLines.length} lines`;
	if (text === `command · ${sourceLines.length} lines` && outlineItems.length > 0) {
		const first = outlineItems[0];
		const firstLine = first.kind === "action" ? first.line : first.label;
		text = `${summarize(firstLine)} · ${sourceLines.length} lines`;
	}
	return { text, sourceLine };
}

export function buildBashCommandPresentation(command: string): BashCommandPresentation {
	const sanitized = command.replace(CONTROL_CHAR_RE, "");
	const sourceLines = sanitized.replace(/\t/g, "   ").split("\n");
	while (sourceLines.length > 1 && sourceLines[0].trim() === "") sourceLines.shift();
	while (sourceLines.length > 1 && sourceLines[sourceLines.length - 1].trim() === "") sourceLines.pop();
	const outlineItems = buildOutline(sourceLines);
	const headline = headlineFor(sourceLines, outlineItems);
	return {
		headline: headline.text,
		headlineSourceLine: headline.sourceLine,
		outlineItems,
		outlineLines: flattenOutline(outlineItems),
		sourceLines,
		sourceLineCount: sourceLines.length,
	};
}

export function omitBashHeadlineFromOutline(presentation: BashCommandPresentation): string[] {
	return flattenOutline(omitBashHeadlineFromItems(presentation));
}

function omitBashHeadlineFromItems(presentation: BashCommandPresentation): BashOutlineItem[] {
	const index = presentation.outlineItems.findIndex(
		(item) => item.kind === "action" && item.line === presentation.headlineSourceLine,
	);
	if (index === -1) return presentation.outlineItems;
	return presentation.outlineItems.filter((_, itemIndex) => itemIndex !== index);
}

export function limitBashOutline(lines: string[], limit: number): string[] {
	if (limit <= 0) return [];
	if (lines.length <= limit) return lines;
	if (limit === 1) return [`... ${lines.length} lines`];
	const shown = lines.slice(0, limit - 1);
	shown.push(`... ${lines.length - shown.length} more lines`);
	return shown;
}

function renderHeredoc(item: BashOutlineHeredoc, budget: number): string[] {
	const count = item.bodyLines.length;
	const lines = [`${item.label} · ${count} ${count === 1 ? "line" : "lines"}`];
	const bodyBudget = budget - 1;
	if (bodyBudget <= 0 || count === 0) return lines;
	if (count <= bodyBudget) return [...lines, ...item.bodyLines.map((line) => `  ${line}`)];
	if (bodyBudget === 1) return [...lines, `  ${item.bodyLines[0]}`];
	const shown = item.bodyLines.slice(0, bodyBudget - 1);
	return [...lines, ...shown.map((line) => `  ${line}`), `  ... ${count - shown.length} more lines`];
}

export function buildBashOutlinePreview(presentation: BashCommandPresentation, limit: number): string[] {
	if (limit <= 0) return [];
	const items = omitBashHeadlineFromItems(presentation);
	if (items.length === 0) return [];

	const visibleItems = items.length <= limit ? items : items.slice(0, limit - 1);
	const hiddenItemCount = items.length - visibleItems.length;
	let extraRows = limit - visibleItems.length - (hiddenItemCount > 0 ? 1 : 0);
	const lines: string[] = [];
	for (const item of visibleItems) {
		if (item.kind === "action") {
			lines.push(item.line);
			continue;
		}
		const desiredRows = Math.min(4, item.bodyLines.length + 1);
		const rows = 1 + Math.min(extraRows, desiredRows - 1);
		lines.push(...renderHeredoc(item, rows));
		extraRows -= rows - 1;
	}
	if (hiddenItemCount > 0) lines.push(`... ${hiddenItemCount} more lines`);
	return lines;
}
