import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { openFileSessionStore } from "./file-session-store.ts";
import { classifyRootSessionLocator, getRunWieldSessionDir } from "./root-session.js";

async function makeRoot(name: string): Promise<string> {
    return await Deno.makeTempDir({ prefix: `${name}-` });
}

async function writeTranscript(cwd: string, piSessionId: string): Promise<string> {
    const sessionDir = getRunWieldSessionDir(cwd);
    await Deno.mkdir(sessionDir, { recursive: true });
    const timestamp = "2026-01-01T00:00:00.000Z";
    const path = join(sessionDir, `${timestamp.replace(/[:.]/g, "-")}_${piSessionId}.jsonl`);
    await Deno.writeTextFile(path, `${JSON.stringify({ type: "session", id: piSessionId, timestamp, cwd })}\n`);
    return path;
}

function assertNoSensitivePayload(result: { reason?: string }, root: string): void {
    const payload = JSON.stringify(result);
    assertEquals(payload.includes(root), false);
    assertEquals(payload.includes("proof"), false);
    assertEquals(payload.includes("operation"), false);
}

Deno.test("classifyRootSessionLocator uses the file catalog and returns safe blocked reasons", async () => {
    const cases: Array<{
        name: string;
        expected: string;
        run: () => Promise<{ result: { kind: string; reason?: string }; root: string }>;
    }> = [
        {
            name: "cataloged Project requires a transcript path for an unknown Pi id",
            expected: "session_path_required",
            run: async () => {
                const root = await makeRoot("classifier-current-root");
                const store = openFileSessionStore();
                try {
                    store.ensureRuntimeProject({ root });
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
                const root = await makeRoot("classifier-nested-root");
                const nested = join(root, "nested");
                await Deno.mkdir(nested);
                const store = openFileSessionStore();
                try {
                    store.ensureRuntimeProject({ root });
                    return {
                        result: await classifyRootSessionLocator({
                            cwd: nested,
                            sessionId: "pi-2",
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
            name: "cataloging explicitly disabled",
            expected: "session_not_cataloged",
            run: async () => {
                const root = await makeRoot("classifier-uncataloged-root");
                const store = openFileSessionStore();
                try {
                    const project = store.ensureRuntimeProject({ root });
                    const sessionPath = await writeTranscript(root, "pi-3");
                    assertEquals(project.lifecycle, "enabled");
                    return {
                        result: await classifyRootSessionLocator({
                            cwd: root,
                            sessionId: "pi-3",
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
            name: "stale transcript path",
            expected: "invalid_transcript_locator",
            run: async () => {
                const root = await makeRoot("classifier-stale-root");
                const store = openFileSessionStore();
                try {
                    store.ensureRuntimeProject({ root });
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
            name: "missing Project root",
            expected: "project_root_unavailable",
            run: async () => {
                const root = await makeRoot("classifier-moved-root");
                const store = openFileSessionStore();
                try {
                    store.ensureRuntimeProject({ root });
                    await Deno.remove(root);
                    return {
                        result: await classifyRootSessionLocator({
                            cwd: root,
                            sessionId: "pi-5",
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

Deno.test("classifyRootSessionLocator silently catalogs Projects and legacy transcripts", async () => {
    const root = await makeRoot("classifier-automatic-root");
    const store = openFileSessionStore();
    try {
        assertEquals(
            await classifyRootSessionLocator({ cwd: root, ownerCoordinationStore: store }),
            { kind: "uncataloged", reason: "session_project_absent" },
        );
        const project = store.ensureRuntimeProject({ root });
        const sessionPath = await writeTranscript(root, "legacy-pi");
        const result = await classifyRootSessionLocator({
            cwd: root,
            sessionId: "legacy-pi",
            sessionPath,
            ownerCoordinationStore: store,
        });
        assertEquals(result.kind, "managed");
        assertEquals(result.project?.projectId, project.projectId);
        assertEquals(result.session?.piSessionId, "legacy-pi");
    } finally {
        store.close();
    }
});

Deno.test("classifyRootSessionLocator blocks only when no Session store was composed", async () => {
    const root = await makeRoot("classifier-no-store-root");
    const result = await classifyRootSessionLocator({ cwd: root, ownerCoordinationStore: null });
    assertEquals(result.kind, "blocked");
    assertEquals(result.reason, "session_store_unavailable");
});
