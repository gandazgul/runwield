import { createWorktreeGitArtifacts, settleWorktreeAttempt } from "./worktree.js";
/** @type {import('./workflow/plan-lifecycle.js').PlanEventDetails} */
export const TEST_DELIVERY_DETAILS = {
    executionMode: "worktree",
    deliveryEvidence: {
        version: 1,
        mode: "worktree_merge",
        executionCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        targetBranch: "main",
        targetHeadBeforeMerge: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    },
};

/**
 * @param {string} cwd
 * @param {string[]} args
 */
export async function git(cwd, args) {
    const command = new Deno.Command("git", { args, cwd, stdout: "piped", stderr: "piped" });
    const output = await command.output();
    if (!output.success) {
        throw new Error(new TextDecoder().decode(output.stderr));
    }
    return new TextDecoder().decode(output.stdout).trim();
}

export async function makeRepo() {
    const cwd = await Deno.makeTempDir();
    await git(cwd, ["init", "-b", "main"]);
    await git(cwd, ["config", "user.email", "runwield@example.com"]);
    await git(cwd, ["config", "user.name", "RunWield Test"]);
    await Deno.writeTextFile(`${cwd}/README.md`, "base\n");
    await git(cwd, ["add", "."]);
    await git(cwd, ["commit", "-m", "base"]);
    return cwd;
}

/**
 * Create a worktree attempt the way production does: Git artifacts, then the registry row.
 *
 * Replaces the quarantined `createExecutionWorktree()`, which existed only so old tests
 * could do both in one call while production had already split them. A test convenience
 * belongs in a test helper, not behind a production function that throws unless you pass
 * `allowRegistryMutation: "legacy-test-only"` — that flag was a standing invitation to
 * mutate the registry outside a lifecycle transition.
 *
 * @param {{ projectRoot: string, planName: string, planId?: string, baseRef?: string, baseBranch?: string, worktreeRoot?: string, attemptId?: string }} opts
 * @returns {Promise<import('./worktree-registry.js').WorktreeRegistryEntry>}
 */
export async function createTestWorktreeAttempt(opts) {
    const entry = await createWorktreeGitArtifacts({
        ...opts,
        planId: opts.planId || `test:${opts.planName}`,
    });
    return await settleWorktreeAttempt(opts.projectRoot, entry);
}
