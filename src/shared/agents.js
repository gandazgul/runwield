/**
 * @module shared/agents
 * Agent discovery — scans the agent definitions directory and returns metadata.
 */

import { extractYaml, test as hasFrontMatter } from "@std/front-matter";
import { join } from "@std/path";
import { resolveAgentDefsDir } from "./session.js";

/**
 * @typedef {Object} AgentInfo
 * @property {string} name - Agent filename (without .md)
 * @property {string} displayName - Human-readable name from frontmatter
 * @property {string} description - One-line description from frontmatter
 * @property {string} model - Model identifier from frontmatter
 */

/**
 * List all available agent definitions.
 *
 * @returns {Promise<AgentInfo[]>}
 */
export async function listAvailableAgents() {
    const dir = await resolveAgentDefsDir();
    /** @type {AgentInfo[]} */
    const agents = [];

    for await (const entry of Deno.readDir(dir)) {
        if (!entry.isFile || !entry.name.endsWith(".md")) continue;

        const name = entry.name.replace(/\.md$/, "");
        try {
            const raw = await Deno.readTextFile(join(dir, entry.name));
            if (!hasFrontMatter(raw)) continue;

            const { attrs } = extractYaml(raw);
            agents.push({
                name,
                displayName: attrs.name || name,
                description: attrs.description || "",
                model: attrs.model || "unknown",
            });
        } catch {
            // Skip unreadable files
        }
    }

    agents.sort((a, b) => a.name.localeCompare(b.name));
    return agents;
}
