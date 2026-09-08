// @ts-nocheck: This test installs browser globals in Deno.
import { assertEquals } from "@std/assert";
import { withProcessGlobalTestLock } from "../../../testing/process-global-lock.js";
import { SessionTabNotificationController } from "./session-tab-notifications.ts";

const originalGlobals = {
    BroadcastChannel: globalThis.BroadcastChannel,
    EventSource: globalThis.EventSource,
    Notification: globalThis.Notification,
    document: globalThis.document,
    localStorage: globalThis.localStorage,
    navigator: globalThis.navigator,
    isSecureContext: globalThis.isSecureContext,
};

function restoreGlobals() {
    for (const [key, value] of Object.entries(originalGlobals)) {
        if (value === undefined) Reflect.deleteProperty(globalThis, key);
        else Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    }
}

function installBrowserFakes(options = {}) {
    const storage = new Map();
    const eventSources = [];
    const channels = [];
    const notifications = [];
    class FakeEventSource {
        onmessage = null;
        closed = false;
        constructor(url) {
            this.url = url;
            eventSources.push(this);
        }
        close() {
            this.closed = true;
        }
    }
    class FakeBroadcastChannel {
        onmessage = null;
        constructor(name) {
            this.name = name;
            channels.push(this);
        }
        postMessage(data) {
            for (const channel of channels) if (channel !== this && !channel.closed) channel.onmessage?.({ data });
        }
        close() {
            this.closed = true;
        }
    }
    function FakeNotification(title, init) {
        this.title = title;
        this.init = init;
        this.close = () => {};
        notifications.push(this);
    }
    FakeNotification.permission = options.permission || "granted";
    FakeNotification.requestPermission = () => Promise.resolve(FakeNotification.permission);

    Object.defineProperty(globalThis, "isSecureContext", { value: true, configurable: true, writable: true });
    Object.defineProperty(globalThis, "localStorage", {
        value: {
            getItem: (key) => storage.has(key) ? storage.get(key) : null,
            setItem: (key, value) => storage.set(key, String(value)),
            removeItem: (key) => storage.delete(key),
        },
        configurable: true,
        writable: true,
    });
    Object.defineProperty(globalThis, "document", {
        value: {
            visibilityState: options.visibilityState || "hidden",
            hasFocus: () => options.focused === true,
            addEventListener() {},
            removeEventListener() {},
        },
        configurable: true,
        writable: true,
    });
    Object.defineProperty(globalThis, "navigator", {
        value: { locks: { request: async (_name, callback) => await callback() } },
        configurable: true,
        writable: true,
    });
    Object.defineProperty(globalThis, "EventSource", { value: FakeEventSource, configurable: true, writable: true });
    Object.defineProperty(globalThis, "BroadcastChannel", {
        value: FakeBroadcastChannel,
        configurable: true,
        writable: true,
    });
    Object.defineProperty(globalThis, "Notification", { value: FakeNotification, configurable: true, writable: true });
    return { eventSources, notifications };
}

function attention(attentionId) {
    return {
        attentionId,
        reason: "agentStopped",
        runwieldSessionId: "session-1",
        agentName: "Engineer",
        sessionName: "Fix bug",
        recordedAt: "2026-01-01T00:00:00.000Z",
        generation: 2,
    };
}

function emitSnapshot(source, items) {
    source.onmessage?.({ data: JSON.stringify({ generation: 2, attention: items }) });
}

function wait(ms = 220) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

Deno.test("Session tab notification controller seeds existing attention without notifying", async () => {
    await withProcessGlobalTestLock(async () => {
        try {
            const fakes = installBrowserFakes();
            const controller = new SessionTabNotificationController({
                projectId: "project-1",
                runwieldSessionId: "session-1",
            });
            controller.start();
            assertEquals(
                fakes.eventSources[0].url,
                "/api/owner/projects/project-1/sessions/session-1/attention/stream",
            );
            emitSnapshot(fakes.eventSources[0], [attention("attention-1")]);
            await wait();
            assertEquals(fakes.notifications.length, 0);
            controller.close();
        } finally {
            restoreGlobals();
        }
    });
});

Deno.test("Session tab notification controller delivers one background notification across duplicate tabs", async () => {
    await withProcessGlobalTestLock(async () => {
        try {
            const fakes = installBrowserFakes();
            const first = new SessionTabNotificationController({
                projectId: "project-1",
                runwieldSessionId: "session-1",
            });
            const second = new SessionTabNotificationController({
                projectId: "project-1",
                runwieldSessionId: "session-1",
            });
            first.start();
            second.start();
            emitSnapshot(fakes.eventSources[0], []);
            emitSnapshot(fakes.eventSources[1], []);
            emitSnapshot(fakes.eventSources[0], [attention("attention-2")]);
            emitSnapshot(fakes.eventSources[1], [attention("attention-2")]);
            await wait();
            assertEquals(fakes.notifications.length, 1);
            assertEquals(fakes.notifications[0].init.tag, "project-1:session-1:attention-2");
            first.close();
            second.close();
        } finally {
            restoreGlobals();
        }
    });
});

Deno.test("Session tab notification controller suppresses delivery when the exact Session tab is visible", async () => {
    await withProcessGlobalTestLock(async () => {
        try {
            const fakes = installBrowserFakes({ visibilityState: "visible", focused: true });
            const controller = new SessionTabNotificationController({
                projectId: "project-1",
                runwieldSessionId: "session-1",
            });
            controller.start();
            emitSnapshot(fakes.eventSources[0], []);
            emitSnapshot(fakes.eventSources[0], [attention("attention-3")]);
            await wait();
            assertEquals(fakes.notifications.length, 0);
            controller.close();
        } finally {
            restoreGlobals();
        }
    });
});
