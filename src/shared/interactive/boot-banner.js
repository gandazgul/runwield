/**
 * @module shared/interactive/boot-banner
 *
 * Boot summary printed at the top of an interactive session: the loaded
 * prompt templates, available skills, and warnings for any prompt template
 * that would shadow a built-in slash command.
 */

import { CWD, HOME_DIR } from "../../constants.js";
import { recordSnipMissingWarningShown, shouldShowSnipMissingWarning } from "../../cmd/init/init-state.js";
import { hasSnipBinary } from "../runtime-preflight.js";
import { listLoadedAgentMdFiles, listSkills } from "../session/session.js";

/**
 * @typedef {{ name: string, source: "local" | "home" | "bundled" }} PromptTemplate
 */

/**
 * @param {PromptTemplate} template
 */
function toUserFacingPromptPath(template) {
    if (template.source === "local") return `./.hns/prompts/${template.name}.md`;
    return `~/.hns/prompts/${template.name}.md`;
}

/**
 * @param {{ path: string, source: "home" | "external" | "local" }} file
 */
function toUserFacingAgentMdPath(file) {
    if (CWD && file.path.startsWith(CWD)) {
        return `.${file.path.slice(CWD.length)}`;
    }
    if ((file.source === "home" || file.source === "external") && HOME_DIR && file.path.startsWith(HOME_DIR)) {
        return `~${file.path.slice(HOME_DIR.length)}`;
    }
    return file.path;
}

/**
 * @param {{
 *   uiAPI: import('../ui/types.js').UiAPI,
 *   invokablePromptTemplates: PromptTemplate[],
 *   blockedPromptTemplates: PromptTemplate[],
 *   chatPromptAgentName: string,
 *   __deps?: {
 *     listSkills?: typeof listSkills,
 *     listLoadedAgentMdFiles?: typeof listLoadedAgentMdFiles,
 *     getSettingsManager?: () => { getTheme: () => string | undefined },
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
    __deps,
}) {
    const listSkillsImpl = __deps?.listSkills || listSkills;
    const listLoadedAgentMdFilesImpl = __deps?.listLoadedAgentMdFiles || listLoadedAgentMdFiles;
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

    const skills = await listSkillsImpl();
    if (skills && skills.length > 0) {
        const skillNames = skills.map((s) => s.name).join(", ");
        uiAPI.appendSystemMessage(skillNames, false, `Skills (${skills.length}):`, headerStyle);
    } else {
        uiAPI.appendSystemMessage("none", false, "Skills:", headerStyle);
    }

    // Report the active theme
    const getSettingsManagerImpl = __deps?.getSettingsManager || (await import("../settings.js")).getSettingsManager;
    const activeTheme = getSettingsManagerImpl().getTheme() || "catppuccin-mocha";
    uiAPI.appendSystemMessage(activeTheme, false, "Theme:", headerStyle);

    if (snipAvailable) {
        uiAPI.appendSystemMessage("Snip", false, "Runtime Optimizers:", headerStyle);
    }

    const agentMdFiles = await listLoadedAgentMdFilesImpl();
    if (agentMdFiles.length > 0) {
        const lines = agentMdFiles
            .map((file) => `- ${toUserFacingAgentMdPath(file)}`)
            .join("\n");
        uiAPI.appendSystemMessage(`\n${lines}`, false, "Context:", headerStyle);
    }

    for (const blocked of blockedPromptTemplates) {
        if (blocked.source !== "local" && blocked.source !== "home") continue;
        const userPath = toUserFacingPromptPath(blocked);
        uiAPI.appendSystemMessage(
            `Warning: ${userPath} command can't be invoked because it would override Harns built-in commands. Please rename it.`,
            true,
        );
    }

    if (!snipAvailable && await shouldShowSnipMissingWarningImpl()) {
        uiAPI.appendSystemMessage(
            [
                "[Harns] Snip is not installed. Harns will still work, but agent shell command output will be noisier.",
                "Install Snip with `brew install edouard-claude/tap/snip` or see https://github.com/edouard-claude/snip#installation.",
            ].join("\n"),
            true,
        );
        await recordSnipMissingWarningShownImpl();
    }
}
