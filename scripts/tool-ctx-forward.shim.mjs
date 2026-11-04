// Shim of @earendil-works/pi-coding-agent for tool-ctx-forward.test.mts. Everything is
// the real package except the seven built-in tool factories, whose `execute` records
// the 5th `ctx` argument it was called with (globalThis.__piToolCtxReceived).
import * as real from "@earendil-works/pi-coding-agent";

export * from "@earendil-works/pi-coding-agent";

const received = (globalThis.__piToolCtxReceived ??= new Map());

function recording(name, factory) {
	return (...factoryArgs) => ({
		...factory(...factoryArgs),
		async execute(...args) {
			received.set(name, { argc: args.length, ctx: args[4] });
			return { content: [{ type: "text", text: "" }], details: {} };
		},
	});
}

export const createReadTool = recording("read", real.createReadTool);
export const createBashTool = recording("bash", real.createBashTool);
export const createGrepTool = recording("grep", real.createGrepTool);
export const createFindTool = recording("find", real.createFindTool);
export const createLsTool = recording("ls", real.createLsTool);
export const createWriteTool = recording("write", real.createWriteTool);
export const createEditTool = recording("edit", real.createEditTool);
