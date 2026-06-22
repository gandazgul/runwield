import { assertEquals } from "@std/assert";
import { renderBootBanner } from "./boot-banner.js";

Deno.test("renderBootBanner reports prompt templates, skills, theme, and blocked prompt warnings", async () => {
    /** @type {Array<{ text: string, isError: boolean, header: string }>} */
    const messages = [];

    await renderBootBanner({
        uiAPI: /** @type {any} */ ({
            appendSystemMessage: (
                /** @type {string} */ text,
                /** @type {boolean} */ isError = false,
                /** @type {string} */ header = "",
            ) => {
                messages.push({ text, isError, header });
            },
        }),
        invokablePromptTemplates: [
            { name: "review", source: "local" },
            { name: "release", source: "bundled" },
        ],
        blockedPromptTemplates: [
            { name: "help", source: "local" },
            { name: "sleep", source: "bundled" },
        ],
        chatPromptAgentName: "operator",
        __deps: {
            listSkills: () =>
                Promise.resolve([{
                    name: "diagnose",
                    description: "Debug",
                    path: "SKILL.md",
                    source: /** @type {"bundled"} */ ("bundled"),
                }]),
            listLoadedAgentMdFiles: () =>
                Promise.resolve([{ path: "/repo/HARNS.md", source: /** @type {"local"} */ ("local") }]),
            getSettingsManager: () => ({ getTheme: () => "catppuccin-mocha" }),
            hasSnipBinary: () => Promise.resolve(true),
        },
    });

    assertEquals(messages[0].header, "Prompt Templates (2):");
    assertEquals(messages[0].text.includes("/review, /release"), true);
    assertEquals(messages[0].text.includes("operator"), true);
    assertEquals(messages.some((message) => message.header.startsWith("Skills")), true);
    assertEquals(messages.some((message) => message.header === "Theme:"), true);
    assertEquals(
        messages.some((message) => message.header === "Runtime Optimizers:" && message.text === "Snip"),
        true,
    );
    assertEquals(
        messages.some((message) =>
            message.isError && message.text.includes("./.hns/prompts/help.md command can't be invoked")
        ),
        true,
    );
    assertEquals(messages.some((message) => message.text.includes("sleep.md command can't be invoked")), false);
});

Deno.test("renderBootBanner reports no prompt templates when none are invokable", async () => {
    /** @type {Array<{ text: string, header: string }>} */
    const messages = [];

    await renderBootBanner({
        uiAPI: /** @type {any} */ ({
            appendSystemMessage: (
                /** @type {string} */ text,
                _isError = false,
                /** @type {string} */ header = "",
            ) => {
                messages.push({ text, header });
            },
        }),
        invokablePromptTemplates: [],
        blockedPromptTemplates: [],
        chatPromptAgentName: "operator",
        __deps: {
            listSkills: () => Promise.resolve([]),
            listLoadedAgentMdFiles: () => Promise.resolve([]),
            getSettingsManager: () => ({ getTheme: () => undefined }),
            hasSnipBinary: () => Promise.resolve(true),
        },
    });

    assertEquals(messages[0], { text: "none", header: "Prompt Templates:" });
});

Deno.test("renderBootBanner warns about missing Snip for the first project boots", async () => {
    /** @type {Array<{ text: string, isError: boolean }>} */
    const messages = [];
    let recorded = 0;

    await renderBootBanner({
        uiAPI: /** @type {any} */ ({
            appendSystemMessage: (
                /** @type {string} */ text,
                /** @type {boolean} */ isError = false,
            ) => {
                messages.push({ text, isError });
            },
        }),
        invokablePromptTemplates: [],
        blockedPromptTemplates: [],
        chatPromptAgentName: "operator",
        __deps: {
            listSkills: () => Promise.resolve([]),
            listLoadedAgentMdFiles: () => Promise.resolve([]),
            getSettingsManager: () => ({ getTheme: () => undefined }),
            hasSnipBinary: () => Promise.resolve(false),
            shouldShowSnipMissingWarning: () => Promise.resolve(true),
            recordSnipMissingWarningShown: () => {
                recorded++;
                return Promise.resolve();
            },
        },
    });

    assertEquals(messages.some((message) => message.isError && message.text.includes("Snip is not installed")), true);
    assertEquals(recorded, 1);
});

Deno.test("renderBootBanner does not warn when Snip is installed or warning limit is reached", async () => {
    /** @type {string[]} */
    const messages = [];

    await renderBootBanner({
        uiAPI: /** @type {any} */ ({
            appendSystemMessage: (/** @type {string} */ text) => messages.push(text),
        }),
        invokablePromptTemplates: [],
        blockedPromptTemplates: [],
        chatPromptAgentName: "operator",
        __deps: {
            listSkills: () => Promise.resolve([]),
            listLoadedAgentMdFiles: () => Promise.resolve([]),
            getSettingsManager: () => ({ getTheme: () => undefined }),
            hasSnipBinary: () => Promise.resolve(false),
            shouldShowSnipMissingWarning: () => Promise.resolve(false),
            recordSnipMissingWarningShown: () => {
                throw new Error("should not record");
            },
        },
    });

    assertEquals(messages.some((message) => message.includes("Snip is not installed")), false);
});
