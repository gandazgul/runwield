import { assertEquals, assertMatch, assertRejects } from "@std/assert";
import { basename, dirname } from "@std/path";
import { HOME_DIR } from "../constants.js";
import { findByPlanName } from "./worktree-registry.js";
import {
    createExecutionWorktree,
    getWorktreeStatus,
    mergeExecutionWorktree,
    removeExecutionWorktree,
    resolveWorktreeParent,
} from "./worktree.js";

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
    await git(cwd, ["init"]);
    await git(cwd, ["config", "user.email", "harns@example.com"]);
    await git(cwd, ["config", "user.name", "Harns Test"]);
    await Deno.writeTextFile(`${cwd}/README.md`, "base\n");
    await git(cwd, ["add", "."]);
    await git(cwd, ["commit", "-m", "base"]);
    return cwd;
}

Deno.test("resolveWorktreeParent uses session-style full cwd encoding by default", () => {
    const projectRoot = "/Users/alice/Documents/web/harns";

    if (HOME_DIR) {
        assertEquals(
            resolveWorktreeParent(projectRoot, undefined),
            `${HOME_DIR}/.hns/worktrees/--Users-alice-Documents-web-harns--`,
        );
    } else {
        assertEquals(resolveWorktreeParent(projectRoot, undefined), `${projectRoot}/.hns/worktrees`);
    }

    assertEquals(resolveWorktreeParent(projectRoot, "/tmp/worktrees"), "/tmp/worktrees");
});

Deno.test("createExecutionWorktree creates a unique branch/path and registry entry", async () => {
    const projectRoot = await makeRepo();
    const worktreeRoot = await Deno.makeTempDir();
    let worktree;
    try {
        worktree = await createExecutionWorktree({ projectRoot, planName: "Demo Plan", worktreeRoot });
        assertMatch(worktree.branch, /^harns\/worktree\/demo-plan-[a-f0-9]{8}$/);
        assertEquals(dirname(worktree.path), worktreeRoot);
        assertMatch(basename(worktree.path), /harns-demo-plan-[a-f0-9]{8}$/);
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

Deno.test("mergeExecutionWorktree includes uncommitted worktree changes", async () => {
    const projectRoot = await makeRepo();
    const worktreeRoot = await Deno.makeTempDir();
    /** @type {Awaited<ReturnType<typeof createExecutionWorktree>> | undefined} */
    let worktree;
    try {
        worktree = await createExecutionWorktree({ projectRoot, planName: "Uncommitted Merge", worktreeRoot });
        await Deno.writeTextFile(`${worktree.path}/README.md`, "base\nchanged\n");
        await Deno.writeTextFile(`${worktree.path}/feature.txt`, "feature\n");

        await mergeExecutionWorktree({
            projectRoot,
            branch: worktree.branch,
            worktreePath: worktree.path,
            allowedDirtyPaths: [".hns/"],
        });

        assertEquals(await Deno.readTextFile(`${projectRoot}/README.md`), "base\nchanged\n");
        assertEquals(await Deno.readTextFile(`${projectRoot}/feature.txt`), "feature\n");
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

Deno.test("mergeExecutionWorktree allows unrelated dirty primary checkout changes", async () => {
    const projectRoot = await makeRepo();
    const worktreeRoot = await Deno.makeTempDir();
    /** @type {Awaited<ReturnType<typeof createExecutionWorktree>> | undefined} */
    let worktree;
    try {
        worktree = await createExecutionWorktree({ projectRoot, planName: "Unrelated Dirty Merge", worktreeRoot });
        await Deno.writeTextFile(`${worktree.path}/feature.txt`, "feature\n");
        await git(worktree.path, ["add", "."]);
        await git(worktree.path, ["commit", "-m", "feature"]);
        await Deno.writeTextFile(`${projectRoot}/ODO.md`, "scratch note\n");

        await mergeExecutionWorktree({
            projectRoot,
            branch: worktree.branch,
            worktreePath: worktree.path,
        });

        assertEquals(await Deno.readTextFile(`${projectRoot}/feature.txt`), "feature\n");
        assertEquals(await Deno.readTextFile(`${projectRoot}/ODO.md`), "scratch note\n");
        assertMatch(await git(projectRoot, ["status", "--porcelain"]), /\?\? ODO\.md/);
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

Deno.test("mergeExecutionWorktree refuses dirty primary changes that overlap branch changes", async () => {
    const projectRoot = await makeRepo();
    const worktreeRoot = await Deno.makeTempDir();
    /** @type {Awaited<ReturnType<typeof createExecutionWorktree>> | undefined} */
    let worktree;
    try {
        worktree = await createExecutionWorktree({ projectRoot, planName: "Dirty Merge", worktreeRoot });
        await Deno.writeTextFile(`${worktree.path}/README.md`, "base\nfeature\n");
        await git(worktree.path, ["add", "."]);
        await git(worktree.path, ["commit", "-m", "feature"]);
        await Deno.writeTextFile(`${projectRoot}/README.md`, "base\nprimary scratch\n");
        const branch = worktree.branch;

        await assertRejects(
            () => mergeExecutionWorktree({ projectRoot, branch }),
            Error,
            "Primary checkout has uncommitted changes that overlap execution worktree changes",
        );
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

Deno.test("mergeExecutionWorktree continues an in-progress resolved merge", async () => {
    const projectRoot = await makeRepo();
    const worktreeRoot = await Deno.makeTempDir();
    /** @type {Awaited<ReturnType<typeof createExecutionWorktree>> | undefined} */
    let worktree;
    try {
        worktree = await createExecutionWorktree({ projectRoot, planName: "Continue Merge", worktreeRoot });
        const branch = worktree.branch;
        const worktreePath = worktree.path;
        await Deno.writeTextFile(`${worktree.path}/README.md`, "base\nfeature\n");
        await git(worktree.path, ["add", "."]);
        await git(worktree.path, ["commit", "-m", "feature"]);

        await Deno.writeTextFile(`${projectRoot}/README.md`, "base\nprimary\n");
        await git(projectRoot, ["add", "."]);
        await git(projectRoot, ["commit", "-m", "primary"]);

        await assertRejects(
            () =>
                mergeExecutionWorktree({
                    projectRoot,
                    branch,
                    worktreePath,
                }),
            Error,
            "CONFLICT",
        );

        await Deno.writeTextFile(`${projectRoot}/README.md`, "base\nprimary\nfeature\n");
        await git(projectRoot, ["add", "README.md"]);

        await mergeExecutionWorktree({
            projectRoot,
            branch,
            worktreePath,
        });

        assertEquals(await Deno.readTextFile(`${projectRoot}/README.md`), "base\nprimary\nfeature\n");
        assertEquals(await git(projectRoot, ["status", "--porcelain"]), "");
        assertEquals(await git(projectRoot, ["log", "-1", "--pretty=%s"]), `Merge branch '${branch}'`);
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
