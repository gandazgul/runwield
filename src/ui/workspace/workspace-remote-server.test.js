// deno-lint-ignore-file no-unused-vars
import { assertEquals, assertStringIncludes } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadPlanBodyById, savePlan } from "../../plan-store.js";
import { PLAN_UI_TOKEN_HEADER } from "../../constants.js";
import {
    applyWorkspaceLifecycleActionInMemory,
    buildBoardGroups,
    buildWorkspaceBoard,
    loadBoard,
    loadPlanSummaries,
    loadWorkspaceDetail,
    runWorkspaceResumeCheck,
    serializePlanSummary,
    workspaceMetadata as _workspaceMetadata,
} from "./server/plan-adapter.js";
import { buildPlanBoardSearchIndex, PlanBoard } from "./components/Board.jsx";
import { PlanBoardToolbar } from "./components/PlanBoardToolbar.jsx";
import { renderMarkdown } from "./components/MarkdownView.jsx";
import { PlanDetail } from "./components/PlanDetail.jsx";
import { detailHref, workspaceHref } from "./components/PlanCard.jsx";
import { draftRecoveryState, planBodyDraftKey, restoredDraftExpectedBodyHash } from "./islands/PlanBodyEditor.jsx";
import { blockedDropMessage, isAllowedDropTarget, parseAllowedTargetStatuses } from "./islands/PlanBoardDragDrop.jsx";
import { matchingPlanIds, normalizePlanSearchQuery, PLAN_SEARCH_QUERY_PARAM } from "./islands/PlanBoardSearch.jsx";
import {
    createCloseWithoutVerificationIntent,
    createMoveStatusIntent,
    createPutOnHoldIntent,
    lifecycleActionLabel,
} from "./islands/PlanLifecycleActions.jsx";
import {
    main as runRemoteServerMain,
    parseMaxRequestBytes,
    parsePort,
    parseRetentionDays,
    readRemoteServerConfig,
} from "./remote-server.js";
import { handleRemoteSpaceApi } from "./server/remote-dev-api.js";
import { isRemoteDevelopmentModeEnabled } from "./server/remote-mode.js";
import { renderRunWieldThemeCss } from "../design-system/theme-bridge.js";
import {
    createReviewWorkspaceApp,
    createWorkspaceApp,
    hasWorkspaceToken,
    startReviewWorkspaceServer,
} from "./server.js";
import { COLLABORATION_STATE_REMOTE_CANONICAL } from "../../shared/collaboration/lock.js";
import { createReviewAgentState, reviewAgentApi } from "./routes/api/review-agent-handlers.js";
import { hashCapability } from "../../shared/collaboration/capabilities.js";
import { openRemoteDatabase } from "./server/remote-db.js";
import { createRemoteWorkspaceAdapter } from "./server/remote-adapter.js";
import { REMOTE_SCHEMA_V1_SQL } from "./server/remote-schema.js";
import { registerReviewDecisionPromise, unregisterReviewDecision } from "./routes/api/review-handlers.js";
import {
    buildRemoteCommentPayload,
    normalizeRemoteCommentPayload,
    remoteCommentToPlannotatorAnnotation,
} from "./react/remote-review-payload.js";
import { RemoteCommentStateList } from "./react/RemoteCommentStateList.jsx";

/**
 * @param {Record<string, string | undefined>} values
 * @returns {Deno.Env}
 */
function createTestEnv(values) {
    return {
        get(key) {
            return values[key];
        },
        set(key, value) {
            values[key] = value;
        },
        delete(key) {
            delete values[key];
        },
        has(key) {
            return values[key] !== undefined;
        },
        toObject() {
            /** @type {Record<string, string>} */
            const result = {};
            for (const [key, value] of Object.entries(values)) {
                if (value !== undefined) result[key] = value;
            }
            return result;
        },
    };
}

/**
 * @param {Request} request
 * @returns {import("astro").APIContext}
 */
function createTestApiContext(request) {
    return /** @type {import("astro").APIContext} */ ({ request });
}

/**
 * @param {string} cwd
 * @param {string[]} args
 */
async function git(cwd, args) {
    const command = new Deno.Command("git", { args, cwd, stdout: "piped", stderr: "piped" });
    const output = await command.output();
    if (!output.success) {
        const decoder = new TextDecoder();
        throw new Error(decoder.decode(output.stderr) || decoder.decode(output.stdout));
    }
    return new TextDecoder().decode(output.stdout);
}

Deno.test("remote Shared Space development gate requires both development and remote mode", () => {
    assertEquals(isRemoteDevelopmentModeEnabled({ isDevelopment: true, workspaceMode: "remote" }), true);
    assertEquals(isRemoteDevelopmentModeEnabled({ isDevelopment: true, workspaceMode: "local" }), false);
    assertEquals(isRemoteDevelopmentModeEnabled({ isDevelopment: true, workspaceMode: undefined }), false);
    assertEquals(isRemoteDevelopmentModeEnabled({ isDevelopment: false, workspaceMode: "remote" }), false);
});

Deno.test("remote development API and page share the central gate", async () => {
    const apiSource = await Deno.readTextFile("src/ui/workspace/server/remote-dev-api.js");
    const pageSource = await Deno.readTextFile("src/ui/workspace/pages/p/[spaceId].astro");
    assertStringIncludes(apiSource, "isRemoteDevelopmentModeEnabled");
    assertStringIncludes(pageSource, "isRemoteDevelopmentModeEnabled");
});

Deno.test("remote development API rejects non-development and non-remote requests", async () => {
    const originalMode = Deno.env.get("RUNWIELD_WORKSPACE_MODE");
    try {
        Deno.env.set("RUNWIELD_WORKSPACE_MODE", "remote");
        const nonDevelopment = await handleRemoteSpaceApi(
            createTestApiContext(new Request("http://localhost/api/spaces")),
        );
        assertEquals(nonDevelopment.status, 404);
        assertEquals(await nonDevelopment.json(), { error: "Not found" });

        Deno.env.set("RUNWIELD_WORKSPACE_MODE", "local");
        const nonRemote = await handleRemoteSpaceApi(createTestApiContext(new Request("http://localhost/api/spaces")));
        assertEquals(nonRemote.status, 404);
        assertEquals(await nonRemote.json(), { error: "Not found" });
    } finally {
        if (originalMode === undefined) Deno.env.delete("RUNWIELD_WORKSPACE_MODE");
        else Deno.env.set("RUNWIELD_WORKSPACE_MODE", originalMode);
    }
});

Deno.test("remote Shared Space review route is isolated to remote mode", async () => {
    const localApp = createWorkspaceApp({ cwd: Deno.cwd(), token: "secret" }).handler();
    const localResponse = await localApp(new Request("http://localhost/p/space-1?token=secret"));
    assertEquals(localResponse.status, 404);

    const remoteApp = createWorkspaceApp({ mode: "remote" }).handler();
    const remoteResponse = await remoteApp(new Request("http://localhost/p/space-1"));
    assertEquals(remoteResponse.status === 200 || remoteResponse.status === 503, true);
});

Deno.test("remote Workspace health and readiness endpoints are remote-only and non-secret", async () => {
    const localApp = createWorkspaceApp({ cwd: Deno.cwd(), token: "secret" }).handler();
    assertEquals((await localApp(new Request("http://localhost/healthz?token=secret"))).status, 404);
    assertEquals((await localApp(new Request("http://localhost/readyz?token=secret"))).status, 404);

    const remoteApp = createWorkspaceApp({ mode: "remote" }).handler();
    const remoteResponse = await remoteApp(new Request("http://localhost/healthz"));
    assertEquals(remoteResponse.status, 200);
    assertEquals(remoteResponse.headers.get("cache-control"), "no-store");
    assertEquals(await remoteResponse.json(), { ok: true, mode: "remote" });

    const readyResponse = await remoteApp(new Request("http://localhost/readyz"));
    assertEquals(readyResponse.status, 200);
    assertEquals(await readyResponse.json(), { ok: true, mode: "remote" });
});

Deno.test("remote server entry reads env defaults and validates ports", () => {
    assertEquals(
        readRemoteServerConfig(createTestEnv({
            RUNWIELD_REMOTE_HOST: "127.0.0.1",
            RUNWIELD_REMOTE_PORT: "9001",
            RUNWIELD_REMOTE_DB_PATH: "/tmp/runwield.sqlite",
            RUNWIELD_REMOTE_MAX_REQUEST_BYTES: "2048",
            RUNWIELD_REMOTE_RETENTION_DAYS: "7",
        })),
        {
            host: "127.0.0.1",
            port: 9001,
            dbPath: "/tmp/runwield.sqlite",
            maxRequestBytes: 2048,
            retentionDays: 7,
        },
    );
    assertEquals(parsePort(undefined), 8080);
    assertEquals(parsePort("65535"), 65535);
    assertEquals(parseMaxRequestBytes(undefined), 5 * 1024 * 1024);
    assertEquals(parseRetentionDays("0"), undefined);
});

Deno.test("remote server entry closes the owned adapter after server completion", async () => {
    let closed = 0;
    let startedWithAdapter = false;
    const cwd = await Deno.makeTempDir({ prefix: "runwield-remote-server-main-" });
    try {
        const env = createTestEnv({
            RUNWIELD_REMOTE_HOST: "127.0.0.1",
            RUNWIELD_REMOTE_PORT: "9002",
            RUNWIELD_REMOTE_DB_PATH: `${cwd}/test-remote-server.sqlite`,
        });
        await runRemoteServerMain({
            env,
            createRemoteWorkspaceAdapter: (options) => {
                const adapter = createRemoteWorkspaceAdapter(options);
                const close = adapter.close.bind(adapter);
                adapter.close = () => {
                    closed += 1;
                    close();
                };
                return adapter;
            },
            startWorkspaceServer: (options) => {
                startedWithAdapter = Boolean(options.adapter);
                const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, () => new Response("ok"));
                queueMicrotask(() => server.shutdown());
                return server;
            },
            log: () => {},
        });
        assertEquals(startedWithAdapter, true);
        assertEquals(closed, 1);
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("remote Shared Space review route SSR smoke keeps fragments out of rendered shell", async () => {
    const remoteApp = createWorkspaceApp({ mode: "remote" }).handler();
    const response = await remoteApp(new Request("http://localhost/p/smoke-space#key=secret-key&cap=secret-cap"));
    assertEquals(response.status === 200 || response.status === 503, true);
    if (response.status === 200) {
        const html = await response.text();
        assertStringIncludes(html, "Remote Plan Review");
        assertEquals(html.includes("secret-key"), false);
        assertEquals(html.includes("secret-cap"), false);
    }
});
