// @ts-nocheck: Deno test imports are checked by scripts/run-tests.js, not Astro check.
import { readWorkspaceStyles } from "./workspace-styles.ts";
import { assertEquals } from "@std/assert";
import {
    activePlanProgressApiUrl,
    draftRecoveryDecision,
    isAtLiveScrollEdge,
    mergeLiveSessionInfo,
    newSessionDraftInstanceStorageKey,
    reduceOperationTransientItems,
    serializeSessionImageForRequest,
    sessionAttachmentsKey,
    SessionComposer,
    sessionDraftKey,
    shouldApplyOperationPoll,
    shouldRefreshSessionAvailability,
} from "./islands/SessionSurface.jsx";
import { deriveSessionAvailability } from "./components/SessionActivationStatus.jsx";
import { buildWorkflowPresentation } from "../../shared/workflow/workflow-presentation.ts";
import {
    compactToolLine,
    displayAgentName,
    formatSessionTimelineTime,
    mergeSessionTimelineItems,
    reduceSessionEvents,
    sessionInteractionChoiceResponse,
    sessionInteractionTypedResponse,
    SessionTimeline,
} from "./components/SessionTimeline.jsx";

function RejectedImageDraftHarness({ createElement, useState, submissions }) {
    const [draft, setDraft] = useState("describe bad image");
    const [images, setImages] = useState([
        { id: "image-1", name: "bad.png", mimeType: "image/png", base64: btoa("bad") },
    ]);
    return createElement(SessionComposer, {
        id: "session-request-text",
        draft,
        disabled: false,
        canSend: draft.trim().length > 0 || images.length > 0,
        submitting: false,
        imageAttachments: images,
        onDraftChange: setDraft,
        onSubmit() {
            submissions.push({ text: draft, images: images.map((image) => image.name) });
            if (submissions.length === 1) return;
            setDraft("");
            setImages([]);
        },
        onRemoveImage(id) {
            setImages((current) => current.filter((image) => image.id !== id));
        },
    });
}

Deno.test("Session composer keeps provider/model identities and opens slash choices before the first message", async () => {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const props = {
        id: "new-session-request-text",
        draft: "",
        disabled: false,
        canSend: false,
        submitting: false,
        agents: [{ name: "guide", displayName: "Guide" }],
        agentValue: "guide",
        models: [{ provider: "openai-codex", id: "gpt-5.6-luna", name: "Luna" }],
        modelValue: "openai-codex\u001fgpt-5.6-luna",
        thinkingLevels: ["low"],
        thinkingValue: "low",
        commands: [{ name: "model", description: "Switch AI model", kind: "action" }],
        onDraftChange() {},
        onSubmit() {},
        onAgentChange() {},
        onModelChange() {},
        onThinkingChange() {},
    };
    const empty = renderToStaticMarkup(createElement(SessionComposer, props));
    assertEquals(empty.includes("openai-codex/gpt-5.6-luna</option>"), true);
    assertEquals(empty.match(/<select[^>]*disabled/g), null);
    assertEquals(empty.includes('aria-label="Attach image"'), true);
    assertEquals(empty.includes('title="Send"'), true);
    const commands = renderToStaticMarkup(createElement(SessionComposer, { ...props, draft: "/mo", canSend: true }));
    assertEquals(commands.includes('role="listbox" aria-label="Commands"'), true);
    assertEquals(commands.includes('aria-expanded="false"'), true);
    assertEquals(commands.includes('aria-activedescendant="new-session-request-text-commands-0"'), true);
    assertEquals(commands.includes("<strong>/model</strong>"), true);
    const models = renderToStaticMarkup(
        createElement(SessionComposer, { ...props, draft: "/model luna", canSend: true }),
    );
    assertEquals(models.includes("<strong>openai-codex/gpt-5.6-luna</strong>"), true);
});

Deno.test("Session composer renders restored image draft previews ready for corrected send", async () => {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const html = renderToStaticMarkup(
        createElement(SessionComposer, {
            id: "session-request-text",
            draft: "  describe again  ",
            disabled: false,
            canSend: true,
            submitting: false,
            imageAttachments: [{ id: "image-1", name: "draft.png", mimeType: "image/png", base64: btoa("img") }],
            onDraftChange() {},
            onSubmit() {},
            onRemoveImage() {},
        }),
    );

    assertEquals(html.includes("  describe again  "), true);
    assertEquals(html.includes('aria-label="Attached images"'), true);
    assertEquals(html.includes("draft.png · image/png"), true);
    assertEquals(html.includes('aria-label="Send"'), true);
    assertEquals(html.includes('aria-label="Sending"'), false);
});

Deno.test("Session composer restores a rejected draft and sends the corrected image draft", async () => {
    const previousDocument = globalThis.document;
    const previousActFlag = globalThis.IS_REACT_ACT_ENVIRONMENT;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    globalThis.document = { getElementById: () => null };
    try {
        const { createElement, useState } = await import("react");
        const { act, create } = await import("react-test-renderer");
        const submissions = [];
        let renderer;
        await act(() => {
            renderer = create(createElement(RejectedImageDraftHarness, { createElement, useState, submissions }));
        });
        const form = () => renderer.root.findByType("form");
        const textarea = () => renderer.root.findByType("textarea");
        await act(() => {
            form().props.onSubmit({ preventDefault() {} });
        });
        assertEquals(textarea().props.value, "describe bad image");
        assertEquals(
            renderer.root.findAllByType("span").some((item) => item.children.join("").includes("bad.png")),
            true,
        );
        await act(() => {
            textarea().props.onChange({ currentTarget: { value: "describe good image", style: {}, scrollHeight: 32 } });
        });
        await act(() => {
            form().props.onSubmit({ preventDefault() {} });
        });
        assertEquals(submissions, [
            { text: "describe bad image", images: ["bad.png"] },
            { text: "describe good image", images: ["bad.png"] },
        ]);
        assertEquals(textarea().props.value, "");
    } finally {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
        if (previousActFlag === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT;
        else globalThis.IS_REACT_ACT_ENVIRONMENT = previousActFlag;
    }
});

Deno.test("Session surface preserves drafts and replaces a lost live wait with one interruption line", () => {
    assertEquals(sessionDraftKey("project-1", "session-1"), "runwield:owner:project:project-1:session:session-1:draft");
    assertEquals(
        newSessionDraftInstanceStorageKey("project-1"),
        "runwield:owner:project:project-1:session:new:draft-instance",
    );
    assertEquals(draftRecoveryDecision({ status: "unknown" }), "idle");
    assertEquals(
        shouldApplyOperationPoll({ cancelled: false, currentOperationId: "new", polledOperationId: "new" }),
        true,
    );
    assertEquals(
        shouldApplyOperationPoll({ cancelled: false, currentOperationId: "new", polledOperationId: "old" }),
        false,
    );
    assertEquals(
        shouldApplyOperationPoll({ cancelled: true, currentOperationId: "new", polledOperationId: "new" }),
        false,
    );
    const items = reduceOperationTransientItems([
        { type: "interaction_requested", interactionId: "wait-1", interactionType: "text", prompt: "Answer?" },
    ]);
    assertEquals(items.length, 0);
    const reviewItems = reduceSessionEvents([
        {
            type: "interaction_requested",
            interactionId: "review-1",
            interactionType: "plan_review",
            prompt: "Review plan",
            review: {
                planId: "feature-a",
                planName: "Feature A",
                classification: "PLANNED_CHANGE",
                expectedStatus: "draft",
            },
        },
    ]);
    assertEquals(reviewItems[0]?.kind, "plan-review");
    assertEquals(reviewItems[0]?.request?.planReview?.planName, "Feature A");
    const interrupted = reduceSessionEvents([
        { type: "system_status", eventId: "status-1", message: "The agent was interrupted. Ask it to continue." },
    ]);
    assertEquals(interrupted[0]?.text, "The agent was interrupted. Ask it to continue.");
});

Deno.test("file-locked Sessions wait for the active surface without offering takeover", () => {
    const availability = deriveSessionAvailability({
        state: "active",
        activeSurface: "tui",
        generation: 0,
    });
    assertEquals(availability.key, "active");
    assertEquals(
        availability.explanation,
        "Steer the agent or queue a follow-up.",
    );
});

Deno.test("Session timeline labels transitions without inventing an initial Agent", () => {
    const items = reduceSessionEvents([
        {
            type: "user_message",
            eventId: "opaque-1",
            messageId: "m1",
            text: "Plan",
            segmentOrdinal: 0,
            segmentKind: "planning",
        },
        {
            type: "assistant_text_delta",
            eventId: "opaque-2",
            messageId: "m2",
            delta: "Work",
            segmentOrdinal: 1,
            segmentKind: "execution",
        },
        {
            type: "assistant_text_delta",
            eventId: "opaque-3",
            messageId: "m3",
            delta: "Repair",
            segmentOrdinal: 2,
            segmentKind: "semantic_repair",
        },
        { type: "recovery_event", eventId: "recover-1", message: "Recovered stale action." },
        { type: "recovery_event", eventId: "recover-2", message: "Restarted validation." },
    ]);
    const systemEvents = items.filter((item) => item.kind === "system-event");
    assertEquals(systemEvents.map((item) => item.text), [
        "Plan Engineer",
        "Semantic Repair",
        "Recovered stale action.\nRestarted validation.",
    ]);
    assertEquals(systemEvents.at(-1)?.lines, ["Recovered stale action.", "Restarted validation."]);
    assertEquals(items.some((item) => String(item.text || "").includes("segment-id")), false);
});

Deno.test("Session interaction answers preserve Runtime outcome identity", () => {
    assertEquals(
        sessionInteractionChoiceResponse("select", {
            type: "select",
            options: [{ value: "router", label: "Router" }],
        }, { value: "router", label: "Router" }),
        { outcome: "selected", value: "router", valueLabel: "Router" },
    );
    assertEquals(
        sessionInteractionChoiceResponse("approval", {
            type: "approval",
            options: [{ value: "approve", label: "Approve", _meta: { accepted: true } }],
        }, { value: "approve", label: "Approve" }),
        { outcome: "accepted", value: "approve", valueLabel: "Approve" },
    );
    assertEquals(sessionInteractionTypedResponse("select", "custom answer", true), {
        outcome: "selected",
        value: "custom answer",
        valueLabel: "Other",
    });
    assertEquals(sessionInteractionTypedResponse("text", "typed answer", false), {
        outcome: "text",
        value: "typed answer",
    });
});

Deno.test("Session availability observes idle Sessions too, so TUI turns appear automatically", () => {
    assertEquals(shouldRefreshSessionAvailability({ mode: "detail", state: "active" }), true);
    assertEquals(
        shouldRefreshSessionAvailability({ mode: "detail", state: "active", localOperationActive: true }),
        false,
    );
    assertEquals(shouldRefreshSessionAvailability({ mode: "detail", state: "idle" }), true);
    assertEquals(
        shouldRefreshSessionAvailability({ mode: "detail", state: "idle", queuedMessageCount: 1 }),
        true,
    );
    assertEquals(shouldRefreshSessionAvailability({ mode: "new", state: "active" }), false);
});

Deno.test("Session availability refreshes when a busy page becomes active again", async () => {
    const surface = await Deno.readTextFile(new URL("./islands/SessionSurface.jsx", import.meta.url));
    assertEquals(surface.includes('globalThis.addEventListener("focus", refresh)'), true);
    assertEquals(surface.includes('document.addEventListener("visibilitychange", refreshWhenVisible)'), true);
});

Deno.test("busy Session messages remain sendable and render above the Workspace composer", async () => {
    const surface = await Deno.readTextFile(new URL("./islands/SessionSurface.jsx", import.meta.url));
    const continuation = await Deno.readTextFile(new URL("./server/session-continuation.js", import.meta.url));
    const css = await readWorkspaceStyles(new URL("./static/workspace.css", import.meta.url));
    assertEquals(surface.includes('["active", "workspace-running"].includes(availability.key)'), true);
    assertEquals(surface.includes("const [queuedMessages, setQueuedMessages] = useState"), true);
    assertEquals(surface.includes("setQueuedMessages((current) => ["), true);
    assertEquals(surface.includes('if (freshTimeline.state === "active" || operationRef.current)'), true);
    assertEquals(surface.includes("const queued = queuedMessages[0]"), true);
    assertEquals(surface.includes("queuedMessages={queuedMessages}"), true);
    assertEquals(surface.includes("timeline.queuedMessages"), false);
    assertEquals(continuation.includes("Keep the message queued in this browser"), true);
    assertEquals(surface.includes('className="session-composer-queue"'), true);
    assertEquals(surface.indexOf('className="session-composer-queue"') < surface.indexOf("<textarea"), true);
    assertEquals(css.includes(".session-composer-queue"), true);
});

Deno.test("Workspace new Session creation uses Workspace navigation instead of remounting the shell", async () => {
    const surface = await Deno.readTextFile(new URL("./islands/SessionSurface.jsx", import.meta.url));
    assertEquals(surface.includes("function workspaceNavigate"), true);
    assertEquals(
        surface.includes(
            "workspaceNavigate(\n                    `/projects/${encodeURIComponent(projectId)}/sessions/${",
        ),
        true,
    );
    assertEquals(
        surface.includes(
            "workspaceNavigate(\n                `/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(payload.runwieldSessionId)}`",
        ),
        true,
    );
    assertEquals(
        surface.includes(
            "globalThis.location.replace(\n                    `/projects/${encodeURIComponent(projectId)}/sessions/${",
        ),
        false,
    );
});

Deno.test("Workspace-owned Session operations use live updates instead of browser polling", async () => {
    const surface = await Deno.readTextFile(new URL("./islands/SessionSurface.jsx", import.meta.url));
    const server = await Deno.readTextFile(new URL("./server.js", import.meta.url));
    assertEquals(surface.includes("const freshTimeline = await loadTimeline();"), true);
    assertEquals(surface.includes("expectedGeneration: freshTimeline.generation"), true);
    assertEquals(surface.includes("pending-user:${envelope.requestId}"), true);
    assertEquals(surface.includes("resubmit explicitly when ready"), false);
    assertEquals(surface.includes("new EventSource("), true);
    assertEquals(
        surface.includes("/api/owner/session-operations/${encodeURIComponent(operation.operationId)}/stream"),
        true,
    );
    assertEquals(surface.includes("setOperationStreamFailed(true)"), true);
    assertEquals(surface.includes("/api/owner/session-operations/${encodeURIComponent(current.operationId)}"), true);
    assertEquals(surface.includes("Recover stale Session"), false);
    assertEquals(surface.includes("/force-recovery"), false);
    assertEquals(surface.includes("/plan-workflow"), true);
    assertEquals(server.includes("/api/owner/session-operations/:operationId/stream"), true);
});

Deno.test("Workspace Session UI uses the shared thinking dots loader", async () => {
    const surface = await Deno.readTextFile(new URL("./islands/SessionSurface.jsx", import.meta.url));
    const timeline = await Deno.readTextFile(new URL("./components/SessionTimeline.jsx", import.meta.url));
    const css = await Deno.readTextFile(new URL("../design-system/components.css", import.meta.url));
    const docs = await Deno.readTextFile(new URL("../../../docs/design-system.md", import.meta.url));
    assertEquals(surface.includes("RunWieldThinkingDots"), true);
    assertEquals(timeline.includes("RunWieldThinkingDots"), true);
    assertEquals(css.includes(".rw-thinking-dots"), true);
    assertEquals(docs.includes("Use `RunWieldThinkingDots`"), true);
});

Deno.test("Session timeline puts usage and stop time on the assistant block", () => {
    const completedAt = new Date(2026, 8, 1, 21, 56).toISOString();
    const items = reduceSessionEvents([
        { type: "user_message", eventId: "u1", messageId: "u1", text: "Do it", timestamp: "2026-09-01T01:54:00.000Z" },
        {
            type: "assistant_text_delta",
            eventId: "a1",
            messageId: "a1",
            delta: "Done.",
            agentName: "frontend-engineer",
            timestamp: "2026-09-01T01:55:00.000Z",
        },
        {
            type: "usage",
            eventId: "usage-1",
            messageId: "a1:usage",
            usage: { inputTokens: 1569, outputTokens: 74 },
            timestamp: completedAt,
        },
    ]);
    assertEquals(items.map((item) => item.kind), ["message", "message"]);
    assertEquals(displayAgentName(items[1]?.agentName), "Frontend Engineer");
    assertEquals(items[1]?.footerText, "Usage: 1569 in / 74 out tokens");
    assertEquals(items[1]?.completedTimestamp, completedAt);
    assertEquals(formatSessionTimelineTime(completedAt), "9:56pm");
});

Deno.test("Session timeline groups completed technical activity after agent content resumes", () => {
    const items = reduceSessionEvents([
        { type: "user_message", eventId: "u1", messageId: "u1", text: "Do it" },
        { type: "tool_start", eventId: "t1s", toolCallId: "t1", toolName: "read", title: "Read file" },
        { type: "tool_end", eventId: "t1e", toolCallId: "t1", toolName: "read", output: "src/app.js", isError: false },
        { type: "assistant_thinking_delta", eventId: "th1", messageId: "think-1", delta: "Checking" },
        { type: "assistant_thinking_end", eventId: "th2", messageId: "think-1" },
        { type: "assistant_text_delta", eventId: "a1", messageId: "a1", delta: "Done." },
    ]);
    assertEquals(items.map((item) => item.kind), ["message", "activity", "message"]);
    assertEquals(items[1]?.title, "Activity");
    assertEquals(items[1]?.count, 2);
    assertEquals(items[1]?.items?.map((item) => item.kind), ["tool", "thinking"]);
    assertEquals(items[1]?.items?.[0]?.output, "src/app.js");
});

Deno.test("Activity stays open as it grows and only synchronizes Thinking disclosures", async () => {
    const { createElement } = await import("react");
    const { create, act } = await import("react-test-renderer");
    const previousActFlag = globalThis.IS_REACT_ACT_ENVIRONMENT;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    let renderer;
    const activity = (extra = false) =>
        reduceSessionEvents([
            { type: "tool_start", eventId: "t1s", toolCallId: "t1", toolName: "read" },
            { type: "tool_end", eventId: "t1e", toolCallId: "t1", toolName: "read", output: "first file" },
            { type: "assistant_thinking_delta", eventId: "th1", messageId: "thinking-1", delta: "Checking" },
            { type: "assistant_thinking_end", eventId: "th1e", messageId: "thinking-1" },
            ...(extra
                ? [
                    { type: "tool_end", eventId: "t2e", toolCallId: "t2", toolName: "read", output: "second file" },
                    { type: "assistant_thinking_delta", eventId: "th2", messageId: "thinking-2", delta: "More checks" },
                    { type: "assistant_thinking_end", eventId: "th2e", messageId: "thinking-2" },
                ]
                : []),
            { type: "assistant_text_delta", eventId: "a1", messageId: "a1", delta: "Done" },
        ]).filter((item) => item.kind === "activity");
    const initial = activity();
    const expanded = activity(true);
    assertEquals(initial[0].key, expanded[0].key);
    const group = () => renderer.root.findByProps({ className: "session-activity-group" });
    const thinking = () =>
        renderer.root.findAllByType("details").filter((node) => node.props.className.includes("activity-thinking"));
    const tools = () =>
        renderer.root.findAllByType("details").filter((node) => node.props.className.includes("activity-tool"));
    const toggle = async (node, open) => {
        const target = { open };
        await act(() => node.props.onToggle({ currentTarget: target, target }));
    };
    try {
        await act(() => {
            renderer = create(createElement(SessionTimeline, { items: initial }));
        });
        const firstTool = tools()[0];
        assertEquals(group().props.open, false);
        await toggle(group(), true);
        assertEquals(thinking()[0].props.open, true);
        await toggle(thinking()[0], false);
        assertEquals(group().props.open, true);
        await act(() => renderer.update(createElement(SessionTimeline, { items: expanded })));
        assertEquals(group().props.open, true);
        assertEquals(thinking().map((node) => node.props.open), [false, true]);
        assertEquals(tools()[0] === firstTool, true);
        assertEquals(tools().every((node) => node.props.open === undefined && node.props.onToggle === undefined), true);
        await toggle(group(), false);
        assertEquals(thinking().map((node) => node.props.open), [false, false]);
        await toggle(group(), true);
        assertEquals(thinking().map((node) => node.props.open), [true, true]);
        // Nested toggle events must never change the parent disclosure.
        await act(() => group().props.onToggle({ currentTarget: { open: false }, target: {} }));
        assertEquals(group().props.open, true);
    } finally {
        if (renderer) await act(() => renderer.unmount());
        if (previousActFlag === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT;
        else globalThis.IS_REACT_ACT_ENVIRONMENT = previousActFlag;
    }
});

Deno.test("Session timeline keeps trailing or running technical activity visible", () => {
    const trailing = reduceSessionEvents([
        { type: "tool_start", eventId: "t1s", toolCallId: "t1", toolName: "read", title: "read src/app.js" },
        { type: "tool_end", eventId: "t1e", toolCallId: "t1", toolName: "read", output: "full file output" },
    ]);
    assertEquals(trailing.map((item) => item.kind), ["tool"]);
    assertEquals(compactToolLine(trailing[0]), "read src/app.js");

    const running = reduceSessionEvents([
        { type: "tool_start", eventId: "t2s", toolCallId: "t2", toolName: "edit", title: "edit src/app.js" },
        { type: "assistant_text_delta", eventId: "a1", messageId: "a1", delta: "Working." },
    ]);
    assertEquals(running.map((item) => item.kind), ["tool", "message"]);
    assertEquals(running[0]?.status, "running");
    assertEquals(compactToolLine(running[0]), "edit src/app.js running");
});

Deno.test("Session scroll follows only while the reader stays near the live edge", () => {
    assertEquals(isAtLiveScrollEdge({ scrollHeight: 1000, scrollTop: 553, clientHeight: 400 }), true);
    assertEquals(isAtLiveScrollEdge({ scrollHeight: 1000, scrollTop: 300, clientHeight: 400 }), false);
});

Deno.test("Existing Session route lets the shared chat shell own the page heading", async () => {
    const route = await Deno.readTextFile(
        new URL("./pages/projects/[projectId]/sessions/[runwieldSessionId].astro", import.meta.url),
    );
    assertEquals(route.includes("Session Continuation"), false);
    assertEquals(route.includes("Committed transcript history"), false);
    assertEquals(route.includes("SessionSurface"), true);
});

Deno.test("live Plan attachment updates sidebar state without replacing committed history", () => {
    const initial = {
        events: [{ eventId: "committed-1", text: "Start with Ideator" }],
        nextCursor: "committed-1",
        generation: 1,
        snapshot: {
            activeAgent: "ideator",
            workflowContext: null,
            planAssociations: [{ planName: "old-plan", planId: "plan-1" }],
        },
    };
    const planning = mergeLiveSessionInfo(initial, {
        activeAgent: "planner",
        activeModel: { provider: "openai", model: "planner-model" },
        thinkingLevel: "high",
        workflowContext: { planName: "new-plan" },
        planAssociations: [{ planName: "new-plan", planId: "plan-2" }],
        activeExecutionWorkflow: null,
    });
    assertEquals(
        activePlanProgressApiUrl("project", "session", planning.snapshot),
        "/api/owner/projects/project/plans/plan-2/progress?session=session",
    );
    assertEquals(planning.events, initial.events);
    assertEquals(planning.nextCursor, "committed-1");
    assertEquals(planning.generation, 1);
    assertEquals(planning.snapshot.activeAgent, "planner");
    assertEquals(planning.snapshot.planAssociations.map((item) => item.planId), ["plan-1", "plan-2"]);
    assertEquals(mergeLiveSessionInfo(planning, planning.snapshot).snapshot.planAssociations.length, 2);
    assertEquals(planning.snapshot.thinkingLevel, "high");
    const executing = mergeLiveSessionInfo(planning, {
        activeAgent: "engineer",
        activeExecutionWorkflow: { planName: "child-plan", triageMeta: { planId: "child-id" } },
    });
    assertEquals(
        activePlanProgressApiUrl("project", "session", executing.snapshot),
        "/api/owner/projects/project/plans/child-id/progress?session=session",
    );
    assertEquals(mergeLiveSessionInfo(executing, null), executing);
    assertEquals(initial.snapshot.activeAgent, "ideator");
});

Deno.test("Session workflow sidebar uses canonical progress stages", async () => {
    const surface = await Deno.readTextFile(new URL("./islands/SessionSurface.jsx", import.meta.url));
    assertEquals(
        activePlanProgressApiUrl("project-1", "session-1", {
            activeExecutionWorkflow: { planId: "plan-demo" },
        }),
        "/api/owner/projects/project-1/plans/plan-demo/progress?session=session-1",
    );
    assertEquals(
        activePlanProgressApiUrl("project-1", "session-1", {
            workflowContext: { planName: "readme-wording" },
            planAssociations: [{ planName: "readme-wording", planId: "plan-demo" }],
        }),
        "/api/owner/projects/project-1/plans/plan-demo/progress?session=session-1",
    );
    assertEquals(
        activePlanProgressApiUrl("project-1", "session-1", {
            workflowContext: { planName: "readme-wording" },
        }),
        "",
    );
    assertEquals(
        buildWorkflowPresentation({
            planName: "plan-demo",
            status: "validated_ci",
            progressFacts: [
                { kind: "validation_checkpoint", phase: "semantic", state: "running" },
            ],
        }).stages.map((stage) => stage.label),
        ["Planning", "Execution", "Tests and CI", "AI review", "Code Review", "Publication", "Completion"],
    );
    assertEquals(surface.includes('ownerFetch(apiUrl, { method: "GET" })'), true);
    assertEquals(surface.includes("WorkflowSidebar"), true);
});

Deno.test("Persisted Sessions expose the shared context sidebar tabs", async () => {
    const surface = await Deno.readTextFile(new URL("./islands/SessionSurface.jsx", import.meta.url));
    assertEquals(surface.includes("SESSION_SIDEBAR_TABS.map"), true);
    assertEquals(surface.includes("session-context-tabs"), true);
    assertEquals(surface.includes("session-artifact-list"), true);
    assertEquals(surface.includes("defaultSessionSidebarTab"), true);
    assertEquals(surface.includes("presentation={workflowSidebar}"), true);
    assertEquals(surface.includes('title="Workflow"'), true);
});

Deno.test("Session sidebar adds current runtime settings to shared TUI fields", async () => {
    const surface = await Deno.readTextFile(new URL("./islands/SessionSurface.jsx", import.meta.url));
    assertEquals(
        surface.includes('sessionSidebarFields(sessionSidebar).filter((field) => field.label !== "Session")'),
        true,
    );
    assertEquals(surface.includes('label: "Agent"'), true);
    assertEquals(surface.includes('label: "Model"'), true);
    assertEquals(surface.includes('label: "Thinking"'), true);
    assertEquals(surface.includes('const currentAgent = timeline?.snapshot?.activeAgent || ""'), true);
    assertEquals(surface.includes("value: activeThinking"), true);
    assertEquals(surface.includes('[activeProvider, activeModelId].filter(Boolean).join("/")'), true);
    assertEquals(surface.includes("Execution Backend"), false);
    assertEquals(surface.includes("<dd>{displayedThinking}</dd>"), false);
    assertEquals(surface.includes("modelValue={stagedModelKey}"), true);
    assertEquals(surface.includes("thinkingValue={displayedThinking}"), true);
});

Deno.test("Session sidebar keeps one toggle and its tabs in the shared header", async () => {
    const surface = await Deno.readTextFile(new URL("./islands/SessionSurface.jsx", import.meta.url));
    const header = surface.slice(
        surface.indexOf("<WorkspaceHeaderActionsPortal>"),
        surface.indexOf("</WorkspaceHeaderActionsPortal>"),
    );
    assertEquals(
        header.indexOf("<RunWieldPanelToggle") < header.indexOf('className="rw-underline-tabs session-context-tabs"'),
        true,
    );
    assertEquals(header.includes("collapsed={contextCollapsed}"), true);
    assertEquals(surface.match(/<RunWieldPanelToggle/g)?.length, 1);
    const sidebar = surface.slice(surface.indexOf('id="session-context-sidebar"'));
    assertEquals(sidebar.includes('className="session-context-header"'), false);
    assertEquals(sidebar.includes('className="kicker"'), false);
});

Deno.test("Session image attachments use a Session-scoped draft key and request payload", () => {
    assertEquals(
        sessionAttachmentsKey("project-1", "session-1"),
        "runwield:owner:project:project-1:session:session-1:image-attachments",
    );
    assertEquals(
        serializeSessionImageForRequest({ id: "img-1", name: "paste.png", mimeType: "image/png", base64: "abc" }),
        { base64: "abc", mimeType: "image/png" },
    );
});

Deno.test("idle Sessions can continue with planning or execution history", () => {
    const planning = deriveSessionAvailability({
        state: "idle",
        generation: 4,
        snapshot: { activeAgent: "Planner", workflowContext: { planName: "feature-a" } },
    });
    assertEquals(planning.key, "available");
    assertEquals(planning.canContinue, true);

    const execution = deriveSessionAvailability({
        state: "idle",
        generation: 4,
        snapshot: { activeAgent: "Engineer", activeExecutionWorkflow: { planName: "feature-a" } },
    });
    assertEquals(execution.key, "available");
    assertEquals(execution.canContinue, true);
});

Deno.test("review_diff stays collapsed while review_complete is an expanded workflow step", async () => {
    const { SessionTimeline } = await import("./components/SessionTimeline.jsx");
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const started = { type: "tool_start", toolCallId: "diff", toolName: "review_diff" };
    const completed = { type: "tool_end", toolCallId: "diff", toolName: "review_diff", output: "README diff" };
    for (const events of [[started], [started, completed], [completed]]) {
        const items = reduceSessionEvents(events);
        assertEquals(items[0].kind, "tool");
        const html = renderToStaticMarkup(createElement(SessionTimeline, { items }));
        assertEquals(html.includes('<details class="session-tool '), true);
        assertEquals(html.includes(" open="), false);
        assertEquals(html.includes("rw-workflow-block"), false);
    }
    const items = reduceSessionEvents([
        completed,
        { type: "tool_end", toolCallId: "read", toolName: "read", output: "Plan requirements" },
        { type: "tool_end", toolCallId: "review", toolName: "review_complete", output: "Review approved." },
    ]);
    assertEquals(items.map((item) => item.kind), ["activity", "workflow"]);
    assertEquals(items[0].items.map((item) => item.toolName), ["review_diff", "read"]);
    assertEquals(items[1].workflowMessage, "review_complete");
});

Deno.test("all workflow tools remain expanded outside routine activity, with accepted reports preserved", async () => {
    const { WORKFLOW_TOOL_NAMES } = await import("../../tools/registry.js");
    const { workflowToolMarkdown, SessionTimeline } = await import("./components/SessionTimeline.jsx");
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    for (const name of WORKFLOW_TOOL_NAMES) {
        const items = reduceSessionEvents([
            { type: "tool_start", toolCallId: "read-1", toolName: "read" },
            { type: "tool_end", toolCallId: "read-1", toolName: "read", output: "file" },
            { type: "tool_start", toolCallId: "workflow-1", toolName: name },
            {
                type: "tool_end",
                toolCallId: "workflow-1",
                toolName: name,
                output: "Full workflow decision with evidence.",
            },
            { type: "assistant_text_delta", messageId: "reply", delta: "Next step." },
        ]);
        const block = items.find((item) => item.workflowMessage === name);
        assertEquals(block?.kind, "workflow", name);
        assertEquals(block?.status, "completed", name);
        assertEquals(workflowToolMarkdown(block), "Full workflow decision with evidence.", name);
        const html = renderToStaticMarkup(createElement(SessionTimeline, { items: [block] }));
        assertEquals(html.includes('class="rw-workflow-block status-completed"'), true, name);
        assertEquals(html.includes("<details"), false, name);
        assertEquals(html.includes("Full workflow decision with evidence."), true, name);
    }
    const items = reduceSessionEvents([
        { type: "tool_start", toolCallId: "task", toolName: "task_completed" },
        {
            type: "assistant_text_delta",
            messageId: "completion",
            workflowMessage: "task_completed",
            delta: "**Task completed.**\n\nVerified.",
        },
        { type: "tool_end", toolCallId: "task", toolName: "task_completed", output: "Verified." },
    ]);
    assertEquals(items.length, 1);
    assertEquals(items[0].status, "completed");
    assertEquals(workflowToolMarkdown(items[0]), "**Task completed.**\n\nVerified.");
    const triage = reduceSessionEvents([
        {
            type: "tool_end",
            toolCallId: "triage",
            toolName: "triage_report",
            output: "Triage complete.",
            details: {
                routingIntent: "QUICK_FIX",
                complexity: "LOW",
                summary: "Fix image sending.",
            },
        },
    ])[0];
    assertEquals(workflowToolMarkdown(triage).includes("Fix image sending."), true);
    assertEquals(workflowToolMarkdown(triage).includes("QUICK_FIX"), true);
    const workRecord = reduceSessionEvents([
        { type: "tool_start", toolCallId: "record", toolName: "work_record_completed" },
        {
            type: "tool_end",
            toolCallId: "record",
            toolName: "work_record_completed",
            details: { title: "Image sending", summary: "Verified in browser and TUI.", deferredWork: "None." },
        },
        {
            type: "tool_end",
            toolCallId: "record",
            toolName: "work_record_completed",
            output: "Work Record sections accepted.",
            details: { accepted: true },
        },
    ])[0];
    assertEquals(workflowToolMarkdown(workRecord).includes("Verified in browser and TUI."), true);
    assertEquals(workflowToolMarkdown(workRecord).includes("Deferred work"), true);
    const review = {
        markdown: "Approved.",
        details: { advisories: [{ title: "Follow-up", detail: "Keep this visible." }] },
    };
    assertEquals(workflowToolMarkdown(review).includes("Keep this visible."), true);
    const checklist = {
        output: "Manual QA checklist saved.",
        details: { checklistMarkdown: "- [ ] Test on a phone." },
    };
    assertEquals(workflowToolMarkdown(checklist), "- [ ] Test on a phone.");
    const savedChecklist = reduceSessionEvents([
        {
            type: "assistant_text_delta",
            messageId: "qa-message",
            workflowMessage: "manual_qa_checklist",
            delta: "- [ ] Test on a phone.",
        },
        {
            type: "tool_end",
            toolCallId: "qa",
            toolName: "manual_qa_completed",
            details: { checklistMarkdown: "- [ ] Test on a phone." },
        },
    ]);
    assertEquals(savedChecklist.length, 1);
    assertEquals(savedChecklist[0].workflowMessage, "manual_qa_completed");
    const artifact = reduceSessionEvents([{
        type: "tool_end",
        toolCallId: "artifact",
        toolName: "artifact_written",
        output: "Report registered.",
        details: { artifact: { artifactId: "report-1", title: "Session findings" } },
    }]);
    const artifactHtml = renderToStaticMarkup(createElement(SessionTimeline, {
        items: artifact,
        sessionPath: "/projects/project-1/sessions/session-1",
    }));
    assertEquals(artifactHtml.includes('href="/projects/project-1/sessions/session-1/artifacts/report-1"'), true);
    assertEquals(artifactHtml.includes("Open Session findings"), true);
});

Deno.test("image-only user messages survive the browser timeline reducer", () => {
    const images = [{ base64: "aW1hZ2U=", mimeType: "image/png" }];
    const items = reduceSessionEvents([{ type: "user_message", messageId: "image", text: "", images }]);
    assertEquals(items[0].images, images);
    assertEquals(items[0].role, "user");
});

Deno.test("Core busy events show Thinking at the live edge before any assistant output and clear on idle", async () => {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const events = [
        { type: "user_message", messageId: "request", text: "Hello" },
        { type: "busy_changed", busy: true },
    ];
    let items = reduceOperationTransientItems(events);
    const html = renderToStaticMarkup(createElement(SessionTimeline, { items }));
    assertEquals(html.includes('aria-label="Thinking..."'), true);
    assertEquals(html.includes('class="rw-thinking-glyph"'), true);
    assertEquals(items.at(-1).kind, "busy");
    events.push({ type: "assistant_text_delta", messageId: "reply", delta: "Hello back" });
    events.push({ type: "busy_changed", busy: true });
    items = reduceOperationTransientItems(events);
    assertEquals(items.filter((item) => item.kind === "busy").length, 1);
    assertEquals(items.at(-1).kind, "busy");
    events.push({ type: "busy_changed", busy: false });
    assertEquals(reduceOperationTransientItems(events).some((item) => item.kind === "busy"), false);
    // An old busy event must not turn a reopened transcript into a running Session.
    assertEquals(reduceSessionEvents(events.slice(0, 2)).some((item) => item.kind === "busy"), false);
    assertEquals(reduceOperationTransientItems([]).length, 0);
});

Deno.test("Workspace displays a reported backend denial once", () => {
    const items = reduceSessionEvents([
        { type: "system_status", level: "error", message: "Blocked: read_file" },
        { type: "terminal_error", message: "Blocked: read_file", messageAlreadyReported: true },
        { type: "terminal_error", message: "A different failure" },
    ]);
    assertEquals(items.filter((item) => item.kind === "system-event").map((item) => item.text), [
        "Blocked: read_file\nA different failure",
    ]);
});

Deno.test("Session composer preserves drafts across focus changes and shares one Stop or Send action", async () => {
    const previousDocument = globalThis.document;
    const previousActFlag = globalThis.IS_REACT_ACT_ENVIRONMENT;
    globalThis.document = { getElementById: () => null };
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const { createElement } = await import("react");
    const { act, create } = await import("react-test-renderer");
    let renderer;
    let stopped = 0;
    let sent = 0;
    let focused = 0;
    const props = {
        id: "focus-composer",
        draft: "",
        disabled: false,
        canSend: false,
        submitting: false,
        agentValue: "planner",
        agents: [{ name: "planner", displayName: "Planner" }],
        modelValue: "openai\u001fgpt-model",
        thinkingValue: "high",
        onDraftChange() {},
        onSubmit() {
            sent++;
        },
        onStop() {
            stopped++;
        },
    };
    try {
        await act(() => {
            renderer = create(createElement(SessionComposer, props), {
                createNodeMock(element) {
                    return element.type === "textarea"
                        ? {
                            style: {},
                            scrollHeight: 48,
                            focus() {
                                focused++;
                            },
                        }
                        : null;
                },
            });
        });
        const form = () => renderer.root.findByType("form");
        const textarea = () => renderer.root.findByType("textarea");
        const primary = () =>
            renderer.root.findAllByType("button").find((button) =>
                button.props.className?.includes("session-send-button")
            );
        const summary = () => renderer.root.findByProps({ className: "session-composer-summary" });
        assertEquals(form().props["data-expanded"], false);
        assertEquals(textarea().props.hidden, true);
        assertEquals(summary().props.title, "Planner · openai/gpt-model · high");
        assertEquals(primary().props["aria-label"], "Stop");
        assertEquals(primary().props.disabled, false);
        await act(() => primary().props.onClick());
        assertEquals(stopped, 1);
        assertEquals(sent, 0);
        await act(() => summary().props.onFocus());
        assertEquals(form().props["data-expanded"], true);
        assertEquals(textarea().props.hidden, false);
        assertEquals(focused, 1);
        const settings = {};
        await act(() =>
            form().props.onBlurCapture({
                currentTarget: { contains: (target) => target === settings },
                relatedTarget: settings,
            })
        );
        assertEquals(form().props["data-expanded"], true);
        await act(() =>
            renderer.update(createElement(SessionComposer, {
                ...props,
                draft: "Keep this draft",
                canSend: true,
                imageAttachments: [{ id: "image-1", name: "draft.png", mimeType: "image/png", base64: "aW1n" }],
            }))
        );
        assertEquals(primary().props["aria-label"], "Send");
        assertEquals(primary().props.type, "submit");
        await act(() => form().props.onBlurCapture({ currentTarget: { contains: () => false }, relatedTarget: null }));
        assertEquals(form().props["data-expanded"], false);
        assertEquals(textarea().props.value, "Keep this draft");
        assertEquals(summary().children[0].children[0].startsWith("Draft · Planner"), true);
        assertEquals(renderer.root.findByProps({ "aria-label": "Attached images" }).props.hidden, true);
        await act(() => summary().props.onClick());
        assertEquals(textarea().props.value, "Keep this draft");
        assertEquals(renderer.root.findByProps({ "aria-label": "Attached images" }).props.hidden, false);
        await act(() => form().props.onSubmit({ preventDefault() {} }));
        assertEquals(sent, 1);
        await act(() =>
            renderer.update(createElement(SessionComposer, {
                ...props,
                draft: " ",
                canSend: true,
                imageAttachments: [{ id: "image-1", name: "draft.png", mimeType: "image/png", base64: "aW1n" }],
            }))
        );
        assertEquals(primary().props["aria-label"], "Send");
        await act(() => renderer.update(createElement(SessionComposer, { ...props, draft: " " })));
        assertEquals(primary().props["aria-label"], "Stop");
    } finally {
        if (renderer) await act(() => renderer.unmount());
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
        if (previousActFlag === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT;
        else globalThis.IS_REACT_ACT_ENVIRONMENT = previousActFlag;
    }
});

Deno.test("saved and live reports reconcile by call and retain chronological Activity boundaries", () => {
    const time = (minute) => `2026-09-19T20:${minute}:00.000Z`;
    const report = (call, minute) => [
        { type: "tool_end", toolName: "task_completed", toolCallId: call, timestamp: time(minute) },
        {
            type: "assistant_text_delta",
            workflowMessage: "task_completed",
            toolCallId: call,
            messageId: `report-${call}`,
            delta: `Report ${call}`,
            timestamp: time(minute),
        },
    ];
    const tools = (prefix, minute) =>
        [1, 2].map((n) => ({
            type: "tool_end",
            toolName: "read",
            toolCallId: `${prefix}-${n}`,
            timestamp: time(minute),
        }));
    const saved = reduceSessionEvents([
        ...report("first", "24"),
        ...tools("saved", "25"),
        ...report("second", "53"),
    ]);
    const live = reduceSessionEvents([
        ...report("first", "24"),
        ...tools("saved", "25"),
        { type: "assistant_thinking_end", messageId: "review-thinking", timestamp: time("28") },
        ...tools("review", "29"),
        {
            type: "assistant_text_delta",
            workflowMessage: "review_complete",
            toolCallId: "review",
            messageId: "review-report",
            delta: "Repair required",
            timestamp: time("30"),
        },
        ...report("second", "53"),
    ], { source: "transient" });
    const items = mergeSessionTimelineItems(saved, live);
    assertEquals(items.map((item) => item.workflowMessage || item.kind), [
        "task_completed",
        "activity",
        "review_complete",
        "task_completed",
    ]);
    assertEquals(items.filter((item) => item.kind === "workflow").map((item) => item.timestamp), [
        time("24"),
        time("30"),
        time("53"),
    ]);
    assertEquals(items[1].items.map((item) => item.toolCallId || item.kind), [
        "saved-1",
        "saved-2",
        "thinking",
        "review-1",
        "review-2",
    ]);
    assertEquals(new Set(items[1].items.map((item) => item.key)).size, 5);
});

Deno.test("Activity never spans a user message or special report", () => {
    const tool = (id) => ({ type: "tool_end", toolName: "read", toolCallId: id });
    const items = reduceSessionEvents([
        tool("a"),
        tool("b"),
        { type: "user_message", messageId: "user", text: "Earlier request" },
        tool("c"),
        { type: "assistant_thinking_end", messageId: "thinking" },
        { type: "tool_end", toolName: "manual_qa_completed", toolCallId: "qa" },
        tool("d"),
        tool("e"),
        { type: "assistant_text_delta", messageId: "reply", delta: "Done" },
    ]);
    assertEquals(items.map((item) => item.kind), [
        "activity",
        "message",
        "activity",
        "workflow",
        "activity",
        "message",
    ]);
    assertEquals(
        items.filter((item) => item.kind === "activity").map((item) => item.items.map((entry) => entry.kind)),
        [["tool", "tool"], ["tool", "thinking"], ["tool", "tool"]],
    );
});

Deno.test("nested completion reports keep their call identity and accepted time after late results", () => {
    const time = (minute) => `2026-09-19T20:${minute}:00.000Z`;
    const items = reduceSessionEvents([
        { type: "tool_start", toolName: "task_completed", toolCallId: "outer", timestamp: time("23") },
        { type: "tool_start", toolName: "task_completed", toolCallId: "inner", timestamp: time("24") },
        {
            type: "assistant_text_delta",
            workflowMessage: "task_completed",
            toolCallId: "outer",
            messageId: "outer-report",
            delta: "Outer report",
            timestamp: time("25"),
        },
        {
            type: "assistant_text_delta",
            workflowMessage: "task_completed",
            toolCallId: "inner",
            messageId: "inner-report",
            delta: "Inner report",
            timestamp: time("26"),
        },
        { type: "tool_end", toolName: "task_completed", toolCallId: "outer", timestamp: time("53") },
        { type: "tool_end", toolName: "task_completed", toolCallId: "inner", timestamp: time("54") },
    ]);
    assertEquals(items.map((item) => [item.toolCallId, item.markdown, item.timestamp]), [[
        "outer",
        "Outer report",
        time("25"),
    ], ["inner", "Inner report", time("26")]]);
});

Deno.test("live updates finish saved running tools without dropping later repeated user text", () => {
    const saved = reduceSessionEvents([
        { type: "user_message", messageId: "saved-user", text: "Continue", timestamp: "2026-09-19T20:00:01Z" },
        { type: "tool_start", toolCallId: "call", toolName: "read", timestamp: "2026-09-19T20:01:00Z" },
    ]);
    const live = reduceSessionEvents([
        { type: "user_message", messageId: "live-user", text: "Continue", timestamp: "2026-09-19T20:00:00Z" },
        { type: "tool_end", toolCallId: "call", toolName: "read", output: "Result", timestamp: "2026-09-19T20:02:00Z" },
        { type: "user_message", messageId: "later-user", text: "Continue", timestamp: "2026-09-19T20:03:00Z" },
    ], { source: "transient" });
    const items = mergeSessionTimelineItems(saved, live);
    assertEquals(items.map((item) => item.kind), ["message", "tool", "message"]);
    assertEquals(items[1].status, "completed");
    assertEquals(items[1].output, "Result");
    assertEquals(items[2].timestamp, "2026-09-19T20:03:00Z");
});
