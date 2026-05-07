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
