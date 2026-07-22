import { assertEquals } from "@std/assert";
import { createTuiInteractionAdapter } from "./runtime-interaction-adapter.js";

/** @param {string | null} selection */
function makeUi(selection) {
    return /** @type {any} */ ({
        promptSelect: () => Promise.resolve(selection),
        promptText: () => Promise.resolve(null),
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

Deno.test("TUI interaction adapter forwards plan review server output listener", async () => {
    let forwardedOnOutput = null;
    const onOutput = () => {};
    const adapter = createTuiInteractionAdapter(makeUi(null), {
        submitPlanForReview: (/** @type {any} */ options) => {
            forwardedOnOutput = options.onOutput;
            return Promise.resolve({ approved: true, approvalAction: "run" });
        },
    });

    const response = await adapter.requestInteraction({
        type: "plan_review",
        prompt: "Review",
        _meta: { cwd: "/repo", planName: "plan", planPath: "/repo/plans/plan.md", onOutput },
    });

    assertEquals(response.outcome, "accepted");
    assertEquals(response._meta?.approvalAction, "run");
    assertEquals(forwardedOnOutput, onOutput);
});

Deno.test("TUI interaction adapter returns atomic pair checkpoint revision feedback", async () => {
    /** @type {string[]} */
    const prompts = [];
    const adapter = createTuiInteractionAdapter(
        /** @type {any} */ ({
            /** @param {string} prompt */
            promptSelect: (prompt) => {
                prompts.push(prompt);
                return Promise.resolve("revise");
            },
            promptText: () => Promise.resolve("Increase the heading contrast"),
        }),
    );

    assertEquals(adapter.supportsInteraction?.("pair_checkpoint"), true);
    const response = await adapter.requestInteraction({
        type: "pair_checkpoint",
        prompt: "Rendered account card",
        _meta: {
            route: "/account",
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
    assertEquals(prompts[0].includes("/account"), true);
    assertEquals(prompts[0].includes("/tmp/account.png"), true);
});
