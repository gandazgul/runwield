import { assertEquals } from "@std/assert";
import { dirname, join } from "@std/path";
import { DatabaseSync } from "node:sqlite";
import { getActivationProtocolMarkerPath } from "../owner-coordination/activation-protocol.js";
import { openOwnerCoordinationStore } from "../owner-coordination/index.js";
import { classifyRootSessionLocator, getRunWieldSessionDir } from "./root-session.js";

function idFactory(prefix: string): () => string {
    let index = 0;
    return () => `${prefix}-${++index}`;
}

async function makeRoot(name: string): Promise<string> {
    return await Deno.makeTempDir({ prefix: `${name}-` });
}

async function writeTranscript(cwd: string, piSessionId: string): Promise<string> {
    const sessionDir = getRunWieldSessionDir(cwd);
    await Deno.mkdir(sessionDir, { recursive: true });
    const timestamp = "2026-01-01T00:00:00.000Z";
    const fileName = `${timestamp.replace(/[:.]/g, "-")}_${piSessionId}.jsonl`;
    const path = join(sessionDir, fileName);
    await Deno.writeTextFile(path, `${JSON.stringify({ type: "session", id: piSessionId, timestamp, cwd })}\n`);
    return path;
}

function assertNoSensitivePayload(result: { reason?: string }, root: string): void {
    const payload = JSON.stringify(result);
    assertEquals(payload.includes(root), false);
    assertEquals(payload.includes("proof"), false);
    assertEquals(payload.includes("operation"), false);
}

Deno.test("classifyRootSessionLocator returns typed blocked reasons for managed locator cases", async () => {
    const cases: Array<
        {
            name: string;
            expected: string;
            run: () => Promise<{ result: { kind: string; reason?: string }; root: string }>;
        }
    > = [
        {
            name: "current registered root",
            expected: "session_path_required",
            run: async () => {
                const home = await makeRoot("classifier-current-home");
                const store = openOwnerCoordinationStore({ dbPath: join(home, "owner.sqlite3") });
                const root = await makeRoot("classifier-current-root");
                try {
                    store.acknowledgeActivationProtocol();
                    store.registerProject({ root, idFactory: idFactory("project") });
                    return {
                        result: await classifyRootSessionLocator({
                            cwd: root,
                            sessionId: "pi-1",
                            ownerCoordinationStore: store,
                        }),
                        root,
                    };
                } finally {
                    store.close();
                }
            },
        },
        {
            name: "historical registered root",
            expected: "historical_project_root",
            run: async () => {
                const home = await makeRoot("classifier-historical-home");
                const store = openOwnerCoordinationStore({ dbPath: join(home, "owner.sqlite3") });
                const root = await makeRoot("classifier-historical-root");
                const nextRoot = await makeRoot("classifier-historical-next");
                try {
                    store.acknowledgeActivationProtocol();
                    const project = store.registerProject({ root, idFactory: idFactory("project") });
                    store.relinkProject({
                        projectId: project.projectId,
                        newRoot: nextRoot,
                        idFactory: idFactory("relink"),
                    });
                    return {
                        result: await classifyRootSessionLocator({
                            cwd: root,
                            sessionId: "pi-1",
                            ownerCoordinationStore: store,
                        }),
                        root,
                    };
                } finally {
                    store.close();
                }
            },
        },
        {
            name: "nested working directory",
            expected: "nested_project_root",
            run: async () => {
                const home = await makeRoot("classifier-nested-home");
                const store = openOwnerCoordinationStore({ dbPath: join(home, "owner.sqlite3") });
                const root = await makeRoot("classifier-nested-root");
                const nested = join(root, "nested");
                await Deno.mkdir(nested);
                try {
                    store.acknowledgeActivationProtocol();
                    store.registerProject({ root, idFactory: idFactory("project") });
                    return {
                        result: await classifyRootSessionLocator({
                            cwd: nested,
                            sessionId: "pi-1",
                            ownerCoordinationStore: store,
                        }),
                        root,
                    };
                } finally {
                    store.close();
                }
            },
        },
        {
            name: "uncataloged transcript",
            expected: "session_not_cataloged",
            run: async () => {
                const home = await makeRoot("classifier-uncataloged-home");
                const store = openOwnerCoordinationStore({ dbPath: join(home, "owner.sqlite3") });
                const root = await makeRoot("classifier-uncataloged-root");
                try {
                    store.acknowledgeActivationProtocol();
                    store.registerProject({ root, idFactory: idFactory("project") });
                    const sessionPath = await writeTranscript(root, "pi-2");
                    return {
                        result: await classifyRootSessionLocator({
                            cwd: root,
                            sessionId: "pi-2",
                            sessionPath,
                            ownerCoordinationStore: store,
                            allowCatalog: false,
                        }),
                        root,
                    };
                } finally {
                    store.close();
                }
            },
        },
        {
            name: "omitted sessionPath",
            expected: "session_path_required",
            run: async () => {
                const home = await makeRoot("classifier-omitted-home");
                const store = openOwnerCoordinationStore({ dbPath: join(home, "owner.sqlite3") });
                const root = await makeRoot("classifier-omitted-root");
                try {
                    store.acknowledgeActivationProtocol();
                    store.registerProject({ root, idFactory: idFactory("project") });
                    return {
                        result: await classifyRootSessionLocator({
                            cwd: root,
                            sessionId: "pi-3",
                            ownerCoordinationStore: store,
                        }),
                        root,
                    };
                } finally {
                    store.close();
                }
            },
        },
        {
            name: "stale sessionPath",
            expected: "invalid_transcript_locator",
            run: async () => {
                const home = await makeRoot("classifier-stale-home");
                const store = openOwnerCoordinationStore({ dbPath: join(home, "owner.sqlite3") });
                const root = await makeRoot("classifier-stale-root");
                try {
                    store.acknowledgeActivationProtocol();
                    store.registerProject({ root, idFactory: idFactory("project") });
                    return {
                        result: await classifyRootSessionLocator({
                            cwd: root,
                            sessionId: "pi-4",
                            sessionPath: join(root, "missing.jsonl"),
                            ownerCoordinationStore: store,
                        }),
                        root,
                    };
                } finally {
                    store.close();
                }
            },
        },
        {
            name: "locator conflict",
            expected: "locator_conflict",
            run: async () => {
                const home = await makeRoot("classifier-conflict-home");
                const store = openOwnerCoordinationStore({ dbPath: join(home, "owner.sqlite3") });
                const root = await makeRoot("classifier-conflict-root");
                try {
                    store.acknowledgeActivationProtocol();
                    const project = store.registerProject({ root, idFactory: idFactory("project") });
                    const firstPath = await writeTranscript(root, "pi-5");
                    await store.ensureSessionCatalogRecord({
                        projectId: project.projectId,
                        piSessionId: "pi-5",
                        transcriptPath: firstPath,
                        transcriptCwd: root,
                        source: "catalog",
                    });
                    const sessionDir = getRunWieldSessionDir(root);
                    const secondTimestamp = "2026-01-01T00:00:01.000Z";
                    const secondPath = join(sessionDir, `${secondTimestamp.replace(/[:.]/g, "-")}_pi-5.jsonl`);
                    await Deno.writeTextFile(
                        secondPath,
                        `${JSON.stringify({ type: "session", id: "pi-5", timestamp: secondTimestamp, cwd: root })}\n`,
                    );
                    return {
                        result: await classifyRootSessionLocator({
                            cwd: root,
                            sessionId: "pi-5",
                            sessionPath: secondPath,
                            ownerCoordinationStore: store,
                        }),
                        root,
                    };
                } finally {
                    store.close();
                }
            },
        },
        {
            name: "moved Project",
            expected: "project_root_unavailable",
            run: async () => {
                const home = await makeRoot("classifier-moved-home");
                const store = openOwnerCoordinationStore({ dbPath: join(home, "owner.sqlite3") });
                const root = await makeRoot("classifier-moved-root");
                try {
                    store.acknowledgeActivationProtocol();
                    store.registerProject({ root, idFactory: idFactory("project") });
                    await Deno.remove(root);
                    return {
                        result: await classifyRootSessionLocator({
                            cwd: root,
                            sessionId: "pi-6",
                            ownerCoordinationStore: store,
                        }),
                        root,
                    };
                } finally {
                    store.close();
                }
            },
        },
        {
            name: "disabled Project",
            expected: "project_not_enabled",
            run: async () => {
                const home = await makeRoot("classifier-disabled-home");
                const store = openOwnerCoordinationStore({ dbPath: join(home, "owner.sqlite3") });
                const root = await makeRoot("classifier-disabled-root");
                try {
                    store.acknowledgeActivationProtocol();
                    const project = store.registerProject({ root, idFactory: idFactory("project") });
                    store.setProjectEnabled(project.projectId, false);
                    return {
                        result: await classifyRootSessionLocator({
                            cwd: root,
                            sessionId: "pi-7",
                            ownerCoordinationStore: store,
                        }),
                        root,
                    };
                } finally {
                    store.close();
                }
            },
        },
        {
            name: "missing activation row",
            expected: "missing_activation_row",
            run: async () => {
                const home = await makeRoot("classifier-activation-home");
                const store = openOwnerCoordinationStore({ dbPath: join(home, "owner.sqlite3") });
                const root = await makeRoot("classifier-activation-root");
                try {
                    store.acknowledgeActivationProtocol();
                    const project = store.registerProject({ root, idFactory: idFactory("project") });
                    const sessionPath = await writeTranscript(root, "pi-8");
                    const cataloged = await store.ensureSessionCatalogRecord({
                        projectId: project.projectId,
                        piSessionId: "pi-8",
                        transcriptPath: sessionPath,
                        transcriptCwd: root,
                        source: "catalog",
                    });
                    const database = new DatabaseSync(store.path);
                    try {
                        database.prepare("DELETE FROM session_activation_state WHERE runwield_session_id = ?").run(
                            cataloged.runwieldSessionId,
                        );
                    } finally {
                        database.close();
                    }
                    return {
                        result: await classifyRootSessionLocator({
                            cwd: root,
                            sessionId: "pi-8",
                            sessionPath,
                            ownerCoordinationStore: store,
                        }),
                        root,
                    };
                } finally {
                    store.close();
                }
            },
        },
        {
            name: "protocol marker mismatch",
            expected: "activation_protocol_marker_mismatch",
            run: async () => {
                const home = await makeRoot("classifier-protocol-home");
                const store = openOwnerCoordinationStore({ dbPath: join(home, "owner.sqlite3") });
                const root = await makeRoot("classifier-protocol-root");
                try {
                    store.acknowledgeActivationProtocol();
                    store.registerProject({ root, idFactory: idFactory("project") });
                    const markerPath = getActivationProtocolMarkerPath(store.path);
                    await Deno.writeTextFile(markerPath, "{bad json");
                    return {
                        result: await classifyRootSessionLocator({
                            cwd: root,
                            sessionId: "pi-9",
                            ownerCoordinationStore: store,
                        }),
                        root,
                    };
                } finally {
                    store.close();
                }
            },
        },
        {
            name: "replaced database epoch",
            expected: "activation_protocol_epoch_mismatch",
            run: async () => {
                const home = await makeRoot("classifier-epoch-home");
                const store = openOwnerCoordinationStore({ dbPath: join(home, "owner.sqlite3") });
                const root = await makeRoot("classifier-epoch-root");
                try {
                    const status = store.acknowledgeActivationProtocol();
                    store.registerProject({ root, idFactory: idFactory("project") });
                    const markerPath = getActivationProtocolMarkerPath(store.path);
                    await Deno.mkdir(dirname(markerPath), { recursive: true });
                    await Deno.writeTextFile(
                        markerPath,
                        JSON.stringify({
                            markerSchema: 1,
                            protocolVersion: 1,
                            databaseEpoch: `${status.databaseEpoch}-old`,
                        }),
                    );
                    return {
                        result: await classifyRootSessionLocator({
                            cwd: root,
                            sessionId: "pi-10",
                            ownerCoordinationStore: store,
                        }),
                        root,
                    };
                } finally {
                    store.close();
                }
            },
        },
    ];

    for (const item of cases) {
        const { result, root } = await item.run();
        assertEquals(result.kind, "blocked", item.name);
        assertEquals(result.reason, item.expected, item.name);
        assertNoSensitivePayload(result, root);
    }
});

Deno.test("classifyRootSessionLocator blocks roots without owner-coordination Project evidence", async () => {
    const home = await makeRoot("classifier-unmanaged-home");
    const store = openOwnerCoordinationStore({ dbPath: join(home, "owner.sqlite3") });
    try {
        const unrelatedRoot = await makeRoot("classifier-unrelated-root");
        store.registerProject({ root: unrelatedRoot, idFactory: idFactory("project") });
        const unmanagedRoot = await makeRoot("classifier-unmanaged-root");
        const result = await classifyRootSessionLocator({ cwd: unmanagedRoot, ownerCoordinationStore: store });
        assertEquals(result.kind, "blocked");
        assertEquals(result.reason, "owner_coordination_project_evidence_absent");
    } finally {
        store.close();
    }
});

Deno.test("classifyRootSessionLocator blocks when owner coordination is unavailable", async () => {
    const unmanagedRoot = await makeRoot("classifier-no-store-root");
    const result = await classifyRootSessionLocator({ cwd: unmanagedRoot, ownerCoordinationStore: null });
    assertEquals(result.kind, "blocked");
    assertEquals(result.reason, "owner_coordination_unavailable");
});
