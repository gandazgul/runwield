import { assertEquals } from "@std/assert";
import { ToolExecutionBlock } from "../ui/blocks.js";
import { initRunWieldTheme } from "../ui/theme.js";
import { restorePersistedMessagesToUi } from "./message-hydration.js";

initRunWieldTheme();

/**
 * @param {Array<Record<string, unknown>>} messages
 * @param {Array<Record<string, unknown>>} [entries]
 */
function makeSessionManager(messages, entries) {
    return /** @type {import('@earendil-works/pi-coding-agent').SessionManager} */ (/** @type {unknown} */ ({
        buildSessionContext: () => ({ messages, thinkingLevel: "off", model: null }),
        getBranch: entries ? () => entries : undefined,
    }));
}

function makeUi() {
    /** @type {Map<string, ToolExecutionBlock>} */
    const toolBlocks = new Map();
    /** @type {string[]} */
    const systemMessages = [];
    /** @type {string[]} */
    const agentMessages = [];
    /** @type {string[]} */
    const userMessages = [];
    /** @type {string[]} */
    const agentLabels = [];

    const uiAPI = /** @type {import('../ui/types.js').UiAPI} */ ({
        appendSystemMessage: (text) => systemMessages.push(text),
        appendAgentMessageStart: (label) => {
            agentLabels.push(label);
            return { appendText: (text) => agentMessages.push(text) };
        },
        appendUserMessage: (text) => userMessages.push(text),
        requestRender: () => {},
        promptSelect: () => Promise.resolve(null),
        promptText: () => Promise.resolve(null),
        showModelSelector: () => {},
        startToolExecution: (id, name, argsStr) => {
            const block = new ToolExecutionBlock(name, argsStr);
            toolBlocks.set(id, block);
            return block;
        },
        getActiveToolBlock: (id) => toolBlocks.get(id),
    });

    return { uiAPI, toolBlocks, systemMessages, agentMessages, userMessages, agentLabels };
}

Deno.test("restorePersistedMessagesToUi replays the persisted branch instead of the shortened model context", () => {
    const { uiAPI, agentMessages, userMessages } = makeUi();

    restorePersistedMessagesToUi(
        makeSessionManager(
            [
                {
                    role: "user",
                    content: [{ type: "text", text: "latest model-context-only prompt" }],
                },
            ],
            [
                {
                    type: "message",
                    timestamp: 1000,
                    message: {
                        role: "user",
                        content: [{ type: "text", text: "older visible prompt" }],
                    },
                },
                {
                    type: "message",
                    timestamp: 2000,
                    message: {
                        role: "assistant",
                        content: [{ type: "text", text: "older visible answer" }],
                    },
                },
                {
                    type: "message",
                    timestamp: 3000,
                    message: {
                        role: "user",
                        content: [{ type: "text", text: "latest persisted prompt" }],
                    },
                },
            ],
        ),
        uiAPI,
    );

    assertEquals(userMessages, ["older visible prompt", "latest persisted prompt"]);
    assertEquals(agentMessages, ["older visible answer"]);
});

Deno.test("restorePersistedMessagesToUi does not replay persisted thinking blocks", () => {
    const { uiAPI, agentMessages } = makeUi();

    restorePersistedMessagesToUi(
        makeSessionManager(
            [],
            [
                {
                    type: "message",
                    timestamp: 1000,
                    message: {
                        role: "assistant",
                        content: [
                            { type: "thinking", thinking: "long private reasoning" },
                            { type: "text", text: "visible answer" },
                        ],
                    },
                },
            ],
        ),
        uiAPI,
    );

    assertEquals(agentMessages, ["visible answer"]);
});

Deno.test("restorePersistedMessagesToUi compacts long restored non-tool text blocks", () => {
    const { uiAPI, userMessages } = makeUi();
    const longText = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join("\n");

    restorePersistedMessagesToUi(
        makeSessionManager(
            [],
            [
                {
                    type: "message",
                    timestamp: 1000,
                    message: {
                        role: "user",
                        content: [{ type: "text", text: longText }],
                    },
                },
            ],
        ),
        uiAPI,
    );

    assertEquals(userMessages.length, 1);
    assertEquals(userMessages[0].includes("line 24"), true);
    assertEquals(userMessages[0].includes("line 25"), false);
    assertEquals(userMessages[0].includes("omitted from restored transcript"), true);
});

Deno.test("restorePersistedMessagesToUi hides silent semantic review turns", () => {
    const { uiAPI, agentMessages, userMessages } = makeUi();

    restorePersistedMessagesToUi(
        makeSessionManager(
            [],
            [
                {
                    type: "message",
                    timestamp: 1000,
                    message: {
                        role: "user",
                        content: [{
                            type: "text",
                            text:
                                "Compare the current implementation diff against the original plan. If the code fully satisfies the plan, reply ONLY with the word 'APPROVED'. Otherwise, list the missing semantic requirements.",
                        }],
                    },
                },
                {
                    type: "message",
                    timestamp: 2000,
                    message: {
                        role: "assistant",
                        content: [{ type: "text", text: "APPROVED" }],
                    },
                },
                {
                    type: "message",
                    timestamp: 3000,
                    message: {
                        role: "assistant",
                        content: [{ type: "text", text: "visible follow-up" }],
                    },
                },
            ],
        ),
        uiAPI,
    );

    assertEquals(userMessages, []);
    assertEquals(agentMessages, ["visible follow-up"]);
});

Deno.test("restorePersistedMessagesToUi hides internal repair prompts but keeps visible repair output", () => {
    const { uiAPI, agentMessages, userMessages } = makeUi();

    restorePersistedMessagesToUi(
        makeSessionManager(
            [],
            [
                {
                    type: "message",
                    timestamp: 1000,
                    message: {
                        role: "user",
                        content: [{
                            type: "text",
                            text:
                                "The project failed CI validation. Fix the following build errors, then call task_completed when the repair is complete:\n\nboom",
                        }],
                    },
                },
                {
                    type: "message",
                    timestamp: 2000,
                    message: {
                        role: "assistant",
                        content: [{ type: "text", text: "I fixed the CI failure." }],
                    },
                },
            ],
        ),
        uiAPI,
    );

    assertEquals(userMessages, []);
    assertEquals(agentMessages, ["I fixed the CI failure."]);
});

Deno.test("restorePersistedMessagesToUi renders task_completed as markdown instead of raw tool params", () => {
    const { uiAPI, agentMessages, toolBlocks } = makeUi();

    restorePersistedMessagesToUi(
        makeSessionManager([
            {
                role: "assistant",
                content: [{
                    type: "toolCall",
                    id: "call_task",
                    name: "task_completed",
                    arguments: {
                        message:
                            "CI fixed: pre-existing type errors resolved with **JSDoc** annotation and formatting.",
                    },
                }],
                timestamp: 1000,
            },
            {
                role: "toolResult",
                toolCallId: "call_task",
                toolName: "task_completed",
                content: [],
                isError: false,
                timestamp: 1100,
            },
        ]),
        uiAPI,
    );

    assertEquals(toolBlocks.size, 0);
    assertEquals(agentMessages, [
        "**Task completed.**\n\nCI fixed: pre-existing type errors resolved with **JSDoc** annotation and formatting.",
    ]);
});

Deno.test("restorePersistedMessagesToUi uses activeAgentLabel option for restored assistant messages", () => {
    const { uiAPI, agentLabels } = makeUi();

    restorePersistedMessagesToUi(
        makeSessionManager([{
            role: "assistant",
            content: [{ type: "text", text: "visible answer" }],
        }]),
        uiAPI,
        { activeAgentLabel: "Engineer" },
    );

    assertEquals(agentLabels, ["Engineer"]);
});

Deno.test("restorePersistedMessagesToUi uses HostedSession label instead of global state", () => {
    const { uiAPI, agentLabels } = makeUi();
    const hostedSession = /** @type {import('../session/hosted-session.js').HostedSession} */ ({
        getActiveAgentName: () => "Operator",
    });

    restorePersistedMessagesToUi(
        makeSessionManager([{
            role: "assistant",
            content: [{ type: "text", text: "visible answer" }],
        }]),
        uiAPI,
        { hostedSession },
    );

    assertEquals(agentLabels, ["Operator"]);
});

Deno.test("restorePersistedMessagesToUi keeps RunWield as fallback task_completed label", () => {
    const { uiAPI, agentLabels } = makeUi();

    restorePersistedMessagesToUi(
        makeSessionManager([{
            role: "assistant",
            content: [{
                type: "toolCall",
                id: "call_task",
                name: "task_completed",
                arguments: { message: "Done." },
            }],
        }]),
        uiAPI,
    );

    assertEquals(agentLabels, ["RunWield"]);
});

Deno.test("restorePersistedMessagesToUi restores tool results into collapsed expandable tool blocks", () => {
    const { uiAPI, toolBlocks, systemMessages } = makeUi();
    const output = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join("\n");

    restorePersistedMessagesToUi(
        makeSessionManager([
            {
                role: "assistant",
                content: [{
                    type: "toolCall",
                    id: "call_1",
                    name: "bash",
                    arguments: { command: "printf lines" },
                }],
                timestamp: 1000,
            },
            {
                role: "toolResult",
                toolCallId: "call_1",
                toolName: "bash",
                content: [{ type: "text", text: output }],
                isError: false,
                timestamp: 2500,
            },
        ]),
        uiAPI,
    );

    const block = toolBlocks.get("call_1");
    assertEquals(Boolean(block), true);
    assertEquals(block?.expanded, false);
    assertEquals(block?.bodyText, output);
    assertEquals(systemMessages, []);

    const collapsed = block?.render(80).join("\n") || "";
    assertEquals(collapsed.includes("line 6"), true);
    assertEquals(collapsed.includes("line 7"), false);
    assertEquals(collapsed.includes("press ctrl+o to expand"), true);

    block?.setExpanded(true);
    const expanded = block?.render(80).join("\n") || "";
    assertEquals(expanded.includes("line 10"), true);
    assertEquals(expanded.includes("press ctrl+o to collapse"), true);
});

Deno.test("restorePersistedMessagesToUi falls back for orphaned tool results", () => {
    const { uiAPI, toolBlocks, systemMessages } = makeUi();

    restorePersistedMessagesToUi(
        makeSessionManager([
            {
                role: "toolResult",
                toolCallId: "missing_call",
                toolName: "bash",
                content: [{ type: "text", text: "orphan output" }],
                isError: true,
                timestamp: 1000,
            },
        ]),
        uiAPI,
    );

    assertEquals(toolBlocks.size, 0);
    assertEquals(systemMessages, ["orphan output"]);
});
