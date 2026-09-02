import { assertEquals } from "@std/assert";
import { NO_OPEN_BROWSER_PORT } from "../../shared/browser-port.ts";
import { createTuiInteractionAdapter as createAdapter } from "./runtime-interaction-adapter.js";

/** @param {import('./types.js').UiAPI} uiAPI */
function createTuiInteractionAdapter(uiAPI) {
    return createAdapter(uiAPI, { browser: NO_OPEN_BROWSER_PORT });
}

/**
 * @param {string | null} selection
 * @param {{ busyValues?: boolean[] }} [state]
 */
function makeUi(selection, state = {}) {
    return /** @type {any} */ ({
        promptSelect: () => Promise.resolve(selection),
        promptText: () => Promise.resolve(null),
        setBusy: (/** @type {boolean} */ busy) => state.busyValues?.push(busy),
    });
}

Deno.test("TUI interaction adapter rejects invalid selected options", async () => {
    const adapter = createTuiInteractionAdapter(makeUi("invalid"));
    const response = await adapter.requestInteraction({
        type: "select",
        prompt: "Pick",
        options: [{ value: "valid", label: "Valid" }],
    });

    assertEquals(response.outcome, "unsupported");
    assertEquals(response.message, "Select prompt returned invalid option: invalid");
});

Deno.test("TUI interaction adapter maps declined approval choices to canceled outcome", async () => {
    const adapter = createTuiInteractionAdapter(makeUi("deny"));
    const response = await adapter.requestInteraction({
        type: "approval",
        prompt: "Approve?",
        options: [{ value: "approve", label: "Approve" }, { value: "deny", label: "Deny" }],
    });

    assertEquals(response.outcome, "canceled");
    assertEquals(response.value, false);
});

Deno.test("TUI interaction adapter does not auto-accept arbitrary single approval options", async () => {
    const adapter = createTuiInteractionAdapter(makeUi("deny"));
    const response = await adapter.requestInteraction({
        type: "approval",
        prompt: "Approve?",
        options: [{ value: "deny", label: "Deny" }],
    });

    assertEquals(response.outcome, "canceled");
    assertEquals(response.value, false);
});

Deno.test("TUI interaction adapter maps approval prompts to accepted outcome", async () => {
    const adapter = createTuiInteractionAdapter(makeUi("approve"));
    const response = await adapter.requestInteraction({
        type: "approval",
        prompt: "Approve?",
        options: [{ value: "approve", label: "Approve" }],
    });

    assertEquals(response.outcome, "accepted");
    assertEquals(response.value, true);
});

Deno.test("TUI interaction adapter advertises browser-backed review capabilities", () => {
    const adapter = createTuiInteractionAdapter(makeUi(null));

    assertEquals(adapter.supportsInteraction?.("pair_checkpoint"), true);
    assertEquals(adapter.supportsInteraction?.("artifact_review"), true);
    assertEquals(adapter.supportsInteraction?.("select"), false);
    assertEquals(adapter.supportsInteraction?.("text"), false);
});

Deno.test("TUI interaction adapter returns atomic pair checkpoint revision feedback", async () => {
    /** @type {string[]} */
    const prompts = [];
    /** @type {any[]} */
    const options = [];
    let feedbackPrompt = "";
    const adapter = createTuiInteractionAdapter(
        /** @type {any} */ ({
            /** @param {string} prompt @param {any[]} promptOptions */
            promptSelect: (prompt, promptOptions) => {
                prompts.push(prompt);
                options.push(...promptOptions);
                return Promise.resolve("revise");
            },
            /** @param {string} prompt */
            promptText: (prompt) => {
                feedbackPrompt = prompt;
                return Promise.resolve("Increase the heading contrast");
            },
        }),
    );

    const response = await adapter.requestInteraction({
        type: "pair_checkpoint",
        prompt: "Rendered account card",
        _meta: {
            checkpointNumber: 2,
            route: "/account",
            state: "Validation error",
            viewport: "mobile",
            evidence: ["/tmp/account.png"],
            diagnostics: "No console errors",
            nextIncrement: "Polish empty state",
        },
    });

    assertEquals(response, {
        outcome: "selected",
        value: "revise",
        _meta: { feedback: "Increase the heading contrast" },
    });
    assertEquals(
        prompts[0],
        [
            "Pair checkpoint",
            "Rendered account card",
            "Checkpoint: 2 | Route: /account | State: Validation error | Viewport: mobile",
            "Evidence: /tmp/account.png",
            "Diagnostics: No console errors",
            "Next: Polish empty state",
        ].join("\n"),
    );
    assertEquals(options, [
        { value: "continue", label: "Continue to the next increment" },
        { value: "revise", label: "Revise this increment" },
        { value: "autonomous", label: "Finish autonomously" },
        { value: "stop", label: "Stop and keep the Plan in progress" },
    ]);
    assertEquals(feedbackPrompt, "Revision feedback for this Pair checkpoint");
});

Deno.test("TUI interaction adapter labels final Pair checkpoint as validation approval", async () => {
    const prompts = /** @type {string[]} */ ([]);
    let options = /** @type {Array<{ value: string, label: string }>} */ ([]);
    let feedbackPrompt = "";
    const adapter = createTuiInteractionAdapter(
        /** @type {any} */ ({
            promptSelect: (
                /** @type {string} */ prompt,
                /** @type {Array<{ value: string, label: string }>} */ opts,
            ) => {
                prompts.push(prompt);
                options = opts;
                return Promise.resolve("revise");
            },
            promptText: (/** @type {string} */ prompt) => {
                feedbackPrompt = prompt;
                return Promise.resolve("One more visual polish pass");
            },
        }),
    );

    const response = await adapter.requestInteraction({
        type: "pair_checkpoint",
        prompt: "- Final page is ready.",
        _meta: { finalCompletion: true, checkpointNumber: 3 },
    });

    assertEquals(response, {
        outcome: "selected",
        value: "revise",
        _meta: { feedback: "One more visual polish pass" },
    });
    assertEquals(prompts[0].startsWith("Final Pair checkpoint\n- Final page is ready."), true);
    assertEquals(options, [
        { value: "continue", label: "Approve and start validation" },
        { value: "revise", label: "Revise the final result" },
        { value: "autonomous", label: "Finish autonomously" },
        { value: "stop", label: "Stop and keep the Plan in progress" },
    ]);
    assertEquals(feedbackPrompt, "Revision feedback for this final Pair checkpoint");
});

for (const decision of ["continue", "autonomous", "stop"]) {
    Deno.test(`TUI interaction adapter returns Pair checkpoint ${decision} direction`, async () => {
        const adapter = createTuiInteractionAdapter(makeUi(decision));

        const response = await adapter.requestInteraction({
            type: "pair_checkpoint",
            prompt: "Rendered account card",
        });

        assertEquals(response, { outcome: "selected", value: decision });
    });
}

Deno.test("TUI interaction adapter bounds Pair context and omits missing optional fields", async () => {
    let prompt = "";
    const adapter = createTuiInteractionAdapter(
        /** @type {any} */ ({
            /** @param {string} value */
            promptSelect: (value) => {
                prompt = value;
                return Promise.resolve("continue");
            },
            promptText: () => Promise.resolve(null),
        }),
    );

    await adapter.requestInteraction({
        type: "pair_checkpoint",
        prompt: "x".repeat(600),
        _meta: { evidence: Array.from({ length: 10 }, (_, index) => `evidence-${index + 1}`) },
    });

    assertEquals(prompt.includes(`${"x".repeat(497)}...`), true);
    assertEquals(prompt.includes("Evidence: evidence-1, evidence-2"), true);
    assertEquals(prompt.includes("evidence-8 (+2 more)"), true);
    assertEquals(prompt.includes("evidence-9"), false);
    assertEquals(prompt.includes("undefined"), false);
});

Deno.test("TUI interaction adapter distinguishes Pair decision cancellation", async () => {
    const adapter = createTuiInteractionAdapter(makeUi(null));

    const response = await adapter.requestInteraction({
        type: "pair_checkpoint",
        prompt: "Rendered account card",
    });

    assertEquals(response, { outcome: "canceled" });
});

Deno.test("TUI interaction adapter cancels revise when feedback is canceled", async () => {
    const adapter = createTuiInteractionAdapter(makeUi("revise"));

    const response = await adapter.requestInteraction({
        type: "pair_checkpoint",
        prompt: "Rendered account card",
    });

    assertEquals(response, { outcome: "canceled" });
});

Deno.test("TUI interaction adapter cancels revise when feedback is empty", async () => {
    const adapter = createTuiInteractionAdapter(
        /** @type {any} */ ({
            promptSelect: () => Promise.resolve("revise"),
            promptText: () => Promise.resolve("   "),
        }),
    );

    const response = await adapter.requestInteraction({
        type: "pair_checkpoint",
        prompt: "Rendered account card",
    });

    assertEquals(response, { outcome: "canceled" });
});

Deno.test("TUI interaction adapter rejects invalid Pair checkpoint decisions", async () => {
    const adapter = createTuiInteractionAdapter(makeUi("invalid"));

    const response = await adapter.requestInteraction({
        type: "pair_checkpoint",
        prompt: "Rendered account card",
    });

    assertEquals(response, {
        outcome: "unsupported",
        message: "Pair checkpoint prompt returned invalid option: invalid",
    });
});
