import { assertEquals } from "@std/assert";
import { AGENTS } from "../../constants.js";
import {
    ACTIVE_AGENT_CUSTOM_TYPE,
    readPersistedActiveAgentName,
    readPersistedModelState,
    recordActiveAgent,
    resolveResumeAgentName,
} from "./active-agent-session.js";

/** @param {Array<Record<string, unknown>>} entries */
function makeSessionManager(entries = []) {
    return /** @type {import('@earendil-works/pi-coding-agent').SessionManager} */ (/** @type {unknown} */ ({
        getBranch: () => entries,
        /** @param {string} customType @param {unknown} data */
        appendCustomEntry: (customType, data) => {
            entries.push({ type: "custom", customType, data });
        },
    }));
}

Deno.test("recordActiveAgent stores and reads the latest active root agent", () => {
    const sessionManager = makeSessionManager();

    recordActiveAgent(sessionManager, AGENTS.ROUTER);
    recordActiveAgent(sessionManager, AGENTS.PLANNER);

    assertEquals(readPersistedActiveAgentName(sessionManager), AGENTS.PLANNER);
});

Deno.test("recordActiveAgent skips duplicate adjacent markers", () => {
    /** @type {Array<Record<string, unknown>>} */
    const entries = [];
    const sessionManager = makeSessionManager(entries);

    recordActiveAgent(sessionManager, AGENTS.PLANNER);
    recordActiveAgent(sessionManager, AGENTS.PLANNER);

    assertEquals(entries.length, 1);
    assertEquals(entries[0].customType, ACTIVE_AGENT_CUSTOM_TYPE);
});

Deno.test("readPersistedModelState returns the latest persisted model", () => {
    const sessionManager = makeSessionManager([
        { type: "model_change", provider: "first-provider", modelId: "first-model" },
        { type: "model_change", provider: "last-provider", modelId: "last-model" },
    ]);

    assertEquals(readPersistedModelState(sessionManager), {
        provider: "last-provider",
        model: "last-model",
    });
});

Deno.test("readPersistedModelState ignores malformed model entries", () => {
    const sessionManager = makeSessionManager([
        { type: "model_change", provider: "valid-provider", modelId: "valid-model" },
        { type: "model_change", provider: "broken-provider", modelId: "" },
    ]);

    assertEquals(readPersistedModelState(sessionManager), {
        provider: "valid-provider",
        model: "valid-model",
    });
});

Deno.test("resolveResumeAgentName returns persisted valid agent", async () => {
    const sessionManager = makeSessionManager([
        { type: "custom", customType: ACTIVE_AGENT_CUSTOM_TYPE, data: { agentName: AGENTS.PLANNER } },
    ]);

    assertEquals(await resolveResumeAgentName(sessionManager), AGENTS.PLANNER);
});

Deno.test("resolveResumeAgentName preserves the persistent workflow-only Slicer", async () => {
    const sessionManager = makeSessionManager([
        { type: "custom", customType: ACTIVE_AGENT_CUSTOM_TYPE, data: { agentName: AGENTS.ARCHITECT } },
        { type: "custom", customType: ACTIVE_AGENT_CUSTOM_TYPE, data: { agentName: AGENTS.SLICER } },
    ]);

    assertEquals(await resolveResumeAgentName(sessionManager), AGENTS.SLICER);
});

Deno.test("resolveResumeAgentName returns canonical filename identity instead of display casing", async () => {
    const sessionManager = makeSessionManager([
        { type: "custom", customType: ACTIVE_AGENT_CUSTOM_TYPE, data: { agentName: "Router" } },
    ]);

    assertEquals(await resolveResumeAgentName(sessionManager), AGENTS.ROUTER);
});

Deno.test("resolveResumeAgentName skips stale invalid markers and uses the latest valid agent", async () => {
    const sessionManager = makeSessionManager([
        { type: "custom", customType: ACTIVE_AGENT_CUSTOM_TYPE, data: { agentName: AGENTS.PLANNER } },
        { type: "custom", customType: ACTIVE_AGENT_CUSTOM_TYPE, data: { agentName: "not-real" } },
    ]);

    assertEquals(await resolveResumeAgentName(sessionManager), AGENTS.PLANNER);
});

Deno.test("resolveResumeAgentName falls back to router for missing or invalid markers", async () => {
    assertEquals(await resolveResumeAgentName(makeSessionManager()), AGENTS.ROUTER);
    assertEquals(
        await resolveResumeAgentName(
            makeSessionManager([
                { type: "custom", customType: ACTIVE_AGENT_CUSTOM_TYPE, data: { agentName: "not-real" } },
            ]),
        ),
        AGENTS.ROUTER,
    );
});
