/**
 * @module tools/see-image
 * Vision fallback Custom Tool for text-only primary models.
 */

import { Type } from "@earendil-works/pi-ai";
import { completeSimple } from "@earendil-works/pi-ai/compat";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { getModelRegistry } from "../shared/models/model-registry.js";
import { resolveImageRef } from "../shared/session/image-attachments.js";

export const DEFAULT_SEE_IMAGE_PROMPT =
    "Describe this image in detail for a text-only coding agent. Include all visible UI/content, readable text and error messages, relevant layout, controls, highlighted regions, and visual state. If text or details are unclear, say so explicitly.";

const TOOL_PARAMS = Type.Object({
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

/**
 * @param {unknown} content
 * @returns {string}
 */
export function extractAssistantText(content) {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content.map((block) => {
        if (!block || typeof block !== "object") return "";
        const typed = /** @type {{ type?: string, text?: string }} */ (block);
        return typed.type === "text" ? typed.text || "" : "";
    }).filter(Boolean).join("\n").trim();
}

/**
 * @param {{ cwd: string, sessionManager?: import('@earendil-works/pi-coding-agent').SessionManager, fallbackModel: any, modelRegistry?: any, completeSimpleFn?: (model: any, context: any, options?: any) => Promise<any> }} opts
 * @returns {import('@earendil-works/pi-coding-agent').ToolDefinition}
 */
export function createSeeImageTool(opts) {
    const modelRegistry = opts.modelRegistry || getModelRegistry();
    const completeSimpleFn = opts.completeSimpleFn || completeSimple;

    return defineTool({
        name: "see_image",
        label: "see_image",
        description:
            "Inspect an attached/session image or safe project-relative image path using the configured visionFallback.model. Returns a textual description for text-only primary models.",
        parameters: TOOL_PARAMS,
        async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
            try {
                const typedParams = /** @type {{ imageRef: string, question?: string }} */ (params);
                const resolved = await resolveImageRef(typedParams.imageRef, {
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
                const question = typedParams.question?.trim() || DEFAULT_SEE_IMAGE_PROMPT;

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
                return { content: [{ type: "text", text }], details: { ok: true } };
            } catch (error) {
                return {
                    content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
                    details: { ok: false },
                    isError: true,
                };
            }
        },
    });
}
