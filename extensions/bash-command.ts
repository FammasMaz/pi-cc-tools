export interface BashCommandPresentation {
	headline: string;
	sourceLines: string[];
	sourceLineCount: number;
}

const CONTROL_CHAR_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;
const ANSI_ESCAPE_RE = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))/g;
const HEADLINE_SKIP_RE = /^(?:#|set(?:\s|$)|cd(?:\s|$)|(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=|(?:\{|\}|do|done|then|fi|esac)$)/;

function normalizeHeadline(line: string): string {
	return line.replace(/\s+/g, " ").trim();
}

function summarize(text: string, max = 180): string {
	if (text.length <= max) return text;
	const head = Math.max(1, Math.ceil((max - 3) * 0.65));
	const tail = Math.max(1, max - 3 - head);
	return `${text.slice(0, head)}...${text.slice(-tail)}`;
}

function sanitizeSource(command: string): string[] {
	const lines = command
		.replace(/\r\n?/g, "\n")
		.replace(CONTROL_CHAR_RE, "")
		.replace(/\t/g, "   ")
		.split("\n");
	while (lines.length > 1 && lines[0].trim() === "") lines.shift();
	while (lines.length > 1 && lines[lines.length - 1].trim() === "") lines.pop();
	return lines;
}

export function buildBashCommandPresentation(command: string): BashCommandPresentation {
	const sourceLines = sanitizeSource(command);
	const nonBlank = sourceLines.map(normalizeHeadline).filter(Boolean);
	const operative = nonBlank.find((line) => !HEADLINE_SKIP_RE.test(line)) ?? nonBlank[0] ?? "command";
	let headline = summarize(operative);
	if (sourceLines.length > 1) headline += ` · ${sourceLines.length} lines`;
	return {
		headline,
		sourceLines,
		sourceLineCount: sourceLines.length,
	};
}

export function describeBashSource(presentation: BashCommandPresentation): string {
	return presentation.sourceLineCount === 1 ? "command" : `script · ${presentation.sourceLineCount} lines`;
}

export function formatBashDuration(ms: number): string {
	const safeMs = Math.max(0, Number.isFinite(ms) ? ms : 0);
	if (safeMs < 1_000) return "<1s";
	const totalSeconds = Math.floor(safeMs / 1_000);
	if (totalSeconds < 60) return `${totalSeconds}s`;
	const totalMinutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	if (totalMinutes < 60) return `${totalMinutes}m ${String(seconds).padStart(2, "0")}s`;
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}

export function getLastBashOutputLine(output: string): string | undefined {
	const lines = output
		.replace(/\r\n/g, "\n")
		.replace(/\r/g, "\n")
		.split("\n");
	for (let index = lines.length - 1; index >= 0; index--) {
		const line = lines[index]
			.replace(ANSI_ESCAPE_RE, "")
			.replace(CONTROL_CHAR_RE, "")
			.trim();
		if (line) return line;
	}
	return undefined;
}

export function buildBashPreview(sourceLines: string[], limit: number): string[] {
	if (limit <= 0 || sourceLines.length === 0) return [];
	if (sourceLines.length <= limit) return [...sourceLines];
	if (limit === 1) return [`... ${sourceLines.length} more lines`];
	const shown = sourceLines.slice(0, limit - 1);
	return [...shown, `... ${sourceLines.length - shown.length} more lines`];
}
