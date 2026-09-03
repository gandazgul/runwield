/**
 * @module shared/session/plan-association
 * Durable Plan association evidence recorded in Session transcripts.
 */

import type { SessionTranscriptSegment } from "./file-session-store-types.ts";

export const PLAN_ASSOCIATION_CUSTOM_TYPE = "runwield.plan_association";

export type AssociationPurpose = "planning" | "review" | "execution" | "recovery";

export interface PlanAssociation {
    planId: string;
    planName: string;
    purpose: AssociationPurpose;
    segmentId: string;
    segmentKind: SessionTranscriptSegment["kind"];
    recordedAt: string;
}

export interface ManifestPlanAssociation extends PlanAssociation {
    committedGeneration: number | null;
}

const PURPOSES = new Set<AssociationPurpose>(["planning", "review", "execution", "recovery"]);

function normalizeString(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

function normalizePurpose(value: unknown): AssociationPurpose | null {
    const purpose = normalizeString(value);
    return PURPOSES.has(purpose as AssociationPurpose) ? purpose as AssociationPurpose : null;
}

function normalizeSegmentKind(value: unknown): SessionTranscriptSegment["kind"] {
    const kind = normalizeString(value);
    if (kind === "planning" || kind === "execution" || kind === "semantic_repair") return kind;
    return "session";
}

export function normalizePlanAssociation(value: unknown): PlanAssociation | null {
    if (!value || typeof value !== "object") return null;
    const data = value as Record<string, unknown>;
    const planId = normalizeString(data.planId);
    const planName = normalizeString(data.planName);
    const purpose = normalizePurpose(data.purpose);
    const segmentId = normalizeString(data.segmentId);
    const recordedAt = normalizeString(data.recordedAt);
    if (!planId || !purpose || !segmentId) return null;
    return {
        planId,
        planName,
        purpose,
        segmentId,
        segmentKind: normalizeSegmentKind(data.segmentKind),
        recordedAt: recordedAt || new Date(0).toISOString(),
    };
}

export function readPlanAssociations(entries: unknown[]): PlanAssociation[] {
    const associations: PlanAssociation[] = [];
    for (const entry of entries) {
        if (!entry || typeof entry !== "object") continue;
        const record = entry as Record<string, unknown>;
        if (record.type !== "custom" || record.customType !== PLAN_ASSOCIATION_CUSTOM_TYPE) continue;
        const association = normalizePlanAssociation(record.data);
        if (association) associations.push(association);
    }
    return associations;
}

export function normalizeManifestPlanAssociation(value: unknown): ManifestPlanAssociation | null {
    const association = normalizePlanAssociation(value);
    if (!association || !value || typeof value !== "object") return null;
    const committedGeneration = (value as Record<string, unknown>).committedGeneration;
    return {
        ...association,
        committedGeneration: Number.isInteger(committedGeneration) ? committedGeneration as number : null,
    };
}
