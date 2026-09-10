import { join } from "@std/path";
import {
    canonicalizeStoredPlanName,
    getPlanRevisionForText,
    loadPlan,
    parsePlanFrontMatter,
} from "../../plan-store.js";
import {
    addEntry as addWorktreeRegistryEntry,
    findByPlanId as findWorktreeRegistryEntryByPlanId,
    removeEntry as removeWorktreeRegistryEntry,
    updateEntry as updateWorktreeRegistryEntry,
    type WorktreeRegistryEntry,
} from "../worktree-registry.js";
import {
    checkpointExecutionPreparation,
    createWorktreeGitArtifacts,
    prepareTargetBranchRef,
    removeWorktreeGitArtifacts,
} from "../worktree.js";
import { resolvePrimaryCheckoutRoot } from "../primary-checkout.ts";
import { ensureExecutionPlanFile } from "./execution-plan-file.js";

type LoadedPlan = NonNullable<Awaited<ReturnType<typeof loadPlan>>>;

type LoadedCanonicalPlanSource = {
    kind: "loaded";
    path: string;
    relativePath: string;
    markdown: string;
    attrs: LoadedPlan["attrs"];
};

export interface PlanningWorktreeResult {
    entry: WorktreeRegistryEntry;
    plan: LoadedPlan;
    reused: boolean;
}

async function pathExists(path: string): Promise<boolean> {
    try {
        await Deno.stat(path);
        return true;
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) return false;
        throw error;
    }
}

function targetBranchForPlan(attrs: Record<string, unknown>): string {
    const targetBranch = typeof attrs.targetBranch === "string" ? attrs.targetBranch.trim() : "";
    if (!targetBranch) throw new Error("Epic child planning requires a targetBranch.");
    return targetBranch;
}

function loadedCanonicalSource(planName: string, plan: LoadedPlan): LoadedCanonicalPlanSource {
    return {
        kind: "loaded",
        path: plan.path,
        relativePath: `docs/plans/${planName}.md`,
        markdown: plan.markdown,
        attrs: plan.attrs,
    };
}

async function runGit(cwd: string, args: string[]): Promise<string> {
    const output = await new Deno.Command("git", { cwd, args, stdout: "piped", stderr: "piped" }).output();
    const stdout = new TextDecoder().decode(output.stdout);
    const stderr = new TextDecoder().decode(output.stderr);
    if (!output.success) throw new Error(`git ${args.join(" ")} failed: ${stderr || stdout}`.trim());
    return stdout;
}

async function readTargetPlanMarkdown(projectRoot: string, planName: string, baseRef: string) {
    const relativePath = `docs/plans/${planName}.md`;
    const result = await new Deno.Command("git", {
        cwd: projectRoot,
        args: ["show", `${baseRef}:${relativePath}`],
        stdout: "piped",
        stderr: "piped",
    }).output();
    if (!result.success) return null;
    return {
        relativePath,
        markdown: new TextDecoder().decode(result.stdout),
    };
}

async function loadTargetPlan(projectRoot: string, planName: string, baseRef: string) {
    const source = await readTargetPlanMarkdown(projectRoot, planName, baseRef);
    if (!source) return null;
    const temp = await Deno.makeTempDir();
    const path = join(temp, source.relativePath);
    await Deno.mkdir(join(temp, "docs", "plans", ...planName.split("/").slice(0, -1)), { recursive: true });
    await Deno.writeTextFile(path, source.markdown);
    const plan = await loadPlan(temp, planName);
    await Deno.remove(temp, { recursive: true }).catch(() => {});
    return plan
        ? {
            ...plan,
            path: `${baseRef}:${source.relativePath}`,
            revision: await getPlanRevisionForText(source.markdown),
        }
        : null;
}

export async function findTargetBranchPlansByParent(cwd: string, targetBranch: string, parentPlanName: string) {
    const projectRoot = resolvePrimaryCheckoutRoot(cwd);
    const target = await prepareTargetBranchRef(projectRoot, targetBranch);
    const listed = await runGit(projectRoot, ["ls-tree", "-r", "--name-only", target.baseRef, "docs/plans"]);
    const parentName = canonicalizeStoredPlanName(parentPlanName).name;
    const children = [];
    for (const relativePath of listed.split(/\r?\n/).filter((line) => line.endsWith(".md"))) {
        const planName = relativePath.slice("docs/plans/".length, -".md".length);
        const source = await readTargetPlanMarkdown(projectRoot, planName, target.baseRef);
        if (!source) continue;
        const parsed = parsePlanFrontMatter(source.markdown);
        if (parsed.attrs.parentPlan !== parentName) continue;
        children.push({
            name: planName,
            path: `${target.baseRef}:${source.relativePath}`,
            attrs: parsed.attrs,
        });
    }
    return children;
}

export async function preparePlanningWorktreeForPlan(
    cwd: string,
    planName: string,
    planAttrs: Record<string, unknown>,
): Promise<PlanningWorktreeResult> {
    const projectRoot = resolvePrimaryCheckoutRoot(cwd);
    const planId = typeof planAttrs.planId === "string" ? planAttrs.planId.trim() : "";
    if (!planId) throw new Error(`Planning worktree for ${planName} requires a stable planId.`);

    const existing = await findWorktreeRegistryEntryByPlanId(projectRoot, planId);
    if (existing) {
        if (existing.planName !== planName) {
            throw new Error(
                `Planning worktree for ${planName} found a different registered Plan: ${existing.planName}.`,
            );
        }
        if (existing.status === "planning" && await pathExists(existing.path)) {
            const plan = await loadPlan(existing.path, planName);
            if (!plan) throw new Error(`Registered planning worktree is missing its Plan: ${existing.path}`);
            return { entry: existing, plan, reused: true };
        }
        if (existing.status !== "planning") {
            const plan = await loadPlan(existing.path, planName).catch(() => null);
            if (plan) return { entry: existing, plan, reused: true };
        }
    }

    const target = await prepareTargetBranchRef(projectRoot, targetBranchForPlan(planAttrs));
    const targetPlan = await loadTargetPlan(projectRoot, planName, target.baseRef);
    if (!targetPlan) throw new Error(`Plan ${planName} does not exist on target ${target.baseBranch}.`);
    if (targetPlan.attrs.planId && targetPlan.attrs.planId !== planId) {
        throw new Error(`Target Plan ${planName} has a different Plan ID. Your files were not changed.`);
    }

    const artifacts = await createWorktreeGitArtifacts({
        projectRoot,
        planName,
        planId,
        baseRef: target.baseRef,
        baseBranch: target.baseBranch,
    });
    try {
        const entry: WorktreeRegistryEntry = { ...artifacts, status: "planning" };
        await addWorktreeRegistryEntry(projectRoot, entry);
        const planFile = await ensureExecutionPlanFile({
            executionCwd: entry.path,
            planName,
            canonicalSource: loadedCanonicalSource(planName, targetPlan),
            reconcileFromCanonical: false,
            replaceFromCanonical: false,
        });
        if (!["present", "restored", "reconciled"].includes(planFile.kind)) {
            throw new Error(
                `Cannot prepare planning Plan file ${planFile.relativePath}: ${planFile.reason || planFile.kind}`,
            );
        }
        const dirty = (await runGit(entry.path, ["status", "--porcelain"])).trim();
        if (dirty) {
            const preparation = await checkpointExecutionPreparation({
                worktreePath: entry.path,
                branch: entry.branch,
                baseCommit: entry.baseCommit,
                planName,
                planRelativePath: planFile.relativePath,
                relatedPlanPaths: [],
            });
            await runGit(entry.path, ["rev-parse", preparation.preparationCommit]);
        }
        await updateWorktreeRegistryEntry(projectRoot, entry.id, { status: "planning" });
        const plan = await loadPlan(entry.path, planName);
        if (!plan) throw new Error(`Planning worktree is missing its Plan after preparation: ${entry.path}`);
        return { entry, plan, reused: false };
    } catch (error) {
        await removeWorktreeRegistryEntry(projectRoot, artifacts.id).catch(() => {});
        await removeWorktreeGitArtifacts({ projectRoot, path: artifacts.path, force: true }).catch(() => {});
        throw error;
    }
}
