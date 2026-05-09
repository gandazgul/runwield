import { assert, assertEquals } from "@std/assert";
import { createGenerationGuard } from "./generation-guard.js";

// ─── Tests for the real createGenerationGuard() factory ───

Deno.test("isCurrent returns true before any bump", () => {
    const { bump, isCurrent } = createGenerationGuard();
    // Initial generation is 0
    assertEquals(isCurrent(0), true);
    // After bump, generation 0 is stale
    bump();
    assertEquals(isCurrent(0), false);
});

Deno.test("isCurrent returns true for current, false for stale", () => {
    const { bump, isCurrent } = createGenerationGuard();
    const gen1 = bump(); // gen1 = 1
    assertEquals(isCurrent(gen1), true);

    const gen2 = bump(); // gen2 = 2
    assertEquals(isCurrent(gen1), false); // gen1 is stale
    assertEquals(isCurrent(gen2), true); // gen2 is current
});

Deno.test("multiple bumps invalidate all previous generations", () => {
    const { bump, isCurrent } = createGenerationGuard();
    const generations = [bump(), bump(), bump()];
    // Only the last one should be current
    assertEquals(isCurrent(generations[0]), false);
    assertEquals(isCurrent(generations[1]), false);
    assertEquals(isCurrent(generations[2]), true);
});

Deno.test("invalidateAll bumps without exposing the new id", () => {
    const { bump, isCurrent, invalidateAll } = createGenerationGuard();
    const gen = bump();
    assertEquals(isCurrent(gen), true);
    invalidateAll();
    assertEquals(isCurrent(gen), false);
});

Deno.test("late result suppression pattern works correctly", async () => {
    const { bump, isCurrent } = createGenerationGuard();
    /** @type {string[]} */
    const results = [];

    // Simulate starting an operation
    const gen = bump();

    // Simulate user pressing Esc BEFORE the async completes
    // (this bumps the generation, making `gen` stale)
    bump();

    // Now simulate the async operation completing
    await new Promise((resolve) => {
        /** @type {() => void} */
        const r = /** @type {() => void} */ (resolve);
        setTimeout(() => {
            if (isCurrent(gen)) {
                results.push("completed");
            }
            r();
        }, 50);
    });

    // Result should be suppressed because generation changed
    assertEquals(results.length, 0);
});

Deno.test("completed result is accepted when not canceled", async () => {
    const { bump, isCurrent } = createGenerationGuard();
    /** @type {string[]} */
    const results = [];

    const gen = bump();

    await new Promise((resolve) => {
        /** @type {() => void} */
        const r = /** @type {() => void} */ (resolve);
        setTimeout(() => {
            if (isCurrent(gen)) {
                results.push("completed");
            }
            r();
        }, 10);
    });

    // Don't bump generation — let it complete naturally
    assertEquals(results, ["completed"]);
});

// ─── Tests for cancel-callback pattern ───
// These document the cancel-callback behavior used in chat-session.js
// (cancelActiveOperation()), not an exported helper.

/** Simulates the cancel flow from chat-session.js */
function tryCancelOperation(/** @type {(() => void) | null} */ cancelFn) {
    if (cancelFn) {
        try {
            cancelFn();
        } catch (_e) {
            // Ignore cancel errors — cancellation should always succeed from caller's perspective
        }
        return true;
    }
    return false;
}

Deno.test("cancel callback is called and cleared", () => {
    let cancelCalled = false;
    /** @type {(() => void) | null} */
    let activeOperationCancel = () => {
        cancelCalled = true;
    };

    const canceled = tryCancelOperation(activeOperationCancel);
    activeOperationCancel = null;

    assert(canceled);
    assert(cancelCalled);
    assertEquals(activeOperationCancel, null);
});

Deno.test("cancel is idempotent — second cancel is no-op", () => {
    let cancelCount = 0;
    /** @type {(() => void) | null} */
    let activeOperationCancel = () => {
        cancelCount++;
    };

    // First cancel
    const first = tryCancelOperation(activeOperationCancel);
    activeOperationCancel = null;
    assert(first);
    assertEquals(cancelCount, 1);

    // Second cancel attempt (should be no-op since cancelFn is null)
    const second = tryCancelOperation(activeOperationCancel);
    assert(!second);
    assertEquals(cancelCount, 1); // Still 1
});

Deno.test("cancel callback that throws does not crash the flow", () => {
    /** @type {(() => void) | null} */
    let activeOperationCancel = () => {
        throw new Error("boom");
    };

    // Should not throw
    const canceled = tryCancelOperation(activeOperationCancel);
    activeOperationCancel = null;

    assert(canceled);
    assertEquals(activeOperationCancel, null);
});

// ─── Tests for bash-process kill pattern ───
// Documents the wasCanceled flag pattern used in chat-session.js bash interception.

Deno.test("bash process kill flag is set on cancel", () => {
    let wasCanceled = false;
    /** @type {{ kill?: () => void, pid?: number } | null} */
    let activeBashProc = {
        kill: () => {
            wasCanceled = true;
        },
    };

    // Simulate cancel
    if (activeBashProc) {
        try {
            if (activeBashProc.kill) activeBashProc.kill();
        } catch (_e) {
            // Ignore kill errors
        }
        activeBashProc = null;
    }

    assert(wasCanceled);
    assertEquals(activeBashProc, null);
});

Deno.test("output append is skipped after bash cancel", () => {
    let wasCanceled = false;
    let outputBuffer = "";

    // Simulate receiving output before cancel
    if (!wasCanceled) {
        outputBuffer += "some output";
    }

    // Now cancel
    wasCanceled = true;

    // Simulate receiving more output after cancel
    if (!wasCanceled) {
        outputBuffer += " more output";
    }

    assertEquals(outputBuffer, "some output"); // No additional output after cancel
});
