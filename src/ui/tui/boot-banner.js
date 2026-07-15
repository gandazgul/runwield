/**
 * @module ui/tui/boot-banner
 *
 * Boot summary printed at the top of an interactive session: the loaded
 * prompt templates, available skills, and warnings for any prompt template
 * that would shadow a built-in slash command.
 */

import { CWD, HOME_DIR } from "../../constants.js";
import { recordSnipMissingWarningShown, shouldShowSnipMissingWarning } from "../../cmd/init/init-state.js";
import { hasSnipBinary } from "../../shared/runtime-preflight.js";

/**
 * @typedef {{
 *   name: string,
 *   source: "local" | "home" | "bundled" | "package",
 *   path?: string,
 *   packageSource?: string,
 * }} PromptTemplate
 */

/**
 * @param {PromptTemplate} template
 */
function toUserFacingPromptPath(template) {
    if (template.source === "local") return `./.wld/prompts/${template.name}.md`;
    if (template.source === "home") return `~/.wld/prompts/${template.name}.md`;
    if (template.source === "package") {
        const origin = template.packageSource ? ` from ${template.packageSource}` : "";
        const path = template.path ? ` (${template.path})` : "";
        return `package prompt /${template.name}${origin}${path}`;
    }
    return `bundled prompt /${template.name}`;
}

/**
 * @param {{ path: string, source: "home" | "external" | "local" }} file
 * @param {string} projectRoot
 */
function toUserFacingAgentMdPath(file, projectRoot) {
    if (projectRoot && file.path.startsWith(projectRoot)) {
        return `.${file.path.slice(projectRoot.length)}`;
    }
    if ((file.source === "home" || file.source === "external") && HOME_DIR && file.path.startsWith(HOME_DIR)) {
        return `~${file.path.slice(HOME_DIR.length)}`;
    }
    return file.path;
}

/**
 * @param {{
 *   uiAPI: import('./types.js').UiAPI,
 *   invokablePromptTemplates: PromptTemplate[],
 *   blockedPromptTemplates: PromptTemplate[],
 *   chatPromptAgentName: string,
 *   sessionRuntime?: import('../../shared/session/session-runtime.js').SessionRuntime,
 *   sessionId?: string,
 *   projectRoot?: string,
 *   __deps?: {
 *     listSkills?: (options: { cwd?: string }) => Promise<any[]>,
 *     listLoadedAgentMdFiles?: (cwd?: string) => Promise<any[]>,
 *     getSettingsManager?: (projectRoot?: string) => { getTheme: () => string | undefined },
 *     hasSnipBinary?: typeof hasSnipBinary,
 *     shouldShowSnipMissingWarning?: typeof shouldShowSnipMissingWarning,
 *     recordSnipMissingWarningShown?: typeof recordSnipMissingWarningShown,
 *   },
 * }} deps
 */
export async function renderBootBanner({
    uiAPI,
    invokablePromptTemplates,
    blockedPromptTemplates,
    chatPromptAgentName,
    sessionRuntime,
    sessionId,
    projectRoot = CWD,
    __deps,
}) {
    const listSkillsImpl = __deps?.listSkills || (() => {
        if (!sessionRuntime || !sessionId) throw new Error("Boot banner requires a runtime session");
        return sessionRuntime.listSessionSkills(sessionId);
    });
    const listLoadedAgentMdFilesImpl = __deps?.listLoadedAgentMdFiles || (() => {
        if (!sessionRuntime || !sessionId) throw new Error("Boot banner requires a runtime session");
        return sessionRuntime.listSessionContextFiles(sessionId);
    });
    const hasSnipBinaryImpl = __deps?.hasSnipBinary || hasSnipBinary;
    const shouldShowSnipMissingWarningImpl = __deps?.shouldShowSnipMissingWarning || shouldShowSnipMissingWarning;
    const recordSnipMissingWarningShownImpl = __deps?.recordSnipMissingWarningShown || recordSnipMissingWarningShown;
    const headerStyle = { headingColor: "mdHeading" };
    const snipAvailable = await hasSnipBinaryImpl();

    if (invokablePromptTemplates.length > 0) {
        const names = invokablePromptTemplates.map((template) => `/${template.name}`).join(", ");
        uiAPI.appendSystemMessage(
            `${names} (slash commands execute via ${chatPromptAgentName})`,
            false,
            `Prompt Templates (${invokablePromptTemplates.length}):`,
            headerStyle,
        );
    } else {
        uiAPI.appendSystemMessage("none", false, "Prompt Templates:", headerStyle);
    }

    const skills = await listSkillsImpl({ cwd: projectRoot });
    if (skills && skills.length > 0) {
        const skillNames = skills.map((/** @type {{ name: string }} */ skill) => skill.name).join(", ");
        uiAPI.appendSystemMessage(skillNames, false, `Skills (${skills.length}):`, headerStyle);
    } else {
        uiAPI.appendSystemMessage("none", false, "Skills:", headerStyle);
    }

    // Report the active theme
    const getSettingsManagerImpl = __deps?.getSettingsManager || (await import("../../shared/settings.js"))
        .getSettingsManager;
    const activeTheme = getSettingsManagerImpl(projectRoot).getTheme() || "catppuccin-mocha";
    uiAPI.appendSystemMessage(activeTheme, false, "Theme:", headerStyle);

    if (snipAvailable) {
        uiAPI.appendSystemMessage("Snip", false, "Runtime Optimizers:", headerStyle);
    }

    const agentMdFiles = await listLoadedAgentMdFilesImpl(projectRoot);
    if (agentMdFiles.length > 0) {
        const lines = agentMdFiles
            .map((/** @type {{ path: string, source: "home" | "external" | "local" }} */ file) =>
                `- ${toUserFacingAgentMdPath(file, projectRoot)}`
            )
            .join("\n");
        uiAPI.appendSystemMessage(`\n${lines}`, false, "Context:", headerStyle);
    }

    for (const blocked of blockedPromptTemplates) {
        if (blocked.source === "bundled") continue;
        const userPath = toUserFacingPromptPath(blocked);
        uiAPI.appendSystemMessage(
            `Warning: ${userPath} command can't be invoked because it would override RunWield built-in commands. Please rename it.`,
            true,
        );
    }

    if (!snipAvailable && await shouldShowSnipMissingWarningImpl()) {
        uiAPI.appendSystemMessage(
            [
                "[RunWield] Snip is not installed. RunWield will still work, but agent shell command output will be noisier.",
                "Install Snip with `brew install edouard-claude/tap/snip` or see https://github.com/edouard-claude/snip#installation.",
            ].join("\n"),
            true,
        );
        await recordSnipMissingWarningShownImpl();
    }
}
