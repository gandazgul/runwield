import { assertEquals } from "@std/assert";
import { join } from "@std/path";

const REPO_ROOT = new URL("../../..", import.meta.url).pathname;

Deno.test("managed public mutation rejection is capability-scoped, not manager-presence-scoped", async () => {
    const source = await Deno.readTextFile(join(REPO_ROOT, "src/shared/session/session-runtime.js"));
    const rejectIndex = source.indexOf("#rejectManagedPublicMutation(hostedSession, operation");
    const ensureQueueIndex = source.indexOf("#ensureQueueSourceSubscription", rejectIndex);
    const body = source.slice(rejectIndex, ensureQueueIndex);

    assertEquals(rejectIndex >= 0, true);
    assertEquals(body.includes("getRootSessionManager"), false);
    assertEquals(body.includes("#currentManagedOperations"), true);
    assertEquals(body.includes("managed_operation_in_progress"), true);
    assertEquals(body.includes("managed_unsupported"), true);
});

Deno.test("managed prompt operation installs manager only with the operation capability", async () => {
    const source = await Deno.readTextFile(join(REPO_ROOT, "src/shared/session/session-runtime.js"));
    const runIndex = source.indexOf("async #runManagedOperation(");
    const promptIndex = source.indexOf("async promptManagedSession(", runIndex);
    const body = source.slice(runIndex, promptIndex);

    assertEquals(runIndex >= 0, true);
    assertEquals(body.includes("ManagedOperationCapability.create"), true);
    assertEquals(body.includes("#currentManagedOperations.set(sessionId, capability)"), true);
    assertEquals(body.includes("hostedSession.setManagedOperationCapability(capability)"), true);
    assertEquals(
        body.includes("hostedSession.setRootSessionManager(/** @type {any} */ (sessionManager), capability)"),
        true,
    );
    assertEquals(body.includes("managedOperationCapability: capability"), true);
    assertEquals(body.includes("capability.settle()"), true);
    assertEquals(body.includes("#currentManagedOperations.delete(sessionId)"), true);
});
