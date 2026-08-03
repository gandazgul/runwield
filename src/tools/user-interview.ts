/**
 * @module user-interview
 * Structured user interview tool for planning agents.
 */

import { type Static, StringEnum, Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import type { HostedSession } from "../shared/session/hosted-session.js";
import type {
    RuntimeInteractionRequest,
    RuntimeInteractionResponse,
} from "../shared/session/session-runtime-interactions.js";
import {
    requestHostedSessionInteraction,
    RuntimeInteractionOutcomes,
    RuntimeInteractionTypes,
} from "../shared/session/session-runtime-interactions.js";

const OTHER_VALUE = "other";
const RECOMMENDED_SUFFIX_PATTERN = /\s*\(recommended\)\s*$/i;

const QUESTION_ID = Type.String({
    minLength: 1,
    maxLength: 64,
    description: "Optional stable question ID (letters, numbers, underscore, dash).",
});

const YES_NO_QUESTION = Type.Object({
    id: Type.Optional(QUESTION_ID),
    type: StringEnum(["yes_no"]),
    prompt: Type.String({ minLength: 1, maxLength: 400, description: "Question text shown to the user." }),
    default: Type.Optional(Type.Boolean({ description: "Optional recommended default answer." })),
    allowOther: Type.Optional(Type.Boolean({
        description: "Deprecated. 'Other' is always available for yes_no questions.",
    })),
}, { additionalProperties: false });

const TEXT_QUESTION = Type.Object({
    id: Type.Optional(QUESTION_ID),
    type: StringEnum(["text"]),
    prompt: Type.String({ minLength: 1, maxLength: 400, description: "Question text shown to the user." }),
    default: Type.Optional(Type.String({ maxLength: 400, description: "Optional default text answer." })),
    placeholder: Type.Optional(Type.String({ maxLength: 200, description: "Optional prompt hint." })),
    allowEmpty: Type.Optional(Type.Boolean({ description: "Whether empty text answers are allowed." })),
}, { additionalProperties: false });

const MULTIPLE_CHOICE_QUESTION = Type.Object({
    id: Type.Optional(QUESTION_ID),
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

const INTERVIEW_QUESTION = Type.Union([
    YES_NO_QUESTION,
    TEXT_QUESTION,
    MULTIPLE_CHOICE_QUESTION,
]);

const PARAMETERS = Type.Object({
    question: Type.Optional(INTERVIEW_QUESTION),
    questions: Type.Optional(Type.Array(INTERVIEW_QUESTION, {
        minItems: 1,
        maxItems: 3,
        description: "Batch of 1-3 questions asked sequentially.",
    })),
}, { additionalProperties: false });

type InterviewParameters = Static<typeof PARAMETERS>;

interface InterviewError {
    code: string;
    message: string;
    questionIndex?: number;
    questionId?: string;
}

interface InterviewChoice {
    value: string;
    label?: string;
}

interface SelectOption {
    value: string;
    label: string;
}

interface MultipleChoiceQuestionInput {
    id?: string;
    type: string;
    prompt: string;
    choices: InterviewChoice[];
    default?: string | boolean;
    allowOther?: boolean;
}

interface YesNoQuestionInput {
    id?: string;
    type: string;
    prompt: string;
    default?: string | boolean;
    allowOther?: boolean;
}

interface TextQuestionInput {
    id?: string;
    type: string;
    prompt: string;
    default?: string | boolean;
    placeholder?: string;
    allowEmpty?: boolean;
}

interface YesNoInterviewQuestion {
    id?: string;
    type: "yes_no";
    prompt: string;
    default?: boolean;
    allowOther?: boolean;
}

interface TextInterviewQuestion {
    id?: string;
    type: "text";
    prompt: string;
    default?: string;
    placeholder?: string;
    allowEmpty?: boolean;
}

interface MultipleChoiceInterviewQuestion {
    id?: string;
    type: "multiple_choice";
    prompt: string;
    choices: InterviewChoice[];
    default?: string;
    allowOther?: boolean;
}

type InterviewQuestion = YesNoInterviewQuestion | TextInterviewQuestion | MultipleChoiceInterviewQuestion;
type InterviewAnswerValue = boolean | string;
type InterviewStatus = "completed" | "canceled" | "invalid_request" | "validation_error";

interface InterviewResultAnswer {
    index: number;
    id?: string;
    type: InterviewQuestion["type"];
    prompt: string;
    value: InterviewAnswerValue;
    valueLabel?: string;
    otherText?: string;
}

export interface InterviewResultDetails {
    status: InterviewStatus;
    canceled: boolean;
    completed: boolean;
    totalQuestions: number;
    answeredCount: number;
    remainingCount: number;
    canceledAt?: number;
    answers: InterviewResultAnswer[];
    errors?: InterviewError[];
}

type InterviewAnswer =
    | { canceled: true }
    | { error: InterviewError }
    | { value: InterviewAnswerValue; valueLabel?: string; otherText?: string };

type NormalizeBatchResult =
    | { ok: true; questions: InterviewQuestion[] }
    | { ok: false; questions: InterviewQuestion[]; error: string };

type UserInterviewResult = AgentToolResult<InterviewResultDetails>;

interface UserInterviewToolOptions {
    hostedSession?: HostedSession;
}

function toInterviewQuestion(question: Static<typeof INTERVIEW_QUESTION>): InterviewQuestion {
    if (question.type === "multiple_choice") {
        const multipleChoiceQuestion = question as MultipleChoiceQuestionInput;
        return {
            id: multipleChoiceQuestion.id,
            type: "multiple_choice",
            prompt: multipleChoiceQuestion.prompt,
            choices: multipleChoiceQuestion.choices.map((choice: InterviewChoice) => ({
                value: choice.value,
                label: choice.label,
            })),
            default: typeof multipleChoiceQuestion.default === "string" ? multipleChoiceQuestion.default : undefined,
            allowOther: multipleChoiceQuestion.allowOther,
        };
    }
    if (question.type === "yes_no") {
        const yesNoQuestion = question as YesNoQuestionInput;
        return {
            id: yesNoQuestion.id,
            type: "yes_no",
            prompt: yesNoQuestion.prompt,
            default: typeof yesNoQuestion.default === "boolean" ? yesNoQuestion.default : undefined,
            allowOther: yesNoQuestion.allowOther,
        };
    }
    const textQuestion = question as TextQuestionInput;
    return {
        id: textQuestion.id,
        type: "text",
        prompt: textQuestion.prompt,
        default: typeof textQuestion.default === "string" ? textQuestion.default : undefined,
        placeholder: textQuestion.placeholder,
        allowEmpty: textQuestion.allowEmpty,
    };
}

export function createUserInterviewTool(opts: UserInterviewToolOptions = {}) {
    const hostedSession = opts.hostedSession;
    return defineTool<typeof PARAMETERS, InterviewResultDetails>({
        name: "user_interview",
        label: "User Interview",
        description:
            "Ask the user 1-3 structured clarification questions (yes_no, text, multiple_choice) and receive ordered answers. Yes/no and multiple-choice always include an 'Other' option with free-text follow-up.",
        promptSnippet:
            "user_interview(question|questions): Ask one or a small 1-3 question batch before finalizing planning decisions. Yes/no and multiple_choice always include an Other option for open-ended input.",
        parameters: PARAMETERS,
        async execute(_toolCallId, params): Promise<UserInterviewResult> {
            const normalized = normalizeBatch(params);
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

            const answers: InterviewResultDetails["answers"] = [];

            for (let i = 0; i < questions.length; i++) {
                const question = questions[i];
                const answer = await askQuestion(question, hostedSession);

                if ("canceled" in answer) {
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

                if ("error" in answer) {
                    return buildResult({
                        status: "validation_error",
                        canceled: false,
                        completed: false,
                        totalQuestions: questions.length,
                        answeredCount: answers.length,
                        remainingCount: questions.length - answers.length,
                        answers,
                        errors: [answer.error],
                    });
                }

                answers.push({
                    index: i + 1,
                    id: question.id,
                    type: question.type,
                    prompt: question.prompt,
                    value: answer.value,
                    valueLabel: answer.valueLabel,
                    otherText: answer.otherText,
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

function normalizeBatch(params: InterviewParameters): NormalizeBatchResult {
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

    const questionInputs = hasQuestion && params.question ? [params.question] : params.questions;
    if (!Array.isArray(questionInputs) || questionInputs.length < 1 || questionInputs.length > 3) {
        return { ok: false, questions: [], error: "Invalid batch size. Ask 1 to 3 questions per tool call." };
    }

    return { ok: true, questions: questionInputs.map(toInterviewQuestion) };
}

function validateBatch(questions: InterviewQuestion[]): InterviewError[] {
    const errors: InterviewError[] = [];
    const ids = new Set<string>();

    for (let i = 0; i < questions.length; i++) {
        const question = questions[i];
        const idx = i + 1;

        if (question.id) {
            if (!/^[a-zA-Z0-9_-]+$/.test(question.id)) {
                errors.push({
                    code: "INVALID_ID",
                    message: "Question ID must use letters, numbers, underscore, or dash.",
                    questionIndex: idx,
                    questionId: question.id,
                });
            }
            if (ids.has(question.id)) {
                errors.push({
                    code: "DUPLICATE_ID",
                    message: `Duplicate question ID: ${question.id}`,
                    questionIndex: idx,
                    questionId: question.id,
                });
            }
            ids.add(question.id);
        }

        if (typeof question.prompt !== "string" || !question.prompt.trim()) {
            errors.push({
                code: "EMPTY_PROMPT",
                message: "Question prompt cannot be empty.",
                questionIndex: idx,
                questionId: question.id,
            });
        }

        if (question.type === "multiple_choice") {
            if (!Array.isArray(question.choices) || question.choices.length < 2) {
                errors.push({
                    code: "INVALID_CHOICES",
                    message: "Multiple-choice question requires at least 2 choices.",
                    questionIndex: idx,
                    questionId: question.id,
                });
                continue;
            }

            const values = new Set<string>();
            for (const choice of question.choices) {
                const value = String(choice.value || "").trim();
                if (!value) {
                    errors.push({
                        code: "EMPTY_CHOICE_VALUE",
                        message: "Choice value cannot be empty.",
                        questionIndex: idx,
                        questionId: question.id,
                    });
                }
                if (values.has(value)) {
                    errors.push({
                        code: "DUPLICATE_CHOICE_VALUE",
                        message: `Duplicate choice value in question ${idx}: ${value}`,
                        questionIndex: idx,
                        questionId: question.id,
                    });
                }
                values.add(value);
            }

            if (values.has(OTHER_VALUE)) {
                errors.push({
                    code: "SENTINEL_COLLISION",
                    message: `The value "${OTHER_VALUE}" is reserved and cannot be used as a choice value.`,
                    questionIndex: idx,
                    questionId: question.id,
                });
            }

            if (question.default && !values.has(String(question.default).trim())) {
                errors.push({
                    code: "DEFAULT_NOT_IN_CHOICES",
                    message: `Default value "${question.default}" is not present in choices.`,
                    questionIndex: idx,
                    questionId: question.id,
                });
            }
        }
    }

    return errors;
}

async function askBrokered(
    hostedSession: HostedSession | undefined,
    request: RuntimeInteractionRequest,
): Promise<RuntimeInteractionResponse> {
    if (!hostedSession) {
        return {
            outcome: RuntimeInteractionOutcomes.UNSUPPORTED,
            message: "No hosted session is available for this interview prompt.",
        };
    }
    return await requestHostedSessionInteraction(hostedSession, request);
}

function withRecommendedSuffix(label: string): string {
    return RECOMMENDED_SUFFIX_PATTERN.test(label) ? label.trim() : `${label} (recommended)`;
}

function brokerFailureToAnswer(
    response: RuntimeInteractionResponse,
    question: InterviewQuestion,
): InterviewAnswer | null {
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

async function askSelect(
    question: InterviewQuestion,
    options: SelectOption[],
    hostedSession: HostedSession | undefined,
    extra: { defaultValue?: string } = {},
): Promise<InterviewAnswer> {
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
    return { value: String(selected), valueLabel: brokerResponse.valueLabel || option?.label };
}

async function askOther(
    question: InterviewQuestion,
    hostedSession: HostedSession | undefined,
): Promise<InterviewAnswer> {
    const followUpPrompt = `Please specify your answer for: "${question.prompt}"`;
    const otherResponse = await askBrokered(hostedSession, {
        type: RuntimeInteractionTypes.TEXT,
        prompt: followUpPrompt,
        placeholder: "Esc returns to the choice list",
        allowEmpty: false,
        _meta: { source: "user_interview", questionType: question.type, questionId: question.id, other: true },
    });
    const otherFailure = brokerFailureToAnswer(otherResponse, question);
    if (otherFailure) return otherFailure;
    const otherText = String(otherResponse.value ?? "");
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

async function askQuestion(
    question: InterviewQuestion,
    hostedSession: HostedSession | undefined,
): Promise<InterviewAnswer> {
    if (question.type === "yes_no") {
        const options: SelectOption[] = [
            { value: "yes", label: question.default === true ? "Yes (recommended)" : "Yes" },
            { value: "no", label: question.default === false ? "No (recommended)" : "No" },
            { value: OTHER_VALUE, label: "Other" },
        ];
        while (true) {
            const selected = await askSelect(question, options, hostedSession, {
                defaultValue: typeof question.default === "boolean" ? (question.default ? "yes" : "no") : undefined,
            });
            if ("canceled" in selected || "error" in selected) return selected;
            if (selected.value === OTHER_VALUE) {
                const otherAnswer = await askOther(question, hostedSession);
                if ("canceled" in otherAnswer) continue;
                return otherAnswer;
            }
            if (selected.value !== "yes" && selected.value !== "no") {
                return {
                    error: {
                        code: "INVALID_ANSWER",
                        message: `Unexpected yes/no response: ${selected.value}`,
                        questionId: question.id,
                    },
                };
            }
            return { value: selected.value === "yes", valueLabel: String(selected.value) };
        }
    }

    if (question.type === "multiple_choice") {
        const options: SelectOption[] = question.choices.map((choice) => ({
            value: choice.value,
            label: choice.value === question.default
                ? withRecommendedSuffix(choice.label || choice.value)
                : (choice.label || choice.value),
        }));
        options.push({ value: OTHER_VALUE, label: "Other" });
        while (true) {
            const selected = await askSelect(question, options, hostedSession, { defaultValue: question.default });
            if ("canceled" in selected || "error" in selected) return selected;
            if (selected.value === OTHER_VALUE) {
                const otherAnswer = await askOther(question, hostedSession);
                if ("canceled" in otherAnswer) continue;
                return otherAnswer;
            }
            const selectedOption = options.find((opt) => opt.value === selected.value);
            if (!selectedOption) {
                return {
                    error: {
                        code: "INVALID_ANSWER",
                        message: `Selected option does not exist: ${selected.value}`,
                        questionId: question.id,
                    },
                };
            }
            return { value: String(selected.value), valueLabel: selectedOption.label };
        }
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

function buildResult(details: InterviewResultDetails): UserInterviewResult {
    const payload: InterviewResultDetails = {
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

    return {
        content: [{
            type: "text",
            text: `${buildResultSummary(details)}\n\ninterview_result_json:\n${JSON.stringify(payload, null, 2)}`,
        }],
        details,
    };
}

function buildResultSummary(details: InterviewResultDetails): string {
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
