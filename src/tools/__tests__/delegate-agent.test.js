import { assertEquals, assertStringIncludes } from "@std/assert";
import { HostedSession } from "../../shared/session/hosted-session.js";
import { createDelegateAgentTool, diffDelegatedChangeSnapshot, resolveDelegatedToolNames } from "../delegate-agent.js";

/**
 * @typedef {Object} DelegateToolDetails
 * @property {boolean} ok
 * @property {"read" | "write"} mode
 * @property {string[]} [tools]
 * @property {string[]} [changedPaths]
 * @property {boolean} [changeAttributionComplete]
 * @property {boolean} [committedChangesDetected]
 * @property {string} [error]
 */

/**
 * @typedef {Object} DelegateToolResult
 * @property {Array<{ type: string, text: string }>} content
 * @property {DelegateToolDetails} details
 * @property {boolean} [isError]
 */

/**
 * @typedef {Object} ExecutableTool
 * @property {(toolCallId: string, params: Record<string, unknown>, signal: AbortSignal, onUpdate: () => void, context: Record<string, unknown>) => Promise<DelegateToolResult>} execute
 */

/**
 * @param {unknown} tool
 * @param {Record<string, unknown>} params
 * @param {AbortSignal} [signal]
 * @returns {Promise<DelegateToolResult>}
 */
async function execute(tool, params, signal = new AbortController().signal) {
    const executable = /** @type {ExecutableTool} */ (tool);
    return await executable.execute("delegate-call", params, signal, () => {}, {});
}

/** @returns {Promise<import('@earendil-works/pi-agent-core').AgentMessage[]>} */
function assistantDone() {
    const message = /** @type {import('@earendil-works/pi-ai').AssistantMessage} */ ({
        role: "assistant",
        api: "openai-completions",
        provider: "test",
        model: "test",
        content: [{ type: "text", text: "done" }],
        usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: Date.now(),
    });
    return Promise.resolve([message]);
}

Deno.test("resolveDelegatedToolNames intersects parent tools with mode policy", () => {
    const parentTools = [
        "read",
        "bash",
        "edit",
        "write_docs",
        "edit_docs",
        "task_completed",
        "return_to_router",
        "review_complete",
        "triage_report",
        "user_interview",
        "memory_recall",
        "memory_recall_global",
        "memory_store",
        "memory_store_global",
        "memory_delete",
        "delegate_agent",
    ];

    assertEquals(resolveDelegatedToolNames(parentTools, "read"), ["read"]);
    assertEquals(resolveDelegatedToolNames(parentTools, "write"), ["read", "bash", "edit"]);
});

Deno.test("diffDelegatedChangeSnapshot compares the full pre/post workspace baseline", () => {
    assertEquals(
        diffDelegatedChangeSnapshot(
            [
                { path: "src/deleted-untracked.js", status: "??", contentHash: "gone" },
                { path: "src/pre-existing.js", status: " M", contentHash: "same" },
                { path: "src/modified.js", status: " M", contentHash: "before" },
            ],
            [
                { path: "src/modified.js", status: " M", contentHash: "after" },
                { path: "src/new.js", status: "??", contentHash: "new" },
                { path: "src/pre-existing.js", status: " M", contentHash: "same" },
            ],
        ),
        ["src/deleted-untracked.js", "src/modified.js", "src/new.js"],
    );
});

Deno.test("diffDelegatedChangeSnapshot refuses attribution when HEAD changes", () => {
    assertEquals(
        diffDelegatedChangeSnapshot(
            { head: "before", entries: [] },
            { head: "after", entries: [] },
        ),
        null,
    );
});

Deno.test("delegated agent prompt includes inherited repository context placeholders", async () => {
    const prompt = await Deno.readTextFile("src/agent-definitions/workflow-prompts/delegated-agent-prompt.md");

    assertStringIncludes(prompt, "{{GLOBAL_AGENTSMD}}");
    assertStringIncludes(prompt, "{{PROJECT_AGENTSMD}}");
    assertStringIncludes(prompt, "{{PROJECT_STATE_CONTEXT}}");
    assertStringIncludes(prompt, "{{MEMORIES}}");
    assertStringIncludes(prompt, "Treat core memories as background context");
    assertStringIncludes(prompt, "Leave all changes uncommitted");
    assertStringIncludes(prompt, "tools: []");
});

Deno.test("delegate_agent returns child output without inheriting workflow tools", async () => {
    /** @type {Array<Record<string, unknown>>} */
    const calls = [];
    const hostedSession = new HostedSession({ id: "delegate-read", cwd: Deno.cwd() });
    const tool = createDelegateAgentTool({
        hostedSession,
        cwd: Deno.cwd(),
        parentTools: ["read", "bash", "task_completed", "delegate_agent"],
        runIsolatedAgentSession: (opts) => {
            calls.push(opts);
            return assistantDone();
        },
        readTextFile: () => Promise.resolve("---\nname: Delegated Agent\n---\nPrompt"),
        ensurePromptFile: () => Promise.resolve("/tmp/delegated.md"),
    });

    const result = await execute(tool, { mode: "read", brief: "Inspect src/foo.js" });

    assertEquals(result.details.ok, true);
    assertEquals(result.details.tools, ["read"]);
    assertEquals(result.content[0].text, "done");
    assertEquals(calls[0].toolNames, ["read"]);
    assertStringIncludes(String(calls[0].userRequest || ""), "Inspect src/foo.js");
});

Deno.test("delegate_agent propagates parent model and thinking state", async () => {
    /** @type {Array<Record<string, unknown>>} */
    const calls = [];
    const hostedSession = new HostedSession({ id: "delegate-parent-state", cwd: Deno.cwd() });
    hostedSession.pushAgentInfo("Engineer", "anthropic/claude-sonnet-4", "anthropic", "engineer");
    hostedSession.setThinkingLevel("high");
    hostedSession.setProjectStateContext("Project state guidance");
    const tool = createDelegateAgentTool({
        hostedSession,
        cwd: Deno.cwd(),
        parentTools: ["read"],
        runIsolatedAgentSession: (opts) => {
            calls.push(opts);
            return assistantDone();
        },
        readTextFile: () => Promise.resolve("---\nname: Delegated Agent\n---\nPrompt"),
        ensurePromptFile: () => Promise.resolve("/tmp/delegated.md"),
    });

    await execute(tool, { mode: "read", brief: "Inspect state" });

    assertEquals(calls[0].modelOverride, "anthropic/claude-sonnet-4");
    assertEquals(calls[0].thinkingLevelOverride, "high");
    assertEquals(calls[0].projectStateContext, "Project state guidance");
});

Deno.test("delegate_agent preserves failed writer changes and releases lease", async () => {
    const hostedSession = new HostedSession({ id: "delegate-write-fail", cwd: Deno.cwd() });
    const executionCwd = "/tmp/delegated-execution-worktree";
    /** @type {string[]} */
    const snapshotCwds = [];
    /** @type {Array<Record<string, unknown>>} */
    const calls = [];
    let snapshots = 0;
    const tool = createDelegateAgentTool({
        hostedSession,
        cwd: executionCwd,
        parentTools: ["read", "write", "bash"],
        captureChangeSnapshot: (cwd) => {
            snapshotCwds.push(cwd);
            return Promise.resolve(
                snapshots++ === 0
                    ? { head: "same", entries: [{ path: "src/pre-existing.js", status: " M", contentHash: "same" }] }
                    : {
                        head: "same",
                        entries: [
                            { path: "src/changed.js", status: "??", contentHash: "new" },
                            { path: "src/pre-existing.js", status: " M", contentHash: "same" },
                        ],
                    },
            );
        },
        runIsolatedAgentSession: (opts) => {
            calls.push(opts);
            return Promise.reject(new Error("boom"));
        },
        readTextFile: () => Promise.resolve("---\nname: Delegated Agent\n---\nPrompt"),
        ensurePromptFile: () => Promise.resolve("/tmp/delegated.md"),
    });

    const result = await execute(tool, { mode: "write", brief: "Change one file" });

    assertEquals(result.isError, true);
    assertEquals(result.details.ok, false);
    assertEquals(result.details.changedPaths, ["src/changed.js"]);
    assertEquals(result.details.changeAttributionComplete, true);
    assertEquals(snapshotCwds, [executionCwd, executionCwd]);
    assertEquals(calls[0].cwd, executionCwd);
    assertEquals(calls[0].toolNames, ["read", "write", "bash"]);
    assertEquals(hostedSession.getDelegatedAgentLeaseState(), { readers: 0, writer: false });
});

Deno.test("delegate_agent flags writer attribution incomplete when HEAD changes", async () => {
    const hostedSession = new HostedSession({ id: "delegate-write-commit", cwd: Deno.cwd() });
    let snapshots = 0;
    const tool = createDelegateAgentTool({
        hostedSession,
        cwd: Deno.cwd(),
        parentTools: ["read", "write"],
        captureChangeSnapshot: () =>
            Promise.resolve(
                snapshots++ === 0 ? { head: "before", entries: [] } : { head: "after", entries: [] },
            ),
        runIsolatedAgentSession: () => assistantDone(),
        readTextFile: () => Promise.resolve("---\nname: Delegated Agent\n---\nPrompt"),
        ensurePromptFile: () => Promise.resolve("/tmp/delegated.md"),
    });

    const result = await execute(tool, { mode: "write", brief: "Change one file" });

    assertEquals(result.details.ok, true);
    assertEquals(result.details.changedPaths, null);
    assertEquals(result.details.changeAttributionComplete, false);
    assertEquals(result.details.committedChangesDetected, true);
});

Deno.test("delegate_agent returns structured failure when lease acquisition is rejected", async () => {
    const hostedSession = new HostedSession({ id: "delegate-lease-conflict", cwd: Deno.cwd() });
    const release = hostedSession.acquireDelegatedAgentLease("write");
    try {
        const tool = createDelegateAgentTool({
            hostedSession,
            cwd: Deno.cwd(),
            parentTools: ["read"],
            runIsolatedAgentSession: () => assistantDone(),
            readTextFile: () => Promise.resolve("---\nname: Delegated Agent\n---\nPrompt"),
            ensurePromptFile: () => Promise.resolve("/tmp/delegated.md"),
        });

        const result = await execute(tool, { mode: "read", brief: "Inspect while writer runs" });

        assertEquals(result.isError, true);
        assertEquals(result.details.ok, false);
        assertEquals(result.details.mode, "read");
        assertStringIncludes(result.details.error || "", "writer is already running");
    } finally {
        release();
    }
});

Deno.test("delegate_agent forwards cancellation and releases its lease", async () => {
    const hostedSession = new HostedSession({ id: "delegate-cancel", cwd: Deno.cwd() });
    const controller = new AbortController();
    /** @type {AbortSignal | undefined} */
    let childSignal;
    const tool = createDelegateAgentTool({
        hostedSession,
        cwd: Deno.cwd(),
        parentTools: ["read"],
        runIsolatedAgentSession: (opts) => {
            childSignal = opts.signal;
            return new Promise((_resolve, reject) => {
                opts.signal?.addEventListener("abort", () => reject(opts.signal?.reason), { once: true });
            });
        },
        readTextFile: () => Promise.resolve("---\nname: Delegated Agent\n---\nPrompt"),
        ensurePromptFile: () => Promise.resolve("/tmp/delegated.md"),
    });

    const pending = execute(tool, { mode: "read", brief: "Inspect until canceled" }, controller.signal);
    while (!childSignal) await Promise.resolve();
    controller.abort(new Error("cancelled"));
    const result = await pending;

    assertEquals(childSignal.aborted, true);
    assertEquals(result.isError, true);
    assertEquals(result.details.ok, false);
    assertStringIncludes(result.details.error || "", "cancelled");
    assertEquals(hostedSession.getDelegatedAgentLeaseState(), { readers: 0, writer: false });
});
