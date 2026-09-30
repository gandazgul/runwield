// Disposable real Workspace page handlers. This file is also the entry point of
// the standalone diagnostic executable. Do not import application modules until
// HOME and MNEMOTECA_DB_PATH have been set by the parent process.
import { join } from "@std/path";

interface Fixture {
    routes: Array<{ path: string; marker: string }>;
    request: (path: string, incoming?: Request) => Promise<Response>;
    close: () => Promise<void>;
}

const token = "memory-fixture-token";
const rssLimit = 1024 * 1024 * 1024;
const started = performance.now();
let responses = 0;

function guard(): void {
    if (Deno.memoryUsage().rss >= rssLimit) throw new Error("INCOMPLETE: 1 GiB RSS guard reached");
    if (performance.now() - started > 180_000) throw new Error("INCOMPLETE: fixture timeout (180 seconds)");
}

export async function createRendererFixture(root: string, origin: string): Promise<Fixture> {
    const { savePlan } = await import("../src/plan-store.js");
    const { openOwnerCoordinationStore } = await import("../src/shared/owner-coordination/index.js");
    const { createOwnerWorkspaceApp, createWorkspaceApp, createReviewWorkspaceApp, createSessionQuestionWorkspaceApp } =
        await import("../src/ui/workspace/server.js");
    const { createWorkRecordMnemotecaFixture } = await import(
        "../src/shared/work-records/test-fixtures/mnemoteca-port.ts"
    );
    const projects = [join(root, "project-a"), join(root, "project-b")];
    for (const [index, project] of projects.entries()) {
        await Deno.mkdir(project, { recursive: true });
        if (index === 0) await Deno.writeTextFile(join(project, "a"), "Memory code review marker\n");
        await savePlan(
            project,
            `fixture-${index}`,
            `# Fixture Plan ${index}\n\n## Context\n\nMemory plan body ${index}`,
            {
                planId: `fixture-id-${index}`,
                classification: "FEATURE",
                status: "draft",
                summary: `Memory plan body ${index}`,
            },
        );
    }
    await savePlan(projects[0], "fixture-1", "# Fixture Plan 1\n\n## Context\n\nMemory plan body 1", {
        planId: "fixture-id-1",
        classification: "FEATURE",
        status: "draft",
        summary: "Memory plan body 1",
    });
    const store = openOwnerCoordinationStore({
        dbPath: join(root, "owner.sqlite3"),
        sessionBaseDir: join(root, "sessions"),
    });
    const pairing = store.createPairingRequest({ codeFactory: () => "MEM123", proofFactory: () => "memory-proof" });
    store.approvePairingRequest(pairing.code);
    const claimed = store.claimPairingRequest(pairing.proof, {
        credentialFactory: () => "memory-credential",
        csrfFactory: () => "memory-csrf",
    });
    const ids = projects.map((project, index) =>
        store.registerProject({ root: project, displayName: `Memory Project ${index}` }).projectId
    );
    const { writeBareSessionTranscript } = await import("../src/testing/bare-session-transcript-fixture.ts");
    const runtimeProject = store.ensureRuntimeProject({ root: projects[0] });
    const sessionIds: string[] = [];
    for (let index = 0; index < 2; index++) {
        const piSessionId = `memory-session-${index}`;
        const timestamp = `2026-01-0${index + 1}T00:00:00.000Z`;
        const transcriptPath = await writeBareSessionTranscript(
            join(root, "sessions"),
            projects[0],
            piSessionId,
            timestamp,
        );
        const session = await store.ensureSessionCatalogRecord({
            projectId: runtimeProject.projectId,
            piSessionId,
            transcriptPath,
            transcriptCwd: projects[0],
            source: "created",
        });
        sessionIds.push(session.runwieldSessionId);
    }
    const owner = createOwnerWorkspaceApp({ mode: "owner", publicOrigin: origin, store });
    const local = createWorkspaceApp({ cwd: projects[0], token, mnemotecaPort: createWorkRecordMnemotecaFixture() });
    const reviews = ["plan", "code"].map((reviewType) =>
        createReviewWorkspaceApp({
            cwd: projects[0],
            token,
            reviewConversation: undefined,
            reviewType: reviewType === "code" ? "code" as const : "plan" as const,
            reviewPayload: reviewType === "code"
                ? { rawPatch: "diff --git a/a b/a\n+Memory code review marker", title: "Memory code review marker" }
                : { plan: "# Memory plan review marker", planPath: "docs/plans/fixture.md" },
        })
    );
    const question = createSessionQuestionWorkspaceApp({
        cwd: projects[0],
        token,
        questionPayload: { prompt: "Memory question marker", mode: "select" },
        answerQuestion: () => new Response("No model requests in fixture", { status: 403 }),
    });
    const routes = [
        ...ids.flatMap((id, index) => [
            { path: `/fixture/owner/projects/${id}/plans`, marker: `Memory plan body ${index}` },
            { path: `/fixture/owner/projects/${id}/sessions`, marker: "Project Sessions" },
        ]),
        ...sessionIds.map((id) => ({
            path: `/fixture/owner/projects/${ids[0]}/sessions/${id}`,
            marker: "Project Session",
        })),
        { path: `/fixture/local/plans/fixture-id-0`, marker: "Memory plan body 0" },
        { path: `/fixture/local/plans/fixture-id-1`, marker: "Memory plan body 1" },
        { path: "/fixture/review/plan", marker: "Memory plan review marker" },
        { path: "/fixture/review/code", marker: "Memory code review marker" },
        { path: "/fixture/question/session-question", marker: "Memory question marker" },
    ];
    async function request(path: string, incoming?: Request): Promise<Response> {
        const match = /^\/fixture\/(owner|local|review|question)(\/.*)$/.exec(path);
        // Public assets are served by the real Workspace asset handler, with
        // the same unprefixed URLs that Astro emits in its rendered pages.
        if (
            !match &&
            /^\/(?:_astro\/[^/]+|brand\/logo\.svg|tokens\.css|components\.css|workspace\.css|theme\.css|styles\.css|workspace-shell\.js|design-system\/sidebar-motion\.js)$/
                .test(path)
        ) {
            return await local.handler()(new Request(`${origin}${path}`));
        }
        if (!match && (path === "/workspace.webmanifest" || path === "/workspace-pwa.js" || path.startsWith("/pwa/"))) {
            return await owner.handler()(new Request(`${origin}${path}`));
        }
        // Astro links are absolute and lose the fixture prefix on navigation.
        // Owner Project routes and local Plan routes have distinct path spaces;
        // use the referer for shared APIs and subsequent review/question requests.
        const referer = incoming?.headers.get("referer");
        const fromPath = referer ? new URL(referer).pathname : "";
        const from = /^\/fixture\/(owner|local|review|question)(\/.*)$/.exec(fromPath);
        const routeKind = (pathname: string): string | undefined => {
            if (pathname.startsWith("/api/owner/") || /^\/projects(?:\/|$)/.test(pathname)) return "owner";
            if (pathname.startsWith("/plans/") || pathname === "/closed" || pathname === "/on-hold") return "local";
            if (pathname.startsWith("/review/")) return "review";
            if (pathname === "/session-question") return "question";
        };
        const kind = match?.[1] ?? routeKind(path) ??
            (path.startsWith("/api/") || path === "/" ? from?.[1] ?? routeKind(fromPath) : undefined);
        if (!kind) return new Response("Fixture route not found", { status: 404 });
        const suffix = match?.[2] ?? path;
        const headers = new Headers(incoming?.headers);
        if (kind === "owner") headers.set("cookie", `rw_owner_device=${claimed.credential}; rw_owner_csrf=memory-csrf`);
        else headers.set("x-runwield-workspace-token", token);
        const targetPath = kind === "review" && match ? `/review${suffix}` : suffix;
        const query = incoming ? new URL(incoming.url).search : "";
        const url = `${origin}${targetPath}${query || (kind === "owner" ? "" : `?token=${token}`)}`;
        const req = new Request(url, {
            method: incoming?.method ?? "GET",
            headers,
            body: incoming && incoming.method !== "GET" && incoming.method !== "HEAD" ? incoming.body : undefined,
        });
        if (kind === "owner") return await owner.handler()(req);
        if (kind === "local") return await local.handler()(req);
        if (kind === "question") return await question.handler()(req);
        const reviewPage = targetPath.startsWith("/review/")
            ? targetPath
            : from?.[1] === "review"
            ? `/review${from[2]}`
            : fromPath;
        return await reviews[reviewPage === "/review/code" ? 1 : 0].handler()(req);
    }
    return {
        routes,
        request,
        close: async () => {
            // A diagnostic subprocess can exit even when background Workspace
            // observation tasks remain open. Never let cleanup mask samples.
            const close = Reflect.get(owner, "close");
            await Promise.race([
                Promise.all([
                    ...reviews.map((review) => review.cleanup()),
                    ...(typeof close === "function" ? [close()] : []),
                ]),
                new Promise((resolve) => setTimeout(resolve, 2000)),
            ]);
            store.close();
        },
    };
}

async function sample(label: string, forceGc: boolean): Promise<void> {
    if (forceGc) {
        const gc = Reflect.get(globalThis, "gc");
        if (typeof gc !== "function") throw new Error("INCOMPLETE: GC not exposed");
        for (let i = 0; i < 3; i++) {
            gc();
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
    }
    guard();
    console.log(
        JSON.stringify({
            type: "sample",
            label,
            ...Deno.memoryUsage(),
            responses,
            elapsedMs: Math.round(performance.now() - started),
            standalone: Deno.build.standalone,
        }),
    );
}

async function checkedRequest(f: Fixture, route: { path: string; marker: string }): Promise<void> {
    guard();
    const response = await f.request(route.path);
    const body = await response.text();
    responses++;
    if (response.status !== 200 || !body.includes(route.marker)) {
        throw new Error(
            `INCOMPLETE: ${route.path}: HTTP ${response.status}; marker ${route.marker}; body ${body.slice(0, 300)}`,
        );
    }
    guard();
}

async function main(): Promise<void> {
    const root = Deno.env.get("WLD_MEMORY_FIXTURE_ROOT");
    if (!root || !Deno.env.get("HOME")?.startsWith(root) || !Deno.env.get("MNEMOTECA_DB_PATH")?.startsWith(root)) {
        throw new Error("Fixture requires isolated HOME, MNEMOTECA_DB_PATH, and root");
    }
    let f: Fixture | undefined;
    try {
        if (Deno.args.includes("--serve")) {
            let origin = "";
            const ready = Promise.withResolvers<Fixture>();
            const server = Deno.serve({
                hostname: "127.0.0.1",
                port: 0,
                onListen({ port }) {
                    origin = `http://127.0.0.1:${port}`;
                },
            }, async (req) => {
                const current = await ready.promise;
                const url = new URL(req.url);
                if (url.pathname === "/__memory") {
                    return Response.json({
                        ...Deno.memoryUsage(),
                        responses,
                        elapsedMs: Math.round(performance.now() - started),
                    });
                }
                if (url.pathname === "/" && !req.headers.has("referer")) return Response.json(current.routes);
                const result = await current.request(url.pathname, req);
                responses++;
                guard();
                return result;
            });
            try {
                f = await createRendererFixture(root, origin);
                ready.resolve(f);
                console.log(JSON.stringify({ type: "listening", url: origin, routes: f.routes }));
                await server.finished;
            } catch (error) {
                ready.reject(error);
                await server.shutdown();
                throw error;
            }
        } else {
            f = await createRendererFixture(root, "http://127.0.0.1");
            const forceGc = Deno.args.includes("--gc");
            for (const route of f.routes) await checkedRequest(f, route);
            await sample("baseline", forceGc);
            for (let batch = 1; batch <= 2; batch++) {
                for (let cycle = 0; cycle < 10; cycle++) {
                    for (const route of f.routes) await checkedRequest(f, route);
                }
                await sample(`batch-${batch}`, forceGc);
            }
        }
    } finally {
        if (f) await f.close();
    }
}

if (import.meta.main) {
    main().then(() => Deno.exit(0)).catch((error) => {
        console.error(error);
        Deno.exit(1);
    });
}
