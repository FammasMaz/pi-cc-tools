export interface BashCommandPresentation {
	headline: string;
	headlineSourceLine: string;
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

function summarize(text: string, max = 180): string {
	if (text.length <= max) return text;
	const head = Math.max(1, Math.ceil((max - 3) * 0.65));
	const tail = Math.max(1, max - 3 - head);
	return `${text.slice(0, head)}...${text.slice(-tail)}`;
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

function collapseHeredocs(lines: string[]): string[] {
	const result: string[] = [];
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index];
		result.push(line);
		const match = HEREDOC_RE.exec(line);
		if (!match) continue;
		const delimiter = match[2];
		let end = index + 1;
		while (end < lines.length && lines[end].trim() !== delimiter) end++;
		if (end >= lines.length) continue;
		const bodyLines = Math.max(0, end - index - 1);
		if (bodyLines > 0) result.push(`  ... heredoc (${bodyLines} ${bodyLines === 1 ? "line" : "lines"})`);
		result.push(lines[end]);
		index = end;
	}
	return result;
}

function buildOutline(sourceLines: string[]): string[] {
	const meaningful = collapseHeredocs(sourceLines).filter((line) => {
		const trimmed = line.trim();
		return trimmed.length > 0 && !trimmed.startsWith("#");
	});
	const outline: string[] = [];
	const setup: string[] = [];
	for (const line of meaningful) {
		const description = setupDescription(line);
		if (description && outline.length === 0) {
			if (!setup.includes(description)) setup.push(description);
			continue;
		}
		if (setup.length > 0) {
			outline.push(`setup: ${setup.join(", ")}`);
			setup.length = 0;
		}
		outline.push(normalizeLine(line));
	}
	if (setup.length > 0) outline.push(`setup: ${setup.join(", ")}`);
	return outline;
}

function headlineFor(sourceLines: string[], outlineLines: string[]): { text: string; sourceLine: string } {
	const meaningful = sourceLines.filter((line) => {
		const trimmed = line.trim();
		return trimmed.length > 0 && !trimmed.startsWith("#");
	});
	const operative = meaningful.find((line) => setupDescription(line) === undefined) ?? meaningful[0] ?? "command";
	const sourceLine = normalizeLine(operative);
	let text = summarize(sourceLine);
	if (sourceLines.length > 1) text += ` · ${sourceLines.length} lines`;
	if (text === `command · ${sourceLines.length} lines` && outlineLines.length > 0) {
		text = `${summarize(outlineLines[0])} · ${sourceLines.length} lines`;
	}
	return { text, sourceLine };
}

export function buildBashCommandPresentation(command: string): BashCommandPresentation {
	const sanitized = command.replace(CONTROL_CHAR_RE, "");
	const sourceLines = sanitized.replace(/\t/g, "   ").split("\n");
	while (sourceLines.length > 1 && sourceLines[0].trim() === "") sourceLines.shift();
	while (sourceLines.length > 1 && sourceLines[sourceLines.length - 1].trim() === "") sourceLines.pop();
	const outlineLines = buildOutline(sourceLines);
	const headline = headlineFor(sourceLines, outlineLines);
	return {
		headline: headline.text,
		headlineSourceLine: headline.sourceLine,
		outlineLines,
		sourceLines,
		sourceLineCount: sourceLines.length,
	};
}

export function omitBashHeadlineFromOutline(presentation: BashCommandPresentation): string[] {
	const index = presentation.outlineLines.indexOf(presentation.headlineSourceLine);
	if (index === -1) return presentation.outlineLines;
	return presentation.outlineLines.filter((_, lineIndex) => lineIndex !== index);
}

export function limitBashOutline(lines: string[], limit: number): string[] {
	if (limit <= 0) return [];
	if (lines.length <= limit) return lines;
	if (limit === 1) return [`... ${lines.length} actions`];
	const shown = lines.slice(0, limit - 1);
	shown.push(`... ${lines.length - shown.length} more actions`);
	return shown;
}
