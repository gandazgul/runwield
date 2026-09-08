import { getRunWieldSessionDir } from "../../../shared/session/root-session.js";
import { projectAggregateTranscript } from "../../../shared/session/session-transcript-manifest.ts";
import type { FileSessionGeneration } from "../../../shared/session/file-session-store-types.ts";
import { sessionBelongsToOwnerProject } from "./owner-projects.js";

type Store = {
    getSessionById(
        id: string,
    ): { runwieldSessionId: string; projectId: string; transcriptCwd: string; transcriptPath?: string } | null;
    inspectSessionActivation(id: string): { generation?: FileSessionGeneration | null };
    listSessionTranscriptSegments(id: string): Array<{
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
    }>;
};

export type WorkspaceAttentionItem = {
    attentionId: string;
    reason: "agentStopped";
    runwieldSessionId: string;
    agentName: string;
    sessionName: string;
    recordedAt: string;
    generation: number;
};

export type WorkspaceAttentionSnapshot = {
    generation: number | null;
    attention: WorkspaceAttentionItem[];
};

type Subscriber = (snapshot: WorkspaceAttentionSnapshot) => void;

function safeAttention(snapshot: Record<string, unknown>): WorkspaceAttentionItem[] {
    const attention = Array.isArray(snapshot.attention) ? snapshot.attention : [];
    return attention.map((item) => item && typeof item === "object" ? item as Record<string, unknown> : null)
        .filter((item): item is Record<string, unknown> => Boolean(item))
        .map((item) => ({
            attentionId: String(item.attentionId || ""),
            reason: "agentStopped" as const,
            runwieldSessionId: String(item.runwieldSessionId || ""),
            agentName: String(item.agentName || "Agent"),
            sessionName: String(item.sessionName || "Session"),
            recordedAt: String(item.recordedAt || ""),
            generation: Number(item.generation),
        }))
        .filter((item) => item.attentionId && item.runwieldSessionId && Number.isInteger(item.generation));
}

export async function readCurrentSessionAttention(
    store: Store,
    runwieldSessionId: string,
    options: { projectId?: string } = {},
): Promise<WorkspaceAttentionSnapshot> {
    const session = store.getSessionById(runwieldSessionId);
    if (!session || (options.projectId && !sessionBelongsToOwnerProject(store as never, session, options.projectId))) {
        throw new Error("Session not found.");
    }
    const inspected = store.inspectSessionActivation(runwieldSessionId);
    if (!inspected.generation) return { generation: null, attention: [] };
    const segments = store.listSessionTranscriptSegments(runwieldSessionId);
    const projection = await projectAggregateTranscript({
        cwd: session.transcriptCwd,
        sessionDir: getRunWieldSessionDir(session.transcriptCwd),
        runwieldSessionId,
        generation: inspected.generation,
        segments,
        limit: 0,
    });
    if (!projection.ok) throw new Error(projection.message);
    return {
        generation: projection.generation,
        attention: safeAttention(projection.snapshot),
    };
}

export class SessionAttentionObserver {
    readonly #store: Store;
    readonly #watchers = new Map<string, {
        timer: ReturnType<typeof setInterval> | null;
        subscribers: Set<Subscriber>;
        inFlight: Promise<void> | null;
        lastGeneration: number | null | undefined;
        lastPayload: string;
    }>();
    readonly #intervalMs: number;

    constructor(store: Store, options: { intervalMs?: number } = {}) {
        this.#store = store;
        this.#intervalMs = options.intervalMs || 1500;
    }

    async current(runwieldSessionId: string, options: { projectId?: string } = {}) {
        return await readCurrentSessionAttention(this.#store, runwieldSessionId, options);
    }

    subscribe(runwieldSessionId: string, subscriber: Subscriber, options: { projectId?: string } = {}) {
        const session = this.#store.getSessionById(runwieldSessionId);
        if (
            !session ||
            (options.projectId && !sessionBelongsToOwnerProject(this.#store as never, session, options.projectId))
        ) {
            throw new Error("Session not found.");
        }
        let watcher = this.#watchers.get(runwieldSessionId);
        if (!watcher) {
            watcher = {
                timer: null,
                subscribers: new Set(),
                inFlight: null,
                lastGeneration: undefined,
                lastPayload: "",
            };
            this.#watchers.set(runwieldSessionId, watcher);
        }
        watcher.subscribers.add(subscriber);
        const poll = () => {
            const active = this.#watchers.get(runwieldSessionId);
            if (!active || active.inFlight) return;
            const generation = this.#store.inspectSessionActivation(runwieldSessionId).generation?.generation ?? null;
            if (generation === active.lastGeneration && active.lastPayload) return;
            active.inFlight = this.current(runwieldSessionId, options).then((snapshot) => {
                const latest = this.#watchers.get(runwieldSessionId);
                if (!latest) return;
                latest.lastGeneration = snapshot.generation;
                const payload = JSON.stringify(snapshot);
                if (payload !== latest.lastPayload) {
                    latest.lastPayload = payload;
                    for (const item of Array.from(latest.subscribers)) item(snapshot);
                }
            }).finally(() => {
                const latest = this.#watchers.get(runwieldSessionId);
                if (latest) latest.inFlight = null;
            });
        };
        poll();
        if (watcher.timer === null) watcher.timer = setInterval(poll, this.#intervalMs);
        return () => {
            const active = this.#watchers.get(runwieldSessionId);
            if (!active) return;
            active.subscribers.delete(subscriber);
            if (active.subscribers.size === 0) {
                if (active.timer !== null) clearInterval(active.timer);
                this.#watchers.delete(runwieldSessionId);
            }
        };
    }

    close() {
        for (const watcher of this.#watchers.values()) {
            if (watcher.timer !== null) clearInterval(watcher.timer);
            watcher.subscribers.clear();
        }
        this.#watchers.clear();
    }
}
