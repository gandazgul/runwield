/**
 * @module shared/workflow/epic-sibling-drafts
 * Scope moves between Epic children.
 *
 * While planning one child, Planner may reshape any sibling that has not
 * started: move scope into it, out of it, or add a new draft. Those edits are
 * made in the child's worktree and travel to the Epic branch with the child.
 * This module carries them into the child's preparation commit and returns an
 * edited sibling that was already approved to `draft`, so its own Planner
 * session can reshape it again. A started or finished sibling stays as it is.
 */

import { loadPlan, parsePlanFrontMatter, updatePlanFrontMatter } from "../../plan-store.js";
import type { PlanFrontMatter } from "../../plan-store.js";
import { EPIC_ARTIFACT_FILE_NAMES } from "../epic-artifacts.ts";
import { resolvePrimaryCheckoutRoot } from "../primary-checkout.ts";
import { buildPlanEventUpdates } from "./plan-lifecycle.js";
import { listControllerDocumentWorktrees } from "./controller-registry.ts";

/** Sibling statuses Planner may still reshape. */
const RESHAPEABLE_STATUSES = new Set(["draft", "feedback", "approved", "ready_for_work"]);
/** Reshaped siblings in these statuses go back to draft: their approval covered different scope. */
const APPROVED_STATUSES = new Set(["approved", "ready_for_work"]);

interface GitResult {
    success: boolean;
    stdout: string;
}

async function runGitResult(cwd: string, args: string[]): Promise<GitResult> {
    const output = await new Deno.Command("git", { cwd, args, stdout: "piped", stderr: "piped" }).output();
    return { success: output.success, stdout: new TextDecoder().decode(output.stdout) };
}

/** Changed paths in the worktree, including untracked files, relative to its root. */
async function changedPaths(worktreePath: string): Promise<string[]> {
    const status = await runGitResult(worktreePath, ["status", "--porcelain", "-z", "--untracked-files=all"]);
    if (!status.success) return [];
    const entries = status.stdout.split("\0").filter(Boolean);
    const paths: string[] = [];
    for (let index = 0; index < entries.length; index++) {
        const entry = entries[index];
        const code = entry.slice(0, 2);
        paths.push(entry.slice(3));
        // A rename lists its source path as the next entry.
        if (code.includes("R") || code.includes("C")) index++;
    }
    return paths;
}

function bodyOf(markdown: string): string {
    return parsePlanFrontMatter(markdown).body.trim();
}

/**
 * Prepare sibling Plans that Planner edited in this child's worktree.
 *
 * Returns the sibling Plan paths to include in the preparation commit. Throws,
 * before anything is committed, when an edit touches a sibling that has started
 * or is being planned in its own worktree.
 */
export async function prepareEditedSiblingPlans(
    worktreePath: string,
    planName: string,
    planRelativePath: string,
): Promise<string[]> {
    const plan = await loadPlan(worktreePath, planName);
    const epicPlanName = typeof plan?.attrs.parentPlan === "string" ? plan.attrs.parentPlan.trim() : "";
    if (!epicPlanName) return [];
    const prefix = `docs/plans/${epicPlanName}/`;
    const siblingPaths = (await changedPaths(worktreePath)).filter((path) =>
        path.startsWith(prefix) && path.endsWith(".md") && path !== planRelativePath &&
        !path.slice(prefix.length).includes("/") && !EPIC_ARTIFACT_FILE_NAMES.includes(path.slice(prefix.length))
    );
    if (siblingPaths.length === 0) return [];

    const registered = await listControllerDocumentWorktrees(resolvePrimaryCheckoutRoot(worktreePath));
    for (const path of siblingPaths) {
        const siblingName = path.slice("docs/plans/".length, -".md".length);
        const committed = await runGitResult(worktreePath, ["show", `HEAD:${path}`]);
        const before = committed.success ? parsePlanFrontMatter(committed.stdout).attrs : null;
        // A new draft Planner split out of this child starts as a draft of its own.
        if (!before) continue;
        if (!RESHAPEABLE_STATUSES.has(String(before.status))) {
            throw new Error(
                `${siblingName} has already started (${before.status}), so its Plan stays as it is. ` +
                    `Undo the edit to ${path} and put that work in a new child instead.`,
            );
        }
        if (registered.some((entry) => entry.planName === siblingName && entry.path !== worktreePath)) {
            throw new Error(
                `${siblingName} is being planned in its own worktree. Make the change there, or undo the edit to ${path}.`,
            );
        }
        const sibling = await loadPlan(worktreePath, siblingName);
        if (!sibling || !APPROVED_STATUSES.has(String(sibling.attrs.status))) continue;
        if (bodyOf(sibling.markdown) === bodyOf(committed.stdout)) continue;
        const updates = buildPlanEventUpdates("manual_status_change", sibling.attrs.status, {
            triageMeta: sibling.attrs as Partial<PlanFrontMatter>,
            manualTargetStatus: "draft",
        });
        await updatePlanFrontMatter(worktreePath, siblingName, updates, sibling.attrs, {
            expectedRevision: sibling.revision,
        });
    }
    return siblingPaths;
}
