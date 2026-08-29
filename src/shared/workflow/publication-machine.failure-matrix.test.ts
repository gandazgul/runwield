import { assert, assertEquals, assertExists } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { addEntry, findById } from "../worktree-registry.js";
import { createTestWorktreeAttempt, git, makeRepo } from "../worktree-test-helpers.js";
import { loadPublicationAttempt, publicationRootForAttempt } from "./publication-machine.ts";

const DRIVER = join(dirname(fromFileUrl(import.meta.url)), "testing/publication-process-driver.ts");

type Fixture = {
    projectRoot: string;
    remoteRoot: string;
    worktreeRoot: string;
    configPath: string;
    planName: string;
    worktree: Awaited<ReturnType<typeof createTestWorktreeAttempt>>;
    initialTarget: string;
};

type DriverResult = { code: number; stdout: string; stderr: string };

async function runDriver(configPath: string, crashAfter?: string): Promise<DriverResult> {
    const config = JSON.parse(await Deno.readTextFile(configPath)) as Record<string, string>;
    if (crashAfter) config.crashAfter = crashAfter;
    else delete config.crashAfter;
    await Deno.writeTextFile(configPath, JSON.stringify(config));
    const output = await new Deno.Command(Deno.execPath(), {
        args: ["run", "-A", DRIVER, configPath],
        stdout: "piped",
        stderr: "piped",
    }).output();
    return {
        code: output.code,
        stdout: new TextDecoder().decode(output.stdout),
        stderr: new TextDecoder().decode(output.stderr),
    };
}

async function makeFixture(planName: string, remote = true): Promise<Fixture> {
    const projectRoot = await makeRepo();
    const remoteRoot = await Deno.makeTempDir({ prefix: "publication-failure-remote-" });
    const worktreeRoot = await Deno.makeTempDir({ prefix: "publication-failure-worktree-" });
    const configPath = await Deno.makeTempFile({ prefix: "publication-failure-driver-", suffix: ".json" });
    if (remote) {
        await git(remoteRoot, ["init", "--bare"]);
        await git(projectRoot, ["remote", "add", "origin", remoteRoot]);
        await git(projectRoot, ["push", "-u", "origin", "main"]);
    }
    const worktree = await createTestWorktreeAttempt({ projectRoot, planName, worktreeRoot });
    await Deno.writeTextFile(`${worktree.path}/implementation.txt`, `${planName}\n`);
    const initialTarget = await git(projectRoot, ["rev-parse", "main"]);
    await addEntry(projectRoot, {
        id: "attempt-1",
        planId: "plan-1",
        planName,
        baseBranch: "main",
        baseRef: "refs/heads/main",
        baseCommit: initialTarget,
        branch: worktree.branch,
        path: worktree.path,
        status: "completed",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    });
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
    return { projectRoot, remoteRoot, worktreeRoot, configPath, planName, worktree, initialTarget };
}

async function dispose(fixture: Fixture): Promise<void> {
    await new Deno.Command("git", {
        cwd: fixture.projectRoot,
        args: ["worktree", "remove", "--force", fixture.worktree.path],
        stdout: "null",
        stderr: "null",
    }).output().catch(() => {});
    await Deno.remove(fixture.projectRoot, { recursive: true }).catch(() => {});
    await Deno.remove(fixture.remoteRoot, { recursive: true }).catch(() => {});
    await Deno.remove(fixture.worktreeRoot, { recursive: true }).catch(() => {});
    await Deno.remove(fixture.configPath).catch(() => {});
}

async function assertRecoverable(fixture: Fixture, kind: string): Promise<void> {
    const attempt = await loadPublicationAttempt(fixture.projectRoot, "attempt-1");
    assertExists(attempt);
    assertEquals(attempt.failure?.kind, kind);
    assert((await Deno.stat(fixture.worktree.path)).isDirectory);
    assert((await git(fixture.projectRoot, ["branch", "--list", fixture.worktree.branch])).trim());
    assertExists(await findById(fixture.projectRoot, "attempt-1", { migrate: false }));
}

async function assertPublishedOnce(fixture: Fixture): Promise<void> {
    const remoteHead = (await git(fixture.projectRoot, ["ls-remote", "origin", "refs/heads/main"]))
        .split(/\s+/)[0];
    assertEquals(await git(fixture.projectRoot, ["show", `${remoteHead}:implementation.txt`]), fixture.planName);
    await git(fixture.projectRoot, ["fetch", "origin", "main"]);
    const messages = await git(fixture.projectRoot, ["log", "--all", "--format=%B"]);
    assertEquals(messages.split("RunWield-Publication-Attempt: attempt-1").length - 1, 1);
    assertEquals(await findById(fixture.projectRoot, "attempt-1", { migrate: false }), null);
}

async function writeRejectingHook(remoteRoot: string, message: string): Promise<string> {
    const hookPath = `${remoteRoot}/hooks/pre-receive`;
    await Deno.writeTextFile(hookPath, `#!/bin/sh\necho '${message}' >&2\nexit 1\n`);
    await Deno.chmod(hookPath, 0o755);
    return hookPath;
}

Deno.test("publication failure and recovery matrix uses real Git and fresh processes", async (test) => {
    await test.step("unavailable remote preserves evidence and resumes without rebuilding artifacts", async () => {
        const fixture = await makeFixture("remote-unavailable");
        try {
            await git(fixture.projectRoot, ["remote", "set-url", "origin", `${fixture.remoteRoot}-missing`]);
            assertEquals((await runDriver(fixture.configPath)).code, 1);
            await assertRecoverable(fixture, "remote_unavailable");
            await git(fixture.projectRoot, ["remote", "set-url", "origin", fixture.remoteRoot]);
            assertEquals((await runDriver(fixture.configPath)).code, 0);
            await assertPublishedOnce(fixture);
        } finally {
            await dispose(fixture);
        }
    });

    for (
        const rejection of [
            {
                name: "remote policy rejection",
                message: "protected branch policy: pre-receive hook declined",
                kind: "policy_violation",
            },
            {
                name: "remote permission rejection",
                message: "permission denied: you are not allowed to update this branch",
                kind: "permission_denied",
            },
            { name: "target reference race", message: "stale info: target moved", kind: "target_reference_race" },
        ]
    ) {
        await test.step(`${rejection.name} is durable and succeeds after the cause is removed`, async () => {
            const fixture = await makeFixture(rejection.kind);
            try {
                const hookPath = await writeRejectingHook(fixture.remoteRoot, rejection.message);
                assertEquals((await runDriver(fixture.configPath)).code, 1);
                await assertRecoverable(fixture, rejection.kind);
                await Deno.remove(hookPath);
                assertEquals((await runDriver(fixture.configPath)).code, 0);
                await assertPublishedOnce(fixture);
            } finally {
                await dispose(fixture);
            }
        });
    }

    await test.step("a real target advance refreshes an integration receipt before publication", async () => {
        const fixture = await makeFixture("target-advance-after-integration");
        try {
            assertEquals((await runDriver(fixture.configPath, "integration_receipt")).code, 86);
            const firstIntegration = await loadPublicationAttempt(fixture.projectRoot, "attempt-1");
            assertEquals(firstIntegration?.phase, "target_integrated");

            await Deno.writeTextFile(`${fixture.projectRoot}/arrived-after-integration.txt`, "preserved\n");
            await git(fixture.projectRoot, ["add", "arrived-after-integration.txt"]);
            await git(fixture.projectRoot, ["commit", "-m", "Advance target after integration receipt"]);
            await git(fixture.projectRoot, ["push", "origin", "main"]);
            const advancedTarget = await git(fixture.projectRoot, ["rev-parse", "HEAD"]);

            assertEquals((await runDriver(fixture.configPath)).code, 0);
            await assertPublishedOnce(fixture);
            const remoteHead = (await git(fixture.projectRoot, ["ls-remote", "origin", "refs/heads/main"]))
                .split(/\s+/)[0];
            await git(fixture.projectRoot, ["fetch", "origin", "main"]);
            await git(fixture.projectRoot, ["merge-base", "--is-ancestor", advancedTarget, remoteHead]);
            assertEquals(
                await git(fixture.projectRoot, ["show", `${remoteHead}:arrived-after-integration.txt`]),
                "preserved",
            );
        } finally {
            await dispose(fixture);
        }
    });

    await test.step("a real content conflict can be repaired in the saved publication copy and resumed", async () => {
        const fixture = await makeFixture("content-conflict");
        try {
            await Deno.writeTextFile(`${fixture.projectRoot}/conflict.txt`, "base\n");
            await git(fixture.projectRoot, ["add", "conflict.txt"]);
            await git(fixture.projectRoot, ["commit", "-m", "Add conflict base"]);
            await git(fixture.projectRoot, ["push", "origin", "main"]);
            await git(fixture.worktree.path, ["merge", "main"]);
            await Deno.writeTextFile(`${fixture.worktree.path}/conflict.txt`, "execution\n");
            await git(fixture.worktree.path, ["add", "conflict.txt"]);
            await git(fixture.worktree.path, ["commit", "-m", "Change conflict in execution"]);
            await Deno.writeTextFile(`${fixture.projectRoot}/conflict.txt`, "target\n");
            await git(fixture.projectRoot, ["add", "conflict.txt"]);
            await git(fixture.projectRoot, ["commit", "-m", "Change conflict on target"]);
            await git(fixture.projectRoot, ["push", "origin", "main"]);

            assertEquals((await runDriver(fixture.configPath)).code, 1);
            await assertRecoverable(fixture, "isolated_publication_conflict");
            const repairRoot = publicationRootForAttempt(fixture.projectRoot, "attempt-1");
            assert((await Deno.stat(repairRoot)).isDirectory);
            await Deno.writeTextFile(`${repairRoot}/conflict.txt`, "resolved\n");
            await git(repairRoot, ["add", "conflict.txt"]);
            await git(repairRoot, ["commit", "--no-edit"]);

            await Deno.writeTextFile(`${fixture.projectRoot}/arrived-during-repair.txt`, "preserved\n");
            await git(fixture.projectRoot, ["add", "arrived-during-repair.txt"]);
            await git(fixture.projectRoot, ["commit", "-m", "Advance target during publication repair"]);
            await git(fixture.projectRoot, ["push", "origin", "main"]);
            const advancedTarget = await git(fixture.projectRoot, ["rev-parse", "HEAD"]);

            assertEquals((await runDriver(fixture.configPath, "integration_effect")).code, 86);
            assertEquals(
                (await loadPublicationAttempt(fixture.projectRoot, "attempt-1"))?.phase,
                "artifacts_committed",
            );
            assertEquals((await runDriver(fixture.configPath)).code, 0);
            await assertPublishedOnce(fixture);
            const remoteHead = (await git(fixture.projectRoot, ["ls-remote", "origin", "refs/heads/main"]))
                .split(/\s+/)[0];
            await git(fixture.projectRoot, ["fetch", "origin", "main"]);
            await git(fixture.projectRoot, ["merge-base", "--is-ancestor", advancedTarget, remoteHead]);
            assertEquals(await git(fixture.projectRoot, ["show", `${remoteHead}:conflict.txt`]), "resolved");
            assertEquals(
                await git(fixture.projectRoot, ["show", `${remoteHead}:arrived-during-repair.txt`]),
                "preserved",
            );
        } finally {
            await dispose(fixture);
        }
    });

    await test.step("dirty tracked local target blocks safely and resumes after the checkout is clean", async () => {
        const fixture = await makeFixture("local-dirty", false);
        try {
            await Deno.writeTextFile(`${fixture.projectRoot}/README.md`, "unsaved user edit\n");
            assertEquals((await runDriver(fixture.configPath)).code, 1);
            await assertRecoverable(fixture, "primary_checkout_dirty");
            assertEquals(await Deno.readTextFile(`${fixture.projectRoot}/README.md`), "unsaved user edit\n");
            await git(fixture.projectRoot, ["restore", "README.md"]);
            assertEquals((await runDriver(fixture.configPath)).code, 0);
            assertEquals(await findById(fixture.projectRoot, "attempt-1", { migrate: false }), null);
            assertEquals(await git(fixture.projectRoot, ["show", "main:implementation.txt"]), fixture.planName);
        } finally {
            await dispose(fixture);
        }
    });

    for (const mode of ["remote", "local"] as const) {
        await test.step(`${mode} target rewrite after verification prevents cleanup until exact target is restored`, async () => {
            const fixture = await makeFixture(`${mode}-rewrite`, mode === "remote");
            try {
                assertEquals((await runDriver(fixture.configPath, "verification_receipt")).code, 86);
                const attempt = await loadPublicationAttempt(fixture.projectRoot, "attempt-1");
                assertExists(attempt?.publishedCommit);
                if (mode === "remote") {
                    await git(fixture.projectRoot, ["fetch", "origin", "main"]);
                    await git(fixture.projectRoot, [
                        "push",
                        "--force",
                        "origin",
                        `${fixture.initialTarget}:refs/heads/main`,
                    ]);
                } else {
                    await git(fixture.projectRoot, ["reset", "--hard", fixture.initialTarget]);
                }
                assertEquals((await runDriver(fixture.configPath)).code, 1);
                assertExists(await findById(fixture.projectRoot, "attempt-1", { migrate: false }));
                assert((await Deno.stat(fixture.worktree.path)).isDirectory);
                if (mode === "remote") {
                    await git(fixture.projectRoot, [
                        "push",
                        "--force",
                        "origin",
                        `${attempt.publishedCommit}:refs/heads/main`,
                    ]);
                } else {
                    await git(fixture.projectRoot, ["reset", "--hard", attempt.publishedCommit]);
                }
                assertEquals((await runDriver(fixture.configPath)).code, 0);
                assertEquals(await findById(fixture.projectRoot, "attempt-1", { migrate: false }), null);
            } finally {
                await dispose(fixture);
            }
        });
    }

    await test.step("cleanup preserves a late user file and resumes after it is removed", async () => {
        const fixture = await makeFixture("cleanup-incomplete");
        try {
            assertEquals((await runDriver(fixture.configPath, "verification_receipt")).code, 86);
            const latePath = `${fixture.worktree.path}/late-user-file.txt`;
            await Deno.writeTextFile(latePath, "do not delete me\n");
            assertEquals((await runDriver(fixture.configPath)).code, 1);
            assertEquals(await Deno.readTextFile(latePath), "do not delete me\n");
            assertExists(await findById(fixture.projectRoot, "attempt-1", { migrate: false }));
            assert((await Deno.stat(fixture.worktree.path)).isDirectory);
            await Deno.remove(latePath);
            assertEquals((await runDriver(fixture.configPath)).code, 0);
            assertEquals(await findById(fixture.projectRoot, "attempt-1", { migrate: false }), null);
        } finally {
            await dispose(fixture);
        }
    });

    await test.step("concurrent publishers converge through registry CAS without duplicate artifacts", async () => {
        const fixture = await makeFixture("concurrent-cas");
        try {
            assertEquals((await runDriver(fixture.configPath, "artifact_receipt")).code, 86);
            const command = () =>
                new Deno.Command(Deno.execPath(), {
                    args: ["run", "-A", DRIVER, fixture.configPath],
                    stdout: "piped",
                    stderr: "piped",
                }).output();
            await Promise.all([command(), command()]);
            const settle = await runDriver(fixture.configPath);
            if (settle.code !== 0) {
                const attempt = await loadPublicationAttempt(fixture.projectRoot, "attempt-1");
                const branchHead = await git(fixture.projectRoot, ["rev-parse", fixture.worktree.branch]).catch(
                    (error) => String(error),
                );
                const remoteHead = await git(fixture.projectRoot, ["ls-remote", "origin", "refs/heads/main"]);
                const graph = await git(fixture.projectRoot, ["log", "--all", "--graph", "--oneline", "--decorate"]);
                throw new Error(
                    `${settle.stderr || settle.stdout}\nattempt=${
                        JSON.stringify(attempt)
                    }\nbranch=${branchHead}\nremote=${remoteHead}\n${graph}`,
                );
            }
            await assertPublishedOnce(fixture);
        } finally {
            await dispose(fixture);
        }
    });
});
