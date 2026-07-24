import { assertEquals } from "@std/assert";
import { createManagedSessionSyncController } from "./managed-session-sync.js";

Deno.test("managed sync controller inspects immediately and then polls managed dormant sessions", async () => {
    /** @type {Array<() => void | Promise<void>>} */
    const callbacks = [];
    let calls = 0;
    const runtime = {
        getSessionSnapshot: () => ({ managed: { dormant: true } }),
        synchronizeManagedSession: () => {
            calls++;
            return Promise.resolve();
        },
    };
    const controller = createManagedSessionSyncController({
        runtime: /** @type {any} */ (runtime),
        getSessionId: () => "session-1",
        setTimer: (callback) => {
            callbacks.push(callback);
            return callback;
        },
        clearTimer: () => {},
    });
    controller.start();
    assertEquals(calls, 0);
    await callbacks.shift()?.();
    assertEquals(calls, 1);
    await callbacks.shift()?.();
    assertEquals(calls, 2);
    controller.dispose();
});

Deno.test("managed sync controller skips unmanaged sessions and respects pause", async () => {
    /** @type {Array<() => void | Promise<void>>} */
    const callbacks = [];
    let calls = 0;
    const runtime = {
        getSessionSnapshot: () => ({ managed: null }),
        synchronizeManagedSession: () => {
            calls++;
            return Promise.resolve();
        },
    };
    const controller = createManagedSessionSyncController({
        runtime: /** @type {any} */ (runtime),
        getSessionId: () => "session-1",
        setTimer: (callback) => {
            callbacks.push(callback);
            return callback;
        },
        clearTimer: () => {},
    });
    controller.start();
    await callbacks.shift()?.();
    assertEquals(calls, 0);
    controller.pause();
    await controller.refreshNow();
    assertEquals(calls, 0);
});
