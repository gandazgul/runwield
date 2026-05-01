/**
 * @param {string} argumentPrefix
 * @returns {Promise<any[]>}
 */
export async function getModelCompletions(argumentPrefix) {
    const { ModelRegistry, AuthStorage } = await import("@mariozechner/pi-coding-agent");

    const CWD = Deno.cwd();
    const HOME_DIR = Deno.env.get("HOME") || "";
    const agentDir = HOME_DIR ? `${HOME_DIR}/.pi/agent` : CWD;

    const authStorage = AuthStorage.create(`${agentDir}/auth.json`);
    const modelRegistry = ModelRegistry.create(authStorage, `${agentDir}/models.json`);
    const models = modelRegistry.getAll();

    return models
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((m) => {
            const value = `${m.provider}/${m.id}`;
            return {
                value,
                label: value,
                description: m.name,
            };
        })
        .filter((item) =>
            item.value.startsWith(argumentPrefix) ||
            item.value.split("/")[1].startsWith(argumentPrefix)
        );
}
