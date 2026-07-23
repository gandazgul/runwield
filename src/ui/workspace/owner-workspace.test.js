import { assertEquals, assertStringIncludes } from "@std/assert";
import { savePlan } from "../../plan-store.js";
import { openOwnerCoordinationStore } from "../../shared/owner-coordination/index.js";
import { createOwnerWorkspaceApp } from "./server.js";

/** @param {string} credential @param {string} [csrf] */
function cookiePair(credential, csrf = "csrf-secret") {
    return `rw_owner_device=${encodeURIComponent(credential)}; rw_owner_csrf=${encodeURIComponent(csrf)}`;
}

Deno.test("owner Workspace redirects unpaired browsers and serves pairing code bootstrap", async () => {
    const dir = await Deno.makeTempDir({ prefix: "runwield-owner-ui-" });
    const store = openOwnerCoordinationStore({ dbPath: `${dir}/owner.sqlite3` });
    try {
        const app = createOwnerWorkspaceApp({ mode: "owner", publicOrigin: "http://127.0.0.1:8787", store }).handler();
        const redirect = await app(new Request("http://127.0.0.1:8787/"));
        assertEquals(redirect.status, 302);
        assertEquals(redirect.headers.get("location"), "/pair");
        const css = await app(new Request("http://127.0.0.1:8787/workspace.css"));
        assertEquals(css.status, 200);
        assertStringIncludes(css.headers.get("content-type") || "", "text/css");

        const wrongHost = await app(new Request("http://127.0.0.1:8788/workspace.css"));
        assertEquals(wrongHost.status, 403);

        const request = await app(
            new Request("http://127.0.0.1:8787/api/owner/pairing/request", {
                method: "POST",
                headers: { origin: "http://127.0.0.1:8787", "content-type": "application/json" },
                body: JSON.stringify({ deviceLabel: "Phone" }),
            }),
        );
        assertEquals(request.status, 201);
        assertStringIncludes(request.headers.get("set-cookie") || "", "rw_pairing_proof=");
        const body = await request.json();
        assertEquals(body.state, "pending");
        assertEquals(/^[A-Z2-9]{6}$/.test(body.code), true);

        let rateLimited = request;
        for (let index = 0; index < 4; index += 1) {
            rateLimited = await app(
                new Request("http://127.0.0.1:8787/api/owner/pairing/request", {
                    method: "POST",
                    headers: {
                        origin: "http://127.0.0.1:8787",
                        "content-type": "application/json",
                        "x-forwarded-for": `198.51.100.${index}`,
                    },
                    body: JSON.stringify({ deviceLabel: `Phone ${index}` }),
                }),
            );
        }
        assertEquals(rateLimited.status, 429);
    } finally {
        store.close();
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test("owner Workspace requires CSRF for Project mutation and resolves Project Plan Board by registered Project", async () => {
    const dir = await Deno.makeTempDir({ prefix: "runwield-owner-project-" });
    const projectRoot = `${dir}/project`;
    await Deno.mkdir(projectRoot);
    await savePlan(projectRoot, "owner-plan", "# Owner Plan\n\nBody", {
        planId: "owner-plan-id",
        classification: "FEATURE",
        complexity: "LOW",
        summary: "Visible owner plan",
        status: "draft",
    });
    await savePlan(projectRoot, "held-plan", "# Held Plan\n\nBody", {
        planId: "held-plan-id",
        classification: "FEATURE",
        complexity: "LOW",
        summary: "Visible held plan",
        status: "on_hold",
    });
    const store = openOwnerCoordinationStore({ dbPath: `${dir}/owner.sqlite3` });
    try {
        const pairing = store.createPairingRequest({
            codeFactory: () => "OWN123",
            proofFactory: () => "proof",
        });
        store.approvePairingRequest(pairing.code);
        const claimed = store.claimPairingRequest(pairing.proof, {
            credentialFactory: () => "credential-secret",
            csrfFactory: () => "csrf-secret",
        });
        const project = store.registerProject({ root: projectRoot, displayName: "Owner Project" });
        let closedConnections = 0;
        const appObject = /** @type {any} */ (createOwnerWorkspaceApp({
            mode: "owner",
            publicOrigin: "http://127.0.0.1:8787",
            store,
        }));
        appObject.ownerConnections.register(claimed.deviceId, { close: () => closedConnections += 1 });
        const app = appObject.handler();

        const rejected = await app(
            new Request("http://127.0.0.1:8787/api/owner/projects", {
                method: "POST",
                headers: { origin: "http://127.0.0.1:8787", cookie: cookiePair(claimed.credential) },
                body: JSON.stringify({ root: projectRoot }),
            }),
        );
        assertEquals(rejected.status, 403);

        const page = await app(
            new Request(`http://127.0.0.1:8787/projects/${project.projectId}/plans`, {
                headers: { cookie: cookiePair(claimed.credential) },
            }),
        );
        assertEquals(page.status, 200);
        const html = await page.text();
        assertStringIncludes(html, "Project Plan Board");
        assertStringIncludes(html, "Visible owner plan");
        assertStringIncludes(html, "read-only");
        assertStringIncludes(html, "lifecycle moves and edits are disabled");
        assertEquals(html.includes("Drag this Plan Card"), false);

        const tokenizedPage = await app(
            new Request(`http://127.0.0.1:8787/projects/${project.projectId}/plans?token=ephemeral&q=owner`, {
                headers: { cookie: cookiePair(claimed.credential) },
            }),
        );
        assertEquals(tokenizedPage.status, 200);
        const tokenizedHtml = await tokenizedPage.text();
        assertStringIncludes(tokenizedHtml, "q=owner");
        assertEquals(/href=\"[^\"]*token=ephemeral/.test(tokenizedHtml), false);

        const onHoldPage = await app(
            new Request(`http://127.0.0.1:8787/projects/${project.projectId}/plans/on-hold`, {
                headers: { cookie: cookiePair(claimed.credential) },
            }),
        );
        assertEquals(onHoldPage.status, 200);
        assertStringIncludes(await onHoldPage.text(), "Visible held plan");

        const boardApi = await app(
            new Request(`http://127.0.0.1:8787/api/owner/projects/${project.projectId}/plans`, {
                headers: { cookie: cookiePair(claimed.credential) },
            }),
        );
        assertEquals(boardApi.status, 200);
        const boardJson = await boardApi.json();
        assertEquals(boardJson.readOnly, true);
        const boardText = JSON.stringify(boardJson);
        assertStringIncludes(boardText, "Visible owner plan");
        assertEquals(boardText.includes("allowedManualTargetStatuses"), false);
        assertEquals(boardText.includes("allowedTargetStatuses"), false);

        const ownerPlanCard = boardJson.board.columns[0].cards[0];
        assertEquals(ownerPlanCard.actions, {});

        const mutationNotFound = await app(
            new Request(`http://127.0.0.1:8787/api/owner/projects/${project.projectId}/plans/owner-plan-id/body`, {
                method: "PUT",
                headers: {
                    origin: "http://127.0.0.1:8787",
                    cookie: cookiePair(claimed.credential),
                    "x-runwield-csrf": "csrf-secret",
                    "content-type": "application/json",
                },
                body: "{}",
            }),
        );
        assertEquals(mutationNotFound.status, 404);
        assertStringIncludes(mutationNotFound.headers.get("content-type") || "", "application/json");
        assertEquals((await mutationNotFound.json()).error, "Owner API route not found.");

        const onHoldBoardApi = await app(
            new Request(`http://127.0.0.1:8787/api/owner/projects/${project.projectId}/plans/view/on-hold`, {
                headers: { cookie: cookiePair(claimed.credential) },
            }),
        );
        assertEquals(onHoldBoardApi.status, 200);
        assertStringIncludes(JSON.stringify(await onHoldBoardApi.json()), "Visible held plan");

        const detailApi = await app(
            new Request(`http://127.0.0.1:8787/api/owner/projects/${project.projectId}/plans/owner-plan-id`, {
                headers: { cookie: cookiePair(claimed.credential) },
            }),
        );
        assertEquals(detailApi.status, 200);
        const detailJson = await detailApi.json();
        assertEquals(detailJson.plan.capabilities.bodyEditing, false);
        assertEquals(detailJson.plan.actions, {});
        const detailText = JSON.stringify(detailJson);
        assertStringIncludes(detailText, "Owner Plan");
        assertEquals(detailText.includes(projectRoot), false);

        const registeredApi = await app(
            new Request("http://127.0.0.1:8787/api/owner/projects", {
                method: "POST",
                headers: {
                    origin: "http://127.0.0.1:8787",
                    cookie: cookiePair(claimed.credential),
                    "x-runwield-csrf": "csrf-secret",
                    "content-type": "application/json",
                },
                body: JSON.stringify({ root: projectRoot, displayName: "Owner Project" }),
            }),
        );
        assertEquals(registeredApi.status, 201);
        const registeredText = JSON.stringify(await registeredApi.json());
        assertStringIncludes(registeredText, "rootLabel");
        assertEquals(registeredText.includes(projectRoot), false);

        const home = await app(
            new Request("http://127.0.0.1:8787/", { headers: { cookie: cookiePair(claimed.credential) } }),
        );
        const homeHtml = await home.text();
        assertStringIncludes(homeHtml, "Relink Project root");
        assertStringIncludes(homeHtml, "Full Session rescan");

        store.catalogProjectSessions = () =>
            Promise.resolve({
                cataloged: [],
                diagnostics: [{
                    code: "path_leak_regression",
                    sessionPath: `${projectRoot}/.runwield/sessions/session.json`,
                    message: `Transcript cwd ${projectRoot}/worktree does not match registered Project root`,
                    nested: { cwd: `${projectRoot}/nested` },
                }],
            });
        const rescan = await app(
            new Request(`http://127.0.0.1:8787/api/owner/projects/${project.projectId}/action`, {
                method: "POST",
                headers: {
                    origin: "http://127.0.0.1:8787",
                    cookie: cookiePair(claimed.credential),
                    "x-runwield-csrf": "csrf-secret",
                    "content-type": "application/json",
                },
                body: JSON.stringify({ action: "rescan" }),
            }),
        );
        assertEquals(rescan.status, 200);
        const rescanText = JSON.stringify(await rescan.json());
        assertStringIncludes(rescanText, "[local path]");
        assertEquals(rescanText.includes(projectRoot), false);
        assertEquals(rescanText.includes("sessionPath"), false);
        assertEquals(rescanText.includes('"cwd"'), false);

        const badUpgradeOrigin = await app(
            new Request("http://127.0.0.1:8787/api/owner/future-socket", {
                headers: {
                    origin: "http://127.0.0.1:8788",
                    upgrade: "websocket",
                    cookie: cookiePair(claimed.credential),
                },
            }),
        );
        assertEquals(badUpgradeOrigin.status, 403);

        const allowedUpgrade = await app(
            new Request("http://127.0.0.1:8787/api/owner/future-socket", {
                headers: {
                    origin: "http://127.0.0.1:8787",
                    upgrade: "websocket",
                    cookie: cookiePair(claimed.credential),
                },
            }),
        );
        assertEquals(allowedUpgrade.status, 404);

        const revoked = await app(
            new Request(`http://127.0.0.1:8787/api/owner/devices/${claimed.deviceId}/revoke`, {
                method: "POST",
                headers: {
                    origin: "http://127.0.0.1:8787",
                    cookie: cookiePair(claimed.credential),
                    "x-runwield-csrf": "csrf-secret",
                },
                body: "{}",
            }),
        );
        assertEquals(revoked.status, 200);
        assertEquals(closedConnections, 1);
    } finally {
        store.close();
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test("owner Workspace rejects Shared Space bearer capabilities on owner APIs", async () => {
    const dir = await Deno.makeTempDir({ prefix: "runwield-owner-isolation-" });
    const store = openOwnerCoordinationStore({ dbPath: `${dir}/owner.sqlite3` });
    try {
        const app = createOwnerWorkspaceApp({ mode: "owner", publicOrigin: "http://127.0.0.1:8787", store }).handler();
        const response = await app(
            new Request("http://127.0.0.1:8787/api/owner/projects", {
                headers: { authorization: "Bearer shared-space-capability" },
            }),
        );
        assertEquals(response.status, 401);
    } finally {
        store.close();
        await Deno.remove(dir, { recursive: true });
    }
});
