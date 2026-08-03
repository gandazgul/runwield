/** Resume and publish the detached merge repaired by the prior Golden process. */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { loadPlan } from "../../../plan-store.js";
import { git } from "../../../shared/worktree-test-helpers.js";
import { getTransitionJournalDir } from "../../../shared/workflow/state-transition.ts";

interface CapturedPlanAttrs {
    status?: string;
    validationMergeRepairWorktree?: string | null;
}

interface CapturedPlan {
    name?: string;
    attrs?: CapturedPlanAttrs | null;
}

interface CapturedProjectState {
    plans?: CapturedPlan[];
}

interface CapturedInteraction {
    interaction?: { value?: string | null };
}

interface GoldenScenarioResult {
    state: Record<string, CapturedProjectState | CapturedInteraction[] | string | null>;
    events: string[];
    screenText: string;
    scrollbackText?: string;
}

function planAttrs(state: CapturedProjectState, name: string): CapturedPlanAttrs {
    return state.plans?.find((plan) => plan.name === name)?.attrs || {};
}

async function capturePublicationJournalEffect(projectRoot: string): Promise<string> {
    const directory = getTransitionJournalDir(projectRoot);
    await Deno.mkdir(directory, { recursive: true });
    const watcher = Deno.watchFs(directory);
    const timeout = setTimeout(() => watcher.close(), 60_000);
    const findEffect = async (eventPaths: string[] = []): Promise<string> => {
        const candidates = new Set(eventPaths.filter((path) => path.endsWith(".json")));
        for await (const entry of Deno.readDir(directory)) {
            if (entry.isFile && entry.name.endsWith(".json")) candidates.add(join(directory, entry.name));
        }
        for (const path of candidates) {
            const text = await Deno.readTextFile(path).catch(() => "");
            if (
                text.includes('"operation": "direct_delivery_publication"') &&
                text.includes('"effect": "direct_delivery_target_ref_moved"')
            ) {
                return text;
            }
        }
        return "";
    };
    try {
        const existing = await findEffect();
        if (existing) return existing;
        for await (const event of watcher) {
            const found = await findEffect(event.paths);
            if (found) return found;
        }
    } finally {
        clearTimeout(timeout);
        watcher.close();
    }
    return "";
}

const planName = "repaired-merge";

interface ResumedMergeState {
    repairWorktreePath: string;
    targetBranch: string;
    publicationJournalEffect: Promise<string>;
}

async function loadResumedMergeState(): Promise<ResumedMergeState> {
    const projectRoot = Deno.cwd();
    const planBeforeResume = await loadPlan(projectRoot, planName);
    assert(planBeforeResume, "Expected the prior Golden process to leave a repaired-merge Plan.");
    const repairWorktreePath = planBeforeResume.attrs.validationMergeRepairWorktree;
    const targetBranch = planBeforeResume.attrs.worktreeBaseBranch;
    assert(
        typeof repairWorktreePath === "string" && repairWorktreePath,
        "Expected the prior process to persist its detached merge repair worktree.",
    );
    assert(typeof targetBranch === "string" && targetBranch, "Expected a durable Direct Delivery target branch.");
    return { repairWorktreePath, targetBranch, publicationJournalEffect: capturePublicationJournalEffect(projectRoot) };
}

const { repairWorktreePath, targetBranch, publicationJournalEffect } = await loadResumedMergeState();

export const repairedMergePublicationScenario = {
    name: "planned-change-publishes-agent-repaired-merge-after-process-restart",
    composedTui: true,
    initialAgentName: "guide",
    terminal: { columns: 100, rows: 30 },
    timeoutMs: 90000,
    script: [],
    scriptedInteractions: [{
        type: "select",
        promptIncludes: "Plan recovery (validated_reviewer)",
        value: "validate",
    }],
    actions: [
        { type: "captureProjectState", planNames: [planName], key: "beforeResume" },
        { type: "captureProjectFileText", path: `plans/${planName}.md`, key: "beforeResumePlanText" },
        { type: "type", text: `/load-plan ${planName}` },
        { type: "enter" },
        { type: "enter" },
        { type: "waitForPlanAbsent", planName, timeoutMs: 30000 },
        { type: "waitForIdle", timeoutMs: 30000 },
        { type: "captureProjectState", planNames: [planName], key: "afterResume" },
        { type: "captureProjectFileText", path: `plans/${planName}.md`, key: "afterResumePlanText" },
    ],
    assertions: [
        async (result: GoldenScenarioResult) => {
            const journalEffect = await publicationJournalEffect;
            const beforeAttrs = planAttrs(result.state.beforeResume as CapturedProjectState, planName);
            assertEquals(beforeAttrs.status, "validated_reviewer");
            assertEquals(beforeAttrs.validationMergeRepairWorktree, repairWorktreePath);
            assertStringIncludes(String(result.state.beforeResumePlanText || ""), "validationMergeRepairWorktree:");

            assertEquals(
                await git(Deno.cwd(), ["show", `${targetBranch}:golden-repaired-merge.txt`]),
                "repaired version",
            );
            assertEquals(
                result.events.filter((event) => event === "runtime:tool:start:bash").length,
                0,
                "Expected no CI or repair shell turn in the restarted process.",
            );
            assertEquals(
                result.events.filter((event) => event === "runtime:tool:start:review_complete").length,
                0,
                "Expected no Semantic Review in the restarted process.",
            );
            const resumedTranscript = `${result.scrollbackText || ""}\n${result.screenText}`;
            assert(!resumedTranscript.includes("Running CI Validation"));
            assert(!resumedTranscript.includes("Semantic Code Review"));
            assertStringIncludes(resumedTranscript, "Merging validated worktree branch");

            const interactions = result.state.scriptedInteractions as CapturedInteraction[];
            assertEquals(interactions.map((entry) => entry.interaction?.value), ["validate"]);
            assertStringIncludes(journalEffect, '"effect": "direct_delivery_target_ref_moved"');

            const afterAttrs = planAttrs(result.state.afterResume as CapturedProjectState, planName);
            assertEquals(afterAttrs.status, undefined, "Expected verified Plan to leave active Plan storage.");
            assertEquals(afterAttrs.validationMergeRepairWorktree ?? null, null);
            assert(
                result.state.afterResumePlanText === null,
                "Expected the verified Plan to be removed from active Plan storage.",
            );
            const publishedPlan = await git(Deno.cwd(), ["show", `${targetBranch}:plans/${planName}.md`]);
            assertStringIncludes(publishedPlan, 'status: "verified"');
            assert(!publishedPlan.includes("validationMergeRepairWorktree"));
        },
    ],
};
