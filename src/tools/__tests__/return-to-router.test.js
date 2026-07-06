import { assertEquals, assertMatch } from "@std/assert";
import { executeReturnToRouter, returnToRouterTool } from "../return-to-router.js";
import { HostedSession } from "../../shared/session/hosted-session.js";
import { getAgentDisplayName, loadAgentDef } from "../../shared/session/agents.js";
import { AGENTS } from "../../constants.js";

/**
 * @param {string} id
 */
function makeHostedSession(id = "return-router-session") {
    return new HostedSession({ id, cwd: Deno.cwd() });
}

/**
 * @param {{ execute: unknown }} tool
 * @param {{ reason: string }} params
 * @param {object} [context]
 */
async function executeTool(tool, params, context = {}) {
    const execute =
        /** @type {(id: string, params: { reason: string }, signal: AbortSignal, onUpdate: () => void, context: object) => Promise<{ content: Array<{ type: string, text?: string }>, details: unknown, terminate?: boolean }>} */ (tool
            .execute);
    return await execute("tool-call-1", params, new AbortController().signal, () => {}, context);
}

function makeMockUiAPI() {
    let systemMessageCount = 0;
    const uiAPI = /** @type {import('../../shared/ui/types.js').UiAPI} */ ({
        appendSystemMessage: () => {
            systemMessageCount += 1;
        },
        requestRender: () => {},
        appendAgentMessageStart: () => ({ appendText: () => {} }),
        promptSelect: () => Promise.resolve(null),
        promptText: () => Promise.resolve(null),
        showModelSelector: () => {},
    });
    return { uiAPI, getSystemMessageCount: () => systemMessageCount };
}

Deno.test("returnToRouterTool exposes expected metadata", () => {
    assertEquals(returnToRouterTool.name, "return_to_router");
    assertEquals(returnToRouterTool.label, `Return to ${getAgentDisplayName(AGENTS.ROUTER)}`);
    assertMatch(
        returnToRouterTool.description,
        new RegExp(`return the conversation to ${getAgentDisplayName(AGENTS.ROUTER)}`, "i"),
    );
    assertEquals(typeof returnToRouterTool.execute, "function");
    assertEquals(typeof returnToRouterTool.parameters, "object");
});

Deno.test("returnToRouterTool returns error when no HostedSession context is active", async () => {
    const result = await executeTool(returnToRouterTool, {
        reason: "The user wants you to triage a larger change.",
    });

    assertMatch(
        /** @type {{ type: "text", text: string }} */ (result.content[0]).text,
        /requires an active UI session/i,
    );
});

Deno.test("returnToRouterTool terminates the calling turn and records a Router handoff on HostedSession", async () => {
    const { uiAPI, getSystemMessageCount } = makeMockUiAPI();
    const hostedSession = makeHostedSession();
    hostedSession.setRootAgentName(AGENTS.PLANNER);

    const reason = "The user wants you to review the architecture of the auth module.";
    const result = await executeReturnToRouter({ reason }, uiAPI, hostedSession);

    assertEquals(result.terminate, true);
    assertEquals(result.content.length, 0);
    assertEquals(/** @type {{ agentName: string, reason: string }} */ (result.details).agentName, AGENTS.ROUTER);
    assertEquals(/** @type {{ agentName: string, reason: string }} */ (result.details).reason, reason);
    assertEquals(getSystemMessageCount(), 0);

    const handoff = hostedSession.consumePendingSwitchHandoff();
    assertEquals(handoff?.agentName, AGENTS.ROUTER);
    assertEquals(handoff?.reason, reason);
});

Deno.test("executeReturnToRouter installs the normal Router agent handler on HostedSession", async () => {
    const { uiAPI } = makeMockUiAPI();
    const hostedSession = makeHostedSession();
    hostedSession.setRootAgentName(AGENTS.PLANNER);
    const routerHandler = async () => {};

    await executeReturnToRouter(
        { reason: "The user wants you to triage this request from scratch." },
        uiAPI,
        hostedSession,
        { createAgentHandler: () => routerHandler },
    );

    assertEquals(hostedSession.getActiveOnMessage(), routerHandler);
});

Deno.test("returnToRouterTool queues Router's model on the HostedSession pending root swap", async () => {
    const { uiAPI } = makeMockUiAPI();
    const hostedSession = makeHostedSession();
    hostedSession.setRootAgentName(AGENTS.ENGINEER);

    await executeReturnToRouter(
        { reason: "The user wants you to triage this request from scratch." },
        uiAPI,
        hostedSession,
    );

    const routerDef = await loadAgentDef(AGENTS.ROUTER);
    const pending = hostedSession.getPendingRootSwap();
    assertEquals(pending?.agentName, AGENTS.ROUTER);
    assertEquals(pending?.model, routerDef.model || undefined);
});

Deno.test("returnToRouterTool uses HostedSession and UI from tool context", async () => {
    const { uiAPI } = makeMockUiAPI();
    const hostedSession = makeHostedSession();
    hostedSession.setRootAgentName(AGENTS.ENGINEER);
    const reason = "The user wants you to triage this request from scratch.";

    const result = await executeTool(returnToRouterTool, { reason }, { uiAPI, hostedSession });

    assertEquals(result.terminate, true);
    assertEquals(hostedSession.consumePendingSwitchHandoff()?.reason, reason);
    assertEquals(hostedSession.getPendingRootSwap()?.agentName, AGENTS.ROUTER);
});

Deno.test("executeReturnToRouter mutates only the target HostedSession", async () => {
    const { uiAPI } = makeMockUiAPI();
    const target = makeHostedSession("target-return-router-session");
    const other = makeHostedSession("other-return-router-session");
    const otherHandler = async () => {};
    target.setRootAgentName(AGENTS.ENGINEER);
    other.setRootAgentName(AGENTS.PLANNER);
    other.setActiveOnMessage(otherHandler);
    other.setPendingRootSwap({ agentName: AGENTS.PLANNER, displayName: "Planner" });
    other.setPendingSwitchHandoff({ agentName: AGENTS.PLANNER, reason: "keep this handoff" });

    const targetHandler = async () => {};
    await executeReturnToRouter(
        { reason: "The user wants you to triage this in isolation." },
        uiAPI,
        target,
        { createAgentHandler: () => targetHandler },
    );

    assertEquals(target.getActiveOnMessage(), targetHandler);
    assertEquals(target.getPendingRootSwap()?.agentName, AGENTS.ROUTER);
    assertEquals(target.consumePendingSwitchHandoff()?.agentName, AGENTS.ROUTER);
    assertEquals(other.getActiveOnMessage(), otherHandler);
    assertEquals(other.getPendingRootSwap()?.agentName, AGENTS.PLANNER);
    assertEquals(other.consumePendingSwitchHandoff()?.reason, "keep this handoff");
});
