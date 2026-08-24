import { assert, assertEquals } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { addEntry, findById } from "../worktree-registry.js";
import { createTestWorktreeAttempt, git, makeRepo } from "../worktree-test-helpers.js";
import { publicationRootForAttempt } from "./publication-machine.ts";

const DRIVER = join(dirname(fromFileUrl(import.meta.url)), "testing/publication-process-driver.ts");
const CRASH_BOUNDARIES = [
    "candidate_effect",
    "candidate_receipt",
    "artifact_effect",
    "artifact_receipt",
    "integration_effect",
    "integration_receipt",
    "target_effect",
    "target_receipt",
    "verification_receipt",
    "cleanup_effect",
    "cleanup_receipt",
    "registry_pruned",
] as const;

type PublicationMode = "remote" | "local";

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

async function runCrashCase(mode: PublicationMode, crashAfter: string): Promise<void> {
    const projectRoot = await makeRepo();
    const remoteRoot = await Deno.makeTempDir({ prefix: "publication-matrix-remote-" });
    const worktreeRoot = await Deno.makeTempDir({ prefix: "publication-matrix-worktree-" });
    const configPath = await Deno.makeTempFile({ prefix: "publication-matrix-driver-", suffix: ".json" });
    const planName = `${mode}-${crashAfter}`;
    try {
        if (mode === "remote") {
            await git(remoteRoot, ["init", "--bare"]);
            await git(projectRoot, ["remote", "add", "origin", remoteRoot]);
            await git(projectRoot, ["push", "-u", "origin", "main"]);
        }
        const worktree = await createTestWorktreeAttempt({ projectRoot, planName, worktreeRoot });
        await Deno.writeTextFile(`${worktree.path}/implementation.txt`, `${mode}-${crashAfter}\n`);
        const targetHead = await git(projectRoot, ["rev-parse", "main"]);
        await addEntry(projectRoot, {
            id: "attempt-1",
            planId: "plan-1",
            planName,
            baseBranch: "main",
            baseRef: "refs/heads/main",
            baseCommit: targetHead,
            branch: worktree.branch,
            path: worktree.path,
            status: "completed",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        });
        await Deno.writeTextFile(`${projectRoot}/untracked-user-file.txt`, "do not touch\n");
        if (mode === "remote") await Deno.writeTextFile(`${projectRoot}/README.md`, "dirty primary checkout\n");
        const primaryHead = await git(projectRoot, ["rev-parse", "HEAD"]);
        const primaryStatus = await git(projectRoot, ["status", "--porcelain", "--untracked-files=all"]);
        await Deno.writeTextFile(
            configPath,
            JSON.stringify({
                projectRoot,
                attemptId: "attempt-1",
                planName,
                targetBranch: "main",
                executionBranch: worktree.branch,
                executionCwd: worktree.path,
            }),
        );

        assertEquals(await runDriver(configPath, crashAfter), 86);
        assertEquals(await runDriver(configPath), 0);

        const targetHeadAfter = mode === "remote"
            ? (await git(projectRoot, ["ls-remote", "origin", "refs/heads/main"])).split(/\s+/)[0]
            : await git(projectRoot, ["rev-parse", "main"]);
        if (mode === "remote") await git(projectRoot, ["fetch", "origin", "main"]);
        await git(projectRoot, ["merge-base", "--is-ancestor", targetHead, targetHeadAfter]);
        assertEquals(await git(projectRoot, ["show", `${targetHeadAfter}:artifact-count.txt`]), "1");
        assertEquals(
            await git(projectRoot, ["show", `${targetHeadAfter}:implementation.txt`]),
            `${mode}-${crashAfter}`,
        );
        const messages = await git(projectRoot, ["log", "--all", "--format=%B"]);
        assertEquals(messages.split("RunWield-Publication-Attempt: attempt-1").length - 1, 1);
        if (mode === "remote") {
            assertEquals(await git(projectRoot, ["rev-parse", "HEAD"]), primaryHead);
            assertEquals(await git(projectRoot, ["status", "--porcelain", "--untracked-files=all"]), primaryStatus);
            assertEquals(await Deno.readTextFile(`${projectRoot}/README.md`), "dirty primary checkout\n");
        } else {
            assert(targetHeadAfter !== primaryHead);
            assertEquals(await Deno.readTextFile(`${projectRoot}/untracked-user-file.txt`), "do not touch\n");
        }
        assertEquals(await findById(projectRoot, "attempt-1", { migrate: false }), null);
        assertEquals(await Deno.stat(worktree.path).then(() => true).catch(() => false), false);
        assertEquals(
            await Deno.stat(publicationRootForAttempt(projectRoot, "attempt-1")).then(() => true).catch(() => false),
            false,
        );
        assertEquals((await git(projectRoot, ["branch", "--list", worktree.branch])).trim(), "");
    } finally {
        await Deno.remove(projectRoot, { recursive: true }).catch(() => {});
        await Deno.remove(remoteRoot, { recursive: true }).catch(() => {});
        await Deno.remove(worktreeRoot, { recursive: true }).catch(() => {});
        await Deno.remove(configPath).catch(() => {});
    }
}

Deno.test("publication survives process death at every effect and receipt boundary in remote and local modes", async (test) => {
    for (const mode of ["remote", "local"] as const) {
        for (const crashAfter of CRASH_BOUNDARIES) {
            await test.step(`${mode}:${crashAfter}`, async () => await runCrashCase(mode, crashAfter));
        }
    }
});
