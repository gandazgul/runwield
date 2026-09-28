import { assert, assertEquals } from "@std/assert";
import { withWorkflowMetricsFixture } from "../../testing/workflow-metrics-fixture.ts";
import { attachSessionEventSubscribers } from "./session.js";
import { ExecutionMetricsRecorder } from "../workflow/execution-metrics.ts";
import { HostedSession } from "./hosted-session.js";
import { ownerProjectCommandMetricsApi } from "../../ui/workspace/routes/owner-session-api.js";
import { setCustomSetting } from "../settings.js";

function makeSubscribableSession() {
    let subscriber: ((event: unknown) => void) | null = null;
    let unsubscribed = false;
    return {
        session: {
            subscribe(fn: (event: unknown) => void) {
                subscriber = fn;
                return () => {
                    unsubscribed = true;
                    subscriber = null;
                };
            },
        },
        emit(event: unknown) {
            if (!subscriber) throw new Error("no subscriber registered");
            subscriber(event);
        },
        unsubscribed: () => unsubscribed,
    };
}

Deno.test("attachSessionEventSubscribers records tool lifecycle, usage, compaction, retry, and latency", async () => {
    await withWorkflowMetricsFixture(async ({ projectRoot, readMetrics }) => {
        const { session, emit } = makeSubscribableSession();
        const hostedSession = new HostedSession({ id: "test-session-sub", cwd: projectRoot });
        const cancellation = new AbortController();
        const agentDef = { name: "engineer", displayName: "Engineer" };

        const subscriberState = attachSessionEventSubscribers(
            session,
            // @ts-expect-error test agentDef
            agentDef,
            undefined,
            hostedSession,
            cancellation.signal,
        );

        const recorder = new ExecutionMetricsRecorder({
            projectRoot,
            sessionId: "test-session-sub",
            executionId: "exec-pi-turn",
            agentName: "engineer",
            backend: "pi",
            sourceSurface: "cli",
            executionKind: "root",
            mode: "foreground",
        });

        subscriberState.setRecorder(recorder);

        // 1. Turn start event
        emit({ type: "turn_start" });

        // 2. Tool execution start & finish
        emit({
            type: "tool_execution_start",
            callId: "tool-call-1",
            toolName: "bash",
            args: { command: "git status" },
        });

        emit({
            type: "tool_execution_end",
            callId: "tool-call-1",
            toolName: "bash",
            result: "clean working tree",
            isError: false,
        });

        // 3. Compaction start & finish
        emit({
            type: "compaction_start",
            reason: "threshold",
        });

        emit({
            type: "compaction_end",
            outcome: "succeeded",
            beforeTokens: 50000,
            afterTokens: 20000,
        });

        // 4. Auto retry start & finish
        emit({
            type: "auto_retry_start",
            retrySource: "auto_retry",
            attempt: 1,
            maxAttempts: 3,
            delayMs: 1000,
        });

        emit({
            type: "auto_retry_end",
            retrySource: "auto_retry",
            attempt: 1,
            outcome: "succeeded",
        });

        // 5. Message end with usage
        emit({
            type: "message_end",
            message: {
                role: "assistant",
                usage: {
                    inputTokens: 500,
                    outputTokens: 120,
                    cacheReadTokens: 50,
                    cacheWriteTokens: 10,
                    totalCost: 0.005,
                },
            },
        });

        // 6. Turn end
        emit({
            type: "turn_end",
            usage: {
                totalTokens: 620,
            },
        });

        // Settle execution
        await recorder.settleExecution("succeeded");
        subscriberState.unsubscribe();

        const records = await readMetrics();
        assert(records.length >= 6, `Expected at least 6 records, got ${records.length}`);

        // Verify tool call records
        const toolStart = records.find((r) => r.event === "tool_call_started");
        assert(toolStart, "tool_call_started must exist");
        assertEquals(toolStart.toolName, "bash");
        assertEquals(toolStart.callId, "tool-call-1");

        const toolOp = records.find((r) => r.event === "tool_operation" && r.operationKind === "bash_command");
        assert(toolOp, "tool_operation for bash must exist");
        assertEquals(toolOp.commandLabel, "git status");

        const toolFinish = records.find((r) => r.event === "tool_call_finished");
        assert(toolFinish, "tool_call_finished must exist");
        assertEquals(toolFinish.callId, "tool-call-1");
        assertEquals(toolFinish.outcome, "success");

        // Verify compaction
        const compStart = records.find((r) => r.event === "compaction_started");
        assert(compStart, "compaction_started must exist");
        assertEquals(compStart.reason, "threshold");

        const compEnd = records.find((r) => r.event === "compaction_finished");
        assert(compEnd, "compaction_finished must exist");
        assertEquals(compEnd.outcome, "succeeded");
        assertEquals(compEnd.afterTokens, 20000);

        // Verify retry
        const retryStart = records.find((r) => r.event === "retry_started");
        assert(retryStart, "retry_started must exist");
        assertEquals(retryStart.attempt, 1);

        const retryEnd = records.find((r) => r.event === "retry_finished");
        assert(retryEnd, "retry_finished must exist");
        assertEquals(retryEnd.outcome, "succeeded");

        // Verify model usage
        const usage = records.find((r) => r.event === "model_usage");
        assert(usage, "model_usage must exist");
        assertEquals(usage.inputTokens, 500);
        assertEquals(usage.outputTokens, 120);

        // Verify latency
        const latency = records.find((r) => r.event === "response_latency");
        assert(latency, "response_latency must exist");

        // Verify execution finished
        const execFinish = records.find((r) => r.event === "execution_finished");
        assert(execFinish, "execution_finished must exist");
        assertEquals(execFinish.outcome, "succeeded");
    });
});

Deno.test("Delegated background session links parentToolCallId and taskId", async () => {
    await withWorkflowMetricsFixture(async ({ projectRoot, readMetrics }) => {
        const parentExecutionId = "exec-root-1";
        const parentToolCallId = "call-delegate-42";
        const taskId = "task-bg-100";

        const delegatedRecorder = new ExecutionMetricsRecorder({
            projectRoot,
            sessionId: "child-session",
            executionId: "exec-child-2",
            agentName: "researcher",
            backend: "pi",
            sourceSurface: "cli",
            executionKind: "delegated",
            mode: "background",
            parentExecutionId,
            parentToolCallId,
            taskId,
        });

        await delegatedRecorder.recordToolStart("call-read-1", "read", { path: "README.md" });
        await delegatedRecorder.recordToolFinish("call-read-1", "read", {
            result: "# Test Project",
            isError: false,
        });
        await delegatedRecorder.settleExecution("succeeded");

        const records = await readMetrics();
        for (const record of records) {
            assertEquals(record.parentExecutionId, parentExecutionId);
            assertEquals(record.parentToolCallId, parentToolCallId);
            assertEquals(record.taskId, taskId);
            assertEquals(record.executionKind, "delegated");
            assertEquals(record.mode, "background");
        }
    });
});

Deno.test("POST /api/owner/projects/:projectId/command-metrics writes command metrics", async () => {
    await withWorkflowMetricsFixture(async ({ projectRoot, readMetrics }) => {
        await setCustomSetting("workflowMetrics", true, "project", projectRoot);

        const projectId = encodeURIComponent(projectRoot);
        const req = new Request("http://localhost/api/owner/projects/test/command-metrics", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                invocationId: "cmd-ws-1",
                command: "settings",
                kind: "builtin",
                sessionId: "session-ws-1",
                phase: "finish",
                outcome: "succeeded",
                durationMs: 15,
            }),
        });

        const ctx = {
            req,
            params: { projectId },
        };

        const response = await ownerProjectCommandMetricsApi(ctx);
        assertEquals(response.status, 200);

        const records = await readMetrics();
        assertEquals(records.length, 1);
        const record = records[0];
        assertEquals(record.v, 2);
        assertEquals(record.category, "command");
        assertEquals(record.event, "command_finished");
        assertEquals(record.commandId, "cmd-ws-1");
        assertEquals(record.command, "settings");
        assertEquals(record.kind, "builtin");
        assertEquals(record.sourceSurface, "workspace");
        assertEquals(record.outcome, "succeeded");
        assertEquals(record.durationMs, 15);
    });
});
