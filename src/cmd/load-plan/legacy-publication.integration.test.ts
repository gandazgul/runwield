import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { getRunWieldRuntimeDir } from "../../constants.js";
import { defineCommittedGitFixture, git } from "../../shared/git-test-fixture.ts";
import { resolveProjectRuntimeLayout } from "../../shared/project-runtime-layout.ts";
import { createSessionRuntime } from "../../shared/session/session-runtime.js";
import {
    advancePublicationAttempt,
    createPublicationAttempt,
    recordPublicationFailure,
} from "../../shared/workflow/publication-attempt.ts";
import { findById } from "../../shared/worktree-registry.js";
import type { EditorAPI, UiAPI } from "../../ui/tui/types.js";
import { withRuntimeCommandFixture } from "../testing/runtime-command-fixture.ts";
import { runLoadPlanCommand } from "./index.ts";

const planPath = "docs/plans/demo.md";
const seed = defineCommittedGitFixture({
    ".gitignore": ".wld/\n",
    "README.md": "Project\n",
    [planPath]:
        "---\nplanId: plan-demo\nclassification: PLANNED_CHANGE\nstatus: ready_for_work\ntargetBranch: main\n---\n# Demo\n",
});
const driver = fromFileUrl(new URL("../../shared/workflow/testing/publication-process-driver.ts", import.meta.url));

for (const repair of [false, true]) {
    Deno.test(`load-plan adopts legacy ${repair ? "repair" : "publication"} without moving saved work`, async () => {
        await withRuntimeCommandFixture("legacy-publication-", async () => {
            const sandboxHome = Deno.env.get("WLD_TEST_SANDBOX_HOME");
            Deno.env.delete("WLD_TEST_SANDBOX_HOME");
            const root = await seed.checkout();
            const directory = await Deno.makeTempDir({ prefix: "legacy-publication-git-" });
            const tree = join(directory, "execution");
            const remote = join(directory, "remote.git");
            const runtime = createSessionRuntime();
            try {
                const targetHead = await git(root, ["rev-parse", "HEAD"]);
                await Deno.mkdir(remote);
                await git(remote, ["init", "--bare"]);
                await git(root, ["remote", "add", "origin", remote]);
                await git(root, ["push", "-u", "origin", "main"]);
                await git(root, ["worktree", "add", "-b", "worktree/demo", tree]);
                await Deno.writeTextFile(join(tree, "implementation.txt"), "Implemented before upgrade\n");
                await git(tree, ["add", "implementation.txt"]);
                await git(tree, ["commit", "-m", "Implement demo"]);
                const validatedCommit = await git(tree, ["rev-parse", "HEAD"]);
                await Deno.writeTextFile(
                    join(tree, planPath),
                    `---\nplanId: plan-demo\nclassification: PLANNED_CHANGE\nstatus: validated\ntargetBranch: main\nvalidatedCommit: ${validatedCommit}\n---\n# Demo\n`,
                );
                await git(tree, ["add", planPath]);
                await git(tree, ["commit", "-m", "Record validation"]);
                const artifactCommit = await git(tree, ["rev-parse", "HEAD"]);
                const legacyBase = getRunWieldRuntimeDir(root);
                const publicationRoot = join(legacyBase, "plan-staging", "attempt-1");
                let publication = advancePublicationAttempt(
                    createPublicationAttempt({
                        attemptId: "attempt-1",
                        planId: "plan-demo",
                        planName: "demo",
                        targetBranch: "main",
                        executionBranch: "worktree/demo",
                        executionCwd: tree,
                        publicationRoot,
                        validatedCommit,
                        targetHeadAtSeal: targetHead,
                    }),
                    "artifacts_committed",
                    { artifactCommit, planPaths: [planPath] },
                );
                if (repair) {
                    await git(root, ["clone", "--branch", "main", root, publicationRoot]);
                    await Deno.writeTextFile(join(publicationRoot, "README.md"), "Uncommitted repair\n");
                    publication = recordPublicationFailure(publication, {
                        kind: "needs_repair",
                        message: "Interrupted repair",
                        repairRoot: publicationRoot,
                    });
                }
                await Deno.mkdir(legacyBase, { recursive: true });
                const entry = {
                    id: "attempt-1",
                    planId: "plan-demo",
                    planName: "demo",
                    baseBranch: "main",
                    baseRef: "refs/heads/main",
                    baseCommit: targetHead,
                    branch: "worktree/demo",
                    path: tree,
                    status: "validated",
                    createdAt: publication.createdAt,
                    updatedAt: publication.updatedAt,
                    publication,
                };
                await Deno.writeTextFile(
                    join(legacyBase, "worktrees.json"),
                    JSON.stringify({ version: 2, entries: [entry] }),
                );
                await Deno.writeTextFile(join(root, "README.md"), "Unsaved primary changes\n");
                const statusArgs = ["status", "--porcelain", "--", ".", ":(exclude).gitignore"];
                const primaryStatus = await git(root, statusArgs);
                const messages: string[] = [];
                let menus = 0;
                const uiAPI: UiAPI = {
                    abortActivePrompt: () => {},
                    appendSystemMessage: (message) => messages.push(message),
                    appendAgentMessageStart: () => ({ appendText: () => {} }),
                    requestRender: () => {},
                    promptSelect: (_prompt, choices) => {
                        menus++;
                        assert(choices.some((choice) => choice.value === "cancel"));
                        return Promise.resolve("cancel");
                    },
                    promptText: () => Promise.resolve(null),
                    showModelSelector: () => {},
                };
                const editor: EditorAPI = {
                    disableSubmit: true,
                    setText: () => {},
                    setAutocompleteProvider: () => {},
                    handleInput: () => {},
                };
                const sessionId = await runtime.createPromptReadySession({ cwd: root, agentName: "router" });
                // These are production entry points, not direct migration calls.
                for (let load = 0; load < 2; load++) {
                    await runLoadPlanCommand([join(root, planPath)], {
                        sessionRuntime: runtime,
                        sessionId,
                        uiAPI,
                        editor,
                    });
                }
                assertEquals(menus, 2);
                assertStringIncludes(messages.join("\n"), "Plan loaded: demo");
                assertEquals((await findById(root, "attempt-1"))?.publication, publication);
                await Deno.stat(resolveProjectRuntimeLayout(root).primary.worktreeRegistryPath);
                assertEquals(
                    await Deno.stat(join(legacyBase, "worktrees.json")).then(() => true).catch(() => false),
                    false,
                );
                assertEquals(await git(root, ["rev-parse", "HEAD"]), targetHead);
                assertEquals(await git(root, statusArgs), primaryStatus);
                assertStringIncludes(await Deno.readTextFile(join(root, ".gitignore")), ".wld/internal/");
                assertEquals(await Deno.readTextFile(join(root, "README.md")), "Unsaved primary changes\n");
                if (repair) {
                    assertEquals(
                        await git(root, ["check-ignore", ".wld/plan-staging/attempt-1"]),
                        ".wld/plan-staging/attempt-1",
                    );
                    assertEquals(await Deno.readTextFile(join(publicationRoot, "README.md")), "Uncommitted repair\n");
                    assertEquals(await git(publicationRoot, ["rev-parse", "HEAD"]), targetHead);
                } else {
                    const configPath = join(directory, "resume.json");
                    await Deno.writeTextFile(
                        configPath,
                        JSON.stringify({
                            projectRoot: root,
                            attemptId: "attempt-1",
                            planName: "demo",
                            targetBranch: "main",
                            executionBranch: "worktree/demo",
                            executionCwd: tree,
                        }),
                    );
                    const resumed = await new Deno.Command(Deno.execPath(), {
                        args: ["run", "-A", driver, configPath],
                        stdout: "piped",
                        stderr: "piped",
                    }).output();
                    assertEquals(resumed.code, 0, new TextDecoder().decode(resumed.stderr));
                    await git(remote, ["merge-base", "--is-ancestor", artifactCommit, "main"]);
                    assertEquals(await findById(root, "attempt-1"), null);
                    assertEquals(await git(root, ["branch", "--list", "worktree/demo"]), "");
                    assertEquals(await git(root, ["rev-parse", "HEAD"]), targetHead);
                    assertEquals(await git(root, statusArgs), primaryStatus);
                }
            } finally {
                if (sandboxHome === undefined) Deno.env.delete("WLD_TEST_SANDBOX_HOME");
                else Deno.env.set("WLD_TEST_SANDBOX_HOME", sandboxHome);
                runtime.closeAllSessions();
                await git(root, ["worktree", "remove", "--force", tree]).catch(() => {});
                await Deno.remove(root, { recursive: true });
                await Deno.remove(directory, { recursive: true });
            }
        });
    });
}
