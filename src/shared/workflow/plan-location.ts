/** Locate the editable document independently from the shared controller files. */
import { canonicalizeStoredPlanName, loadPlan } from "../../plan-store.js";
import { resolvePrimaryCheckoutRoot } from "../primary-checkout.ts";
import { findActiveByPlanName } from "../worktree-registry.js";
import { listControllerDocumentWorktrees } from "./controller-registry.ts";

export async function resolveWorkflowPlanLocation(cwd: string, planName: string) {
    planName = canonicalizeStoredPlanName(planName).name;
    const registryRoot = resolvePrimaryCheckoutRoot(cwd);
    const attempt = await findActiveByPlanName(registryRoot, planName);
    if (attempt) {
        const plan = await loadPlan(attempt.path, planName);
        if (plan) {
            if (attempt.planId && plan.attrs.planId && plan.attrs.planId !== attempt.planId) {
                throw new Error("The execution directory contains a different Plan. Your files have not been changed.");
            }
            return { registryRoot, documentRoot: attempt.path, plan };
        }
        if (await loadPlan(attempt.path, `archived/${planName}`)) {
            return { registryRoot, documentRoot: attempt.path, plan: null, archived: true };
        }
        throw new Error(
            `The execution Plan is missing at ${attempt.path}/docs/plans/${planName}.md. ` +
                "Your branch and other files are unchanged. Restore that Plan file from Git history or a backup before continuing; the primary copy will not be used.",
        );
    } else {
        // Reopening retires an execution attempt, not its reviewed document. Keep
        // that document available across restarts without reviving its branch ID.
        const retired = (await listControllerDocumentWorktrees(registryRoot))
            .find((entry) => entry.planName === planName && entry.status === "abandoned");
        if (retired) {
            const plan = await loadPlan(retired.path, planName);
            if (
                plan && (!retired.planId || plan.attrs.planId === retired.planId)
            ) return { registryRoot, documentRoot: retired.path, plan };
            if (await loadPlan(retired.path, `archived/${planName}`)) {
                return { registryRoot, documentRoot: retired.path, plan: null, archived: true };
            }
            throw new Error(
                `The reopened Plan is missing or has a different identity at ${retired.path}/docs/plans/${planName}.md. ` +
                    "Your files are unchanged. Restore that Plan file before continuing; the primary copy will not be used.",
            );
        }
    }
    const plan = await loadPlan(cwd, planName);
    if (plan?.attrs.planId) {
        const registered = (await listControllerDocumentWorktrees(registryRoot))
            .find((entry) => entry.planId === plan.attrs.planId);
        if (registered && registered.planName !== planName) {
            throw new Error(
                `This Plan is now named ${registered.planName}. Load that name to continue; the older primary copy is unchanged.`,
            );
        }
    }
    return { registryRoot, documentRoot: cwd, plan };
}
