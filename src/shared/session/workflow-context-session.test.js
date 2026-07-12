import { assertEquals } from "@std/assert";
import {
    normalizeWorkflowContext,
    normalizeWorkflowPlanName,
    readPersistedWorkflowContext,
    recordWorkflowPlanName,
    recordWorkflowTriageContext,
    WORKFLOW_CONTEXT_CUSTOM_TYPE,
} from "./workflow-context-session.js";

/** @param {Array<Record<string, unknown>>} entries */
function makeSessionManager(entries = []) {
    return /** @type {import('@earendil-works/pi-coding-agent').SessionManager} */ (/** @type {unknown} */ ({
        getBranch: () => entries,
        /** @param {string} customType @param {unknown} data */
        appendCustomEntry: (customType, data) => entries.push({ type: "custom", customType, data }),
    }));
}

Deno.test("workflow context records latest triage and suppresses duplicates", () => {
    /** @type {Array<Record<string, unknown>>} */
    const entries = [];
    const sessionManager = makeSessionManager(entries);

    recordWorkflowTriageContext(sessionManager, { routingIntent: "FEATURE", complexity: "MEDIUM" });
    recordWorkflowTriageContext(sessionManager, { routingIntent: "FEATURE", complexity: "MEDIUM" });

    assertEquals(entries.length, 1);
    assertEquals(entries[0].customType, WORKFLOW_CONTEXT_CUSTOM_TYPE);
    assertEquals(readPersistedWorkflowContext(sessionManager), { routingIntent: "FEATURE", complexity: "MEDIUM" });
});

Deno.test("workflow context merges plan name and later triage clears stale plan", () => {
    const sessionManager = makeSessionManager();

    recordWorkflowTriageContext(sessionManager, { routingIntent: "PROJECT", complexity: "HIGH" });
    recordWorkflowPlanName(sessionManager, "plans/epic/child-plan.md");
    assertEquals(readPersistedWorkflowContext(sessionManager), {
        routingIntent: "PROJECT",
        complexity: "HIGH",
        planName: "epic/child-plan",
    });

    recordWorkflowTriageContext(sessionManager, { routingIntent: "QUICK_FIX", complexity: "LOW" });
    assertEquals(readPersistedWorkflowContext(sessionManager), { routingIntent: "QUICK_FIX", complexity: "LOW" });
});

Deno.test("workflow context permits plan-only context", () => {
    const sessionManager = makeSessionManager();

    recordWorkflowPlanName(sessionManager, "standalone-plan.md");

    assertEquals(readPersistedWorkflowContext(sessionManager), { planName: "standalone-plan" });
});

Deno.test("workflow context skips malformed latest markers and tolerates missing session manager", () => {
    const sessionManager = makeSessionManager([
        {
            type: "custom",
            customType: WORKFLOW_CONTEXT_CUSTOM_TYPE,
            data: { routingIntent: "FEATURE", complexity: "LOW" },
        },
        {
            type: "custom",
            customType: WORKFLOW_CONTEXT_CUSTOM_TYPE,
            data: { routingIntent: "NOPE", complexity: "LOW" },
        },
    ]);

    assertEquals(readPersistedWorkflowContext(sessionManager), { routingIntent: "FEATURE", complexity: "LOW" });
    assertEquals(recordWorkflowPlanName(null, "p"), { planName: "p" });
});

Deno.test("workflow context reads are fail-open when session entry access throws", () => {
    const sessionManager =
        /** @type {import('@earendil-works/pi-coding-agent').SessionManager} */ (/** @type {unknown} */ ({
            getBranch: () => {
                throw new Error("read failed");
            },
        }));

    assertEquals(readPersistedWorkflowContext(sessionManager), null);
    assertEquals(recordWorkflowPlanName(sessionManager, "p"), { planName: "p" });
});

Deno.test("workflow context normalization accepts canonical intents and sanitized plan names", () => {
    assertEquals(normalizeWorkflowPlanName(" plans/example.md "), "example");
    assertEquals(normalizeWorkflowContext({ routingIntent: "operation", complexity: "low" }), {
        routingIntent: "OPERATION",
        complexity: "LOW",
    });
    assertEquals(normalizeWorkflowContext({ routingIntent: "FEATURE", complexity: "bad", planName: "p.md" }), {
        planName: "p",
    });
});
