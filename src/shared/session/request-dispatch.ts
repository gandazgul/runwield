import type { SessionManager } from "@earendil-works/pi-coding-agent";

export const BACKEND_CONTINUATION_REQUEST = "Continue the active agent task after the previous backend failed.";

export type RequestDispatchKind =
    | "interactive"
    | "plan_execution"
    | "quick_fix"
    | "validation_repair";

export type RequestPromptMode = "original" | "continuation";
export type RequestAttemptPhase = "started" | "completed" | "failed";

export interface RequestAttemptEntry {
    version: 1;
    requestId: string;
    attemptId: string;
    requestHash: string;
    dispatchKind: RequestDispatchKind;
    backend: string;
    phase: RequestAttemptPhase;
    promptMode: RequestPromptMode;
    requestRecorded: boolean;
}

export interface PreparedRequestDispatch {
    requestId: string;
    attemptId: string;
    userRequest: string;
    promptMode: RequestPromptMode;
    requestHash: string;
    dispatchKind: RequestDispatchKind;
    backend: string;
}

interface TranscriptCustomEntry {
    type?: string;
    customType?: string;
    data?: RequestAttemptEntry;
}

/**
 * Start one backend attempt. A failed request keeps its request ID. The next
 * attempt gets a new attempt ID and sends a small continuation prompt when the
 * original user message is already in the transcript.
 */
export function prepareRequestDispatch(
    sessionManager: SessionManager,
    options: {
        userRequest: string;
        dispatchKind: RequestDispatchKind;
        backend: string;
    },
): PreparedRequestDispatch {
    const requestHash = hashRequest(options.userRequest);
    const failed = readLatestFailedAttempt(sessionManager);
    const continuesFailedRequest = failed?.requestHash === requestHash;
    const requestId = continuesFailedRequest ? failed.requestId : `request:${crypto.randomUUID()}`;
    const promptMode: RequestPromptMode = continuesFailedRequest && failed.requestRecorded
        ? "continuation"
        : "original";
    const prepared: PreparedRequestDispatch = {
        requestId,
        attemptId: `attempt:${crypto.randomUUID()}`,
        userRequest: promptMode === "continuation" ? BACKEND_CONTINUATION_REQUEST : options.userRequest,
        promptMode,
        requestHash,
        dispatchKind: options.dispatchKind,
        backend: options.backend,
    };
    appendAttempt(sessionManager, prepared, "started", false);
    return prepared;
}

export function completeRequestDispatch(
    sessionManager: SessionManager,
    prepared: PreparedRequestDispatch,
): void {
    appendAttempt(sessionManager, prepared, "completed", true);
}

export function failRequestDispatch(
    sessionManager: SessionManager,
    prepared: PreparedRequestDispatch,
    requestRecorded: boolean,
): void {
    appendAttempt(sessionManager, prepared, "failed", requestRecorded);
}

export function readRequestAttemptEntries(sessionManager: SessionManager): RequestAttemptEntry[] {
    return sessionManager.getBranch()
        .filter((entry) => entry.type === "custom" && entry.customType === "runwield.request_attempt")
        .map((entry) => (entry as TranscriptCustomEntry).data)
        .filter((entry): entry is RequestAttemptEntry => Boolean(entry));
}

function appendAttempt(
    sessionManager: SessionManager,
    prepared: PreparedRequestDispatch,
    phase: RequestAttemptPhase,
    requestRecorded: boolean,
): void {
    sessionManager.appendCustomEntry(
        "runwield.request_attempt",
        {
            version: 1,
            requestId: prepared.requestId,
            attemptId: prepared.attemptId,
            requestHash: prepared.requestHash,
            dispatchKind: prepared.dispatchKind,
            backend: prepared.backend,
            phase,
            promptMode: prepared.promptMode,
            requestRecorded,
        } satisfies RequestAttemptEntry,
    );
}

function readLatestFailedAttempt(sessionManager: SessionManager): RequestAttemptEntry | null {
    const attempts = readRequestAttemptEntries(sessionManager);
    const latest = attempts.at(-1);
    return latest?.phase === "failed" ? latest : null;
}

function hashRequest(value: string): string {
    const mask = (1n << 128n) - 1n;
    let hash = 0x6c62272e07bb014262b821756295c58dn;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= BigInt(value.charCodeAt(index));
        hash = (hash * 0x1000000000000000000013bn) & mask;
    }
    return hash.toString(16).padStart(32, "0");
}
