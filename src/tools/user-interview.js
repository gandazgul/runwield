/**
 * @module user-interview
 * Structured user interview tool for planning agents.
 */

import { StringEnum, Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import {
    requestHostedSessionInteraction,
    RuntimeInteractionOutcomes,
    RuntimeInteractionTypes,
} from "../shared/session/session-runtime-interactions.js";

const OTHER_VALUE = "other";
const RECOMMENDED_SUFFIX_PATTERN = /\s*\(recommended\)\s*$/i;

const questionIdSchema = Type.String({
    minLength: 1,
    maxLength: 64,
    description: "Optional stable question ID (letters, numbers, underscore, dash).",
});

const yesNoQuestionSchema = Type.Object({
    id: Type.Optional(questionIdSchema),
    type: StringEnum(["yes_no"]),
    prompt: Type.String({ minLength: 1, maxLength: 400, description: "Question text shown to the user." }),
    default: Type.Optional(Type.Boolean({ description: "Optional recommended default answer." })),
    allowOther: Type.Optional(Type.Boolean({
        description: "Deprecated. 'Other' is always available for yes_no questions.",
    })),
}, { additionalProperties: false });

const textQuestionSchema = Type.Object({
    id: Type.Optional(questionIdSchema),
    type: StringEnum(["text"]),
    prompt: Type.String({ minLength: 1, maxLength: 400, description: "Question text shown to the user." }),
    default: Type.Optional(Type.String({ maxLength: 400, description: "Optional default text answer." })),
    placeholder: Type.Optional(Type.String({ maxLength: 200, description: "Optional prompt hint." })),
    allowEmpty: Type.Optional(Type.Boolean({ description: "Whether empty text answers are allowed." })),
}, { additionalProperties: false });

const multipleChoiceQuestionSchema = Type.Object({
    id: Type.Optional(questionIdSchema),
    type: StringEnum(["multiple_choice"]),
    prompt: Type.String({ minLength: 1, maxLength: 400, description: "Question text shown to the user." }),
    choices: Type.Array(
        Type.Object({
            value: Type.String({ minLength: 1, maxLength: 120 }),
            label: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
        }, { additionalProperties: false }),
        {
            minItems: 2,
            maxItems: 12,
            description: "Choice list. Values must be unique in the same question.",
        },
    ),
    default: Type.Optional(
        Type.String({ minLength: 1, maxLength: 120, description: "Optional default choice value." }),
    ),
    allowOther: Type.Optional(Type.Boolean({
        description: "Deprecated. 'Other' is always available for multiple_choice questions.",
    })),
}, { additionalProperties: false });

const interviewQuestionSchema = Type.Union([
    yesNoQuestionSchema,
    textQuestionSchema,
    multipleChoiceQuestionSchema,
]);

const interviewParametersSchema = Type.Object({
    question: Type.Optional(interviewQuestionSchema),
    questions: Type.Optional(Type.Array(interviewQuestionSchema, {
        minItems: 1,
        maxItems: 3,
        description: "Batch of 1-3 questions asked sequentially.",
    })),
}, { additionalProperties: false });

/**
 * @typedef {{code: string, message: string, questionIndex?: number, questionId?: string}} InterviewError
 */

/**
 * @typedef {{ value: string, label?: string }} InterviewChoice
 */

/**
 * @typedef {{
 *   id?: string,
 *   type: "yes_no",
 *   prompt: string,
 *   default?: boolean,
 *   allowOther?: boolean,
 * }} YesNoInterviewQuestion
 */

/**
 * @typedef {{
 *   id?: string,
 *   type: "text",
 *   prompt: string,
 *   default?: string,
 *   placeholder?: string,
 *   allowEmpty?: boolean,
 * }} TextInterviewQuestion
 */

/**
 * @typedef {{
 *   id?: string,
 *   type: "multiple_choice",
 *   prompt: string,
 *   choices: InterviewChoice[],
 *   default?: string,
 *   allowOther?: boolean,
 * }} MultipleChoiceInterviewQuestion
 */

/**
 * @typedef {YesNoInterviewQuestion | TextInterviewQuestion | MultipleChoiceInterviewQuestion} InterviewQuestion
 */

/**
 * @typedef {{
 *   status: "completed" | "canceled" | "invalid_request" | "validation_error",
 *   canceled: boolean,
 *   completed: boolean,
 *   totalQuestions: number,
 *   answeredCount: number,
 *   remainingCount: number,
 *   canceledAt?: number,
 *   answers: Array<{index: number, id?: string, type: "yes_no" | "text" | "multiple_choice", prompt: string, value: boolean | string, valueLabel?: string, otherText?: string}>,
 *   errors?: InterviewError[]
 * }} InterviewResultDetails
 */

/**
 * @typedef {{ canceled?: boolean, value?: string | boolean, valueLabel?: string, otherText?: string, error?: InterviewError }} InterviewAnswer
 */

/**
 * @param {{ hostedSession?: import('../shared/session/hosted-session.js').HostedSession }} [opts]
 */
export function createUserInterviewTool(opts = {}) {
    const hostedSession = /** @type {import('../shared/session/hosted-session.js').HostedSession | undefined} */ (
        opts && typeof opts === "object" && "hostedSession" in opts ? opts.hostedSession : undefined
    );
    return defineTool({
        name: "user_interview",
        label: "User Interview",
        description:
            "Ask the user 1-3 structured clarification questions (yes_no, text, multiple_choice) and receive ordered answers. Yes/no and multiple-choice always include an 'Other' option with free-text follow-up.",
        promptSnippet:
            "user_interview(question|questions): Ask one or a small 1-3 question batch before finalizing planning decisions. Yes/no and multiple_choice always include an Other option for open-ended input.",
        parameters: interviewParametersSchema,
        async execute(_toolCallId, params) {
            const normalized = normalizeBatch(
                /** @type {{ question?: InterviewQuestion, questions?: InterviewQuestion[] }} */ (params),
            );
            if (!normalized.ok) {
                return buildResult({
                    status: "invalid_request",
                    canceled: false,
                    completed: false,
                    totalQuestions: 0,
                    answeredCount: 0,
                    remainingCount: 0,
                    answers: [],
                    errors: [{ code: "INVALID_BATCH", message: normalized.error || "Invalid interview batch." }],
                });
            }

            const questions = normalized.questions;
            const validationErrors = validateBatch(questions);
            if (validationErrors.length > 0) {
                return buildResult({
                    status: "invalid_request",
                    canceled: false,
                    completed: false,
                    totalQuestions: questions.length,
                    answeredCount: 0,
                    remainingCount: questions.length,
                    answers: [],
                    errors: validationErrors,
                });
            }

            /** @type {InterviewResultDetails["answers"]} */
            const answers = [];

            for (let i = 0; i < questions.length; i++) {
                const question = questions[i];
                const answer = /** @type {InterviewAnswer} */ (await askQuestion(question, hostedSession));

                const answerAny = /** @type {any} */ (answer);
                if (answerAny.canceled) {
                    return buildResult({
                        status: "canceled",
                        canceled: true,
                        completed: false,
                        totalQuestions: questions.length,
                        answeredCount: answers.length,
                        remainingCount: questions.length - answers.length,
                        canceledAt: i + 1,
                        answers,
                        errors: [{
                            code: "USER_CANCELED",
                            message: "User canceled the interview prompt.",
                            questionIndex: i + 1,
                            questionId: question.id,
                        }],
                    });
                }

                if (answerAny.error) {
                    return buildResult({
                        status: "validation_error",
                        canceled: false,
                        completed: false,
                        totalQuestions: questions.length,
                        answeredCount: answers.length,
                        remainingCount: questions.length - answers.length,
                        answers,
                        errors: [answerAny.error],
                    });
                }

                if (typeof answerAny.value === "undefined") {
                    return buildResult({
                        status: "validation_error",
                        canceled: false,
                        completed: false,
                        totalQuestions: questions.length,
                        answeredCount: answers.length,
                        remainingCount: questions.length - answers.length,
                        answers,
                        errors: [{
                            code: "MISSING_ANSWER",
                            message: "Interview answer was missing value.",
                            questionIndex: i + 1,
                            questionId: question.id,
                        }],
                    });
                }

                answers.push({
                    index: i + 1,
                    id: question.id,
                    type: question.type,
                    prompt: question.prompt,
                    value: answerAny.value,
                    valueLabel: answerAny.valueLabel,
                    otherText: answerAny.otherText,
                });
            }

            return buildResult({
                status: "completed",
                canceled: false,
                completed: true,
                totalQuestions: questions.length,
                answeredCount: answers.length,
                remainingCount: 0,
                answers,
            });
        },
    });
}

/**
 * @param {{ question?: InterviewQuestion, questions?: InterviewQuestion[] }} params
 * @returns {{ ok: true, questions: InterviewQuestion[] } | { ok: false, questions: InterviewQuestion[], error: string }}
 */
function normalizeBatch(params) {
    const hasQuestion = !!params.question;
    const hasQuestions = Array.isArray(params.questions);

    if (hasQuestion && hasQuestions) {
        return { ok: false, questions: [], error: "Provide either 'question' or 'questions', not both." };
    }

    if (!hasQuestion && !hasQuestions) {
        return {
            ok: false,
            questions: [],
            error: "Missing interview payload. Provide either 'question' or 'questions'.",
        };
    }

    const questions = hasQuestion ? [params.question] : params.questions;
    if (!Array.isArray(questions) || questions.length < 1 || questions.length > 3) {
        return { ok: false, questions: [], error: "Invalid batch size. Ask 1 to 3 questions per tool call." };
    }

    return { ok: true, questions: /** @type {InterviewQuestion[]} */ (questions.filter(Boolean)) };
}

/**
 * @param {InterviewQuestion[]} questions
 * @returns {InterviewError[]}
 */
function validateBatch(questions) {
    /** @type {InterviewError[]} */
    const errors = [];
    const ids = new Set();

    for (let i = 0; i < questions.length; i++) {
        const question = questions[i];
        const q = question;
        const idx = i + 1;

        if (q.id) {
            if (!/^[a-zA-Z0-9_-]+$/.test(q.id)) {
                errors.push({
                    code: "INVALID_ID",
                    message: "Question ID must use letters, numbers, underscore, or dash.",
                    questionIndex: idx,
                    questionId: q.id,
                });
            }
            if (ids.has(q.id)) {
                errors.push({
                    code: "DUPLICATE_ID",
                    message: `Duplicate question ID: ${q.id}`,
                    questionIndex: idx,
                    questionId: q.id,
                });
            }
            ids.add(q.id);
        }

        if (typeof q.prompt !== "string" || !q.prompt.trim()) {
            errors.push({
                code: "EMPTY_PROMPT",
                message: "Question prompt cannot be empty.",
                questionIndex: idx,
                questionId: q.id,
            });
        }

        if (q.type === "multiple_choice") {
            if (!Array.isArray(q.choices) || q.choices.length < 2) {
                errors.push({
                    code: "INVALID_CHOICES",
                    message: "Multiple-choice question requires at least 2 choices.",
                    questionIndex: idx,
                    questionId: q.id,
                });
                continue;
            }

            const values = new Set();
            for (const choice of q.choices) {
                const value = String(choice?.value || "").trim();
                if (!value) {
                    errors.push({
                        code: "EMPTY_CHOICE_VALUE",
                        message: "Choice value cannot be empty.",
                        questionIndex: idx,
                        questionId: q.id,
                    });
                }
                if (values.has(value)) {
                    errors.push({
                        code: "DUPLICATE_CHOICE_VALUE",
                        message: `Duplicate choice value in question ${idx}: ${value}`,
                        questionIndex: idx,
                        questionId: q.id,
                    });
                }
                values.add(value);
            }

            if (values.has(OTHER_VALUE)) {
                errors.push({
                    code: "SENTINEL_COLLISION",
                    message: `The value "${OTHER_VALUE}" is reserved and cannot be used as a choice value.`,
                    questionIndex: idx,
                    questionId: q.id,
                });
            }

            if (q.default && !values.has(String(q.default).trim())) {
                errors.push({
                    code: "DEFAULT_NOT_IN_CHOICES",
                    message: `Default value "${q.default}" is not present in choices.`,
                    questionIndex: idx,
                    questionId: q.id,
                });
            }
        }
    }

    return errors;
}

/**
 * @param {import('../shared/session/hosted-session.js').HostedSession | undefined} hostedSession
 * @param {import('../shared/session/session-runtime-interactions.js').RuntimeInteractionRequest} request
 */
async function askBrokered(hostedSession, request) {
    if (!hostedSession) {
        return {
            outcome: RuntimeInteractionOutcomes.UNSUPPORTED,
            message: "No hosted session is available for this interview prompt.",
        };
    }
    return await requestHostedSessionInteraction(hostedSession, request);
}

/**
 * @param {string} label
 */
function withRecommendedSuffix(label) {
    return RECOMMENDED_SUFFIX_PATTERN.test(label) ? label.trim() : `${label} (recommended)`;
}

/**
 * @param {import('../shared/session/session-runtime-interactions.js').RuntimeInteractionResponse} response
 * @param {InterviewQuestion} question
 */
function brokerFailureToAnswer(response, question) {
    if (response.outcome === RuntimeInteractionOutcomes.CANCELED) return { canceled: true };
    if (
        response.outcome === RuntimeInteractionOutcomes.UNSUPPORTED ||
        response.outcome === RuntimeInteractionOutcomes.BLOCKED
    ) {
        return {
            error: {
                code: response.outcome === RuntimeInteractionOutcomes.BLOCKED
                    ? "INTERACTION_BLOCKED"
                    : "INTERACTION_UNSUPPORTED",
                message: response.message || "The current client cannot answer this structured interview prompt.",
                questionId: question.id,
            },
        };
    }
    return null;
}

/**
 * @param {InterviewQuestion} question
 * @param {Array<{ value: string, label: string }>} options
 * @param {import('../shared/session/hosted-session.js').HostedSession | undefined} hostedSession
 * @param {{ defaultValue?: string }} [extra]
 * @returns {Promise<InterviewAnswer>}
 */
async function askSelect(question, options, hostedSession, extra = {}) {
    const brokerResponse = await askBrokered(hostedSession, {
        type: RuntimeInteractionTypes.SELECT,
        prompt: question.prompt,
        options,
        defaultValue: extra.defaultValue,
        _meta: { source: "user_interview", questionType: question.type, questionId: question.id },
    });
    const brokerFailure = brokerFailureToAnswer(brokerResponse, question);
    if (brokerFailure) return brokerFailure;
    const selected = brokerResponse.value;
    if (selected === null || typeof selected === "undefined") return { canceled: true };
    const option = options.find((item) => item.value === selected);
    return { value: String(selected), valueLabel: brokerResponse?.valueLabel || option?.label };
}

/**
 * @param {InterviewQuestion} question
 * @param {import('../shared/session/hosted-session.js').HostedSession | undefined} hostedSession
 * @returns {Promise<InterviewAnswer>}
 */
async function askOther(question, hostedSession) {
    const followUpPrompt = `Please specify your answer for: "${question.prompt}"`;
    const otherResponse = await askBrokered(hostedSession, {
        type: RuntimeInteractionTypes.TEXT,
        prompt: followUpPrompt,
        allowEmpty: false,
        _meta: { source: "user_interview", questionType: question.type, questionId: question.id, other: true },
    });
    const otherFailure = brokerFailureToAnswer(otherResponse, question);
    if (otherFailure) return otherFailure;
    const otherText = String(otherResponse.value ?? "");
    if (otherText === null) return { canceled: true };
    const normalized = otherText.trim();
    if (!normalized) {
        return {
            error: {
                code: "EMPTY_ANSWER",
                message: "The 'Other' answer cannot be empty.",
                questionId: question.id,
            },
        };
    }
    return { value: OTHER_VALUE, valueLabel: "Other", otherText: normalized };
}

/**
 * @param {InterviewQuestion} question
 * @param {import('../shared/session/hosted-session.js').HostedSession | undefined} hostedSession
 * @returns {Promise<InterviewAnswer>}
 */
async function askQuestion(question, hostedSession) {
    if (question.type === "yes_no") {
        const options = [
            { value: "yes", label: question.default === true ? "Yes (recommended)" : "Yes" },
            { value: "no", label: question.default === false ? "No (recommended)" : "No" },
            { value: OTHER_VALUE, label: "Other" },
        ];
        const selected = await askSelect(question, options, hostedSession, {
            defaultValue: typeof question.default === "boolean" ? (question.default ? "yes" : "no") : undefined,
        });
        const selectedAnswer = /** @type {any} */ (selected);
        if (selectedAnswer.canceled || selectedAnswer.error) return selected;
        if (selectedAnswer.value === OTHER_VALUE) return await askOther(question, hostedSession);
        if (selectedAnswer.value !== "yes" && selectedAnswer.value !== "no") {
            return {
                error: {
                    code: "INVALID_ANSWER",
                    message: `Unexpected yes/no response: ${selectedAnswer.value}`,
                    questionId: question.id,
                },
            };
        }
        return { value: selectedAnswer.value === "yes", valueLabel: String(selectedAnswer.value) };
    }

    if (question.type === "multiple_choice") {
        const options = /** @type {Array<{ value: string, label: string }>} */ (
            question.choices.map((/** @type {{ value: string, label?: string }} */ choice) => ({
                value: choice.value,
                label: choice.value === question.default
                    ? withRecommendedSuffix(choice.label || choice.value)
                    : (choice.label || choice.value),
            }))
        );
        options.push({ value: OTHER_VALUE, label: "Other" });
        const selected = await askSelect(question, options, hostedSession, { defaultValue: question.default });
        const selectedAnswer = /** @type {any} */ (selected);
        if (selectedAnswer.canceled || selectedAnswer.error) return selected;
        if (selectedAnswer.value === OTHER_VALUE) return await askOther(question, hostedSession);
        const selectedOption = options.find((/** @type {{ value: string }} */ opt) =>
            opt.value === selectedAnswer.value
        );
        if (!selectedOption) {
            return {
                error: {
                    code: "INVALID_ANSWER",
                    message: `Selected option does not exist: ${selectedAnswer.value}`,
                    questionId: question.id,
                },
            };
        }
        return { value: String(selectedAnswer.value), valueLabel: selectedOption.label };
    }

    const allowEmpty = question.allowEmpty === true;
    const brokerResponse = await askBrokered(hostedSession, {
        type: RuntimeInteractionTypes.TEXT,
        prompt: question.prompt,
        defaultValue: question.default,
        placeholder: question.placeholder,
        allowEmpty,
        _meta: { source: "user_interview", questionType: question.type, questionId: question.id },
    });
    const brokerFailure = brokerFailureToAnswer(brokerResponse, question);
    if (brokerFailure) return brokerFailure;
    const text = String(brokerResponse.value ?? "");

    if (text === null) return { canceled: true };

    const normalized = allowEmpty ? text : text.trim();
    if (!allowEmpty && !normalized) {
        return {
            error: {
                code: "EMPTY_ANSWER",
                message: "Text answer cannot be empty.",
                questionId: question.id,
            },
        };
    }

    return { value: normalized };
}

/**
 * @param {InterviewResultDetails} details
 * @returns {import('@earendil-works/pi-coding-agent').AgentToolResult<InterviewResultDetails>}
 */
function buildResult(details) {
    const payload = {
        status: details.status,
        canceled: details.canceled,
        completed: details.completed,
        totalQuestions: details.totalQuestions,
        answeredCount: details.answeredCount,
        remainingCount: details.remainingCount,
        canceledAt: details.canceledAt,
        answers: details.answers,
        errors: details.errors || [],
    };

    const content = /** @type {Array<{type: "text", text: string}>} */ ([{
        type: "text",
        text: `${buildResultSummary(details)}\n\ninterview_result_json:\n${JSON.stringify(payload, null, 2)}`,
    }]);

    return {
        content,
        details,
    };
}

/**
 * @param {InterviewResultDetails} details
 */
function buildResultSummary(details) {
    if (details.status === "completed") {
        return `Interview completed: captured ${details.answeredCount}/${details.totalQuestions} answer(s).`;
    }

    if (details.status === "canceled") {
        return `Interview canceled at question ${
            details.canceledAt || "?"
        }: captured ${details.answeredCount}/${details.totalQuestions} answer(s).`;
    }

    const reason = details.errors?.[0]?.message || "unknown error";
    return `Interview ${details.status.replaceAll("_", " ")}: ${reason}`;
}
