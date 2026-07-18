/**
 * @module cmd/context
 * TUI command to inspect active Agent Session context-window usage.
 */

import { theme } from "../../ui/theme/theme.js";

const SOURCE_ORDER = ["local", "home", "bundled", "external", "mnemosyne", "runtime", "agent"];

/**
 * @param {number | null | undefined} count
 * @returns {string}
 */
export function formatContextTokens(count) {
    if (typeof count !== "number" || !Number.isFinite(count)) return "unknown";
    return count.toLocaleString();
}

/**
 * @param {number | null | undefined} percent
 * @returns {string}
 */
function formatPercent(percent) {
    if (typeof percent !== "number" || !Number.isFinite(percent)) return "unknown";
    return `${percent.toFixed(1)}%`;
}

/**
 * @param {string} path
 * @returns {string}
 */
export function abbreviateHomePath(path) {
    const home = Deno.env.get("HOME") || "";
    if (!home || !path.startsWith(home)) return path;
    return `~${path.slice(home.length)}`;
}

/**
 * @param {number | null | undefined} percent
 * @param {number} [width]
 * @returns {string}
 */
export function renderUsageBar(percent, width = 24) {
    if (typeof percent !== "number" || !Number.isFinite(percent)) {
        return `${"□".repeat(width)} unknown`;
    }
    const clamped = Math.max(0, Math.min(100, percent));
    const filled = Math.round((clamped / 100) * width);
    return `${"■".repeat(filled)}${"□".repeat(width - filled)} ${percent.toFixed(1)}%`;
}

/**
 * @param {import('../../shared/session/session-context-report.js').SessionContextReport} report
 * @returns {string}
 */
export function formatContextReport(report) {
    const lines = [];
    const model = [report.provider, report.model].filter(Boolean).join("/") || "model unavailable";
    const usageLabel = report.usageState === "last_known"
        ? "last known"
        : report.usageState === "unknown_after_compaction"
        ? "unknown after compaction"
        : "estimated";

    lines.push(theme.bold("Context Usage"));
    lines.push(
        `${theme.fg("dim", "Agent:")} ${report.agentDisplayName}${report.agentName ? ` (${report.agentName})` : ""}`,
    );
    lines.push(`${theme.fg("dim", "Model:")} ${model}`);
    lines.push(`${theme.fg("dim", "Usage:")} ${renderUsageBar(report.percent)}`);
    lines.push(
        `${theme.fg("dim", "Tokens:")} ${formatContextTokens(report.usedTokens)}/${
            formatContextTokens(report.contextWindow)
        } (${usageLabel})`,
    );
    lines.push(`${theme.fg("dim", "Free space:")} ${formatContextTokens(report.freeTokens)}`);
    lines.push("");

    lines.push(theme.bold("Estimated usage by category"));
    for (const category of report.categories) {
        const percent = category.percent === null ? "" : ` (${formatPercent(category.percent)})`;
        lines.push(`- ${category.label}: ${formatContextTokens(category.tokens)} tokens${percent}`);
    }
    if (report.categories.length === 0) lines.push("- No resident context categories reported.");
    lines.push("");

    lines.push(theme.bold("Instruction files"));
    if (report.instructionFiles.length === 0) {
        lines.push("- None loaded.");
    } else {
        for (const item of report.instructionFiles) {
            const source = item.source ? ` [${item.source}]` : "";
            const label = item.path ? abbreviateHomePath(item.path) : item.label;
            lines.push(`- ${label}${source}: ~${formatContextTokens(item.tokens)} tokens`);
        }
    }
    lines.push("");

    lines.push(theme.bold("Skills advertised to model"));
    if (report.skills.length === 0) {
        lines.push("- None advertised.");
    } else {
        for (const [source, items] of groupItemsBySource(report.skills)) {
            lines.push(`${source}:`);
            for (const item of items) {
                const label = item.name || item.label;
                const path = item.path ? ` (${abbreviateHomePath(item.path)})` : "";
                lines.push(`  - ${label}: ~${formatContextTokens(item.tokens)} tokens${path}`);
            }
        }
    }

    return lines.join("\n");
}

/**
 * @param {import('../../shared/session/session-context-report.js').ContextProjectionItem[]} items
 * @returns {Array<[string, import('../../shared/session/session-context-report.js').ContextProjectionItem[]]>}
 */
function groupItemsBySource(items) {
    const groups = new Map();
    for (const item of items) {
        const source = item.source || "other";
        if (!groups.has(source)) groups.set(source, []);
        groups.get(source).push(item);
    }
    return [...groups.entries()].sort(([a], [b]) => {
        const ai = SOURCE_ORDER.indexOf(a);
        const bi = SOURCE_ORDER.indexOf(b);
        if (ai !== bi) return (ai < 0 ? Number.MAX_SAFE_INTEGER : ai) - (bi < 0 ? Number.MAX_SAFE_INTEGER : bi);
        return a.localeCompare(b);
    });
}

/**
 * Handle context usage command.
 *
 * @param {string[]} _argv
 * @param {import('../registry.js').CommandContext} [options]
 */
// deno-lint-ignore require-await
export async function runContextCommand(_argv, options = {}) {
    if (!options?.uiAPI) {
        console.error("The /context command is only available inside an interactive session.");
        return;
    }

    const { uiAPI, sessionRuntime, sessionId } = options;
    const report = sessionRuntime && sessionId ? sessionRuntime.getSessionContextReport(sessionId) : null;
    if (!report) {
        uiAPI.appendSystemMessage("Error: No active Agent Session context is available yet.");
        return;
    }

    uiAPI.appendSystemMessage(formatContextReport(report));
}
