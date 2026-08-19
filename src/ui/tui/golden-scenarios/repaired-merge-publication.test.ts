import { assert, assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { loadPlan } from "../../../plan-store.js";
import { git } from "../../../shared/worktree-test-helpers.js";
import { findActiveByPlanName } from "../../../shared/worktree-registry.js";
import { createGoldenIsolatedEnvironment } from "../testing/isolated-environment.js";
import { runGoldenChild } from "../testing/subprocess-runner.js";

interface GoldenChildSuccess {
    ok: true;
    result: {
        actor: { remaining: string[] };
    };
}

const sharedChildPath = fromFileUrl(new URL("../testing/shared-environment-child.ts", import.meta.url));

function parseLastJsonLine(stdout: string): GoldenChildSuccess | null {
    const line = stdout.trim().split("\n").toReversed().find((candidate) => candidate.includes("{"));
    if (!line) return null;
    try {
        return JSON.parse(line.slice(line.indexOf("{"))) as GoldenChildSuccess;
    } catch {
        return null;
    }
}

Deno.test({
    name: "golden PLANNED_CHANGE workflow: Agent-repaired merge publishes after process restart",
    fn: async () => {
        const environment = await createGoldenIsolatedEnvironment();
        const runScenario = (scenarioModule: string, exportName: string, timeoutMs: number) =>
            runGoldenChild([
                "run",
                "-A",
                sharedChildPath,
                JSON.stringify({ scenarioModule, exportName }),
            ], {
                cwd: environment.projectRoot,
                env: environment.env,
                timeoutMs,
                awaitReadyMarker: true,
            });
        try {
            const interrupted = await runScenario(
                "src/ui/tui/golden-scenarios/repaired-merge-interruption.ts",
                "repairedMergeInterruptionScenario",
                60000,
            );
            assert(!interrupted.success, "Expected the first Golden TUI process to be killed after Agent repair.");
            assert(!interrupted.timedOut, "Expected an intentional process interruption, not a test timeout.");
            assertEquals(
                interrupted.code,
                137,
                `Expected SIGKILL after repair.\nstdout:\n${interrupted.stdout}\nstderr:\n${interrupted.stderr}`,
            );

            const attempt = await findActiveByPlanName(environment.projectRoot, "repaired-merge");
            assert(attempt?.path, "Expected the interrupted process to retain its execution worktree.");
            const persisted = await loadPlan(attempt.path, "repaired-merge");
            assert(persisted, "Expected the interrupted process to leave the execution Plan.");
            const repairWorktreePath = persisted.attrs.validationMergeRepairWorktree;
            assert(
                typeof repairWorktreePath === "string" && repairWorktreePath,
                "Expected the interrupted process to persist the repair worktree path.",
            );
            assertEquals(await git(repairWorktreePath, ["status", "--porcelain"]), "");
            assert(await git(repairWorktreePath, ["rev-parse", "HEAD^2"]));
            assertEquals(
                await git(environment.projectRoot, ["show", "main:golden-repaired-merge.txt"]),
                "target version",
            );

            const resumed = await runScenario(
                "src/ui/tui/golden-scenarios/repaired-merge-publication.ts",
                "repairedMergePublicationScenario",
                90000,
            );
            assert(resumed.success, `${resumed.stdout}\n${resumed.stderr}`);
            const payload = parseLastJsonLine(resumed.stdout);
            assert(payload?.ok, "Expected the restarted Golden TUI process to report success.");
            assertEquals(payload.result.actor.remaining, []);
        } finally {
            await environment.cleanup();
        }
    },
});
