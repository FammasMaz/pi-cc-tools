// Test-only loader for tool-ctx-forward.test.mts: when extensions/index.ts imports
// "@earendil-works/pi-coding-agent", hand it the shim module instead, so the test
// can observe the arguments the overrides pass to Pi's built-in tool factories.
// ESM namespaces are frozen, so the swap has to happen at resolution time.
const PACKAGE = "@earendil-works/pi-coding-agent";
let shimURL;

export async function initialize(data) {
	shimURL = data?.shimURL;
}

export async function resolve(specifier, context, next) {
	if (shimURL && specifier === PACKAGE && context.parentURL?.includes("/extensions/")) {
		return { url: shimURL, shortCircuit: true };
	}
	return next(specifier, context);
}
