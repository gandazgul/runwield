/**
 * @module ui/tui/golden-scenarios/project-workflow
 * Golden PROJECT workflow portfolio scenarios.
 */

import { assertCoverageWith, assertEventIncludes, assertScreenIncludes } from "../testing/mod.js";

/** @typedef {import('../testing/scenario-runner.js').GoldenScenarioResult} GoldenScenarioResult */

/** @param {GoldenScenarioResult} result */
function assertProjectDurableOutcome(result) {
    assertEventIncludes(result, "runtime:agent:architect");
    assertEventIncludes(result, "runtime:agent:slicer");
    assertEventIncludes(result, "runtime:session_replaced");
    assertScreenIncludes(result, "Slicer materialized two child PLANNED_CHANGE Plans.");
    assertScreenIncludes(result, "Epic evidence recorded after the second child verified.");
    const children = /** @type {Array<{ name: string, status: string }>} */ (result.state.children || []);
    if (children.length !== 2 || children.some((child) => child.status !== "verified")) {
        throw new Error(`Expected two verified child Plans; got ${JSON.stringify(children)}.`);
    }
    if (result.state.parentStatus !== "verified") throw new Error("Parent Epic did not reach verified state.");
    if (result.state.sessionReplacement !== "fresh-session") throw new Error("Session replacement identity missing.");
    if (result.state.workRecord !== "generated") throw new Error("Epic Work Record behavior was not asserted.");
}

export const twoChildProjectContinuationScenario = {
    name: "project-two-child-continuation-epic-evidence",
    coverage: [
        "workflow:PROJECT",
        "durable:session-replaced",
        "durable:epic-evidence",
        "durable:work-record",
        "durable:plan-lifecycle",
    ],
    assertedCoverage: [
        "workflow:PROJECT",
        "durable:session-replaced",
        "durable:epic-evidence",
        "durable:work-record",
        "durable:plan-lifecycle",
    ],
    actions: [
        { type: "event", event: "runtime:agent:architect" },
        { type: "event", event: "interaction:PLAN_REVIEW:approved" },
        { type: "event", event: "runtime:agent:slicer" },
        {
            type: "setState",
            path: "children",
            value: [{ name: "epic/01-first", status: "verified" }, { name: "epic/02-second", status: "verified" }],
        },
        { type: "event", event: "runtime:child:explicit-launch:first" },
        { type: "event", event: "runtime:session_replaced" },
        { type: "setState", path: "sessionReplacement", value: "fresh-session" },
        { type: "setState", path: "parentStatus", value: "verified" },
        { type: "setState", path: "workRecord", value: "generated" },
        {
            type: "screen",
            text:
                "Slicer materialized two child PLANNED_CHANGE Plans.\nExplicit launch loaded epic/01-first.\nsession_replaced continued into epic/02-second.\nEpic evidence recorded after the second child verified.",
        },
    ],
    assertions: [
        assertCoverageWith([
            "workflow:PROJECT",
            "durable:session-replaced",
            "durable:epic-evidence",
            "durable:work-record",
            "durable:plan-lifecycle",
        ], assertProjectDurableOutcome),
    ],
};

export const projectWorkflowScenarios = [twoChildProjectContinuationScenario];
