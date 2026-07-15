/** Review-surface Guided Review agent/job routes. */

import { buildGuidedReviewPrompt, validateGuidedReviewExplainer } from "../../../../shared/workflow/guided-review.js";
import { recordWorkflowMetric } from "../../../../shared/workflow/metrics.js";
import { parseDiffFiles } from "../../../../shared/workflow/review-diff-tool.js";
import { createReviewWidgetStore } from "./review-widget-handlers.js";

/**
 * @typedef {Object} ReviewGuideJobEntry
 * @property {Record<string, unknown>} info
 * @property {Record<string, unknown> | null} guide
 * @property {boolean[]} reviewed
 * @property {AbortController} abortController
 * @property {Promise<void>} done
 */

/**
 * @typedef {Object} ReviewAgentState
 * @property {string} token
 * @property {string} cwd
 * @property {Record<string, unknown>} reviewPayload
 * @property {Map<string, ReviewGuideJobEntry>} jobs
 * @property {Set<ReadableStreamDefaultController<Uint8Array>>} streams
 * @property {ReturnType<typeof createReviewWidgetStore>} widgets
 * @property {(prompt: string, signal: AbortSignal, cwd: string) => Promise<{ stdout: string, stderr?: string, provider: string, model?: string, usage?: Record<string, unknown>, cost?: Record<string, unknown> }>} runGuideCommand
 * @property {typeof recordWorkflowMetric} recordWorkflowMetric
 */

/**
 * @param {{ token: string, cwd: string, reviewPayload: Record<string, unknown>, runGuideCommand?: ReviewAgentState["runGuideCommand"], recordWorkflowMetric?: typeof recordWorkflowMetric }} options
 * @returns {ReviewAgentState}
 */
export function createReviewAgentState(options) {
    return {
        ...options,
        jobs: new Map(),
        streams: new Set(),
        widgets: createReviewWidgetStore(),
        runGuideCommand: options.runGuideCommand || runConfiguredGuideCommand,
        recordWorkflowMetric: options.recordWorkflowMetric || recordWorkflowMetric,
    };
}

/** @param {ReviewAgentState} state */
export async function cleanupReviewAgentState(state) {
    for (const entry of state.jobs.values()) entry.abortController.abort("review server stopped");
    await Promise.allSettled([...state.jobs.values()].map((entry) => entry.done));
    await state.widgets.cleanup();
}

/**
 * @param {Request} request
 * @param {URL} url
 * @param {ReviewAgentState} state
 * @returns {Promise<Response | null>}
 */
export async function reviewAgentApi(request, url, state) {
    if (request.method === "GET" && url.pathname === "/api/agents/capabilities") {
        const provider = await detectGuideProvider();
        return Response.json({
            mode: "review",
            available: Boolean(provider),
            providers: [{
                id: "guide",
                name: "Guided Review Explainer",
                available: Boolean(provider),
                provider: provider?.provider || null,
                model: provider?.model || null,
                costAvailable: false,
            }],
        }, noStore());
    }

    if (request.method === "GET" && url.pathname === "/api/agents/jobs") {
        return Response.json({ jobs: snapshotJobs(state), version: state.jobs.size }, noStore());
    }

    if (request.method === "GET" && url.pathname === "/api/agents/jobs/stream") {
        return streamJobs(state);
    }

    if (request.method === "POST" && url.pathname === "/api/agents/jobs") {
        const body = await request.json().catch(() => ({}));
        if (!body || typeof body !== "object" || body.provider !== "guide") {
            return Response.json({ error: "Only the guide provider is available in RunWield code review." }, {
                status: 400,
            });
        }
        const provider = await detectGuideProvider();
        if (!provider && !state.reviewPayload.guidedReviewFixture) {
            return Response.json({
                error:
                    "No Guided Review provider available. Configure RUNWIELD_GUIDED_REVIEW_COMMAND or install claude/codex.",
            }, { status: 503 });
        }
        const entry = createGuideJob(state, provider);
        return Response.json({ job: entry.info }, { status: 202, headers: noStore().headers });
    }

    const deleteMatch = /^\/api\/agents\/jobs\/([^/]+)$/.exec(url.pathname);
    if (request.method === "DELETE" && deleteMatch) {
        const entry = state.jobs.get(decodeURIComponent(deleteMatch[1]));
        if (entry && entry.info.status === "running") {
            entry.abortController.abort("Guide job killed by reviewer.");
            entry.info.status = "killed";
            entry.info.endedAt = Date.now();
            broadcastJobs(state);
        }
        return Response.json({ ok: true }, noStore());
    }

    const guideMatch = /^\/api\/guide\/([^/]+)$/.exec(url.pathname);
    if (request.method === "GET" && guideMatch) {
        const entry = state.jobs.get(decodeURIComponent(guideMatch[1]));
        if (!entry) return Response.json({ error: "Guide not found" }, { status: 404 });
        if (entry.info.status !== "done" || !entry.guide) {
            return Response.json({ error: entry.info.error || "Guide is not ready", job: entry.info }, {
                status: entry.info.status === "failed" ? 422 : 202,
            });
        }
        return Response.json({ ...entry.guide, reviewed: entry.reviewed }, noStore());
    }

    const reviewedMatch = /^\/api\/guide\/([^/]+)\/reviewed$/.exec(url.pathname);
    if (request.method === "PUT" && reviewedMatch) {
        const entry = state.jobs.get(decodeURIComponent(reviewedMatch[1]));
        if (!entry) return Response.json({ error: "Guide not found" }, { status: 404 });
        const body = await request.json().catch(() => ({}));
        entry.reviewed = Array.isArray(body.reviewed) ? body.reviewed.map(Boolean) : [];
        return Response.json({ ok: true }, noStore());
    }

    return null;
}

/** @param {ReviewAgentState} state @param {{ provider: string, model?: string } | null} provider */
function createGuideJob(state, provider) {
    const id = crypto.randomUUID();
    const now = Date.now();
    const changedFiles = parseDiffFiles(String(state.reviewPayload.rawPatch || "")).map((entry) => entry.path);
    const abortController = new AbortController();
    const info = {
        id,
        source: `guide-${id.slice(0, 8)}`,
        provider: "guide",
        label: "Guided Review Explainer",
        status: "running",
        startedAt: now,
        endedAt: null,
        command: provider ? [provider.provider, "guided-review"] : ["fixture"],
        cwd: state.cwd,
        engine: provider?.provider || "fixture",
        model: provider?.model || "unknown",
        tokens: null,
        cost: null,
        costUnavailable: true,
    };
    /** @type {ReviewGuideJobEntry} */
    const entry = { info, guide: null, reviewed: [], abortController, done: Promise.resolve() };
    state.jobs.set(id, entry);
    broadcastJobs(state);
    entry.done = runGuideJob(state, entry, changedFiles);
    return entry;
}

/** @param {ReviewAgentState} state @param {ReviewGuideJobEntry} entry @param {string[]} changedFiles */
async function runGuideJob(state, entry, changedFiles) {
    try {
        let raw;
        /** @type {{ provider?: unknown, model?: unknown }} */
        let meta = { provider: entry.info.engine, model: entry.info.model };
        if (state.reviewPayload.guidedReviewFixture) {
            raw = JSON.stringify(state.reviewPayload.guidedReviewFixture);
            meta = { provider: "fixture", model: "dev-fixture" };
        } else {
            const prompt = buildGuidedReviewPrompt({
                diffText: String(state.reviewPayload.rawPatch || ""),
                gitRef: typeof state.reviewPayload.gitRef === "string"
                    ? state.reviewPayload.gitRef
                    : "RunWield code review diff",
                changedFiles,
                planContent: typeof state.reviewPayload.planContent === "string" ? state.reviewPayload.planContent : "",
                planAttrs: state.reviewPayload.planAttrs && typeof state.reviewPayload.planAttrs === "object"
                    ? /** @type {Record<string, unknown>} */ (state.reviewPayload.planAttrs)
                    : {},
            });
            const result = await state.runGuideCommand(prompt, entry.abortController.signal, state.cwd);
            raw = result.stdout;
            meta = result;
            entry.info.tokens = result.usage || null;
            entry.info.cost = result.cost || null;
            entry.info.costUnavailable = !result.cost;
        }
        const parsed = parseJsonFromModel(raw);
        const validation = validateGuidedReviewExplainer(parsed, { changedFiles });
        if (!validation.ok) throw new Error(validation.errors.join("; "));
        const guide = await state.widgets.registerGuideWidgets(validation.value, entry.info.id);
        entry.guide = guide;
        entry.info.status = "done";
        entry.info.providerName = meta.provider;
        entry.info.model = meta.model || entry.info.model;
        entry.info.endedAt = Date.now();
        entry.info.summary = {
            correctness: "Guide Generated",
            explanation: `${Array.isArray(guide.sections) ? guide.sections.length : 0} sections`,
            confidence: 1,
        };
    } catch (error) {
        if (entry.abortController.signal.aborted && entry.info.status === "killed") return;
        entry.info.status = entry.abortController.signal.aborted ? "killed" : "failed";
        entry.info.error = error instanceof Error ? error.message : String(error);
        entry.info.endedAt = Date.now();
    } finally {
        await recordGuideJobMetric(state, entry);
        broadcastJobs(state);
    }
}

/** @param {ReviewAgentState} state @param {ReviewGuideJobEntry} entry */
async function recordGuideJobMetric(state, entry) {
    const info = /** @type {Record<string, unknown>} */ (withElapsed(entry.info));
    await state.recordWorkflowMetric({
        category: "validation",
        event: "guided_review_generation_result",
        details: {
            status: info.status,
            provider: info.providerName || info.engine,
            model: info.model,
            elapsedMs: info.elapsedMs,
            tokensAvailable: Boolean(info.tokens),
            costAvailable: Boolean(info.cost),
            costUnavailable: Boolean(info.costUnavailable),
            sectionCount: entry.guide && Array.isArray(entry.guide.sections) ? entry.guide.sections.length : 0,
            hasError: typeof info.error === "string" && info.error.length > 0,
            errorKind: classifyGuideJobError(info.error),
        },
    }, { cwd: state.cwd });
}

/** @param {unknown} error */
function classifyGuideJobError(error) {
    if (typeof error !== "string" || !error) return null;
    if (/not JSON|JSON/i.test(error)) return "invalid_json";
    if (/no output|empty/i.test(error)) return "empty_output";
    if (/schemaVersion|sections|blocks|changed file|unsupported|widget|role/i.test(error)) return "schema_invalid";
    if (/killed|aborted|abort/i.test(error)) return "aborted";
    return "provider_failed";
}

/** @param {ReviewAgentState} state */
function snapshotJobs(state) {
    return [...state.jobs.values()].map((entry) => withElapsed(entry.info));
}

/** @param {Record<string, unknown>} info */
function withElapsed(info) {
    const started = typeof info.startedAt === "number" ? info.startedAt : Date.now();
    const ended = typeof info.endedAt === "number" ? info.endedAt : Date.now();
    return { ...info, elapsedMs: Math.max(0, ended - started) };
}

/** @param {ReviewAgentState} state */
function streamJobs(state) {
    const encoder = new TextEncoder();
    const body = new ReadableStream({
        start(controller) {
            state.streams.add(controller);
            controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: "snapshot", jobs: snapshotJobs(state) })}\n\n`),
            );
        },
        cancel() {
            // Controllers are removed lazily on next broadcast if already closed.
        },
    });
    return new Response(body, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } });
}

/** @param {ReviewAgentState} state */
function broadcastJobs(state) {
    const encoder = new TextEncoder();
    const payload = encoder.encode(`data: ${JSON.stringify({ type: "snapshot", jobs: snapshotJobs(state) })}\n\n`);
    for (const controller of [...state.streams]) {
        try {
            controller.enqueue(payload);
        } catch {
            state.streams.delete(controller);
        }
    }
}

/** @param {string} raw */
function parseJsonFromModel(raw) {
    const text = raw.trim();
    if (!text) throw new Error("Guide provider returned no output.");
    try {
        return JSON.parse(text);
    } catch {
        const match = /```(?:json)?\s*([\s\S]*?)```/.exec(text) || /(\{[\s\S]*\})/.exec(text);
        if (!match) throw new Error("Guide provider output was not JSON.");
        return JSON.parse(match[1]);
    }
}

async function detectGuideProvider() {
    const configured = Deno.env.get("RUNWIELD_GUIDED_REVIEW_COMMAND");
    if (configured) {
        return { provider: "custom", model: Deno.env.get("RUNWIELD_GUIDED_REVIEW_MODEL") || "configured-command" };
    }
    if (await commandExists("claude")) return { provider: "claude", model: "claude-cli" };
    if (await commandExists("codex")) return { provider: "codex", model: "codex-cli" };
    return null;
}

/** @param {string} command */
async function commandExists(command) {
    const which = Deno.build.os === "windows" ? "where" : "which";
    const output = await new Deno.Command(which, { args: [command], stdout: "null", stderr: "null" }).output().catch(
        () => ({ success: false }),
    );
    return Boolean(output.success);
}

/** @param {string} prompt @param {AbortSignal} signal @param {string} cwd */
async function runConfiguredGuideCommand(prompt, signal, cwd) {
    const configured = Deno.env.get("RUNWIELD_GUIDED_REVIEW_COMMAND");
    const command = configured
        ? shellCommand(configured)
        : await commandExists("claude")
        ? { command: "claude", args: ["--print"] }
        : { command: "codex", args: ["exec", "-"] };
    const child = new Deno.Command(command.command, {
        args: command.args,
        stdin: "piped",
        stdout: "piped",
        stderr: "piped",
        cwd,
        signal,
    }).spawn();
    const writer = child.stdin.getWriter();
    await writer.write(new TextEncoder().encode(prompt));
    await writer.close();
    const output = await child.output();
    const stdout = new TextDecoder().decode(output.stdout);
    const stderr = new TextDecoder().decode(output.stderr);
    if (!output.success) throw new Error(stderr.trim() || `Guide provider exited with ${output.code}`);
    return {
        stdout,
        stderr,
        provider: configured ? "custom" : command.command,
        model: Deno.env.get("RUNWIELD_GUIDED_REVIEW_MODEL") || command.command,
    };
}

/** @param {string} configured */
function shellCommand(configured) {
    return Deno.build.os === "windows"
        ? { command: "cmd", args: ["/c", configured] }
        : { command: "sh", args: ["-lc", configured] };
}

function noStore() {
    return { headers: { "cache-control": "no-store" } };
}
