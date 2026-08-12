/** Durable Objective-Failing Check waiver persistence. */

import { normalizeObjectiveCheckWaivers } from "../../plan-store.js";
import { runPlanFrontMatterTransition } from "./state-transition.ts";
import type { ObjectiveCheck, ObjectiveCheckResult } from "./objective-checks.ts";

type PlanFrontMatter = import("../../plan-store.js").PlanFrontMatter;
type ObjectiveCheckWaiver = NonNullable<PlanFrontMatter["objectiveCheckWaivers"]>[number];

export type ObjectiveCheckWaiverSource = "mechanical_detection" | "engineer_report";

export interface PersistObjectiveCheckWaiverOptions {
    projectRoot: string;
    planName: string;
    recoveryAttrs: Partial<PlanFrontMatter>;
    existingWaivers?: PlanFrontMatter["objectiveCheckWaivers"];
    source: ObjectiveCheckWaiverSource;
    explanation: string;
    userNote?: string;
    results: ObjectiveCheckResult[];
    waivedAt?: string;
}

export function brokenObjectiveCheckResults(results: ObjectiveCheckResult[]): ObjectiveCheckResult[] {
    return results.filter((result) => result.status === "broken");
}

export function isObjectiveCheckWaived(
    check: ObjectiveCheck,
    waivers: PlanFrontMatter["objectiveCheckWaivers"] | undefined,
): boolean {
    return (waivers || []).some((waiver) => waiver.id === check.id && waiver.command === check.command);
}

export function objectiveChecksWithoutWaivers(
    checks: ObjectiveCheck[],
    waivers: PlanFrontMatter["objectiveCheckWaivers"] | undefined,
): ObjectiveCheck[] {
    return checks.filter((check) => !isObjectiveCheckWaived(check, waivers));
}

export async function persistObjectiveCheckWaiver({
    projectRoot,
    planName,
    recoveryAttrs,
    existingWaivers,
    source,
    explanation,
    userNote,
    results,
    waivedAt = new Date().toISOString(),
}: PersistObjectiveCheckWaiverOptions): Promise<ObjectiveCheckWaiver[]> {
    const waiverResults = source === "engineer_report" ? results : brokenObjectiveCheckResults(results);
    if (!waiverResults.length) throw new Error("Objective Check waiver needs at least one selected check result.");
    const nextWaivers = normalizeObjectiveCheckWaivers([
        ...(existingWaivers || []),
        ...waiverResults.map((result) => ({
            id: result.id,
            command: result.command,
            source,
            explanation: result.reason || explanation,
            ...(userNote?.trim() ? { userNote: userNote.trim() } : {}),
            waivedAt,
        })),
    ]);
    if (!nextWaivers) throw new Error("Objective Check waiver metadata is invalid.");
    const transition = await runPlanFrontMatterTransition({
        projectRoot,
        planName,
        operation: "objective_check_waiver",
        updates: { objectiveCheckWaivers: nextWaivers },
        recoveryAttrs,
    });
    if (transition.status !== "committed") {
        throw new Error(transition.message || `Could not persist Objective Check waiver for ${planName}.`);
    }
    return nextWaivers;
}
