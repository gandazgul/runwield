import { extractYaml, test as hasFrontMatter } from "@std/front-matter";
import { AGENTS } from "../../constants.js";
import { parseProviderModel } from "../models/model-validation.ts";
import { isWorkflowOnlyAgent, loadAgentDef, normalizeAgentInternalName } from "./agents.js";
import { expandPromptTemplate, expandSkillCommand, listPromptTemplates, listSkills } from "./session.js";
import type { SessionManager } from "@earendil-works/pi-coding-agent";

export const NAMED_INVOCATION_CUSTOM_TYPE = "runwield.named_invocation";
export const NAMED_INVOCATION_VERSION = 1;

export type NamedInvocationKind = "prompt_template" | "skill";
export type NamedInvocationSource = "local" | "home" | "bundled" | "package" | "external";
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface ImageReference {
    ref?: string;
    path?: string;
    mimeType?: string;
}

export interface NamedInvocationProfile {
    agentName?: string;
    model?: string;
    thinkingLevel?: ThinkingLevel;
}

export interface NamedInvocationPayload {
    version: 1;
    kind: NamedInvocationKind;
    compactInvocation: string;
    expandedRequest: string;
    imageReferences: ImageReference[];
    source: {
        layer: NamedInvocationSource;
        name: string;
        packageSource?: string;
    };
    expansionDigest: string;
    profile: NamedInvocationProfile;
}

export interface OrdinaryInvocation {
    kind: "ordinary";
    text: string;
}

export interface SkillInvocation {
    kind: "skill";
    name: string;
    additionalInstructions: string;
    expandedRequest: string;
    payload: NamedInvocationPayload;
}

export interface PromptTemplateInvocation {
    kind: "prompt_template";
    name: string;
    additionalInstructions: string;
    expandedRequest: string;
    agentName: string;
    model?: string;
    thinkingLevel?: ThinkingLevel;
    payload: NamedInvocationPayload;
}

export type ResolvedNamedInvocation = OrdinaryInvocation | SkillInvocation | PromptTemplateInvocation;

type PromptTemplateFrontMatterValue = string | number | boolean | string[] | null;
type PromptTemplateFrontMatter = Partial<Record<string, PromptTemplateFrontMatterValue>>;

type ParsedPromptTemplate = {
    attrs: PromptTemplateFrontMatter;
    body: string;
};

const ALLOWED_PROMPT_FRONT_MATTER = new Set([
    "description",
    "argument-hint",
    "model",
    "agent",
    "thinkingLevel",
]);

const THINKING_LEVELS = new Set<ThinkingLevel>(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

export function extractInvocationCommand(text: string): { command: string; instructions: string } | null {
    if (!text.startsWith("/")) return null;
    const withoutSlash = text.slice(1);
    const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(withoutSlash);
    if (!match) return null;
    return {
        command: match[1].trim(),
        instructions: (match[2] || "").trim(),
    };
}

export async function resolveNamedInvocation(options: { cwd: string; text: string; images?: ImageReference[] }) {
    const parsedCommand = extractInvocationCommand(options.text);
    if (!parsedCommand) return { kind: "ordinary", text: options.text } satisfies OrdinaryInvocation;

    const { command, instructions } = parsedCommand;
    if (command.startsWith("skill:")) {
        const skillName = command.slice("skill:".length).trim();
        if (!skillName) return { kind: "ordinary", text: options.text } satisfies OrdinaryInvocation;
        const skills = await listSkills({ cwd: options.cwd });
        const skill = skills.find((candidate) => candidate.name === skillName);
        if (!skill) return { kind: "ordinary", text: options.text } satisfies OrdinaryInvocation;
        const expandedRequest = await expandSkillCommand(skill.name, instructions || undefined, options.cwd);
        const payload = await createPayload({
            kind: "skill",
            compactInvocation: options.text,
            expandedRequest,
            images: options.images || [],
            source: {
                layer: skill.source,
                name: skill.name,
            },
            profile: {},
        });
        return {
            kind: "skill",
            name: skill.name,
            additionalInstructions: instructions,
            expandedRequest,
            payload,
        } satisfies SkillInvocation;
    }

    const templates = await listPromptTemplates({ cwd: options.cwd });
    const template = templates.find((candidate) => candidate.name === command);
    if (!template) return { kind: "ordinary", text: options.text } satisfies OrdinaryInvocation;
    const parsedTemplate = await readPromptTemplateForInvocation(template.path, template.name);
    const agentName = await resolvePromptTemplateAgent(parsedTemplate.agent, template.name, options.cwd);
    const thinkingLevel = resolveThinkingLevel(parsedTemplate.thinkingLevel, template.name);
    const model = resolvePromptTemplateModel(parsedTemplate.model, template.name);
    const expandedRequest = await expandPromptTemplate(template.path, instructions || undefined);
    const payload = await createPayload({
        kind: "prompt_template",
        compactInvocation: options.text,
        expandedRequest,
        images: options.images || [],
        source: {
            layer: template.source,
            name: template.name,
            ...(template.packageSource ? { packageSource: template.packageSource } : {}),
        },
        profile: {
            agentName,
            ...(model ? { model } : {}),
            ...(thinkingLevel ? { thinkingLevel } : {}),
        },
    });
    return {
        kind: "prompt_template",
        name: template.name,
        additionalInstructions: instructions,
        expandedRequest,
        agentName,
        ...(model ? { model } : {}),
        ...(thinkingLevel ? { thinkingLevel } : {}),
        payload,
    } satisfies PromptTemplateInvocation;
}

export function isNamedInvocationEntry(entry: { type?: string; customType?: string }): boolean {
    return entry.type === "custom" && entry.customType === NAMED_INVOCATION_CUSTOM_TYPE;
}

export function readNamedInvocationPayload(
    entry: { type?: string; customType?: string; data?: NamedInvocationPayload },
): NamedInvocationPayload | null {
    if (!isNamedInvocationEntry(entry)) return null;
    if (!entry.data || entry.data.version !== NAMED_INVOCATION_VERSION) return null;
    return entry.data;
}

export function namedInvocationDisplayText(
    entry: { type?: string; customType?: string; data?: NamedInvocationPayload },
) {
    return readNamedInvocationPayload(entry)?.compactInvocation || "";
}

export function namedInvocationExpandedText(
    entry: { type?: string; customType?: string; data?: NamedInvocationPayload },
) {
    return readNamedInvocationPayload(entry)?.expandedRequest || "";
}

export async function createPayload(options: {
    kind: NamedInvocationKind;
    compactInvocation: string;
    expandedRequest: string;
    images: ImageReference[];
    source: { layer: NamedInvocationSource; name: string; packageSource?: string };
    profile: NamedInvocationProfile;
}): Promise<NamedInvocationPayload> {
    return {
        version: NAMED_INVOCATION_VERSION,
        kind: options.kind,
        compactInvocation: options.compactInvocation,
        expandedRequest: options.expandedRequest,
        imageReferences: options.images.map((image) => ({
            ...(image.ref ? { ref: image.ref } : {}),
            ...(image.path ? { path: image.path } : {}),
            ...(image.mimeType ? { mimeType: image.mimeType } : {}),
        })),
        source: options.source,
        expansionDigest: await sha256Hex(options.expandedRequest),
        profile: options.profile,
    };
}

export function appendNamedInvocationEntry(sessionManager: SessionManager, payload: NamedInvocationPayload): void {
    sessionManager.appendCustomEntry(NAMED_INVOCATION_CUSTOM_TYPE, payload);
}

export async function withNamedInvocationDisplayMessage<T>(
    sessionManager: SessionManager,
    payload: NamedInvocationPayload,
    body: () => Promise<T>,
    options: { persistModelChange?: boolean } = {},
): Promise<T> {
    const originalAppendMessage = sessionManager.appendMessage.bind(sessionManager);
    const modelWritableManager = sessionManager as SessionManager & {
        appendModelChange: (provider: string, modelId: string) => string;
    };
    const originalAppendModelChange = modelWritableManager.appendModelChange.bind(modelWritableManager);
    if (options.persistModelChange === false) {
        modelWritableManager.appendModelChange = () => "";
    }
    let captured = false;
    sessionManager.appendMessage = ((message: Parameters<SessionManager["appendMessage"]>[0]) => {
        if (!captured && isUserMessage(message)) {
            captured = true;
            appendNamedInvocationEntry(sessionManager, payload);
            return originalAppendMessage(toCompactUserMessage(message, payload.compactInvocation));
        }
        return originalAppendMessage(message);
    }) as SessionManager["appendMessage"];
    try {
        return await body();
    } finally {
        sessionManager.appendMessage = originalAppendMessage;
        modelWritableManager.appendModelChange = originalAppendModelChange;
    }
}

async function readPromptTemplateForInvocation(path: string, templateName: string) {
    let raw = "";
    try {
        raw = await Deno.readTextFile(path);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to read prompt template "${templateName}": ${message}`);
    }
    let attrs: PromptTemplateFrontMatter = {};
    if (hasFrontMatter(raw)) {
        const parsed = extractYaml(raw) as ParsedPromptTemplate;
        attrs = parsed.attrs || {};
    }
    for (const key of Object.keys(attrs)) {
        if (!ALLOWED_PROMPT_FRONT_MATTER.has(key)) {
            throw new Error(`Prompt template "${templateName}" has unsupported Front Matter field "${key}".`);
        }
    }
    return {
        agent: stringField(attrs.agent),
        model: stringField(attrs.model),
        thinkingLevel: stringField(attrs.thinkingLevel),
    };
}

async function resolvePromptTemplateAgent(agentField: string | undefined, templateName: string, cwd: string) {
    const rawAgent = agentField || AGENTS.OPERATOR;
    let agentName = "";
    try {
        agentName = normalizeAgentInternalName(rawAgent);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Prompt template "${templateName}" declares invalid agent "${rawAgent}": ${message}`);
    }
    if (await isWorkflowOnlyAgent(agentName, cwd)) {
        throw new Error(`Prompt template "${templateName}" declares workflow-only agent "${agentName}".`);
    }
    try {
        await loadAgentDef(agentName, cwd);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Prompt template "${templateName}" declares unknown agent "${agentName}": ${message}`);
    }
    return agentName;
}

function resolvePromptTemplateModel(modelField: string | undefined, templateName: string) {
    if (!modelField) return undefined;
    if (!parseProviderModel(modelField).ok) {
        throw new Error(`Prompt template "${templateName}" declares invalid model "${modelField}". Use provider/id.`);
    }
    return modelField;
}

function resolveThinkingLevel(value: string | undefined, templateName: string): ThinkingLevel | undefined {
    if (!value) return undefined;
    if (!THINKING_LEVELS.has(value as ThinkingLevel)) {
        throw new Error(`Prompt template "${templateName}" declares invalid thinkingLevel "${value}".`);
    }
    return value as ThinkingLevel;
}

function stringField(value: PromptTemplateFrontMatterValue | undefined) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function sha256Hex(text: string) {
    const bytes = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isUserMessage(message: Parameters<SessionManager["appendMessage"]>[0]) {
    return typeof message === "object" && message !== null && "role" in message && message.role === "user";
}

function toCompactUserMessage(
    message: Parameters<SessionManager["appendMessage"]>[0],
    text: string,
): Parameters<SessionManager["appendMessage"]>[0] {
    const cloned = structuredClone(message);
    if (typeof cloned === "object" && cloned !== null && "content" in cloned) {
        cloned.content = [{ type: "text", text }];
    }
    return cloned;
}
