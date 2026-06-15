/**
 * @module shared/interactive/boot-banner
 *
 * Boot summary printed at the top of an interactive session: the loaded
 * prompt templates, available skills, and warnings for any prompt template
 * that would shadow a built-in slash command.
 */

import { HOME_DIR } from "../../constants.js";
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
 * }} deps
 */
export async function renderBootBanner({
    uiAPI,
    invokablePromptTemplates,
    blockedPromptTemplates,
    chatPromptAgentName,
}) {
    const headerStyle = { headingColor: "mdHeading" };

    if (invokablePromptTemplates.length > 0) {
        const names = invokablePromptTemplates.map((template) => `/${template.name}`).join(", ");
        uiAPI.appendSystemMessage(
            `${names} (slash commands execute via ${chatPromptAgentName})`,
            false,
            `Loaded Prompt Templates (${invokablePromptTemplates.length}):`,
            headerStyle,
        );
    } else {
        uiAPI.appendSystemMessage("none", false, "Loaded Prompt Templates:", headerStyle);
    }

    const skills = await listSkills();
    if (skills && skills.length > 0) {
        const skillNames = skills.map((s) => s.name).join(", ");
        uiAPI.appendSystemMessage(skillNames, false, `Loaded Skills (${skills.length}):`, headerStyle);
    } else {
        uiAPI.appendSystemMessage("none", false, "Loaded Skills:", headerStyle);
    }

    // Report the active theme
    const { getSettingsManager } = await import("../settings.js");
    const activeTheme = getSettingsManager().getTheme() || "catppuccin-mocha";
    uiAPI.appendSystemMessage(activeTheme, false, "Loaded Theme:", headerStyle);

    const agentMdFiles = await listLoadedAgentMdFiles();
    if (agentMdFiles.length > 0) {
        const lines = agentMdFiles
            .map((file) => `- ${toUserFacingAgentMdPath(file)}`)
            .join("\n");
        uiAPI.appendSystemMessage(`\n${lines}`, false, "Loaded Context:", headerStyle);
    }

    for (const blocked of blockedPromptTemplates) {
        if (blocked.source !== "local" && blocked.source !== "home") continue;
        const userPath = toUserFacingPromptPath(blocked);
        uiAPI.appendSystemMessage(
            `Warning: ${userPath} command can't be invoked because it would override Harns built-in commands. Please rename it.`,
            true,
        );
    }
}
