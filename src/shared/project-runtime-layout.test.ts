import { assert, assertEquals, assertExists } from "@std/assert";
import { dirname, fromFileUrl, join, resolve } from "@std/path";
import { getRunWieldRuntimeDir, PROJECT_INTERNAL_RUNTIME_DIR_NAME, RUNWIELD_DIR_NAME } from "../constants.js";
import { withProcessGlobalTestLock } from "../testing/process-global-lock.js";
import { defineCommittedGitFixture, git } from "./git-test-fixture.ts";
import {
    migrateLegacyProjectRuntimeState,
    type ProjectRuntimeMigrationResult,
    resolveProjectRuntimeLayout,
} from "./project-runtime-layout.ts";
import {
    advancePublicationAttempt,
    createPublicationAttempt,
    recordPublicationFailure,
} from "./workflow/publication-attempt.ts";

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
        const controllerRoot = join(primaryBase, "controller");
        await writeText(join(controllerRoot, "plans", "plan.json"), "controller\n");
        await Deno.chmod(controllerRoot, 0o700).catch(() => {});
        await writeText(
            join(primaryBase, "worktrees.json"),
            JSON.stringify({ version: 1, entries: [project.registryEntry] }, null, 2),
        );
        await writeText(join(primaryBase, "worktree-registry-migration-issues.json"), "issues\n");
        await writeText(join(primaryBase, "worktrees", "fallback.txt"), "fallback\n");
        await writeText(join(primaryBase, "debug", "trace.txt"), "debug\n");
        const secretPath = join(primaryBase, "collaboration-secrets.json");
        await writeText(
            secretPath,
            `${JSON.stringify({ schemaVersion: 1, records: {} })}\n`,
        );
        await Deno.chmod(secretPath, 0o600).catch(() => {});
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
        assertEquals(((await Deno.lstat(join(layout.primary.internalRoot, "controller"))).mode ?? 0) & 0o777, 0o700);
        assertEquals(((await Deno.lstat(layout.primary.projectSecretStorePath)).mode ?? 0) & 0o777, 0o600);
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

Deno.test("legacy migration blocks when a completed journal receipt has two authorities", async () => {
    const project = await makeMigrationProject();
    try {
        const layout = resolveProjectRuntimeLayout(project.selectedRoot);
        const primaryBase = getRunWieldRuntimeDir(project.primaryRoot);
        await writeText(join(primaryBase, "controller", "plans", "legacy.json"), "legacy\n");
        await writeText(join(layout.primary.internalRoot, "controller", "plans", "internal.json"), "internal\n");
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
                            completed: true,
                        }],
                        updatedAt: "2026-01-01T00:00:00.000Z",
                    },
                    null,
                    2,
                )
            }\n`,
        );

        const result = await migrateLegacyProjectRuntimeState(project.selectedRoot);
        if (result.kind !== "blocked") throw new Error(`Expected blocked, got ${result.kind}`);
        assertEquals(result.reason, "authority_conflict");
        assertEquals(await Deno.readTextFile(join(primaryBase, "controller", "plans", "legacy.json")), "legacy\n");
        assertEquals(
            await Deno.readTextFile(join(layout.primary.internalRoot, "controller", "plans", "internal.json")),
            "internal\n",
        );
    } finally {
        await project.cleanup();
    }
});

Deno.test("legacy migration does not block on unrelated user symlinks under .wld", async () => {
    const project = await makeMigrationProject();
    try {
        const primaryBase = getRunWieldRuntimeDir(project.primaryRoot);
        await Deno.mkdir(primaryBase, { recursive: true });
        await Deno.symlink(project.primaryRoot, join(primaryBase, "user-owned-link"));
        await writeText(join(primaryBase, "controller", "plans", "plan.json"), "controller\n");

        const result = await migrateLegacyProjectRuntimeState(project.selectedRoot);
        if (result.kind !== "ready") throw new Error(`Expected ready, got ${result.kind}`);
        assertEquals(
            await Deno.readTextFile(join(result.layout.primary.controllerPlansDir, "plan.json")),
            "controller\n",
        );
        assertEquals((await Deno.lstat(join(primaryBase, "user-owned-link"))).isSymlink, true);
    } finally {
        await project.cleanup();
    }
});

Deno.test("legacy migration blocks orphan publication staging", async () => {
    const project = await makeMigrationProject();
    try {
        const stagingPath = join(getRunWieldRuntimeDir(project.primaryRoot), "plan-staging", "orphan", "receipt.json");
        await writeText(stagingPath, "receipt\n");

        const result = await migrateLegacyProjectRuntimeState(project.selectedRoot);
        if (result.kind !== "blocked") throw new Error(`Expected blocked, got ${result.kind}`);
        assertEquals(result.reason, "unfinished_publication");
        assert(result.paths.includes(join(getRunWieldRuntimeDir(project.primaryRoot), "plan-staging", "orphan")));
        assertEquals(await Deno.readTextFile(stagingPath), "receipt\n");
        await assertMissing(resolveProjectRuntimeLayout(project.selectedRoot).primary.internalRoot);
    } finally {
        await project.cleanup();
    }
});

Deno.test("legacy migration blocks tracked secret temp files with rotation guidance", async () => {
    const project = await makeMigrationProject();
    try {
        await writeText(join(project.primaryRoot, ".wld", "collaboration-secrets.json.token.tmp"), "secret\n");
        await git(project.primaryRoot, ["add", ".wld/collaboration-secrets.json.token.tmp"]);
        const result = await migrateLegacyProjectRuntimeState(project.selectedRoot);
        if (result.kind !== "blocked") throw new Error(`Expected blocked, got ${result.kind}`);
        assertEquals(result.reason, "tracked_secret");
        assertExists(result.securityAction);
        assertEquals(result.securityAction.removeFromRepositoryHistory, true);
        await assertMissing(resolveProjectRuntimeLayout(project.selectedRoot).primary.internalRoot);
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
                const candidate = createPublicationAttempt({
                    attemptId: unfinished.registryEntry.id,
                    planId: "plan-demo",
                    planName: unfinished.registryEntry.planName,
                    targetBranch: "main",
                    executionBranch: unfinished.registryEntry.branch,
                    executionCwd: unfinished.selectedRoot,
                    publicationRoot: join(
                        getRunWieldRuntimeDir(unfinished.primaryRoot),
                        "plan-staging",
                        unfinished.registryEntry.id,
                    ),
                    validatedCommit: unfinished.registryEntry.baseCommit,
                    targetHeadAtSeal: unfinished.registryEntry.baseCommit,
                });
                await writeText(
                    join(getRunWieldRuntimeDir(unfinished.primaryRoot), "worktrees.json"),
                    JSON.stringify({
                        version: 2,
                        entries: [{
                            ...unfinished.registryEntry,
                            planId: "plan-demo",
                            status: "validated",
                            publication: candidate,
                        }],
                    }),
                );

                const blocked = await migrateLegacyProjectRuntimeState(unfinished.selectedRoot);
                if (blocked.kind !== "blocked") throw new Error(`Expected blocked, got ${blocked.kind}`);
                assertEquals(blocked.reason, "unfinished_publication");

                const repaired = recordPublicationFailure(candidate, {
                    kind: "needs_repair",
                    message: "repair",
                    repairRoot: join(
                        getRunWieldRuntimeDir(unfinished.primaryRoot),
                        "plan-staging",
                        unfinished.registryEntry.id,
                    ),
                });
                await writeText(
                    join(getRunWieldRuntimeDir(unfinished.primaryRoot), "worktrees.json"),
                    JSON.stringify({
                        version: 2,
                        entries: [{
                            ...unfinished.registryEntry,
                            planId: "plan-demo",
                            status: "validated",
                            publication: repaired,
                        }],
                    }),
                );
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
                const candidate = createPublicationAttempt({
                    attemptId: complete.registryEntry.id,
                    planId: "plan-demo",
                    planName: complete.registryEntry.planName,
                    targetBranch: "main",
                    executionBranch: complete.registryEntry.branch,
                    executionCwd: complete.selectedRoot,
                    publicationRoot: join(
                        getRunWieldRuntimeDir(complete.primaryRoot),
                        "plan-staging",
                        complete.registryEntry.id,
                    ),
                    validatedCommit: complete.registryEntry.baseCommit,
                    targetHeadAtSeal: complete.registryEntry.baseCommit,
                });
                const artifacts = advancePublicationAttempt(candidate, "artifacts_committed", {
                    artifactCommit: complete.registryEntry.baseCommit,
                    planPaths: ["docs/plans/demo.md"],
                });
                const integrated = advancePublicationAttempt(artifacts, "target_integrated", {
                    targetBaseCommit: complete.registryEntry.baseCommit,
                    integrationCommit: complete.registryEntry.baseCommit,
                });
                const published = advancePublicationAttempt(integrated, "target_published", {
                    publicationMode: "local",
                    publishedCommit: complete.registryEntry.baseCommit,
                });
                const verified = advancePublicationAttempt(published, "publication_verified", {
                    verifiedAt: "2026-01-01T00:01:00.000Z",
                });
                const cleaned = advancePublicationAttempt(verified, "cleanup_complete", {
                    cleanedAt: "2026-01-01T00:02:00.000Z",
                });
                await writeText(
                    join(getRunWieldRuntimeDir(complete.primaryRoot), "worktrees.json"),
                    JSON.stringify({
                        version: 2,
                        entries: [{
                            ...complete.registryEntry,
                            planId: "plan-demo",
                            status: "validated",
                            publication: cleaned,
                        }],
                    }),
                );

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

Deno.test("legacy migration rejects a journal that retires an unbounded lock path", async () => {
    const project = await makeMigrationProject();
    try {
        const layout = resolveProjectRuntimeLayout(project.selectedRoot);
        const externalLock = await Deno.makeTempFile({ prefix: "runwield-external-", suffix: ".lock" });
        await Deno.writeTextFile(externalLock, "external\n");
        const stat = await Deno.stat(externalLock);
        await writeText(
            layout.primary.layoutMigrationJournalPath,
            `${
                JSON.stringify(
                    {
                        version: 1,
                        primaryCheckoutRoot: project.primaryRoot,
                        selectedCheckoutRoots: [project.selectedRoot],
                        operations: [{
                            action: "retire",
                            source: externalLock,
                            kind: "file",
                            proof: { text: "external\n", mtime: stat.mtime?.getTime() ?? Date.now(), size: stat.size },
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
        if (result.kind !== "blocked") throw new Error(`Expected blocked, got ${result.kind}`);
        assertEquals(result.reason, "malformed_migration_evidence");
        assertEquals(await Deno.readTextFile(externalLock), "external\n");
        await Deno.remove(externalLock);
    } finally {
        await project.cleanup();
    }
});

Deno.test("legacy migration rejects an existing journal that omits required operations", async () => {
    const project = await makeMigrationProject();
    try {
        const layout = resolveProjectRuntimeLayout(project.selectedRoot);
        await writeText(join(getRunWieldRuntimeDir(project.primaryRoot), "controller", "plans", "plan.json"), "x\n");
        await writeText(
            layout.primary.layoutMigrationJournalPath,
            `${
                JSON.stringify(
                    {
                        version: 1,
                        primaryCheckoutRoot: project.primaryRoot,
                        selectedCheckoutRoots: [project.selectedRoot],
                        operations: [],
                        updatedAt: "2026-01-01T00:00:00.000Z",
                    },
                    null,
                    2,
                )
            }\n`,
        );
        const result = await migrateLegacyProjectRuntimeState(project.selectedRoot);
        if (result.kind !== "blocked") throw new Error(`Expected blocked, got ${result.kind}`);
        assertEquals(result.reason, "malformed_migration_evidence");
        await assertMissing(layout.primary.layoutMarkerPath);
        assertEquals(
            await Deno.readTextFile(
                join(getRunWieldRuntimeDir(project.primaryRoot), "controller", "plans", "plan.json"),
            ),
            "x\n",
        );
    } finally {
        await project.cleanup();
    }
});

Deno.test("legacy migration cleans completed journal and migration lock after marker replacement", async () => {
    const project = await makeMigrationProject();
    try {
        const layout = resolveProjectRuntimeLayout(project.selectedRoot);
        await writeText(
            layout.primary.layoutMarkerPath,
            `${
                JSON.stringify(
                    {
                        version: 1,
                        primaryCheckoutRoot: project.primaryRoot,
                        adoptedSelectedCheckoutRoots: [project.selectedRoot],
                        completedAt: "2026-01-01T00:00:00.000Z",
                    },
                    null,
                    2,
                )
            }\n`,
        );
        await writeText(
            layout.primary.layoutMigrationJournalPath,
            `${
                JSON.stringify(
                    {
                        version: 1,
                        primaryCheckoutRoot: project.primaryRoot,
                        selectedCheckoutRoots: [project.selectedRoot],
                        operations: [],
                        updatedAt: "2026-01-01T00:00:00.000Z",
                    },
                    null,
                    2,
                )
            }\n`,
        );
        await writeText(
            layout.primary.layoutMigrationLockPath,
            JSON.stringify({ pid: -1, createdAtMs: 0, updatedAtMs: 0 }),
        );
        const result = await migrateLegacyProjectRuntimeState(project.selectedRoot);
        if (result.kind !== "ready") throw new Error(`Expected ready, got ${result.kind}`);
        await assertMissing(layout.primary.layoutMigrationJournalPath);
        await assertMissing(layout.primary.layoutMigrationLockPath);
    } finally {
        await project.cleanup();
    }
});

Deno.test("legacy migration resumes selected-root adoption after the registry was already renamed", async () => {
    const project = await makeMigrationProject();
    const laterSelected = await Deno.makeTempDir({ prefix: "runwield-runtime-migration-later-selected-" });
    try {
        const laterBranch = `runtime-migration-later-${crypto.randomUUID()}`;
        await git(project.primaryRoot, ["worktree", "add", "-b", laterBranch, laterSelected]);
        const laterRoot = await Deno.realPath(laterSelected);
        const layout = resolveProjectRuntimeLayout(project.selectedRoot);
        await writeText(
            layout.primary.worktreeRegistryPath,
            JSON.stringify({ version: 1, entries: [project.registryEntry] }),
        );
        await writeText(join(getRunWieldRuntimeDir(project.selectedRoot), "plan-transitions", "first.json"), "first\n");
        await writeText(join(getRunWieldRuntimeDir(laterRoot), "plan-transitions", "later.json"), "later\n");
        await writeText(
            layout.primary.layoutMigrationJournalPath,
            `${
                JSON.stringify(
                    {
                        version: 1,
                        primaryCheckoutRoot: project.primaryRoot,
                        selectedCheckoutRoots: [project.selectedRoot, laterRoot].sort(),
                        operations: [
                            {
                                action: "rename",
                                source: join(getRunWieldRuntimeDir(project.primaryRoot), "worktrees.json"),
                                destination: layout.primary.worktreeRegistryPath,
                                kind: "file",
                                completed: true,
                            },
                            {
                                action: "rename",
                                source: join(getRunWieldRuntimeDir(project.selectedRoot), "plan-transitions"),
                                destination: join(
                                    resolveProjectRuntimeLayout(project.selectedRoot).selected.internalRoot,
                                    "plan-transitions",
                                ),
                                kind: "directory",
                                completed: false,
                            },
                            {
                                action: "rename",
                                source: join(getRunWieldRuntimeDir(laterRoot), "plan-transitions"),
                                destination: join(
                                    resolveProjectRuntimeLayout(laterRoot).selected.internalRoot,
                                    "plan-transitions",
                                ),
                                kind: "directory",
                                completed: false,
                            },
                        ],
                        updatedAt: "2026-01-01T00:00:00.000Z",
                    },
                    null,
                    2,
                )
            }\n`,
        );
        const result = await migrateLegacyProjectRuntimeState(project.selectedRoot);
        if (result.kind !== "ready") throw new Error(`Expected ready, got ${JSON.stringify(result)}`);
        assertEquals(await Deno.readTextFile(join(layout.selected.transitionJournalsDir, "first.json")), "first\n");
        assertEquals(
            await Deno.readTextFile(
                join(resolveProjectRuntimeLayout(laterRoot).selected.transitionJournalsDir, "later.json"),
            ),
            "later\n",
        );
    } finally {
        await git(project.primaryRoot, ["worktree", "remove", "--force", laterSelected]).catch(() => {});
        await Deno.remove(laterSelected, { recursive: true }).catch(() => {});
        await project.cleanup();
    }
});

Deno.test("legacy migration rejects a stale lock retirement when the lock proof changed", async () => {
    const project = await makeMigrationProject();
    try {
        const layout = resolveProjectRuntimeLayout(project.selectedRoot);
        const lockPath = join(getRunWieldRuntimeDir(project.selectedRoot), "plan-locks", "demo.lock");
        await writeText(lockPath, "new stale lock\n");
        const old = new Date(0);
        await Deno.utime(lockPath, old, old);
        await writeText(
            layout.primary.layoutMigrationJournalPath,
            `${
                JSON.stringify(
                    {
                        version: 1,
                        primaryCheckoutRoot: project.primaryRoot,
                        selectedCheckoutRoots: [project.selectedRoot],
                        operations: [{
                            action: "retire",
                            source: lockPath,
                            kind: "file",
                            proof: { text: "old stale lock\n", mtime: 0, size: "old stale lock\n".length },
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
        if (result.kind !== "blocked") throw new Error(`Expected blocked, got ${result.kind}`);
        assertEquals(result.reason, "malformed_migration_evidence");
        assertEquals(await Deno.readTextFile(lockPath), "new stale lock\n");
    } finally {
        await project.cleanup();
    }
});

Deno.test("legacy migration retires stale Plan locks before moving the Plan lock directory", async () => {
    const project = await makeMigrationProject();
    try {
        const selectedBase = getRunWieldRuntimeDir(project.selectedRoot);
        const staleLock = join(selectedBase, "plan-locks", "demo.lock");
        await writeText(staleLock, JSON.stringify({ pid: -1, hostname: "stale", updatedAtMs: 0 }));
        await writeText(join(selectedBase, "plan-locks", "durable.txt"), "durable\n");
        const old = new Date(0);
        await Deno.utime(staleLock, old, old);
        const result = await migrateLegacyProjectRuntimeState(project.selectedRoot);
        if (result.kind !== "ready") throw new Error(`Expected ready, got ${result.kind}`);
        const layout = resolveProjectRuntimeLayout(project.selectedRoot);
        await assertMissing(join(layout.selected.planLocksDir, "demo.lock"));
        assertEquals(await Deno.readTextFile(join(layout.selected.planLocksDir, "durable.txt")), "durable\n");
    } finally {
        await project.cleanup();
    }
});

Deno.test("legacy migration allows an empty destination directory during adoption", async () => {
    const project = await makeMigrationProject();
    try {
        const layout = resolveProjectRuntimeLayout(project.selectedRoot);
        await writeText(join(getRunWieldRuntimeDir(project.primaryRoot), "controller", "plans", "plan.json"), "x\n");
        await Deno.mkdir(join(layout.primary.internalRoot, "controller"), { recursive: true });
        const result = await migrateLegacyProjectRuntimeState(project.selectedRoot);
        if (result.kind !== "ready") throw new Error(`Expected ready, got ${result.kind}`);
        assertEquals(await Deno.readTextFile(join(layout.primary.controllerPlansDir, "plan.json")), "x\n");
    } finally {
        await project.cleanup();
    }
});

Deno.test("legacy migration rejects hidden publication staging entries", async () => {
    const project = await makeMigrationProject();
    try {
        await writeText(join(getRunWieldRuntimeDir(project.primaryRoot), "plan-staging", ".hidden"), "x\n");
        const result = await migrateLegacyProjectRuntimeState(project.selectedRoot);
        if (result.kind !== "blocked") throw new Error(`Expected blocked, got ${result.kind}`);
        assertEquals(result.reason, "unfinished_publication");
    } finally {
        await project.cleanup();
    }
});

Deno.test("legacy migration rejects selected runtime base symlinks", async () => {
    const project = await makeMigrationProject();
    try {
        const selectedBase = getRunWieldRuntimeDir(project.selectedRoot);
        await Deno.mkdir(dirname(selectedBase), { recursive: true });
        const target = await Deno.makeTempDir({ prefix: "runwield-runtime-symlink-target-" });
        await Deno.symlink(target, selectedBase);
        const result = await migrateLegacyProjectRuntimeState(project.selectedRoot);
        if (result.kind !== "blocked") throw new Error(`Expected blocked, got ${result.kind}`);
        assertEquals(result.reason, "symlink");
        await Deno.remove(target, { recursive: true }).catch(() => {});
    } finally {
        await project.cleanup();
    }
});

Deno.test("legacy migration rejects special-file descendants", async () => {
    const project = await makeMigrationProject();
    try {
        const fifo = join(getRunWieldRuntimeDir(project.primaryRoot), "controller", "plans", "events.fifo");
        await Deno.mkdir(dirname(fifo), { recursive: true });
        const output = await new Deno.Command("mkfifo", { args: [fifo], stderr: "piped" }).output();
        if (output.code !== 0) throw new Error(new TextDecoder().decode(output.stderr));
        const result = await migrateLegacyProjectRuntimeState(project.selectedRoot);
        if (result.kind !== "blocked") throw new Error(`Expected blocked, got ${result.kind}`);
        assertEquals(result.reason, "malformed_migration_evidence");
        assert(result.paths.includes(fifo));
    } finally {
        await project.cleanup();
    }
});

Deno.test("legacy migration rejects malformed publication records during registry inspection", async () => {
    const project = await makeMigrationProject();
    try {
        await writeText(
            join(getRunWieldRuntimeDir(project.primaryRoot), "worktrees.json"),
            `${JSON.stringify({ version: 1, entries: [{ ...project.registryEntry, publication: null }] }, null, 2)}\n`,
        );
        const result = await migrateLegacyProjectRuntimeState(project.selectedRoot);
        if (result.kind !== "blocked") throw new Error(`Expected blocked, got ${result.kind}`);
        assertEquals(result.reason, "malformed_registry");
    } finally {
        await project.cleanup();
    }
});

Deno.test("legacy migration rejects malformed selected roots in a completed marker", async () => {
    const project = await makeMigrationProject();
    try {
        const layout = resolveProjectRuntimeLayout(project.selectedRoot);
        await writeText(
            layout.primary.layoutMarkerPath,
            `${
                JSON.stringify(
                    {
                        version: 1,
                        primaryCheckoutRoot: project.primaryRoot,
                        adoptedSelectedCheckoutRoots: [project.selectedRoot, project.selectedRoot],
                        completedAt: "2026-01-01T00:00:00.000Z",
                    },
                    null,
                    2,
                )
            }\n`,
        );
        const result = await migrateLegacyProjectRuntimeState(project.selectedRoot);
        if (result.kind !== "blocked") throw new Error(`Expected blocked, got ${result.kind}`);
        assertEquals(result.reason, "malformed_migration_evidence");
    } finally {
        await project.cleanup();
    }
});

Deno.test("legacy migration rejects a newer completed marker version", async () => {
    const project = await makeMigrationProject();
    try {
        const layout = resolveProjectRuntimeLayout(project.selectedRoot);
        await writeText(
            layout.primary.layoutMarkerPath,
            `${
                JSON.stringify(
                    {
                        version: 2,
                        primaryCheckoutRoot: project.primaryRoot,
                        adoptedSelectedCheckoutRoots: [project.selectedRoot],
                        completedAt: "2026-01-01T00:00:00.000Z",
                    },
                    null,
                    2,
                )
            }\n`,
        );
        const result = await migrateLegacyProjectRuntimeState(project.selectedRoot);
        if (result.kind !== "blocked") throw new Error(`Expected blocked, got ${result.kind}`);
        assertEquals(result.reason, "newer_layout");
        assertEquals(result.paths, [layout.primary.layoutMarkerPath]);
    } finally {
        await project.cleanup();
    }
});

Deno.test("legacy migration ignores completed retire receipts and rejects normalized lock path escapes", async () => {
    const project = await makeMigrationProject();
    const selectedBase = getRunWieldRuntimeDir(project.selectedRoot);
    const craftedSource = `${join(selectedBase, "plan-locks")}/../victim.lock`;
    const victim = resolve(craftedSource);
    try {
        const layout = resolveProjectRuntimeLayout(project.selectedRoot);
        await Deno.mkdir(dirname(victim), { recursive: true });
        await Deno.writeTextFile(victim, "victim\n");
        const stat = await Deno.stat(victim);
        await writeText(
            layout.primary.layoutMigrationJournalPath,
            `${
                JSON.stringify(
                    {
                        version: 1,
                        primaryCheckoutRoot: project.primaryRoot,
                        selectedCheckoutRoots: [project.selectedRoot],
                        operations: [{
                            action: "retire",
                            source: craftedSource,
                            kind: "file",
                            proof: { text: "victim\n", mtime: stat.mtime?.getTime() ?? Date.now(), size: stat.size },
                            completed: true,
                        }],
                        updatedAt: "2026-01-01T00:00:00.000Z",
                    },
                    null,
                    2,
                )
            }\n`,
        );
        const result = await migrateLegacyProjectRuntimeState(project.selectedRoot);
        if (result.kind !== "blocked") throw new Error(`Expected blocked, got ${result.kind}`);
        assertEquals(result.reason, "malformed_migration_evidence");
        assertEquals(await Deno.readTextFile(victim), "victim\n");
    } finally {
        await Deno.remove(victim).catch(() => {});
        await project.cleanup();
    }
});

Deno.test("legacy migration blocks active Work Record supersession and recovery locks", async () => {
    const supersession = await makeMigrationProject();
    let supersessionChild: Deno.ChildProcess | undefined;
    try {
        const lockPath = join(getRunWieldRuntimeDir(supersession.selectedRoot), "work-record-supersession.lock");
        supersessionChild = spawnDriver("hold-work-record-lock", supersession.selectedRoot);
        await readReadyLine(supersessionChild.stdout);
        const result = await migrateLegacyProjectRuntimeState(supersession.selectedRoot);
        if (result.kind !== "blocked") throw new Error(`Expected blocked, got ${result.kind}`);
        assertEquals(result.reason, "active_legacy_writer");
        assert(result.paths.includes(lockPath));
    } finally {
        supersessionChild?.kill("SIGKILL");
        await supersessionChild?.status.catch(() => {});
        await supersession.cleanup();
    }

    const recovery = await makeMigrationProject();
    let recoveryChild: Deno.ChildProcess | undefined;
    try {
        const lockPath = join(getRunWieldRuntimeDir(recovery.selectedRoot), "work-record-supersession-recovery.lock");
        recoveryChild = spawnDriver("hold-work-record-recovery-lock", recovery.selectedRoot);
        await readReadyLine(recoveryChild.stdout);
        const result = await migrateLegacyProjectRuntimeState(recovery.selectedRoot);
        if (result.kind !== "blocked") throw new Error(`Expected blocked, got ${result.kind}`);
        assertEquals(result.reason, "active_legacy_writer");
        assert(result.paths.includes(lockPath));
    } finally {
        recoveryChild?.kill("SIGKILL");
        await recoveryChild?.status.catch(() => {});
        await recovery.cleanup();
    }
});

Deno.test("legacy migration retires stale Work Record supersession under the recovery protocol", async () => {
    const project = await makeMigrationProject();
    try {
        const lockPath = join(getRunWieldRuntimeDir(project.selectedRoot), "work-record-supersession.lock");
        await writeText(lockPath, JSON.stringify({ token: "stale", createdAt: 0, updatedAt: 0 }));
        const old = new Date(0);
        await Deno.utime(lockPath, old, old);
        const result = await migrateLegacyProjectRuntimeState(project.selectedRoot);
        if (result.kind !== "ready") throw new Error(`Expected ready, got ${result.kind}`);
        await assertMissing(lockPath);
        await assertMissing(
            join(getRunWieldRuntimeDir(project.selectedRoot), "work-record-supersession-recovery.lock"),
        );
    } finally {
        await project.cleanup();
    }
});

Deno.test("legacy migration blocks active Plan locks held by a subprocess", async () => {
    const project = await makeMigrationProject();
    let child: Deno.ChildProcess | undefined;
    try {
        const lockPath = join(getRunWieldRuntimeDir(project.selectedRoot), "plan-locks", "demo.lock");
        child = spawnDriver("hold-plan-lock", project.selectedRoot, "demo");
        await readReadyLine(child.stdout);
        const result = await migrateLegacyProjectRuntimeState(project.selectedRoot);
        if (result.kind !== "blocked") throw new Error(`Expected blocked, got ${result.kind}`);
        assertEquals(result.reason, "active_legacy_writer");
        assert(result.paths.includes(lockPath));
    } finally {
        child?.kill("SIGKILL");
        await child?.status.catch(() => {});
        await project.cleanup();
    }
});

Deno.test("legacy migration rechecks registry after waiting for the legacy registry lock", async () => {
    const project = await makeMigrationProject();
    let lockHolder: Deno.ChildProcess | undefined;
    try {
        const registryPath = join(getRunWieldRuntimeDir(project.primaryRoot), "worktrees.json");
        await writeText(registryPath, JSON.stringify({ version: 1, entries: [project.registryEntry] }));
        lockHolder = spawnDriver("hold-registry-lock", project.primaryRoot);
        await readReadyLine(lockHolder.stdout);
        const migration = spawnDriver("migrate", project.selectedRoot);
        await new Promise((resolveTimer) => setTimeout(resolveTimer, 100));
        await Deno.writeTextFile(registryPath, "not json\n");
        lockHolder.kill("SIGKILL");
        await lockHolder.status.catch(() => {});
        lockHolder = undefined;
        const result = JSON.parse(await readChildStdout(migration)) as ProjectRuntimeMigrationResult;
        if (result.kind !== "blocked") throw new Error(`Expected blocked, got ${result.kind}`);
        assertEquals(result.reason, "malformed_registry");
    } finally {
        lockHolder?.kill("SIGKILL");
        await lockHolder?.status.catch(() => {});
        await project.cleanup();
    }
});

Deno.test("legacy migration lock serializes concurrent stale-lock recovery", async () => {
    const project = await makeMigrationProject();
    try {
        const layout = resolveProjectRuntimeLayout(project.selectedRoot);
        await writeText(join(getRunWieldRuntimeDir(project.primaryRoot), "controller", "plans", "plan.json"), "x\n");
        await writeText(
            layout.primary.layoutMigrationLockPath,
            JSON.stringify({ token: "stale", pid: -1, hostname: "", createdAtMs: 0, updatedAtMs: 0 }),
        );
        const first = spawnDriver("migrate", project.selectedRoot);
        const second = spawnDriver("migrate", project.selectedRoot);
        const firstResult = JSON.parse(await readChildStdout(first)) as ProjectRuntimeMigrationResult;
        const secondResult = JSON.parse(await readChildStdout(second)) as ProjectRuntimeMigrationResult;
        if (firstResult.kind !== "ready") throw new Error(JSON.stringify(firstResult));
        if (secondResult.kind !== "ready") throw new Error(JSON.stringify(secondResult));
        const migratedCount = [firstResult, secondResult].filter((result) => result.kind === "ready" && result.migrated)
            .length;
        assertEquals(migratedCount, 1);
        assertEquals(await Deno.readTextFile(join(layout.primary.controllerPlansDir, "plan.json")), "x\n");
    } finally {
        await project.cleanup();
    }
});

Deno.test("legacy migration resumes after a subprocess stops at each effect boundary", async () => {
    for (const effect of MIGRATION_INTERRUPTION_EFFECTS) {
        const project = await makeMigrationProject();
        try {
            await arrangeInterruptedMigrationEffect(project, effect);
            const child = spawnDriver("migrate-exit-after-effect", project.selectedRoot, effect);
            const [status, stdout, stderr] = await Promise.all([
                child.status,
                new Response(child.stdout).text(),
                new Response(child.stderr).text(),
            ]);
            if (status.code !== 86) {
                throw new Error(`Expected ${effect} driver to exit with 86, got ${status.code}: ${stdout}${stderr}`);
            }
            await assertInterruptedMigrationEffect(project, effect);
            const result = await migrateLegacyProjectRuntimeState(project.selectedRoot);
            if (result.kind !== "ready") throw new Error(`Expected ready after ${effect}: ${JSON.stringify(result)}`);
            await assertCompletedMigrationEffect(project, effect);
        } finally {
            await project.cleanup();
        }
    }
});

Deno.test("legacy migration reports EXDEV without retiring the source authority", async () => {
    const project = await makeMigrationProject();
    const originalRename = Deno.rename;
    try {
        const source = join(getRunWieldRuntimeDir(project.primaryRoot), "controller");
        await writeText(join(source, "plans", "plan.json"), "x\n");
        Object.defineProperty(Deno, "rename", {
            configurable: true,
            value: async (from: string, to: string): Promise<void> => {
                if (from === source) {
                    const error = new Error("cross-device rename");
                    Object.defineProperty(error, "code", { value: "EXDEV" });
                    throw error;
                }
                await originalRename(from, to);
            },
        });
        const result = await migrateLegacyProjectRuntimeState(project.selectedRoot);
        if (result.kind !== "blocked") throw new Error(`Expected blocked, got ${result.kind}`);
        assertEquals(result.reason, "unsupported_filesystem_move");
        assertEquals(await Deno.readTextFile(join(source, "plans", "plan.json")), "x\n");
    } finally {
        Object.defineProperty(Deno, "rename", { configurable: true, value: originalRename });
        await project.cleanup();
    }
});

type MigrationInterruptionEffect =
    | "journal-commit"
    | "primary-rename"
    | "selected-rename"
    | "stale-lock-retirement"
    | "marker-replacement"
    | "journal-cleanup";

const MIGRATION_INTERRUPTION_EFFECTS: MigrationInterruptionEffect[] = [
    "journal-commit",
    "primary-rename",
    "selected-rename",
    "stale-lock-retirement",
    "marker-replacement",
    "journal-cleanup",
];

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

async function arrangeInterruptedMigrationEffect(
    project: MigrationProject,
    effect: MigrationInterruptionEffect,
): Promise<void> {
    const primaryBase = getRunWieldRuntimeDir(project.primaryRoot);
    const selectedBase = getRunWieldRuntimeDir(project.selectedRoot);
    if (effect === "selected-rename") {
        await writeText(join(selectedBase, "plan-transitions", "selected.json"), "selected\n");
        return;
    }
    if (effect === "stale-lock-retirement") {
        const staleLock = join(selectedBase, "plan-locks", "demo.lock");
        await writeText(staleLock, JSON.stringify({ pid: -1, hostname: "stale", updatedAtMs: 0 }));
        await writeText(join(selectedBase, "plan-locks", "durable.txt"), "durable\n");
        const old = new Date(0);
        await Deno.utime(staleLock, old, old);
        return;
    }
    await writeText(join(primaryBase, "controller", "plans", "plan.json"), `${effect}\n`);
}

async function assertInterruptedMigrationEffect(
    project: MigrationProject,
    effect: MigrationInterruptionEffect,
): Promise<void> {
    const layout = resolveProjectRuntimeLayout(project.selectedRoot);
    const primaryBase = getRunWieldRuntimeDir(project.primaryRoot);
    const selectedBase = getRunWieldRuntimeDir(project.selectedRoot);
    if (effect === "journal-commit") {
        await Deno.lstat(layout.primary.layoutMigrationJournalPath);
        await assertMissing(layout.primary.layoutMarkerPath);
    } else if (effect === "primary-rename") {
        await Deno.lstat(join(layout.primary.internalRoot, "controller", "plans", "plan.json"));
        await assertMissing(join(primaryBase, "controller"));
        await assertMissing(layout.primary.layoutMarkerPath);
    } else if (effect === "selected-rename") {
        await Deno.lstat(join(layout.selected.transitionJournalsDir, "selected.json"));
        await assertMissing(join(selectedBase, "plan-transitions"));
        await assertMissing(layout.primary.layoutMarkerPath);
    } else if (effect === "stale-lock-retirement") {
        await assertMissing(join(selectedBase, "plan-locks", "demo.lock"));
        await assertMissing(layout.primary.layoutMarkerPath);
    } else if (effect === "marker-replacement") {
        await Deno.lstat(layout.primary.layoutMarkerPath);
        await Deno.lstat(layout.primary.layoutMigrationJournalPath);
    } else {
        await Deno.lstat(layout.primary.layoutMarkerPath);
        await assertMissing(layout.primary.layoutMigrationJournalPath);
    }
}

async function assertCompletedMigrationEffect(
    project: MigrationProject,
    effect: MigrationInterruptionEffect,
): Promise<void> {
    const layout = resolveProjectRuntimeLayout(project.selectedRoot);
    await Deno.lstat(layout.primary.layoutMarkerPath);
    await assertMissing(layout.primary.layoutMigrationJournalPath);
    await assertMissing(layout.primary.layoutMigrationLockPath);
    await assertMissing(join(getRunWieldRuntimeDir(project.primaryRoot), "worktrees.lock"));
    if (effect === "selected-rename") {
        assertEquals(
            await Deno.readTextFile(join(layout.selected.transitionJournalsDir, "selected.json")),
            "selected\n",
        );
        return;
    }
    if (effect === "stale-lock-retirement") {
        await assertMissing(join(layout.selected.planLocksDir, "demo.lock"));
        assertEquals(await Deno.readTextFile(join(layout.selected.planLocksDir, "durable.txt")), "durable\n");
        return;
    }
    assertEquals(await Deno.readTextFile(join(layout.primary.controllerPlansDir, "plan.json")), `${effect}\n`);
    await assertMissing(join(getRunWieldRuntimeDir(project.primaryRoot), "controller"));
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

function spawnDriver(command: string, checkoutRoot: string, extra?: string): Deno.ChildProcess {
    return new Deno.Command(Deno.execPath(), {
        cwd: REPO_ROOT,
        args: [
            "run",
            "-A",
            "src/shared/testing/project-runtime-migration-process-driver.ts",
            command,
            checkoutRoot,
            ...(extra ? [extra] : []),
        ],
        stdout: "piped",
        stderr: "piped",
    }).spawn();
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

async function readChildStdout(child: Deno.ChildProcess): Promise<string> {
    const [status, stdout, stderr] = await Promise.all([
        child.status,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
    ]);
    if (!status.success) throw new Error(`Driver failed: ${stderr}`);
    return stdout.trim();
}
