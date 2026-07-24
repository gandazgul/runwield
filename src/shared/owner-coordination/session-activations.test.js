import { assertEquals, assertThrows } from "@std/assert";
import { openOwnerCoordinationDatabase } from "./database.js";
import { acknowledgeActivationProtocol, getActivationProtocolStatus } from "./activation-protocol.js";
import {
    acquireSessionActivation,
    heartbeatSessionActivation,
    inspectSessionActivation,
    markSessionReconcileRequired,
    publishGenerationAndRelease,
} from "./session-activations.js";

/** @param {import('./database.js').OwnerCoordinationDatabase} database */
function insertCatalogedSession(database) {
    database.transaction(() => {
        database.handle.prepare(
            "INSERT INTO projects(id, display_name, registered_root, current_root, lifecycle, created_at, updated_at) VALUES ('project-1', 'Project', '/tmp/project', '/tmp/project', 'enabled', 't0', 't0')",
        ).run();
        database.handle.prepare(
            "INSERT INTO runwield_sessions(id, project_id, source, created_at, updated_at) VALUES ('session-1', 'project-1', 'catalog', 't0', 't0')",
        ).run();
    });
}

Deno.test("activation protocol marker binds to the database epoch", async () => {
    const dir = await Deno.makeTempDir({ prefix: "runwield-activation-protocol-" });
    try {
        const database = openOwnerCoordinationDatabase({ dbPath: `${dir}/owner.sqlite3` });
        try {
            assertEquals(getActivationProtocolStatus(database).enabled, false);
            const enabled = acknowledgeActivationProtocol(database, { now: () => "2026-01-01T00:00:00.000Z" });
            assertEquals(enabled.enabled, true);
            assertEquals(getActivationProtocolStatus(database).state, "enabled");
        } finally {
            database.close();
        }
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test("activation state backfills and publishes generation zero through a fenced proof", async () => {
    const dir = await Deno.makeTempDir({ prefix: "runwield-activation-state-" });
    try {
        const database = openOwnerCoordinationDatabase({ dbPath: `${dir}/owner.sqlite3` });
        try {
            insertCatalogedSession(database);
            assertEquals(inspectSessionActivation(database, "session-1").activation?.state, "uninitialized");
            const proof = acquireSessionActivation(database, {
                runwieldSessionId: "session-1",
                projectId: "project-1",
                ownerInstanceId: "owner-1",
                ownerProcessKind: "test",
                operationId: "op-1",
                expectedGeneration: null,
                phase: "bootstrap",
                now: () => "2026-01-01T00:00:00.000Z",
            });
            publishGenerationAndRelease(database, proof, {
                generation: 0,
                byteLength: 42,
                terminalEntryId: "entry-1",
                digestHex: "a".repeat(64),
            }, { now: () => "2026-01-01T00:00:01.000Z" });
            const inspected = inspectSessionActivation(database, "session-1");
            assertEquals(inspected.activation?.state, "idle");
            assertEquals(inspected.generation?.generation, 0);
        } finally {
            database.close();
        }
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test("stale or expired activation proofs cannot publish or revive a session", async () => {
    const dir = await Deno.makeTempDir({ prefix: "runwield-activation-stale-" });
    try {
        const database = openOwnerCoordinationDatabase({ dbPath: `${dir}/owner.sqlite3` });
        try {
            insertCatalogedSession(database);
            const proof = acquireSessionActivation(database, {
                runwieldSessionId: "session-1",
                projectId: "project-1",
                ownerInstanceId: "owner-1",
                ownerProcessKind: "test",
                operationId: "op-1",
                expectedGeneration: null,
                phase: "bootstrap",
                now: () => "2026-01-01T00:00:00.000Z",
            });
            assertThrows(
                () => heartbeatSessionActivation(database, proof, { now: () => "2026-01-01T00:01:00.000Z" }),
                Error,
                "expired",
            );
            assertEquals(inspectSessionActivation(database, "session-1").activation?.state, "uncertain");
            assertThrows(() =>
                acquireSessionActivation(database, {
                    runwieldSessionId: "session-1",
                    projectId: "project-1",
                    ownerInstanceId: "owner-2",
                    ownerProcessKind: "test",
                    expectedGeneration: null,
                    phase: "bootstrap",
                })
            );
            markSessionReconcileRequired(database, { runwieldSessionId: "session-1", projectId: "project-1" });
            assertEquals(inspectSessionActivation(database, "session-1").activation?.state, "reconcile_required");
        } finally {
            database.close();
        }
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});
