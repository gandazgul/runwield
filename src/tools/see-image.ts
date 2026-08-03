/**
 * @module tools/see-image
 * Vision fallback Custom Tool for text-only primary models.
 */

import { Type } from "@earendil-works/pi-ai";
import { completeSimple } from "@earendil-works/pi-ai/compat";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { AgentToolResult, SessionManager } from "@earendil-works/pi-coding-agent";
import { getModelRegistry } from "../shared/models/model-registry.js";
import { resolveImageRef } from "../shared/session/image-attachments.js";

export const DEFAULT_SEE_IMAGE_PROMPT =
    "Describe this image in detail for a text-only coding agent. Include all visible UI/content, readable text and error messages, relevant layout, controls, highlighted regions, and visual state. If text or details are unclear, say so explicitly.";

const PARAMETERS = Type.Object({
    imageRef: Type.String({
        minLength: 1,
        description:
            "Image reference to inspect. Use attachment:<uuid> for pasted session images, or a safe project-relative image path.",
    }),
    question: Type.Optional(Type.String({
        minLength: 1,
        maxLength: 2000,
        description: "Optional focused question about the image. Defaults to a detailed general description request.",
    })),
}, { additionalProperties: false });

interface TextContentBlock {
    type?: string;
    text?: string;
    data?: string;
    mimeType?: string;
}

type AssistantContent = string | TextContentBlock[] | null | undefined;
interface VisionModel {
    provider: string;
    id: string;
    input?: string[];
}

interface VisionAuthSuccess {
    ok: true;
    apiKey?: string;
    headers?: Record<string, string>;
    env?: Record<string, string>;
}

interface VisionAuthFailure {
    ok: false;
    error?: string;
}

type VisionAuth = VisionAuthSuccess | VisionAuthFailure;

interface VisionModelRegistry {
    getApiKeyAndHeaders(model: VisionModel): Promise<VisionAuth>;
}

interface VisionMessageContent {
    type: "text" | "image";
    text?: string;
    data?: string;
    mimeType?: string;
}

interface VisionMessage {
    role: "user";
    content: VisionMessageContent[];
    timestamp: number;
}

interface VisionContext {
    messages: VisionMessage[];
}

interface VisionOptions {
    signal?: AbortSignal;
    apiKey?: string;
    headers?: Record<string, string>;
    env?: Record<string, string>;
    maxTokens: number;
}

interface VisionResponse {
    content?: AssistantContent;
    stopReason?: string;
    errorMessage?: string;
}

type CompleteSimpleFunction = (model: VisionModel, context: VisionContext, options?: VisionOptions) => Promise<VisionResponse>;

interface SeeImageToolOptions {
    cwd: string;
    sessionManager?: SessionManager;
    fallbackModel: VisionModel;
    modelRegistry?: VisionModelRegistry;
    completeSimpleFn?: CompleteSimpleFunction;
}

interface SeeImageDetails {
    ok: boolean;
}

type SeeImageResult = AgentToolResult<SeeImageDetails> & { isError?: boolean };

export function extractAssistantText(content: AssistantContent): string {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content.map((block) => block.type === "text" ? block.text || "" : "").filter(Boolean).join("\n").trim();
}

export function createSeeImageTool(opts: SeeImageToolOptions) {
    const modelRegistry = opts.modelRegistry || getModelRegistry();
    const completeSimpleFn: CompleteSimpleFunction = opts.completeSimpleFn || ((model, context, options) =>
        completeSimple(
            model as Parameters<typeof completeSimple>[0],
            context as Parameters<typeof completeSimple>[1],
            options as Parameters<typeof completeSimple>[2],
        ) as Promise<VisionResponse>);

    return defineTool<typeof PARAMETERS, SeeImageDetails>({
        name: "see_image",
        label: "see_image",
        description:
            "Inspect an image only using the configured visionFallback.model. imageRef must be an attachment:<uuid> reference or a safe project-relative .png, .jpg, .jpeg, .gif, or .webp path. This tool cannot inspect documents, source files, or other non-image files; use the appropriate file-reading tool instead. Returns a textual description for text-only primary models.",
        parameters: PARAMETERS,
        async execute(_toolCallId, params, signal, _onUpdate, _ctx): Promise<SeeImageResult> {
            try {
                const resolved = await resolveImageRef(params.imageRef, {
                    cwd: opts.cwd,
                    sessionManager: opts.sessionManager,
                });
                const auth = await modelRegistry.getApiKeyAndHeaders(opts.fallbackModel);
                if (!auth.ok) throw new Error(auth.error || "Unable to resolve auth for visionFallback.model.");
                if (!auth.apiKey && !auth.headers) {
                    throw new Error(
                        `No API key configured for visionFallback.model: ${opts.fallbackModel.provider}/${opts.fallbackModel.id}`,
                    );
                }

                const bytes = await Deno.readFile(resolved.path);
                let binary = "";
                for (const byte of bytes) binary += String.fromCharCode(byte);
                const base64 = btoa(binary);
                const question = params.question?.trim() || DEFAULT_SEE_IMAGE_PROMPT;

                const response = await completeSimpleFn(opts.fallbackModel, {
                    messages: [{
                        role: "user",
                        content: [
                            { type: "text", text: question },
                            { type: "image", data: base64, mimeType: resolved.mimeType },
                        ],
                        timestamp: Date.now(),
                    }],
                }, {
                    signal,
                    apiKey: auth.apiKey,
                    headers: auth.headers,
                    env: auth.env,
                    maxTokens: 2048,
                });

                if (response.stopReason === "error") {
                    throw new Error(response.errorMessage || "visionFallback.model returned an error.");
                }

                const text = extractAssistantText(response.content) || "(visionFallback.model returned no text)";
                return { content: [{ type: "text" as const, text }], details: { ok: true } };
            } catch (error) {
                return {
                    content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
                    details: { ok: false },
                    isError: true,
                };
            }
        },
    });
}
