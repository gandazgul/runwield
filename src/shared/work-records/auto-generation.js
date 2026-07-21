/**
 * @module shared/work-records/auto-generation
 * Targeted Work Record auto-generation after terminal Plan outcomes.
 */

import { findPlansByParent, isChildFeaturePlan, isEpicPlan, loadPlan } from "../../plan-store.js";
import { shouldAutoGenerateWorkRecordsOnPlanCompletion } from "../settings.js";
import { listWorkRecords } from "./store.js";
import {
    attachEpicChildren,
    buildActiveWorkRecordSource,
    evaluateWorkRecordSource,
    generateWorkRecordForSource,
    recordsBySourcePlanId,
} from "./generation.js";

/**
 * @typedef {Object} WorkRecordAutoGenerationResult
 * @property {"disabled"|"skipped"|"generated"|"linked"|"failed"} status
 * @property {string} planName
 * @property {string} [targetPlanName]
 * @property {string} message
 * @property {string} [path]
 * @property {string} [recordId]
 * @property {string} [reason]
 * @property {string} [error]
 * @property {string} [indexWarning]
 */

/** @param {unknown} value */
function conciseError(value) {
    const message = value instanceof Error ? value.message : String(value || "Unknown Work Record generation failure.");
    return message.replace(/\s+/g, " ").trim().slice(0, 240) || "Unknown Work Record generation failure.";
}

/**
 * @param {string} cwd
 * @param {string} name
 * @returns {Promise<import('./generation.js').WorkRecordSource | null>}
 */
async function loadActiveSource(cwd, name) {
    const loaded = await loadPlan(cwd, name);
    return loaded ? buildActiveWorkRecordSource(name, loaded) : null;
}

/**
 * @param {string} cwd
 * @param {import('./generation.js').WorkRecordSource} source
 */
async function withEpicChildren(cwd, source) {
    if (!isEpicPlan(source.attrs)) return source;
    const children = [];
    for (const child of await findPlansByParent(cwd, source.name)) {
        const loaded = await loadPlan(cwd, child.name);
        if (loaded) children.push(buildActiveWorkRecordSource(child.name, loaded));
    }
    return attachEpicChildren([source, ...children])[0];
}

/**
 * Resolve a targeted active Plan to the source eligible for automatic generation.
 * Child FEATURE Plans resolve to their parent Epic and skip quietly until the parent is terminal.
 *
 * @param {string} cwd
 * @param {string} planName
 * @returns {Promise<{ source?: import('./generation.js').WorkRecordSource, skipReason?: string, targetPlanName?: string }>}
 */
export async function resolveTargetedWorkRecordSource(cwd, planName) {
    const source = await loadActiveSource(cwd, planName);
    if (!source) return { skipReason: "plan_not_found", targetPlanName: planName };

    if (isChildFeaturePlan(source)) {
        const parentName = source.attrs.parentPlan || "";
        const parent = parentName ? await loadActiveSource(cwd, parentName) : null;
        if (!parent) return { skipReason: "parent_not_found", targetPlanName: parentName || planName };
        const parentWithChildren = await withEpicChildren(cwd, parent);
        if (
            !(parentWithChildren.attrs.status === "verified" &&
                parentWithChildren.attrs.epicCompletionMode === "done_enough")
        ) {
            return { skipReason: "parent_not_terminal", targetPlanName: parent.name };
        }
        return { source: parentWithChildren, targetPlanName: parentWithChildren.name };
    }

    return { source: await withEpicChildren(cwd, source), targetPlanName: source.name };
}

/**
 * @param {WorkRecordAutoGenerationResult} result
 * @returns {WorkRecordAutoGenerationResult}
 */
function withMessage(result) {
    return { ...result, message: formatWorkRecordAutoGenerationResult(result) };
}

/**
 * @param {WorkRecordAutoGenerationResult} result
 * @returns {string}
 */
export function formatWorkRecordAutoGenerationResult(result) {
    if (result.status === "disabled") return "Work Record auto-generation disabled by settings.";
    if (result.status === "skipped") {
        if (result.reason === "parent_not_terminal") {
            return "Work Record auto-generation skipped: parent Epic is not terminal yet.";
        }
        return `Work Record auto-generation skipped: ${result.reason || "not eligible"}.`;
    }
    if (result.status === "failed") {
        return `Work Record generation failed for ${result.targetPlanName || result.planName}: ${
            result.error || "unknown error"
        }. The Plan terminal state was preserved; run wld wr backfill after repair.`;
    }
    const verb = result.status === "linked" ? "linked" : "generated";
    const warning = result.indexWarning ? ` Warning: ${result.indexWarning}` : "";
    return `Work Record ${verb}: ${result.path || result.recordId || "record available"}.${warning}`;
}

/**
 * Generate or reconcile a Work Record for the targeted terminal active Plan.
 *
 * @param {Object} args
 * @param {string} args.cwd
 * @param {string} args.planName
 * @param {import('./generation.js').GenerationOptions} [args.generationOptions]
 * @param {{ shouldAutoGenerate?: typeof shouldAutoGenerateWorkRecordsOnPlanCompletion, generateWorkRecordForSource?: typeof generateWorkRecordForSource }} [args.__deps]
 * @returns {Promise<WorkRecordAutoGenerationResult>}
 */
export async function autoGenerateWorkRecordForCompletedPlan({ cwd, planName, generationOptions = {}, __deps = {} }) {
    const shouldAutoGenerate = __deps.shouldAutoGenerate || shouldAutoGenerateWorkRecordsOnPlanCompletion;
    if (!shouldAutoGenerate(cwd)) {
        return withMessage({ status: "disabled", planName, message: "" });
    }

    try {
        const resolved = await resolveTargetedWorkRecordSource(cwd, planName);
        if (!resolved.source) {
            return withMessage({
                status: "skipped",
                planName,
                targetPlanName: resolved.targetPlanName,
                reason: resolved.skipReason || "not_found",
                message: "",
            });
        }

        const existingByPlanId = recordsBySourcePlanId(await listWorkRecords(cwd, { createDir: false }));
        const evaluated = evaluateWorkRecordSource(resolved.source, existingByPlanId);
        if (evaluated.skipReason) {
            return withMessage({
                status: "skipped",
                planName,
                targetPlanName: evaluated.name,
                reason: evaluated.skipReason,
                message: "",
            });
        }

        const generate = __deps.generateWorkRecordForSource || generateWorkRecordForSource;
        const outcome = /** @type {any} */ (await generate(cwd, evaluated, generationOptions));
        return withMessage({
            status: /** @type {WorkRecordAutoGenerationResult["status"]} */ (outcome.status),
            planName,
            targetPlanName: outcome.source?.name || evaluated.name,
            path: outcome.path,
            recordId: outcome.recordId,
            error: outcome.error,
            indexWarning: outcome.indexWarning,
            message: "",
        });
    } catch (error) {
        return withMessage({ status: "failed", planName, error: conciseError(error), message: "" });
    }
}
