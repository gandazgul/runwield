import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { getHomeDir } from "../constants.js";
import { withProcessGlobalTestLock } from "../testing/process-global-lock.js";
import { persistImageAttachment } from "../shared/session/image-attachments.js";
import { createSeeImageTool, DEFAULT_SEE_IMAGE_PROMPT, extractAssistantText } from "./see-image.ts";

/** @typedef {import("@earendil-works/pi-ai/compat").Api} Api */
/** @typedef {import("@earendil-works/pi-ai/compat").Model<Api>} VisionTestModel */

const TEST_COST = Object.freeze({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 });
const TEST_USAGE = Object.freeze({
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: TEST_COST,
});

/**
 * @param {string} [provider]
 * @returns {VisionTestModel}
 */
function makeVisionTestModel(provider = "vision") {
    return {
        id: "model",
        name: "model",
        api: "openai-completions",
        provider,
        baseUrl: "https://example.invalid/v1",
        reasoning: false,
        input: ["text", "image"],
        cost: TEST_COST,
        contextWindow: 128000,
        maxTokens: 2048,
    };
}

Deno.test("extractAssistantText joins text blocks", () => {
    assertEquals(
        extractAssistantText([{ type: "text", text: "one" }, { type: "image", data: "x" }, {
            type: "text",
            text: "two",
        }]),
        "one\ntwo",
    );
});

/** @param {string} tempHome */
async function writeVisionModelConfig(tempHome) {
    await Deno.mkdir(join(tempHome, ".wld"), { recursive: true });
    await Deno.writeTextFile(
        join(tempHome, ".wld", "models.json"),
        JSON.stringify({
            providers: {
                vision: {
                    baseUrl: "https://example.invalid/v1",
                    api: "openai-completions",
                    apiKey: "key",
                    headers: { a: "b" },
                    models: [{ id: "model", input: ["text", "image"] }],
                },
            },
        }),
    );
}

Deno.test("see_image invokes fallback model with local image and default prompt", async () => {
    await withProcessGlobalTestLock(async () => {
        const originalHome = getHomeDir();
        const tempHome = await Deno.makeTempDir({ prefix: "runwield-see-image-home-" });
        const cwd = await Deno.makeTempDir({ prefix: "runwield-see-image-" });
        try {
            Deno.env.set("HOME", tempHome);
            await writeVisionModelConfig(tempHome);
            await Deno.writeFile(join(cwd, "shot.png"), new Uint8Array([1, 2, 3]));
            /** @type {any[]} */
            const calls = [];
            const fallbackModel = makeVisionTestModel();
            const tool = /** @type {any} */ (createSeeImageTool({
                cwd,
                fallbackModel,
                completeSimpleFn: (model, context, options) => {
                    calls.push({ model, context, options });
                    return Promise.resolve({
                        role: "assistant",
                        api: "openai-completions",
                        provider: "vision",
                        model: "model",
                        content: [{ type: "text", text: "description" }],
                        stopReason: "stop",
                        usage: TEST_USAGE,
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
            Deno.env.set("HOME", originalHome);
            await Deno.remove(tempHome, { recursive: true });
            await Deno.remove(cwd, { recursive: true });
        }
    });
});

Deno.test("see_image returns tool error on auth failure", async () => {
    await withProcessGlobalTestLock(async () => {
        const originalHome = getHomeDir();
        const tempHome = await Deno.makeTempDir({ prefix: "runwield-see-image-home-" });
        const cwd = await Deno.makeTempDir({ prefix: "runwield-see-image-" });
        try {
            Deno.env.set("HOME", tempHome);
            await Deno.writeFile(join(cwd, "shot.png"), new Uint8Array([1]));
            const tool = /** @type {any} */ (createSeeImageTool({
                cwd,
                fallbackModel: makeVisionTestModel("missing-vision"),
                completeSimpleFn: () => Promise.reject(new Error("should not call")),
            }));
            const result = await tool.execute("1", { imageRef: "shot.png" }, undefined, undefined, {});
            assertEquals(result.isError, true);
            assertEquals(result.content[0].text, "No configured auth for provider missing-vision");
        } finally {
            Deno.env.set("HOME", originalHome);
            await Deno.remove(tempHome, { recursive: true });
            await Deno.remove(cwd, { recursive: true });
        }
    });
});

Deno.test("see_image resolves attachment refs from the session image directory", async () => {
    await withProcessGlobalTestLock(async () => {
        const originalHome = getHomeDir();
        const tempHome = await Deno.makeTempDir({ prefix: "runwield-see-image-home-" });
        const cwd = await Deno.makeTempDir({ prefix: "runwield-see-image-attachment-" });
        try {
            Deno.env.set("HOME", tempHome);
            await writeVisionModelConfig(tempHome);
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
                fallbackModel: makeVisionTestModel(),
                completeSimpleFn: (_model, context) => {
                    calls.push(context.messages[0].content[1]);
                    return Promise.resolve({
                        role: "assistant",
                        api: "openai-completions",
                        provider: "vision",
                        model: "model",
                        content: [{ type: "text", text: "attachment description" }],
                        stopReason: "stop",
                        usage: TEST_USAGE,
                        timestamp: Date.now(),
                    });
                },
            }));

            const result = await tool.execute("1", { imageRef: attachment.ref }, undefined, undefined, {});

            assertEquals(result.content[0].text, "attachment description");
            assertEquals(calls[0].mimeType, "image/png");
            assertEquals(calls[0].data, btoa("img"));
        } finally {
            Deno.env.set("HOME", originalHome);
            await Deno.remove(tempHome, { recursive: true });
            await Deno.remove(cwd, { recursive: true });
        }
    });
});
