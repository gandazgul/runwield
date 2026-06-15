import { assertEquals } from "@std/assert";
import { setActiveModel } from "./chat-session.js";
import { setActiveUiAPI, setRootAgentSession } from "../session/session-state.js";

Deno.test("setActiveModel reports setModel rejection instead of leaving an unhandled crash", async () => {
    const originalHome = Deno.env.get("HOME");
    const originalOpenAiKey = Deno.env.get("OPENAI_API_KEY");
    const tempHome = await Deno.makeTempDir({ prefix: "harns-set-active-model-" });
    /** @type {string[]} */
    const messages = [];
    let renderRequested = false;

    try {
        Deno.env.set("HOME", tempHome);
        Deno.env.set("OPENAI_API_KEY", "test-key");
        setActiveUiAPI(
            /** @type {any} */ ({
                appendSystemMessage: (/** @type {string} */ message) => messages.push(message),
                requestRender: () => {
                    renderRequested = true;
                },
            }),
        );
        setRootAgentSession(
            /** @type {any} */ ({
                setModel: () => Promise.reject(new Error("No API key for openai/gpt-5")),
            }),
        );

        await setActiveModel("gpt-5", "openai");

        assertEquals(messages, ["Failed to switch model: No API key for openai/gpt-5"]);
        assertEquals(renderRequested, true);
    } finally {
        setRootAgentSession(null);
        setActiveUiAPI(null);
        if (originalHome === undefined) Deno.env.delete("HOME");
        else Deno.env.set("HOME", originalHome);
        if (originalOpenAiKey === undefined) Deno.env.delete("OPENAI_API_KEY");
        else Deno.env.set("OPENAI_API_KEY", originalOpenAiKey);
        await Deno.remove(tempHome, { recursive: true });
    }
});
