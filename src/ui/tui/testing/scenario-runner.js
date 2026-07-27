/**
 * @module ui/tui/testing/scenario-runner
 * Golden TUI scenario action runner and diagnostics helpers.
 */

import { join, relative } from "@std/path";
import { assert } from "@std/assert";
import { registerFauxProvider } from "@earendil-works/pi-ai/compat";
import { parsePlanFrontMatter, savePlan } from "../../../plan-store.js";
import { withProcessGlobalTestLock } from "../../../testing/process-global-lock.js";
import { submitPlanForReview } from "../../review/plan-review.js";
import { createFauxMessageForTurn, GoldenScenarioActor } from "./scenario-actor.js";
import {
    createGoldenIsolatedEnvironment,
    GOLDEN_FAUX_API,
    GOLDEN_FAUX_MODEL,
    GOLDEN_FAUX_PROVIDER,
    writeGoldenModelConfig,
} from "./isolated-environment.js";
import { ScriptedInteractionSurface, ScriptedReviewSurface } from "./scripted-review-surface.js";
import { normalizeScreenText, VirtualTerminal } from "./virtual-terminal.js";

/**
 * @typedef {Object} GoldenScenario
 * @property {string} name
 * @property {{ columns?: number, rows?: number }} [terminal]
 * @property {Array<Object>} [actions]
 * @property {Array<import('./scenario-actor.js').GoldenScriptTurn>} [script]
 * @property {Array<{ interactionType: string, decision?: string }>} [interactions]
 * @property {Array<import('./scripted-review-surface.js').ScriptedRuntimeInteraction>} [scriptedInteractions]
 * @property {Array<import('./scripted-review-surface.js').ScriptedReviewDecision>} [reviewDecisions]
 * @property {"new" | "continue"} [sessionStartMode]
 * @property {string} [initialAgentName]
 * @property {unknown} [reviewedPlan]
 * @property {Array<(result: GoldenScenarioResult) => void | Promise<void>>} [assertions]
 * @property {number} [timeoutMs]
 * @property {boolean} [composedTui]
 */

/**
 * @typedef {Object} GoldenScenarioResult
 * @property {string} name
 * @property {Record<string, unknown>} state
 * @property {string[]} events
 * @property {string} screenText
 * @property {string} [scrollbackText]
 * @property {ReturnType<GoldenScenarioActor['diagnostics']>} actor
 * @property {string | null} artifactDir
 */

/**
 * @typedef {Object} ProjectSnapshotEntry
 * @property {"file"|"dir"} kind
 * @property {string} [hash]
 */

/** @param {Uint8Array} bytes */
async function sha256Hex(bytes) {
    const copy = new Uint8Array(bytes);
    const hash = await crypto.subtle.digest("SHA-256", copy.buffer);
    return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * @param {string} projectRoot
 * @returns {Promise<Record<string, ProjectSnapshotEntry>>}
 */
async function snapshotProjectRoot(projectRoot) {
    /** @type {Record<string, ProjectSnapshotEntry>} */
    const snapshot = {};
    /** @param {string} directory */
    async function visit(directory) {
        for await (const entry of Deno.readDir(directory)) {
            if (entry.name === ".git") continue;
            const path = join(directory, entry.name);
            const relativePath = relative(projectRoot, path);
            if (entry.isDirectory) {
                snapshot[relativePath] = { kind: "dir" };
                await visit(path);
            } else if (entry.isFile) {
                snapshot[relativePath] = { kind: "file", hash: await sha256Hex(await Deno.readFile(path)) };
            }
        }
    }
    await visit(projectRoot);
    return snapshot;
}

/**
 * @param {Record<string, ProjectSnapshotEntry>} before
 * @param {Record<string, ProjectSnapshotEntry>} after
 */
function diffProjectSnapshots(before, after) {
    const paths = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    /** @type {string[]} */
    const changes = [];
    for (const path of paths) {
        const previous = before[path];
        const current = after[path];
        if (!previous) changes.push(`added:${path}`);
        else if (!current) changes.push(`deleted:${path}`);
        else if (previous.kind !== current.kind || previous.hash !== current.hash) changes.push(`modified:${path}`);
    }
    return changes;
}

/** @param {unknown} value */
function isObject(value) {
    return Boolean(value && typeof value === "object");
}

/** @param {unknown} value */
function toolName(value) {
    if (!value || typeof value !== "object" || !("name" in value)) return null;
    const name = /** @type {{ name?: unknown }} */ (value).name;
    return typeof name === "string" ? name : null;
}

/** @param {unknown} context */
function getContextToolNames(context) {
    if (!context || typeof context !== "object" || !("tools" in context)) return [];
    const tools = /** @type {{ tools?: unknown }} */ (context).tools;
    if (!Array.isArray(tools)) return [];
    return tools.map(toolName).filter((name) => typeof name === "string");
}

/** @param {string} agentName */
function inferGoldenPhase(agentName) {
    if (agentName === "router") return "triage";
    if (agentName === "guide") return "inquiry";
    if (agentName === "planner") return "plan_review";
    return agentName || "unknown";
}

/**
 * @param {{ runwieldDir?: string }} options
 * @returns {Promise<ReturnType<typeof registerFauxProvider>>}
 */
async function registerGoldenFauxProviderForEnvironment(options = {}) {
    if (options.runwieldDir) await writeGoldenModelConfig(options.runwieldDir, { api: GOLDEN_FAUX_API });
    return registerFauxProvider({
        api: GOLDEN_FAUX_API,
        provider: GOLDEN_FAUX_PROVIDER,
        tokensPerSecond: 80,
        models: [{ id: GOLDEN_FAUX_MODEL, name: "Golden Faux Model", input: ["text", "image"] }],
    });
}

/**
 * @param {GoldenScenario} scenario
 * @param {{ keepArtifacts?: boolean, artifactRoot?: string, heartbeatPath?: string }} [options]
 * @returns {Promise<GoldenScenarioResult>}
 */
export async function runGoldenScenario(scenario, options = {}) {
    if (scenario.composedTui && Deno.env.get("WLD_GOLDEN_TUI_CHILD") !== "1") {
        throw new Error(
            "Composed Golden TUI scenarios must run through runGoldenScenarioChildProcess for subprocess isolation.",
        );
    }
    if (scenario.composedTui) return await runComposedTuiScenario(scenario, options);
    const actor = new GoldenScenarioActor(scenario.script || []);
    const expectedInteractions = [...(scenario.interactions || [])];
    /** @type {Record<string, unknown> & { screen: string, canceled: boolean, editorUsable: boolean }} */
    const state = { screen: "", canceled: false, editorUsable: true };
    /** @type {string[]} */
    const events = [];
    /** @type {string | null} */
    let artifactDir = null;
    const timeoutMs = scenario.timeoutMs || 2000;
    const startedAt = Date.now();
    try {
        for (const action of scenario.actions || []) {
            if (Date.now() - startedAt > timeoutMs) throw new Error(`Scenario timed out after ${timeoutMs}ms.`);
            if (!isObject(action)) continue;
            const typed = /** @type {any} */ (action);
            if (typed.type === "modelTurn" || typed.type === "modelProviderTurn") {
                const response = actor.next({
                    agent: typed.agent,
                    phase: typed.phase,
                    availableTools: typed.availableTools || [],
                });
                events.push(`model:${typed.agent}:${typed.phase || ""}`);
                const turn = actor.consumed.at(-1);
                if (typed.type === "modelProviderTurn" && turn) {
                    const message = createFauxMessageForTurn(turn);
                    state.lastModelMessage = message;
                    events.push("model:faux-provider");
                }
                if (typeof response === "string") state.screen = `${state.screen || ""}\n${response}`;
                continue;
            }
            if (typed.type === "screen") {
                state.screen = `${state.screen || ""}\n${typed.text || ""}`;
                events.push("screen");
                continue;
            }
            if (typed.type === "cancel") {
                state.canceled = true;
                state.editorUsable = true;
                events.push("cancellation");
                continue;
            }
            if (typed.type === "slash") {
                state.screen = `${state.screen || ""}\n/${typed.command || ""}`;
                events.push(`slash:${typed.command || ""}`);
                continue;
            }
            if (typed.type === "interaction") {
                const expected = expectedInteractions.shift();
                if (expected) {
                    if (
                        expected.interactionType !== typed.interactionType ||
                        (expected.decision && expected.decision !== typed.decision)
                    ) {
                        throw new Error(
                            `Unexpected interaction: expected ${expected.interactionType}:${
                                expected.decision || ""
                            }, got ${typed.interactionType || ""}:${typed.decision || ""}`,
                        );
                    }
                } else if (scenario.interactions) {
                    throw new Error(`Unexpected interaction: ${typed.interactionType || ""}:${typed.decision || ""}`);
                }
                events.push(`interaction:${typed.interactionType || ""}:${typed.decision || ""}`);
                state.lastInteraction = typed;
                continue;
            }
            if (typed.type === "planReviewTransaction") {
                const decisions = typed.decisions || [];
                const reviewSurface = new ScriptedReviewSurface(decisions);
                const planDir = await Deno.makeTempDir({ prefix: "runwield-golden-plan-review-" });
                const plansDir = join(planDir, "plans");
                await Deno.mkdir(plansDir, { recursive: true });
                const planPath = join(plansDir, "plan.md");
                await Deno.writeTextFile(planPath, typed.plan || "# Plan\n\nDo the thing.\n");
                const lifecycleEvents = [];
                try {
                    for (let reviewIndex = 0; reviewIndex < decisions.length; reviewIndex += 1) {
                        const result = await submitPlanForReview({
                            cwd: planDir,
                            planName: "plan",
                            planPath,
                            triageMeta: typed.triageMeta || {
                                classification: "FEATURE",
                                complexity: "LOW",
                                summary: "Golden Plan Review contract",
                            },
                            __deps: {
                                startPlanReviewSurface: (request) => {
                                    const response = reviewSurface.submit(
                                        /** @type {Record<string, unknown>} */ (request),
                                    );
                                    return Promise.resolve({
                                        url: "http://127.0.0.1:0/review",
                                        opened: true,
                                        waitForDecision: () =>
                                            Promise.resolve({ ...response, plan: typed.reviewedPlan }),
                                        stop: () => {
                                            events.push("plan-review:surface-stopped");
                                        },
                                    });
                                },
                            },
                        });
                        const lifecycleEvent = result.approved ? "review_approved" : "review_feedback";
                        lifecycleEvents.push({ event: lifecycleEvent });
                        events.push(`interaction:PLAN_REVIEW:${result.approved ? "approved" : "feedback"}`);
                        events.push(lifecycleEvent);
                    }
                    reviewSurface.assertComplete();
                    const parsed = parsePlanFrontMatter(await Deno.readTextFile(planPath));
                    state.planReview = { attrs: parsed.attrs, lifecycleEvents, consumed: reviewSurface.consumed };
                    state.screen = `${state.screen || ""}\n${lifecycleEvents.map((event) => event.event).join("\n")}`;
                } finally {
                    await Deno.remove(planDir, { recursive: true }).catch(() => {});
                }
                continue;
            }
            throw new Error(`Unknown scenario action: ${typed.type}`);
        }
        actor.assertComplete();
        if (expectedInteractions.length) {
            throw new Error(
                `Missing expected interactions: ${
                    expectedInteractions.map((item) => `${item.interactionType}:${item.decision || ""}`).join(",")
                }`,
            );
        }
        const result = {
            name: scenario.name,
            state,
            events,
            screenText: normalizeScreenText(String(state.screen || "")),
            actor: actor.diagnostics(),
            artifactDir,
        };
        for (const assertion of scenario.assertions || []) await assertion(result);
        return result;
    } catch (error) {
        if (options.keepArtifacts !== false) {
            artifactDir = await Deno.makeTempDir({
                dir: options.artifactRoot,
                prefix: "runwield-golden-tui-failure-",
            });
            await Deno.writeTextFile(
                join(artifactDir, "diagnostics.json"),
                JSON.stringify(
                    {
                        scenario: scenario.name,
                        error: error instanceof Error ? error.message : String(error),
                        screenText: normalizeScreenText(String(state.screen || "")),
                        events,
                        actor: actor.diagnostics(),
                        state,
                    },
                    null,
                    2,
                ),
            );
        }
        throw error;
    }
}

/**
 * @param {GoldenScenario} scenario
 * @param {{ keepArtifacts?: boolean, artifactRoot?: string, heartbeatPath?: string }} options
 * @returns {Promise<GoldenScenarioResult>}
 */
async function runComposedTuiScenario(scenario, options) {
    return await withProcessGlobalTestLock(async () => {
        const useCurrentEnvironment = Deno.env.get("WLD_GOLDEN_TUI_CHILD") === "1";
        const previousHome = Deno.env.get("HOME");
        const previousCwd = Deno.cwd();
        const env = useCurrentEnvironment
            ? null
            : await createGoldenIsolatedEnvironment({ keep: options.keepArtifacts });
        if (env) {
            for (const [key, value] of Object.entries(env.env)) Deno.env.set(key, value);
            Deno.chdir(env.projectRoot);
        }
        const initStatePath = env?.runwieldDir ? join(env.runwieldDir, "init-state.json") : null;
        if (initStatePath) {
            const { _setTestStatePath } = await import("../../../cmd/init/init-state.js");
            _setTestStatePath(initStatePath);
        }
        const projectSnapshotBefore = await snapshotProjectRoot(Deno.cwd());
        const fauxProvider = await registerGoldenFauxProviderForEnvironment({ runwieldDir: env?.runwieldDir });
        const actor = new GoldenScenarioActor(scenario.script || []);
        /** @type {Map<string, number>} */
        const turnOrdinals = new Map();
        const { createInteractiveTuiComposition } = await import("../chat-session.js");
        const terminal = new VirtualTerminal(scenario.terminal);
        /** @type {Awaited<ReturnType<typeof createInteractiveTuiComposition>> | null} */
        let composition = null;
        /** @type {string[]} */
        const events = [];
        /** @type {Record<string, unknown>} */
        const state = { canceled: false, editorUsable: true, cleanupSucceeded: false };
        /** @type {() => void} */
        let unsubscribe = () => {};
        /** @type {string | null} */
        let artifactDir = null;
        /** @type {Array<{ event: string, status?: unknown, updatedAt?: unknown }>} */
        const persistedLifecycleEvents = [];
        const writeHeartbeat = async () => {
            if (!options.heartbeatPath) return;
            await Deno.mkdir(join(options.heartbeatPath, ".."), { recursive: true }).catch(() => {});
            await Deno.writeTextFile(
                options.heartbeatPath,
                JSON.stringify(
                    {
                        scenario: scenario.name,
                        screenText: terminal.getScreenText(),
                        scrollback: terminal.getScrollbackText?.(),
                        events,
                        state,
                        actor: actor.diagnostics(),
                        runtime: composition?.runtime.getSessionSnapshot(composition.sessionId),
                        cwd: Deno.cwd(),
                        home: Deno.env.get("HOME"),
                    },
                    null,
                    2,
                ),
            ).catch(() => {});
        };
        const reviewSurface = scenario.reviewDecisions
            ? new ScriptedReviewSurface(/** @type {any[]} */ (scenario.reviewDecisions))
            : null;
        const interactionSurface = scenario.scriptedInteractions
            ? new ScriptedInteractionSurface(/** @type {any[]} */ (scenario.scriptedInteractions))
            : null;
        /** @type {"select"|"text"|"approval"|null} */
        let activeScriptedInteractionType = null;
        try {
            fauxProvider.setResponses(
                (scenario.script || []).map(() => (context) => {
                    const snapshot = composition?.runtime.getSessionSnapshot(composition.sessionId);
                    const agent = snapshot?.activeAgent || "unknown";
                    const phase = inferGoldenPhase(agent);
                    const availableTools = getContextToolNames(context);
                    const ordinalKey = `${agent}:${phase}`;
                    const ordinal = (turnOrdinals.get(ordinalKey) || 0) + 1;
                    turnOrdinals.set(ordinalKey, ordinal);
                    const response = actor.next({ agent, phase, ordinal, availableTools });
                    events.push(`model:faux-provider:${agent}:${phase}`);
                    return createFauxMessageForTurn(actor.consumed.at(-1) || /** @type {any} */ ({ response }));
                }),
            );
            composition = await createInteractiveTuiComposition(null, {
                terminal,
                sessionStartMode: scenario.sessionStartMode || "new",
                initialAgentName: scenario.initialAgentName || "router",
                initialAgentModel: `${GOLDEN_FAUX_PROVIDER}/${GOLDEN_FAUX_MODEL}`,
                interactionDependencies: reviewSurface
                    ? {
                        submitPlanForReview: async (request) => {
                            const result = await submitPlanForReview({
                                ...request,
                                __deps: {
                                    startPlanReviewSurface: (surfaceRequest) => {
                                        const response = reviewSurface.submit(
                                            /** @type {Record<string, unknown>} */ (surfaceRequest),
                                        );
                                        return Promise.resolve({
                                            url: "http://127.0.0.1:0/review",
                                            opened: true,
                                            waitForDecision: () =>
                                                Promise.resolve({
                                                    ...response,
                                                    plan: scenario.reviewedPlan || response.plan,
                                                }),
                                            stop: () => {
                                                events.push("plan-review:surface-stopped");
                                            },
                                        });
                                    },
                                },
                            });
                            const persistedPlan = await Deno.readTextFile(request.planPath);
                            const persistedAttrs = parsePlanFrontMatter(persistedPlan).attrs;
                            persistedLifecycleEvents.push({
                                event: result.approved ? "review_approved" : "review_feedback",
                                status: persistedAttrs.status,
                                updatedAt: persistedAttrs.updatedAt,
                            });
                            events.push(`interaction:PLAN_REVIEW:${result.approved ? "approved" : "feedback"}`);
                            events.push(result.approved ? "review_approved" : "review_feedback");
                            return result;
                        },
                    }
                    : undefined,
            });
            await writeHeartbeat();
            if (interactionSurface) {
                const originalPromptSelect = composition.uiAPI.promptSelect?.bind(composition.uiAPI);
                const originalPromptText = composition.uiAPI.promptText?.bind(composition.uiAPI);
                composition.uiAPI.promptSelect = (prompt, options) => {
                    const value = interactionSurface.next(activeScriptedInteractionType || "select", {
                        prompt,
                        options,
                    });
                    if (value === null) return Promise.resolve(null);
                    if (!Array.isArray(options) || !options.some((option) => option.value === value)) {
                        throw new Error(`Scripted select returned invalid option: ${value}`);
                    }
                    return Promise.resolve(value);
                };
                composition.uiAPI.promptText = (prompt, options) => {
                    const value = interactionSurface.next("text", { prompt, options });
                    return Promise.resolve(value === null ? null : String(value));
                };
                if (!originalPromptSelect || !originalPromptText) {
                    throw new Error("Runtime interaction scripting requires TUI prompt methods.");
                }
            }
            unsubscribe = composition.runtime.subscribeSessionEvents(composition.sessionId, (event) => {
                events.push(`runtime:${event.type}`);
                if (event.type === "agent_changed") {
                    const name = /** @type {{ agentName?: string }} */ (event).agentName || "";
                    events.push(`runtime:agent:${name}`);
                    state.activeAgent = name;
                }
                if (event.type === "cancellation") {
                    state.canceled = true;
                    events.push("runtime:cancellation");
                }
                if (event.type === "tool_start") {
                    const name = /** @type {{ toolName?: string }} */ (event).toolName || "";
                    events.push(`runtime:tool:start:${name}`);
                }
                if (event.type === "tool_end") {
                    const name = /** @type {{ toolName?: string }} */ (event).toolName || "";
                    events.push(`runtime:tool:end:${name}`);
                }
                if (event.type === "assistant_text_delta") events.push("runtime:assistant:text");
                if (event.type === "assistant_thinking_delta") events.push("runtime:assistant:thinking");
                if (event.type === "queued_message_changed") events.push("runtime:queue");
            });
            for (const action of scenario.actions || []) {
                if (!isObject(action)) continue;
                const typed = /** @type {any} */ (action);
                if (typed.type === "type") {
                    terminal.typeText(String(typed.text || ""));
                    events.push(`terminal:type:${typed.text || ""}`);
                } else if (typed.type === "enter") terminal.pressEnter();
                else if (typed.type === "escape") terminal.pressEscape();
                else if (typed.type === "ctrlC") terminal.pressCtrlC();
                else if (typed.type === "resize") terminal.resize(typed.columns || 80, typed.rows || 24);
                else if (typed.type === "writeProjectFile") {
                    const path = join(Deno.cwd(), typed.path || "");
                    await Deno.mkdir(join(path, ".."), { recursive: true });
                    await Deno.writeTextFile(path, String(typed.text || ""));
                    events.push(`project:write:${typed.path || ""}`);
                } else if (typed.type === "assertProjectFile") {
                    const path = join(Deno.cwd(), typed.path || "");
                    const exists = await Deno.stat(path).then(() => true).catch(() => false);
                    state.projectMutation = exists ? "mutated" : "clean";
                    if (exists !== Boolean(typed.exists)) {
                        throw new Error(`Project mutation assertion failed for ${typed.path || ""}: exists=${exists}`);
                    }
                    events.push("project:file-checked");
                } else if (typed.type === "assertProjectUnchanged") {
                    const changes = diffProjectSnapshots(projectSnapshotBefore, await snapshotProjectRoot(Deno.cwd()));
                    state.projectMutation = changes.length ? "mutated" : "clean";
                    state.projectMutationChanges = changes;
                    if (changes.length) throw new Error(`Project mutation assertion failed: ${changes.join(", ")}`);
                    events.push("project:mutation-checked");
                } else if (typed.type === "runEpicContinuationReplacement") {
                    const previousSessionId = composition.sessionId;
                    await savePlan(Deno.cwd(), "epic", "# Epic", {
                        classification: "PROJECT",
                        status: "ready_for_work",
                        summary: "Golden Epic",
                        affectedPaths: [],
                    });
                    await savePlan(Deno.cwd(), "epic/01-done", "# Done", {
                        classification: "FEATURE",
                        status: "verified",
                        summary: "Done child",
                        affectedPaths: [],
                        parentPlan: "epic",
                        order: 1,
                    });
                    await savePlan(Deno.cwd(), "epic/02-next", "# Next", {
                        classification: "FEATURE",
                        status: "draft",
                        summary: "Next child",
                        affectedPaths: [],
                        parentPlan: "epic",
                        order: 2,
                    });
                    await composition.runtime.runValidation(composition.sessionId, {
                        planName: "epic/01-done",
                        planContent: "# Done",
                        triageMeta: {
                            classification: "FEATURE",
                            status: "verified",
                            summary: "Done child",
                            affectedPaths: [],
                            parentPlan: "epic",
                        },
                        finalAgentName: "router",
                        executionContext: {
                            executionMode: "non_git_in_place",
                            projectRoot: Deno.cwd(),
                            executionCwd: Deno.cwd(),
                        },
                        __deps: {
                            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "ok" }),
                            getDiffText: () => Promise.resolve(""),
                            runIsolatedAgentSession: () => Promise.resolve([]),
                            getCodeReviewMode: () => "none",
                            recordPlanEvent: () => Promise.resolve({}),
                            recordWorkflowMetric: () => Promise.resolve(null),
                            runManualQaChecklistPrompt: () => Promise.resolve([]),
                            autoGenerateWorkRecordForCompletedPlan: () => Promise.resolve({ ok: true, skipped: true }),
                            formatWorkRecordAutoGenerationResult: () => "Work Record generation skipped.",
                            resolveValidationExecutionContext: (/** @type {{ planName?: string }} */ args) =>
                                Promise.resolve({
                                    kind: "ok",
                                    context: {
                                        executionMode: "non_git_in_place",
                                        planName: args.planName,
                                        projectRoot: Deno.cwd(),
                                        executionCwd: Deno.cwd(),
                                        source: "explicit",
                                    },
                                }),
                        },
                    });
                    state.replacedSession = { previousSessionId, currentSessionId: composition.sessionId };
                    events.push("runtime:session-replaced:golden");
                } else if (typed.type === "runtimeInteraction") {
                    const request =
                        /** @type {import('../../../shared/session/session-runtime-interactions.js').RuntimeInteractionRequest} */ (typed
                            .request || {});
                    activeScriptedInteractionType = request.type === "approval"
                        ? "approval"
                        : request.type === "text"
                        ? "text"
                        : "select";
                    try {
                        const response = await composition.runtime.requestInteraction(composition.sessionId, request);
                        state.lastInteraction = response;
                        events.push(`interaction:${request.type}:${response.outcome}`);
                        if (typed.expectedOutcome && response.outcome !== typed.expectedOutcome) {
                            throw new Error(
                                `Runtime interaction expected ${typed.expectedOutcome}, got ${response.outcome}`,
                            );
                        }
                    } finally {
                        activeScriptedInteractionType = null;
                    }
                } else if (typed.type === "sleep") {
                    await new Promise((resolve) => setTimeout(resolve, typed.ms || 1000));
                } else if (typed.type === "waitForEvent") {
                    const expected = String(typed.event || "");
                    const timeoutMs = typed.timeoutMs || scenario.timeoutMs || 3000;
                    const startedAt = Date.now();
                    while (!events.includes(expected)) {
                        if (Date.now() - startedAt > timeoutMs) {
                            throw new Error(`Timed out waiting for event: ${expected}`);
                        }
                        await terminal.flush();
                        await new Promise((resolve) => setTimeout(resolve, 20));
                    }
                } else if (typed.type === "waitForIdle") {
                    await composition.waitForIdle(typed.timeoutMs || scenario.timeoutMs || 3000);
                } else {
                    throw new Error(`Unknown composed scenario action: ${typed.type}`);
                }
                await terminal.flush();
                await writeHeartbeat();
            }
            await composition.waitForIdle?.(scenario.timeoutMs || 3000).catch(() => {});
            await terminal.flush();
            await writeHeartbeat();
            const snapshot = composition.runtime.getSessionSnapshot(composition.sessionId);
            state.screen = terminal.getScreenText();
            state.scrollback = terminal.getScrollbackText();
            state.snapshot = snapshot;
            state.activeAgent = snapshot?.activeAgent || state.activeAgent;
            state.editorUsable = snapshot?.busy === false;
            if (interactionSurface) {
                interactionSurface.assertComplete();
                state.scriptedInteractions = interactionSurface.consumed;
            }
            if (reviewSurface) {
                reviewSurface.assertComplete();
                const parsedPlan = await Deno.readTextFile(join(Deno.cwd(), "plans", "plan.md"));
                state.planReview = {
                    attrs: parsePlanFrontMatter(parsedPlan).attrs,
                    lifecycleEvents: persistedLifecycleEvents,
                    consumed: reviewSurface.consumed,
                    plan: parsedPlan,
                };
            }
            const result = {
                name: scenario.name,
                state,
                events,
                screenText: terminal.getScreenText(),
                scrollbackText: terminal.getScrollbackText(),
                actor: actor.diagnostics(),
                artifactDir,
            };
            for (const assertion of scenario.assertions || []) await assertion(result);
            actor.assertComplete();
            return result;
        } catch (error) {
            if (options.keepArtifacts !== false) {
                artifactDir = await Deno.makeTempDir({
                    dir: options.artifactRoot,
                    prefix: "runwield-golden-tui-failure-",
                });
                /** @type {Error & { artifactDir?: string }} */ (error instanceof Error
                    ? error
                    : new Error(String(error))).artifactDir = artifactDir;
                if (error && typeof error === "object") {
                    /** @type {{ artifactDir?: string }} */ (error).artifactDir = artifactDir;
                }
                await Deno.writeTextFile(
                    join(artifactDir, "diagnostics.json"),
                    JSON.stringify(
                        {
                            scenario: scenario.name,
                            error: error instanceof Error ? error.message : String(error),
                            screenText: terminal.getScreenText(),
                            scrollback: terminal.getScrollbackText?.(),
                            events,
                            state,
                            actor: actor.diagnostics(),
                            runtime: composition?.runtime.getSessionSnapshot(composition.sessionId),
                            cwd: Deno.cwd(),
                            home: Deno.env.get("HOME"),
                        },
                        null,
                        2,
                    ),
                );
            }
            throw error;
        } finally {
            unsubscribe();
            await composition?.dispose?.();
            fauxProvider.unregister?.();
            if (env) {
                Deno.chdir(previousCwd);
                if (previousHome === undefined) Deno.env.delete("HOME");
                else Deno.env.set("HOME", previousHome);
                await env.cleanup();
                state.cleanupSucceeded = true;
            }
        }
    });
}

/**
 * @param {GoldenScenarioResult} result
 * @param {string} text
 */
export function assertScreenIncludes(result, text) {
    const textSurfaces = [result.screenText, result.scrollbackText || ""];
    assert(
        textSurfaces.some((surfaceText) => surfaceText.includes(text)),
        `Expected screen to include ${JSON.stringify(text)}. Screen:\n${result.screenText}`,
    );
}

/**
 * @param {GoldenScenarioResult} result
 * @param {string} event
 */
export function assertEventIncludes(result, event) {
    assert(result.events.includes(event), `Expected events to include ${event}; got ${result.events.join(", ")}`);
}
