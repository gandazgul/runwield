import { assertEquals } from "@std/assert";
import { join } from "@std/path";
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

Deno.test("classifyRootSessionLocator blocks unresolved managed locators with typed reasons", async () => {
    const home = await makeRoot("classifier-home");
    const store = openOwnerCoordinationStore({ dbPath: join(home, "owner.sqlite3") });
    try {
        store.acknowledgeActivationProtocol({ now: () => "2026-01-01T00:00:00.000Z" });
        const currentRoot = await makeRoot("classifier-current");
        const project = store.registerProject({
            root: currentRoot,
            idFactory: idFactory("project"),
            now: () => "2026-01-01T00:00:01.000Z",
        });
        const nested = join(currentRoot, "nested");
        await Deno.mkdir(nested);
        const staleRoot = await makeRoot("classifier-stale");
        store.relinkProject({
            projectId: project.projectId,
            newRoot: staleRoot,
            idFactory: idFactory("relink"),
            now: () => "2026-01-01T00:00:02.000Z",
        });
        store.setProjectEnabled(project.projectId, false, { now: () => "2026-01-01T00:00:03.000Z" });

        const cases = [
            { name: "current registered root", cwd: staleRoot, sessionId: "pi-1" },
            { name: "historical registered root", cwd: currentRoot, sessionId: "pi-1" },
            { name: "nested working directory", cwd: nested, sessionId: "pi-1" },
            {
                name: "uncataloged transcript",
                cwd: staleRoot,
                sessionId: "pi-2",
                sessionPath: await writeTranscript(staleRoot, "pi-2"),
            },
            { name: "omitted sessionPath", cwd: staleRoot, sessionId: "pi-3" },
            {
                name: "stale sessionPath",
                cwd: staleRoot,
                sessionId: "pi-4",
                sessionPath: join(staleRoot, "missing.jsonl"),
            },
            {
                name: "locator conflict",
                cwd: staleRoot,
                sessionId: "pi-5",
                sessionPath: await writeTranscript(staleRoot, "pi-5"),
            },
            { name: "moved Project", cwd: currentRoot, sessionId: "pi-6" },
            { name: "disabled Project", cwd: staleRoot, sessionId: "pi-7" },
            { name: "missing activation row", cwd: staleRoot, sessionId: "pi-8" },
            { name: "protocol marker mismatch", cwd: staleRoot, sessionId: "pi-9" },
            { name: "replaced database epoch", cwd: staleRoot, sessionId: "pi-10" },
        ];
        for (const item of cases) {
            const result = await classifyRootSessionLocator({
                cwd: item.cwd,
                sessionId: item.sessionId,
                sessionPath: item.sessionPath,
                ownerCoordinationStore: store,
                allowCatalog: false,
            });
            assertEquals(result.kind, "blocked", item.name);
            assertEquals(typeof result.reason, "string", item.name);
            assertEquals(JSON.stringify(result).includes(staleRoot), false, item.name);
        }
    } finally {
        store.close();
    }
});

Deno.test("classifyRootSessionLocator proves unmanaged roots before legacy Pi behavior", async () => {
    const home = await makeRoot("classifier-unmanaged-home");
    const store = openOwnerCoordinationStore({ dbPath: join(home, "owner.sqlite3") });
    try {
        const unmanagedRoot = await makeRoot("classifier-unmanaged-root");
        const result = await classifyRootSessionLocator({ cwd: unmanagedRoot, ownerCoordinationStore: store });
        assertEquals(result.kind, "unmanaged_proven");
    } finally {
        store.close();
    }
});
