/** Resume and publish the detached merge repaired by the prior Golden process. */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { loadPlan } from "../../../plan-store.js";
import { findActiveByPlanName } from "../../../shared/worktree-registry.js";

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

const planName = "repaired-merge";

interface ResumedMergeState {
    repairWorktreePath: string;
}

async function loadResumedMergeState(): Promise<ResumedMergeState> {
    const projectRoot = Deno.cwd();
    const attempt = await findActiveByPlanName(projectRoot, planName);
    const planBeforeResume = attempt?.path ? await loadPlan(attempt.path, planName) : null;
    assert(planBeforeResume, "Expected the prior Golden process to leave a repaired-merge Plan.");
    const repairWorktreePath = planBeforeResume.attrs.validationMergeRepairWorktree;
    assert(
        typeof repairWorktreePath === "string" && repairWorktreePath,
        "Expected the prior process to persist its detached merge repair worktree.",
    );
    return { repairWorktreePath };
}

const { repairWorktreePath } = await loadResumedMergeState();

export const repairedMergePublicationScenario = {
    name: "planned-change-publishes-agent-repaired-merge-after-process-restart",
    composedTui: true,
    initialAgentName: "guide",
    terminal: { columns: 100, rows: 30 },
    timeoutMs: 90000,
    script: [],
    scriptedInteractions: [{
        type: "select",
        promptIncludes: "Plan recovery (validated)",
        value: "validate",
    }],
    actions: [
        { type: "captureProjectState", planNames: [planName], key: "beforeResume" },
        { type: "captureProjectFileText", path: `docs/plans/${planName}.md`, key: "beforeResumePlanText" },
        { type: "type", text: `/load-plan ${planName}` },
        { type: "enter" },
        { type: "enter" },
        { type: "waitForRemotePlanStatus", planName, statuses: ["validated"], timeoutMs: 30000 },
        { type: "waitForWorktreeRegistryStatus", planName, statuses: ["absent"], timeoutMs: 30000 },
        { type: "waitForIdle", timeoutMs: 30000 },
        { type: "captureProjectState", planNames: [planName], key: "afterResume" },
        { type: "captureProjectFileText", path: `docs/plans/${planName}.md`, key: "afterResumePlanText" },
        { type: "capturePublicationState", planName, deliveredPath: "golden-repaired-merge.txt" },
    ],
    assertions: [
        (result: GoldenScenarioResult) => {
            const beforeAttrs = planAttrs(result.state.beforeResume as CapturedProjectState, planName);
            assertEquals(beforeAttrs.status, "validated");
            assertEquals(beforeAttrs.validationMergeRepairWorktree, repairWorktreePath);
            assert(!String(result.state.beforeResumePlanText || "").includes("validationMergeRepairWorktree:"));
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
            assert(!resumedTranscript.includes("Running the tests in"));
            assert(!resumedTranscript.includes("Code review"));
            assertStringIncludes(resumedTranscript, "Merging branch");

            const interactions = result.state.scriptedInteractions as CapturedInteraction[];
            assertEquals(interactions.map((entry) => entry.interaction?.value), ["validate"]);

            const afterAttrs = planAttrs(result.state.afterResume as CapturedProjectState, planName);
            assertEquals(afterAttrs.status, "validated_reviewer");
            assertEquals(afterAttrs.validationMergeRepairWorktree ?? null, null);
            assertStringIncludes(String(result.state.afterResumePlanText || ""), 'status: "validated_reviewer"');
            const publication = result.state.publication as {
                deliveredText?: string;
                remotePlanStatus?: string;
                registryEntries?: unknown[];
            };
            assertEquals(publication.deliveredText, "repaired version");
            assertEquals(publication.remotePlanStatus, "validated");
            assertEquals(publication.registryEntries, []);
        },
    ],
};
