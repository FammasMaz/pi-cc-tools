import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const root = process.env.PI_AGENT_ROOT ?? resolve(require.resolve("@earendil-works/pi-coding-agent/package.json"), "..");
const { version } = require(`${root}/node_modules/@earendil-works/pi-tui/package.json`);
if (Number(version.split(".")[1]) < 85) {
	throw new Error(`Fullscreen mouse test requires Pi TUI 0.85+ (found ${version}); set PI_AGENT_ROOT to a current Pi install`);
}
const extensionPath = resolve(fileURLToPath(new URL("../extensions/index.ts", import.meta.url)));
const { initTheme } = await import(`${root}/dist/modes/interactive/theme/theme.js`);
initTheme("dark", false);
const { Container, TuiAltScreen } = await import(`${root}/node_modules/@earendil-works/pi-tui/dist/index.js`);
const { renderLayoutFrame } = await import(`${root}/node_modules/@earendil-works/pi-tui/dist/layout.js`);
const { dispatchMouseEvent } = await import(`${root}/node_modules/@earendil-works/pi-tui/dist/tui.js`);
const {
	AssistantMessageComponent,
	ToolExecutionComponent,
} = await import(`${root}/dist/modes/interactive/components/index.js`);

const { extensions, errors } = await (async () => {
	const loader = await import(`${root}/dist/core/extensions/loader.js`);
	return loader.loadExtensions([
		extensionPath,
	], process.cwd());
})();
if (errors?.length) {
	console.error(errors);
	process.exit(1);
}
const extension = extensions[0];
const readTool = extension.tools.get("read");
const read = readTool?.definition ?? readTool;
if (!read?.renderCall) {
	console.error("read renderer missing", read);
	process.exit(1);
}

const chat = new Container();
const ui = { requestRender() {} };

const failures = [];
function check(name, ok, detail) {
	if (!ok) failures.push(`${name}: ${detail}`);
	else console.log(`ok ${name}`);
}

const tool = new ToolExecutionComponent("read", "call-1", { path: "extensions/index.ts" }, undefined, read, ui, process.cwd());
chat.addChild(tool);
tool.updateResult({ content: [{ type: "text", text: "line one\nline two\nline three" }], isError: false }, false);
tool.render(80);
tool.render(80);
tool.render(80);
tool.setExpanded(false);

const secondTool = new ToolExecutionComponent("read", "call-2", { path: "extensions/spinner.ts" }, undefined, read, ui, process.cwd());
secondTool.updateResult({ content: [{ type: "text", text: "spinner" }], isError: false }, false);
chat.addChild(secondTool);
const group = chat.children.find((child) => Array.isArray(child.tools));
check("tools grouped", !!group, chat.children.map((child) => child.constructor.name).join(","));
if (group) {
	const groupLines = group.render(80);
	group.render(80);
	const plain = groupLines.map((line) => line.replace(/\x1b\[[0-9;]*m/g, ""));
	const y = plain.findIndex((line, i) => i > 1 && line.includes("spinner"));
	const wheelEvent = dispatchMouseEvent(group, {
		type: "wheel", button: "none", x: 2, y, screenX: 2, screenY: y,
		width: 80, height: group.render(80).length, shift: false, alt: false, ctrl: false, wheelDelta: -3,
	});
	check("grouped wheel stays unhandled", wheelEvent === undefined, `handled=${wheelEvent?.handled}`);
	const drag = dispatchMouseEvent(group, {
		type: "drag", button: "left", x: 2, y, screenX: 2, screenY: y,
		width: 80, height: group.render(80).length, shift: false, alt: false, ctrl: false,
	});
	check("grouped drag stays unhandled", drag === undefined, `handled=${drag?.handled}`);
	const move = dispatchMouseEvent(group, {
		type: "move", button: "none", x: 2, y, screenX: 2, screenY: y,
		width: 80, height: group.render(80).length, shift: false, alt: false, ctrl: false,
	});
	check("grouped move does not recurse", move?.handled === true || move === undefined, `handled=${move?.handled}`);
	group.render(80);
	const cachedMove = dispatchMouseEvent(group, {
		type: "move", button: "none", x: 2, y, screenX: 2, screenY: y,
		width: 80, height: group.render(80).length, shift: false, alt: false, ctrl: false,
	});
	check("cached grouped move does not recurse", cachedMove?.handled === true || cachedMove === undefined, `handled=${cachedMove?.handled}`);
}

// Exercise Pi's fullscreen press/release/click path, not direct click dispatch.
function fullscreen(component) {
	const terminal = { columns: 80, rows: 20, write() {} };
	const tui = new TuiAltScreen(terminal, false, undefined, { mouse: true });
	tui.setLayoutRoot(component);
	const frame = () => { tui.currentLayout = renderLayoutFrame(component, 80, 20, () => {}); };
	const event = (button, y, release = false) => tui.handleMouseEvent({ button, x: 2, y, release });
	frame();
	return { tui, frame, event };
}

const realGroup = fullscreen(group);
group.setExpanded(false);
realGroup.frame();
const groupRows = group.render(80).map((line) => line.replace(/\x1b\[[0-9;]*m/g, ""));
const secondRow = groupRows.findIndex((line) => line.includes("spinner"));
realGroup.event(0, secondRow);
check("fullscreen group leaves press for selection", realGroup.tui.selectionPressActive && !realGroup.tui.mousePressTarget, "group stole selection press");
realGroup.event(0, secondRow, true);
check("fullscreen click opens only second tool", !group.tools[0].expanded && group.tools[1].expanded, JSON.stringify(group.tools.map((tool) => tool.expanded)));
realGroup.frame();
realGroup.event(0, 1);
realGroup.event(0, 1, true);
check("fullscreen header opens all tools", group.tools.every((tool) => tool.expanded), JSON.stringify(group.tools.map((tool) => tool.expanded)));
realGroup.frame();
realGroup.event(0, 1);
realGroup.event(0, 1, true);
check("fullscreen header collapses all tools", group.tools.every((tool) => !tool.expanded), JSON.stringify(group.tools.map((tool) => tool.expanded)));
realGroup.frame();
realGroup.event(35, 19);
const unhovered = group.render(80);
realGroup.event(35, secondRow);
const hovered = group.render(80);
check("hover brightens only target row", hovered[secondRow] !== unhovered[secondRow] && hovered.every((line, i) => i === secondRow || line === unhovered[i]), JSON.stringify({ before: unhovered.slice(1, 4), after: hovered.slice(1, 4) }));
realGroup.event(35, 2);
const firstHovered = group.render(80);
check("hover transfers to sibling row", firstHovered[2] !== unhovered[2] && firstHovered[secondRow] === unhovered[secondRow], "previous row remained bright");
realGroup.event(35, 19);
check("hover leaves through blank viewport", group.render(80).every((line, i) => line === unhovered[i]), "hover persisted after moving away");
realGroup.event(0, secondRow);
realGroup.event(32, secondRow + 1);
check("drag remains transcript selection", realGroup.tui.selectionDragged && !realGroup.tui.mousePressTarget, "drag captured by group");
realGroup.event(0, secondRow + 1, true);

const repeatedChat = new Container();
const repeated = ["repeat-1", "repeat-2"].map((id) => {
	const item = new ToolExecutionComponent("read", id, { path: "extensions/index.ts" }, undefined, read, ui, process.cwd());
	item.updateResult({ content: [{ type: "text", text: id }], isError: false }, false);
	repeatedChat.addChild(item);
	return item;
});
const repeatedGroup = repeatedChat.children.find((child) => Array.isArray(child.tools));
const repeatedTui = fullscreen(repeatedGroup);
check("repeated reads collapse to one row", repeatedGroup.render(80).length === 1, String(repeatedGroup.render(80).length));
repeatedTui.event(0, 0);
repeatedTui.event(0, 0, true);
check("repeated row opens all members", repeated.every((tool) => tool.expanded), JSON.stringify(repeated.map((tool) => tool.expanded)));
repeatedTui.frame();
repeatedTui.event(0, 1);
repeatedTui.event(0, 1, true);
check("repeated header closes all members", repeated.every((tool) => !tool.expanded), JSON.stringify(repeated.map((tool) => tool.expanded)));

const mixedChat = new Container();
for (const [name, id, args] of [
	["read", "mixed-read", { path: "extensions/index.ts" }],
	["grep", "mixed-grep", { pattern: "mouse", path: "extensions/index.ts" }],
]) {
	const definition = extension.tools.get(name).definition;
	const item = new ToolExecutionComponent(name, id, args, undefined, definition, ui, process.cwd());
	item.updateResult({ content: [{ type: "text", text: id }], isError: false }, false);
	mixedChat.addChild(item);
}
const mixedGroup = mixedChat.children.find((child) => Array.isArray(child.tools));
const mixedTui = fullscreen(mixedGroup);
const mixedLines = mixedGroup.render(80).map((line) => line.replace(/\x1b\[[0-9;]*m/g, ""));
const grepY = mixedLines.findIndex((line) => line.includes("mouse"));
check("mixed group has separate rows", grepY >= 0, JSON.stringify(mixedLines));
mixedTui.event(0, grepY);
mixedTui.event(0, grepY, true);
check("mixed group click opens grep alone", !mixedGroup.tools[0].expanded && mixedGroup.tools[1].expanded, JSON.stringify(mixedGroup.tools.map((tool) => tool.expanded)));

const soloChat = new Container();
const soloTool = new ToolExecutionComponent("read", "solo", { path: "extensions/index.ts" }, undefined, read, ui, process.cwd());
soloTool.updateResult({ content: [{ type: "text", text: "solo output" }], isError: false }, false);
soloChat.addChild(soloTool);
const soloTui = fullscreen(soloChat);
const soloRows = soloChat.render(80).map((line) => line.replace(/\x1b\[[0-9;]*m/g, ""));
const soloY = soloRows.findIndex((line) => line.includes("extensions/index.ts"));
soloTui.event(0, soloY);
check("fullscreen solo tool leaves press for selection", soloTui.tui.selectionPressActive && !soloTui.tui.mousePressTarget, "solo tool stole selection press");
soloTui.event(0, soloY, true);
check("fullscreen solo tool expands", soloTool.expanded === true, String(soloTool.expanded));
soloTui.frame();
soloTui.event(35, 19);
const soloBeforeHover = soloTool.render(80);
soloTui.event(35, soloY);
const soloHovered = soloTool.render(80);
check("solo hover changes just title", soloHovered[soloY] !== soloBeforeHover[soloY] && soloHovered.every((line, i) => i === soloY || line === soloBeforeHover[i]), "solo hover altered output rows");
soloTui.event(35, 19);
check("solo hover clears on exit", soloTool.render(80).every((line, i) => line === soloBeforeHover[i]), "solo hover persisted");
soloTui.event(35, soloY);
soloTui.tui.handleViewportInput("\x1b[O");
check("solo hover clears on terminal blur", soloTool.render(80).every((line, i) => line === soloBeforeHover[i]), "hover persisted after focus-out");

const assistant = new AssistantMessageComponent({
	role: "assistant", content: [{ type: "thinking", thinking: "Need to inspect the mouse layout before changing the renderer." }],
	stopReason: "stop",
}, true);
assistant.updateContent(assistant.lastMessage, false);
const summaryY = assistant.render(80).findIndex((line) => line.includes("Thought for"));
const realThinking = fullscreen(assistant);
realThinking.event(0, summaryY);
check("fullscreen thinking leaves press for selection", realThinking.tui.selectionPressActive && !realThinking.tui.mousePressTarget, "thinking stole selection press");
realThinking.event(0, summaryY, true);
check("fullscreen thinking expands", assistant.render(80).some((line) => line.includes("inspect the mouse")), "thinking stayed collapsed");
realThinking.frame();
const expandedY = assistant.render(80).findIndex((line) => line.includes("inspect the mouse"));
realThinking.event(0, expandedY);
realThinking.event(0, expandedY, true);
check("fullscreen thinking collapses again", !assistant.render(80).some((line) => line.includes("inspect the mouse")), "thinking stayed expanded");

const liveThinking = new AssistantMessageComponent({
	role: "assistant", content: [{ type: "thinking", thinking: "Streaming thought" }],
	stopReason: "pending",
}, true);
liveThinking.updateContent(liveThinking.lastMessage, true);
const liveTui = fullscreen(liveThinking);
const liveY = liveThinking.render(80).findIndex((line) => line.includes("Streaming thought"));
check("live thinking starts expanded in custom style", liveY >= 0 && !liveThinking.render(80)[liveY].includes("\x1b[3m"), String(liveY));
liveTui.event(0, liveY);
liveTui.event(0, liveY, true);
const collapsedLive = liveThinking.render(80).join("\n");
check("live collapse retains custom nonitalic row", collapsedLive.includes("Thinking…") && !collapsedLive.includes("\x1b[3m") && !collapsedLive.includes("Streaming thought"), collapsedLive);
liveThinking.updateContent(liveThinking.lastMessage, true);
check("live stream update keeps collapse", !liveThinking.render(80).join("\n").includes("Streaming thought"), "stream reopened thinking");
liveTui.frame();
const collapsedY = liveThinking.render(80).findIndex((line) => line.includes("Thinking…"));
liveTui.event(0, collapsedY);
liveTui.event(0, collapsedY, true);
check("live thinking reopens in custom style", liveThinking.render(80).join("\n").includes("Streaming thought") && !liveThinking.render(80).join("\n").includes("\x1b[3m"), "live thought did not reopen");
liveTui.frame();
liveTui.event(0, liveY);
liveTui.event(0, liveY, true);
liveThinking.lastMessage.stopReason = "stop";
liveThinking.updateContent(liveThinking.lastMessage, false);
const completedLive = liveThinking.render(80).join("\n");
check("completed live collapse keeps custom duration", completedLive.includes("Thought for") && !completedLive.includes("\x1b[3m"), completedLive);

const staleMessage = {
	role: "assistant", content: [{ type: "thinking", thinking: "A short thought" }],
	stopReason: "stop", _piClaudeStyleThinkingDurationMs: Date.now(),
};
const staleComponent = new AssistantMessageComponent(staleMessage, true);
check("impossible historical duration repaired", !staleComponent.render(80).join("").includes("20719d") && !staleComponent.render(80).join("").includes("d "), staleComponent.render(80).join(""));
const handlers = extension.handlers;
const update = (event) => Promise.all((handlers.get("message_update") ?? []).map((handler) => handler(event, { ui: { invalidate() {}, requestRender() {} } })));
const orphan = { role: "assistant", content: [{ type: "thinking", thinking: "Brief" }], stopReason: "stop" };
await update({ message: orphan, assistantMessageEvent: { type: "thinking_end" } });
check("unmatched thinking_end cannot stamp epoch duration", !(orphan._piClaudeStyleThinkingDurationMs > 86_400_000), String(orphan._piClaudeStyleThinkingDurationMs));

if (failures.length) {
	console.error(failures.join("\n"));
	process.exit(1);
}
console.log("all mouse checks passed");
