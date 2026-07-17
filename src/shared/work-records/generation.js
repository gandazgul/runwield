/**
 * @module shared/work-records/generation
 * Generate canonical internal Work Records from completed Plans.
 */

import { AGENTS } from "../../constants.js";
import {
    ensurePlanIdentity,
    isChildFeaturePlan,
    isEpicPlan,
    listArchivedPlans,
    listPlans,
    loadArchivedPlan,
    loadPlan,
    updateArchivedPlanFrontMatter,
    updatePlanFrontMatter,
} from "../../plan-store.js";
import { runNonInteractiveAgentPrompt } from "../session/session.js";
import { extractAssistantOutput } from "../workflow/workflow-results.js";
import { listWorkRecords, writeWorkRecord } from "./store.js";

const DEFAULT_CLOSURE_REASON = "Reason not specified.";
const SKIPPED_VERIFICATION_TEXT = "RunWield Workflow Validation was skipped";

/**
 * @typedef {Object} WorkRecordSource
 * @property {"active"|"archived"} sourceKind
 * @property {string} name
 * @property {string} relativePath
 * @property {string} path
 * @property {string} planId
 * @property {import('../../plan-store.js').PlanFrontMatter} attrs
 * @property {string} body
 * @property {string} markdown
 * @property {"feature"|"epic"} [scope]
 * @property {"verified"|"closed_without_verification"|"done_enough"} [completionMode]
 * @property {string} [closureReason]
 * @property {WorkRecordSource[]} [children]
 * @property {string} [skipReason]
 * @property {import('./schema.js').WorkRecordResource} [existingRecord]
 */

/**
 * @typedef {Object} GeneratedWorkRecordSections
 * @property {string} title
 * @property {string} summary
 * @property {string} [deviationsFromPlan]
 * @property {string} [deferredWork]
 * @property {string} [futurePlanningNotes]
 */

/**
 * @typedef {Object} GenerationOptions
 * @property {() => string} [idGenerator]
 * @property {() => Date} [now]
 * @property {(source: WorkRecordSource) => Promise<GeneratedWorkRecordSections>|GeneratedWorkRecordSections} [generateSections]
 * @property {(prompt: string) => Promise<string>} [runRecorderPrompt]
 */

/**
 * @typedef {Object} BackfillResult
 * @property {WorkRecordSource[]} sources
 * @property {WorkRecordSource[]} eligible
 * @property {WorkRecordSource[]} skipped
 * @property {Array<{ source: WorkRecordSource, status: "generated"|"linked"|"failed", recordId?: string, path?: string, error?: string }>} outcomes
 */

/** @param {Date} date */
function iso(date) {
    return date.toISOString();
}

/** @param {unknown} value */
function nonEmptyString(value) {
    return typeof value === "string" && value.trim() ? value.trim() : "";
}

/** @param {string} body */
function extractTitle(body) {
    return String(body || "").match(/^#\s+(.+)$/m)?.[1]?.trim() || "";
}

/** @param {unknown} value */
function conciseError(value) {
    const message = value instanceof Error ? value.message : String(value || "Unknown Work Record generation failure.");
    return message.replace(/\s+/g, " ").trim().slice(0, 240) || "Unknown Work Record generation failure.";
}

/** @param {unknown} value */
function optionalTrimmedString(value) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** @param {string} text */
function parseJsonObjectFromText(text) {
    const trimmed = String(text || "").trim();
    if (!trimmed) throw new Error("Recorder returned no structured output.");
    try {
        return JSON.parse(trimmed);
    } catch {
        const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
        if (fenced) return JSON.parse(fenced);
        const start = trimmed.indexOf("{");
        const end = trimmed.lastIndexOf("}");
        if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
        throw new Error("Recorder output must be structured JSON.");
    }
}

/**
 * @param {unknown} value
 * @returns {GeneratedWorkRecordSections}
 */
export function normalizeRecorderOutput(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Recorder output must be a JSON object.");
    }
    const record = /** @type {Record<string, unknown>} */ (value);
    const title = optionalTrimmedString(record.title);
    const summary = optionalTrimmedString(record.summary);
    if (!title) throw new Error("Recorder output requires a non-empty title.");
    if (!summary) throw new Error("Recorder output requires a non-empty summary.");
    return {
        title,
        summary,
        ...(optionalTrimmedString(record.deviationsFromPlan)
            ? { deviationsFromPlan: optionalTrimmedString(record.deviationsFromPlan) }
            : {}),
        ...(optionalTrimmedString(record.deferredWork)
            ? { deferredWork: optionalTrimmedString(record.deferredWork) }
            : {}),
        ...(optionalTrimmedString(record.futurePlanningNotes)
            ? { futurePlanningNotes: optionalTrimmedString(record.futurePlanningNotes) }
            : {}),
    };
}

/**
 * @param {string} text
 * @returns {GeneratedWorkRecordSections}
 */
export function parseRecorderSections(text) {
    return normalizeRecorderOutput(parseJsonObjectFromText(text));
}

/**
 * @param {WorkRecordSource} source
 * @returns {"verified"|"closed_without_verification"|"done_enough"|""}
 */
export function deriveWorkRecordCompletionMode(source) {
    if (isEpicPlan(source.attrs) && source.attrs.epicCompletionMode === "done_enough") return "done_enough";
    if (source.attrs.status === "closed_without_verification") return "closed_without_verification";
    if (source.attrs.status === "verified") return "verified";
    return "";
}

/**
 * @param {WorkRecordSource} source
 * @returns {"feature"|"epic"|""}
 */
export function deriveWorkRecordScope(source) {
    if (isEpicPlan(source.attrs)) return "epic";
    if (source.attrs.classification === "FEATURE" && !isChildFeaturePlan(source)) return "feature";
    return "";
}

/** @param {import('./schema.js').WorkRecordResource[]} records */
function recordsBySourcePlanId(records) {
    /** @type {Map<string, import('./schema.js').WorkRecordResource[]>} */
    const map = new Map();
    for (const record of records) {
        for (const planId of record.attrs.provenance?.sourcePlans || []) {
            const existing = map.get(planId) || [];
            existing.push(record);
            map.set(planId, existing);
        }
    }
    return map;
}

/**
 * @param {WorkRecordSource} source
 * @param {Map<string, import('./schema.js').WorkRecordResource[]>} existingByPlanId
 */
function findLinkableExistingRecord(source, existingByPlanId) {
    const candidates = source.planId ? existingByPlanId.get(source.planId) || [] : [];
    return candidates.find((record) =>
        record.attrs.status === "approved" &&
        record.attrs.origin === "internal" &&
        record.attrs.scope === source.scope &&
        record.attrs.completionMode === source.completionMode &&
        !record.attrs.archivedAt &&
        !record.attrs.supersededBy
    );
}

/**
 * @param {WorkRecordSource} source
 * @param {Map<string, import('./schema.js').WorkRecordResource[]>} existingByPlanId
 * @returns {WorkRecordSource}
 */
export function evaluateWorkRecordSource(source, existingByPlanId = new Map()) {
    if (source.attrs.workRecord) return { ...source, skipReason: "existing_backlink" };
    if (isChildFeaturePlan(source)) return { ...source, skipReason: "child_feature" };
    const scope = deriveWorkRecordScope(source);
    if (!scope) return { ...source, skipReason: "unsupported_plan_type" };
    const completionMode = deriveWorkRecordCompletionMode(source);
    if (!completionMode) return { ...source, skipReason: "not_completed" };
    const candidate = { ...source, scope, completionMode };
    const existingRecord = findLinkableExistingRecord(candidate, existingByPlanId);
    return {
        ...candidate,
        closureReason: completionMode === "closed_without_verification"
            ? nonEmptyString(source.attrs.closedWithoutVerificationReason) || DEFAULT_CLOSURE_REASON
            : undefined,
        ...(existingRecord ? { existingRecord } : {}),
    };
}

/**
 * @param {string} cwd
 * @returns {Promise<WorkRecordSource[]>}
 */
export async function discoverWorkRecordSources(cwd) {
    /** @type {WorkRecordSource[]} */
    const sources = [];
    for (const entry of await listPlans(cwd)) {
        const loaded = await loadPlan(cwd, entry.name);
        if (!loaded) continue;
        sources.push({
            sourceKind: "active",
            name: entry.name,
            relativePath: `plans/${entry.name}.md`,
            path: loaded.path,
            planId: loaded.attrs.planId || "",
            attrs: loaded.attrs,
            body: loaded.body,
            markdown: loaded.markdown,
        });
    }
    for (const entry of await listArchivedPlans(cwd)) {
        const loaded = await loadArchivedPlan(cwd, entry.name);
        if (!loaded) continue;
        sources.push({
            sourceKind: "archived",
            name: entry.name,
            relativePath: entry.relativePath,
            path: loaded.path,
            planId: loaded.attrs.planId || "",
            attrs: loaded.attrs,
            body: loaded.body,
            markdown: loaded.markdown,
        });
    }
    return sources;
}

/**
 * @param {WorkRecordSource[]} sources
 * @returns {WorkRecordSource[]}
 */
function attachEpicChildren(sources) {
    return sources.map((source) => {
        if (!isEpicPlan(source.attrs)) return source;
        const children = sources.filter((candidate) =>
            candidate.attrs.classification === "FEATURE" && candidate.attrs.parentPlan === source.name
        );
        return { ...source, children };
    });
}

/**
 * @param {string} cwd
 * @returns {Promise<{ sources: WorkRecordSource[], eligible: WorkRecordSource[], skipped: WorkRecordSource[] }>}
 */
export async function previewWorkRecordBackfill(cwd) {
    const existingByPlanId = recordsBySourcePlanId(await listWorkRecords(cwd, { createDir: false }));
    const sources = attachEpicChildren(await discoverWorkRecordSources(cwd)).map((source) =>
        evaluateWorkRecordSource(source, existingByPlanId)
    );
    return {
        sources,
        eligible: sources.filter((source) => !source.skipReason),
        skipped: sources.filter((source) => source.skipReason),
    };
}

/**
 * @param {string} cwd
 * @param {WorkRecordSource} source
 * @param {Partial<import('../../plan-store.js').PlanFrontMatter>} updates
 */
async function updateSourceFrontMatter(cwd, source, updates) {
    if (source.sourceKind === "archived") return await updateArchivedPlanFrontMatter(cwd, source.name, updates);
    return await updatePlanFrontMatter(cwd, source.name, updates);
}

/**
 * @param {string} cwd
 * @param {WorkRecordSource} source
 * @param {GenerationOptions} options
 * @returns {Promise<WorkRecordSource>}
 */
async function ensureSourcePlanId(cwd, source, options) {
    if (source.planId) return source;
    if (source.sourceKind === "active") {
        const resource = await ensurePlanIdentity(cwd, source.name, { idGenerator: options.idGenerator });
        return {
            ...source,
            planId: resource.planId,
            attrs: resource.attrs,
            body: resource.body,
            markdown: resource.markdown,
        };
    }
    const planId = options.idGenerator ? options.idGenerator() : crypto.randomUUID();
    const attrs = await updateArchivedPlanFrontMatter(cwd, source.name, { planId });
    return { ...source, planId, attrs };
}

/** @param {string} value */
function stripMarkdown(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
}

/**
 * @param {WorkRecordSource} source
 * @returns {string}
 */
function buildRecorderPrompt(source) {
    return JSON.stringify(
        {
            instruction:
                "Generate a concise Work Record body draft as JSON only: title, summary, optional deviationsFromPlan, optional deferredWork, optional futurePlanningNotes.",
            source: {
                name: source.name,
                path: source.relativePath,
                planId: source.planId,
                scope: source.scope,
                completionMode: source.completionMode,
                closureReason: source.closureReason,
                attrs: source.attrs,
                body: source.body,
                children: (source.children || []).map((child) => ({
                    name: child.name,
                    path: child.relativePath,
                    status: child.attrs.status,
                    summary: child.attrs.summary,
                })),
            },
        },
        null,
        2,
    );
}

/**
 * @param {string} cwd
 * @param {WorkRecordSource} source
 * @param {GenerationOptions} [options]
 * @returns {Promise<GeneratedWorkRecordSections>}
 */
export async function generateRecorderSections(cwd, source, options = {}) {
    const prompt = buildRecorderPrompt(source);
    const text = options.runRecorderPrompt ? await options.runRecorderPrompt(prompt) : extractAssistantOutput(
        await runNonInteractiveAgentPrompt({ cwd, agentName: AGENTS.PLANNER, userRequest: prompt }),
    ) || "";
    return parseRecorderSections(text);
}

/**
 * @param {WorkRecordSource} source
 * @returns {GeneratedWorkRecordSections}
 */
export function synthesizeWorkRecordSections(source) {
    const title = extractTitle(source.body) || source.attrs.summary || source.name;
    const summary = source.completionMode === "closed_without_verification"
        ? `This work was completed but RunWield Workflow Validation was skipped. Closure reason: ${
            source.closureReason || DEFAULT_CLOSURE_REASON
        }`
        : source.completionMode === "done_enough"
        ? `${source.attrs.summary || title} The PROJECT Epic was marked done enough${
            source.attrs.epicDoneEnoughSummary ? `: ${source.attrs.epicDoneEnoughSummary}` : "."
        }`
        : source.attrs.summary || `Completed ${title}.`;
    const childLines = (source.children || [])
        .filter((child) => child.attrs.classification === "FEATURE")
        .map((child) =>
            `- ${child.name}: ${child.attrs.status}${
                child.attrs.summary ? ` — ${stripMarkdown(child.attrs.summary)}` : ""
            }`
        );
    return {
        title,
        summary,
        ...(childLines.length ? { deferredWork: childLines.join("\n") } : {}),
        futurePlanningNotes: `Source Plan: ${source.relativePath}`,
    };
}

/**
 * @param {WorkRecordSource} source
 * @param {GeneratedWorkRecordSections} sections
 */
function prepareGeneratedSections(source, sections) {
    const normalized = normalizeRecorderOutput(sections);
    if (source.completionMode !== "closed_without_verification") return normalized;
    const reason = source.closureReason || DEFAULT_CLOSURE_REASON;
    const summaryParts = [];
    if (!normalized.summary.includes(SKIPPED_VERIFICATION_TEXT)) {
        summaryParts.push(`This work was completed but ${SKIPPED_VERIFICATION_TEXT}.`);
    }
    if (!normalized.summary.includes(reason)) summaryParts.push(`Closure reason: ${reason}`);
    return { ...normalized, summary: [...summaryParts, normalized.summary].join(" ").trim() };
}

/**
 * @param {WorkRecordSource} source
 * @param {GeneratedWorkRecordSections} sections
 */
function buildBody(source, sections) {
    const normalized = prepareGeneratedSections(source, sections);
    const lines = [
        `# ${normalized.title}`,
        "",
        "## Summary",
        "",
        normalized.summary,
    ];
    sections = normalized;
    if (nonEmptyString(sections.deviationsFromPlan)) {
        lines.push("", "## Deviations from Plan", "", nonEmptyString(sections.deviationsFromPlan));
    }
    if (nonEmptyString(sections.deferredWork)) {
        lines.push("", "## Deferred Work", "", nonEmptyString(sections.deferredWork));
    }
    if (nonEmptyString(sections.futurePlanningNotes)) {
        lines.push("", "## Future Planning Notes", "", nonEmptyString(sections.futurePlanningNotes));
    }
    return lines.join("\n");
}

/**
 * @param {string} cwd
 * @param {WorkRecordSource} source
 * @param {import('./schema.js').WorkRecordResource} record
 * @param {Date} now
 */
async function linkSourceToRecord(cwd, source, record, now) {
    await updateSourceFrontMatter(cwd, source, {
        workRecord: {
            status: "generated",
            recordId: record.attrs.recordId,
            path: record.relativePath,
            lastAttemptAt: iso(now),
        },
    });
}

/**
 * @param {string} cwd
 * @param {WorkRecordSource} source
 * @param {Date} now
 * @param {unknown} error
 */
async function recordGenerationFailure(cwd, source, now, error) {
    try {
        await updateSourceFrontMatter(cwd, source, {
            workRecord: {
                status: "failed",
                lastAttemptAt: iso(now),
                error: conciseError(error),
            },
        });
    } catch {
        // The original generation failure is more useful to callers than a secondary backlink failure.
    }
}

/**
 * @param {string} cwd
 * @param {WorkRecordSource} inputSource
 * @param {GenerationOptions} [options]
 */
export async function generateWorkRecordForSource(cwd, inputSource, options = {}) {
    const now = options.now ? options.now() : new Date();
    let source = inputSource;
    try {
        source = await ensureSourcePlanId(cwd, source, options);
        const existingByPlanId = recordsBySourcePlanId(await listWorkRecords(cwd));
        source = evaluateWorkRecordSource(source, existingByPlanId);
        if (source.skipReason) {
            throw new Error(`Source is not eligible for Work Record generation: ${source.skipReason}.`);
        }
        if (source.existingRecord) {
            await linkSourceToRecord(cwd, source, source.existingRecord, now);
            return {
                source,
                status: "linked",
                recordId: source.existingRecord.attrs.recordId,
                path: source.existingRecord.relativePath,
            };
        }
        const generateSections = options.generateSections ||
            ((eligibleSource) => generateRecorderSections(cwd, eligibleSource, options));
        const sections = await generateSections(source);
        /** @type {import('./schema.js').WorkRecordFrontMatter} */
        const attrs = {
            kind: "work_record",
            recordId: options.idGenerator ? options.idGenerator() : crypto.randomUUID(),
            status: "approved",
            scope: /** @type {"feature"|"epic"} */ (source.scope),
            origin: "internal",
            completionMode:
                /** @type {"verified"|"closed_without_verification"|"done_enough"} */ (source.completionMode),
            createdAt: iso(now),
            provenance: { sourcePlans: [source.planId] },
        };
        const record = await writeWorkRecord(cwd, attrs, buildBody(source, sections));
        await linkSourceToRecord(cwd, source, record, now);
        return { source, status: "generated", recordId: record.attrs.recordId, path: record.relativePath };
    } catch (error) {
        await recordGenerationFailure(cwd, source, now, error);
        return { source, status: "failed", error: conciseError(error) };
    }
}

/**
 * @param {string} cwd
 * @param {GenerationOptions} [options]
 * @returns {Promise<BackfillResult>}
 */
export async function runWorkRecordBackfill(cwd, options = {}) {
    const preview = await previewWorkRecordBackfill(cwd);
    /** @type {BackfillResult["outcomes"]} */
    const outcomes = [];
    for (const source of preview.eligible) {
        outcomes.push(
            /** @type {BackfillResult["outcomes"][number]} */ (await generateWorkRecordForSource(cwd, source, options)),
        );
    }
    return { ...preview, outcomes };
}

/**
 * @param {BackfillResult | Awaited<ReturnType<typeof previewWorkRecordBackfill>>} result
 */
export function formatWorkRecordBackfillPreview(result) {
    const linkable = result.eligible.filter((source) => source.existingRecord).length;
    const generatable = result.eligible.length - linkable;
    const lines = [
        "[RunWield] Work Record backfill preview:",
        `  eligible: ${result.eligible.length}`,
        `  link existing: ${linkable}`,
        `  generate new: ${generatable}`,
        `  skipped: ${result.skipped.length}`,
    ];
    if (result.eligible.length) {
        lines.push("", "Eligible sources:");
        for (const source of result.eligible) {
            const action = source.existingRecord ? `link ${source.existingRecord.relativePath}` : "generate";
            lines.push(
                `  - ${source.name} (${source.sourceKind}, ${source.completionMode}, ${source.scope}) -> ${action}`,
            );
            lines.push(`    path: ${source.relativePath}`);
        }
    }
    const skipCounts = result.skipped.reduce((acc, source) => {
        const key = source.skipReason || "unknown";
        acc.set(key, (acc.get(key) || 0) + 1);
        return acc;
    }, /** @type {Map<string, number>} */ (new Map()));
    if (skipCounts.size) {
        lines.push("", "Skipped sources:");
        for (const [reason, count] of skipCounts) lines.push(`  - ${reason}: ${count}`);
    }
    return lines.join("\n");
}

/** @param {BackfillResult["outcomes"]} outcomes */
export function formatWorkRecordBackfillOutcomes(outcomes) {
    if (!outcomes.length) return "[RunWield] No Work Records generated or linked.";
    const lines = ["[RunWield] Work Record backfill results:"];
    for (const outcome of outcomes) {
        if (outcome.status === "failed") {
            lines.push(`  Failed ${outcome.source.name}: ${outcome.error || "unknown error"}`);
        } else {
            lines.push(
                `  ${outcome.status === "linked" ? "Linked" : "Generated"} ${outcome.source.name}: ${outcome.path}`,
            );
        }
    }
    const failed = outcomes.filter((outcome) => outcome.status === "failed").length;
    lines.push(`[RunWield] ${outcomes.length - failed}/${outcomes.length} source(s) succeeded; ${failed} failed.`);
    return lines.join("\n");
}
