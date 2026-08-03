import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { withProcessGlobalTestLock } from "../testing/process-global-lock.js";
import { persistImageAttachment } from "../shared/session/image-attachments.js";
import { createSeeImageTool, DEFAULT_SEE_IMAGE_PROMPT, extractAssistantText } from "./see-image.ts";

Deno.test("extractAssistantText joins text blocks", () => {
    assertEquals(
        extractAssistantText([{ type: "text", text: "one" }, { type: "image", data: "x" }, {
            type: "text",
            text: "two",
        }]),
        "one\ntwo",
    );
});

Deno.test("see_image invokes fallback model with local image and default prompt", async () => {
    const cwd = await Deno.makeTempDir({ prefix: "runwield-see-image-" });
    try {
        await Deno.writeFile(join(cwd, "shot.png"), new Uint8Array([1, 2, 3]));
        /** @type {any[]} */
        const calls = [];
        const fallbackModel = { provider: "vision", id: "model", input: ["text", "image"] };
        const tool = /** @type {any} */ (createSeeImageTool({
            cwd,
            fallbackModel,
            modelRegistry: {
                getApiKeyAndHeaders: () =>
                    Promise.resolve({ ok: true, apiKey: "key", headers: { a: "b" }, env: { X: "Y" } }),
            },
            completeSimpleFn: (model, context, options) => {
                calls.push({ model, context, options });
                return Promise.resolve({
                    role: "assistant",
                    api: "openai-completions",
                    provider: "vision",
                    model: "model",
                    content: [{ type: "text", text: "description" }],
                    stopReason: "stop",
                    usage: {},
                    timestamp: Date.now(),
                });
            },
        }));

        const result = await tool.execute("1", { imageRef: "shot.png" }, undefined, undefined, {});

        assertEquals(result.content, [{ type: "text", text: "description" }]);
        assertEquals(calls.length, 1);
        assertEquals(calls[0].context.messages[0].content[0].text, DEFAULT_SEE_IMAGE_PROMPT);
        assertEquals(calls[0].context.messages[0].content[1].mimeType, "image/png");
        assertEquals(calls[0].options.apiKey, "key");
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("see_image returns tool error on auth failure", async () => {
    const cwd = await Deno.makeTempDir({ prefix: "runwield-see-image-" });
    try {
        await Deno.writeFile(join(cwd, "shot.png"), new Uint8Array([1]));
        const tool = /** @type {any} */ (createSeeImageTool({
            cwd,
            fallbackModel: { provider: "vision", id: "model" },
            modelRegistry: { getApiKeyAndHeaders: () => Promise.resolve({ ok: false, error: "no auth" }) },
            completeSimpleFn: () => Promise.reject(new Error("should not call")),
        }));
        const result = await tool.execute("1", { imageRef: "shot.png" }, undefined, undefined, {});
        assertEquals(result.isError, true);
        assertEquals(result.content[0].text, "no auth");
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("see_image resolves attachment refs from the session image directory", async () => {
    await withProcessGlobalTestLock(async () => {
        const originalHome = Deno.env.get("HOME");
        const tempHome = await Deno.makeTempDir({ prefix: "runwield-see-image-home-" });
        const cwd = await Deno.makeTempDir({ prefix: "runwield-see-image-attachment-" });
        try {
            Deno.env.set("HOME", tempHome);
            const sessionManager = /** @type {any} */ ({ getSessionId: () => "session-abc" });
            const attachment = await persistImageAttachment(
                { base64: btoa("img"), mimeType: "image/png" },
                sessionManager,
                cwd,
            );
            /** @type {any[]} */
            const calls = [];
            const tool = /** @type {any} */ (createSeeImageTool({
                cwd,
                sessionManager,
                fallbackModel: { provider: "vision", id: "model", input: ["text", "image"] },
                modelRegistry: { getApiKeyAndHeaders: () => Promise.resolve({ ok: true, apiKey: "key" }) },
                completeSimpleFn: (_model, context) => {
                    calls.push(context.messages[0].content[1]);
                    return Promise.resolve({
                        role: "assistant",
                        api: "openai-completions",
                        provider: "vision",
                        model: "model",
                        content: [{ type: "text", text: "attachment description" }],
                        stopReason: "stop",
                        usage: {},
                        timestamp: Date.now(),
                    });
                },
            }));

            const result = await tool.execute("1", { imageRef: attachment.ref }, undefined, undefined, {});

            assertEquals(result.content[0].text, "attachment description");
            assertEquals(calls[0].mimeType, "image/png");
            assertEquals(calls[0].data, btoa("img"));
        } finally {
            if (originalHome === undefined) Deno.env.delete("HOME");
            else Deno.env.set("HOME", originalHome);
            await Deno.remove(tempHome, { recursive: true });
            await Deno.remove(cwd, { recursive: true });
        }
    });
});
