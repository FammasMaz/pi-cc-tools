export function getUserSettingsPath(): string {
	const agentDir = process.env.PI_CODING_AGENT_DIR || `${process.env.HOME ?? ""}/.pi`;
	return `${agentDir}/settings.json`;
}
