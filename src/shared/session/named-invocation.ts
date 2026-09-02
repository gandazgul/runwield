import { extractYaml, test as hasFrontMatter } from "@std/front-matter";
import { basename, dirname, join } from "@std/path";
import { AGENTS, getHomeDir, SKILLS_DIR } from "../../constants.js";
import { directoryExists, fileExists } from "../helpers.js";
import { getCustomSetting } from "../settings.js";
import { parseProviderModel } from "../models/model-validation.ts";
import { resolveInstalledPackagePromptResources } from "../package-resources.js";
import { isWorkflowOnlyAgent, loadAgentDef, normalizeAgentInternalName } from "./agents.js";
import { extractBundledSkills } from "./agent-assets.js";
import { getPromptTemplatePaths } from "./session.js";
import type { SessionManager } from "@earendil-works/pi-coding-agent";
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";

export const NAMED_INVOCATION_CUSTOM_TYPE = "runwield.named_invocation";
export const NAMED_INVOCATION_VERSION = 1;

export type NamedInvocationKind = "prompt_template" | "skill";
export type NamedInvocationSource = "local" | "home" | "bundled" | "package" | "external";
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface ImageReference {
    ref?: string;
    path?: string;
    base64?: string;
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

type ParsedMarkdown = {
    attrs: PromptTemplateFrontMatter;
    body: string;
};

type PromptTemplateResource = {
    path: string;
    source: NamedInvocationSource;
    packageSource?: string;
};

type SkillResource = {
    name: string;
    path: string;
    source: NamedInvocationSource;
    raw: string;
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
        const skill = await findSkillResource(options.cwd, skillName);
        if (!skill) return { kind: "ordinary", text: options.text } satisfies OrdinaryInvocation;
        const expandedRequest = expandSkillResource(skill, instructions || undefined);
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

    const template = await findPromptTemplateResource(options.cwd, command);
    if (!template) return { kind: "ordinary", text: options.text } satisfies OrdinaryInvocation;
    const parsedTemplate = await readPromptTemplateForInvocation(template.path, command);
    const agentName = await resolvePromptTemplateAgent(parsedTemplate.agent, command, options.cwd);
    const thinkingLevel = resolveThinkingLevel(parsedTemplate.thinkingLevel, command);
    const model = resolvePromptTemplateModel(parsedTemplate.model, command);
    const expandedRequest = expandPromptTemplateBody(parsedTemplate.body, instructions || undefined);
    const payload = await createPayload({
        kind: "prompt_template",
        compactInvocation: options.text,
        expandedRequest,
        images: options.images || [],
        source: {
            layer: template.source,
            name: command,
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
        name: command,
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

export function namedInvocationImageReferences(
    entry: { type?: string; customType?: string; data?: NamedInvocationPayload },
): ImageReference[] {
    return readNamedInvocationPayload(entry)?.imageReferences.map((image) => ({ ...image })) || [];
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
            ...(image.base64 ? { base64: image.base64 } : {}),
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

async function findPromptTemplateResource(cwd: string, name: string): Promise<PromptTemplateResource | null> {
    if (!isResourceBaseName(name)) return null;
    const layers = getPromptTemplatePaths(cwd).map((path, index) => ({
        dir: path,
        source: index === 0 ? "local" as const : index === 1 ? "home" as const : "bundled" as const,
    }));
    const fileName = `${name}.md`;
    for (const layer of layers) {
        const path = join(layer.dir, fileName);
        if (await fileExists(path)) return { path, source: layer.source };
    }
    const packagePromptResources = await resolveInstalledPackagePromptResources({ cwd }).catch(() => []);
    for (const resource of packagePromptResources) {
        if (basename(resource.path) !== fileName) continue;
        return {
            path: resource.path,
            source: "package",
            ...(resource.metadata?.source ? { packageSource: resource.metadata.source } : {}),
        };
    }
    return null;
}

async function findSkillResource(cwd: string, commandName: string): Promise<SkillResource | null> {
    const extractedBundledDir = await extractBundledSkills();
    const bundledDirs = extractedBundledDir && extractedBundledDir !== SKILLS_DIR
        ? [extractedBundledDir, SKILLS_DIR]
        : [SKILLS_DIR];
    const homeDir = getHomeDir();
    const enableExternalSkills = getCustomSetting("enableExternalSkills", "global") ?? true;
    const layers = [
        { dir: join(cwd, ".wld", "skills"), source: "local" as const },
        ...(homeDir ? [{ dir: join(homeDir, ".wld", "skills"), source: "home" as const }] : []),
        ...bundledDirs.map((dir) => ({ dir, source: "bundled" as const })),
        ...(enableExternalSkills && homeDir
            ? [{ dir: join(homeDir, ".agents", "skills"), source: "external" as const }]
            : []),
    ];
    const seen = new Set<string>();
    for (const layer of layers) {
        if (!(await directoryExists(layer.dir))) continue;
        for await (const entry of Deno.readDir(layer.dir)) {
            if (!entry.isDirectory || seen.has(entry.name)) continue;
            const skillPath = join(layer.dir, entry.name, "SKILL.md");
            if (!(await fileExists(skillPath))) continue;
            seen.add(entry.name);
            const byDirectoryName = entry.name === commandName;
            const raw = await Deno.readTextFile(skillPath);
            const parsed = parseMarkdown(raw);
            const frontMatterName = readOptionalStringField(parsed.attrs.name, "Skill", entry.name, "name") ||
                entry.name;
            if (!byDirectoryName && frontMatterName !== commandName) continue;
            return {
                name: frontMatterName,
                path: skillPath,
                source: layer.source,
                raw,
                body: parsed.body,
            };
        }
    }
    return null;
}

async function readPromptTemplateForInvocation(path: string, templateName: string) {
    let raw = "";
    try {
        raw = await Deno.readTextFile(path);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to read prompt template "${templateName}": ${message}`);
    }
    const parsed = parseMarkdown(raw);
    for (const key of Object.keys(parsed.attrs)) {
        if (!ALLOWED_PROMPT_FRONT_MATTER.has(key)) {
            throw new Error(`Prompt template "${templateName}" has unsupported Front Matter field "${key}".`);
        }
    }
    return {
        agent: readOptionalStringField(parsed.attrs.agent, "Prompt template", templateName, "agent"),
        model: readOptionalStringField(parsed.attrs.model, "Prompt template", templateName, "model"),
        thinkingLevel: readOptionalStringField(
            parsed.attrs.thinkingLevel,
            "Prompt template",
            templateName,
            "thinkingLevel",
        ),
        body: parsed.body,
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

function parseMarkdown(raw: string): ParsedMarkdown {
    if (!hasFrontMatter(raw)) return { attrs: {}, body: raw };
    const parsed = extractYaml(raw) as ParsedMarkdown;
    return { attrs: parsed.attrs || {}, body: parsed.body || "" };
}

function isResourceBaseName(name: string): boolean {
    if (!name || name === "." || name === "..") return false;
    if (name.includes("/") || name.includes("\\")) return false;
    return basename(name) === name;
}

function readOptionalStringField(
    value: PromptTemplateFrontMatterValue | undefined,
    resourceKind: string,
    resourceName: string,
    fieldName: string,
) {
    if (value === undefined) return undefined;
    if (typeof value !== "string") {
        throw new Error(`${resourceKind} "${resourceName}" declares non-string ${fieldName}.`);
    }
    const trimmed = value.trim();
    if (!trimmed) throw new Error(`${resourceKind} "${resourceName}" declares blank ${fieldName}.`);
    return trimmed;
}

function expandPromptTemplateBody(body: string, additionalInstructions: string | undefined) {
    const trimmed = body.trim();
    if (additionalInstructions) return `${trimmed}\n\n${additionalInstructions}`;
    return trimmed;
}

function expandSkillResource(skill: SkillResource, additionalInstructions: string | undefined) {
    const body = skill.body.trim();
    const skillBlock = `<skill name="${skill.name}" location="${skill.path}">\nReferences are relative to ${
        dirname(skill.path)
    }.\n\n${body}\n</skill>`;
    const header = `The user has invoked the "${skill.name}" skill. Follow the instructions below:`;
    const expanded = `${header}\n\n${skillBlock}`;
    if (additionalInstructions) return `${expanded}\n\n${additionalInstructions}`;
    return expanded;
}

async function sha256Hex(text: string) {
    const bytes = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

type AppendableMessage = Parameters<SessionManager["appendMessage"]>[0];
type AppendableUserMessage = Extract<AppendableMessage, { role: "user" }>;

function isUserMessage(message: AppendableMessage): message is AppendableUserMessage {
    return typeof message === "object" && message !== null && "role" in message && message.role === "user";
}

function toCompactUserMessage(
    message: AppendableUserMessage,
    text: string,
): AppendableUserMessage {
    const cloned = structuredClone(message);
    const content = Array.isArray(cloned.content) ? cloned.content : [];
    const nonTextContent = content.filter((block): block is ImageContent => block.type !== "text");
    const textContent: TextContent = { type: "text", text };
    cloned.content = [textContent, ...nonTextContent];
    return cloned;
}
