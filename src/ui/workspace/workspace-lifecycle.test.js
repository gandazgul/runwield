import { assertEquals, assertStringIncludes } from "@std/assert";

import { loadPlanBodyById, savePlan } from "../../plan-store.js";
import { PLAN_UI_TOKEN_HEADER } from "../../constants.js";
import {
    applyWorkspaceLifecycleActionInMemory,
    loadWorkspaceDetail,
    runWorkspaceResumeCheck,
    serializePlanSummary,
    workspaceMetadata as _workspaceMetadata,
} from "./server/plan-adapter.js";

import { blockedDropMessage, isAllowedDropTarget, parseAllowedTargetStatuses } from "./islands/PlanBoardDragDrop.jsx";

import {
    createCloseWithoutVerificationIntent,
    createMoveStatusIntent,
    createPutOnHoldIntent,
    lifecycleActionLabel,
} from "./islands/PlanLifecycleActions.jsx";

import { createWorkspaceApp } from "./server.js";
import { COLLABORATION_STATE_REMOTE_CANONICAL } from "../../shared/collaboration/lock.js";

import { git } from "./workspace-test-helpers.js";

Deno.test("workspace lifecycle action metadata blocks protected status movement and exposes DnD seams", () => {
    const summary = serializePlanSummary({
        planId: "p1",
        planName: "plan",
        relativePath: "plans/plan.md",
        attrs: { planId: "p1", status: "draft", classification: "FEATURE" },
    });
    assertEquals(summary.actions.allowedManualTargetStatuses.includes("verified"), false);
    assertEquals(summary.actions.allowedManualTargetStatuses.includes("failed"), false);
    assertEquals(summary.actions.canPutOnHold, true);
    assertEquals(createMoveStatusIntent({ planId: "p1", fromStatus: "draft", toStatus: "approved" }), {
        planId: "p1",
        fromStatus: "draft",
        action: "move_status",
        targetStatus: "approved",
    });
    assertEquals(lifecycleActionLabel(summary.actions, "put_on_hold"), summary.actions.metadata.put_on_hold.label);
    assertEquals(createPutOnHoldIntent({ planId: "p1", fromStatus: "draft", holdReason: "" }), {
        planId: "p1",
        fromStatus: "draft",
        action: "put_on_hold",
        holdReason: "",
    });
    assertEquals(createPutOnHoldIntent({ planId: "p1", fromStatus: "draft", holdReason: null }), null);
    assertEquals(createCloseWithoutVerificationIntent({ planId: "p1", fromStatus: "draft", reason: " manual " }), {
        planId: "p1",
        fromStatus: "draft",
        action: "close_without_verification",
        closedWithoutVerificationReason: "manual",
    });
    assertEquals(createCloseWithoutVerificationIntent({ planId: "p1", fromStatus: "draft", reason: "" }), null);

    const allowed = parseAllowedTargetStatuses("feedback approved ready_for_work");
    assertEquals(
        isAllowedDropTarget({ fromStatus: "draft", targetStatus: "approved", allowedTargetStatuses: allowed }),
        true,
    );
    assertEquals(
        isAllowedDropTarget({ fromStatus: "draft", targetStatus: "draft", allowedTargetStatuses: allowed }),
        false,
    );
    assertEquals(
        isAllowedDropTarget({ fromStatus: "draft", targetStatus: "verified", allowedTargetStatuses: allowed }),
        false,
    );
    assertEquals(
        blockedDropMessage({ planName: "p1", targetStatus: "verified", allowedTargetStatuses: allowed }),
        "p1 cannot move to verified. Available columns: feedback, approved, ready_for_work.",
    );
});

Deno.test("Workspace dev lifecycle projection uses core transitions without mutating its source Plan", () => {
    const summary = serializePlanSummary({
        planId: "memory-plan-id",
        planName: "memory-plan",
        relativePath: "plans/memory-plan.md",
        attrs: { planId: "memory-plan-id", status: "draft", classification: "FEATURE" },
    });
    const moved = applyWorkspaceLifecycleActionInMemory(summary, {
        action: "move_status",
        targetStatus: "approved",
    });

    assertEquals(summary.status, "draft");
    assertEquals(moved.plan.status, "approved");
    assertEquals(moved.plan.attrs.status, "approved");
    assertEquals(moved.plan.actions.allowedManualTargetStatuses.includes("draft"), true);
    assertEquals(moved.message, "Plan moved to Approved.");
});

Deno.test("Workspace Plan document loads Plannotator viewer and published markdown editor", async () => {
    const documentSource = await Deno.readTextFile(new URL("./react/WorkspacePlanDocument.tsx", import.meta.url));
    const editorSource = await Deno.readTextFile(new URL("./react/WorkspaceMarkdownEditor.tsx", import.meta.url));

    assertStringIncludes(documentSource, "@plannotator/ui/components/RenderedMarkdown.tsx");
    assertStringIncludes(editorSource, "node_modules/@plannotator/markdown-editor/dist/index.js");
    assertEquals(editorSource.includes("markdown-editor-shim"), false);
});

Deno.test("ArtifactReadSurface keeps the React read surface to Contents, notices, document, and Close", async () => {
    const surfaceSource = await Deno.readTextFile(new URL("./react/ArtifactReadSurface.tsx", import.meta.url));
    const pageSource = await Deno.readTextFile(new URL("./pages/review/plan.astro", import.meta.url));
    const cssSource = await Deno.readTextFile(new URL("./react/plannotator.css", import.meta.url));

    assertStringIncludes(pageSource, 'payload.surface === "artifact-read"');
    assertStringIncludes(pageSource, '<ArtifactReadSurface payload={payload} client:only="react" />');
    assertStringIncludes(surfaceSource, "Read-only {artifactLabel}");
    assertStringIncludes(surfaceSource, "aria-label={`${artifactLabel} notices`}");
    assertStringIncludes(surfaceSource, "{notices.map((notice) => <p key={notice}>{notice}</p>)}");
    assertStringIncludes(surfaceSource, 'className="rw-artifact-close-button"');
    assertStringIncludes(surfaceSource, 'activeTab="toc"');
    assertStringIncludes(surfaceSource, "showFilesTab={false}");
    assertStringIncludes(surfaceSource, "showVersionsTab={false}");
    assertStringIncludes(surfaceSource, "showArchiveTab={false}");
    assertStringIncludes(surfaceSource, "annotations={[]}");
    assertStringIncludes(surfaceSource, "<Viewer");
    assertStringIncludes(surfaceSource, "readOnly");
    assertStringIncludes(cssSource, '.rw-artifact-read-layout[data-sidebar-open="true"]');
    assertStringIncludes(cssSource, "@media (max-width: 980px)");
    assertStringIncludes(cssSource, ".rw-artifact-read .rw-plannotator-plan-layout > aside");
    assertEquals(surfaceSource.includes("Feedback"), false);
    assertEquals(surfaceSource.includes("Approve"), false);
    assertEquals(surfaceSource.includes("WorkspaceMarkdownEditor"), false);
});

Deno.test("Workspace lifecycle API mutates through lifecycle events and blocks invalid actions", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await savePlan(cwd, "feature", "# Feature", {
            planId: "feature-id",
            status: "draft",
            classification: "FEATURE",
        });
        await savePlan(cwd, "held", "# Held", {
            planId: "held-id",
            status: "on_hold",
            heldFromStatus: "in_progress",
            classification: "FEATURE",
        });
        const app = createWorkspaceApp({ cwd, token: "secret" }).handler();
        const missingToken = await app(
            new Request("http://localhost/api/plans/feature-id/lifecycle-action", {
                method: "POST",
                body: JSON.stringify({ action: "move_status", targetStatus: "approved" }),
            }),
        );
        assertEquals(missingToken.status, 401);

        const invalid = await app(
            new Request("http://localhost/api/plans/feature-id/lifecycle-action", {
                method: "POST",
                headers: { [PLAN_UI_TOKEN_HEADER]: "secret", "content-type": "application/json" },
                body: JSON.stringify({ action: "move_status", targetStatus: "verified" }),
            }),
        );
        assertEquals(invalid.status, 409);

        const moved = await app(
            new Request("http://localhost/api/plans/feature-id/lifecycle-action", {
                method: "POST",
                headers: { [PLAN_UI_TOKEN_HEADER]: "secret", "content-type": "application/json" },
                body: JSON.stringify({ action: "move_status", targetStatus: "approved" }),
            }),
        );
        assertEquals(moved.status, 200);
        assertEquals((await loadWorkspaceDetail(cwd, "feature-id")).status, "approved");

        const held = await app(
            new Request("http://localhost/api/plans/feature-id/lifecycle-action", {
                method: "POST",
                headers: { [PLAN_UI_TOKEN_HEADER]: "secret", "content-type": "application/json" },
                body: JSON.stringify({ action: "put_on_hold", holdReason: "pause" }),
            }),
        );
        assertEquals(held.status, 200);
        let loaded = await loadWorkspaceDetail(cwd, "feature-id");
        assertEquals(loaded.status, "on_hold");
        assertEquals(loaded.heldFromStatus, "approved");
        assertEquals(loaded.holdReason, "pause");

        const reset = await app(
            new Request("http://localhost/api/plans/feature-id/lifecycle-action", {
                method: "POST",
                headers: { [PLAN_UI_TOKEN_HEADER]: "secret", "content-type": "application/json" },
                body: JSON.stringify({ action: "reset_to_draft" }),
            }),
        );
        assertEquals(reset.status, 200);
        loaded = await loadWorkspaceDetail(cwd, "feature-id");
        assertEquals(loaded.status, "draft");
        assertEquals(loaded.heldFromStatus, "");

        const resumed = await app(
            new Request("http://localhost/api/plans/held-id/lifecycle-action", {
                method: "POST",
                headers: { [PLAN_UI_TOKEN_HEADER]: "secret", "content-type": "application/json" },
                body: JSON.stringify({ action: "resume_from_hold" }),
            }),
        );
        assertEquals(resumed.status, 200);
        assertEquals((await loadWorkspaceDetail(cwd, "held-id")).status, "in_progress");

        const blankClose = await app(
            new Request("http://localhost/api/plans/feature-id/lifecycle-action", {
                method: "POST",
                headers: { [PLAN_UI_TOKEN_HEADER]: "secret", "content-type": "application/json" },
                body: JSON.stringify({ action: "close_without_verification", closedWithoutVerificationReason: "  " }),
            }),
        );
        assertEquals(blankClose.status, 409);

        const closed = await app(
            new Request("http://localhost/api/plans/feature-id/lifecycle-action", {
                method: "POST",
                headers: { [PLAN_UI_TOKEN_HEADER]: "secret", "content-type": "application/json" },
                body: JSON.stringify({
                    action: "close_without_verification",
                    closedWithoutVerificationReason: "Verified manually in staging.",
                }),
            }),
        );
        assertEquals(closed.status, 200);
        loaded = await loadWorkspaceDetail(cwd, "feature-id");
        assertEquals(loaded.status, "closed_without_verification");
        assertEquals(loaded.closedWithoutVerificationReason, "Verified manually in staging.");
        assertEquals(loaded.frontMatter.verifiedAt, undefined);
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("Workspace persisted User Verification records attestation and triggers Work Record generation", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await savePlan(cwd, "feature", "# Feature", {
            planId: "feature-id",
            status: "implemented",
            classification: "FEATURE",
            failureReason: "Workflow Validation failed.",
        });
        /** @type {Array<{ cwd: string, planName: string, statusAtGeneration: string }>} */
        const calls = [];
        const app = createWorkspaceApp({
            cwd,
            token: "secret",
            autoGenerateWorkRecordForCompletedPlan: async ({ cwd: generationCwd, planName }) => {
                calls.push({
                    cwd: generationCwd,
                    planName,
                    statusAtGeneration: String((await loadWorkspaceDetail(generationCwd, "feature-id")).status),
                });
                return { status: "generated", planName, message: "Work Record generated: wr.md." };
            },
        }).handler();

        const blank = await app(
            new Request("http://localhost/api/plans/feature-id/lifecycle-action", {
                method: "POST",
                headers: { [PLAN_UI_TOKEN_HEADER]: "secret", "content-type": "application/json" },
                body: JSON.stringify({ action: "user_verify", userVerificationNote: "  " }),
            }),
        );
        assertEquals(blank.status, 409);

        const response = await app(
            new Request("http://localhost/api/plans/feature-id/lifecycle-action", {
                method: "POST",
                headers: { [PLAN_UI_TOKEN_HEADER]: "secret", "content-type": "application/json" },
                body: JSON.stringify({ action: "user_verify", userVerificationNote: "Checked in staging." }),
            }),
        );
        assertEquals(response.status, 200);
        const payload = await response.json();
        assertStringIncludes(payload.message, "RunWield Workflow Validation was not claimed");
        assertStringIncludes(payload.message, "Work Record generated");
        assertEquals(calls, [{ cwd, planName: "feature", statusAtGeneration: "user_verified" }]);
        const detail = await loadWorkspaceDetail(cwd, "feature-id");
        assertEquals(detail.status, "user_verified");
        assertEquals(detail.userVerificationNote, "Checked in staging.");
        assertEquals(detail.frontMatter.verifiedAt, undefined);
        assertEquals(detail.failureReason, "Workflow Validation failed.");
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("Workspace persisted close without verification triggers Work Record generation after closure", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await savePlan(cwd, "feature", "# Feature", {
            planId: "feature-id",
            status: "implemented",
            classification: "FEATURE",
        });
        /** @type {Array<{ cwd: string, planName: string, statusAtGeneration: string }>} */
        const calls = [];
        const app = createWorkspaceApp({
            cwd,
            token: "secret",
            autoGenerateWorkRecordForCompletedPlan: async ({ cwd: generationCwd, planName }) => {
                calls.push({
                    cwd: generationCwd,
                    planName,
                    statusAtGeneration: String((await loadWorkspaceDetail(generationCwd, "feature-id")).status),
                });
                return {
                    status: "generated",
                    planName,
                    message: "Work Record generated: docs/work-records/2026-01-01-feature.md.",
                };
            },
        }).handler();

        const response = await app(
            new Request("http://localhost/api/plans/feature-id/lifecycle-action", {
                method: "POST",
                headers: { [PLAN_UI_TOKEN_HEADER]: "secret", "content-type": "application/json" },
                body: JSON.stringify({
                    action: "close_without_verification",
                    closedWithoutVerificationReason: "Manual acceptance.",
                }),
            }),
        );
        assertEquals(response.status, 200);
        const payload = await response.json();
        assertStringIncludes(payload.message, "Work Record generated");
        assertEquals(calls, [{ cwd, planName: "feature", statusAtGeneration: "closed_without_verification" }]);
        const detail = await loadWorkspaceDetail(cwd, "feature-id");
        assertEquals(detail.status, "closed_without_verification");
        assertEquals(detail.closedWithoutVerificationReason, "Manual acceptance.");
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("Workspace persisted close preserves closure when Work Record generation fails", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await savePlan(cwd, "feature", "# Feature", {
            planId: "feature-id",
            status: "implemented",
            classification: "FEATURE",
        });
        const app = createWorkspaceApp({
            cwd,
            token: "secret",
            autoGenerateWorkRecordForCompletedPlan: () => Promise.reject(new Error("recorder unavailable")),
        }).handler();

        const response = await app(
            new Request("http://localhost/api/plans/feature-id/lifecycle-action", {
                method: "POST",
                headers: { [PLAN_UI_TOKEN_HEADER]: "secret", "content-type": "application/json" },
                body: JSON.stringify({
                    action: "close_without_verification",
                    closedWithoutVerificationReason: "Manual acceptance despite CI gap.",
                }),
            }),
        );
        assertEquals(response.status, 200);
        const payload = await response.json();
        assertStringIncludes(payload.message, "Work Record generation failed");
        assertStringIncludes(payload.message, "recorder unavailable");
        const detail = await loadWorkspaceDetail(cwd, "feature-id");
        assertEquals(detail.status, "closed_without_verification");
        assertEquals(detail.closedWithoutVerificationReason, "Manual acceptance despite CI gap.");
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("Workspace in-memory close preview is side-effect free", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        const summary = serializePlanSummary({
            planId: "preview-id",
            name: "preview",
            relativePath: "plans/preview.md",
            attrs: { planId: "preview-id", status: "implemented", classification: "FEATURE" },
        });
        const preview = applyWorkspaceLifecycleActionInMemory(summary, {
            action: "close_without_verification",
            closedWithoutVerificationReason: "Preview close.",
        });

        assertEquals(summary.status, "implemented");
        assertEquals(preview.plan.status, "closed_without_verification");
        let workRecordDirExists = true;
        try {
            await Deno.stat(`${cwd}/docs/work-records`);
        } catch (error) {
            workRecordDirExists = !(error instanceof Deno.errors.NotFound);
        }
        assertEquals(workRecordDirExists, false);
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("Workspace lifecycle API requires Resume Check confirmation for staleness warnings", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await savePlan(cwd, "held-warning", "# Held Warning", {
            planId: "held-warning-id",
            status: "on_hold",
            heldFromStatus: "ready_for_work",
            holdStalenessBaseline: "baseline",
            classification: "FEATURE",
        });
        const app = createWorkspaceApp({ cwd, token: "secret" }).handler();
        const warned = await app(
            new Request("http://localhost/api/plans/held-warning-id/lifecycle-action", {
                method: "POST",
                headers: { [PLAN_UI_TOKEN_HEADER]: "secret", "content-type": "application/json" },
                body: JSON.stringify({ action: "resume_from_hold" }),
            }),
        );
        assertEquals(warned.status, 409);
        const warningBody = await warned.json();
        assertEquals(warningBody.requiresConfirmation, true);

        const accepted = await app(
            new Request("http://localhost/api/plans/held-warning-id/lifecycle-action", {
                method: "POST",
                headers: { [PLAN_UI_TOKEN_HEADER]: "secret", "content-type": "application/json" },
                body: JSON.stringify({ action: "resume_from_hold", acceptResumeWarnings: true }),
            }),
        );
        assertEquals(accepted.status, 200);
        assertEquals((await loadWorkspaceDetail(cwd, "held-warning-id")).status, "ready_for_work");
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("Workspace Resume Check does not expose absolute worktree paths in blocked API responses", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        const missingWorktreePath = `${cwd}/missing-worktree`;
        await savePlan(cwd, "held-leak", "# Held Leak", {
            planId: "held-leak-id",
            status: "on_hold",
            heldFromStatus: "ready_for_work",
            worktreePath: missingWorktreePath,
            worktreeBranch: "missing-branch",
            classification: "FEATURE",
        });
        const app = createWorkspaceApp({ cwd, token: "secret" }).handler();
        const response = await app(
            new Request("http://localhost/api/plans/held-leak-id/lifecycle-action", {
                method: "POST",
                headers: { [PLAN_UI_TOKEN_HEADER]: "secret", "content-type": "application/json" },
                body: JSON.stringify({ action: "resume_from_hold" }),
            }),
        );
        assertEquals(response.status, 409);
        const bodyText = await response.text();
        assertEquals(bodyText.includes(cwd), false);
        assertEquals(bodyText.includes(missingWorktreePath), false);
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("Workspace Resume Check blocks resume when recorded branch cannot be determined", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await git(cwd, ["init", "-b", "main"]);
        await git(cwd, ["config", "user.email", "test@example.com"]);
        await git(cwd, ["config", "user.name", "Test User"]);
        await Deno.writeTextFile(`${cwd}/README.md`, "hello\n");
        await git(cwd, ["add", "README.md"]);
        await git(cwd, ["commit", "-m", "initial"]);
        const head = (await git(cwd, ["rev-parse", "HEAD"])).trim();
        await git(cwd, ["checkout", "--detach", head]);

        const resumeCheck = await runWorkspaceResumeCheck(cwd, {
            status: "on_hold",
            heldFromStatus: "ready_for_work",
            worktreePath: cwd,
            worktreeBranch: "main",
        });

        assertEquals(resumeCheck.ok, false);
        assertEquals(
            resumeCheck.failures.includes("Recorded worktree branch could not be determined for verification."),
            true,
        );
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("Workspace APIs return lock-aware 409 responses without mutating locked Plans", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await savePlan(cwd, "locked", "# Locked\n", {
            planId: "locked-api-id",
            status: "draft",
            classification: "FEATURE",
            collaborationState: COLLABORATION_STATE_REMOTE_CANONICAL,
            collaborationServerUrl: "https://plans.example.test",
            collaborationSpaceId: "space-1",
        });
        const loaded = await loadPlanBodyById(cwd, "locked-api-id");
        const before = await Deno.readTextFile(`${cwd}/plans/locked.md`);
        const app = createWorkspaceApp({ cwd, token: "secret" }).handler();

        const bodyEdit = await app(
            new Request("http://localhost/api/plans/locked-api-id/body", {
                method: "POST",
                headers: { [PLAN_UI_TOKEN_HEADER]: "secret", "content-type": "application/json" },
                body: JSON.stringify({ body: "# Changed\n", expectedBodyHash: loaded.bodyHash }),
            }),
        );
        assertEquals(bodyEdit.status, 409);
        const bodyPayload = await bodyEdit.json();
        assertStringIncludes(bodyPayload.error, "remote-canonical");
        assertStringIncludes(bodyPayload.repair, "wld plans pull");
        assertEquals(await Deno.readTextFile(`${cwd}/plans/locked.md`), before);

        const lifecycle = await app(
            new Request("http://localhost/api/plans/locked-api-id/lifecycle-action", {
                method: "POST",
                headers: { [PLAN_UI_TOKEN_HEADER]: "secret", "content-type": "application/json" },
                body: JSON.stringify({ action: "move_status", targetStatus: "approved" }),
            }),
        );
        assertEquals(lifecycle.status, 409);
        const lifecyclePayload = await lifecycle.json();
        assertStringIncludes(lifecyclePayload.blockedReason, "remote-canonical");
        assertStringIncludes(lifecyclePayload.repair, "wld plans pull");
        assertEquals(await Deno.readTextFile(`${cwd}/plans/locked.md`), before);
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});
