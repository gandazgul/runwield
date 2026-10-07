/**
 * @module shared/attached/operations
 * The bounded operation contract between an External Agent Host carrier and the
 * Attached Workflow Coordinator: input envelopes, results, limits, and strict parsing.
 *
 * Carriers pass raw JSON. Everything a host sends is checked here before the
 * coordinator reads or writes a record, so the CLI and MCP carriers hold no rules.
 */

import { ROUTING_INTENTS, WORK_KINDS } from "../../constants.js";
import { TRIAGE_COMPLEXITIES, type TriageOutcome, type TriageOutcomeInput } from "../workflow/triage-outcome.ts";

export type AttachedJsonValue = string | number | boolean | null | AttachedJsonValue[] | AttachedJsonObject;
export type AttachedJsonObject = { [key: string]: AttachedJsonValue };

export type AttachedOperationName = "activate" | "submit" | "status";

/** Version of the Triage role and outcome contract the host receives with a Triage action. */
export const ATTACHED_TRIAGE_CONTRACT_VERSION = "runwield.attached.triage/1";

export const MAX_ATTACHED_INPUT_BYTES = 64 * 1024;
const MAX_REQUEST_TEXT_LENGTH = 32 * 1024;
const MAX_SUMMARY_LENGTH = 4 * 1024;
const MAX_SHORT_TEXT_LENGTH = 200;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const TRANSCRIPT_FIELD_PATTERN = /^(transcript|messages|conversation|history|turns|chat|log)s?$/i;
const PATH_FIELD_PATTERN = /(path|paths|dir|directory|cwd|root|file|files|worktree)$/i;

export type AttachedRejectionCode =
    | "invalid_input"
    | "payload_too_large"
    | "unknown_field"
    | "transcript_field"
    | "path_field"
    | "invalid_outcome"
    | "workflow_not_found"
    | "project_moved"
    | "action_superseded"
    | "revision_conflict"
    | "workflow_busy";

export interface AttachedRejection {
    code: AttachedRejectionCode;
    message: string;
    field?: string;
}

/** What the host and its adapter report about themselves. Core adds its own version. */
export interface HostEvidence {
    host: string;
    hostVersion: string;
    adapterVersion: string;
}

export interface RecordedEvidence extends HostEvidence {
    coreVersion: string;
}

export interface AttachedOperationEnvelope<Payload> {
    projectRoot: string;
    operationId: string;
    evidence: HostEvidence;
    payload: Payload;
}

export interface ActivatePayload {
    requestText: string;
    hostRequestId: string;
}

export interface SubmitPayload {
    actionId: string;
    outcome: TriageOutcomeInput;
}

export type ActivateEnvelope = AttachedOperationEnvelope<ActivatePayload>;

export interface SubmitEnvelope extends AttachedOperationEnvelope<SubmitPayload> {
    workflowId: string;
    expectedRevision: number;
}

export interface StatusEnvelope {
    projectRoot: string;
    workflowId: string;
}

export type AttachedWorkflowState = "triaging" | "awaiting_planning" | "closed";

export interface PendingTriageAction {
    actionId: string;
    role: "router";
    contractVersion: string;
}

export type AttachedNextAction =
    | ({ kind: "triage" } & PendingTriageAction)
    | { kind: "plan" }
    | { kind: "return_to_host"; reason: "unsupported_in_preview" };

export interface AttachedWorkflowClosure {
    reason: "unsupported_in_preview";
    routingIntent: string;
}

export interface ProjectMovedRecovery {
    case: "project_moved";
    recordedProjectRoot: string;
    currentProjectRoot: string;
}

export interface AttachedWorkflowView {
    workflowId: string;
    revision: number;
    state: AttachedWorkflowState;
    nextAction: AttachedNextAction;
    triageOutcome: TriageOutcome | null;
    closure: AttachedWorkflowClosure | null;
    recovery: ProjectMovedRecovery | null;
}

export type AttachedOperationResult =
    | { ok: true; operation: AttachedOperationName; workflow: AttachedWorkflowView }
    | { ok: false; operation: AttachedOperationName; rejection: AttachedRejection; workflow?: AttachedWorkflowView };

export type ParsedInput<Envelope> = { ok: true; envelope: Envelope } | { ok: false; rejection: AttachedRejection };

class InputRejection extends Error {
    constructor(readonly rejection: AttachedRejection) {
        super(rejection.message);
    }
}

function reject(code: AttachedRejectionCode, field: string, message: string): never {
    throw new InputRejection({ code, field, message });
}

function rejectUnknownField(field: string): never {
    const key = field.split(".").at(-1) || field;
    if (TRANSCRIPT_FIELD_PATTERN.test(key)) {
        reject(
            "transcript_field",
            field,
            `${field} looks like host conversation content, which RunWield never stores.`,
        );
    }
    if (PATH_FIELD_PATTERN.test(key)) {
        reject("path_field", field, `${field} names a filesystem location; RunWield resolves paths itself.`);
    }
    reject("unknown_field", field, `${field} is not part of this operation.`);
}

function readObject(value: AttachedJsonValue | undefined, field: string, keys: readonly string[]): AttachedJsonObject {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        reject("invalid_input", field, `${field} must be a JSON object.`);
    }
    for (const key of Object.keys(value)) {
        if (!keys.includes(key)) rejectUnknownField(field ? `${field}.${key}` : key);
    }
    return value;
}

function readText(object: AttachedJsonObject, key: string, field: string, maxLength: number): string {
    const value = object[key];
    if (typeof value !== "string" || !value.trim()) {
        reject("invalid_input", field, `${field} must be a non-empty string.`);
    }
    if (value.length > maxLength) reject("payload_too_large", field, `${field} exceeds ${maxLength} characters.`);
    return value;
}

function readOptionalText(object: AttachedJsonObject, key: string, field: string, maxLength: number) {
    return object[key] === undefined ? undefined : readText(object, key, field, maxLength);
}

function readIdentifier(object: AttachedJsonObject, key: string, field: string): string {
    const value = readText(object, key, field, MAX_SHORT_TEXT_LENGTH);
    if (/[/\\]/.test(value) || value.startsWith(".") || value.includes("..")) {
        reject("path_field", field, `${field} must be an identifier, not a path.`);
    }
    if (!IDENTIFIER_PATTERN.test(value)) {
        reject("invalid_input", field, `${field} must be 1-128 letters, digits, '.', '_', ':', or '-'.`);
    }
    return value;
}

function readRevision(object: AttachedJsonObject, key: string): number {
    const value = object[key];
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
        reject("invalid_input", key, `${key} must be a positive integer.`);
    }
    return value;
}

function readEvidence(object: AttachedJsonObject): HostEvidence {
    const evidence = readObject(object.evidence, "evidence", ["host", "hostVersion", "adapterVersion"]);
    return {
        host: readIdentifier(evidence, "host", "evidence.host"),
        hostVersion: readText(evidence, "hostVersion", "evidence.hostVersion", MAX_SHORT_TEXT_LENGTH),
        adapterVersion: readText(evidence, "adapterVersion", "evidence.adapterVersion", MAX_SHORT_TEXT_LENGTH),
    };
}

function readOutcome(value: AttachedJsonValue | undefined): TriageOutcomeInput {
    const field = "payload.outcome";
    const outcome = readObject(value, field, ["routingIntent", "complexity", "summary", "workKind", "sessionName"]);
    return {
        routingIntent: readText(outcome, "routingIntent", `${field}.routingIntent`, MAX_SHORT_TEXT_LENGTH),
        complexity: readText(outcome, "complexity", `${field}.complexity`, MAX_SHORT_TEXT_LENGTH),
        summary: readText(outcome, "summary", `${field}.summary`, MAX_SUMMARY_LENGTH),
        workKind: readOptionalText(outcome, "workKind", `${field}.workKind`, MAX_SHORT_TEXT_LENGTH),
        sessionName: readOptionalText(outcome, "sessionName", `${field}.sessionName`, MAX_SHORT_TEXT_LENGTH),
    };
}

function parse<Envelope>(input: AttachedJsonValue | undefined, read: () => Envelope): ParsedInput<Envelope> {
    if (input === undefined) {
        return { ok: false, rejection: { code: "invalid_input", message: "Input must be one JSON object." } };
    }
    if (new TextEncoder().encode(JSON.stringify(input)).length > MAX_ATTACHED_INPUT_BYTES) {
        return {
            ok: false,
            rejection: { code: "payload_too_large", message: `Input exceeds ${MAX_ATTACHED_INPUT_BYTES} bytes.` },
        };
    }
    try {
        return { ok: true, envelope: read() };
    } catch (error) {
        if (error instanceof InputRejection) return { ok: false, rejection: error.rejection };
        throw error;
    }
}

export function parseActivateInput(projectRoot: string, input: AttachedJsonValue | undefined) {
    return parse(input, (): ActivateEnvelope => {
        const object = readObject(input, "", ["operationId", "evidence", "payload"]);
        const payload = readObject(object.payload, "payload", ["requestText", "hostRequestId"]);
        return {
            projectRoot,
            operationId: readIdentifier(object, "operationId", "operationId"),
            evidence: readEvidence(object),
            payload: {
                requestText: readText(payload, "requestText", "payload.requestText", MAX_REQUEST_TEXT_LENGTH),
                hostRequestId: readIdentifier(payload, "hostRequestId", "payload.hostRequestId"),
            },
        };
    });
}

export function parseSubmitInput(projectRoot: string, input: AttachedJsonValue | undefined) {
    return parse(input, (): SubmitEnvelope => {
        const object = readObject(input, "", ["operationId", "workflowId", "expectedRevision", "evidence", "payload"]);
        const payload = readObject(object.payload, "payload", ["actionId", "outcome"]);
        return {
            projectRoot,
            operationId: readIdentifier(object, "operationId", "operationId"),
            workflowId: readIdentifier(object, "workflowId", "workflowId"),
            expectedRevision: readRevision(object, "expectedRevision"),
            evidence: readEvidence(object),
            payload: {
                actionId: readIdentifier(payload, "actionId", "payload.actionId"),
                outcome: readOutcome(payload.outcome),
            },
        };
    });
}

export function parseStatusInput(projectRoot: string, input: AttachedJsonValue | undefined) {
    return parse(input, (): StatusEnvelope => {
        const object = readObject(input, "", ["workflowId"]);
        return { projectRoot, workflowId: readIdentifier(object, "workflowId", "workflowId") };
    });
}

const IDENTIFIER_SCHEMA = { type: "string", pattern: IDENTIFIER_PATTERN.source };
const EVIDENCE_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["host", "hostVersion", "adapterVersion"],
    properties: {
        host: { ...IDENTIFIER_SCHEMA, description: "External Agent Host identifier, for example claude-code." },
        hostVersion: { type: "string" },
        adapterVersion: { type: "string" },
    },
};

export interface AttachedOperationDescriptor {
    name: AttachedOperationName;
    description: string;
    inputSchema: AttachedJsonObject;
}

/** Host-facing descriptions and JSON Schemas. `parse*Input` above stays the authority. */
export const ATTACHED_OPERATIONS: readonly AttachedOperationDescriptor[] = [
    {
        name: "activate",
        description:
            "Start one Attached Workflow for one explicitly activated user request. Returns the workflow, revision 1, and the pending Triage action.",
        inputSchema: {
            type: "object",
            additionalProperties: false,
            required: ["operationId", "evidence", "payload"],
            properties: {
                operationId: { ...IDENTIFIER_SCHEMA, description: "Unique per operation; a retry reuses it." },
                evidence: EVIDENCE_SCHEMA,
                payload: {
                    type: "object",
                    additionalProperties: false,
                    required: ["requestText", "hostRequestId"],
                    properties: {
                        requestText: { type: "string", maxLength: MAX_REQUEST_TEXT_LENGTH },
                        hostRequestId: IDENTIFIER_SCHEMA,
                    },
                },
            },
        },
    },
    {
        name: "submit",
        description:
            "Submit the Triage outcome for the pending Triage action. Repeating an accepted operationId returns the saved result.",
        inputSchema: {
            type: "object",
            additionalProperties: false,
            required: ["operationId", "workflowId", "expectedRevision", "evidence", "payload"],
            properties: {
                operationId: IDENTIFIER_SCHEMA,
                workflowId: IDENTIFIER_SCHEMA,
                expectedRevision: { type: "integer", minimum: 1 },
                evidence: EVIDENCE_SCHEMA,
                payload: {
                    type: "object",
                    additionalProperties: false,
                    required: ["actionId", "outcome"],
                    properties: {
                        actionId: IDENTIFIER_SCHEMA,
                        outcome: {
                            type: "object",
                            additionalProperties: false,
                            required: ["routingIntent", "complexity", "summary"],
                            properties: {
                                routingIntent: {
                                    type: "string",
                                    enum: ROUTING_INTENTS.filter((intent) => intent !== "FEATURE"),
                                },
                                complexity: { type: "string", enum: [...TRIAGE_COMPLEXITIES] },
                                summary: { type: "string", maxLength: MAX_SUMMARY_LENGTH },
                                workKind: { type: "string", enum: WORK_KINDS },
                                sessionName: { type: "string", maxLength: MAX_SHORT_TEXT_LENGTH },
                            },
                        },
                    },
                },
            },
        },
    },
    {
        name: "status",
        description: "Read the saved state, revision, next action, and recovery information. Changes nothing.",
        inputSchema: {
            type: "object",
            additionalProperties: false,
            required: ["workflowId"],
            properties: { workflowId: IDENTIFIER_SCHEMA },
        },
    },
];
