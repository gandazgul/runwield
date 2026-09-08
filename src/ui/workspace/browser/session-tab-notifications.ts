type AttentionItem = {
    attentionId: string;
    reason: "agentStopped";
    runwieldSessionId: string;
    agentName: string;
    sessionName: string;
    recordedAt: string;
    generation: number;
};

type AttentionSnapshot = { generation: number | null; attention: AttentionItem[] };

type BrowserNotificationStatus = "enabled" | "blocked" | "unavailable";

type PeerState = { tabId: string; focused: boolean; visible: boolean; seenAt: number };

const CHANNEL_NAME = "runwield:session-attention";
const LEDGER_KEY = "runwield:browser-notification-ledger:v1";
const STATUS_KEY = "runwield:browser-notification-status:v1";
const PEER_TTL_MS = 3000;
const PROBE_WAIT_MS = 150;
const LEDGER_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const LEDGER_MAX_ENTRIES = 500;

function safeKey(projectId: string, sessionId: string, attentionId: string) {
    return `${projectId}:${sessionId}:${attentionId}`;
}

function canUseNotifications() {
    return typeof globalThis !== "undefined" && "Notification" in globalThis && globalThis.isSecureContext;
}

function dispatchStatus(status: BrowserNotificationStatus) {
    try {
        localStorage.setItem(STATUS_KEY, JSON.stringify({ status, recordedAt: Date.now() }));
    } catch {
        // Storage failure only disables adapter delivery.
    }
    globalThis.dispatchEvent(new CustomEvent("runwield:browser-notification-status", { detail: { status } }));
}

function readLedger(): Record<string, { state: string; recordedAt: number }> | null {
    try {
        const value = JSON.parse(localStorage.getItem(LEDGER_KEY) || "{}");
        return value && typeof value === "object" ? value : {};
    } catch {
        return null;
    }
}

function writeLedger(ledger: Record<string, { state: string; recordedAt: number }>) {
    const now = Date.now();
    const entries = Object.entries(ledger)
        .filter(([, value]) => now - Number(value.recordedAt || 0) < LEDGER_MAX_AGE_MS)
        .sort((left, right) => Number(right[1].recordedAt || 0) - Number(left[1].recordedAt || 0))
        .slice(0, LEDGER_MAX_ENTRIES);
    localStorage.setItem(LEDGER_KEY, JSON.stringify(Object.fromEntries(entries)));
}

function recordLedger(key: string, state: string) {
    const ledger = readLedger();
    if (!ledger) return false;
    if (ledger[key]) return false;
    ledger[key] = { state, recordedAt: Date.now() };
    writeLedger(ledger);
    return true;
}

function updateLedger(key: string, state: string) {
    const ledger = readLedger();
    if (!ledger || !ledger[key]) return;
    ledger[key] = { state, recordedAt: Date.now() };
    writeLedger(ledger);
}

export class SessionTabNotificationController {
    readonly #projectId: string;
    readonly #sessionId: string;
    readonly #tabId = crypto.randomUUID();
    readonly #observed = new Set<string>();
    readonly #peers = new Map<string, PeerState>();
    #channel: BroadcastChannel | null = null;
    #eventSource: EventSource | null = null;
    #notification: Notification | null = null;
    #seededInitialSnapshot = false;
    #closed = false;

    constructor(options: { projectId: string; runwieldSessionId: string }) {
        this.#projectId = options.projectId;
        this.#sessionId = options.runwieldSessionId;
    }

    start() {
        if (!this.#projectId || !this.#sessionId) return;
        if (!canUseNotifications() || !("BroadcastChannel" in globalThis) || !("locks" in navigator)) {
            dispatchStatus("unavailable");
            return;
        }
        try {
            localStorage.setItem("runwield:browser-notification-storage-test", "1");
            localStorage.removeItem("runwield:browser-notification-storage-test");
        } catch {
            dispatchStatus("unavailable");
            return;
        }
        this.#channel = new BroadcastChannel(CHANNEL_NAME);
        this.#channel.onmessage = (event) => this.#onChannelMessage(event.data);
        this.#publishPresence();
        document.addEventListener("visibilitychange", this.#publishPresence);
        globalThis.addEventListener("focus", this.#publishPresence);
        globalThis.addEventListener("blur", this.#publishPresence);
        this.#eventSource = new EventSource(
            `/api/owner/projects/${encodeURIComponent(this.#projectId)}/sessions/${
                encodeURIComponent(this.#sessionId)
            }/attention/stream`,
        );
        this.#eventSource.onmessage = (event) => this.#handleSnapshot(JSON.parse(event.data));
    }

    close() {
        this.#closed = true;
        document.removeEventListener("visibilitychange", this.#publishPresence);
        globalThis.removeEventListener("focus", this.#publishPresence);
        globalThis.removeEventListener("blur", this.#publishPresence);
        this.#eventSource?.close();
        this.#channel?.close();
        this.#notification?.close();
        this.#eventSource = null;
        this.#channel = null;
        this.#notification = null;
    }

    #publishPresence = () => {
        this.#channel?.postMessage({
            type: "presence",
            projectId: this.#projectId,
            sessionId: this.#sessionId,
            tabId: this.#tabId,
            focused: document.hasFocus(),
            visible: document.visibilityState === "visible",
            sentAt: Date.now(),
        });
    };

    #onChannelMessage(message: unknown) {
        if (!message || typeof message !== "object") return;
        const value = message as Record<string, unknown>;
        if (value.projectId !== this.#projectId || value.sessionId !== this.#sessionId || value.tabId === this.#tabId) {
            return;
        }
        if (value.type === "probe") {
            this.#publishPresence();
            return;
        }
        if (value.type === "presence" && typeof value.tabId === "string") {
            this.#peers.set(value.tabId, {
                tabId: value.tabId,
                focused: value.focused === true,
                visible: value.visible === true,
                seenAt: Date.now(),
            });
        }
    }

    #handleSnapshot(snapshot: AttentionSnapshot) {
        if (this.#closed || !Array.isArray(snapshot.attention)) return;
        const currentIds = new Set(snapshot.attention.map((item) => item.attentionId));
        if (!this.#seededInitialSnapshot) {
            for (const id of currentIds) this.#observed.add(id);
            this.#seededInitialSnapshot = true;
            return;
        }
        for (const id of Array.from(this.#observed)) if (!currentIds.has(id)) this.#observed.delete(id);
        for (const item of snapshot.attention) {
            if (this.#observed.has(item.attentionId)) continue;
            this.#observed.add(item.attentionId);
            void this.#claimDelivery(item);
        }
    }

    async #claimDelivery(item: AttentionItem) {
        const lockName = `runwield:attention:${safeKey(this.#projectId, this.#sessionId, item.attentionId)}`;
        await navigator.locks.request(lockName, async () => {
            const key = safeKey(this.#projectId, this.#sessionId, item.attentionId);
            const ledger = readLedger();
            if (!ledger || ledger[key]) return;
            this.#channel?.postMessage({
                type: "probe",
                projectId: this.#projectId,
                sessionId: this.#sessionId,
                tabId: this.#tabId,
            });
            await new Promise((resolve) => setTimeout(resolve, PROBE_WAIT_MS));
            const now = Date.now();
            for (const [tabId, peer] of this.#peers) if (now - peer.seenAt > PEER_TTL_MS) this.#peers.delete(tabId);
            const visibleHere = document.visibilityState === "visible" && document.hasFocus();
            const visiblePeer = Array.from(this.#peers.values()).some((peer) => peer.visible && peer.focused);
            if (visibleHere || visiblePeer) {
                recordLedger(key, "suppressed_visible");
                return;
            }
            if (Notification.permission !== "granted") {
                if (Notification.permission === "denied") dispatchStatus("blocked");
                return;
            }
            if (!recordLedger(key, "reserved")) return;
            try {
                const notification = new Notification(`${item.agentName}: Agent stopped — ${item.sessionName}`, {
                    body: "The agent has stopped and is waiting for you.",
                    tag: key,
                });
                this.#notification = notification;
                notification.onclick = () => {
                    notification.close();
                    globalThis.focus();
                };
                updateLedger(key, "notified");
                dispatchStatus("enabled");
            } catch {
                updateLedger(key, "unavailable");
                dispatchStatus("unavailable");
            }
        });
    }
}

export function readBrowserNotificationStatus(): BrowserNotificationStatus {
    if (!canUseNotifications()) return "unavailable";
    if (Notification.permission === "granted") return "enabled";
    if (Notification.permission === "denied") return "blocked";
    try {
        const stored = JSON.parse(localStorage.getItem(STATUS_KEY) || "null");
        if (stored?.status === "unavailable") return "unavailable";
    } catch {
        return "unavailable";
    }
    return "unavailable";
}

export async function requestBrowserNotificationPermission() {
    if (!canUseNotifications()) {
        dispatchStatus("unavailable");
        return "unavailable" as const;
    }
    const result = await Notification.requestPermission();
    const status = result === "granted" ? "enabled" : result === "denied" ? "blocked" : "unavailable";
    dispatchStatus(status);
    return status;
}
