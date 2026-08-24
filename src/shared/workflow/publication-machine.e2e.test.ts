import { assert, assertEquals } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { addEntry, findById } from "../worktree-registry.js";
import { createTestWorktreeAttempt, git, makeRepo } from "../worktree-test-helpers.js";
import { advanceStoredPublication, startPublicationAttempt } from "./publication-machine.ts";

const DRIVER = join(dirname(fromFileUrl(import.meta.url)), "testing/publication-process-driver.ts");
const CRASH_BOUNDARIES = [
    "integrated_effect",
    "integrated_record",
    "published_effect",
    "published_record",
    "verified_record",
    "cleanup_effect",
];

async function runDriver(configPath: string, crashAfter?: string): Promise<number> {
    const config = JSON.parse(await Deno.readTextFile(configPath)) as Record<string, string>;
    if (crashAfter) config.crashAfter = crashAfter;
    else delete config.crashAfter;
    await Deno.writeTextFile(configPath, JSON.stringify(config));
    const output = await new Deno.Command(Deno.execPath(), {
        args: ["run", "-A", DRIVER, configPath],
        stdout: "piped",
        stderr: "piped",
    }).output();
    if (output.code !== 0 && output.code !== 86) {
        throw new Error(new TextDecoder().decode(output.stderr) || new TextDecoder().decode(output.stdout));
    }
    return output.code;
}

Deno.test("publication survives a real process death at every durable Git/registry boundary", async (test) => {
    for (const crashAfter of CRASH_BOUNDARIES) {
        await test.step(crashAfter, async () => {
            const projectRoot = await makeRepo();
            const remoteRoot = await Deno.makeTempDir({ prefix: "publication-machine-remote-" });
            const worktreeRoot = await Deno.makeTempDir({ prefix: "publication-machine-worktree-" });
            const configPath = await Deno.makeTempFile({ prefix: "publication-machine-driver-", suffix: ".json" });
            try {
                await git(remoteRoot, ["init", "--bare"]);
                await git(projectRoot, ["remote", "add", "origin", remoteRoot]);
                await git(projectRoot, ["push", "-u", "origin", "main"]);
                const worktree = await createTestWorktreeAttempt({
                    projectRoot,
                    planName: `restart-${crashAfter}`,
                    worktreeRoot,
                });
                await Deno.writeTextFile(`${worktree.path}/implementation.txt`, `${crashAfter}\n`);
                await Deno.writeTextFile(`${worktree.path}/artifact-count.txt`, "1\n");
                await git(worktree.path, ["add", "implementation.txt", "artifact-count.txt"]);
                await git(worktree.path, ["commit", "-m", "Validated candidate and artifacts"]);
                const artifactCommit = await git(worktree.path, ["rev-parse", "HEAD"]);
                const targetHead = await git(projectRoot, ["rev-parse", "main"]);
                await addEntry(projectRoot, {
                    id: "attempt-1",
                    planId: "plan-1",
                    planName: `restart-${crashAfter}`,
                    baseBranch: "main",
                    baseRef: "refs/heads/main",
                    baseCommit: targetHead,
                    branch: worktree.branch,
                    path: worktree.path,
                    status: "validated",
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                });
                let attempt = await startPublicationAttempt({
                    projectRoot,
                    attemptId: "attempt-1",
                    planName: `restart-${crashAfter}`,
                    targetBranch: "main",
                    executionBranch: worktree.branch,
                    executionCwd: worktree.path,
                    validatedCommit: artifactCommit,
                    targetHeadAtSeal: targetHead,
                });
                attempt = await advanceStoredPublication(projectRoot, attempt, "artifacts_committed", {
                    artifactCommit,
                    planPaths: ["artifact-count.txt"],
                });
                assertEquals(attempt.phase, "artifacts_committed");

                await Deno.writeTextFile(`${projectRoot}/README.md`, "dirty primary checkout\n");
                await Deno.writeTextFile(`${projectRoot}/untracked-user-file.txt`, "do not touch\n");
                const primaryHead = await git(projectRoot, ["rev-parse", "HEAD"]);
                const primaryStatus = await git(projectRoot, ["status", "--porcelain", "--untracked-files=all"]);
                await Deno.writeTextFile(configPath, JSON.stringify({ projectRoot, attemptId: "attempt-1" }));

                assertEquals(await runDriver(configPath, crashAfter), 86);
                assertEquals(await runDriver(configPath), 0);

                const remoteHeadLine = await git(projectRoot, ["ls-remote", "origin", "refs/heads/main"]);
                const remoteHead = remoteHeadLine.split(/\s+/)[0];
                await git(projectRoot, ["fetch", "origin", "main"]);
                await git(projectRoot, ["merge-base", "--is-ancestor", artifactCommit, remoteHead]);
                assertEquals(await git(projectRoot, ["show", `${remoteHead}:artifact-count.txt`]), "1");
                assertEquals(await git(projectRoot, ["rev-parse", "HEAD"]), primaryHead);
                assertEquals(
                    await git(projectRoot, ["status", "--porcelain", "--untracked-files=all"]),
                    primaryStatus,
                );
                assertEquals(await Deno.readTextFile(`${projectRoot}/README.md`), "dirty primary checkout\n");
                assertEquals(await Deno.readTextFile(`${projectRoot}/untracked-user-file.txt`), "do not touch\n");
                assertEquals(await findById(projectRoot, "attempt-1", { migrate: false }), null);
                assertEquals(await Deno.stat(worktree.path).then(() => true).catch(() => false), false);
                assertEquals(await Deno.stat(attempt.publicationRoot).then(() => true).catch(() => false), false);
                assertEquals((await git(projectRoot, ["branch", "--list", worktree.branch])).trim(), "");
                assert(remoteHead.length >= 40);
            } finally {
                await Deno.remove(projectRoot, { recursive: true }).catch(() => {});
                await Deno.remove(remoteRoot, { recursive: true }).catch(() => {});
                await Deno.remove(worktreeRoot, { recursive: true }).catch(() => {});
                await Deno.remove(configPath).catch(() => {});
            }
        });
    }
});
