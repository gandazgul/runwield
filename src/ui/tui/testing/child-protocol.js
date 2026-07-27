/**
 * @module ui/tui/testing/child-protocol
 * Parent/child protocol for subprocess-isolated Golden TUI scenarios.
 */

import { fromFileUrl, join, toFileUrl } from "@std/path";
import { createGoldenIsolatedEnvironment } from "./isolated-environment.js";
import { runGoldenChild } from "./subprocess-runner.js";

const CHILD_FLAG = "--golden-tui-child";

/**
 * @typedef {Object} GoldenChildScenarioRequest
 * @property {string} scenarioModule
 * @property {string} exportName
 * @property {number} [timeoutMs]
 * @property {boolean} [keepArtifacts]
 */

/** @param {string} stdout */
function parseLastJsonLine(stdout) {
    const line = stdout.trim().split("\n").toReversed().find((candidate) => candidate.includes("{"));
    if (!line) return null;
    try {
        return JSON.parse(line.slice(line.indexOf("{")));
    } catch {
        return null;
    }
}

/**
 * @param {GoldenChildScenarioRequest} request
 * @param {import('./subprocess-runner.js').GoldenChildResult} result
 * @param {unknown} childPayload
 */
async function writeChildFailureArtifact(request, result, childPayload) {
    const artifactDir = await Deno.makeTempDir({ prefix: "runwield-golden-tui-child-failure-" });
    await Deno.writeTextFile(
        join(artifactDir, "child-diagnostics.json"),
        JSON.stringify(
            {
                scenarioModule: request.scenarioModule,
                exportName: request.exportName,
                timedOut: result.timedOut,
                code: result.code,
                stdout: result.stdout,
                stderr: result.stderr,
                childPayload,
            },
            null,
            2,
        ),
    );
    return artifactDir;
}

/**
 * Runs a scenario in a fresh Deno process. The child creates HOME/Project/Git,
 * model/settings, worktree, and registry directories before importing the
 * scenario module or other RunWield code.
 *
 * @param {GoldenChildScenarioRequest} request
 */
export async function runGoldenScenarioChildProcess(request) {
    const normalizedRequest = {
        ...request,
        scenarioModule: request.scenarioModule.startsWith("file:")
            ? request.scenarioModule
            : toFileUrl(join(Deno.cwd(), request.scenarioModule)).href,
    };
    const payload = JSON.stringify(normalizedRequest);
    const result = await runGoldenChild([
        "run",
        "-A",
        fromFileUrl(import.meta.url),
        CHILD_FLAG,
        payload,
    ], { timeoutMs: request.timeoutMs || 5000 });
    const childPayload = parseLastJsonLine(result.stdout);
    if (
        !result.success ||
        (childPayload && typeof childPayload === "object" && "ok" in childPayload &&
            !/** @type {{ ok?: unknown }} */ (childPayload).ok)
    ) {
        const artifactDir = await writeChildFailureArtifact(normalizedRequest, result, childPayload);
        const childArtifact = childPayload && typeof childPayload === "object" && "artifactDir" in childPayload
            ? `; childArtifactDir=${String(/** @type {{ artifactDir?: unknown }} */ (childPayload).artifactDir || "")}`
            : "";
        const error = new Error(
            `Golden child failed${result.timedOut ? " (timeout)" : ""}; artifactDir=${artifactDir}${childArtifact}: ${
                result.stderr || result.stdout
            }`,
        );
        /** @type {Error & { artifactDir?: string, childPayload?: unknown }} */ (error).artifactDir = artifactDir;
        /** @type {Error & { artifactDir?: string, childPayload?: unknown }} */ (error).childPayload = childPayload;
        throw error;
    }
    return childPayload || {};
}

/** @param {GoldenChildScenarioRequest} request */
async function runChild(request) {
    const env = await createGoldenIsolatedEnvironment({ keep: request.keepArtifacts });
    const timeoutArtifactDir = await Deno.makeTempDir({ prefix: "runwield-golden-tui-timeout-" });
    await Deno.writeTextFile(
        join(timeoutArtifactDir, "timeout-diagnostics.json"),
        JSON.stringify(
            {
                scenario: request.exportName,
                screenText: "",
                scrollback: "",
                events: [],
                state: {},
                actor: { consumed: [], remaining: [] },
                runtime: { activeAgent: "startup" },
                cwd: env.projectRoot,
                home: env.home,
            },
            null,
            2,
        ),
    );
    console.log(JSON.stringify({
        ok: false,
        heartbeat: true,
        artifactDir: timeoutArtifactDir,
        env: { root: env.root, projectRoot: env.projectRoot },
    }));
    try {
        for (const [key, value] of Object.entries(env.env)) Deno.env.set(key, value);
        Deno.chdir(env.projectRoot);
        Deno.env.set("WLD_GOLDEN_TUI_CHILD", "1");
        const { _setTestStatePath } = await import("../../../cmd/init/init-state.js");
        _setTestStatePath(join(env.runwieldDir, "init-state.json"));
        const { runGoldenScenario } = await import("./scenario-runner.js");
        const moduleUrl = request.scenarioModule.startsWith("file:")
            ? request.scenarioModule
            : toFileUrl(join(Deno.cwd(), request.scenarioModule)).href;
        const module = await import(moduleUrl);
        const scenario = module[request.exportName];
        if (!scenario) throw new Error(`Missing scenario export: ${request.exportName}`);
        try {
            const result = await runGoldenScenario(scenario, {
                keepArtifacts: request.keepArtifacts,
                artifactRoot: timeoutArtifactDir,
                heartbeatPath: join(timeoutArtifactDir, "timeout-diagnostics.json"),
            });
            await Deno.remove(timeoutArtifactDir, { recursive: true }).catch(() => {});
            console.log(JSON.stringify({ ok: true, result, env: { root: env.root, projectRoot: env.projectRoot } }));
        } catch (error) {
            console.log(JSON.stringify({
                ok: false,
                error: error instanceof Error ? error.message : String(error),
                artifactDir: /** @type {{ artifactDir?: unknown }} */ (error || {}).artifactDir || null,
                env: { root: env.root, projectRoot: env.projectRoot },
            }));
            Deno.exitCode = 1;
            return;
        }
    } finally {
        await env.cleanup();
    }
}

if (import.meta.main && Deno.args[0] === CHILD_FLAG) {
    const request = JSON.parse(Deno.args[1] || "{}");
    await runChild(request);
}
