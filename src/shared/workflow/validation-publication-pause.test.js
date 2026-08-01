/**
 * Publication is where RunWield meets the user's own working copy, so it is where
 * RunWield most often needs something it cannot do itself. It must never halt there.
 *
 * These tests run real Git: a real repository, a real execution worktree, a real
 * merge. Only the user's answer to the pause is scripted, because that is the one
 * thing a test genuinely stands in for.
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";

import { loadPlan, savePlan } from "../../plan-store.js";
import { removeWorktreeGitArtifacts } from "../worktree.js";
import { createTestWorktreeAttempt, git, makeRepo } from "../worktree-test-helpers.js";
import { runValidationLoop } from "./validation.ts";
import { attachRecorder, makeUi } from "./validation-test-helpers.js";
import { HostedSession } from "../session/hosted-session.js";

const PLAN_NAME = "publication-pause";
/** @type {Record<string, any>} */
const TRIAGE = {
    classification: "QUICK_FIX",
    status: "validated_reviewer",
    humanReviewMode: "none",
    humanReviewDecision: "not_required",
};

/**
 * A Plan that has passed CI and review, in a real repository whose primary checkout
 * and execution worktree both changed the same file — the situation Git refuses to
 * merge over, and the one the user has to settle.
 *
 * @param {{ conflictingPrimaryEdit?: boolean }} [opts]
 */
async function makeConflictedPublication({ conflictingPrimaryEdit = true } = {}) {
    const projectRoot = await makeRepo();
    const worktreeRoot = await Deno.makeTempDir();
    await Deno.writeTextFile(`${projectRoot}/shared.txt`, "base\n");
    await git(projectRoot, ["add", "."]);
    await git(projectRoot, ["commit", "-m", "shared"]);
    await savePlan(
        projectRoot,
        PLAN_NAME,
        `# ${PLAN_NAME}\n\nreal publication fixture\n`,
        /** @type {any} */ ({
            ...TRIAGE,
            summary: "publication pause fixture",
            affectedPaths: [],
        }),
    );

    const worktree = await createTestWorktreeAttempt({ projectRoot, planName: PLAN_NAME, worktreeRoot });
    await Deno.writeTextFile(`${worktree.path}/shared.txt`, "from the agent\n");
    if (conflictingPrimaryEdit) await Deno.writeTextFile(`${projectRoot}/shared.txt`, "my own unsaved edit\n");

    return {
        projectRoot,
        worktree,
        cleanup: async () => {
            await removeWorktreeGitArtifacts({ projectRoot, path: worktree.path, force: true }).catch(() => {});
            await Deno.remove(projectRoot, { recursive: true }).catch(() => {});
            await Deno.remove(worktreeRoot, { recursive: true }).catch(() => {});
        },
    };
}

/**
 * @param {string} projectRoot
 * @param {{ path: string, branch: string, baseBranch?: string, id?: string }} worktree
 * @param {(prompt: string) => string} answerPause what the user picks each time RunWield asks
 */
function makeSession(projectRoot, worktree, answerPause) {
    const uiAPI = makeUi();
    /** @type {string[]} */
    const prompts = [];
    uiAPI.promptSelect = (/** @type {string} */ prompt) => {
        prompts.push(prompt);
        return Promise.resolve(answerPause(prompt));
    };
    const hostedSession = attachRecorder(
        new HostedSession({ id: "publication-pause-test", cwd: projectRoot }),
        uiAPI,
    );
    hostedSession.setActiveExecutionWorkflow({
        planName: PLAN_NAME,
        triageMeta: TRIAGE,
        executionAgent: "engineer",
        projectRoot,
        executionCwd: worktree.path,
        executionMode: "worktree",
        worktreeId: worktree.id,
        worktreeBranch: worktree.branch,
        worktreeBaseBranch: worktree.baseBranch || "main",
    });
    return { uiAPI, hostedSession, prompts };
}

/**
 * @param {string} projectRoot
 * @param {import("../session/hosted-session.js").HostedSession} hostedSession
 */
function runPublication(projectRoot, hostedSession) {
    return runValidationLoop(
        /** @type {any} */ ({
            hostedSession,
            planName: PLAN_NAME,
            planContent: `# ${PLAN_NAME}`,
            projectRoot,
            triageMeta: TRIAGE,
        }),
    );
}

Deno.test("publication pauses instead of halting when the user's own edits block the merge", async () => {
    const { projectRoot, worktree, cleanup } = await makeConflictedPublication();
    try {
        const { hostedSession, prompts, uiAPI } = makeSession(projectRoot, worktree, () => "stop");

        const result = await runPublication(projectRoot, hostedSession);

        assertEquals(prompts.length, 1, "RunWield must ask the user rather than stopping on its own");
        const asked = prompts[0];
        assertStringIncludes(asked, "shared.txt");
        assertStringIncludes(asked, "have not saved to git yet");
        assertStringIncludes(asked, "Retry");
        assert(
            !/\bvalidated_reviewer\b|\bworktree_merge_failed\b|\btransition\b/.test(asked),
            `The pause must be readable by someone who has never seen RunWield's internals: ${asked}`,
        );
        assert(
            uiAPI.messages.some((/** @type {string} */ message) => message.includes("shared.txt")),
            "The reason must be visible in the transcript, not only inside the menu",
        );
        assert(
            !uiAPI.messages.some((/** @type {string} */ message) => message.includes("Dispatching")),
            "No Agent may be sent at the user's uncommitted work; only the user decides what happens to it",
        );

        // Stop leaves the work at its closest safe point: tests passed, review
        // approved, only the merge outstanding. Nothing is thrown away, and nothing
        // is silently reported as done.
        assertEquals(result.kind, "paused");
        assertEquals((await loadPlan(projectRoot, PLAN_NAME))?.attrs.status, "validated_reviewer");
        assertEquals(await git(projectRoot, ["show", "main:shared.txt"]), "base");
        assertEquals(await Deno.readTextFile(`${projectRoot}/shared.txt`), "my own unsaved edit\n");
    } finally {
        await cleanup();
    }
});

Deno.test("Retry publishes once the user clears what was in the way", async () => {
    const { projectRoot, worktree, cleanup } = await makeConflictedPublication();
    try {
        let cleared = false;
        const { hostedSession, prompts } = makeSession(projectRoot, worktree, () => {
            // The user does what the message told them to, then picks Retry.
            if (!cleared) {
                Deno.writeTextFileSync(`${projectRoot}/shared.txt`, "base\n");
                cleared = true;
            }
            return "retry";
        });

        const result = await runPublication(projectRoot, hostedSession);

        assertEquals(prompts.length, 1);
        assertEquals(result.kind, "verified");
        assertEquals((await loadPlan(projectRoot, PLAN_NAME))?.attrs.status, "verified");
        assertEquals(await git(projectRoot, ["show", "main:shared.txt"]), "from the agent");
    } finally {
        await cleanup();
    }
});

Deno.test("a Retry that fails again offers the same way out instead of stranding the user", async () => {
    const { projectRoot, worktree, cleanup } = await makeConflictedPublication();
    try {
        // The user retries without clearing anything, twice, then gives up.
        const answers = ["retry", "retry", "stop"];
        const { hostedSession, prompts } = makeSession(projectRoot, worktree, () => answers.shift() || "stop");

        const result = await runPublication(projectRoot, hostedSession);

        assertEquals(prompts.length, 3, "every failed Retry must come back with the same two choices");
        assertEquals(prompts[0], prompts[2], "the message must stay the same while the cause is the same");
        assertEquals(result.kind, "paused");
        assertStringIncludes(result.reason || "", "Retry");
        assertEquals((await loadPlan(projectRoot, PLAN_NAME))?.attrs.status, "validated_reviewer");
    } finally {
        await cleanup();
    }
});

Deno.test("publication merges without asking when nothing needs the user", async () => {
    const { projectRoot, worktree, cleanup } = await makeConflictedPublication({ conflictingPrimaryEdit: false });
    try {
        const { hostedSession, prompts } = makeSession(projectRoot, worktree, () => "stop");

        const result = await runPublication(projectRoot, hostedSession);

        assertEquals(prompts.length, 0, "RunWield must not interrupt for something it can finish itself");
        assertEquals(result.kind, "verified");
        assertEquals((await loadPlan(projectRoot, PLAN_NAME))?.attrs.status, "verified");
        assertEquals(await git(projectRoot, ["show", "main:shared.txt"]), "from the agent");
    } finally {
        await cleanup();
    }
});
