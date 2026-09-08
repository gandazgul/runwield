import { assert, assertEquals, assertExists } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { getRunWieldRuntimeDir, PROJECT_INTERNAL_RUNTIME_DIR_NAME, RUNWIELD_DIR_NAME } from "../constants.js";
import { withProcessGlobalTestLock } from "../testing/process-global-lock.js";
import { defineCommittedGitFixture, git } from "./git-test-fixture.ts";
import { migrateLegacyProjectRuntimeState, resolveProjectRuntimeLayout } from "./project-runtime-layout.ts";
import { addEntry } from "./worktree-registry.js";
import {
    advanceStoredPublication,
    failStoredPublication,
    startPublicationAttempt,
} from "./workflow/publication-machine.ts";

const fixture = defineCommittedGitFixture({ "README.md": "# Runtime layout fixture\n" });
const REPO_ROOT = dirname(dirname(dirname(fromFileUrl(import.meta.url))));

Deno.test("project runtime layout resolves normal primary and selected internal roots", async () => {
    await withProcessGlobalTestLock(async () => {
        const originalSandboxHome = Deno.env.get("WLD_TEST_SANDBOX_HOME");
        const primaryCheckout = await fixture.checkout({ prefix: "runwield-runtime-layout-primary-" });
        const selectedCheckout = await Deno.makeTempDir({ prefix: "runwield-runtime-layout-selected-" });
        try {
            Deno.env.delete("WLD_TEST_SANDBOX_HOME");
            await git(primaryCheckout, [
                "worktree",
                "add",
                "-b",
                `runtime-layout-test-${crypto.randomUUID()}`,
                selectedCheckout,
            ]);

            const layout = resolveProjectRuntimeLayout(selectedCheckout);
            const resolvedPrimaryCheckout = await Deno.realPath(primaryCheckout);
            const primaryInternalRoot = join(
                resolvedPrimaryCheckout,
                RUNWIELD_DIR_NAME,
                PROJECT_INTERNAL_RUNTIME_DIR_NAME,
            );
            const selectedInternalRoot = join(selectedCheckout, RUNWIELD_DIR_NAME, PROJECT_INTERNAL_RUNTIME_DIR_NAME);

            assertEquals(layout.primary.checkoutRoot, resolvedPrimaryCheckout);
            assertEquals(layout.primary.internalRoot, primaryInternalRoot);
            assertEquals(layout.primary.layoutMarkerPath, join(primaryInternalRoot, "layout.json"));
            assertEquals(layout.primary.layoutMigrationJournalPath, join(primaryInternalRoot, "layout-migration.json"));
            assertEquals(layout.primary.layoutMigrationLockPath, join(primaryInternalRoot, "layout-migration.lock"));
            assertEquals(layout.primary.controllerPlansDir, join(primaryInternalRoot, "controller", "plans"));
            assertEquals(layout.primary.worktreeRegistryPath, join(primaryInternalRoot, "worktrees.json"));
            assertEquals(layout.primary.worktreeRegistryLockPath, join(primaryInternalRoot, "worktrees.lock"));
            assertEquals(
                layout.primary.worktreeRegistryMigrationIssuesPath,
                join(primaryInternalRoot, "worktree-registry-migration-issues.json"),
            );
            assertEquals(layout.primary.publicationStagingRoot, join(primaryInternalRoot, "plan-staging"));
            assertEquals(
                layout.primary.projectSecretStorePath,
                join(primaryInternalRoot, "collaboration-secrets.json"),
            );
            assertEquals(layout.primary.fallbackWorktreesRoot, join(primaryInternalRoot, "worktrees"));
            assertEquals(layout.primary.debugRoot, join(primaryInternalRoot, "debug"));

            assertEquals(layout.selected.checkoutRoot, selectedCheckout);
            assertEquals(layout.selected.internalRoot, selectedInternalRoot);
            assertEquals(layout.selected.planLocksDir, join(selectedInternalRoot, "plan-locks"));
            assertEquals(layout.selected.planCatalogLockPath, join(selectedInternalRoot, "plan-locks", "catalog.lock"));
            assertEquals(layout.selected.transitionJournalsDir, join(selectedInternalRoot, "plan-transitions"));
            assertEquals(layout.selected.planBackupsDir, join(selectedInternalRoot, "plan-backups"));
            assertEquals(
                layout.selected.workRecordSupersessionLockPath,
                join(selectedInternalRoot, "work-record-supersession.lock"),
            );
            assertEquals(
                layout.selected.workRecordSupersessionRecoveryLockPath,
                join(selectedInternalRoot, "work-record-supersession-recovery.lock"),
            );
        } finally {
            if (originalSandboxHome === undefined) Deno.env.delete("WLD_TEST_SANDBOX_HOME");
            else Deno.env.set("WLD_TEST_SANDBOX_HOME", originalSandboxHome);
            await Deno.remove(selectedCheckout, { recursive: true }).catch(() => {});
            await Deno.remove(primaryCheckout, { recursive: true }).catch(() => {});
        }
    });
});

Deno.test("project runtime layout keeps sandboxed primary and selected lock namespaces separate", async () => {
    const primaryCheckout = await fixture.checkout({ prefix: "runwield-runtime-layout-sandbox-primary-" });
    const selectedCheckout = await Deno.makeTempDir({ prefix: "runwield-runtime-layout-sandbox-selected-" });
    try {
        await git(primaryCheckout, [
            "worktree",
            "add",
            "-b",
            `runtime-layout-sandbox-test-${crypto.randomUUID()}`,
            selectedCheckout,
        ]);

        const layout = resolveProjectRuntimeLayout(selectedCheckout);
        const resolvedPrimaryCheckout = await Deno.realPath(primaryCheckout);
        const primaryInternalRoot = join(
            getRunWieldRuntimeDir(resolvedPrimaryCheckout),
            PROJECT_INTERNAL_RUNTIME_DIR_NAME,
        );
        const selectedInternalRoot = join(getRunWieldRuntimeDir(selectedCheckout), PROJECT_INTERNAL_RUNTIME_DIR_NAME);

        assertEquals(layout.primary.checkoutRoot, resolvedPrimaryCheckout);
        assertEquals(layout.selected.checkoutRoot, selectedCheckout);
        assertEquals(layout.primary.internalRoot, primaryInternalRoot);
        assertEquals(layout.selected.internalRoot, selectedInternalRoot);
        assertEquals(dirname(layout.primary.controllerPlansDir), join(primaryInternalRoot, "controller"));
        assertEquals(dirname(layout.selected.planCatalogLockPath), join(selectedInternalRoot, "plan-locks"));
        assertEquals(layout.primary.worktreeRegistryPath, join(primaryInternalRoot, "worktrees.json"));
        assertEquals(layout.selected.transitionJournalsDir, join(selectedInternalRoot, "plan-transitions"));
    } finally {
        await Deno.remove(selectedCheckout, { recursive: true }).catch(() => {});
        await Deno.remove(primaryCheckout, { recursive: true }).catch(() => {});
    }
});

Deno.test("legacy migration adopts primary and selected runtime leaves once", async () => {
    const project = await makeMigrationProject();
    try {
        const primaryBase = getRunWieldRuntimeDir(project.primaryRoot);
        const selectedBase = getRunWieldRuntimeDir(project.selectedRoot);
        await writeText(join(primaryBase, "controller", "plans", "plan.json"), "controller\n");
        await writeText(
            join(primaryBase, "worktrees.json"),
            JSON.stringify({ version: 1, entries: [project.registryEntry] }, null, 2),
        );
        await writeText(join(primaryBase, "worktree-registry-migration-issues.json"), "issues\n");
        await writeText(join(primaryBase, "worktrees", "fallback.txt"), "fallback\n");
        await writeText(join(primaryBase, "debug", "trace.txt"), "debug\n");
        await writeText(
            join(primaryBase, "collaboration-secrets.json"),
            `${JSON.stringify({ schemaVersion: 1, records: {} })}\n`,
        );
        await writeText(join(selectedBase, "plan-transitions", "t.json"), "transition\n");
        await writeText(join(selectedBase, "plan-backups", "b.json"), "backup\n");

        const result = await migrateLegacyProjectRuntimeState(project.selectedRoot);
        if (result.kind !== "ready") throw new Error(`Expected ready, got ${result.kind}`);
        assertEquals(result.migrated, true);
        assert(result.adoptedSelectedCheckoutRoots.includes(project.selectedRoot));

        const layout = resolveProjectRuntimeLayout(project.selectedRoot);
        assertEquals(
            await Deno.readTextFile(join(layout.primary.internalRoot, "controller", "plans", "plan.json")),
            "controller\n",
        );
        assertEquals(JSON.parse(await Deno.readTextFile(layout.primary.worktreeRegistryPath)), {
            version: 1,
            entries: [project.registryEntry],
        });
        assertEquals(await Deno.readTextFile(layout.primary.worktreeRegistryMigrationIssuesPath), "issues\n");
        assertEquals(await Deno.readTextFile(join(layout.primary.fallbackWorktreesRoot, "fallback.txt")), "fallback\n");
        assertEquals(await Deno.readTextFile(join(layout.primary.debugRoot, "trace.txt")), "debug\n");
        assertEquals(
            await Deno.readTextFile(layout.primary.projectSecretStorePath),
            `${JSON.stringify({ schemaVersion: 1, records: {} })}\n`,
        );
        assertEquals(await Deno.readTextFile(join(layout.selected.transitionJournalsDir, "t.json")), "transition\n");
        assertEquals(await Deno.readTextFile(join(layout.selected.planBackupsDir, "b.json")), "backup\n");
        await assertMissing(join(primaryBase, "controller"));
        await assertMissing(join(selectedBase, "plan-transitions"));
        const marker = JSON.parse(await Deno.readTextFile(layout.primary.layoutMarkerPath));
        assertEquals(marker.version, 1);
        assertEquals(marker.primaryCheckoutRoot, project.primaryRoot);
        assertEquals(marker.adoptedSelectedCheckoutRoots, [project.selectedRoot]);

        const before = await snapshotTree(layout.primary.internalRoot);
        const again = await migrateLegacyProjectRuntimeState(project.selectedRoot);
        if (again.kind !== "ready") throw new Error(`Expected ready, got ${again.kind}`);
        assertEquals(again.migrated, false);
        assertEquals(await snapshotTree(layout.primary.internalRoot), before);
    } finally {
        await project.cleanup();
    }
});

Deno.test("legacy migration blocks malformed registry without creating internal state", async () => {
    const project = await makeMigrationProject();
    try {
        await writeText(join(getRunWieldRuntimeDir(project.primaryRoot), "worktrees.json"), "not json");
        const result = await migrateLegacyProjectRuntimeState(project.selectedRoot);
        if (result.kind !== "blocked") throw new Error(`Expected blocked, got ${result.kind}`);
        assertEquals(result.reason, "malformed_registry");
        await assertMissing(resolveProjectRuntimeLayout(project.selectedRoot).primary.internalRoot);
    } finally {
        await project.cleanup();
    }
});

Deno.test("legacy migration blocks tracked project secrets with rotation guidance", async () => {
    const project = await makeMigrationProject();
    try {
        await writeText(join(project.primaryRoot, ".wld", "collaboration-secrets.json"), "secret\n");
        await git(project.primaryRoot, ["add", ".wld/collaboration-secrets.json"]);
        const result = await migrateLegacyProjectRuntimeState(project.selectedRoot);
        if (result.kind !== "blocked") throw new Error(`Expected blocked, got ${result.kind}`);
        assertEquals(result.reason, "tracked_secret");
        assertExists(result.securityAction);
        assertEquals(result.securityAction.rotateCapabilities, true);
        await assertMissing(resolveProjectRuntimeLayout(project.selectedRoot).primary.internalRoot);
    } finally {
        await project.cleanup();
    }
});

Deno.test("legacy migration blocks symlinked authorities before adoption", async () => {
    const project = await makeMigrationProject();
    try {
        const primaryBase = getRunWieldRuntimeDir(project.primaryRoot);
        await Deno.mkdir(primaryBase, { recursive: true });
        await Deno.symlink(project.primaryRoot, join(primaryBase, "controller"));
        const result = await migrateLegacyProjectRuntimeState(project.selectedRoot);
        if (result.kind !== "blocked") throw new Error(`Expected blocked, got ${result.kind}`);
        assertEquals(result.reason, "symlink");
        await assertMissing(resolveProjectRuntimeLayout(project.selectedRoot).primary.internalRoot);
    } finally {
        await project.cleanup();
    }
});

Deno.test("legacy migration resumes when a journaled rename already reached its destination", async () => {
    const project = await makeMigrationProject();
    try {
        const layout = resolveProjectRuntimeLayout(project.selectedRoot);
        const primaryBase = getRunWieldRuntimeDir(project.primaryRoot);
        await writeText(join(layout.primary.internalRoot, "controller", "plans", "plan.json"), "controller\n");
        await writeText(
            layout.primary.layoutMigrationJournalPath,
            `${
                JSON.stringify(
                    {
                        version: 1,
                        primaryCheckoutRoot: project.primaryRoot,
                        selectedCheckoutRoots: [project.selectedRoot],
                        operations: [{
                            action: "rename",
                            source: join(primaryBase, "controller"),
                            destination: join(layout.primary.internalRoot, "controller"),
                            kind: "directory",
                            completed: false,
                        }],
                        updatedAt: "2026-01-01T00:00:00.000Z",
                    },
                    null,
                    2,
                )
            }\n`,
        );

        const result = await migrateLegacyProjectRuntimeState(project.selectedRoot);
        if (result.kind !== "ready") throw new Error(`Expected ready, got ${result.kind}`);
        assertEquals(
            await Deno.readTextFile(join(layout.primary.internalRoot, "controller", "plans", "plan.json")),
            "controller\n",
        );
        await assertMissing(layout.primary.layoutMigrationJournalPath);
        const marker = JSON.parse(await Deno.readTextFile(layout.primary.layoutMarkerPath));
        assertEquals(marker.adoptedSelectedCheckoutRoots, [project.selectedRoot]);
    } finally {
        await project.cleanup();
    }
});

Deno.test("legacy migration blocks publication state until cleanup is complete", async () => {
    await withProcessGlobalTestLock(async () => {
        const originalSandboxHome = Deno.env.get("WLD_TEST_SANDBOX_HOME");
        try {
            Deno.env.delete("WLD_TEST_SANDBOX_HOME");
            const unfinished = await makeMigrationProject();
            try {
                await addEntry(unfinished.primaryRoot, {
                    ...unfinished.registryEntry,
                    planId: "plan-demo",
                    status: "validated",
                });
                const candidate = await startPublicationAttempt({
                    projectRoot: unfinished.primaryRoot,
                    attemptId: unfinished.registryEntry.id,
                    planName: unfinished.registryEntry.planName,
                    targetBranch: "main",
                    executionBranch: unfinished.registryEntry.branch,
                    executionCwd: unfinished.selectedRoot,
                    validatedCommit: unfinished.registryEntry.baseCommit,
                    targetHeadAtSeal: unfinished.registryEntry.baseCommit,
                });

                const blocked = await migrateLegacyProjectRuntimeState(unfinished.selectedRoot);
                if (blocked.kind !== "blocked") throw new Error(`Expected blocked, got ${blocked.kind}`);
                assertEquals(blocked.reason, "unfinished_publication");

                const repaired = await failStoredPublication(unfinished.primaryRoot, candidate, {
                    kind: "needs_repair",
                    message: "repair",
                    repairRoot: join(
                        getRunWieldRuntimeDir(unfinished.primaryRoot),
                        "plan-staging",
                        unfinished.registryEntry.id,
                    ),
                });
                const repairBlocked = await migrateLegacyProjectRuntimeState(unfinished.selectedRoot);
                if (repairBlocked.kind !== "blocked") throw new Error(`Expected blocked, got ${repairBlocked.kind}`);
                assertEquals(repairBlocked.reason, "saved_repair_root");
                assertEquals(
                    repaired.failure?.repairRoot,
                    join(getRunWieldRuntimeDir(unfinished.primaryRoot), "plan-staging", unfinished.registryEntry.id),
                );
            } finally {
                await unfinished.cleanup();
            }

            const complete = await makeMigrationProject();
            try {
                await addEntry(complete.primaryRoot, {
                    ...complete.registryEntry,
                    planId: "plan-demo",
                    status: "validated",
                });
                const candidate = await startPublicationAttempt({
                    projectRoot: complete.primaryRoot,
                    attemptId: complete.registryEntry.id,
                    planName: complete.registryEntry.planName,
                    targetBranch: "main",
                    executionBranch: complete.registryEntry.branch,
                    executionCwd: complete.selectedRoot,
                    validatedCommit: complete.registryEntry.baseCommit,
                    targetHeadAtSeal: complete.registryEntry.baseCommit,
                });
                const artifacts = await advanceStoredPublication(
                    complete.primaryRoot,
                    candidate,
                    "artifacts_committed",
                    {
                        artifactCommit: complete.registryEntry.baseCommit,
                        planPaths: ["docs/plans/demo.md"],
                    },
                );
                const integrated = await advanceStoredPublication(
                    complete.primaryRoot,
                    artifacts,
                    "target_integrated",
                    {
                        targetBaseCommit: complete.registryEntry.baseCommit,
                        integrationCommit: complete.registryEntry.baseCommit,
                    },
                );
                const published = await advanceStoredPublication(complete.primaryRoot, integrated, "target_published", {
                    publicationMode: "local",
                    publishedCommit: complete.registryEntry.baseCommit,
                });
                const verified = await advanceStoredPublication(
                    complete.primaryRoot,
                    published,
                    "publication_verified",
                    {
                        verifiedAt: "2026-01-01T00:01:00.000Z",
                    },
                );
                await advanceStoredPublication(complete.primaryRoot, verified, "cleanup_complete", {
                    cleanedAt: "2026-01-01T00:02:00.000Z",
                });

                const result = await migrateLegacyProjectRuntimeState(complete.selectedRoot);
                if (result.kind !== "ready") throw new Error(`Expected ready, got ${result.kind}`);
                assertEquals(result.migrated, true);
            } finally {
                await complete.cleanup();
            }
        } finally {
            if (originalSandboxHome === undefined) Deno.env.delete("WLD_TEST_SANDBOX_HOME");
            else Deno.env.set("WLD_TEST_SANDBOX_HOME", originalSandboxHome);
        }
    });
});

Deno.test("legacy migration treats a held controller inode lock as an active writer", async () => {
    const project = await makeMigrationProject();
    let child: Deno.ChildProcess | undefined;
    try {
        const controllerLock = join(
            getRunWieldRuntimeDir(project.primaryRoot),
            "controller",
            "plans",
            "driver.json.lock",
        );
        child = new Deno.Command(Deno.execPath(), {
            cwd: REPO_ROOT,
            args: [
                "run",
                "-A",
                "src/shared/testing/project-runtime-migration-process-driver.ts",
                "hold-controller-lock",
                project.primaryRoot,
                controllerLock,
            ],
            stdout: "piped",
            stderr: "piped",
        }).spawn();
        await readReadyLine(child.stdout);
        const result = await migrateLegacyProjectRuntimeState(project.selectedRoot);
        if (result.kind !== "blocked") throw new Error(`Expected blocked, got ${result.kind}`);
        assertEquals(result.reason, "active_legacy_writer");
        assert(result.paths.includes(controllerLock));
    } finally {
        child?.kill("SIGKILL");
        await child?.status.catch(() => {});
        await project.cleanup();
    }
});

type MigrationProject = {
    primaryRoot: string;
    selectedRoot: string;
    registryEntry: {
        id: string;
        planName: string;
        baseBranch: string;
        baseRef: string;
        baseCommit: string;
        branch: string;
        path: string;
        status: string;
        createdAt: string;
        updatedAt: string;
    };
    cleanup: () => Promise<void>;
};

async function makeMigrationProject(): Promise<MigrationProject> {
    const primaryCheckout = await fixture.checkout({ prefix: "runwield-runtime-migration-primary-" });
    const selectedCheckout = await Deno.makeTempDir({ prefix: "runwield-runtime-migration-selected-" });
    const branch = `runtime-migration-${crypto.randomUUID()}`;
    await git(primaryCheckout, ["worktree", "add", "-b", branch, selectedCheckout]);
    const primaryRoot = await Deno.realPath(primaryCheckout);
    const selectedRoot = await Deno.realPath(selectedCheckout);
    const baseCommit = await git(primaryRoot, ["rev-parse", "HEAD"]);
    const now = "2026-01-01T00:00:00.000Z";
    return {
        primaryRoot,
        selectedRoot,
        registryEntry: {
            id: "attempt-1",
            planName: "demo",
            baseBranch: "main",
            baseRef: "refs/heads/main",
            baseCommit,
            branch,
            path: selectedRoot,
            status: "abandoned",
            createdAt: now,
            updatedAt: now,
        },
        cleanup: async () => {
            await git(primaryRoot, ["worktree", "remove", "--force", selectedRoot]).catch(() => {});
            await Deno.remove(primaryRoot, { recursive: true }).catch(() => {});
            await Deno.remove(selectedRoot, { recursive: true }).catch(() => {});
        },
    };
}

async function writeText(path: string, contents: string): Promise<void> {
    await Deno.mkdir(dirname(path), { recursive: true });
    await Deno.writeTextFile(path, contents);
}

async function assertMissing(path: string): Promise<void> {
    try {
        await Deno.lstat(path);
        throw new Error(`Expected ${path} to be absent.`);
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) return;
        throw error;
    }
}

async function snapshotTree(root: string): Promise<string> {
    const lines: string[] = [];
    await collectSnapshot(root, root, lines);
    return lines.sort().join("\n");
}

async function collectSnapshot(root: string, path: string, lines: string[]): Promise<void> {
    const info = await Deno.lstat(path);
    const relativePath = path === root ? "." : path.slice(root.length + 1);
    lines.push(`${relativePath}:${info.mode ?? 0}:${info.size}:${info.isDirectory ? "dir" : "file"}`);
    if (!info.isDirectory) {
        lines.push(await Deno.readTextFile(path).catch(() => "<binary>"));
        return;
    }
    for await (const entry of Deno.readDir(path)) await collectSnapshot(root, join(path, entry.name), lines);
}

async function readReadyLine(stdout: ReadableStream<Uint8Array>): Promise<void> {
    const reader = stdout.getReader();
    const decoder = new TextDecoder();
    let text = "";
    while (!text.includes("ready")) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error("Driver exited before it held the lock.");
        text += decoder.decode(chunk.value);
    }
    reader.releaseLock();
}
