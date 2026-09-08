// @ts-nocheck: This test installs browser globals in Deno.
import { assertEquals, assertStrictEquals } from "@std/assert";
import { withProcessGlobalTestLock } from "../../../testing/process-global-lock.js";
import {
    createSessionTabNotificationController,
    SessionTabNotificationController,
} from "./session-tab-notifications.ts";

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

class FakeNotification {
    static permission = "granted";
    static created: FakeNotification[] = [];
    title: string;
    options: NotificationOptions;
    closed = false;
    onclick: ((event: Event) => void) | null = null;

    constructor(title: string, options: NotificationOptions = {}) {
        this.title = title;
        this.options = options;
        FakeNotification.created.push(this);
    }

    close() {
        this.closed = true;
    }
}

function installBrowser(
    options: { permission?: string; visibilityState?: string; focused?: boolean; throwOnConstruct?: boolean } = {},
) {
    let focusCount = 0;
    class TestNotification extends FakeNotification {
        static override permission = options.permission || "granted";
        constructor(title: string, notificationOptions: NotificationOptions = {}) {
            if (options.throwOnConstruct) throw new Error("blocked");
            super(title, notificationOptions);
        }
    }
    FakeNotification.created = [];
    Reflect.set(globalThis, "Notification", TestNotification);
    Reflect.set(globalThis, "document", {
        visibilityState: options.visibilityState || "hidden",
        hasFocus: () => options.focused === true,
    });
    Reflect.set(globalThis, "focus", () => focusCount += 1);
    return {
        created: FakeNotification.created,
        focusCount: () => focusCount,
        cleanup() {
            Reflect.deleteProperty(globalThis, "Notification");
            Reflect.deleteProperty(globalThis, "document");
            Reflect.deleteProperty(globalThis, "focus");
        },
    };
}

const enabledPolicy = { enabled: true, events: { agentStopped: true }, suppressWhenFocused: true };
const stoppedEvent = { type: "attention_requested", reason: "agentStopped", agentName: "Guide", sessionName: "Demo" };

Deno.test("browser notifications construct the real Notification and focus the tab on click", () => {
    const browser = installBrowser();
    try {
        const controller = createSessionTabNotificationController();
        controller.notifyAgentStopped(stoppedEvent, enabledPolicy);
        assertEquals(browser.created.length, 1);
        assertEquals(browser.created[0].title, "Guide: Agent stopped — Demo");
        assertEquals(browser.created[0].options.body, "The agent has stopped and is waiting for you.");
        browser.created[0].onclick?.(new Event("click"));
        assertEquals(browser.created[0].closed, true);
        assertEquals(browser.focusCount(), 1);
    } finally {
        browser.cleanup();
    }
});

Deno.test("browser notifications skip denied, missing API, disabled settings, and focused visible tabs", () => {
    const denied = installBrowser({ permission: "denied" });
    try {
        createSessionTabNotificationController().notifyAgentStopped(stoppedEvent, enabledPolicy);
        assertEquals(denied.created.length, 0);
    } finally {
        denied.cleanup();
    }

    Reflect.deleteProperty(globalThis, "Notification");
    Reflect.set(globalThis, "document", { visibilityState: "hidden", hasFocus: () => false });
    Reflect.set(globalThis, "focus", () => {});
    createSessionTabNotificationController().notifyAgentStopped(stoppedEvent, enabledPolicy);
    Reflect.deleteProperty(globalThis, "document");
    Reflect.deleteProperty(globalThis, "focus");

    const disabled = installBrowser();
    try {
        createSessionTabNotificationController().notifyAgentStopped(stoppedEvent, {
            enabled: false,
            events: { agentStopped: true },
            suppressWhenFocused: true,
        });
        createSessionTabNotificationController().notifyAgentStopped(stoppedEvent, {
            enabled: true,
            events: { agentStopped: false },
            suppressWhenFocused: true,
        });
        assertEquals(disabled.created.length, 0);
    } finally {
        disabled.cleanup();
    }

    const focused = installBrowser({ visibilityState: "visible", focused: true });
    try {
        createSessionTabNotificationController().notifyAgentStopped(stoppedEvent, enabledPolicy);
        assertEquals(focused.created.length, 0);
    } finally {
        focused.cleanup();
    }
});

Deno.test("browser notifications allow background and suppression-disabled focused delivery", () => {
    const focused = installBrowser({ visibilityState: "visible", focused: true });
    try {
        createSessionTabNotificationController().notifyAgentStopped(stoppedEvent, {
            enabled: true,
            events: { agentStopped: true },
            suppressWhenFocused: false,
        });
        assertEquals(focused.created.length, 1);
    } finally {
        focused.cleanup();
    }
});

Deno.test("browser notifications ignore non-production event shapes and isolate failures", () => {
    const browser = installBrowser({ throwOnConstruct: true });
    try {
        const controller = createSessionTabNotificationController();
        controller.notifyAgentStopped({ type: "agentStopped" }, enabledPolicy);
        controller.notifyAgentStopped({ type: "attention_requested", reason: "planWritten" }, enabledPolicy);
        controller.notifyAgentStopped(stoppedEvent, enabledPolicy);
        assertEquals(browser.created.length, 0);
    } finally {
        browser.cleanup();
    }
});

Deno.test("browser notification disposal closes tracked notifications and clears click handlers", () => {
    const browser = installBrowser();
    try {
        const controller = createSessionTabNotificationController();
        controller.notifyAgentStopped(stoppedEvent, enabledPolicy);
        const notification = browser.created[0];
        controller.dispose();
        assertEquals(notification.closed, true);
        assertStrictEquals(notification.onclick, null);
    } finally {
        browser.cleanup();
    }
});
