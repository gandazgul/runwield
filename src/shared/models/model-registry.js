import { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";
import { join } from "@std/path";

/**
 * Get a configured ModelRegistry instance.
 * @returns {ModelRegistry}
 */
export function getModelRegistry() {
    const CWD = Deno.cwd();
    const HOME_DIR = Deno.env.get("HOME") || "";
    const agentDir = HOME_DIR ? join(HOME_DIR, ".pi", "agent") : CWD;

    const authStorage = AuthStorage.create(join(agentDir, "auth.json"));
    return ModelRegistry.create(authStorage, join(agentDir, "models.json"));
}

/**
 * Get the default model and provider from settings.json files.
 * @returns {{ model: string, provider: string }}
 */
export function getDefaultModelAndProvider() {
    let model = "gemini-2.0-flash";
    let provider = "google";
    try {
        const homeDir = Deno.env.get("HOME") || "";
        const agentDir = join(homeDir, ".pi", "agent");

        /** @type {{ defaultModel?: string, defaultProvider?: string, [key: string]: unknown }} */
        let settings = {};
        try {
            const globalPath = join(agentDir, "settings.json");
            settings = JSON.parse(Deno.readTextFileSync(globalPath));
        } catch (_e) { /* ignore */ }
        try {
            const localPath = join(Deno.cwd(), ".pi", "settings.json");
            const projSettings = JSON.parse(Deno.readTextFileSync(localPath));
            settings = { ...settings, ...projSettings };
        } catch (_e) { /* ignore */ }

        if (settings.defaultModel) model = settings.defaultModel;
        if (settings.defaultProvider) provider = settings.defaultProvider;
    } catch (_e) { /* ignore */ }

    return { model, provider };
}
