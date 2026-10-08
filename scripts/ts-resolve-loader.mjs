// Minimal resolve hook: lets node --test with --experimental-strip-types import
// extensions/index.ts, whose extensionless relative imports ("./bash-command")
// are module-agnostic and resolved here to the sibling .ts files.
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

async function tryResolve(baseURL, specifier) {
	for (const suffix of [".ts", "/index.ts"]) {
		const candidate = decodeURIComponent(baseURL.pathname) + suffix;
		if (existsSync(candidate)) return pathToFileURL(candidate).href;
	}
	return undefined;
}

export async function resolve(specifier, context, next) {
	try {
		return await next(specifier, context);
	} catch (error) {
		if (!specifier.startsWith("./") && !specifier.startsWith("../")) throw error;
		const parentPath = context.parentURL ? fileURLToPath(context.parentURL) : process.cwd() + "/index.ts";
		const resolved = await tryResolve(new URL(specifier, pathToFileURL(parentPath)), specifier);
		if (resolved) return { url: resolved, shortCircuit: true };
		throw error;
	}
}
