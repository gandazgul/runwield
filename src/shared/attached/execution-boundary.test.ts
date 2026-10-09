import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { DENO_CONFIG_PATH, EVIDENCE, withProject } from "./attached-test-fixture.ts";
import { executionInput, readyPlan } from "./execution-test-fixture.ts";

const attachedDir = fromFileUrl(new URL("./", import.meta.url));
const claudeDir = fromFileUrl(new URL("../../attached/claude/", import.meta.url));

async function sources(root: string): Promise<string[]> {
    const texts: string[] = [];
    for await (const entry of Deno.readDir(root)) {
        const path = join(root, entry.name);
        if (entry.isDirectory) texts.push(...await sources(path));
        else if (/\.(ts|js)$/.test(entry.name) && !/test|fixture/.test(entry.name)) {
            texts.push(await Deno.readTextFile(path));
        }
    }
    return texts;
}

Deno.test("Attached invokes the shared preparation and completion authorities, not worktree or lifecycle primitives", async () => {
    const coordinator = await Deno.readTextFile(join(attachedDir, "coordinator.ts"));
    assertStringIncludes(coordinator, 'from "../workflow/execution-start.ts"');
    assertStringIncludes(coordinator, 'from "../workflow/implementation-checkpoint.ts"');
    assert(/createExecutionStartPorts\(\)/.test(coordinator));
    assert(/await startActiveExecutionWorkflow\(/.test(coordinator));
    assert(/await finalizePlanImplementation\(/.test(coordinator));
    for (const text of await sources(attachedDir)) {
        assertEquals(/from\s+["'][^"']*\/worktree\.js["']/.test(text), false);
        assertEquals(/\bupdateEntry\b/.test(text), false);
        assertEquals(
            /\b(createWorktreeGitArtifacts|settleWorktreeAttempt|findReusableWorktree|captureWorktreeTree|checkpointExecutionWorktree|updateWorktreeRegistryEntry)\b/
                .test(text),
            false,
        );
        assertEquals(/event\s*:\s*["'](?:execution_started|implementation_finished)["']/.test(text), false);
    }
    assertStringIncludes(coordinator, 'event: "readiness_passed"');
});

Deno.test("Attached carriers neither construct a RunWield model session nor invoke a model execution backend", async () => {
    for (const text of [...await sources(attachedDir), ...await sources(claudeDir)]) {
        assertEquals(
            /new\s+(?:HostedSession|AgentSession)\s*\(|createAgentSession\s*\(|(?:start|run)AgentTurn\s*\(|from\s+["'][^"']*(?:execution-backend|claude-cli|pi-ai)[^"']*["']/
                .test(text),
            false,
        );
        assertEquals(/new\s+Deno\.Command\s*\(\s*["'](?:claude|pi)["']/.test(text), false);
    }
});

Deno.test("real Attached execution and completion start no Claude or Pi model subprocess", async () => {
    await withProject(async (root) => {
        const ready = await readyPlan(root);
        const bin = await Deno.makeTempDir({ prefix: "attached-model-boundary-" });
        const marker = join(bin, "model-started");
        try {
            for (const name of ["claude", "pi"]) {
                const executable = join(bin, name);
                await Deno.writeTextFile(executable, `#!/bin/sh\nprintf model > '${marker}'\nexit 99\n`);
                await Deno.chmod(executable, 0o755);
            }
            const coordinator = new URL("./coordinator.ts", import.meta.url).href;
            const script = `import {runAttachedOperation} from ${JSON.stringify(coordinator)};
const start = await runAttachedOperation("start_execution", ${JSON.stringify(root)}, ${
                JSON.stringify(JSON.stringify(executionInput(ready, "start")))
            });
if (!start.ok || start.workflow.nextAction.kind !== "implementation") throw new Error(JSON.stringify(start));
const complete = await runAttachedOperation("task_completed", ${
                JSON.stringify(root)
            }, JSON.stringify({operationId:"complete", workflowId:start.workflow.workflowId, expectedRevision:start.workflow.revision, evidence:${
                JSON.stringify(EVIDENCE)
            }, payload:{actionId:start.workflow.nextAction.actionId,message:"- Finished"}}));
if (!complete.ok || complete.workflow.state !== "implemented") throw new Error(JSON.stringify(complete));
console.log("implemented");`;
            const result = await new Deno.Command(Deno.execPath(), {
                args: ["eval", "--no-check", "--config", DENO_CONFIG_PATH, script],
                cwd: root,
                env: { PATH: `${bin}:${Deno.env.get("PATH") || ""}` },
                stdout: "piped",
                stderr: "piped",
            }).output();
            assert(result.success, new TextDecoder().decode(result.stderr));
            assertStringIncludes(new TextDecoder().decode(result.stdout), "implemented");
            assertEquals(await Deno.stat(marker).then(() => true, () => false), false);
        } finally {
            await Deno.remove(bin, { recursive: true });
        }
    });
});
