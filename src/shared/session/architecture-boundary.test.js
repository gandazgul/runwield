import { assertEquals, assertRejects } from "@std/assert";
import { dirname, fromFileUrl, join, relative, resolve } from "@std/path";
import { SessionRuntime } from "./session-runtime.js";

const REPO_ROOT = resolve(dirname(fromFileUrl(import.meta.url)), "../../..");
const SKIPPED_SOURCE_DIRECTORIES = new Set([".astro", "dist", "node_modules"]);

/** @param {string} path @returns {Promise<string[]>} */
async function productionSourceFiles(path) {
    const files = [];
    for await (const entry of Deno.readDir(path)) {
        const entryPath = join(path, entry.name);
        if (entry.isDirectory) {
            if (SKIPPED_SOURCE_DIRECTORIES.has(entry.name)) continue;
            files.push(...await productionSourceFiles(entryPath));
            continue;
        }
        if (!entry.isFile || !/\.[jt]sx?$/.test(entry.name)) continue;
        if (/\.test\.[jt]sx?$/.test(entry.name) || /_test\.[jt]sx?$/.test(entry.name)) continue;
        files.push(entryPath);
    }
    return files;
}

/** @param {string} path @returns {Promise<string[]>} */
async function productionJavaScriptFiles(path) {
    return (await productionSourceFiles(path)).filter((file) => /\.jsx?$/.test(file));
}

/**
 * @typedef {Object} SourceRule
 * @property {string} label
 * @property {RegExp} pattern
 * @property {(path: string) => boolean} [allowPath]
 */

/**
 * @param {string[]} roots
 * @param {SourceRule[]} rules
 * @param {{ javascriptOnly?: boolean }} [options]
 */
async function findViolations(roots, rules, options = {}) {
    const violations = [];
    for (const root of roots) {
        const files = options.javascriptOnly
            ? await productionJavaScriptFiles(join(REPO_ROOT, root))
            : await productionSourceFiles(join(REPO_ROOT, root));
        for (const file of files) {
            const path = relative(REPO_ROOT, file);
            const source = await Deno.readTextFile(file);
            for (const rule of rules) {
                if (rule.allowPath?.(path)) continue;
                if (rule.pattern.test(source)) violations.push(`${path}: ${rule.label}`);
            }
        }
    }
    return violations;
}

/**
 * @param {string} file
 * @param {string} source
 * @returns {string[]}
 */
function resolvedImportTargets(file, source) {
    const targets = [];
    const importPattern =
        /(?:import\s+(?:[^"']*?\s+from\s*)?|export\s+[^"']*?\s+from\s*|import\s*\()\s*["']([^"']+)["']/g;
    for (const match of source.matchAll(importPattern)) {
        const specifier = match[1];
        if (!specifier.startsWith(".")) continue;
        targets.push(relative(REPO_ROOT, resolve(dirname(file), specifier)));
    }
    return targets;
}

/** @param {string} path */
function isWorkspaceSessionContinuation(path) {
    return path === "src/ui/workspace/server/session-continuation.js";
}

Deno.test("core has no consumer presentation knowledge", async () => {
    const violations = await findViolations(["src/shared", "src/tools"], [
        { label: "UI API reference", pattern: /\buiAPI\b|\bUiAPI\b|SessionUiPort/ },
        { label: "consumer name", pattern: /\bTUI\b|\bACP\b|Plannotator/ },
        { label: "consumer import", pattern: /(?:from|import\()\s*["'][^"']*(?:\/ui\/|\/acp\/)/ },
    ], { javascriptOnly: true });
    assertEquals(violations, []);
});

Deno.test("TUI, ACP, and Workspace remain sibling Runtime consumers", async () => {
    const violations = [];
    const surfaceRules = [
        { root: "src/ui/tui", forbidden: ["src/acp", "src/ui/workspace"] },
        { root: "src/acp", forbidden: ["src/ui/tui", "src/ui/workspace"] },
        { root: "src/ui/workspace", forbidden: ["src/ui/tui", "src/acp"] },
    ];

    for (const { root, forbidden } of surfaceRules) {
        for (const file of await productionSourceFiles(join(REPO_ROOT, root))) {
            const path = relative(REPO_ROOT, file);
            const source = await Deno.readTextFile(file);
            for (const target of resolvedImportTargets(file, source)) {
                if (forbidden.some((prefix) => target === prefix || target.startsWith(`${prefix}/`))) {
                    violations.push(`${path}: sibling adapter import ${target}`);
                }
            }
        }
    }

    assertEquals(violations, []);
});

Deno.test("TUI, ACP, Workspace, commands, and scripts use the public Runtime surface only", async () => {
    const violations = await findViolations(["src/ui/tui", "src/acp", "src/ui/workspace", "src/cmd", "scripts"], [
        { label: "HostedSession reference", pattern: /HostedSession|hosted-session/ },
        { label: "SessionHost reference", pattern: /SessionHost|session-host/ },
        {
            label: "root-session internal access",
            pattern: /getRootAgentSession|getRootSessionManager|createRootSessionManager|openPersistedRootSession/,
            allowPath: isWorkspaceSessionContinuation,
        },
        { label: "session implementation import", pattern: /shared\/session\/session\.js/ },
        {
            label: "session internal import",
            pattern: /shared\/session\/(?:agent-handler|agent-switching|root-session|hosted-session|session-host)\.js/,
            allowPath: isWorkspaceSessionContinuation,
        },
        { label: "Runtime host escape", pattern: /\.sessionHost\b|\.getSession\s*\(/ },
        { label: "Runtime event producer escape", pattern: /\.emitSessionEvent\s*\(/ },
        { label: "Runtime transcript-internal escape", pattern: /\.recordLocalToolExchange\s*\(/ },
        {
            label: "consumer-side Runtime event production or normalization",
            pattern:
                /createSessionRuntimeEvent|emitHostedSessionRuntimeEvent|normalizeRuntimeToolResult|normalizeRuntimeUsage|describeRuntimeTool|formatToolEventTitle/,
        },
        {
            label: "parallel operation-cancellation seam",
            pattern: /registerOperationCancel|cancelSessionCompaction/,
        },
    ]);
    assertEquals(violations, []);
});

Deno.test("writable transcript hydration stays inside SessionRuntime lease enforcement", async () => {
    const allowed = new Set([
        "src/shared/session/root-session.js",
        "src/shared/session/session-runtime.js",
    ]);
    const violations = await findViolations(["src", "scripts"], [
        {
            label: "writable transcript open outside SessionRuntime and root-session helpers",
            pattern: /SessionManager\.open|openPersistedRootSession|createRootSessionManager/,
            allowPath: (path) => allowed.has(path),
        },
    ]);
    assertEquals(violations, []);
});

Deno.test("owner-coordination lease mutators stay behind approved state-machine seams", async () => {
    const violations = await findViolations(["src", "scripts"], [
        {
            label: "Session Activation Lease mutator outside Runtime or approved coordination service",
            pattern:
                /\b(?:acquireSessionActivation|changeSessionActivationPhase|heartbeatSessionActivation|publishGenerationAndRelease|releaseUnchangedActivation|markSessionUncertain|markSessionReconcileRequired)\s*\(/,
            allowPath: (path) =>
                path.startsWith("src/shared/owner-coordination/") ||
                path === "src/shared/session/session-runtime.js" ||
                path === "src/ui/workspace/server/session-continuation.js",
        },
    ]);
    assertEquals(violations, []);
});

Deno.test("non-owning Session generation synchronization remains read-only", async () => {
    const violations = [];
    const workspaceContinuationSource = await Deno.readTextFile(
        join(REPO_ROOT, "src/ui/workspace/server/session-continuation.js"),
    );
    const timelineIndex = workspaceContinuationSource.indexOf("async timeline(runwieldSessionId, options = {})");
    const bootstrapIndex = workspaceContinuationSource.indexOf("async bootstrap(options)", timelineIndex);
    const timelineBody = workspaceContinuationSource.slice(timelineIndex, bootstrapIndex);
    if (
        /\b(?:loadSession|adoptManagedSession|promptSession|promptManagedSession|openPersistedRootSession)\s*\(/.test(
            timelineBody,
        )
    ) {
        violations.push("src/ui/workspace/server/session-continuation.js: timeline hydrates writable Runtime state");
    }
    if (/SessionManager\.open/.test(timelineBody)) {
        violations.push("src/ui/workspace/server/session-continuation.js: timeline opens writable SessionManager");
    }

    for (const file of await productionSourceFiles(join(REPO_ROOT, "src/ui/tui"))) {
        const path = relative(REPO_ROOT, file);
        if (!/(managed-session-sync|chat-session)\.[jt]sx?$/.test(path)) continue;
        const source = await Deno.readTextFile(file);
        if (/SessionManager\.open|openPersistedRootSession/.test(source)) {
            violations.push(`${path}: managed Session synchronization opens writable transcript state`);
        }
    }

    assertEquals(violations, []);
});

Deno.test("stable RunWield Session IDs are not confused with Hosted or Pi session ids", async () => {
    const violations = await findViolations(["src", "scripts"], [
        {
            label: "stable runwieldSessionId assigned from in-process or Pi session id",
            pattern: /\brunwieldSessionId\s*:\s*(?:session\.id|runtimeSessionId|sessionManagerId|piSessionId)\b/,
        },
        {
            label: "owner Session id assigned from in-process session id",
            pattern: /\bownerSessionId\s*:\s*session\.id\b/,
        },
    ]);
    assertEquals(violations, []);
});

Deno.test("active and isolated Agents have exactly one production lifecycle boundary each", async () => {
    const files = await productionJavaScriptFiles(join(REPO_ROOT, "src"));
    const activeMutationModules = new Set([
        "src/shared/session/hosted-session.js",
        "src/shared/session/session.js",
        "src/shared/session/agent-switching.js",
    ]);
    const activeTurnModules = new Set([
        "src/shared/session/session.js",
        "src/shared/session/agent-handler.js",
        "src/shared/session/agent-switching.js",
    ]);
    const violations = [];

    for (const file of files) {
        const path = relative(REPO_ROOT, file);
        const source = await Deno.readTextFile(file);
        if (/\brunAgentSession\b|\buseRootSession\b/.test(source)) {
            violations.push(`${path}: legacy mixed root/isolated Agent runner`);
        }
        if (
            !activeMutationModules.has(path) &&
            /\b(?:setRootAgentSession|setRootAgentName|setActiveOnMessage|ensureRootAgentSession)\b/.test(source)
        ) {
            violations.push(`${path}: active Agent state mutation outside activation transaction`);
        }
        if (!activeTurnModules.has(path) && /\brunRootTurn\s*\(/.test(source)) {
            violations.push(`${path}: direct interactive root turn outside active Agent boundary`);
        }
    }

    assertEquals(violations, []);
});

Deno.test("command surfaces do not use SessionSnapshot as active runtime authority", async () => {
    const violations = await findViolations(["src/cmd"], [
        {
            label: "active Agent read from display SessionSnapshot",
            pattern: /getSessionSnapshot\s*\([^)]*\)\?\.activeAgent\b/,
        },
        {
            label: "active execution workflow read from display SessionSnapshot",
            pattern: /getSessionSnapshot\s*\([^)]*\)\?\.activeExecutionWorkflow\b/,
        },
    ]);

    assertEquals(violations, []);
});

Deno.test("managed projection caches do not drive live activation transitions", async () => {
    const runtimeSource = await Deno.readTextFile(join(REPO_ROOT, "src/shared/session/session-runtime.js"));
    const workflowOperationIndex = runtimeSource.indexOf("async #runWorkflowOperation(");
    const promptManagedIndex = runtimeSource.indexOf("async promptManagedSession(");
    const activationTail = promptManagedIndex >= 0
        ? runtimeSource.slice(workflowOperationIndex, promptManagedIndex)
        : runtimeSource.slice(workflowOperationIndex);
    const hostedSource = await Deno.readTextFile(join(REPO_ROOT, "src/shared/session/hosted-session.js"));
    const setManagedIndex = hostedSource.indexOf("setManagedMetadata(metadata)");
    const getManagedIndex = hostedSource.indexOf("getManagedMetadata()", setManagedIndex);
    const setManagedBody = hostedSource.slice(setManagedIndex, getManagedIndex);

    assertEquals(workflowOperationIndex >= 0, true);
    assertEquals(/const agentName = [^\n]*managed\.activeAgent/.test(activationTail), false);
    assertEquals(/\|\|\s*managed\.activeAgent/.test(activationTail), false);
    assertEquals(/RuntimeEventTypes\.AGENT_CHANGED/.test(activationTail), false);
    assertEquals(setManagedIndex >= 0, true);
    assertEquals(
        /\brootAgentName\b|\bworkflowContext\b|\bactiveThinkingLevel\b|setActiveModelState/.test(setManagedBody),
        false,
    );
});

Deno.test("TUI submission flow does not branch on managed SessionSnapshot projection", async () => {
    const source = await Deno.readTextFile(join(REPO_ROOT, "src/ui/tui/chat-session.js"));

    assertEquals(/getRuntimeSnapshot\(\)\.managed\b/.test(source), false);
    assertEquals(/promptManagedSession\s*\(/.test(source), false);
    assertEquals(/promptSession\s*\(sessionId/.test(source), false);
});

Deno.test("SessionRuntime public surface remains adapter-neutral and explicit", () => {
    const methods = Object.getOwnPropertyNames(SessionRuntime.prototype).sort();
    const allowedMethods = [
        "cancelSession",
        "clearActiveExecutionWorkflow",
        "clearQueuedMessages",
        "closeAllSessions",
        "closeAllSessionsWhenIdle",
        "closeSession",
        "closeSessionWhenIdle",
        "compactSession",
        "constructor",
        "createInteractiveSession",
        "createPromptReadySession",
        "cycleSessionThinkingLevel",
        "dequeueLastQueuedMessage",
        "executePlan",
        "expandSessionPromptTemplate",
        "expandSessionSkillCommand",
        "exportSession",
        "getLastAssistantText",
        "getQueuedMessages",
        "getRuntimeActiveAgentName",
        "getRuntimeActiveExecutionWorkflow",
        "getSessionContextReport",
        "getSessionInfo",
        "getSessionMemoryBackupDir",
        "getSessionSnapshot",
        "getUserTurnSubmissionBlockMessage",
        "inspectResumableSession",
        "isManagedSessionDormant",
        "listResumableSessions",
        "listSessionContextFiles",
        "listSessionPromptTemplates",
        "listSessionSkills",
        "listSessions",
        "loadSession",
        "persistSessionImage",
        "preflightSessionImages",
        "promptManagedSession",
        "promptSession",
        "promptUserTurn",
        "queueNextTurnMessage",
        "reconfigureSessionModel",
        "reloadSession",
        "renameSession",
        "replaySession",
        "requestInteraction",
        "requestSessionHelp",
        "runIsolatedAgent",
        "runLocalShellCommand",
        "runPlanningAgent",
        "runSlicerAgent",
        "runValidation",
        "setActiveExecutionWorkflow",
        "setInteractionAdapter",
        "setProjectStateContext",
        "setSessionAutoCompaction",
        "setSessionModel",
        "setSessionThinkingLevel",
        "steerSession",
        "subscribeSessionEvents",
        "switchAgent",
        "synchronizeManagedSession",
        "takeNextTurnMessage",
        "adoptManagedSession",
    ].sort();
    assertEquals(methods, allowedMethods);

    const runtime = new SessionRuntime();
    for (
        const internal of [
            "sessionHost",
            "switchActiveAgent",
            "abortActiveSession",
            "createRootSessionManager",
            "openPersistedRootSession",
            "resolveResumeAgentName",
            "createAgentHandler",
            "ensureRootAgentSession",
            "steerRootSessionWithTarget",
            "eventListeners",
            "turnSettlements",
            "queuedMessages",
            "queueSourceSubscriptions",
            "getHostedSession",
            "getSession",
            "getActivationProof",
            "withSessionManager",
            "attachRuntimeEventSink",
            "emitSessionEvent",
            "recordLocalToolExchange",
            "setSessionHandler",
            "ensureSessionReady",
        ]
    ) {
        assertEquals(Object.hasOwn(runtime, internal), false, `${internal} must remain private`);
        assertEquals(methods.includes(internal), false, `${internal} must not be a public Runtime method`);
    }
});

for (
    const deletedPath of [
        "src/shared/session/presentation-messages.js",
        "src/shared/session/session-runtime-ui.js",
        "src/ui/tui/message-hydration.js",
        "src/ui/tui/task-completed-message.js",
        "src/shared/workflow/code-review.js",
        "src/shared/workflow/review-launcher.js",
        "src/shared/workflow/submit-plan.js",
    ]
) {
    Deno.test(`removed compatibility seam stays deleted: ${deletedPath}`, async () => {
        await assertRejects(() => Deno.stat(join(REPO_ROOT, deletedPath)), Deno.errors.NotFound);
    });
}
