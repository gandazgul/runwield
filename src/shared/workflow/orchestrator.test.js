import { assertEquals } from "@std/assert";
import { dispatchPostTriage, readLatestTriageOutcome } from "./orchestrator.js";

/**
 * @returns {any & { messages: string[] }}
 */
function makeUi() {
    /** @type {string[]} */
    const messages = [];
    return /** @type {any} */ ({
        messages,
        appendSystemMessage: (/** @type {string} */ msg) => messages.push(String(msg)),
    });
}

Deno.test("dispatchPostTriage does not force Engineer after FEATURE/PROJECT validation", async () => {
    const source = await Deno.readTextFile(new URL("./orchestrator.js", import.meta.url));
    assertEquals(source.includes("setActiveAgent(AGENTS.ENGINEER"), false);
});

Deno.test("dispatchPostTriage restores plan owner when FEATURE/PROJECT execution is incomplete", async () => {
    const source = await Deno.readTextFile(new URL("./orchestrator.js", import.meta.url));
    assertEquals(
        source.includes(
            "} else {\n                setActiveAgent(agentName, createDirectAgentHandler(agentName), uiAPI);",
        ),
        true,
    );
});

Deno.test("dispatchPostTriage skips workflow validation for completed QUICK_FIX", async () => {
    const uiAPI = makeUi();
    let validationCount = 0;

    await dispatchPostTriage({
        triage: {
            classification: "QUICK_FIX",
            complexity: "LOW",
            summary: "answer a question",
            affectedPaths: [],
        },
        userRequest: "Where is the router?",
        images: [],
        uiAPI,
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            applyPendingRootSwap: () => Promise.resolve(),
            createDirectAgentHandler: (/** @type {string} */ name) => () => Promise.resolve(name),
            readLatestTaskCompletedOutcome: () => true,
            runRootTurn: () =>
                Promise.resolve(
                    /** @type {any} */ ([{
                        role: "toolResult",
                        toolName: "task_completed",
                        details: { outcome: "task_completed" },
                    }]),
                ),
            runValidationLoop: () => {
                validationCount++;
                return Promise.resolve();
            },
            setActiveAgent: () => {},
        }),
    });

    assertEquals(validationCount, 0);
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ message) => message.includes("validation is waiting")),
        false,
    );
});

Deno.test("readLatestTriageOutcome returns the latest triage_report details", () => {
    const messages = [
        /** @type {any} */ ({
            role: "toolResult",
            toolName: "triage_report",
            details: {
                classification: "QUICK_FIX",
                complexity: "LOW",
                summary: "first",
                affectedPaths: ["a.js"],
            },
        }),
        /** @type {any} */ ({
            role: "toolResult",
            toolName: "triage_report",
            details: {
                classification: "FEATURE",
                complexity: "MEDIUM",
                summary: "second",
                affectedPaths: ["b.js"],
            },
        }),
    ];
    assertEquals(readLatestTriageOutcome(messages), {
        classification: "FEATURE",
        complexity: "MEDIUM",
        summary: "second",
        affectedPaths: ["b.js"],
    });
});

Deno.test("readLatestTriageOutcome returns null when no triage_report tool result", () => {
    assertEquals(readLatestTriageOutcome([]), null);
});

Deno.test("readLatestTriageOutcome ignores tool results without classification", () => {
    const messages = [
        /** @type {any} */ ({
            role: "toolResult",
            toolName: "triage_report",
            details: { something: "else" },
        }),
    ];
    assertEquals(readLatestTriageOutcome(messages), null);
});
