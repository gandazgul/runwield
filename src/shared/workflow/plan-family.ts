/** Child completion combines current definitions with already-published branch history. */
import { join } from "@std/path";
import { findPlansByParent, loadArchivedPlan, loadPlan } from "../../plan-store.js";
import { resolvePrimaryCheckoutRoot } from "../primary-checkout.ts";
import { listControllerDocumentWorktrees } from "./controller-registry.ts";

export async function findCompletionSiblings(cwd: string, parentPlan: string) {
    const primaryRoot = resolvePrimaryCheckoutRoot(cwd);
    const primary = await findPlansByParent(primaryRoot, parentPlan);
    if (primaryRoot === cwd) return primary;
    const selected = await listControllerDocumentWorktrees(primaryRoot);
    const attempt = selected.find((entry) => entry.path === cwd);
    if (!attempt) return primary;
    const siblings = new Map(primary.map((child) => [child.name, child]));
    for (const child of await findPlansByParent(cwd, parentPlan)) {
        // A live or reopened sibling already has an authoritative document in the
        // primary catalog. Never replace it with another branch's copy.
        if (selected.some((entry) => entry.planName === child.name)) continue;
        const evidence = child.attrs.deliveryEvidence;
        if (
            (child.attrs.status !== "validated" && child.attrs.status !== "verified") ||
            evidence?.mode !== "worktree_merge"
        ) continue;
        const primaryChild = await loadPlan(primaryRoot, child.name);
        if (
            primaryChild &&
            (primaryChild.attrs.planId !== child.attrs.planId ||
                primaryChild.attrs.parentPlan !== child.attrs.parentPlan)
        ) continue;
        if (await loadArchivedPlan(primaryRoot, child.name)) continue;
        // The attempt's recorded target snapshot must contain this exact completed
        // document. A status edited into the checkout is not publication evidence.
        const committed = await new Deno.Command("git", {
            cwd,
            args: ["show", `${attempt.baseCommit}:docs/plans/${child.name}.md`],
            stdout: "piped",
            stderr: "null",
        }).output();
        if (
            committed.success &&
            new TextDecoder().decode(committed.stdout) ===
                await Deno.readTextFile(join(cwd, `docs/plans/${child.name}.md`))
        ) siblings.set(child.name, child);
    }
    return [...siblings.values()];
}
