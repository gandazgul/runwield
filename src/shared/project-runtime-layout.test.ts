import { assertEquals } from "@std/assert";
import { dirname, join } from "@std/path";
import { getRunWieldRuntimeDir, PROJECT_INTERNAL_RUNTIME_DIR_NAME, RUNWIELD_DIR_NAME } from "../constants.js";
import { defineCommittedGitFixture } from "./git-test-fixture.ts";
import { resolveProjectRuntimeLayout } from "./project-runtime-layout.ts";
import { withProcessGlobalTestLock } from "../testing/process-global-lock.js";

const fixture = defineCommittedGitFixture({ "README.md": "# Runtime layout fixture\n" });

async function git(cwd: string, args: string[]): Promise<void> {
    const output = await new Deno.Command("git", { cwd, args, stdout: "piped", stderr: "piped" }).output();
    if (output.code !== 0) {
        throw new Error(new TextDecoder().decode(output.stderr));
    }
}

Deno.test("project runtime layout resolves normal primary and selected internal roots", async () => {
    await withProcessGlobalTestLock(async () => {
        const originalSandboxHome = Deno.env.get("WLD_TEST_SANDBOX_HOME");
        const primaryCheckout = await fixture.checkout({ prefix: "runwield-runtime-layout-primary-" });
        const selectedCheckout = await Deno.makeTempDir({ prefix: "runwield-runtime-layout-selected-" });
        try {
            Deno.env.delete("WLD_TEST_SANDBOX_HOME");
            await git(primaryCheckout, ["worktree", "add", "-b", "runtime-layout-test", selectedCheckout]);

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

            assertEquals(layout.selected.checkoutRoot, selectedCheckout);
            assertEquals(layout.selected.internalRoot, selectedInternalRoot);
            assertEquals(layout.selected.planLocksDir, join(selectedInternalRoot, "plan-locks"));
            assertEquals(layout.selected.planCatalogLockPath, join(selectedInternalRoot, "plan-locks", "catalog.lock"));
            assertEquals(layout.selected.transitionJournalsDir, join(selectedInternalRoot, "plan-transitions"));
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
        await git(primaryCheckout, ["worktree", "add", "-b", "runtime-layout-sandbox-test", selectedCheckout]);

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
