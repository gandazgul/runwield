import { assertEquals } from "@std/assert";
import { __setClipboardDepsForTest } from "../clipboard.js";
import { initRunWieldTheme } from "../../ui/theme/theme.js";
import { installKeybindings } from "./keybindings.js";

const RAW_KEY = {
    escape: "\x1b",
    ctrlC: "\x03",
    ctrlO: "\x0f",
    ctrlV: "\x16",
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
    let planReviewCancels = 0;
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
        abortActiveSession: () => false,
        cancelActivePlanReview: () => {
            planReviewCancels++;
            return false;
        },
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
            get planReviewCancels() {
                return planReviewCancels;
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

Deno.test({
    name: "installKeybindings handles Escape cancellation priority and renders once",
    fn: async () => {
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
    },
});

Deno.test({
    name: "installKeybindings reports Escape cancellation for active plan review waits",
    fn: async () => {
        let planReviewCancelCalls = 0;
        const ctx = makeContext({
            cancelActivePlanReview: () => {
                planReviewCancelCalls++;
                return true;
            },
        });
        installKeybindings(ctx);

        await ctx.editor.handleInput(RAW_KEY.escape);

        assertEquals(ctx.stats.invalidations, 1);
        assertEquals(planReviewCancelCalls, 1);
        assertEquals(ctx.stats.resets, 1);
        assertEquals(ctx.stats.systemMessages, ["Plan review canceled."]);
        assertEquals(ctx.stats.renderCount, 1);
    },
});

Deno.test({
    name: "installKeybindings Ctrl+C cancels, clears input, and removes pasted previews",
    fn: async () => {
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
    },
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

Deno.test("installKeybindings asks dequeue callback for up-arrow even without submission queue", async () => {
    const ctx = makeContext();
    ctx.stats.dequeueResult = true;
    installKeybindings(ctx);

    await ctx.editor.handleInput(RAW_KEY.up);

    assertEquals(ctx.stats.dequeues, 1);
    assertEquals(ctx.stats.originalInputs, []);
});

Deno.test("installKeybindings delegates pasted images through handleImagePaste", async () => {
    initRunWieldTheme();
    const enc = new TextEncoder();
    const outputs = [
        { success: true, stdout: "image\n" },
        { success: true, stdout: "" },
        { success: true, stdout: "YQ==\n" },
    ];
    class FakeCommand {
        /** @param {string} _command @param {{ args?: string[] }} _opts */
        constructor(_command, _opts) {}
        output() {
            const next = outputs.shift();
            if (!next) throw new Error("missing fake output");
            return Promise.resolve({ success: next.success, stdout: enc.encode(next.stdout), stderr: enc.encode("") });
        }
    }
    __setClipboardDepsForTest(
        /** @type {any} */ ({
            os: "darwin",
            Command: FakeCommand,
            makeTempFile: () => Promise.resolve("/tmp/runwield-clip.png"),
            remove: () => Promise.resolve(),
        }),
    );
    try {
        /** @type {any[]} */
        const handled = [];
        const ctx = makeContext({
            handleImagePaste: (/** @type {any} */ image) => {
                handled.push(image);
                return Promise.resolve({ ...image, ref: "attachment:abc" });
            },
        });
        installKeybindings(ctx);

        await ctx.editor.handleInput(RAW_KEY.ctrlV);

        assertEquals(handled, [{ base64: "YQ==", mimeType: "image/png" }]);
        assertEquals(ctx.pastedImages, [{ base64: "YQ==", mimeType: "image/png", ref: "attachment:abc" }]);
        assertEquals(ctx.previewImages.children.length, 1);
        assertEquals(ctx.stats.renderCount, 1);
    } finally {
        __setClipboardDepsForTest();
    }
});

Deno.test("installKeybindings does not mutate previews when handleImagePaste blocks", async () => {
    const enc = new TextEncoder();
    const outputs = [
        { success: true, stdout: "image\n" },
        { success: true, stdout: "" },
        { success: true, stdout: "YQ==\n" },
    ];
    class FakeCommand {
        /** @param {string} _command @param {{ args?: string[] }} _opts */
        constructor(_command, _opts) {}
        output() {
            const next = outputs.shift();
            if (!next) throw new Error("missing fake output");
            return Promise.resolve({ success: next.success, stdout: enc.encode(next.stdout), stderr: enc.encode("") });
        }
    }
    __setClipboardDepsForTest(
        /** @type {any} */ ({
            os: "darwin",
            Command: FakeCommand,
            makeTempFile: () => Promise.resolve("/tmp/runwield-clip.png"),
            remove: () => Promise.resolve(),
        }),
    );
    try {
        const ctx = makeContext({ handleImagePaste: () => Promise.resolve(null) });
        installKeybindings(ctx);

        await ctx.editor.handleInput(RAW_KEY.ctrlV);

        assertEquals(ctx.pastedImages, []);
        assertEquals(ctx.previewImages.children, []);
        assertEquals(ctx.stats.renderCount, 0);
    } finally {
        __setClipboardDepsForTest();
    }
});
