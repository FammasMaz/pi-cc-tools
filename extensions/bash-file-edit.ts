// Recognize shell commands that only change files (sed -i, perl -pi, heredoc and echo
// redirects), so their bash rows can be drawn like edit/write rows with a diff.
// Purely a rendering aid: the command runs unchanged, and anything this parser is
// unsure about stays an ordinary bash row.

export type BashFileEditKind = "edit" | "write";

export interface BashFileEdit {
	/** "edit" for in-place changes and appends, "write" for files written whole. */
	kind: BashFileEditKind;
	/** How the file was changed, shown next to the label: "sed", "perl", "heredoc", "echo", "printf", "append". */
	via: string;
	/** Target paths as written in the command. */
	paths: string[];
	/** Directory from a leading `cd DIR &&`, as written. */
	cd?: string;
	/** Content written by a heredoc or echo/printf redirect, when known. */
	content?: string;
}

type Token = { type: "word"; value: string } | { type: "op"; value: string };

const MAX_COMMAND_LENGTH = 200_000;

/** Split a heredoc body off the command: `cat > f <<'EOF'\nbody\nEOF` → head + body. */
function splitHeredoc(command: string): { head: string; body?: string; rest: string; expands?: boolean } | undefined {
	const match = /<<-?[ \t]*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/.exec(command);
	if (!match) return { head: command, rest: "" };
	const newline = command.indexOf("\n", match.index);
	if (newline === -1) return undefined;
	const delimiter = match[2];
	const stripTabs = command.slice(match.index, match.index + 3) === "<<-";
	const lines = command.slice(newline + 1).split("\n");
	const end = lines.findIndex((line) => (stripTabs ? line.replace(/^\t+/, "") : line) === delimiter);
	if (end === -1) return undefined;
	const head = command.slice(0, match.index) + command.slice(match.index + match[0].length, newline);
	const body = lines.slice(0, end).map((line) => (stripTabs ? line.replace(/^\t+/, "") : line)).join("\n");
	// An unquoted delimiter lets the shell expand $VAR and `cmd` in the body.
	const expands = !match[1] && /[$`\\]/.test(body);
	return { head: `${head} <<HEREDOC`, body: `${body}\n`, rest: lines.slice(end + 1).join("\n"), expands };
}

/** Minimal POSIX-ish tokenizer: quotes, backslash escapes, and the operators we care about. */
function tokenize(text: string): Token[] | undefined {
	const tokens: Token[] = [];
	let i = 0;
	let word: string | null = null;
	const flush = () => {
		if (word !== null) tokens.push({ type: "word", value: word });
		word = null;
	};
	while (i < text.length) {
		const c = text[i];
		if (c === " " || c === "\t" || c === "\n") {
			flush();
			if (c === "\n") tokens.push({ type: "op", value: ";" });
			i++;
			continue;
		}
		if (c === "'") {
			const end = text.indexOf("'", i + 1);
			if (end === -1) return undefined;
			word = (word ?? "") + text.slice(i + 1, end);
			i = end + 1;
			continue;
		}
		if (c === '"') {
			let j = i + 1;
			let value = "";
			while (j < text.length && text[j] !== '"') {
				if (text[j] === "\\" && j + 1 < text.length && '"\\$`'.includes(text[j + 1])) {
					value += text[j + 1];
					j += 2;
					continue;
				}
				// Expansions inside double quotes make the value unknowable here.
				if (text[j] === "$" || text[j] === "`") return undefined;
				value += text[j++];
			}
			if (j >= text.length) return undefined;
			word = (word ?? "") + value;
			i = j + 1;
			continue;
		}
		if (c === "\\" && i + 1 < text.length) {
			word = (word ?? "") + text[i + 1];
			i += 2;
			continue;
		}
		const two = text.slice(i, i + 2);
		if (two === "&&" || two === "||" || two === ">>" || two === "<<") {
			flush();
			tokens.push({ type: "op", value: two });
			i += 2;
			continue;
		}
		if (c === ";" || c === "|" || c === ">" || c === "<" || c === "&" || c === "(" || c === ")") {
			flush();
			tokens.push({ type: "op", value: c });
			i++;
			continue;
		}
		if (c === "$" || c === "`") return undefined;
		word = (word ?? "") + c;
		i++;
	}
	flush();
	return tokens;
}

/** Split tokens into simple commands joined by && or ;. Pipes, ||, &, subshells: unsupported. */
function splitCommands(tokens: Token[]): Token[][] | undefined {
	const commands: Token[][] = [[]];
	for (const token of tokens) {
		if (token.type === "op" && (token.value === "&&" || token.value === ";")) {
			if (commands[commands.length - 1].length > 0) commands.push([]);
			continue;
		}
		if (token.type === "op" && ["||", "|", "&", "(", ")"].includes(token.value)) return undefined;
		commands[commands.length - 1].push(token);
	}
	return commands.filter((command) => command.length > 0);
}

const words = (command: Token[]): string[] | undefined =>
	command.every((token) => token.type === "word") ? command.map((token) => token.value) : undefined;

function isPlainPath(path: string): boolean {
	return path.length > 0 && path !== "-" && !/[*?[\]{}]/.test(path) && !path.startsWith("/dev/");
}

/** `sed -i[SUFFIX] [-e SCRIPT]... [SCRIPT] FILE...` (GNU and BSD forms). */
function parseSed(args: string[]): string[] | undefined {
	let inPlace = false;
	let haveScript = false;
	const files: string[] = [];
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "-i" || arg === "--in-place") {
			inPlace = true;
			// BSD sed: `-i ''` or `-i .bak` takes the suffix as its own argument.
			if (i + 1 < args.length && (args[i + 1] === "" || /^\.[\w.-]*$/.test(args[i + 1]))) i++;
			continue;
		}
		if (/^-i\S+$/.test(arg) || arg.startsWith("--in-place=")) {
			inPlace = true;
			continue;
		}
		if (arg === "-e" || arg === "--expression" || arg === "-f" || arg === "--file") {
			haveScript = true;
			i++;
			continue;
		}
		if (/^-[EnrsuzE]+$/.test(arg) || arg === "--regexp-extended" || arg === "--posix") continue;
		if (arg.startsWith("-")) return undefined;
		if (!haveScript) {
			haveScript = true;
			continue;
		}
		files.push(arg);
	}
	return inPlace && haveScript && files.length > 0 && files.every(isPlainPath) ? files : undefined;
}

/** `perl -pi[SUFFIX] -e SCRIPT FILE...` and combined flags such as `-0pi -e`. */
function parsePerl(args: string[]): string[] | undefined {
	let inPlace = false;
	let haveScript = false;
	const files: string[] = [];
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "-e" || arg === "-E") {
			haveScript = true;
			i++;
			continue;
		}
		if (/^-[\w.]+$/.test(arg)) {
			const flags = arg.slice(1);
			// Everything after `i` is the backup suffix (`-pi.bak`).
			if (flags.includes("i")) {
				inPlace = true;
				continue;
			}
			// `-pe SCRIPT`, `-0pe SCRIPT`.
			if (/[eE]$/.test(flags)) {
				haveScript = true;
				i++;
			}
			continue;
		}
		if (arg.startsWith("-")) return undefined;
		if (!haveScript) {
			haveScript = true;
			continue;
		}
		files.push(arg);
	}
	return inPlace && haveScript && files.length > 0 && files.every(isPlainPath) ? files : undefined;
}

/** `cat > FILE <<EOF`, `cat <<EOF >> FILE`, `tee [-a] FILE <<EOF`, `echo TEXT > FILE`, `printf FMT > FILE`. */
function parseWrite(command: Token[], heredocBody: string | undefined): Omit<BashFileEdit, "cd"> | undefined {
	const name = command[0]?.type === "word" ? command[0].value : "";
	const plain: string[] = [];
	let target: string | undefined;
	let append = false;
	let heredoc = false;
	for (let i = 1; i < command.length; i++) {
		const token = command[i];
		if (token.type === "op" && (token.value === ">" || token.value === ">>")) {
			const next = command[i + 1];
			if (target !== undefined || next?.type !== "word") return undefined;
			target = next.value;
			append = token.value === ">>";
			i++;
			continue;
		}
		if (token.type === "op" && token.value === "<<") {
			const next = command[i + 1];
			if (next?.type !== "word" || next.value !== "HEREDOC") return undefined;
			heredoc = true;
			i++;
			continue;
		}
		if (token.type === "op") return undefined;
		plain.push(token.value);
	}
	if (name === "cat" && heredoc && plain.length === 0 && target && isPlainPath(target)) {
		return { kind: append ? "edit" : "write", via: append ? "append" : "heredoc", paths: [target], content: heredocBody };
	}
	if (name === "tee" && heredoc && !target) {
		const teeAppend = plain[0] === "-a" || plain[0] === "--append";
		const files = teeAppend ? plain.slice(1) : plain;
		if (files.length !== 1 || !isPlainPath(files[0]) || files[0].startsWith("-")) return undefined;
		return { kind: teeAppend ? "edit" : "write", via: teeAppend ? "append" : "heredoc", paths: files, content: heredocBody };
	}
	if ((name === "echo" || name === "printf") && !heredoc && target && isPlainPath(target)) {
		let content: string | undefined;
		if (name === "echo") {
			const noNewline = plain[0] === "-n";
			const parts = plain.filter((part, index) => !(index === 0 && (part === "-n" || part === "-e")));
			content = `${parts.join(" ")}${noNewline ? "" : "\n"}`;
		}
		return { kind: append ? "edit" : "write", via: append ? "append" : name, paths: [target], content };
	}
	return undefined;
}

/**
 * The files a command changes, when it does nothing but change files: an optional leading
 * `cd DIR` and `mkdir -p DIR`, then one or more `sed -i` / `perl -pi` commands, or a
 * single heredoc or echo/printf redirect. Undefined for anything else.
 */
export function detectBashFileEdit(command: string): BashFileEdit | undefined {
	if (typeof command !== "string" || !command.trim() || command.length > MAX_COMMAND_LENGTH) return undefined;
	const split = splitHeredoc(command.trim());
	if (!split || split.rest.trim()) return undefined;
	const tokens = tokenize(split.head);
	if (!tokens) return undefined;
	const commands = splitCommands(tokens);
	if (!commands || commands.length === 0) return undefined;

	let cd: string | undefined;
	let index = 0;
	const first = words(commands[0]);
	if (first?.[0] === "cd" && first.length === 2 && isPlainPath(first[1])) {
		cd = first[1];
		index++;
	}
	while (index < commands.length) {
		const mkdir = words(commands[index]);
		if (mkdir?.[0] !== "mkdir" || !mkdir.slice(1).every((arg) => arg === "-p" || isPlainPath(arg))) break;
		index++;
	}
	const rest = commands.slice(index);
	if (rest.length === 0) return undefined;

	// In-place editors, possibly several in a row.
	const inPlace: string[] = [];
	let via: string | undefined;
	for (const segment of rest) {
		const args = words(segment);
		if (!args) {
			inPlace.length = 0;
			break;
		}
		const files = args[0] === "sed" || args[0] === "gsed" ? parseSed(args.slice(1)) : args[0] === "perl" ? parsePerl(args.slice(1)) : undefined;
		if (!files) {
			inPlace.length = 0;
			break;
		}
		const tool = args[0] === "perl" ? "perl" : "sed";
		via = via && via !== tool ? "shell" : tool;
		for (const file of files) if (!inPlace.includes(file)) inPlace.push(file);
	}
	if (inPlace.length > 0) return { kind: "edit", via: via ?? "sed", paths: inPlace, ...(cd ? { cd } : {}) };

	if (rest.length !== 1) return undefined;
	const write = parseWrite(rest[0], split.expands ? undefined : split.body);
	return write ? { ...write, ...(cd ? { cd } : {}) } : undefined;
}
