import { assertEquals } from "@std/assert";
import { installKeybindings } from "./keybindings.js";

const RAW_KEY = {
    escape: "\x1b",
    ctrlC: "\x03",
    ctrlO: "\x0f",
    shiftEnter: "\x1b[13;2u",
    altEnter: "\x1b[13;3u",
    backspace: "\x7f",
    shiftTab: "\x1b[Z",
    up: "\x1b[A",
};

/**
 * @param {object} [overrides]
 * @returns {any}
 */
function makeContext(overrides = {}) {
    /** @type {string[]} */
    const systemMessages = [];
    /** @type {string[]} */
    const originalInputs = [];
    let renderCount = 0;
    let text = "";
    let newlineCount = 0;
    let toolToggles = 0;
    let startupToggles = 0;
    let thinkingCycles = 0;
    let promptDismissals = 0;
    let resets = 0;
    let invalidations = 0;
    let clearSteeringCalls = 0;
    let dequeues = 0;
    let pendingExit = false;
    let dequeueResult = false;

    const editor = {
        handleInput: (/** @type {string} */ data) => originalInputs.push(data),
        setText: (/** @type {string} */ value) => {
            text = value;
        },
        getText: () => text,
        addNewLine: () => {
            newlineCount++;
        },
        isEditorEmpty: () => text.length === 0,
    };
    const previewImages = {
        children: /** @type {any[]} */ ([]),
        /** @param {any} child */
        addChild(child) {
            this.children.push(child);
        },
        /** @param {any} child */
        removeChild(child) {
            const index = this.children.indexOf(child);
            if (index >= 0) this.children.splice(index, 1);
        },
    };
    const ctx = {
        editor,
        tui: { requestRender: () => renderCount++ },
        uiAPI: {
            appendSystemMessage: (/** @type {string} */ message) => systemMessages.push(message),
            toggleToolOutputsExpanded: () => {
                toolToggles++;
            },
        },
        pastedImages: /** @type {any[]} */ ([]),
        previewImages,
        submissionQueue: /** @type {unknown[]} */ ([]),
        generationGuard: { invalidateAll: () => invalidations++ },
        cancelActiveOperation: () => false,
        dismissActivePrompt: () => {
            promptDismissals++;
        },
        dequeueLastSubmission: () => {
            dequeues++;
            return dequeueResult;
        },
        forceResetUI: () => {
            resets++;
        },
        markCtrlCPendingExit: () => {
            pendingExit = true;
        },
        isCtrlCPendingExit: () => pendingExit,
        toggleStartupHelp: () => {
            startupToggles++;
        },
        cycleThinkingLevel: () => {
            thinkingCycles++;
        },
        clearPendingSteeringMessages: () => {
            clearSteeringCalls++;
        },
        stats: {
            systemMessages,
            originalInputs,
            get renderCount() {
                return renderCount;
            },
            get text() {
                return text;
            },
            get newlineCount() {
                return newlineCount;
            },
            get toolToggles() {
                return toolToggles;
            },
            get startupToggles() {
                return startupToggles;
            },
            get thinkingCycles() {
                return thinkingCycles;
            },
            get promptDismissals() {
                return promptDismissals;
            },
            get resets() {
                return resets;
            },
            get invalidations() {
                return invalidations;
            },
            get clearSteeringCalls() {
                return clearSteeringCalls;
            },
            get dequeues() {
                return dequeues;
            },
            /** @param {boolean} value */
            set dequeueResult(value) {
                dequeueResult = value;
            },
        },
    };
    return Object.assign(ctx, overrides);
}

Deno.test("installKeybindings handles Escape cancellation priority and renders once", async () => {
    const ctx = makeContext({
        submissionQueue: [1, 2],
        cancelActiveOperation: () => true,
    });
    installKeybindings(ctx);

    await ctx.editor.handleInput(RAW_KEY.escape);

    assertEquals(ctx.submissionQueue, []);
    assertEquals(ctx.stats.invalidations, 1);
    assertEquals(ctx.stats.clearSteeringCalls, 1);
    assertEquals(ctx.stats.promptDismissals, 1);
    assertEquals(ctx.stats.resets, 1);
    assertEquals(ctx.stats.systemMessages, ["Operation canceled."]);
    assertEquals(ctx.stats.renderCount, 1);
});

Deno.test("installKeybindings Ctrl+C cancels, clears input, and removes pasted previews", async () => {
    const ctx = makeContext();
    ctx.pastedImages.push({ base64: "a", mimeType: "image/png" });
    ctx.previewImages.children.push("preview");
    ctx.editor.setText("draft");
    installKeybindings(ctx);

    await ctx.editor.handleInput(RAW_KEY.ctrlC);

    assertEquals(ctx.stats.text, "");
    assertEquals(ctx.pastedImages, []);
    assertEquals(ctx.previewImages.children, []);
    assertEquals(ctx.stats.invalidations, 1);
});

Deno.test("installKeybindings toggles tool output and startup help on Ctrl+O", async () => {
    const ctx = makeContext();
    installKeybindings(ctx);

    await ctx.editor.handleInput(RAW_KEY.ctrlO);

    assertEquals(ctx.stats.startupToggles, 1);
    assertEquals(ctx.stats.toolToggles, 1);
    assertEquals(ctx.stats.renderCount, 1);
});

Deno.test("installKeybindings handles newline, image removal, thinking cycle, queue recall, and fallback input", async () => {
    const ctx = makeContext();
    ctx.pastedImages.push({ base64: "a", mimeType: "image/png" });
    ctx.previewImages.children.push("preview");
    ctx.submissionQueue.push("queued");
    ctx.stats.dequeueResult = true;
    const original = installKeybindings(ctx);

    await ctx.editor.handleInput(RAW_KEY.shiftEnter);
    await ctx.editor.handleInput(RAW_KEY.altEnter);
    await ctx.editor.handleInput(RAW_KEY.backspace);
    await ctx.editor.handleInput(RAW_KEY.shiftTab);
    await ctx.editor.handleInput(RAW_KEY.up);
    await ctx.editor.handleInput("x");

    assertEquals(typeof original, "function");
    assertEquals(ctx.stats.newlineCount, 2);
    assertEquals(ctx.pastedImages, []);
    assertEquals(ctx.previewImages.children, []);
    assertEquals(ctx.stats.thinkingCycles, 1);
    assertEquals(ctx.stats.originalInputs, ["x"]);
});

Deno.test("installKeybindings checks editor emptiness through public getText", async () => {
    const ctx = makeContext();
    delete ctx.editor.isEditorEmpty;
    ctx.pastedImages.push({ base64: "a", mimeType: "image/png" });
    ctx.previewImages.children.push("preview");
    ctx.submissionQueue.push("queued");
    ctx.stats.dequeueResult = true;
    installKeybindings(ctx);

    await ctx.editor.handleInput(RAW_KEY.backspace);
    await ctx.editor.handleInput(RAW_KEY.up);

    assertEquals(ctx.pastedImages, []);
    assertEquals(ctx.previewImages.children, []);
    assertEquals(ctx.stats.dequeues, 1);
    assertEquals(ctx.stats.originalInputs, []);
});
