import { assertEquals } from "@std/assert";
import { runValidationLoop } from "./validation.js";

/**
 * @returns {any & { messages: string[] }}
 */
function makeUi() {
    /** @type {string[]} */
    const messages = [];
    return /** @type {any} */ ({
        messages,
        appendSystemMessage: (/** @type {string} */ msg) => messages.push(String(msg)),
        promptText: () => Promise.resolve("deno task test"),
    });
}

Deno.test("runValidationLoop does not switch active agent unless finalAgentName is provided", async () => {
    const uiAPI = makeUi();
    await runValidationLoop({
        planName: "p",
        planContent: "",
        triageMeta: { classification: "FEATURE" },
        uiAPI,
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
            getDiffText: () => Promise.resolve(""),
            setActiveAgent: () => {
                throw new Error("should not switch agent");
            },
        }),
    });

    assertEquals(
        uiAPI.messages.some((/** @type {string} */ m) => m.includes("execution and validation complete")),
        true,
    );
});

Deno.test("runValidationLoop restores requested final agent after validation", async () => {
    const uiAPI = makeUi();
    /** @type {string[]} */
    const switched = [];
    await runValidationLoop({
        planName: "p",
        planContent: "",
        triageMeta: { classification: "FEATURE" },
        uiAPI,
        sessionManager: undefined,
        finalAgentName: "planner",
        __deps: /** @type {any} */ ({
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
            getDiffText: () => Promise.resolve(""),
            createDirectAgentHandler: (/** @type {string} */ name) => () => Promise.resolve(name),
            setActiveAgent: (/** @type {string} */ name) => switched.push(name),
        }),
    });

    assertEquals(switched, ["planner"]);
});

Deno.test("runValidationLoop halts when CI repair does not call task_completed", async () => {
    const uiAPI = makeUi();
    let repairCalls = 0;
    await runValidationLoop({
        planName: "p",
        planContent: "",
        triageMeta: { classification: "FEATURE" },
        uiAPI,
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            runLocalCI: () => Promise.resolve({ exitCode: 1, output: "boom" }),
            runAgentSession: () => {
                repairCalls++;
                return Promise.resolve([]);
            },
            readLatestTaskCompletedOutcome: () => false,
            setActiveAgent: () => {},
        }),
    });

    assertEquals(repairCalls, 1);
    assertEquals(uiAPI.messages.some((/** @type {string} */ m) => m.includes("stopped without task_completed")), true);
});
