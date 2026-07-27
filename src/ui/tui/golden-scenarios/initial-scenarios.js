/**
 * @module ui/tui/golden-scenarios/initial-scenarios
 * Initial Golden TUI scenario definitions.
 */

import { assertEventIncludes, assertScreenIncludes } from "../testing/scenario-runner.js";

/** @typedef {import('../testing/scenario-runner.js').GoldenScenarioResult} GoldenScenarioResult */

/** @param {GoldenScenarioResult} result */
function assertRouterTriage(result) {
    assertEventIncludes(result, "model:router:triage");
}

/** @param {GoldenScenarioResult} result */
function assertGuideInquiry(result) {
    assertEventIncludes(result, "model:guide:inquiry");
}

/** @param {GoldenScenarioResult} result */
function assertInquiryVisible(result) {
    assertScreenIncludes(result, "INQUIRY");
}

/** @param {GoldenScenarioResult} result */
function assertGuideAnswerVisible(result) {
    assertScreenIncludes(result, "Guide answer");
}

/** @param {GoldenScenarioResult} result */
function assertCancellationEvent(result) {
    assertEventIncludes(result, "cancellation");
}

/** @param {GoldenScenarioResult} result */
function assertEditorReadyVisible(result) {
    assertScreenIncludes(result, "Editor ready");
}

/** @param {GoldenScenarioResult} result */
function assertHelpSlashEvent(result) {
    assertEventIncludes(result, "slash:help");
}

/** @param {GoldenScenarioResult} result */
function assertHelpSlashVisible(result) {
    assertScreenIncludes(result, "/help");
}

/** @param {GoldenScenarioResult} result */
function assertKeyboardHelpVisible(result) {
    assertScreenIncludes(result, "Keyboard help");
}

/** @param {GoldenScenarioResult} result */
function assertReviewFeedbackEvent(result) {
    assertEventIncludes(result, "interaction:PLAN_REVIEW:feedback");
}

/** @param {GoldenScenarioResult} result */
function assertReviewApprovedEvent(result) {
    assertEventIncludes(result, "interaction:PLAN_REVIEW:approved");
}

/** @param {GoldenScenarioResult} result */
function assertReviewFeedbackVisible(result) {
    assertScreenIncludes(result, "review_feedback");
}

/** @param {GoldenScenarioResult} result */
function assertReviewApprovedVisible(result) {
    assertScreenIncludes(result, "review_approved");
}

export const routerToGuideInquiryScenario = {
    name: "router-to-guide-inquiry",
    terminal: { columns: 100, rows: 30 },
    script: [
        {
            id: "router-triage",
            agent: "router",
            phase: "triage",
            requiredTools: ["triage_report"],
            response: "Triage Report: INQUIRY → Guide",
        },
        {
            id: "guide-answer",
            agent: "guide",
            phase: "inquiry",
            requiredTools: ["grep"],
            response: "Guide answer: RunWield routes the inquiry without mutating the Project.",
        },
    ],
    actions: [
        { type: "screen", text: "User: how does routing work?" },
        { type: "modelTurn", agent: "router", phase: "triage", availableTools: ["triage_report"] },
        { type: "modelTurn", agent: "guide", phase: "inquiry", availableTools: ["grep", "read"] },
    ],
    assertions: [
        assertRouterTriage,
        assertGuideInquiry,
        assertInquiryVisible,
        assertGuideAnswerVisible,
    ],
};

export const escapeCancellationScenario = {
    name: "escape-cancellation-restores-editor",
    actions: [
        { type: "screen", text: "Router is thinking" },
        { type: "cancel" },
        { type: "screen", text: "Editor ready" },
    ],
    assertions: [assertCancellationEvent, assertEditorReadyVisible],
};

export const helpSlashCommandScenario = {
    name: "help-slash-command",
    actions: [
        { type: "slash", command: "help" },
        { type: "screen", text: "Keyboard help" },
    ],
    assertions: [assertHelpSlashEvent, assertHelpSlashVisible, assertKeyboardHelpVisible],
};

export const planReviewTransactionContractScenario = {
    name: "plan-review-transaction-contract",
    actions: [
        { type: "interaction", interactionType: "PLAN_REVIEW", decision: "feedback" },
        { type: "screen", text: "review_feedback persisted" },
        { type: "interaction", interactionType: "PLAN_REVIEW", decision: "approved" },
        { type: "screen", text: "review_approved persisted" },
    ],
    assertions: [
        assertReviewFeedbackEvent,
        assertReviewApprovedEvent,
        assertReviewFeedbackVisible,
        assertReviewApprovedVisible,
    ],
};

export const initialGoldenScenarios = [
    routerToGuideInquiryScenario,
    escapeCancellationScenario,
    helpSlashCommandScenario,
    planReviewTransactionContractScenario,
];
