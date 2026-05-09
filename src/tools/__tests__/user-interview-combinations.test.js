import { assertEquals } from "@std/assert";
import { createUserInterviewTool } from "../../tools/user-interview.js";

class MockUiAPI {
    /** @param {Array<string | null>} [responses] */
    constructor(responses = []) {
        this.responses = responses;
        this.callCount = 0;
    }

    /** @type {Array<string | null>} */
    responses;
    /** @type {number} */
    callCount;

    appendSystemMessage() {}
    appendAgentMessageStart() {
        return { appendText() {} };
    }
    requestRender() {}

    /** @param {string} _prompt @param {Array<{value: string, label?: string}>} _options */
    promptSelect(_prompt, _options) {
        return Promise.resolve(this.responses[this.callCount++] ?? null);
    }

    /** @param {string} _prompt @param {{ defaultValue?: string, placeholder?: string, allowEmpty?: boolean }} [_options] */
    promptText(_prompt, _options) {
        return Promise.resolve(this.responses[this.callCount++] ?? null);
    }
}

/**
 * @param {{ execute: unknown }} tool
 * @param {object} params
 */
async function executeTool(tool, params) {
    const execute =
        /** @type {(id: string, params: object, signal: AbortSignal, onUpdate: () => void, context: object) => Promise<{ details: import('../../tools/user-interview.js').InterviewResultDetails }>} */ (tool
            .execute);
    return await execute("tool-call-1", params, new AbortController().signal, () => {}, {});
}

Deno.test("user_interview - Single Yes/No Question (Happy Path)", async () => {
    const tool = createUserInterviewTool(/** @type {any} */ (new MockUiAPI(["yes"])));
    const result = await executeTool(tool, {
        question: {
            type: "yes_no",
            prompt: "Do you agree?",
        },
    });

    assertEquals(result.details.status, "completed");
    assertEquals(result.details.answers[0]?.value, true);
});

Deno.test("user_interview - Single Yes/No with Other (Happy Path)", async () => {
    const tool = createUserInterviewTool(/** @type {any} */ (new MockUiAPI(["other", "I have a custom thought"])));
    const result = await executeTool(tool, {
        question: {
            type: "yes_no",
            prompt: "Do you agree?",
            allowOther: true,
        },
    });

    assertEquals(result.details.status, "completed");
    assertEquals(result.details.answers[0]?.value, "other");
    assertEquals(result.details.answers[0]?.otherText, "I have a custom thought");
});

Deno.test("user_interview - Multiple Choice (Happy Path)", async () => {
    const tool = createUserInterviewTool(/** @type {any} */ (new MockUiAPI(["option_b"])));
    const result = await executeTool(tool, {
        question: {
            type: "multiple_choice",
            prompt: "Pick one",
            choices: [
                { value: "option_a", label: "A" },
                { value: "option_b", label: "B" },
            ],
        },
    });

    assertEquals(result.details.status, "completed");
    assertEquals(result.details.answers[0]?.value, "option_b");
});

Deno.test("user_interview - Text Question (Happy Path)", async () => {
    const tool = createUserInterviewTool(/** @type {any} */ (new MockUiAPI(["Hello World"])));
    const result = await executeTool(tool, {
        question: {
            type: "text",
            prompt: "Your name?",
        },
    });

    assertEquals(result.details.status, "completed");
    assertEquals(result.details.answers[0]?.value, "Hello World");
});

Deno.test("user_interview - Batch of Questions (Happy Path)", async () => {
    const tool = createUserInterviewTool(/** @type {any} */ (new MockUiAPI(["yes", "option_a", "My Text"])));
    const result = await executeTool(tool, {
        questions: [
            { type: "yes_no", prompt: "Q1" },
            { type: "multiple_choice", prompt: "Q2", choices: [{ value: "option_a" }, { value: "option_b" }] },
            { type: "text", prompt: "Q3" },
        ],
    });

    assertEquals(result.details.status, "completed");
    assertEquals(result.details.answers.length, 3);
    assertEquals(result.details.answers[0]?.value, true);
    assertEquals(result.details.answers[1]?.value, "option_a");
    assertEquals(result.details.answers[2]?.value, "My Text");
});

Deno.test("user_interview - Invalid Request (Both question and questions)", async () => {
    const tool = createUserInterviewTool(/** @type {any} */ (new MockUiAPI()));
    const result = await executeTool(tool, {
        question: { type: "text", prompt: "Q1" },
        questions: [{ type: "text", prompt: "Q2" }],
    });

    assertEquals(result.details.status, "invalid_request");
    assertEquals(result.details.errors?.[0]?.code, "INVALID_BATCH");
});

Deno.test("user_interview - Validation Error (Empty Prompt)", async () => {
    const tool = createUserInterviewTool(/** @type {any} */ (new MockUiAPI()));
    const result = await executeTool(tool, {
        question: { type: "text", prompt: "" },
    });

    assertEquals(result.details.status, "invalid_request");
    assertEquals(result.details.errors?.[0]?.code, "EMPTY_PROMPT");
});

Deno.test("user_interview - User Cancelled", async () => {
    const tool = createUserInterviewTool(/** @type {any} */ (new MockUiAPI([null])));
    const result = await executeTool(tool, {
        question: { type: "text", prompt: "Q1" },
    });

    assertEquals(result.details.status, "canceled");
    assertEquals(result.details.canceled, true);
});

Deno.test("user_interview - Multiple Choice Validation (Too few choices)", async () => {
    const tool = createUserInterviewTool(/** @type {any} */ (new MockUiAPI()));
    const result = await executeTool(tool, {
        question: {
            type: "multiple_choice",
            prompt: "Q1",
            choices: [{ value: "only_one" }],
        },
    });

    assertEquals(result.details.status, "invalid_request");
    assertEquals(result.details.errors?.[0]?.code, "INVALID_CHOICES");
});
