/**
 * @module cmd/init
 * Init command handler — bootstraps RunWield into a project.
 *
 * Implements both CLI (`wld init`) and TUI slash (`/init`) dispatch.
 * Uses init-state guard to warn on re-runs. Loads the hidden init subagent
 * definition, so it stays invisible to /agent listings and uses its own
 * model/tools.
 */

import { parseArgs } from "@std/cli/parse-args";
import { dirname, fromFileUrl } from "@std/path";
import { AGENTS, getCwd, SUBAGENTS } from "../../constants.js";
import { COMMAND_NAMES } from "../registry.js";
import { EMPTY_PROJECT_DIRECTORY_INIT_NOOP_BODY, isEmptyProjectDirectory } from "../../shared/project-state.js";
import { extractBundledAgentDefs, extractBundledSkills } from "../../shared/session/agent-assets.js";
import { loadSubAgentDefinition } from "../../shared/session/subagent-definitions.ts";
import { SessionRuntime } from "../../shared/session/session-runtime.js";
import { getModelRegistry } from "../../shared/models/model-registry.js";
import { getSettingsManager } from "../../shared/settings.js";
import { startInteractiveSession } from "../../ui/tui/chat-session.js";
import { printCommandHelp } from "../help/index.ts";
import { isInitDone, recordInitDone, recordInitOffered } from "./init-state.ts";

interface InteractiveSessionPort {
    startInteractiveSession(
        initialRequest: string | null,
        options: { initialAgentName?: string },
    ): Promise<import("../../ui/tui/types.js").UiAPI | void>;
}

interface InitCommandOptions {
    uiAPI?: Pick<import("../../ui/tui/types.js").UiAPI, "appendSystemMessage">;
    sessionRuntime?: SessionRuntime;
    sessionId?: string;
    sessionPort?: InteractiveSessionPort;
}

const DEFAULT_SESSION_PORT: InteractiveSessionPort = { startInteractiveSession };

export const __dirname = dirname(fromFileUrl(import.meta.url));

/**
 * @param {{ getRegisteredProviderIds?: () => readonly string[], find?: (provider: string, modelId: string) => unknown }} registry
 * @param {{ getDefaultModel?: () => string | undefined, getDefaultProvider?: () => string | undefined }} settingsManager
 * @returns {boolean}
 */
function shouldLaunchTuiForModelSetup(
    registry: ReturnType<typeof getModelRegistry>,
    settingsManager: ReturnType<typeof getSettingsManager>,
): boolean {
    const configuredProviderIds = registry.getRegisteredProviderIds();
    if (configuredProviderIds.length === 0) return true;

    const defaultModel = settingsManager.getDefaultModel()?.trim();
    if (!defaultModel) return true;

    const defaultProvider = settingsManager.getDefaultProvider()?.trim() || "";
    return !registry.find(defaultProvider, defaultModel);
}

/**
 * Run the init command.
 */
export async function runInitCommand(argv: string[], options: InitCommandOptions = {}): Promise<void> {
    const parsed = parseArgs(argv, {
        boolean: ["help"],
        alias: { h: "help" },
        stopEarly: true,
    });

    if (parsed.help) {
        printCommandHelp(COMMAND_NAMES.INIT);
        return;
    }

    if (await isEmptyProjectDirectory(getCwd())) {
        if (options.uiAPI) {
            options.uiAPI.appendSystemMessage(EMPTY_PROJECT_DIRECTORY_INIT_NOOP_BODY);
        } else {
            console.warn(EMPTY_PROJECT_DIRECTORY_INIT_NOOP_BODY);
        }
        return;
    }

    // ── Init-state guard ──────────────────────────────────────────
    if (await isInitDone()) {
        const msg = `[RunWield] Init has already been run for this project (${getCwd()}).\n` +
            `[RunWield] To re-run, delete or edit the entry in ~/.wld/init-state.json manually.`;
        if (options.uiAPI) {
            options.uiAPI.appendSystemMessage(msg);
        } else {
            console.warn(msg);
        }
        return;
    }

    // ── Extract bundled prompt assets before model resolution ──────
    // Fresh binary installs need real on-disk copies so external read tools can
    // access bundled skills and document-format references, even if init later
    // stops because no model is configured.
    await extractBundledAgentDefs();
    await extractBundledSkills();

    if (!options.uiAPI && shouldLaunchTuiForModelSetup(getModelRegistry(), getSettingsManager(getCwd()))) {
        await (options.sessionPort || DEFAULT_SESSION_PORT).startInteractiveSession(`/${COMMAND_NAMES.INIT}`, {
            initialAgentName: AGENTS.ROUTER,
        });
        return;
    }

    // ── Load init subagent definition ──────
    // The registry maps this prompt to the canonical "init" runtime identifier
    // rather than the file's basename ("init-agent-prompt").
    const agentDef = await loadSubAgentDefinition(SUBAGENTS.INIT);
    const sessionRuntime = options.sessionRuntime || new SessionRuntime();
    const ownsRuntimeSession = !options.sessionId;
    const createdSessionId = options.sessionId ||
        (await sessionRuntime.createInteractiveSession({ cwd: getCwd(), mode: "new" })).sessionId;

    await recordInitOffered();

    // Run the init agent session using its own definition (model, tools, system prompt).
    // We use a dedicated "init" agent name so it's distinct from the operator.
    try {
        await sessionRuntime.runIsolatedAgent(createdSessionId, {
            agentName: AGENTS.INIT,
            userRequest: "Initialize this project for RunWield. Follow the instructions in your system prompt.",
            agentDef,
        });

        await recordInitDone();

        if (options.uiAPI) {
            options.uiAPI.appendSystemMessage(
                "✅ Init complete. CONTEXT.md has been written to the project root.",
            );
        } else {
            console.log(`\n[RunWield] ✅ Init complete for ${getCwd()}.`);
        }
    } catch (err) {
        // Don't record success if the agent failed or was aborted
        const msg = `[RunWield] Init failed: ${err instanceof Error ? err.message : String(err)}`;
        if (options.uiAPI) {
            options.uiAPI.appendSystemMessage(msg, true);
        } else {
            console.error(msg);
        }
        throw err;
    } finally {
        if (ownsRuntimeSession) sessionRuntime.closeSession(createdSessionId);
    }
}
