/**
 * @module shared/triage
 * Utilities for extracting triage data from router output.
 */

import { CLASSIFICATIONS, COMPLEXITIES } from "../constants.js";

/**
 * Extract triage report from router conversation messages.
 *
 * @param {import('@mariozechner/pi-agent-core').AgentMessage[]} messages
 * @returns {{ classification: string, complexity: string, summary: string, affectedPaths: string[] } | null}
 */
export function extractTriageReport(messages) {
    for (const msg of messages) {
        if (
            "role" in msg &&
            msg.role === "toolResult" &&
            "toolName" in msg &&
            msg.toolName === "triage_report"
        ) {
            // @ts-ignore details is set by our tool implementation
            return msg.details || null;
        }
    }

    const assistantMsgs = messages.filter((m) => "role" in m && m.role === "assistant");
    for (let i = assistantMsgs.length - 1; i >= 0; i--) {
        const msg = assistantMsgs[i];
        if (!("content" in msg) || !Array.isArray(msg.content)) continue;
        for (const block of msg.content) {
            if (block.type !== "text") continue;
            const parsed = parseTriageFromText(block.text);
            if (parsed) return parsed;
        }
    }

    return null;
}

/**
 * Parse triage fields from freeform text fallback.
 *
 * @param {string} text
 * @returns {{ classification: string, complexity: string, summary: string, affectedPaths: string[] } | null}
 */
export function parseTriageFromText(text) {
    const classMatch = text.match(
        /classification[:\s]+(?:"?)?(QUICK_FIX|FEATURE|PROJECT)(?:"?)?/i,
    );
    if (!classMatch) return null;

    const classification = classMatch[1].toUpperCase();
    if (!CLASSIFICATIONS.includes(classification)) return null;

    const complexMatch = text.match(
        /complexity[:\s]+(?:"?)?(LOW|MEDIUM|HIGH)(?:"?)?/i,
    );
    const complexity = complexMatch ? complexMatch[1].toUpperCase() : "MEDIUM";
    if (!COMPLEXITIES.includes(complexity)) return null;

    let summary = "";
    const summaryQuoted = text.match(/summary[:\s]+"([^"]+)"/s);
    if (summaryQuoted) {
        summary = summaryQuoted[1];
    } else {
        const summaryUnquoted = text.match(/summary[:\s]+(.+)/i);
        if (summaryUnquoted) summary = summaryUnquoted[1].trim();
    }

    /** @type {string[]} */
    let affectedPaths = [];
    const jsonPaths = text.match(/affectedPaths[:\s]+(\[[^\]]*])/s);
    if (jsonPaths) {
        try {
            const parsed = JSON.parse(jsonPaths[1]);
            if (Array.isArray(parsed)) affectedPaths = parsed.map(String);
        } catch {
            // ignore invalid JSON fallback
        }
    }

    if (affectedPaths.length === 0) {
        const yamlBlock = text.match(/affectedPaths[:\s]*\n((?:\s+-\s+.+\n?)*)/);
        if (yamlBlock) {
            affectedPaths = [...yamlBlock[1].matchAll(/-\s+(.+)/g)].map((m) => m[1].trim());
        }
    }

    return { classification, complexity, summary, affectedPaths };
}

/**
 * Extract plan_written result from planning conversation messages.
 *
 * @param {import('@mariozechner/pi-agent-core').AgentMessage[]} messages
 * @returns {{ planName: string, tasks?: Array<{task: number, assignee: string, dependencies: string, description: string}> } | null}
 */
export function extractPlanWritten(messages) {
    for (const msg of messages) {
        if (
            "role" in msg &&
            msg.role === "toolResult" &&
            "toolName" in msg &&
            msg.toolName === "plan_written"
        ) {
            // @ts-ignore details is set by our tool implementation
            const details = msg.details || null;
            if (
                details && typeof details.planName === "string" &&
                details.planName.trim()
            ) {
                return {
                    planName: details.planName.trim(),
                    tasks: Array.isArray(details.tasks) ? details.tasks : undefined,
                };
            }
        }
    }

    return null;
}
