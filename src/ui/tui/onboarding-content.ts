import { TUTORIAL_CONTEXT_VERSION, type TutorialContext } from "../../shared/session/tutorial-context-session.ts";

export const ONBOARDING_WARNING =
    "This tutorial makes a real change in your current project and uses your configured AI model. " +
    "You will review the Plan before implementation. Normal checks and delivery approvals still apply.";

export const ONBOARDING_DISCOVERY_EXPLANATION =
    "Planner will inspect a bounded part of this project and suggest up to three small, useful changes. " +
    "Choose one or propose your own. This tutorial uses a Plan so you can review the change before implementation. " +
    "Use Ideator for open product questions, or Architect and Slicer for larger work.";

export const ONBOARDING_TUTORIAL_REQUEST = `Guide me through one small real change in this project.

First inspect a bounded area and suggest at most three useful changes with observable success criteria. Do not create a Plan or edit files yet. Wait for me to select one suggestion or provide my own.

After I choose, clarify only what is necessary, then use the ordinary Planned Change workflow. Keep the change small. Do not approve, implement, validate, or publish work on my behalf.`;

export function createInitialTutorialContext(): TutorialContext {
    return {
        version: TUTORIAL_CONTEXT_VERSION,
        guidanceEnabled: true,
        shownExplanationIds: ["choose-improvement"],
        recapShown: false,
        planId: null,
    };
}
