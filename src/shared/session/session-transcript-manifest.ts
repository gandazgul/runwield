/*
 * @module shared/session/session-transcript-manifest
 * Aggregate non-mutating reader for segmented Session transcripts.
 */

import { dirname, resolve } from "@std/path";
import { isPathInside, readCatalogSafeRootSessionLocator } from "./root-session.js";
import {
    captureTranscriptEvidence,
    createReplayEvents,
    selectProjectedEventsAfterCursor,
    summarizeProjectedEntries,
    toProjectionFailure,
} from "./session-transcript-projection.js";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

type ProjectedRuntimeEvent = {
    type: string;
    eventId: string;
    segmentOrdinal?: number;
    segmentKind?: string;
    [key: string]: JsonValue | undefined;
};

type TranscriptSegment = {
    segmentId: string;
    runwieldSessionId: string;
    projectId: string;
    piSessionId: string;
    transcriptPath: string;
    transcriptCwd: string;
    ordinal: number;
    kind: string;
    sealedAt: string | null;
    sealedByteLength: number | null;
    sealedDigestHex: string | null;
    sealedTerminalEntryId: string | null;
};

type CommittedGeneration = {
    generation: number;
    byteLength: number;
    terminalEntryId: string | null;
    digestHex: string;
    currentSegmentId: string | null;
};

type ProjectAggregateTranscriptOptions = {
    runwieldSessionId: string;
    cwd: string;
    sessionDir?: string;
    runtimeSessionId?: string;
    generation: CommittedGeneration;
    segments: TranscriptSegment[];
    cursorEventId?: string | null;
    cursorEventOrdinal?: number | null;
    limit?: number;
};

type VerifiedSegmentMetadata = {
    ordinal: number;
    kind: string;
    label: string;
    sealed: boolean;
    current: boolean;
};

type AggregateProjectionFailure = {
    ok: false;
    state: "degraded";
    code: string;
    message: string;
    events: [];
};

type AggregateProjectionResult = {
    ok: true;
    generation: number;
    events: ProjectedRuntimeEvent[];
    nextCursor: string | null;
    nextCursorOrdinal: number | null;
    complete: boolean;
    snapshot: { [key: string]: unknown };
    segments: VerifiedSegmentMetadata[];
    cursorReset: boolean;
};

function requireOrderedManifest(options: ProjectAggregateTranscriptOptions) {
    const segments = [...options.segments].sort((left, right) => left.ordinal - right.ordinal);
    if (segments.length === 0) throw new Error("Segment manifest is empty");
    for (let index = 0; index < segments.length; index += 1) {
        const segment = segments[index];
        if (segment.runwieldSessionId !== options.runwieldSessionId) {
            throw new Error("Segment manifest lineage is ambiguous");
        }
        if (segment.ordinal !== index) throw new Error("Segment manifest ordinal continuity is invalid");
    }
    const current = segments.find((segment) => segment.segmentId === options.generation.currentSegmentId);
    if (!current) throw new Error("Committed generation current segment is absent from manifest");
    for (const segment of segments) {
        if (segment.ordinal < current.ordinal && !segment.sealedAt) throw new Error("Predecessor segment is unsealed");
        if (segment.ordinal > current.ordinal) {
            throw new Error("Committed generation references an ambiguous segment lineage");
        }
    }
    return { segments: segments.slice(0, current.ordinal + 1), current };
}

async function verifyPath(segment: TranscriptSegment, sessionDir: string) {
    const transcriptPath = resolve(segment.transcriptPath);
    if (!isPathInside(transcriptPath, sessionDir)) {
        throw new Error("Segment transcript path is outside session directory");
    }
    await readCatalogSafeRootSessionLocator({ cwd: segment.transcriptCwd, sessionDir, sessionPath: transcriptPath });
    return transcriptPath;
}

async function verifySealedSegment(segment: TranscriptSegment, sessionDir: string) {
    if (!Number.isInteger(segment.sealedByteLength) || !segment.sealedDigestHex) {
        throw new Error("Sealed segment evidence is missing");
    }
    const transcriptPath = await verifyPath(segment, sessionDir);
    const stat = await Deno.stat(transcriptPath);
    if (stat.size !== segment.sealedByteLength) throw new Error("Sealed segment byte length does not match evidence");
    const evidence = await captureTranscriptEvidence({
        transcriptPath,
        transcriptCwd: segment.transcriptCwd,
        byteLength: segment.sealedByteLength,
    });
    if (evidence.digestHex !== segment.sealedDigestHex) {
        throw new Error("Sealed segment digest does not match evidence");
    }
    if (evidence.terminalEntryId !== segment.sealedTerminalEntryId) {
        throw new Error("Sealed segment terminal entry does not match evidence");
    }
    return evidence;
}

function normalizeSegmentKind(kind: string) {
    if (kind === "planning" || kind === "execution" || kind === "semantic_repair") return kind;
    return "session";
}

function segmentLabel(kind: string, ordinal: number) {
    if (kind === "planning") return `Planning segment ${ordinal + 1}`;
    if (kind === "execution") return `Execution segment ${ordinal + 1}`;
    if (kind === "semantic_repair") return `Semantic Repair segment ${ordinal + 1}`;
    return `Session segment ${ordinal + 1}`;
}

async function verifyCurrentSegment(segment: TranscriptSegment, generation: CommittedGeneration, sessionDir: string) {
    const transcriptPath = await verifyPath(segment, sessionDir);
    const evidence = await captureTranscriptEvidence({
        transcriptPath,
        transcriptCwd: segment.transcriptCwd,
        byteLength: generation.byteLength,
    });
    if (evidence.digestHex !== generation.digestHex) {
        throw new Error("Committed transcript digest does not match published evidence");
    }
    if (evidence.terminalEntryId !== generation.terminalEntryId) {
        throw new Error("Committed transcript terminal entry does not match published evidence");
    }
    return evidence;
}

export async function projectAggregateTranscript(
    options: ProjectAggregateTranscriptOptions,
): Promise<AggregateProjectionResult | AggregateProjectionFailure> {
    try {
        const { segments, current } = requireOrderedManifest(options);
        const sessionDir = options.sessionDir || dirname(current.transcriptPath);
        const aggregateEntries: JsonValue[] = [];
        const segmentMetadata: VerifiedSegmentMetadata[] = [];
        const replayEvents: ProjectedRuntimeEvent[] = [];
        for (const segment of segments) {
            const evidence = segment.segmentId === current.segmentId
                ? await verifyCurrentSegment(segment, options.generation, sessionDir)
                : await verifySealedSegment(segment, sessionDir);
            aggregateEntries.push(...evidence.entries);
            const kind = normalizeSegmentKind(segment.kind);
            replayEvents.push(
                ...createReplayEvents(
                    options.runtimeSessionId || options.runwieldSessionId,
                    evidence.entries,
                    { segmentId: segment.segmentId, projectRoot: segment.transcriptCwd || options.cwd },
                ).map((event) => ({
                    ...event,
                    segmentOrdinal: segment.ordinal,
                    segmentKind: kind,
                })),
            );
            segmentMetadata.push({
                ordinal: segment.ordinal,
                kind,
                label: segmentLabel(kind, segment.ordinal),
                sealed: segment.segmentId !== current.segmentId,
                current: segment.segmentId === current.segmentId,
            });
        }
        let cursorReset = false;
        let selected;
        try {
            selected = selectProjectedEventsAfterCursor({
                events: replayEvents,
                cursorEventId: options.cursorEventId,
                cursorEventOrdinal: options.cursorEventOrdinal,
                limit: options.limit,
            });
        } catch (error) {
            if (!(error instanceof Error) || error.name !== "ProjectionContinuityError") throw error;
            cursorReset = true;
            selected = selectProjectedEventsAfterCursor({
                events: replayEvents,
                cursorEventId: null,
                limit: options.limit,
            });
        }
        return {
            ok: true,
            generation: options.generation.generation,
            events: selected.events as ProjectedRuntimeEvent[],
            nextCursor: selected.nextCursor,
            nextCursorOrdinal: selected.nextCursorOrdinal,
            complete: selected.complete,
            snapshot: summarizeProjectedEntries(aggregateEntries),
            segments: segmentMetadata,
            cursorReset,
        };
    } catch (error) {
        return { ...toProjectionFailure(error), events: [] } as AggregateProjectionFailure;
    }
}
