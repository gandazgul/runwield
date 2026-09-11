import { assertEquals, assertStringIncludes } from "@std/assert";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { savePlan } from "../../plan-store.js";
import { openOwnerCoordinationStore } from "../../shared/owner-coordination/index.js";
import { buildWorkflowPresentation } from "../../shared/workflow/workflow-presentation.ts";
import { createOwnerWorkspaceApp } from "./server.js";
import { ownerProjectSessionsApi, ownerSessionPlanWorkflowApi } from "./routes/owner-session-api.js";
import { latestLiveWorkflowInteraction } from "./islands/SessionSurface.jsx";
import { WorkflowSidebar } from "./react/WorkflowSidebar.tsx";
import { loadOwnerDashboard } from "./server/owner-dashboard.ts";

function cookiePair(credential: string, csrf = "csrf-secret"): string {
    return `rw_owner_device=${encodeURIComponent(credential)}; rw_owner_csrf=${encodeURIComponent(csrf)}`;
}

function daysAgo(days: number): string {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function pairedApp(dir: string) {
    const store = openOwnerCoordinationStore({ dbPath: `${dir}/owner.sqlite3` });
    const pairing = store.createPairingRequest({ codeFactory: () => "OWNV2A", proofFactory: () => "proof" });
    store.approvePairingRequest(pairing.code);
    store.claimPairingRequest(pairing.proof, {
        credentialFactory: () => "credential-secret",
        csrfFactory: () => "csrf-secret",
    });
    return {
        store,
        app: createOwnerWorkspaceApp({ mode: "owner", publicOrigin: "http://127.0.0.1:8787", store }).handler(),
    };
}

Deno.test("personal remote Workspace v2 Dashboard uses eligible completion evidence and Project caps", async () => {
    const dir = await Deno.makeTempDir({ prefix: "runwield-owner-dashboard-acceptance-" });
    const projectOne = `${dir}/one`;
    const projectTwo = `${dir}/two`;
    await Deno.mkdir(projectOne);
    await Deno.mkdir(projectTwo);
    for (let index = 0; index < 6; index += 1) {
        await savePlan(projectOne, `done-${index}`, `# Done ${index}\n`, {
            planId: `one-done-${index}`,
            classification: "FEATURE",
            status: "user_verified",
            userVerifiedAt: daysAgo(index),
        });
        await savePlan(projectTwo, `done-${index}`, `# Done ${index}\n`, {
            planId: `two-done-${index}`,
            classification: "FEATURE",
            status: "user_verified",
            userVerifiedAt: daysAgo(index),
        });
    }
    await savePlan(projectOne, "held", "# Held\n", {
        planId: "held-plan",
        classification: "FEATURE",
        status: "on_hold",
    });
    await savePlan(projectOne, "sequence", "# Sequence\n", {
        planId: "sequence-plan",
        classification: "PROJECT",
        type: "sequence",
        status: "ready_for_decomposition",
    });
    const { store, app } = pairedApp(dir);
    try {
        const registeredOne = store.registerProject({ root: projectOne, displayName: "One" });
        store.registerProject({ root: projectTwo, displayName: "Two" });
        const response = await app(
            new Request("http://127.0.0.1:8787/api/owner/dashboard", {
                headers: { cookie: cookiePair("credential-secret"), accept: "application/json" },
            }),
        );
        assertEquals(response.status, 200);
        const payload = await response.json();
        const recentlyFinished = payload.dashboard.sections.find((section: { key: string }) =>
            section.key === "recently-finished"
        ).items;
        assertEquals(recentlyFinished.length, 10);
        assertEquals(
            recentlyFinished.filter((item: { projectId: string }) => item.projectId === registeredOne.projectId).length,
            5,
        );
        assertEquals(JSON.stringify(payload.dashboard).includes("held-plan"), false);
        assertEquals(JSON.stringify(payload.dashboard).includes("sequence-plan"), false);
    } finally {
        store.close();
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test("personal remote Workspace v2 workflow presentation exposes connected actions without fabricated reviews", () => {
    const presentation = buildWorkflowPresentation({
        planName: "Feature Plan",
        classification: "PLANNED_CHANGE",
        status: "validated_ci",
        progressFacts: [{
            kind: "validation_checkpoint",
            phase: "semantic",
            state: "awaiting_repair",
            repairKind: "semantic",
        }],
        hasCodeReview: true,
    });
    assertEquals(presentation.currentStage?.id, "semantic");
    assertEquals(presentation.action?.kind, "review_code");
    assertEquals(presentation.connections.some((connection) => connection.kind === "repair_return"), true);

    const html = renderToStaticMarkup(createElement(WorkflowSidebar, { presentation }));
    assertEquals(html.indexOf("Repair is current.") < html.indexOf("Repair returns to AI review"), true);
    assertEquals(html.indexOf("Repair returns to AI review") < html.indexOf("Delivery has not started."), true);

    const missingLiveFacts = buildWorkflowPresentation({ planName: "Feature Plan" });
    assertEquals(missingLiveFacts.action?.kind, "open_plan");
});

Deno.test("personal remote Workspace v2 owner home has bounded refresh and visible failure handling", async () => {
    const dir = await Deno.makeTempDir({ prefix: "runwield-owner-refresh-acceptance-" });
    const { store, app } = pairedApp(dir);
    try {
        const response = await app(
            new Request("http://127.0.0.1:8787/", {
                headers: { cookie: cookiePair("credential-secret") },
            }),
        );
        const html = await response.text();
        assertStringIncludes(html, "dashboardRefreshInFlight");
        assertStringIncludes(html, "status.hidden = false");
    } finally {
        store.close();
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test("personal remote Workspace v2 Dashboard promotes associated live questions and keeps terminal Session history", async () => {
    const dir = await Deno.makeTempDir({ prefix: "runwield-owner-dashboard-live-" });
    const projectRoot = `${dir}/project`;
    await Deno.mkdir(projectRoot);
    await savePlan(projectRoot, "active", "# Active\n", {
        planId: "active-plan",
        classification: "FEATURE",
        status: "in_progress",
    });
    await savePlan(projectRoot, "done", "# Done\n", {
        planId: "done-plan",
        classification: "FEATURE",
        status: "user_verified",
        userVerifiedAt: new Date().toISOString(),
    });
    const store = {
        listProjects: () => [{ projectId: "project-1", displayName: "Project", lifecycle: "enabled" }],
        getProjectHealth: () => ({ status: "available", evidence: [] }),
        requireEnabledProjectRoot: () => projectRoot,
        listSessionPlanAssociations: (sessionId: string) =>
            sessionId === "question-session"
                ? [{ planId: "active-plan", committedGeneration: 1 }]
                : sessionId === "done-session"
                ? [{ planId: "done-plan", committedGeneration: 1 }]
                : [],
        inspectSessionActivation: () => ({ activation: { state: "active", ownerProcessKind: "workspace" } }),
    };
    const sessionContinuation = {
        operations: new Map([["op-1", {
            projectId: "project-1",
            runwieldSessionId: "question-session",
            status: "running",
            liveInteraction: { interactionId: "ask-1", request: { prompt: "Choose." } },
        }]]),
        listSessions: () =>
            Promise.resolve({
                sessions: [
                    { runwieldSessionId: "question-session", displayName: "Question", state: "active" },
                    { runwieldSessionId: "done-session", displayName: "Done Session", state: "idle" },
                ],
                hasNext: false,
                diagnostics: [],
            }),
    };
    try {
        const payload = await loadOwnerDashboard(store, sessionContinuation);
        const needsYou = payload.dashboard.sections.find((section: { key: string }) =>
            section.key === "needs-you"
        ).items;
        assertEquals(needsYou.some((item: { planId: string }) => item.planId === "active-plan"), true);
        assertEquals(
            payload.projects[0].sessions.some((session: { runwieldSessionId: string }) =>
                session.runwieldSessionId === "done-session"
            ),
            true,
        );
        assertEquals(
            payload.projects[0].sessions.some((session: { runwieldSessionId: string }) =>
                session.runwieldSessionId === "question-session"
            ),
            false,
        );
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test("personal remote Workspace v2 Plan home keeps document rendering ahead of workflow reads", async () => {
    const route = await Deno.readTextFile(
        new URL("./pages/projects/[projectId]/plans/[planId].astro", import.meta.url),
    );
    assertEquals(route.includes("await loadOwnerPlanProgress"), false);
    assertEquals(route.includes("discoverProvenSessionId"), false);
    assertEquals(route.includes("listSessions(projectId"), false);
    assertStringIncludes(route, "progressApiUrl");
    assertStringIncludes(route, "expectedGeneration");
});

Deno.test("personal remote Workspace v2 Dashboard uses live evidence for active work and retained completion proof", async () => {
    const dir = await Deno.makeTempDir({ prefix: "runwield-owner-dashboard-evidence-" });
    const projectRoot = `${dir}/project`;
    await Deno.mkdir(projectRoot);
    await savePlan(projectRoot, "inactive", "# Inactive\n", {
        planId: "inactive-plan",
        classification: "FEATURE",
        status: "in_progress",
    });
    await savePlan(projectRoot, "published", "# Published\n", {
        planId: "published-plan",
        classification: "FEATURE",
        status: "validated",
        verifiedAt: new Date().toISOString(),
    });
    const store = {
        listProjects: () => [{ projectId: "project-1", displayName: "Project", lifecycle: "enabled" }],
        getProjectHealth: () => ({ status: "available", evidence: [] }),
        requireEnabledProjectRoot: () => projectRoot,
        listSessionPlanAssociations: () => [],
        inspectSessionActivation: () => ({ activation: { state: "idle" } }),
    };
    const sessionContinuation = {
        operations: new Map(),
        listSessions: () => Promise.resolve({ sessions: [], hasNext: false, diagnostics: [] }),
    };
    try {
        const payload = await loadOwnerDashboard(store, sessionContinuation);
        const dashboardText = JSON.stringify(payload.dashboard);
        assertEquals(dashboardText.includes("inactive-plan"), false);
        const recentlyFinished = payload.dashboard.sections.find((section: { key: string }) =>
            section.key === "recently-finished"
        ).items;
        assertEquals(recentlyFinished.some((item: { planId: string }) => item.planId === "published-plan"), true);
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test("personal remote Workspace v2 Dashboard does not mark READY status ready when readiness evidence is broken", async () => {
    const dir = await Deno.makeTempDir({ prefix: "runwield-owner-dashboard-readiness-" });
    const projectRoot = `${dir}/project`;
    await Deno.mkdir(`${projectRoot}/.wld`, { recursive: true });
    await savePlan(projectRoot, "ready", "# Ready\n", {
        planId: "ready-plan",
        classification: "FEATURE",
        status: "ready_for_work",
    });
    await Deno.writeTextFile(`${projectRoot}/.wld/worktrees.json`, "{ broken");
    const store = {
        listProjects: () => [{ projectId: "project-1", displayName: "Project", lifecycle: "enabled" }],
        getProjectHealth: () => ({ status: "available", evidence: [] }),
        requireEnabledProjectRoot: () => projectRoot,
        listSessionPlanAssociations: () => [],
        inspectSessionActivation: () => ({ activation: { state: "idle" } }),
    };
    const sessionContinuation = {
        operations: new Map(),
        listSessions: () => Promise.resolve({ sessions: [], hasNext: false, diagnostics: [] }),
    };
    try {
        const payload = await loadOwnerDashboard(store, sessionContinuation);
        const readyItems = payload.dashboard.sections.find((section: { key: string }) => section.key === "ready").items;
        assertEquals(readyItems.some((item: { planId: string }) => item.planId === "ready-plan"), false);
        const needsYou = payload.dashboard.sections.find((section: { key: string }) =>
            section.key === "needs-you"
        ).items;
        assertEquals(needsYou.some((item: { type: string }) => item.type === "project"), true);
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test("personal remote Workspace v2 Session API filters committed Plan associations before pagination", async () => {
    const calls: number[] = [];
    const ctx = {
        params: { projectId: "project-1" },
        url: new URL("http://workspace.local/api/owner/projects/project-1/sessions?plan=target&page=0&pageSize=1"),
        state: {
            store: {
                requireEnabledProjectRoot: () => "/project",
                listSessionPlanAssociations: (sessionId: string) =>
                    sessionId === "late" ? [{ planId: "target", committedGeneration: 2 }] : [],
            },
            sessionContinuation: {
                listSessions: (_projectId: string, options: { page: number }) => {
                    calls.push(options.page);
                    return Promise.resolve({
                        sessions: options.page === 0
                            ? [{ runwieldSessionId: "first" }]
                            : [{ runwieldSessionId: "late" }],
                        hasNext: options.page === 0,
                        diagnostics: [],
                    });
                },
            },
        },
    };

    const response = await ownerProjectSessionsApi(ctx);
    const payload = await response.json();
    assertEquals(calls, [0, 1]);
    assertEquals(payload.total, 1);
    assertEquals(payload.sessions.map((session: { runwieldSessionId: string }) => session.runwieldSessionId), ["late"]);
});

Deno.test("personal remote Workspace v2 standalone Session expansion excludes only rendered Plan associations", async () => {
    const ctx = {
        params: { projectId: "project-1" },
        url: new URL(
            "http://workspace.local/api/owner/projects/project-1/sessions?excludeAssociated=true&nestedPlan=active-plan",
        ),
        state: {
            store: {
                requireEnabledProjectRoot: () => "/project",
                listSessionPlanAssociations: (sessionId: string) =>
                    sessionId === "nested"
                        ? [{ planId: "active-plan", committedGeneration: 1 }]
                        : sessionId === "terminal"
                        ? [{ planId: "terminal-plan", committedGeneration: 1 }]
                        : [],
            },
            sessionContinuation: {
                listSessions: () =>
                    Promise.resolve({
                        sessions: [{ runwieldSessionId: "nested" }, { runwieldSessionId: "terminal" }, {
                            runwieldSessionId: "free",
                        }],
                        hasNext: false,
                        diagnostics: [],
                    }),
            },
        },
    };

    const response = await ownerProjectSessionsApi(ctx);
    const payload = await response.json();
    assertEquals(
        payload.sessions.map((session: { runwieldSessionId: string }) => session.runwieldSessionId),
        ["terminal", "free"],
    );
});

Deno.test("personal remote Workspace v2 standalone Session expansion keeps terminal-only associations when no Plans render", async () => {
    const ctx = {
        params: { projectId: "project-1" },
        url: new URL("http://workspace.local/api/owner/projects/project-1/sessions?excludeAssociated=true"),
        state: {
            store: {
                requireEnabledProjectRoot: () => "/project",
                listSessionPlanAssociations: (sessionId: string) =>
                    sessionId === "terminal" ? [{ planId: "terminal-plan", committedGeneration: 1 }] : [],
            },
            sessionContinuation: {
                listSessions: () =>
                    Promise.resolve({
                        sessions: [{ runwieldSessionId: "terminal" }, { runwieldSessionId: "free" }],
                        hasNext: false,
                        diagnostics: [],
                    }),
            },
        },
    };

    const response = await ownerProjectSessionsApi(ctx);
    const payload = await response.json();
    assertEquals(
        payload.sessions.map((session: { runwieldSessionId: string }) => session.runwieldSessionId),
        ["terminal", "free"],
    );
});

Deno.test("personal remote Workspace v2 Plan workflow API dispatches checked resume and reports result errors", async () => {
    const dir = await Deno.makeTempDir({ prefix: "runwield-owner-workflow-action-" });
    const projectRoot = `${dir}/project`;
    await Deno.mkdir(projectRoot, { recursive: true });
    await savePlan(projectRoot, "validate", "# Validate\n\nBody\n", {
        planId: "validate-plan",
        classification: "FEATURE",
        status: "implemented",
    });
    let received: Record<string, unknown> | null = null;
    const ctx = {
        req: new Request("http://workspace.local", {
            method: "POST",
            body: JSON.stringify({
                action: "recover",
                planId: "validate-plan",
                expectedGeneration: 4,
            }),
        }),
        params: { projectId: "project-1", runwieldSessionId: "session-1" },
        state: {
            store: { requireEnabledProjectRoot: () => projectRoot },
            sessionContinuation: {
                startPlanWorkflowHandoff: (options: Record<string, unknown>) => {
                    received = options;
                    return Promise.resolve({ error: "validation needs attention" });
                },
            },
        },
    };

    try {
        const response = await ownerSessionPlanWorkflowApi(ctx);
        const payload = await response.json();
        assertEquals(response.status, 409);
        assertEquals(payload.error, "validation needs attention");
        assertEquals(received?.action, "recover");
        assertEquals(received?.planName, "validate");
        assertStringIncludes(String(received?.planContent || ""), "# Validate");
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test("personal remote Workspace v2 live workflow evidence ignores historical interactions", () => {
    const live = latestLiveWorkflowInteraction([
        { kind: "code-review", interactionId: "old", source: "committed", reviewUrl: "/old" },
        { kind: "interaction", interactionId: "current", source: "transient" },
    ]);

    assertEquals(live?.interactionId, "current");
    assertEquals(
        latestLiveWorkflowInteraction([{ kind: "plan-review", interactionId: "old", source: "committed" }]),
        null,
    );
});
