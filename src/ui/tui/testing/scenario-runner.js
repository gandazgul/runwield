/**
 * @module ui/tui/testing/scenario-runner
 * Golden TUI scenario action runner and diagnostics helpers.
 */

import { dirname, join, relative } from "@std/path";
import { createSessionRuntime } from "../../../shared/session/session-runtime.js";
import { openFileSessionStore } from "../../../shared/session/file-session-store.ts";
import { assert } from "@std/assert";
import { registerFauxProvider } from "@earendil-works/pi-ai/compat";
import { findPlansByParent, getStoredPlanPath, loadPlan, parsePlanFrontMatter } from "../../../plan-store.js";
import { withProcessGlobalTestLock } from "../../../testing/process-global-lock.js";
import { submitPlanForReview } from "../../review/plan-review.ts";
import { createScriptedReviewBrowser } from "../../review/review-test-fixture.ts";
import { createFauxMessageForTurn, GoldenScenarioActor } from "./scenario-actor.js";
import {
    createGoldenIsolatedEnvironment,
    GOLDEN_FAUX_API,
    GOLDEN_FAUX_MODEL,
    GOLDEN_FAUX_PROVIDER,
    writeGoldenModelConfig,
} from "./isolated-environment.js";
import {
    ScriptedHumanReviewSurface,
    ScriptedInteractionSurface,
    ScriptedReviewSurface,
} from "./scripted-review-surface.js";
import { normalizeScreenText, VirtualTerminal } from "./virtual-terminal.js";
import { createWorkRecordMnemosyneFixture } from "../../../shared/work-records/test-fixtures/mnemosyne-port.ts";
import { isRunWieldOwnedRuntimePath } from "../../../shared/runwield-owned-paths.ts";
import { NO_OPEN_BROWSER_PORT } from "../../../shared/browser-port.ts";
import { getCwd } from "../../../constants.js";
import { getWorktreeRegistryPath } from "../../../shared/worktree-registry.js";

/**
 * Scenario waits poll and return the moment the condition holds, so this budget
 * only bounds failures. Keep it generous: a tight bound buys nothing on the
 * success path and turns a loaded CI runner into a flake.
 */
const DEFAULT_WAIT_TIMEOUT_MS = 20_000;

/**
 * Keep the browser external while driving the real review launcher, server,
 * token check, and decision transport.
 *
 * @param {ScriptedReviewSurface | null} reviewSurface
 * @param {ScriptedHumanReviewSurface | null} humanReviewSurface
 * @param {Record<string, unknown>} request
 * @param {unknown} reviewedPlan
 * @param {(response: ReturnType<ScriptedReviewSurface['submit']>) => void} [onDecision]
 * @param {(response: ReturnType<ScriptedHumanReviewSurface['submit']>) => void} [onHumanReviewDecision]
 */
function createGoldenReviewBrowser(
    reviewSurface,
    humanReviewSurface,
    request,
    reviewedPlan,
    onDecision,
    onHumanReviewDecision,
) {
    return {
        /** @param {string} url */
        async open(url) {
            if (url.includes("/review/code")) {
                if (!humanReviewSurface) throw new Error("Unexpected Local Human Code Review interaction.");
                const response = humanReviewSurface.submit({ url });
                const opened = await createScriptedReviewBrowser(response.approved ? "decision" : "feedback", {
                    approved: response.approved,
                    feedback: response.feedback,
                    annotations: response.annotations,
                    images: response.images,
                    reviewType: "code",
                }).browser.open(url);
                onHumanReviewDecision?.(response);
                return opened;
            }
            if (!reviewSurface) throw new Error("Unexpected Plan Review interaction.");
            const response = reviewSurface.submit(request);
            const editedPlan = typeof reviewedPlan === "string"
                ? reviewedPlan
                : typeof response.plan === "string"
                ? response.plan
                : undefined;
            /** @type {"run" | "decompose" | "later" | undefined} */
            const approvalAction = response.approvalAction === "run" || response.approvalAction === "decompose" ||
                    response.approvalAction === "later"
                ? response.approvalAction
                : undefined;
            const body = {
                approved: response.approved,
                feedback: response.feedback,
                approvalAction,
                ...(editedPlan ? { plan: editedPlan } : {}),
            };
            const opened = await createScriptedReviewBrowser(response.approved ? "decision" : "deny", body).browser
                .open(url);
            onDecision?.(response);
            return opened;
        },
    };
}

/**
 * Read the lifecycle state synchronously from isolated fixture Plans at the
 * interaction-resolved boundary, before the workflow can advance it again.
 *
 * @param {string} directory
 * @param {string} expectedStatus
 * @returns {{ status?: unknown, updatedAt?: unknown }}
 */
function findFixturePlanLifecycle(directory, expectedStatus) {
    try {
        for (const entry of Deno.readDirSync(directory)) {
            const path = join(directory, entry.name);
            if (entry.isDirectory) {
                const nested = findFixturePlanLifecycle(path, expectedStatus);
                if (nested.status === expectedStatus) return nested;
            } else if (entry.isFile && entry.name.endsWith(".md")) {
                const attrs = parsePlanFrontMatter(Deno.readTextFileSync(path)).attrs;
                if (attrs.status === expectedStatus) return { status: attrs.status, updatedAt: attrs.updatedAt };
            }
        }
    } catch {
        // A missing fixture directory is represented as no observed lifecycle.
    }
    return {};
}

/**
 * @typedef {Object} GoldenScenario
 * @property {string} name
 * @property {{ columns?: number, rows?: number }} [terminal]
 * @property {Array<Object>} [actions]
 * @property {Array<import('./scenario-actor.js').GoldenScriptTurn>} [script]
 * @property {Array<{ interactionType: string, decision?: string }>} [interactions]
 * @property {Array<import('./scripted-review-surface.js').ScriptedRuntimeInteraction>} [scriptedInteractions]
 * @property {Array<import('./scripted-review-surface.js').ScriptedReviewDecision>} [reviewDecisions]
 * @property {Array<import('./scripted-review-surface.js').ScriptedHumanReviewDecision>} [humanReviewDecisions]
 * @property {"new" | "continue"} [sessionStartMode]
 * @property {string} [initialAgentName]
 * @property {unknown} [reviewedPlan]
 * @property {Array<{ path: string, text: string }>} [initialProjectFiles]
 * @property {Array<{ path: string, text: string }>} [committedProjectFiles]
 * @property {boolean} [nonGitProject]
 * @property {Array<((result: GoldenScenarioResult) => void | Promise<void>) & { goldenCoverage?: string[] }>} [assertions]
 * @property {string[]} [coverage]
 * @property {number} [timeoutMs]
 * @property {boolean} [composedTui]
 * @property {{ userText: string, agentName?: string, assistantText: string }} [priorSession]
 * @property {"default" | "none" | "provider-without-models"} [modelSetup]
 * @property {Array<{ marker: string, keys?: string, text?: string }>} [startupInput]
 * @property {boolean} [expectedCleanExit]
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

/**
 * Evidence a composed scenario accumulates for its golden snapshot.
 *
 * The fields below are read back during the run, so they are typed. The rest are
 * written once by whichever scenario action produced them and then serialized —
 * which is what `GoldenScenarioResult.state` already declares as an opaque record,
 * and what the golden files, not the type system, assert.
 *
 * @typedef {Record<string, unknown> & {
 *     canceled: boolean,
 *     editorUsable: boolean,
 *     cleanupSucceeded: boolean,
 *     priorSession: Awaited<ReturnType<typeof seedGoldenPriorSession>> | null,
 *     turnSequence: string[],
 *     screen?: string,
 *     activeAgent?: string,
 * }} ComposedScenarioState
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

/**
 * @param {string[]} args
 * @param {string} cwd
 */
async function runGoldenGit(args, cwd) {
    const output = await new Deno.Command("git", { args, cwd }).output();
    const stdout = new TextDecoder().decode(output.stdout).trim();
    const stderr = new TextDecoder().decode(output.stderr).trim();
    if (!output.success) throw new Error(`git ${args.join(" ")} failed: ${stderr || stdout}`);
    return stdout;
}

/** @param {string} agentName */
function inferGoldenPhase(agentName) {
    if (agentName === "router") return "triage";
    if (agentName === "guide") return "inquiry";
    if (agentName === "planner") return "plan_review";
    return agentName || "unknown";
}

/**
 * @param {string | undefined} snapshotAgentName
 * @param {string[]} availableTools
 * @param {string} [systemPrompt]
 * @returns {{ agent: string, phase: string }}
 */
function inferGoldenTurnIdentity(snapshotAgentName, availableTools, systemPrompt = "") {
    // The Recorder runs in its own non-interactive session, so the composed
    // Session's snapshot still names whichever Agent was last active there. Its
    // system prompt is the only thing that distinguishes it — which is the same
    // signal a real model has, and it decides who to answer as, not what the
    // scenario asserts about the workflow.
    if (systemPrompt.includes("You are the Recorder")) return { agent: "recorder", phase: "work_record" };
    // Validation repairs run in an independent focused session. The composed
    // TUI snapshot can still name Guide (or another prior Agent), so use the
    // isolated session's system prompt to match the scripted repair turn.
    if (systemPrompt.includes("You are the Validation Repair Engineer")) {
        return { agent: "engineer", phase: "engineer" };
    }
    if (systemPrompt.includes("You are the Software Engineer")) return { agent: "engineer", phase: "engineer" };
    if (availableTools.includes("slicer_finalize_decomposition")) return { agent: "slicer", phase: "slicer" };
    if (availableTools.includes("plan_written")) return { agent: "planner", phase: "plan_review" };
    // Workflow Validation runs the Semantic Reviewer in an isolated session while
    // the composed Runtime still reports Engineer as the active Agent, so only the
    // tool set tells them apart. Giving the Reviewer its own identity keeps its
    // turns out of the Engineer's ordinal space — sharing it made a Reviewer turn
    // and an Engineer repair turn compete for the same ordinal, and the matcher
    // resolved that collision by tool set only after ordinal had already decided.
    if (availableTools.includes("review_complete")) return { agent: "reviewer", phase: "semantic_review" };
    const agent = snapshotAgentName || "unknown";
    return { agent, phase: inferGoldenPhase(agent) };
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
 * @param {{ keepArtifacts?: boolean, artifactRoot?: string, heartbeatPath?: string, onReady?: () => void }} [options]
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
    const timeoutMs = scenario.timeoutMs || DEFAULT_WAIT_TIMEOUT_MS;
    options.onReady?.();
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
                const plansDir = join(planDir, "docs", "plans");
                await Deno.mkdir(plansDir, { recursive: true });
                const planPath = join(plansDir, "plan.md");
                await Deno.writeTextFile(planPath, typed.plan || "# Plan\n\nDo the thing.\n");
                const lifecycleEvents = [];
                try {
                    for (let reviewIndex = 0; reviewIndex < decisions.length; reviewIndex += 1) {
                        const triageMeta = typed.triageMeta || {
                            classification: "FEATURE",
                            complexity: "LOW",
                            summary: "Golden Plan Review contract",
                        };
                        const result = await submitPlanForReview({
                            cwd: planDir,
                            planName: "plan",
                            planPath,
                            triageMeta,
                            browser: createGoldenReviewBrowser(
                                reviewSurface,
                                null,
                                { cwd: planDir, planName: "plan", planPath, triageMeta },
                                typed.reviewedPlan,
                            ),
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
 * @param {GoldenScenario["priorSession"]} priorSession
 * @param {ReturnType<typeof registerFauxProvider>} fauxProvider
 */
async function seedGoldenPriorSession(priorSession, fauxProvider) {
    if (!priorSession) return null;
    const sessionStore = openFileSessionStore();
    const runtime = createSessionRuntime({ sessionStore, ownerProcessKind: "tui" });
    try {
        fauxProvider.setResponses([() =>
            createFauxMessageForTurn({
                id: "prior-session-seed",
                agent: priorSession.agentName || "guide",
                phase: priorSession.agentName || "guide",
                text: priorSession.assistantText,
            })]);
        const created = await runtime.createInteractiveSession({ cwd: Deno.cwd(), mode: "new" });
        if (priorSession.agentName) await runtime.switchAgent(created.sessionId, { agentName: priorSession.agentName });
        await runtime.promptSession(created.sessionId, { initialRequest: priorSession.userText });
        const replay = await runtime.replaySession(created.sessionId);
        runtime.closeAllSessions();
        return { sessionId: created.sessionId, replayed: replay.replayed || 0 };
    } finally {
        sessionStore.close?.();
    }
}

/**
 * @param {GoldenScenario} scenario
 * @param {{ keepArtifacts?: boolean, artifactRoot?: string, heartbeatPath?: string, onReady?: () => void }} options
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
        const runwieldDir = env?.runwieldDir || Deno.env.get("RUNWIELD_HOME") || null;
        const initStatePath = runwieldDir ? join(runwieldDir, "init-state.json") : null;
        if (initStatePath) {
            const { _setTestStatePath } = await import("../../../cmd/init/init-state.ts");
            _setTestStatePath(initStatePath);
        }
        for (const fixture of scenario.initialProjectFiles || []) {
            if (!isObject(fixture)) continue;
            const path = join(Deno.cwd(), String(/** @type {any} */ (fixture).path || ""));
            await Deno.mkdir(join(path, ".."), { recursive: true });
            await Deno.writeTextFile(path, String(/** @type {any} */ (fixture).text || ""));
        }
        // Committed baseline state, as opposed to `initialProjectFiles`, which stay
        // dirty in the working tree. Direct Delivery refuses to merge a validated
        // worktree branch when the primary checkout has uncommitted changes that
        // overlap it, so any file both the fixture and execution touch — project
        // `.wld/settings.json` above all — has to start committed the way it would
        // be in a real Project.
        const committedProjectFiles = scenario.committedProjectFiles || [];
        if (committedProjectFiles.length > 0) {
            for (const fixture of committedProjectFiles) {
                if (!isObject(fixture)) continue;
                const path = join(Deno.cwd(), String(/** @type {any} */ (fixture).path || ""));
                await Deno.mkdir(join(path, ".."), { recursive: true });
                await Deno.writeTextFile(path, String(/** @type {any} */ (fixture).text || ""));
            }
            await runGoldenGit(["add", "-A"], Deno.cwd());
            await runGoldenGit(["commit", "-m", "Golden fixture baseline"], Deno.cwd());
        }
        if (scenario.nonGitProject) {
            await Deno.remove(join(Deno.cwd(), ".git"), { recursive: true }).catch(() => {});
        }
        if (runwieldDir && scenario.modelSetup === "none") {
            await Deno.remove(join(runwieldDir, "models.json")).catch(() => {});
            await Deno.writeTextFile(
                join(runwieldDir, "settings.json"),
                JSON.stringify({ theme: "default", notifications: { enabled: false } }),
            );
        } else if (runwieldDir && scenario.modelSetup === "provider-without-models") {
            await Deno.writeTextFile(
                join(runwieldDir, "models.json"),
                JSON.stringify({ providers: { empty: { name: "Empty Golden Provider", apiKey: "golden-test-key" } } }),
            );
            await Deno.writeTextFile(
                join(runwieldDir, "settings.json"),
                JSON.stringify({ theme: "default", notifications: { enabled: false } }),
            );
        }
        const projectSnapshotBefore = await snapshotProjectRoot(Deno.cwd());
        const fauxProvider = scenario.modelSetup === "none" || scenario.modelSetup === "provider-without-models"
            ? null
            : await registerGoldenFauxProviderForEnvironment({ runwieldDir: runwieldDir || undefined });
        const priorSessionState = fauxProvider
            ? await seedGoldenPriorSession(scenario.priorSession, fauxProvider)
            : null;
        const actor = new GoldenScenarioActor(scenario.script || []);
        /** @type {Map<string, number>} */
        const turnOrdinals = new Map();
        const { createInteractiveTuiComposition } = await import("../interactive-tui-composition.ts");
        let terminal = new VirtualTerminal(scenario.terminal);
        /** @type {Awaited<ReturnType<typeof createInteractiveTuiComposition>> | null} */
        let composition = null;
        /** @type {Map<string, { terminal: VirtualTerminal, composition: Awaited<ReturnType<typeof createInteractiveTuiComposition>>, unsubscribe: () => void }>} */
        const concurrentSessions = new Map();
        /** @type {string[]} */
        const events = [];
        /** @type {string[]} */
        const turnSequence = [];
        /** @type {string} */
        let lastWorkflowPlanName = "";
        /** @type {ComposedScenarioState} */
        const state = {
            canceled: false,
            editorUsable: true,
            cleanupSucceeded: false,
            priorSession: priorSessionState,
            turnSequence,
        };
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
        /** @type {Array<ReturnType<ScriptedReviewSurface['submit']>>} */
        const pendingReviewLifecycleObservations = [];
        /** @param {ReturnType<ScriptedReviewSurface['submit']>} response */
        const observeReviewDecision = (response) => {
            const event = response.approved ? "review_approved" : "review_feedback";
            events.push(`interaction:PLAN_REVIEW:${response.approved ? "approved" : "feedback"}`);
            events.push(event);
            pendingReviewLifecycleObservations.push(response);
        };
        const humanReviewSurface = scenario.humanReviewDecisions
            ? new ScriptedHumanReviewSurface(/** @type {any[]} */ (scenario.humanReviewDecisions))
            : null;
        /** @type {Array<ReturnType<ScriptedHumanReviewSurface['submit']>>} */
        const consumedHumanReviews = [];
        /** @param {ReturnType<ScriptedHumanReviewSurface['submit']>} response */
        const observeHumanReviewDecision = (response) => {
            events.push(
                `interaction:CODE_REVIEW:${
                    response.approved ? "approved" : response.canceled ? "canceled" : "feedback"
                }`,
            );
            events.push("human-review:captured");
            consumedHumanReviews.push(response);
        };
        const interactionSurface = scenario.scriptedInteractions
            ? new ScriptedInteractionSurface(
                /** @type {any[]} */ (scenario.scriptedInteractions),
                (planName) => {
                    const activeComposition = composition;
                    const executionCwd = activeComposition?.runtime.getSessionSnapshot(activeComposition.sessionId)
                        ?.activeExecutionWorkflow?.executionCwd;
                    if (typeof executionCwd === "string" && executionCwd) return executionCwd;
                    if (planName) {
                        const registryText = Deno.readTextFileSync(getWorktreeRegistryPath(getCwd()));
                        const parsed = /** @type {{ entries?: Array<{ planName?: string, path?: string }> }} */ (
                            JSON.parse(registryText)
                        );
                        const matches = (parsed.entries || []).filter((entry) => entry.planName === planName);
                        const durablePath = matches.at(-1)?.path;
                        if (durablePath) return durablePath;
                    }
                    return getCwd();
                },
            )
            : null;
        if (interactionSurface) state.scriptedInteractions = interactionSurface.consumed;
        /** @type {"select"|"text"|"approval"|null} */
        let activeScriptedInteractionType = null;
        /** @param {import('../types.js').UiAPI} uiAPI */
        const configureScriptedUiAPI = (uiAPI) => {
            if (!interactionSurface) return;
            uiAPI.promptSelect = (prompt, options) => {
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
            uiAPI.promptText = (prompt, options) => {
                const value = interactionSurface.next("text", { prompt, options });
                return Promise.resolve(value === null ? null : String(value));
            };
        };
        try {
            // Every scripted turn is served through the faux provider, including the
            // Slicer's. Excluding it meant the harness consumed that turn itself and
            // called saveChildFeaturePlans directly, so the real
            // slicer_finalize_decomposition tool and the Epic decomposition
            // transaction never ran in any Golden scenario.
            const scriptedResponseFactories = (scenario.script || []).map(() => (/** @type {unknown} */ context) => {
                const snapshot = composition?.runtime.getSessionSnapshot(composition.sessionId);
                const availableTools = getContextToolNames(context);
                const systemPrompt = String(
                    /** @type {{ systemPrompt?: unknown }} */ (context && typeof context === "object" ? context : {})
                        .systemPrompt || "",
                );
                const { agent, phase } = inferGoldenTurnIdentity(
                    snapshot?.activeAgent || undefined,
                    availableTools,
                    systemPrompt,
                );
                // The Runtime's own view of which Plan is executing. An Epic drives
                // several child Plans through the same Agent and phase, so execution
                // and review turns count ordinals per Plan: one child's turn count
                // then cannot shift the next child's script. Planning turns are not
                // scoped this way — a Planner turn runs before its Plan exists, and
                // the Runtime still reports whichever Plan came before.
                const reportedPlanName = String(
                    /** @type {{ workflowContext?: { planName?: unknown }, activeExecutionWorkflow?: { planName?: unknown } }} */ (
                        snapshot || {}
                    ).workflowContext?.planName ||
                        /** @type {{ activeExecutionWorkflow?: { planName?: unknown } }} */ (snapshot || {})
                            .activeExecutionWorkflow?.planName ||
                        "",
                );
                // The Runtime clears workflowContext between phases while retaining
                // activeExecutionWorkflow. An empty reading must not open a second
                // ordinal series for the same Plan — that silently shifts later
                // turns. Carry the last Plan the Runtime named until it names another.
                if (reportedPlanName) lastWorkflowPlanName = reportedPlanName;
                const planName = reportedPlanName || lastWorkflowPlanName;
                const planScoped = agent === "engineer" || agent === "reviewer";
                const ordinalKey = planScoped ? `${agent}:${phase}:${planName}` : `${agent}:${phase}`;
                const ordinal = (turnOrdinals.get(ordinalKey) || 0) + 1;
                turnOrdinals.set(ordinalKey, ordinal);
                // Recorded before dispatch so a failing turn still appears: the
                // identity/ordinal a turn was offered under is the one fact needed to
                // script agent loops that run to a text-only answer, and it is
                // invisible from events alone.
                turnSequence.push(`${agent}:${phase}:${planScoped ? planName || "-" : "*"}:${ordinal}`);
                const response = actor.next({
                    agent,
                    phase,
                    ordinal,
                    planName: planScoped ? planName : undefined,
                    availableTools,
                });
                events.push(`model:faux-provider:${agent}:${phase}`);
                return createFauxMessageForTurn(actor.consumed.at(-1) || /** @type {any} */ ({ response }));
            });
            const fallbackResponseFactories = Array.from({ length: 8 }, () => (/** @type {unknown} */ context) => {
                const availableTools = getContextToolNames(context);
                const fallbackSystemPrompt = String(
                    /** @type {{ systemPrompt?: unknown }} */ (context && typeof context === "object" ? context : {})
                        .systemPrompt || "",
                );
                // The Recorder's Output Contract is JSON body sections. Answering it
                // in prose would fail generation on format alone and say nothing about
                // Work Records; the record itself is still written, indexed and linked
                // by the real generator from the real Plan and Git history.
                if (fallbackSystemPrompt.includes("You are the Recorder")) {
                    return createFauxMessageForTurn({
                        id: "golden-fallback-work-record",
                        agent: "recorder",
                        phase: "work_record",
                        text: JSON.stringify({
                            title: "Golden Work Record",
                            summary: "Recorded the completed Golden Planned Change for planning memory.",
                            deviationsFromPlan: "None.",
                        }),
                    });
                }
                if (availableTools.includes("review_complete")) {
                    return createFauxMessageForTurn({
                        id: "golden-fallback-review-approval",
                        agent: "engineer",
                        phase: "engineer",
                        thinking: "Approve repaired Golden implementation.",
                        toolCalls: [{ name: "review_complete", arguments: { approved: true, feedback: "Approved." } }],
                    });
                }
                if (availableTools.includes("bash") && availableTools.includes("task_completed")) {
                    return createFauxMessageForTurn({
                        id: "golden-fallback-merge-repair",
                        agent: "engineer",
                        phase: "engineer",
                        thinking: "Clean isolated fixture settings overlap before merge retry.",
                        toolCalls: [
                            { name: "bash", arguments: { command: "rm -rf .wld" } },
                            { name: "task_completed", arguments: { message: "- Removed isolated settings overlap." } },
                        ],
                    });
                }
                return createFauxMessageForTurn({
                    id: "golden-fallback-text",
                    agent: "guide",
                    phase: "inquiry",
                    text: "Golden fallback response.",
                });
            });
            fauxProvider?.setResponses([...scriptedResponseFactories, ...fallbackResponseFactories]);
            // The welcome prompt blocks inside createInteractiveTuiComposition while
            // scenario actions only run after it resolves, so startup-declared input
            // has to be fed while the composition promise is still in flight. Input
            // sent before the TUI attaches its handler to the VirtualTerminal is
            // dropped, so every step waits for a screen marker first. The observed
            // screen at each marker is recorded for assertions, and an
            // expected-clean-exit scenario reports it to the parent before feeding
            // the input that will drive the real /quit (Deno.exit(0)).
            const startupInputSteps = scenario.startupInput || [];
            const startupInputPromise = (async () => {
                for (const step of startupInputSteps) {
                    const marker = String(step.marker || "");
                    const startedAt = Date.now();
                    let markerObserved = false;
                    while (Date.now() - startedAt < (scenario.timeoutMs || DEFAULT_WAIT_TIMEOUT_MS)) {
                        await terminal.flush();
                        const screen = terminal.getScreenText();
                        if (screen.includes(marker)) {
                            markerObserved = true;
                            state.startupScreen = screen;
                            state.startupScrollback = terminal.getScrollbackText();
                            events.push(`startup:marker:${marker}`);
                            // Report the observed screen before feeding input: an
                            // expected-clean-exit scenario dies inside the real /quit
                            // (Deno.exit(0)) shortly after its input lands, and the
                            // pre-exit report is the parent's only evidence.
                            if (scenario.expectedCleanExit) {
                                await writeHeartbeat();
                                console.log(JSON.stringify({
                                    ok: true,
                                    expectedCleanExit: true,
                                    result: {
                                        name: scenario.name,
                                        state,
                                        events,
                                        screenText: screen,
                                        scrollbackText: state.startupScrollback,
                                        actor: actor.diagnostics(),
                                        artifactDir: null,
                                    },
                                    env: {
                                        root: runwieldDir ? join(runwieldDir, "..", "..") : null,
                                        projectRoot: Deno.cwd(),
                                    },
                                    heartbeatArtifactDir: options.artifactRoot || null,
                                }));
                            }
                            if (step.keys) terminal.input(String(step.keys));
                            else if (step.text) terminal.typeText(String(step.text));
                            await terminal.flush();
                            break;
                        }
                        await new Promise((resolve) => setTimeout(resolve, 20));
                    }
                    if (!markerObserved) {
                        throw new Error(
                            `Startup input marker never appeared: ${
                                JSON.stringify(marker)
                            }. Screen:\n${terminal.getScreenText()}`,
                        );
                    }
                }
            })();
            const compositionPromise = createInteractiveTuiComposition(null, {
                terminal,
                sessionStartMode: scenario.sessionStartMode || "new",
                initialAgentName: scenario.initialAgentName || "router",
                initialAgentModel: scenario.modelSetup === "none" || scenario.modelSetup === "provider-without-models"
                    ? undefined
                    : `${GOLDEN_FAUX_PROVIDER}/${GOLDEN_FAUX_MODEL}`,
                configureUiAPI: configureScriptedUiAPI,
                browser: reviewSurface || humanReviewSurface
                    ? createGoldenReviewBrowser(
                        reviewSurface,
                        humanReviewSurface,
                        {},
                        scenario.reviewedPlan,
                        observeReviewDecision,
                        observeHumanReviewDecision,
                    )
                    : NO_OPEN_BROWSER_PORT,
            });
            composition = await compositionPromise;
            await startupInputPromise;
            await writeHeartbeat();
            // Startup is done and the heartbeat carries real actor state, so the
            // parent can switch from its startup budget to the scenario budget.
            options.onReady?.();
            const runtime = composition.runtime;
            /** @param {import('../../../shared/session/session-runtime-events.js').SessionRuntimeEvent} event */
            const handleRuntimeEvent = (event) => {
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
                if (event.type === "interaction_resolved") {
                    const interaction =
                        /** @type {{ interactionType?: string, outcome?: string, message?: string }} */ (
                            event
                        );
                    events.push(
                        `runtime:interaction:${interaction.interactionType || "unknown"}:${
                            interaction.outcome || "unknown"
                        }`,
                    );
                    if (interaction.message) events.push(`runtime:interaction-message:${interaction.message}`);
                    if (interaction.interactionType === "plan_review") {
                        const response = pendingReviewLifecycleObservations.shift();
                        if (response) {
                            const eventName = response.approved ? "review_approved" : "review_feedback";
                            const expectedStatus = response.approved ? "approved" : "feedback";
                            const lifecycle = findFixturePlanLifecycle(
                                join(Deno.cwd(), "docs", "plans"),
                                expectedStatus,
                            );
                            persistedLifecycleEvents.push({
                                event: eventName,
                                status: lifecycle.status,
                                updatedAt: lifecycle.updatedAt,
                            });
                        }
                    }
                }
                if (event.type === "session_replaced") {
                    const replaced =
                        /** @type {{ oldSessionId?: string, newSessionId?: string, reason?: string, childPlanName?: string, action?: string }} */ (event);
                    state.replacedSession = {
                        previousSessionId: replaced.oldSessionId,
                        currentSessionId: replaced.newSessionId,
                        reason: replaced.reason,
                        childPlanName: replaced.childPlanName,
                        action: replaced.action,
                    };
                    events.push(`runtime:session-replaced:${replaced.reason || "unknown"}`);
                    if (replaced.newSessionId) {
                        const unsubscribePreviousSessions = unsubscribe;
                        const unsubscribeReplacement = runtime.subscribeSessionEvents(
                            replaced.newSessionId,
                            handleRuntimeEvent,
                        );
                        unsubscribe = () => {
                            unsubscribePreviousSessions();
                            unsubscribeReplacement();
                        };
                    }
                }
            };
            unsubscribe = runtime.subscribeSessionEvents(composition.sessionId, handleRuntimeEvent);
            for (const action of scenario.actions || []) {
                if (!isObject(action)) continue;
                const typed = /** @type {any} */ (action);
                if (typed.type === "type") {
                    const text = String(typed.text || "");
                    terminal.typeText(text);
                    const loadPlanMatch = text.trim().match(/^\/load-plan\s+(.+)$/);
                    if (loadPlanMatch) lastWorkflowPlanName = loadPlanMatch[1].trim();
                    events.push(`terminal:type:${typed.text || ""}`);
                } else if (typed.type === "clearEditor") {
                    terminal.input("\x15");
                    events.push("terminal:clear-editor");
                } else if (typed.type === "startConcurrentSession") {
                    const name = String(typed.name || `session-${concurrentSessions.size + 1}`);
                    const concurrentTerminal = new VirtualTerminal(typed.terminal || scenario.terminal);
                    const { stopTUI } = await import("../tui.ts");
                    stopTUI();
                    const concurrentComposition = await createInteractiveTuiComposition(null, {
                        browser: NO_OPEN_BROWSER_PORT,
                        terminal: concurrentTerminal,
                        sessionStartMode: typed.sessionStartMode || "new",
                        initialAgentName: typed.initialAgentName || scenario.initialAgentName || "router",
                        initialAgentModel:
                            scenario.modelSetup === "none" || scenario.modelSetup === "provider-without-models"
                                ? undefined
                                : `${GOLDEN_FAUX_PROVIDER}/${GOLDEN_FAUX_MODEL}`,
                        configureUiAPI: configureScriptedUiAPI,
                    });
                    const concurrentUnsubscribe = concurrentComposition.runtime.subscribeSessionEvents(
                        concurrentComposition.sessionId,
                        (event) => {
                            events.push(`concurrent:${name}:runtime:${event.type}`);
                            if (event.type === "tool_start") {
                                const eventToolName = /** @type {{ toolName?: string }} */ (event).toolName || "";
                                events.push(`concurrent:${name}:runtime:tool:start:${eventToolName}`);
                            }
                        },
                    );
                    for (let attempt = 0; !concurrentTerminal.started && attempt < 100; attempt += 1) {
                        await new Promise((resolve) => setTimeout(resolve, 20));
                    }
                    if (!concurrentTerminal.started) throw new Error("Concurrent terminal did not start.");
                    concurrentSessions.set(name, {
                        terminal: concurrentTerminal,
                        composition: concurrentComposition,
                        unsubscribe: concurrentUnsubscribe,
                    });
                    state.concurrentSessions = [...concurrentSessions.keys()];
                    events.push(`tui:concurrent-session:${name}:started`);
                } else if (typed.type === "concurrentType") {
                    const session = concurrentSessions.get(String(typed.name || ""));
                    if (!session) throw new Error(`Unknown concurrent session: ${typed.name || ""}`);
                    session.terminal.typeText(String(typed.text || ""));
                    events.push(`concurrent:${typed.name}:terminal:type:${typed.text || ""}`);
                } else if (typed.type === "concurrentEnter") {
                    const session = concurrentSessions.get(String(typed.name || ""));
                    if (!session) throw new Error(`Unknown concurrent session: ${typed.name || ""}`);
                    session.terminal.pressEnter();
                } else if (typed.type === "waitForConcurrentIdle") {
                    const session = concurrentSessions.get(String(typed.name || ""));
                    if (!session) throw new Error(`Unknown concurrent session: ${typed.name || ""}`);
                    await session.composition.waitForIdle(
                        typed.timeoutMs || scenario.timeoutMs || DEFAULT_WAIT_TIMEOUT_MS,
                    );
                } else if (typed.type === "captureConcurrentScreens") {
                    state.concurrentScreens = Object.fromEntries(
                        [...concurrentSessions.entries()].map(([name, session]) => [
                            name,
                            {
                                screenText: session.terminal.getScreenText(),
                                scrollbackText: session.terminal.getScrollbackText(),
                                snapshot: session.composition.runtime.getSessionSnapshot(session.composition.sessionId),
                            },
                        ]),
                    );
                    events.push("tui:concurrent-screens:captured");
                } else if (typed.type === "restartTui") {
                    unsubscribe();
                    await composition?.dispose?.();
                    terminal = new VirtualTerminal(typed.terminal || scenario.terminal);
                    composition = await createInteractiveTuiComposition(null, {
                        browser: NO_OPEN_BROWSER_PORT,
                        terminal,
                        sessionStartMode: typed.sessionStartMode || scenario.sessionStartMode || "new",
                        initialAgentName: typed.initialAgentName || scenario.initialAgentName || "router",
                        initialAgentModel:
                            scenario.modelSetup === "none" || scenario.modelSetup === "provider-without-models"
                                ? undefined
                                : `${GOLDEN_FAUX_PROVIDER}/${GOLDEN_FAUX_MODEL}`,
                        configureUiAPI: configureScriptedUiAPI,
                    });
                    for (let attempt = 0; !terminal.started && attempt < 100; attempt += 1) {
                        await new Promise((resolve) => setTimeout(resolve, 20));
                    }
                    if (!terminal.started) throw new Error("Restarted terminal did not start.");
                    unsubscribe = composition.runtime.subscribeSessionEvents(composition.sessionId, (event) => {
                        events.push(`runtime:${event.type}`);
                        if (event.type === "tool_start") {
                            const eventToolName = /** @type {{ toolName?: string }} */ (event).toolName || "";
                            events.push(`runtime:tool:start:${eventToolName}`);
                        }
                        if (event.type === "agent_changed") {
                            const name = /** @type {{ agentName?: string }} */ (event).agentName || "";
                            events.push(`runtime:agent:${name}`);
                            state.activeAgent = name;
                        }
                    });
                    events.push("tui:restarted");
                } else if (typed.type === "enter") terminal.pressEnter();
                else if (typed.type === "escape") terminal.pressEscape();
                else if (typed.type === "ctrlC") {
                    terminal.pressCtrlC();
                    events.push("terminal:ctrl-c");
                } else if (typed.type === "resize") {
                    terminal.resize(typed.columns || 80, typed.rows || 24);
                    events.push(`terminal:resize:${typed.columns || 80}x${typed.rows || 24}`);
                } else if (typed.type === "assertTerminalSize") {
                    if (terminal.columns !== typed.columns || terminal.rows !== typed.rows) {
                        throw new Error(
                            `Expected terminal size ${typed.columns}x${typed.rows}, got ${terminal.columns}x${terminal.rows}`,
                        );
                    }
                    events.push(`terminal:size:${typed.columns}x${typed.rows}`);
                } else if (typed.type === "writeProjectFile") {
                    const path = join(Deno.cwd(), typed.path || "");
                    await Deno.mkdir(join(path, ".."), { recursive: true });
                    await Deno.writeTextFile(path, String(typed.text || ""));
                    events.push(`project:write:${typed.path || ""}`);
                } else if (typed.type === "repairStoredMergeWorktreeAndKill") {
                    const planName = String(typed.planName || "");
                    const filePath = String(typed.path || "");
                    const loaded = await loadPlan(Deno.cwd(), planName);
                    const repairWorktreePath = loaded?.attrs.validationMergeRepairWorktree;
                    if (typeof repairWorktreePath !== "string" || !repairWorktreePath) {
                        throw new Error(`Expected ${planName} to have a validationMergeRepairWorktree.`);
                    }
                    await Deno.writeTextFile(join(repairWorktreePath, filePath), String(typed.text || ""));
                    await runGoldenGit(["add", filePath], repairWorktreePath);
                    await runGoldenGit(["-c", "core.editor=true", "merge", "--continue"], repairWorktreePath);
                    events.push(`project:merge-repair-complete:${planName}`);
                    Deno.kill(Deno.pid, "SIGKILL");
                } else if (typed.type === "assertProjectFile") {
                    const path = join(Deno.cwd(), typed.path || "");
                    const exists = await Deno.stat(path).then(() => true).catch(() => false);
                    state.projectMutation = exists ? "mutated" : "clean";
                    if (exists !== Boolean(typed.exists)) {
                        throw new Error(`Project mutation assertion failed for ${typed.path || ""}: exists=${exists}`);
                    }
                    events.push("project:file-checked");
                } else if (typed.type === "captureProjectFileText") {
                    const key = String(typed.key || typed.path || "projectFileText");
                    const path = join(Deno.cwd(), typed.path || "");
                    state[key] = await Deno.readTextFile(path).catch(() => null);
                    events.push(`project:file-text:${typed.path || ""}`);
                } else if (typed.type === "assertProjectUnchanged") {
                    const changes = diffProjectSnapshots(projectSnapshotBefore, await snapshotProjectRoot(Deno.cwd()));
                    state.projectMutation = changes.length ? "mutated" : "clean";
                    state.projectMutationChanges = changes;
                    if (changes.length) throw new Error(`Project mutation assertion failed: ${changes.join(", ")}`);
                    events.push("project:mutation-checked");
                } else if (typed.type === "assertOnlyProjectChanges") {
                    const expected = new Set(Array.isArray(typed.paths) ? typed.paths : []);
                    const changes = diffProjectSnapshots(projectSnapshotBefore, await snapshotProjectRoot(Deno.cwd()));
                    state.projectMutation = changes.length ? "mutated" : "clean";
                    state.projectMutationChanges = changes;
                    const unexpected = changes.filter((change) =>
                        !expected.has(change.replace(/^(added|deleted|modified):/, ""))
                    );
                    if (unexpected.length || changes.length !== expected.size) {
                        throw new Error(
                            `Project mutation assertion failed: expected ${[...expected].join(", ")}; got ${
                                changes.join(", ")
                            }`,
                        );
                    }
                    events.push("project:mutation-policy:only-requested");
                } else if (typed.type === "assertWorkflowDurability") {
                    const registryRoot = join(
                        Deno.env.get("RUNWIELD_HOME") || join(Deno.env.get("HOME") || "", ".wld"),
                        "registry",
                    );
                    const registryEntries = [];
                    try {
                        for await (const entry of Deno.readDir(registryRoot)) registryEntries.push(entry.name);
                    } catch (error) {
                        if (!(error instanceof Deno.errors.NotFound)) throw error;
                    }
                    const { inspectWorktreeRegistry } = await import("../../../shared/worktree-registry.js");
                    const projectWorktreeRegistry = await inspectWorktreeRegistry(Deno.cwd());
                    const goldenFilePath = join(Deno.cwd(), "golden-planned-change.txt");
                    const goldenFileExists = await Deno.stat(goldenFilePath).then(() => true).catch(() => false);
                    const branch = await runGoldenGit(["branch", "--show-current"], Deno.cwd());
                    const status = await runGoldenGit(["status", "--porcelain", "--untracked-files=all"], Deno.cwd());
                    const trackedFiles = await runGoldenGit(["ls-files"], Deno.cwd());
                    const deliveryLog = goldenFileExists
                        ? await runGoldenGit(["log", "--format=%H", "--", "golden-planned-change.txt"], Deno.cwd())
                        : "";
                    const planText = await Deno.readTextFile(join(Deno.cwd(), "docs", "plans", "plan.md"));
                    const planAttrs = parsePlanFrontMatter(planText).attrs;
                    const deliveredHead = await runGoldenGit(["rev-parse", "HEAD"], Deno.cwd());
                    const recordedWorktreeBranch = String(planAttrs.worktreeBranch || "");
                    const deliveryTranscript = `${terminal.getScreenText()}\n${terminal.getScrollbackText?.() || ""}`;
                    const deliveredBranchMatch = deliveryTranscript.match(
                        /Merging branch\s+([^\s]+)\s+into branch/,
                    );
                    const worktreeBranch = recordedWorktreeBranch || deliveredBranchMatch?.[1] || "";
                    const validatedWorktreeHead = worktreeBranch
                        ? await runGoldenGit(["rev-parse", worktreeBranch], Deno.cwd()).catch(() =>
                            deliveryLog.split("\n").filter(Boolean)[0] || ""
                        )
                        : "";
                    let worktreeBranchPublished = false;
                    if (validatedWorktreeHead) {
                        const ancestry = await new Deno.Command("git", {
                            args: ["merge-base", "--is-ancestor", validatedWorktreeHead, deliveredHead],
                            cwd: Deno.cwd(),
                        }).output();
                        worktreeBranchPublished = ancestry.success;
                    }
                    const deliveryEvidence = await Deno.readTextFile(goldenFilePath).catch(() => "");
                    const snapshot = composition.runtime.getSessionSnapshot(composition.sessionId);
                    const editorUsable = snapshot?.busy === false;
                    state.editorUsable = editorUsable;
                    // The Plan's own status, captured before cleanup. Without it a
                    // stalled workflow leaves no way to tell which phase it died in.
                    const planStatus = await Deno.readTextFile(getStoredPlanPath(Deno.cwd(), "plan"))
                        .then((text) => (text.match(/^status:\s*"?([a-z_]+)"?/m) || [])[1] || "")
                        .catch(() => "");
                    state.workflowDurability = {
                        planStatus,
                        goldenFileExists,
                        registryEntries,
                        projectWorktreeRegistryEntries: projectWorktreeRegistry.entries,
                        branch,
                        status,
                        trackedFiles,
                        deliveryLog,
                        deliveryEvidence,
                        deliveredHead,
                        worktreeBranch,
                        validatedWorktreeHead,
                        worktreeBranchPublished,
                        editorUsable,
                    };
                    if (!goldenFileExists) {
                        throw new Error("Expected delivered golden-planned-change.txt in project root.");
                    }
                    if (!trackedFiles.split("\n").includes("golden-planned-change.txt")) {
                        throw new Error(
                            "Expected golden-planned-change.txt to be tracked after Direct Delivery publication.",
                        );
                    }
                    if (!deliveryLog) {
                        throw new Error("Expected Git ancestry to include golden-planned-change.txt delivery commit.");
                    }
                    if (!worktreeBranch) {
                        throw new Error(
                            "Expected durable delivery evidence to identify the validated worktree branch.",
                        );
                    }
                    if (!validatedWorktreeHead) {
                        throw new Error(`Expected validated worktree branch to resolve: ${worktreeBranch}`);
                    }
                    if (!worktreeBranchPublished) {
                        throw new Error(
                            `Expected delivered HEAD ${deliveredHead} to contain validated worktree branch ${worktreeBranch} at ${validatedWorktreeHead}.`,
                        );
                    }
                    const statusLines = status.split("\n").filter(Boolean);
                    // The Work Record the post-verification handoff writes under docs/ is
                    // a real product output, not leftover mess: it is generated after the
                    // Plan verifies and is the user's to keep or discard.
                    const unexpectedStatus = statusLines.filter((line) => {
                        const path = line.slice(3).trim();
                        return !line.endsWith("docs/plans/plan.md") && !line.endsWith(".wld/worktrees.json") &&
                            !line.endsWith("docs/") && !line.includes("docs/work-records/") && path !== ".gitignore" &&
                            path !== ".wld/settings.json" && !isRunWieldOwnedRuntimePath(path);
                    });
                    if (unexpectedStatus.length) {
                        throw new Error(`Unexpected post-delivery Git status entries: ${unexpectedStatus.join("; ")}`);
                    }
                    if (branch !== "main" && branch !== "master") {
                        throw new Error(`Expected terminal on primary branch after delivery; got ${branch}`);
                    }
                    if (!deliveryEvidence.includes("golden")) {
                        throw new Error("Expected delivery evidence content in golden-planned-change.txt.");
                    }
                    if (registryEntries.length) {
                        throw new Error(`Expected clean worktree registry; got ${registryEntries.join(", ")}`);
                    }
                    const liveProjectEntries = projectWorktreeRegistry.entries.filter((entry) =>
                        ["active", "execution_failed", "validation_failed", "merge_conflict"].includes(
                            String(entry.status || ""),
                        )
                    );
                    if (liveProjectEntries.length) {
                        throw new Error(
                            `Expected clean project worktree registry; got ${JSON.stringify(liveProjectEntries)}`,
                        );
                    }
                    events.push("workflow:durability:terminal-ready");
                    if (!editorUsable) events.push("workflow:durability:terminal-busy");
                    events.push(`workflow:durability:branch:${branch}`);
                    events.push("workflow:durability:ancestry-checked");
                    events.push("workflow:durability:evidence-recorded");
                    events.push("workflow:durability:delivery-checked");
                    events.push("workflow:durability:registry-clean");
                } else if (typed.type === "runSlicerDecomposition") {
                    // Real decomposition. The Slicer agent turn, the
                    // slicer_finalize_decomposition tool, the Plan catalog lock and the
                    // composite Epic decomposition transaction all run for real; only
                    // the model's tool call comes from the script. Nothing here writes
                    // Plan files itself — a harness that materialized children would be
                    // testing its own mirror of decomposition instead of the product's.
                    const epicPlanName = String(typed.planName || "epic");
                    const epic = await loadPlan(Deno.cwd(), epicPlanName);
                    if (!epic) throw new Error(`Expected PROJECT Epic Plan ${epicPlanName} to exist.`);
                    if (epic.attrs.classification !== "PROJECT") {
                        throw new Error(
                            `Expected ${epicPlanName} to be a PROJECT Epic; got ${epic.attrs.classification}`,
                        );
                    }
                    events.push(`project:epic:status:${epic.attrs.status}`);
                    await writeHeartbeat();
                    const slicerResult = await composition.runtime.runSlicerAgent(composition.sessionId, {
                        planName: epicPlanName,
                        triageMeta: epic.attrs,
                    });
                    if (!slicerResult?.ok) {
                        throw new Error(`Slicer decomposition failed: ${slicerResult?.error || "unknown error"}`);
                    }
                    const materialized = (await findPlansByParent(Deno.cwd(), epicPlanName))
                        .filter((child) => child.attrs.classification === "PLANNED_CHANGE")
                        .sort((left, right) => Number(left.attrs.order || 0) - Number(right.attrs.order || 0));
                    if (materialized.length < 2) {
                        throw new Error(
                            `Expected the Slicer to materialize two child Plans; got ${
                                materialized.map((child) => child.name).join(", ") || "none"
                            }`,
                        );
                    }
                    state.projectChildren = materialized.map((child) => ({
                        name: child.name,
                        status: child.attrs.status,
                        classification: child.attrs.classification,
                        order: child.attrs.order,
                        parentPlan: child.attrs.parentPlan,
                    }));
                    events.push("project:slicer:materialized");
                    await writeHeartbeat();
                } else if (typed.type === "captureProjectDurability") {
                    // Observation only: every status read here was produced by the real
                    // lifecycle, so the assertions describe what the product did rather
                    // than what the harness arranged.
                    const epicPlanName = String(typed.planName || "epic");
                    const parent = await loadPlan(Deno.cwd(), epicPlanName);
                    const children = (await findPlansByParent(Deno.cwd(), epicPlanName))
                        .filter((child) => child.attrs.classification === "PLANNED_CHANGE")
                        .sort((left, right) => Number(left.attrs.order || 0) - Number(right.attrs.order || 0));
                    state.projectPlans = {
                        parent: parent?.attrs,
                        firstChild: children[0]?.attrs,
                        secondChild: children[1]?.attrs,
                    };
                    const registryPath = join(Deno.cwd(), ".wld", "worktrees.json");
                    const registryText = await Deno.readTextFile(registryPath).catch(() => "");
                    /** @type {import('../../../shared/worktree-registry.js').WorktreeRegistryEntry[]} */
                    const registryEntries = registryText ? (JSON.parse(registryText).entries || []) : [];
                    state.projectDurability = {
                        branch: await runGoldenGit(["rev-parse", "--abbrev-ref", "HEAD"], Deno.cwd()),
                        deliveryLog: await runGoldenGit(["log", "--oneline", "-12"], Deno.cwd()),
                        trackedFiles: await runGoldenGit(["ls-files"], Deno.cwd()),
                        status: await runGoldenGit(["status", "--porcelain"], Deno.cwd()),
                        liveRegistryEntries: registryEntries.filter((entry) =>
                            ["active", "execution_failed", "validation_failed", "merge_conflict"].includes(
                                String(entry.status || ""),
                            )
                        ).map((entry) => `${entry.planName || "?"}:${entry.status || "?"}`),
                        registryStatuses: registryEntries.map((entry) =>
                            `${entry.planName || "?"}:${entry.status || "?"}`
                        ),
                        registryEntryCount: registryEntries.length,
                    };
                    events.push("project:epic:evidence");
                    await writeHeartbeat();
                } else if (typed.type === "generateWorkRecord") {
                    // The production generator, on a Plan the real lifecycle actually
                    // verified — the same call `/load-plan` makes when a user marks a
                    // Plan verified. The Work Record content is generated from the real
                    // Plan and Git history, not composed here.
                    const { autoGenerateWorkRecordForCompletedPlan } = await import(
                        "../../../shared/work-records/auto-generation.js"
                    );
                    const { listWorkRecords } = await import("../../../shared/work-records/store.js");
                    const generated = await autoGenerateWorkRecordForCompletedPlan({
                        cwd: Deno.cwd(),
                        planName: String(typed.planName || ""),
                        mnemosynePort: createWorkRecordMnemosyneFixture(),
                    });
                    const records = await listWorkRecords(Deno.cwd(), { createDir: false });
                    state.workRecord = {
                        status: generated.status,
                        path: generated.path,
                        error: generated.error,
                        recordNames: records.map((record) => record.relativePath),
                    };
                    events.push(`project:epic:work-record:${generated.status}`);
                    await writeHeartbeat();
                } else if (typed.type === "deletePlanWorktreeBaseBranch") {
                    const planName = String(typed.planName || "");
                    const loaded = await loadPlan(Deno.cwd(), planName);
                    if (!loaded) throw new Error(`Cannot delete base branch for missing Plan ${planName}`);
                    const baseBranch = String(loaded.attrs.worktreeBaseBranch || "");
                    if (!baseBranch) throw new Error(`Plan ${planName} has no worktreeBaseBranch to delete`);
                    const replacementBranch = String(typed.replacementBranch || `golden-missing-target-${planName}`);
                    await runGoldenGit(["switch", "-c", replacementBranch], Deno.cwd());
                    await runGoldenGit(["branch", "-D", baseBranch], Deno.cwd());
                    events.push(`project:base-branch-deleted:${planName}:${baseBranch}`);
                    await writeHeartbeat();
                } else if (typed.type === "commitPlanWorktreeBaseBranchFile") {
                    const planName = String(typed.planName || "");
                    const path = String(typed.path || "");
                    if (!path) throw new Error("commitPlanWorktreeBaseBranchFile needs a path");
                    const loaded = await loadPlan(Deno.cwd(), planName);
                    if (!loaded) throw new Error(`Cannot edit base branch for missing Plan ${planName}`);
                    const baseBranch = String(loaded.attrs.worktreeBaseBranch || "");
                    if (!baseBranch) throw new Error(`Plan ${planName} has no worktreeBaseBranch to edit`);
                    await runGoldenGit(["switch", baseBranch], Deno.cwd());
                    await Deno.mkdir(dirname(join(Deno.cwd(), path)), { recursive: true });
                    await Deno.writeTextFile(join(Deno.cwd(), path), String(typed.text || ""));
                    await runGoldenGit(["add", path], Deno.cwd());
                    await runGoldenGit(
                        ["commit", "-m", String(typed.message || `seed ${planName} base conflict`)],
                        Deno.cwd(),
                    );
                    events.push(`project:base-branch-file-committed:${planName}:${baseBranch}:${path}`);
                    await writeHeartbeat();
                } else if (typed.type === "seedActiveWorktree") {
                    const planName = String(typed.planName || "");
                    const loaded = await loadPlan(Deno.cwd(), planName);
                    if (!loaded) throw new Error(`Cannot seed worktree for missing Plan ${planName}`);
                    const { createTestWorktreeAttempt } = await import("../../../shared/worktree-test-helpers.js");
                    const { updateEntry } = await import("../../../shared/worktree-registry.js");
                    const { updatePlanFrontMatter } = await import("../../../plan-store.js");
                    const entry = await createTestWorktreeAttempt({
                        projectRoot: Deno.cwd(),
                        planName,
                        planId: String(loaded.attrs.planId || `golden:${planName}`),
                    });
                    if (Array.isArray(typed.files)) {
                        for (const file of typed.files) {
                            if (!isObject(file) || typeof file.path !== "string") continue;
                            await Deno.writeTextFile(join(entry.path, file.path), String(file.text || ""));
                        }
                        await runGoldenGit(["add", "."], entry.path);
                        await runGoldenGit(["commit", "-m", `seed ${planName} worktree diff`], entry.path);
                    }
                    const status = typeof typed.status === "string" ? typed.status : "in_progress";
                    const registryStatus = typed.registryStatus === "validation_failed"
                        ? "validation_failed"
                        : typed.registryStatus === "completed" || status === "implemented"
                        ? "completed"
                        : "active";
                    if (registryStatus !== "active") {
                        await updateEntry(Deno.cwd(), entry.id, { status: registryStatus });
                    }
                    await updatePlanFrontMatter(
                        Deno.cwd(),
                        planName,
                        {
                            status,
                            worktreeId: entry.id,
                            worktreePath: entry.path,
                            worktreeBranch: entry.branch,
                            worktreeBaseBranch: entry.baseBranch,
                            worktreeStatus: registryStatus,
                            ...(status === "validated_ci" || status === "validated_reviewer"
                                ? { validationSemanticRounds: 0 }
                                : {}),
                            ...(status === "implemented" ? { validationCiAttempts: 0 } : {}),
                            ...(isObject(typed.attrs) ? typed.attrs : {}),
                        },
                        loaded.attrs,
                        { expectedRevision: loaded.revision },
                    );
                    events.push(`project:worktree-seeded:${planName}`);
                    events.push(`project:worktree-seeded:${planName}:${status}`);
                    await writeHeartbeat();
                } else if (typed.type === "captureGitState") {
                    const paths = Array.isArray(typed.paths) ? typed.paths.map(String) : [];
                    const pathArgs = paths.length ? ["--", ...paths] : [];
                    state.gitState = {
                        branch: await runGoldenGit(["branch", "--show-current"], Deno.cwd()),
                        status: await runGoldenGit(["status", "--porcelain", ...pathArgs], Deno.cwd()),
                        trackedFiles: paths.length
                            ? await runGoldenGit(["ls-files", ...paths], Deno.cwd())
                            : await runGoldenGit(["ls-files"], Deno.cwd()),
                        head: await runGoldenGit(["rev-parse", "HEAD"], Deno.cwd()),
                    };
                    events.push("project:git-state:captured");
                    await writeHeartbeat();
                } else if (typed.type === "captureProjectState") {
                    const planNames = Array.isArray(typed.planNames) ? typed.planNames.map(String) : [];
                    const plans = [];
                    for (const planName of planNames) {
                        const loaded = await loadPlan(Deno.cwd(), planName).catch(() => null);
                        plans.push({ name: planName, attrs: loaded?.attrs || null });
                    }
                    const { inspectWorktreeRegistry } = await import("../../../shared/worktree-registry.js");
                    const registry = await inspectWorktreeRegistry(Deno.cwd());
                    const { listWorkRecords } = await import("../../../shared/work-records/store.js");
                    const records = await listWorkRecords(Deno.cwd(), { createDir: false }).catch(() => []);
                    const capturedProjectState = {
                        plans,
                        registryEntries: registry.entries,
                        nonTerminalRegistryEntries: registry.entries.filter((entry) =>
                            ["active", "execution_failed", "validation_failed", "merge_conflict"].includes(
                                String(entry.status || ""),
                            )
                        ),
                        registryIntegrityIssues: registry.integrityIssues,
                        workRecordNames: records.map((record) => record.relativePath),
                    };
                    state.projectState = capturedProjectState;
                    if (typed.key) state[String(typed.key)] = capturedProjectState;
                    events.push("project:state:captured");
                    await writeHeartbeat();
                } else if (typed.type === "assertNoPlanFile") {
                    const plansRoot = join(Deno.cwd(), "docs", "plans");
                    const planPath = join(plansRoot, `${String(typed.planName || "")}.md`);
                    const exists = await Deno.stat(planPath).then(() => true).catch(() => false);
                    if (exists) throw new Error(`Expected no Plan file at ${planPath}`);
                    /** @type {string[]} */
                    const planFiles = [];
                    /** @type {(directory: string) => Promise<void>} */
                    const collectPlanFiles = async (directory) => {
                        try {
                            for await (const entry of Deno.readDir(directory)) {
                                const child = join(directory, entry.name);
                                if (entry.isDirectory) await collectPlanFiles(child);
                                else if (entry.isFile && entry.name.endsWith(".md")) {
                                    planFiles.push(relative(plansRoot, child));
                                }
                            }
                        } catch (error) {
                            if (!(error instanceof Deno.errors.NotFound)) throw error;
                        }
                    };
                    await collectPlanFiles(plansRoot);
                    if (planFiles.length) {
                        throw new Error(`Expected QUICK_FIX to create no Plan files; got ${planFiles.join(", ")}`);
                    }
                    state.planFiles = planFiles;
                    events.push("project:plan-file-absent");
                } else if (typed.type === "uiPresentationState") {
                    composition.uiAPI.setBusy?.(true);
                    events.push("ui:spinner:busy");
                    composition.uiAPI.setManagedSyncStatus?.({ status: "stale", owningSurfaceKind: "tui" });
                    events.push("ui:managed-sync:stale");
                    composition.uiAPI.appendQueuedMessage?.("golden-queued", "Queued steering message");
                    events.push("ui:queued-steering:add");
                    composition.uiAPI.appendImage?.("iVBORw0KGgo=", "image/png");
                    events.push("ui:image:png");
                    // Capture while the blocks are still up. Every one of them is torn
                    // down a few lines below, so the run's final screen cannot show
                    // them — which is how these capabilities came to be "covered" by
                    // events that never proved anything reached a terminal.
                    //
                    // One flush is not enough: `requestRender` is scheduled, so a
                    // single macrotask yield captures the screen from before the blocks
                    // were drawn. Wait for the screen to actually change.
                    for (let attempt = 0; attempt < 50; attempt += 1) {
                        await terminal.flush();
                        const screen = terminal.getScreenText();
                        if (
                            screen.includes("Thinking...") &&
                            screen.includes("Sync degraded — refresh required") &&
                            screen.includes("Steering: Queued steering message")
                        ) break;
                        await new Promise((resolve) => setTimeout(resolve, 20));
                    }
                    const presentationScreen = terminal.getScreenText();
                    state.presentationScreen = presentationScreen;
                    // A block appended to the message list scrolls above the viewport
                    // as soon as anything follows it, so the proof includes scrollback.
                    const presentationScrollback = terminal.getScrollbackText();
                    state.presentationScrollback = presentationScrollback;
                    // Capable terminals receive image bytes. Headless/unsupported
                    // terminals receive pi-tui's visible image fallback instead. Both
                    // are real rendered outcomes, unlike merely recording the API call.
                    const presentationWrites = String(
                        /** @type {{ writes?: string }} */ (terminal).writes || "",
                    );
                    state.presentationImageRendered = presentationWrites.includes("iVBORw0KGgo=") ||
                        presentationScreen.includes("[Image: [image/png]") ||
                        presentationScrollback.includes("[Image: [image/png]");
                    composition.uiAPI.removeQueuedMessage?.("golden-queued");
                    events.push("ui:queued-steering:remove");
                    composition.uiAPI.setBusy?.(false);
                    events.push("ui:spinner:idle");
                    state.presentationStateExercised = true;
                } else if (typed.type === "promptFocusRoundTrip") {
                    const prompt = composition.uiAPI.promptText?.("Golden prompt focus", { allowEmpty: true });
                    await terminal.flush();
                    events.push("ui:prompt-focus:active");
                    composition.uiAPI.abortActivePrompt?.();
                    await prompt;
                    await terminal.flush();
                    events.push("ui:prompt-focus:restored");
                    state.promptFocusRestored = true;
                } else if (typed.type === "slashAutocomplete") {
                    terminal.typeText("/he");
                    terminal.input("\t");
                    events.push("terminal:autocomplete:/he");
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
                    const timeoutMs = typed.timeoutMs || scenario.timeoutMs || DEFAULT_WAIT_TIMEOUT_MS;
                    const startedAt = Date.now();
                    while (!events.includes(expected)) {
                        if (Date.now() - startedAt > timeoutMs) {
                            throw new Error(`Timed out waiting for event: ${expected}`);
                        }
                        await terminal.flush();
                        await new Promise((resolve) => setTimeout(resolve, 20));
                    }
                } else if (typed.type === "waitForEventCount") {
                    const expected = String(typed.event || "");
                    const expectedCount = Number(typed.count || 1);
                    const timeoutMs = typed.timeoutMs || scenario.timeoutMs || DEFAULT_WAIT_TIMEOUT_MS;
                    const startedAt = Date.now();
                    while (events.filter((event) => event === expected).length < expectedCount) {
                        if (Date.now() - startedAt > timeoutMs) {
                            throw new Error(
                                `Timed out waiting for ${expectedCount} occurrences of event: ${expected}; got ${
                                    events.filter((event) => event === expected).length
                                }`,
                            );
                        }
                        await terminal.flush();
                        await new Promise((resolve) => setTimeout(resolve, 20));
                    }
                } else if (typed.type === "waitForPlanStatus") {
                    const planName = String(typed.planName || "");
                    const expectedStatuses = new Set((Array.isArray(typed.statuses) ? typed.statuses : []).map(String));
                    const timeoutMs = typed.timeoutMs || scenario.timeoutMs || 3000;
                    const planPath = join(Deno.cwd(), "docs", "plans", ...planName.split("/")) + ".md";
                    const startedAt = Date.now();
                    let latestStatus = "";
                    while (!expectedStatuses.has(latestStatus)) {
                        if (Date.now() - startedAt > timeoutMs) {
                            throw new Error(
                                `Timed out waiting for Plan ${planName} status ${
                                    [...expectedStatuses].join(" or ")
                                }; latest=${latestStatus || "unreadable"}`,
                            );
                        }
                        const planText = await Deno.readTextFile(planPath).catch(() => "");
                        latestStatus = planText ? String(parsePlanFrontMatter(planText).attrs.status || "") : "";
                        await terminal.flush();
                        await new Promise((resolve) => setTimeout(resolve, 20));
                    }
                    events.push(`project:plan-status:${planName}:${latestStatus}`);
                } else if (typed.type === "waitForPlanAbsent") {
                    const planName = String(typed.planName || "");
                    const timeoutMs = typed.timeoutMs || scenario.timeoutMs || 3000;
                    const startedAt = Date.now();
                    let latestAttrs = null;
                    while (true) {
                        const loaded = await loadPlan(Deno.cwd(), planName).catch(() => null);
                        latestAttrs = loaded?.attrs || null;
                        if (!latestAttrs) break;
                        if (Date.now() - startedAt > timeoutMs) {
                            throw new Error(
                                `Timed out waiting for Plan ${planName} to leave active storage; latest=${
                                    JSON.stringify(latestAttrs)
                                }`,
                            );
                        }
                        await terminal.flush();
                        await new Promise((resolve) => setTimeout(resolve, 20));
                    }
                    events.push(`project:plan-absent:${planName}`);
                } else if (typed.type === "waitForIdle") {
                    await composition.waitForIdle(typed.timeoutMs || scenario.timeoutMs || DEFAULT_WAIT_TIMEOUT_MS);
                } else if (typed.type === "waitForScreen") {
                    const expected = String(typed.text || "");
                    const timeoutMs = typed.timeoutMs || scenario.timeoutMs || DEFAULT_WAIT_TIMEOUT_MS;
                    const startedAt = Date.now();
                    while (!terminal.getScreenText().includes(expected)) {
                        if (Date.now() - startedAt > timeoutMs) {
                            throw new Error(`Timed out waiting for screen marker: ${JSON.stringify(expected)}`);
                        }
                        await terminal.flush();
                        await new Promise((resolve) => setTimeout(resolve, 20));
                    }
                } else {
                    throw new Error(`Unknown composed scenario action: ${typed.type}`);
                }
                await terminal.flush();
                await writeHeartbeat();
            }
            await composition.waitForIdle?.(scenario.timeoutMs || DEFAULT_WAIT_TIMEOUT_MS).catch(() => {});
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
            if (humanReviewSurface) {
                humanReviewSurface.assertComplete();
                state.humanReviews = {
                    consumed: humanReviewSurface.consumed,
                    decisions: consumedHumanReviews,
                };
            }
            if (reviewSurface) {
                assert(
                    pendingReviewLifecycleObservations.length === 0,
                    `Expected every real Plan Review decision to resolve; pending=${pendingReviewLifecycleObservations.length}`,
                );
                reviewSurface.assertComplete();
                let parsedPlan = await Deno.readTextFile(join(Deno.cwd(), "docs", "plans", "plan.md"))
                    .catch(() => Deno.readTextFile(join(Deno.cwd(), "docs", "plans", "epic.md"))).catch(() => "");
                if (!parsedPlan) {
                    for await (const entry of Deno.readDir(join(Deno.cwd(), "docs", "plans"))) {
                        if (entry.isFile && entry.name.endsWith(".md")) {
                            parsedPlan = await Deno.readTextFile(join(Deno.cwd(), "docs", "plans", entry.name));
                            break;
                        }
                    }
                }
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
            for (const session of concurrentSessions.values()) {
                session.unsubscribe();
                await session.composition.dispose?.();
            }
            await composition?.dispose?.();
            fauxProvider?.unregister?.();
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
