/**
 * @module ui/tui/session-snapshot-window
 * Each frame used to rebuild the session snapshot, even keystrokes that
 * changed nothing. Frames inside a short TTL window now share one snapshot,
 * and callers invalidate it the moment real state changes.
 */

export interface SnapshotWindowRuntime<TSnapshot> {
    getSessionSnapshot(sessionId: string): TSnapshot | null;
}

export interface SessionSnapshotWindow<TSnapshot> {
    read(): TSnapshot | null;
    invalidate(): void;
}

export function createSessionSnapshotWindow<TSnapshot>(
    runtime: SnapshotWindowRuntime<TSnapshot>,
    getSessionId: () => string,
    ttlMs = 500,
): SessionSnapshotWindow<TSnapshot> {
    let cachedAt = 0;
    let cached: TSnapshot | null = null;
    let hasCached = false;
    return {
        read(): TSnapshot | null {
            const now = Date.now();
            if (hasCached && now - cachedAt < ttlMs) return cached;
            cached = runtime.getSessionSnapshot(getSessionId());
            cachedAt = now;
            hasCached = true;
            return cached;
        },
        invalidate(): void {
            cached = null;
            hasCached = false;
        },
    };
}
