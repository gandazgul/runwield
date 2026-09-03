/**
 * @module shared/session/file-session-lineage
 * Strict transcript lineage parsing and manifest reconstruction.
 */

import { createHash } from "node:crypto";
import { normalizeSegmentLineageEvidence, SEGMENT_LINEAGE_CUSTOM_TYPE } from "./workflow-context-session.js";
import { readPlanAssociations } from "./plan-association.ts";
import { FILE_SESSION_STORE_VERSION, isoNow } from "./file-session-storage.ts";
import type {
    FileSessionManifest,
    FileSessionProject,
    LineageReadResult,
    LocatedSegmentLineage,
} from "./file-session-store-types.ts";

export function readLineage(path: string): LineageReadResult {
    try {
        const lines = Deno.readTextFileSync(path).split("\n").filter(Boolean);
        const lineageEntries = [];
        for (let index = 1; index < lines.length; index += 1) {
            const entry = JSON.parse(lines[index]);
            if (entry?.type !== "custom" || entry.customType !== SEGMENT_LINEAGE_CUSTOM_TYPE) continue;
            const lineage = normalizeSegmentLineageEvidence(entry.data);
            if (!lineage) return { kind: "malformed", reason: "Session lineage entry is malformed." };
            lineageEntries.push(lineage);
        }
        if (lineageEntries.length > 0) {
            const latest = lineageEntries.at(-1);
            if (!latest) return { kind: "absent" };
            const identity = JSON.stringify(latest);
            if (lineageEntries.some((lineage) => JSON.stringify(lineage) !== identity)) {
                return { kind: "malformed", reason: "Session lineage entries conflict." };
            }
            return { kind: "valid", lineage: latest };
        }
    } catch (error) {
        return {
            kind: "malformed",
            reason: error instanceof Error ? error.message : String(error),
        };
    }
    return { kind: "absent" };
}

/**
 * Reconstruct a missing manifest from lineage embedded in the Pi transcripts.
 * This is deliberately used only when no manifest exists for the stable
 * Session ID. If a manifest exists, an extra lineage-bearing transcript is an
 * interrupted rollover candidate and must remain uncommitted.
 */
export function reconstructManifestFromLineage(
    project: FileSessionProject,
    located: LocatedSegmentLineage[],
    now?: () => string,
): FileSessionManifest | null {
    if (located.length === 0) return null;
    const runwieldSessionId = located[0].lineage.runwieldSessionId;
    if (located.some((item) => item.lineage.runwieldSessionId !== runwieldSessionId)) return null;

    const lineageGroupKey = located[0].lineage.lineageGroupKey;
    if (!lineageGroupKey || located.some((item) => item.lineage.lineageGroupKey !== lineageGroupKey)) return null;

    const bySegmentId = new Map<string, LocatedSegmentLineage>();
    const byPiSessionId = new Map<string, LocatedSegmentLineage>();
    for (const item of located) {
        if (bySegmentId.has(item.lineage.segmentId) || byPiSessionId.has(item.locator.piSessionId)) return null;
        bySegmentId.set(item.lineage.segmentId, item);
        byPiSessionId.set(item.locator.piSessionId, item);
    }

    // Older planning transcripts did not carry root lineage. A successor does
    // carry both parent IDs, so the caller adds that root before reconstruction.
    // A complete recoverable chain must have exactly one root.
    const roots = located.filter((item) => !item.lineage.parentSegmentId);
    if (roots.length !== 1 || roots[0].lineage.parentPiSessionId) return null;
    for (const item of located) {
        if (!item.lineage.parentSegmentId) continue;
        const parent = bySegmentId.get(item.lineage.parentSegmentId);
        if (!parent || item.lineage.parentPiSessionId !== parent.locator.piSessionId) return null;
    }
    const ordered: LocatedSegmentLineage[] = [];
    const visited = new Set<string>();
    let current: LocatedSegmentLineage | undefined = roots[0];
    while (current) {
        ordered.push(current);
        visited.add(current.lineage.segmentId);
        const children = located.filter((candidate) =>
            candidate.lineage.parentSegmentId === current?.lineage.segmentId &&
            !visited.has(candidate.lineage.segmentId)
        );
        if (children.length > 1) return null;
        current = children[0];
    }
    if (ordered.length !== located.length) return null;

    const timestamp = isoNow(now);
    const planAssociations = ordered.flatMap((item) => {
        try {
            const entries = Deno.readTextFileSync(item.locator.sessionPath).split("\n").filter(Boolean).slice(1)
                .map((line) => JSON.parse(line));
            return readPlanAssociations(entries).map((association) => ({ ...association, committedGeneration: 0 }));
        } catch {
            return [];
        }
    });

    const segments = ordered.map((item, ordinal) => ({
        segmentId: item.lineage.segmentId,
        runwieldSessionId,
        projectId: project.projectId,
        piSessionId: item.locator.piSessionId,
        transcriptPath: item.locator.sessionPath,
        transcriptCwd: item.locator.headerCwd,
        ordinal,
        kind: item.lineage.kind || (ordinal === 0 ? "planning" : ordinal === 1 ? "execution" : "semantic_repair"),
        sealedAt: ordinal < ordered.length - 1 ? timestamp : null,
        headerVersion: item.locator.headerVersion,
        headerTimestamp: item.locator.headerTimestamp,
        firstCatalogedAt: timestamp,
        lastCatalogedAt: timestamp,
        lineageParentSegmentId: item.lineage.parentSegmentId ?? null,
        lineageParentPiSessionId: item.lineage.parentPiSessionId ?? null,
        lineageGroupKey: item.lineage.lineageGroupKey ?? null,
        lineageRecordedAt: timestamp,
        sealedByteLength: ordinal < ordered.length - 1 ? Deno.statSync(item.locator.sessionPath).size : null,
        sealedDigestHex: ordinal < ordered.length - 1
            ? createHash("sha256").update(Deno.readFileSync(item.locator.sessionPath)).digest("hex")
            : null,
        sealedTerminalEntryId: null,
    }));
    return {
        version: FILE_SESSION_STORE_VERSION,
        runwieldSessionId,
        projectId: project.projectId,
        transcriptCwd: segments[0].transcriptCwd,
        displayName: null,
        source: "lineage_recovery",
        createdAt: timestamp,
        updatedAt: timestamp,
        currentSegmentId: segments[segments.length - 1].segmentId,
        fence: 0,
        activation: {
            state: "uninitialized",
            phase: null,
            ownerInstanceId: null,
            ownerProcessKind: null,
            operationId: null,
            expectedGeneration: null,
            expectedCurrentSegmentId: null,
            acquiredAt: null,
            blockedReason: null,
        },
        generation: null,
        segments,
        planAssociations,
    };
}
