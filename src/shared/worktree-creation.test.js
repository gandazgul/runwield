// deno-lint-ignore-file no-unused-vars
import { assertEquals, assertMatch, assertRejects, assertStringIncludes } from "@std/assert";
import { basename, dirname } from "@std/path";
import { HOME_DIR } from "../constants.js";
import { loadPlan, savePlan } from "../plan-store.js";
import { GitRepositoryRequiredError } from "./git.js";
import { stageValidationPassedInExecutionWorktree } from "./workflow/plan-lifecycle.js";
import { findByPlanName } from "./worktree-registry.js";
import {
    checkpointExecutionWorktree,
    createExecutionWorktree,
    findReusableWorktree,
    getWorktreeStatus,
    inspectExecutionWorktreeMergeRisk,
    mergeExecutionWorktree,
    preparePrimaryPlanPathForMerge,
    prepareTargetBranchRef,
    removeExecutionWorktree,
    resolveCurrentCheckoutBranch,
    resolveWorktreeParent,
    restorePrimaryPlanPathAfterMergeFailure,
    sealExecutionWorktreeCandidate,
} from "./worktree.js";

/** @type {import('./workflow/plan-lifecycle.js').PlanEventDetails} */
const TEST_DELIVERY_DETAILS = {
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
async function git(cwd, args) {
    const command = new Deno.Command("git", { args, cwd, stdout: "piped", stderr: "piped" });
    const output = await command.output();
    if (!output.success) {
        throw new Error(new TextDecoder().decode(output.stderr));
    }
    return new TextDecoder().decode(output.stdout).trim();
}

async function makeRepo() {
    const cwd = await Deno.makeTempDir();
    await git(cwd, ["init", "-b", "main"]);
    await git(cwd, ["config", "user.email", "runwield@example.com"]);
    await git(cwd, ["config", "user.name", "RunWield Test"]);
    await Deno.writeTextFile(`${cwd}/README.md`, "base\n");
    await git(cwd, ["add", "."]);
    await git(cwd, ["commit", "-m", "base"]);
    return cwd;
}

Deno.test("resolveWorktreeParent uses session-style full cwd encoding by default", () => {
    const projectRoot = "/Users/alice/Documents/web/runwield";

    if (HOME_DIR) {
        assertEquals(
            resolveWorktreeParent(projectRoot, undefined),
            `${HOME_DIR}/.wld/worktrees/--Users-alice-Documents-web-runwield--`,
        );
    } else {
        assertEquals(resolveWorktreeParent(projectRoot, undefined), `${projectRoot}/.wld/worktrees`);
    }

    assertEquals(resolveWorktreeParent(projectRoot, "/tmp/worktrees"), "/tmp/worktrees");
});

Deno.test("resolveCurrentCheckoutBranch returns the primary checkout branch", async () => {
    const projectRoot = await makeRepo();
    try {
        assertEquals(await resolveCurrentCheckoutBranch(projectRoot), "main");
    } finally {
        await Deno.remove(projectRoot, { recursive: true });
    }
});

Deno.test("createExecutionWorktree creates a unique branch/path and registry entry", async () => {
    const projectRoot = await makeRepo();
    const worktreeRoot = await Deno.makeTempDir();
    let worktree;
    try {
        worktree = await createExecutionWorktree({ projectRoot, planName: "Demo Plan", worktreeRoot });
        assertMatch(worktree.branch, /^runwield\/worktree\/demo-plan-[a-f0-9]{8}$/);
        assertEquals(dirname(worktree.path), worktreeRoot);
        assertMatch(basename(worktree.path), /runwield-demo-plan-[a-f0-9]{8}$/);
        assertEquals(await git(worktree.path, ["branch", "--show-current"]), worktree.branch);
        const registryEntry = await findByPlanName(projectRoot, "Demo Plan");
        assertEquals(registryEntry?.id, worktree.id);
        assertEquals(registryEntry?.baseTree, await git(projectRoot, ["rev-parse", "HEAD^{tree}"]));

        const status = await getWorktreeStatus({ projectRoot, path: worktree.path, branch: worktree.branch });
        assertEquals(status.exists, true);
        assertEquals(status.clean, true);
    } finally {
        if (worktree) {
            await removeExecutionWorktree({
                projectRoot,
                path: worktree.path,
                branch: worktree.branch,
                force: true,
            });
        }
        await Deno.remove(projectRoot, { recursive: true });
        await Deno.remove(worktreeRoot, { recursive: true }).catch(() => {});
    }
});

Deno.test("createExecutionWorktree initializes submodules", async () => {
    const projectRoot = await makeRepo();
    const submoduleRoot = await makeRepo();
    const worktreeRoot = await Deno.makeTempDir();
    const previousAllowedProtocols = Deno.env.get("GIT_ALLOW_PROTOCOL");
    /** @type {Awaited<ReturnType<typeof createExecutionWorktree>> | undefined} */
    let worktree;
    try {
        await Deno.writeTextFile(`${submoduleRoot}/module.css`, "body { color: red; }\n");
        await git(submoduleRoot, ["add", "."]);
        await git(submoduleRoot, ["commit", "-m", "add module css"]);
        Deno.env.set("GIT_ALLOW_PROTOCOL", "file");
        await git(projectRoot, ["submodule", "add", submoduleRoot, "third_party/demo"]);
        await git(projectRoot, ["commit", "-m", "add submodule"]);

        worktree = await createExecutionWorktree({ projectRoot, planName: "Submodule Plan", worktreeRoot });

        assertEquals(await Deno.readTextFile(`${worktree.path}/third_party/demo/module.css`), "body { color: red; }\n");
        await removeExecutionWorktree({
            projectRoot,
            path: worktree.path,
            branch: worktree.branch,
            force: false,
        });
        await assertRejects(() => Deno.stat(worktree?.path || ""), Deno.errors.NotFound);
        worktree = undefined;
    } finally {
        if (previousAllowedProtocols === undefined) {
            Deno.env.delete("GIT_ALLOW_PROTOCOL");
        } else {
            Deno.env.set("GIT_ALLOW_PROTOCOL", previousAllowedProtocols);
        }
        if (worktree) {
            await removeExecutionWorktree({
                projectRoot,
                path: worktree.path,
                branch: worktree.branch,
                force: true,
            }).catch(() => {});
        }
        await Deno.remove(projectRoot, { recursive: true });
        await Deno.remove(submoduleRoot, { recursive: true });
        await Deno.remove(worktreeRoot, { recursive: true }).catch(() => {});
    }
});

Deno.test("findReusableWorktree selects the recorded execution id when plan names repeat", async () => {
    const projectRoot = await makeRepo();
    const worktreeRoot = await Deno.realPath(await Deno.makeTempDir());
    /** @type {Awaited<ReturnType<typeof createExecutionWorktree>>[]} */
    const worktrees = [];
    try {
        worktrees.push(await createExecutionWorktree({ projectRoot, planName: "Repeated Plan", worktreeRoot }));
        worktrees.push(await createExecutionWorktree({ projectRoot, planName: "Repeated Plan", worktreeRoot }));

        const reusable = await findReusableWorktree({
            projectRoot,
            planName: "Repeated Plan",
            worktreeId: worktrees[1].id,
        });

        assertEquals(reusable?.id, worktrees[1].id);
    } finally {
        for (const worktree of worktrees.toReversed()) {
            await removeExecutionWorktree({
                projectRoot,
                path: worktree.path,
                branch: worktree.branch,
                force: true,
            }).catch(() => {});
        }
        await Deno.remove(projectRoot, { recursive: true });
        await Deno.remove(worktreeRoot, { recursive: true }).catch(() => {});
    }
});

Deno.test("prepareTargetBranchRef returns an existing local branch", async () => {
    const projectRoot = await makeRepo();
    try {
        await git(projectRoot, ["checkout", "-b", "feature-base"]);
        await git(projectRoot, ["checkout", "main"]);

        const prepared = await prepareTargetBranchRef(projectRoot, " feature-base ");

        assertEquals(prepared, { baseRef: "refs/heads/feature-base", baseBranch: "feature-base" });
        assertEquals(await git(projectRoot, ["branch", "--show-current"]), "main");
    } finally {
        await Deno.remove(projectRoot, { recursive: true });
    }
});

Deno.test("prepareTargetBranchRef creates a local tracking branch for a remote-only target", async () => {
    const remoteRoot = await makeRepo();
    const projectRoot = await Deno.makeTempDir();
    try {
        await git(remoteRoot, ["checkout", "-b", "feature-base"]);
        await Deno.writeTextFile(`${remoteRoot}/remote.txt`, "remote\n");
        await git(remoteRoot, ["add", "."]);
        await git(remoteRoot, ["commit", "-m", "remote branch"]);
        await git(remoteRoot, ["checkout", "main"]);
        await git(projectRoot, ["clone", remoteRoot, "."]);
        await git(projectRoot, ["checkout", "main"]);
        await git(projectRoot, ["branch", "-D", "feature-base"]).catch(() => Promise.resolve());

        const prepared = await prepareTargetBranchRef(projectRoot, "feature-base");

        assertEquals(prepared, { baseRef: "refs/heads/feature-base", baseBranch: "feature-base" });
        assertEquals(
            await git(projectRoot, ["rev-parse", "--abbrev-ref", "feature-base@{upstream}"]),
            "origin/feature-base",
        );
        assertEquals(await git(projectRoot, ["show", "feature-base:remote.txt"]), "remote");
    } finally {
        await Deno.remove(remoteRoot, { recursive: true });
        await Deno.remove(projectRoot, { recursive: true });
    }
});

Deno.test("prepareTargetBranchRef accepts explicit origin branch input", async () => {
    const remoteRoot = await makeRepo();
    const projectRoot = await Deno.makeTempDir();
    try {
        await git(remoteRoot, ["checkout", "-b", "feature-explicit"]);
        await Deno.writeTextFile(`${remoteRoot}/explicit.txt`, "remote\n");
        await git(remoteRoot, ["add", "."]);
        await git(remoteRoot, ["commit", "-m", "explicit remote branch"]);
        await git(remoteRoot, ["checkout", "main"]);
        await git(projectRoot, ["clone", remoteRoot, "."]);
        await git(projectRoot, ["checkout", "main"]);

        const prepared = await prepareTargetBranchRef(projectRoot, "origin/feature-explicit");

        assertEquals(prepared, { baseRef: "refs/heads/feature-explicit", baseBranch: "feature-explicit" });
        assertEquals(await git(projectRoot, ["show", "feature-explicit:explicit.txt"]), "remote");
    } finally {
        await Deno.remove(remoteRoot, { recursive: true });
        await Deno.remove(projectRoot, { recursive: true });
    }
});

Deno.test("prepareTargetBranchRef creates a new target branch from main", async () => {
    const projectRoot = await makeRepo();
    try {
        const mainCommit = await git(projectRoot, ["rev-parse", "refs/heads/main"]);

        const prepared = await prepareTargetBranchRef(projectRoot, "new-target");

        assertEquals(prepared, { baseRef: "refs/heads/new-target", baseBranch: "new-target" });
        assertEquals(await git(projectRoot, ["rev-parse", "refs/heads/new-target"]), mainCommit);
    } finally {
        await Deno.remove(projectRoot, { recursive: true });
    }
});

Deno.test("prepareTargetBranchRef rejects invalid and reserved branch names", async () => {
    const projectRoot = await makeRepo();
    try {
        await assertRejects(() => prepareTargetBranchRef(projectRoot, "HEAD"), Error, "not HEAD");
        await assertRejects(
            () => prepareTargetBranchRef(projectRoot, "refs/heads/main"),
            Error,
            "must not be a full ref",
        );
        await assertRejects(
            () => prepareTargetBranchRef(projectRoot, "runwield/worktree/demo"),
            Error,
            "reserved execution prefix",
        );
        await assertRejects(() => prepareTargetBranchRef(projectRoot, "bad branch"), Error, "Invalid target branch");
    } finally {
        await Deno.remove(projectRoot, { recursive: true });
    }
});

Deno.test("createExecutionWorktree records supplied target branch independent of current checkout", async () => {
    const projectRoot = await makeRepo();
    const worktreeRoot = await Deno.makeTempDir();
    let worktree;
    try {
        await git(projectRoot, ["checkout", "-b", "feature-base"]);
        await Deno.writeTextFile(`${projectRoot}/feature.txt`, "feature-base\n");
        await git(projectRoot, ["add", "."]);
        await git(projectRoot, ["commit", "-m", "feature base"]);
        await git(projectRoot, ["checkout", "main"]);

        worktree = await createExecutionWorktree({
            projectRoot,
            planName: "Targeted Plan",
            baseRef: "refs/heads/feature-base",
            baseBranch: "feature-base",
            worktreeRoot,
        });

        assertEquals(worktree.baseBranch, "feature-base");
        assertEquals(worktree.baseRef, "refs/heads/feature-base");
        assertEquals(await Deno.readTextFile(`${worktree.path}/feature.txt`), "feature-base\n");
    } finally {
        if (worktree) {
            await removeExecutionWorktree({
                projectRoot,
                path: worktree.path,
                branch: worktree.branch,
                force: true,
            });
        }
        await Deno.remove(projectRoot, { recursive: true });
        await Deno.remove(worktreeRoot, { recursive: true }).catch(() => {});
    }
});
