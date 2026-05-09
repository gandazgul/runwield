import { assert, assertEquals, assertMatch } from "@std/assert";
import { createUserInterviewTool } from "../user-interview.js";

/**
 * @param {Partial<import('../../shared/ui/types.js').UiAPI>} overrides
 */
function makeUi(overrides) {
    return /** @type {import('../../shared/ui/types.js').UiAPI} */ ({
        appendSystemMessage: () => {},
        appendAgentMessageStart: () => ({ appendText: () => {} }),
        requestRender: () => {},
        promptSelect: () => Promise.resolve(null),
        promptText: () => Promise.resolve(null),
        ...overrides,
    });
}

/**
 * @param {{ execute: unknown }} tool
 * @param {object} params
 */
async function executeTool(tool, params) {
    const execute =
        /** @type {(id: string, params: object, signal: AbortSignal, onUpdate: () => void, context: object) => Promise<{ content: Array<{ type: string, text?: string }>, details: import('../user-interview.js').InterviewResultDetails }>} */ (tool
            .execute);
    return await execute("tool-call-1", params, new AbortController().signal, () => {}, {});
}

/**
 * @param {{ content: Array<{ type: string, text?: string }> }} result
 */
function firstText(result) {
    const first = result.content[0];
    assertEquals(first?.type, "text");
    if (!first || first.type !== "text") throw new Error("Expected text content.");
    return first.text ?? "";
}

Deno.test("userInterviewTool exposes expected metadata", () => {
    const tool = createUserInterviewTool(undefined);

    assertEquals(tool.name, "user_interview");
    assertEquals(tool.label, "User Interview");
    assertMatch(tool.description, /Ask the user 1-3 structured clarification questions/i);
    assertEquals(typeof tool.promptSnippet, "string");
    assertEquals(typeof tool.parameters, "object");
    assertEquals(typeof tool.execute, "function");
});

Deno.test("userInterviewTool completes a single yes/no question", async () => {
    const tool = createUserInterviewTool(makeUi({
        promptSelect: () => Promise.resolve("yes"),
    }));

    const result = await executeTool(tool, {
        question: {
            id: "confirm_scope",
            type: "yes_no",
            prompt: "Proceed with the scoped feature?",
            default: true,
        },
    });

    assertEquals(result.details.status, "completed");
    assertEquals(result.details.completed, true);
    assertEquals(result.details.answeredCount, 1);
    assertEquals(result.details.answers.length, 1);
    assertEquals(result.details.answers[0], {
        index: 1,
        id: "confirm_scope",
        type: "yes_no",
        prompt: "Proceed with the scoped feature?",
        value: true,
        valueLabel: "yes",
        otherText: undefined,
    });
    assertMatch(firstText(result), /Interview completed: captured 1\/1 answer\(s\)\./);
    assertMatch(firstText(result), /interview_result_json:/);
    assertMatch(firstText(result), /"answers"\s*:\s*\[/);
});

Deno.test("userInterviewTool completes a mixed 3-question batch", async () => {
    const selectedValues = ["high", "frontend"];
    const textValues = ["Use design tokens."];

    const tool = createUserInterviewTool(makeUi({
        promptSelect: () => Promise.resolve(selectedValues.shift() ?? null),
        promptText: () => Promise.resolve(textValues.shift() ?? null),
    }));

    const result = await executeTool(tool, {
        questions: [
            {
                id: "priority",
                type: "multiple_choice",
                prompt: "What priority should we assign?",
                default: "high",
                choices: [
                    { value: "low", label: "Low" },
                    { value: "high", label: "High" },
                ],
            },
            {
                id: "notes",
                type: "text",
                prompt: "Any implementation notes?",
                allowEmpty: false,
            },
            {
                id: "layer",
                type: "multiple_choice",
                prompt: "Which layer first?",
                choices: [
                    { value: "frontend", label: "Frontend" },
                    { value: "backend", label: "Backend" },
                ],
            },
        ],
    });

    assertEquals(result.details.status, "completed");
    assertEquals(result.details.totalQuestions, 3);
    assertEquals(result.details.answeredCount, 3);
    assertEquals(result.details.remainingCount, 0);
    assertEquals(result.details.answers[0]?.valueLabel, "High (recommended)");
    assertEquals(result.details.answers[1]?.value, "Use design tokens.");
    assertEquals(result.details.answers[2]?.value, "frontend");
});

Deno.test("userInterviewTool returns invalid_request when both question and questions are provided", async () => {
    const tool = createUserInterviewTool(undefined);

    const result = await executeTool(tool, {
        question: {
            type: "yes_no",
            prompt: "Question A",
        },
        questions: [{
            type: "yes_no",
            prompt: "Question B",
        }],
    });

    assertEquals(result.details.status, "invalid_request");
    assertEquals(result.details.errors?.[0]?.code, "INVALID_BATCH");
    assertMatch(result.details.errors?.[0]?.message ?? "", /either 'question' or 'questions'/i);
});

Deno.test("userInterviewTool returns invalid_request for validation errors", async () => {
    const tool = createUserInterviewTool(undefined);

    const result = await executeTool(tool, {
        questions: [
            {
                id: "dup",
                type: "multiple_choice",
                prompt: "Pick one",
                default: "gamma",
                choices: [
                    { value: "alpha" },
                    { value: "alpha" },
                ],
            },
            {
                id: "dup",
                type: "yes_no",
                prompt: "Continue?",
            },
        ],
    });

    assertEquals(result.details.status, "invalid_request");
    const codes = new Set((result.details.errors ?? []).map((/** @type {{ code: string }} */ e) => e.code));
    assert(codes.has("DUPLICATE_CHOICE_VALUE"));
    assert(codes.has("DEFAULT_NOT_IN_CHOICES"));
    assert(codes.has("DUPLICATE_ID"));
});

Deno.test("userInterviewTool returns canceled when user cancels", async () => {
    const tool = createUserInterviewTool(makeUi({
        promptSelect: () => Promise.resolve(null),
    }));

    const result = await executeTool(tool, {
        question: {
            id: "confirm",
            type: "yes_no",
            prompt: "Proceed?",
        },
    });

    assertEquals(result.details.status, "canceled");
    assertEquals(result.details.canceled, true);
    assertEquals(result.details.canceledAt, 1);
    assertEquals(result.details.answeredCount, 0);
    assertEquals(result.details.errors?.[0]?.code, "USER_CANCELED");
});

Deno.test("userInterviewTool returns validation_error for empty text answer when allowEmpty=false", async () => {
    const tool = createUserInterviewTool(makeUi({
        promptText: () => Promise.resolve("   "),
    }));

    const result = await executeTool(tool, {
        question: {
            id: "details",
            type: "text",
            prompt: "Provide details",
            allowEmpty: false,
        },
    });

    assertEquals(result.details.status, "validation_error");
    assertEquals(result.details.errors?.[0]?.code, "EMPTY_ANSWER");
});

Deno.test("userInterviewTool returns validation_error for invalid multiple-choice selection", async () => {
    const tool = createUserInterviewTool(makeUi({
        promptSelect: () => Promise.resolve("not-a-real-option"),
    }));

    const result = await executeTool(tool, {
        question: {
            id: "stack",
            type: "multiple_choice",
            prompt: "Pick stack",
            choices: [
                { value: "react", label: "React" },
                { value: "vue", label: "Vue" },
            ],
        },
    });

    assertEquals(result.details.status, "validation_error");
    assertEquals(result.details.errors?.[0]?.code, "INVALID_ANSWER");
    assertMatch(result.details.errors?.[0]?.message ?? "", /does not exist/i);
});

Deno.test("userInterviewTool returns invalid_request when payload is missing", async () => {
    const tool = createUserInterviewTool(undefined);
    const result = await executeTool(tool, {});

    assertEquals(result.details.status, "invalid_request");
    assertEquals(result.details.errors?.[0]?.code, "INVALID_BATCH");
    assertMatch(result.details.errors?.[0]?.message ?? "", /Missing interview payload/i);
});

Deno.test("userInterviewTool returns invalid_request for invalid id and choices", async () => {
    const tool = createUserInterviewTool(undefined);
    const result = await executeTool(tool, {
        question: {
            id: "bad id",
            type: "multiple_choice",
            prompt: "Pick",
            choices: [
                { value: "" },
                { value: "a" },
            ],
        },
    });

    assertEquals(result.details.status, "invalid_request");
    const codes = new Set((result.details.errors ?? []).map((/** @type {{ code: string }} */ e) => e.code));
    assert(codes.has("INVALID_ID"));
    assert(codes.has("EMPTY_CHOICE_VALUE"));
});

Deno.test("userInterviewTool returns validation_error for invalid yes/no response", async () => {
    const tool = createUserInterviewTool(makeUi({
        promptSelect: () => Promise.resolve("maybe"),
    }));

    const result = await executeTool(tool, {
        question: {
            id: "confirm",
            type: "yes_no",
            prompt: "Proceed?",
        },
    });

    assertEquals(result.details.status, "validation_error");
    assertEquals(result.details.errors?.[0]?.code, "INVALID_ANSWER");
    assertMatch(result.details.errors?.[0]?.message ?? "", /Unexpected yes\/no response/i);
});
