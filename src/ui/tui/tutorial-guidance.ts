import { join } from "@std/path";
import { AGENTS } from "../../constants.js";
import { RuntimeEventTypes } from "../../shared/session/session-runtime-events.js";
import { listWorkRecords } from "../../shared/work-records/store.js";
import { loadPlan } from "../../plan-store.js";
import { readControllerRecord } from "../../shared/workflow/controller-registry.ts";
import type { UiAPI } from "./types.js";

type SessionRuntimeEvent = import("../../shared/session/session-runtime-events.js").SessionRuntimeEvent;
type SessionSnapshot = import("../../shared/types.js").SessionSnapshot;
type SessionRuntime = ReturnType<typeof import("../../shared/session/session-runtime.js").createSessionRuntime>;
type LoadedPlan = NonNullable<Awaited<ReturnType<typeof loadPlan>>>;

type TutorialExplanation = {
    id: string;
    header: string;
    text: string;
    recap?: boolean;
    checkpoint?: boolean;
};

type VerifiedTutorialPlan = {
    plan: LoadedPlan;
};

type PresentTutorialEventOptions = {
    runtime: SessionRuntime;
    sessionId: string;
    uiAPI: UiAPI;
    event: SessionRuntimeEvent;
};

export function getTutorialExplanation(event: SessionRuntimeEvent): TutorialExplanation | null {
    if (event.type === RuntimeEventTypes.BUSY_CHANGED && event.busy === false) {
        return {
            id: "verified-recap",
            header: "Tutorial complete",
            text:
                "Your real change passed RunWield verification and delivery. The normal workflow—not the tutorial—produced this result.",
            recap: true,
        };
    }
    if (event.type === RuntimeEventTypes.SESSION_REPLACED) {
        return {
            id: "implementation",
            header: "Tutorial · Implementation",
            text:
                "The approved Plan is now running in its isolated worktree. Press Escape to request cancellation; RunWield will preserve completed work and report the settled state.",
        };
    }
    if (event.type === RuntimeEventTypes.INTERACTION_REQUESTED && event.interactionType === "plan_review") {
        return {
            id: "plan-review",
            header: "Tutorial · Review the Plan",
            text:
                "This is the real Plan Review. Add feedback to request a revision, choose Approve for Later to save it, or choose Approve & Run to start implementation.",
            checkpoint: true,
        };
    }
    if (
        event.type === RuntimeEventTypes.AGENT_CHANGED && event.rootHandoff === true &&
        [AGENTS.PLAN_ENGINEER, AGENTS.FRONTEND_ENGINEER].includes(event.agentName)
    ) {
        return {
            id: "implementation",
            header: "Tutorial · Implementation",
            text:
                "The approved Plan is now running in its isolated worktree. Press Escape to request cancellation; RunWield will preserve completed work and report the settled state.",
        };
    }
    if (event.type === RuntimeEventTypes.INTERACTION_REQUESTED && event.interactionType === "code_review") {
        return {
            id: "code-review",
            header: "Tutorial · Code Review",
            text: "Code Review is a human approval step. It is separate from the AI review in Workflow Validation.",
        };
    }
    if (event.type !== RuntimeEventTypes.SYSTEM_STATUS || !event.validationProgress) return null;

    const progress = event.validationProgress;
    if (progress.stage === "ci") {
        return {
            id: "project-checks",
            header: "Tutorial · Project checks",
            text:
                "RunWield is running this project's real checks. A failure must be repaired or reported; it is not hidden.",
        };
    }
    if (progress.stage === "semantic_review" || progress.stage === "engineer_repair") {
        const repairing = progress.stage === "engineer_repair";
        return {
            id: repairing ? "ai-repair" : "ai-review",
            header: repairing ? "Tutorial · Repair" : "Tutorial · AI review",
            text: repairing
                ? "AI review found an issue. The normal repair cycle is active, and the verified recap remains blocked."
                : "An independent AI review now checks the implementation against the approved Plan.",
        };
    }
    if (progress.stage === "merge") {
        return {
            id: "delivery",
            header: "Tutorial · Delivery",
            text: "Validation passed. RunWield is now confirming publication through the normal delivery workflow.",
        };
    }
    if (progress.stage === "terminal" && progress.outcome === "failed") {
        return {
            id: "validation-failed",
            header: "Tutorial · Validation stopped",
            text:
                "The workflow did not reach RunWield Verified. Your work remains recoverable; no successful recap will be shown.",
        };
    }
    if (progress.stage === "terminal" && progress.outcome === "verified") {
        return {
            id: "verified-recap",
            header: "Tutorial complete · RunWield Verified",
            text: "The change passed Workflow Validation and publication was confirmed.",
            recap: true,
        };
    }
    return null;
}

function associatedPlanId(snapshot: SessionSnapshot): string | null {
    const planId = snapshot.workflowContext?.planId || null;
    if (!planId) return null;
    return snapshot.planAssociations?.some((association) => association.planId === planId) ? planId : null;
}

async function readVerifiedTutorialPlan(
    snapshot: SessionSnapshot,
    planId: string,
): Promise<VerifiedTutorialPlan | null> {
    const association = snapshot.planAssociations?.find((entry) => entry.planId === planId);
    if (!association?.planName) return null;
    const plan = await loadPlan(snapshot.cwd, association.planName);
    if (
        !plan || plan.attrs.planId !== planId ||
        ["user_verified", "closed_without_verification"].includes(plan.attrs.status)
    ) return null;
    const controller = await readControllerRecord(snapshot.cwd, {
        planId,
        planName: association.planName,
    });
    if (!controller?.state.verifiedAt || !controller.state.deliveryEvidence) return null;
    return { plan };
}

async function buildRecap(
    snapshot: SessionSnapshot,
    planId: string,
    verifiedPlan: VerifiedTutorialPlan,
): Promise<string> {
    const lines: string[] = [];
    lines.push(`Plan: ${verifiedPlan.plan.path}`);
    try {
        const records = await listWorkRecords(snapshot.cwd, { createDir: false });
        const workRecord = records.find((record) => record.attrs.provenance?.sourcePlans?.includes(planId));
        if (workRecord) lines.push(`Work Record: ${workRecord.relativePath}`);
        else {
            const directory = join(snapshot.cwd, "docs", "work-records");
            for await (const entry of Deno.readDir(directory)) {
                if (!entry.isFile || !entry.name.endsWith(".md")) continue;
                const text = await Deno.readTextFile(join(directory, entry.name));
                if (text.includes(planId)) {
                    lines.push(`Work Record: docs/work-records/${entry.name}`);
                    break;
                }
            }
        }
    } catch {
        // Missing optional artifacts do not change verified workflow truth.
    }
    lines.push("Type an ordinary request to start your next RunWield task.");
    return lines.join("\n");
}

export async function presentTutorialEvent(
    { runtime, sessionId, uiAPI, event }: PresentTutorialEventOptions,
): Promise<void> {
    let snapshot = runtime.getSessionSnapshot(sessionId);
    let context = snapshot?.tutorialContext;
    if (!snapshot || !context?.guidanceEnabled) return;

    const activeAssociatedPlanId = associatedPlanId(snapshot);
    const followsExecution = [AGENTS.PLAN_ENGINEER, AGENTS.FRONTEND_ENGINEER].includes(
        snapshot.activeAgent || "",
    ) && (event.type === RuntimeEventTypes.SESSION_REPLACED || event.type === RuntimeEventTypes.AGENT_CHANGED);
    const planId = followsExecution && activeAssociatedPlanId
        ? activeAssociatedPlanId
        : context.planId || activeAssociatedPlanId;
    if ((!context.planId || followsExecution) && planId !== context.planId) {
        const associated = await runtime.updateTutorialContext(sessionId, { planId });
        if (!associated.ok) return;
        snapshot = runtime.getSessionSnapshot(sessionId);
        context = snapshot?.tutorialContext;
    }

    if (!snapshot || !context) return;
    let explanation = getTutorialExplanation(event);
    if (
        explanation?.id === "implementation" && !followsExecution && event.type === RuntimeEventTypes.SESSION_REPLACED
    ) return;
    if (
        explanation?.id === "ai-review" && context.shownExplanationIds.includes("ai-review") &&
        event.type === RuntimeEventTypes.SYSTEM_STATUS && Number(event.validationProgress?.repairAttempt || 0) > 0
    ) {
        explanation = {
            id: "ai-repair",
            header: "Tutorial · Repair",
            text: "AI review found an issue. The normal repair cycle ran before this new review.",
        };
    }
    if (
        explanation?.id === "implementation" && context.shownExplanationIds.includes("implementation") &&
        context.shownExplanationIds.includes("ai-review") && !context.shownExplanationIds.includes("delivery")
    ) {
        explanation = {
            id: "ai-repair",
            header: "Tutorial · Repair",
            text:
                "AI review found an issue. The normal repair cycle is active, and the verified recap remains blocked.",
        };
    }
    if (!explanation || context.shownExplanationIds.includes(explanation.id)) return;
    const activePlanId = associatedPlanId(snapshot);
    if (context.planId && activePlanId && activePlanId !== context.planId) return;
    if (explanation.recap && (!planId || context.recapShown)) return;

    if (explanation.recap) {
        const waitsForPublication = event.type === RuntimeEventTypes.SYSTEM_STATUS &&
            event.validationProgress?.stage === "terminal";
        const attempts = waitsForPublication ? 31 : 1;
        let verifiedPlan: VerifiedTutorialPlan | null = null;
        for (let attempt = 0; attempt < attempts; attempt += 1) {
            snapshot = runtime.getSessionSnapshot(sessionId);
            context = snapshot?.tutorialContext;
            if (!snapshot || !context?.guidanceEnabled || context.recapShown) return;
            verifiedPlan = await readVerifiedTutorialPlan(snapshot, planId || "");
            if (verifiedPlan) break;
            if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, 100));
        }
        if (!verifiedPlan) return;
        const recap = await buildRecap(snapshot, planId || "", verifiedPlan);
        uiAPI.appendSystemMessage(`${explanation.text}\n\n${recap}`, false, explanation.header);
        await runtime.updateTutorialContext(sessionId, {
            shownExplanationIds: [...context.shownExplanationIds, explanation.id],
            recapShown: true,
        });
        return;
    }

    const implementationStarted = explanation.id === "project-checks" &&
        !context.shownExplanationIds.includes("implementation");
    const repairOccurred = explanation.id === "delivery" && !context.shownExplanationIds.includes("ai-repair") &&
        snapshot.planAssociations?.some((association) =>
            association.planId === context.planId && association.purpose === "recovery"
        );
    const shownExplanationIds = [
        ...context.shownExplanationIds,
        ...(implementationStarted ? ["implementation"] : []),
        ...(repairOccurred ? ["ai-repair"] : []),
        explanation.id,
    ];
    const update = await runtime.updateTutorialContext(sessionId, { shownExplanationIds });
    if (!update.ok) return;
    if (implementationStarted) {
        uiAPI.appendSystemMessage(
            "The approved Plan is running in its isolated worktree. Press Escape to request cancellation; RunWield will preserve completed work and report the settled state.",
            false,
            "Tutorial · Implementation",
        );
    }
    if (repairOccurred) {
        uiAPI.appendSystemMessage(
            "AI review found an issue. The normal repair cycle completed before delivery.",
            false,
            "Tutorial · Repair",
        );
    }
    uiAPI.appendSystemMessage(explanation.text, false, explanation.header);

    if (explanation.checkpoint) {
        const action = await uiAPI.promptSelect("Tutorial guidance", [
            { value: "continue", label: "Continue tutorial" },
            { value: "without", label: "Continue without tutorial" },
            { value: "pause", label: "Pause tutorial" },
        ]);
        if (action === "without") {
            await runtime.updateTutorialContext(sessionId, { guidanceEnabled: false });
            uiAPI.appendSystemMessage(
                "Tutorial guidance is off. The Plan and workflow continue unchanged.",
                false,
                "Tutorial",
            );
        } else if (action === "pause") {
            const result = runtime.cancelSession(sessionId);
            uiAPI.appendSystemMessage(
                result.aborted
                    ? "Cancellation requested. RunWield will report the settled workflow state."
                    : "No active operation needed cancellation. Your saved work is unchanged.",
                false,
                "Tutorial",
            );
        }
    }
}
