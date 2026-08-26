import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { savePlan } from "../../plan-store.js";
import { defineCommittedGitFixture, git } from "../../shared/git-test-fixture.ts";
import { createSessionRuntime } from "../../shared/session/session-runtime.js";
import { addEntry, findById } from "../../shared/worktree-registry.js";
import { withRuntimeCommandFixture } from "../testing/runtime-command-fixture.ts";
import { runLoadPlanCommand } from "./index.ts";
import type { EditorAPI, UiAPI } from "../../ui/tui/types.js";

const seed = defineCommittedGitFixture({ ".gitignore": ".wld/\n", "README.md": "Project\n" });
const driver = fromFileUrl(new URL("../../shared/workflow/testing/publication-process-driver.ts", import.meta.url));
type CrashBoundary = "cleanup_effect" | "cleanup_receipt";
type Invocation = "named" | "picker";

async function checkCleanupRestart(boundary: CrashBoundary, invocation: Invocation, targetChanged = false) {
    await withRuntimeCommandFixture("runwield-cleanup-command-", async () => {
        const root = await seed.checkout();
        const directory = await Deno.makeTempDir({ prefix: "runwield-cleanup-git-" });
        const tree = join(directory, "execution");
        const remote = join(directory, "remote.git");
        const runtime = createSessionRuntime();
        try {
            await savePlan(root, "demo", "# Demo\n", {
                planId: "plan-1",
                classification: "PLANNED_CHANGE",
                status: "ready_for_work",
            });
            await git(root, ["add", "docs"]);
            await git(root, ["commit", "-m", "Save Plan"]);
            const targetBefore = await git(root, ["rev-parse", "HEAD"]);
            await Deno.mkdir(remote);
            await git(remote, ["init", "--bare"]);
            await git(root, ["remote", "add", "origin", remote]);
            await git(root, ["push", "-u", "origin", "main"]);
            await git(root, ["worktree", "add", "-b", "worktree/demo", tree]);
            await Deno.writeTextFile(join(tree, "implementation.txt"), "implementation\n");
            await addEntry(root, {
                id: "attempt-1",
                planId: "plan-1",
                planName: "demo",
                baseBranch: "main",
                baseRef: "refs/heads/main",
                baseCommit: targetBefore,
                baseTree: await git(root, ["rev-parse", "HEAD^{tree}"]),
                branch: "worktree/demo",
                path: tree,
                status: "completed",
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            });
            const configPath = join(directory, "driver.json");
            await Deno.writeTextFile(
                configPath,
                JSON.stringify({
                    projectRoot: root,
                    attemptId: "attempt-1",
                    planName: "demo",
                    targetBranch: "main",
                    executionBranch: "worktree/demo",
                    executionCwd: tree,
                    crashAfter: boundary,
                }),
            );
            const crashed = await new Deno.Command(Deno.execPath(), {
                args: ["run", "-A", driver, configPath],
                stdout: "piped",
                stderr: "piped",
            }).output();
            assertEquals(crashed.code, 86, new TextDecoder().decode(crashed.stderr));
            const before = await findById(root, "attempt-1", { migrate: false });
            assert(before?.publication);
            assertEquals(
                before.publication.phase,
                boundary === "cleanup_effect" ? "publication_verified" : "cleanup_complete",
            );
            assertEquals(await Deno.stat(tree).then(() => true).catch(() => false), false);
            if (targetChanged) await git(remote, ["update-ref", "refs/heads/main", targetBefore]);
            const expectedTarget = await git(remote, ["rev-parse", "refs/heads/main"]);
            const primaryPath = join(root, "docs/plans/demo.md");
            const primaryBytes = "---\nstatus: [unfinished user edit\n---\n# Keep my primary Plan\n";
            await Deno.writeTextFile(primaryPath, primaryBytes);
            await Deno.writeTextFile(join(root, "README.md"), "Unsaved user changes\n");
            const primaryStatus = await git(root, ["status", "--porcelain", "--untracked-files=all"]);

            const sessionId = await runtime.createPromptReadySession({ cwd: root, agentName: "router" });
            const messages: string[] = [];
            const prompts: string[] = [];
            const editor: EditorAPI = {
                disableSubmit: true,
                setText: () => {},
                setAutocompleteProvider: () => {},
                handleInput: () => {},
            };
            const uiAPI: UiAPI = {
                abortActivePrompt: () => {},
                appendSystemMessage: (message) => messages.push(message),
                appendAgentMessageStart: () => ({ appendText: () => {} }),
                requestRender: () => {},
                promptSelect: (prompt) => {
                    prompts.push(prompt);
                    return Promise.resolve(null);
                },
                promptText: () => Promise.resolve(null),
                showModelSelector: () => {},
            };
            await runLoadPlanCommand(invocation === "named" ? [primaryPath] : [], {
                sessionRuntime: runtime,
                sessionId,
                uiAPI,
                editor,
            });

            assertEquals(prompts, []);
            if (targetChanged) {
                assertEquals(await findById(root, "attempt-1", { migrate: false }), before);
                assertStringIncludes(messages.join("\n"), "Cleanup stopped for demo");
                assertStringIncludes(messages.join("\n"), "no longer points to");
            } else {
                assertEquals(await findById(root, "attempt-1", { migrate: false }), null);
                assertStringIncludes(messages.join("\n"), "Cleanup is done for demo");
            }
            assertEquals(await Deno.readTextFile(primaryPath), primaryBytes);
            assertEquals(await Deno.readTextFile(join(root, "README.md")), "Unsaved user changes\n");
            assertEquals(await git(root, ["rev-parse", "HEAD"]), targetBefore);
            assertEquals(await git(root, ["status", "--porcelain", "--untracked-files=all"]), primaryStatus);
            assertEquals(await git(remote, ["rev-parse", "refs/heads/main"]), expectedTarget);
            if (invocation === "picker") assertEquals(editor.disableSubmit, false);
        } finally {
            runtime.closeAllSessions();
            await git(root, ["worktree", "remove", "--force", tree]).catch(() => {});
            await Deno.remove(root, { recursive: true });
            await Deno.remove(directory, { recursive: true });
        }
    });
}

for (const invocation of ["named", "picker"] as const) {
    for (const boundary of ["cleanup_effect", "cleanup_receipt"] as const) {
        Deno.test(`load-plan ${invocation} resumes publication after ${boundary} without reading primary`, async () => {
            await checkCleanupRestart(boundary, invocation);
        });
    }
    Deno.test(`load-plan ${invocation} preserves publication receipt when the target changed before cleanup`, async () => {
        await checkCleanupRestart("cleanup_effect", invocation, true);
    });
}
