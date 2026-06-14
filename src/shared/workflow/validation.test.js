import { assertEquals } from "@std/assert";
import { runValidationLoop } from "./validation.js";
import { getActiveExecutionWorkflow, setActiveExecutionWorkflow } from "../session/session-state.js";

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
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ m) =>
            m.includes("Workflow halted: Operator stopped without task_completed during CI repair.")
        ),
        true,
    );
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ m) => m.includes("Mechanical validation failed 3 times")),
        false,
    );
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ m) => m.includes("during validation repair")),
        false,
    );
});

Deno.test("runValidationLoop reports exact semantic repair halt reason", async () => {
    const uiAPI = makeUi();
    await runValidationLoop({
        planName: "p",
        planContent: "plan",
        triageMeta: { classification: "FEATURE" },
        uiAPI,
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
            getDiffText: () => Promise.resolve("diff"),
            runAgentSession: () =>
                Promise.resolve(
                    /** @type {any} */ ([{
                        role: "assistant",
                        content: [{ type: "text", text: "missing requirement" }],
                    }]),
                ),
            runCompletionGatedRepair: () => Promise.resolve(false),
            setActiveAgent: () => {},
        }),
    });

    assertEquals(
        uiAPI.messages.some((/** @type {string} */ m) =>
            m.includes("Workflow halted: Engineer stopped without task_completed during semantic repair.")
        ),
        true,
    );
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ m) => m.includes("Maximum validation cycles")),
        false,
    );
});

Deno.test("runValidationLoop reviews the diff scoped to the active workflow baseline", async () => {
    const uiAPI = makeUi();
    /** @type {string[]} */
    const reviewPrompts = [];
    /** @type {Array<string | undefined>} */
    const baselineArgs = [];

    setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "FEATURE" },
        baselineTree: "baseline-tree",
    });

    await runValidationLoop({
        planName: "p",
        planContent: "plan",
        triageMeta: { classification: "FEATURE" },
        uiAPI,
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
            getDiffText: (/** @type {string | undefined} */ baselineTree) => {
                baselineArgs.push(baselineTree);
                return Promise.resolve("diff --git a/workflow.js b/workflow.js\n+scoped workflow change\n");
            },
            runAgentSession: (/** @type {any} */ opts) => {
                reviewPrompts.push(opts.userRequest);
                return Promise.resolve(
                    /** @type {any} */ ([{
                        role: "assistant",
                        content: [{ type: "text", text: "APPROVED" }],
                    }]),
                );
            },
            setActiveAgent: () => {},
        }),
    });

    assertEquals(baselineArgs, ["baseline-tree"]);
    assertEquals(reviewPrompts.length, 1);
    assertEquals(reviewPrompts[0].includes("scoped workflow change"), true);
    assertEquals(reviewPrompts[0].includes("pre-existing dirty change"), false);
    assertEquals(getActiveExecutionWorkflow(), null);
});
