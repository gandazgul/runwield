import { assertEquals, assertNotEquals } from "@std/assert";
import { Spacer } from "@earendil-works/pi-tui";
import { createFooterOnlyUiApi, createSilentUiApi, createUiApi } from "./api.js";
import { KeyboardHelpBlock, SpinnerBlock, SystemMessageBlock, ThinkingBlock, ToolExecutionBlock } from "./blocks.js";
import stripAnsi from "strip-ansi";
import { initRunWieldTheme } from "../theme/theme.js";

initRunWieldTheme();

/**
 * @returns {{ children: any[], addChild: (child: any) => void, removeChild: (child: any) => void, clear: () => void }}
 */
function makeContainer() {
    return {
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
        clear() {
            this.children = [];
        },
    };
}

/**
 * @returns {{ tui: any, messageList: ReturnType<typeof makeContainer>, renders: () => number, focus: () => any }}
 */
function makeTuiHarness() {
    let renderCount = 0;
    let focused = /** @type {any} */ (null);
    const messageList = makeContainer();
    const tui = {
        requestRender() {
            renderCount++;
        },
        /** @param {any} block */
        setFocus(block) {
            focused = block;
        },
    };
    return { tui, messageList, renders: () => renderCount, focus: () => focused };
}

Deno.test("createSilentUiApi implements the full no-op surface", async () => {
    const ui = /** @type {any} */ (createSilentUiApi());
    ui.appendThinkingStart().appendDelta("ignored");
    ui.appendThinkingStart().end();
    ui.appendUserMessage("ignored");
    ui.appendAgentMessageStart("Agent").appendText("ignored");
    ui.appendImage("abc", "image/png");
    ui.appendQueuedMessage("queued-1", "ignored");
    ui.removeQueuedMessage("queued-1");
    ui.appendSystemMessage("ignored");
    const tool = ui.startToolExecution("1", "bash", "$ echo hi");
    tool.setOutput("ignored");
    tool.endExecution(false, 1);
    ui.toggleToolOutputsExpanded();
    ui.showKeyboardHelp({ title: "Keyboard shortcuts", items: [{ key: "?", description: "show help" }] });
    ui.hideKeyboardHelp();
    ui.requestRender();
    ui.advanceSpinner();
    ui.setBusy(true);
    ui.setRunningTasks([{ task: 1, assignee: "Tester", description: "Check" }]);
    ui.clearMessages();
    ui.showModelSelector();
    ui.disableInput();
    ui.enableInput();
    ui.suppressOutput();
    ui.abortActivePrompt();

    assertEquals(ui.getActiveToolBlock("1"), undefined);
    assertEquals(await ui.promptSelect("Pick", []), null);
    assertEquals(await ui.promptText("Text"), null);
    assertEquals(ui.isOutputSuppressed(), true);
});

Deno.test("createFooterOnlyUiApi suppresses message bodies but forwards footer renders", () => {
    let renders = 0;
    const ui = createFooterOnlyUiApi({ requestRender: () => renders++ });

    ui.appendSystemMessage("hidden");
    ui.appendAgentMessageStart("Agent").appendText("hidden");
    ui.requestRender();

    assertEquals(ui.isOutputSuppressed?.(), false);
    assertEquals(renders, 1);
});

Deno.test("ThinkingBlock hides markdown comments and unwraps emphasis markers", () => {
    const block = new ThinkingBlock();
    block.appendText(
        "**Planning page layout and token guard**\n\n<!-- -->\n\n**Inspecting server for static theme assets**",
    );

    const rendered = block.render(120).map((line) => stripAnsi(line).trimEnd()).join("\n").trimEnd();

    assertEquals(rendered, "Planning page layout and token guard\n\nInspecting server for static theme assets");
});

Deno.test("createUiApi appends visible blocks, merges compatible system messages, and controls tools", () => {
    const { tui, messageList, renders } = makeTuiHarness();
    const spinner = new SpinnerBlock();
    const ui = /** @type {any} */ (createUiApi(tui, messageList, spinner));

    const thinking = ui.appendThinkingStart();
    thinking.appendDelta("thinking");
    thinking.end();
    ui.appendUserMessage("hello");
    const agent = ui.appendAgentMessageStart("Tester");
    agent.appendText("hi");
    ui.appendSystemMessage("one");
    ui.appendSystemMessage("two");

    const tool = ui.startToolExecution("tool-1", "bash", "$ echo hi");
    tool.setOutput("output");
    tool.endExecution(false, 1);
    assertEquals(ui.getActiveToolBlock("tool-1"), tool);
    ui.toggleToolOutputsExpanded();
    ui.toggleToolOutputsExpanded();
    ui.advanceSpinner();
    ui.setRunningTasks([{ task: 1, assignee: "Tester", description: "Do work" }]);

    assertEquals(messageList.children.some((/** @type {any} */ child) => child instanceof Spacer), true);
    assertEquals(messageList.children.length > 0, true);
    assertEquals(renders() > 0, true);

    ui.clearMessages();
    assertEquals(messageList.children, []);
});

Deno.test("createUiApi does not hide duplicate tool-start events", () => {
    const { tui, messageList } = makeTuiHarness();
    const ui = /** @type {any} */ (createUiApi(tui, messageList, new SpinnerBlock()));

    const first = ui.startToolExecution("tool-1", "code_search", "code_search createAgentJobHandler");
    const second = ui.startToolExecution("tool-1", "code_search", "code_search createAgentJobHandler");

    assertEquals(second === first, false);
    assertEquals(
        messageList.children.filter((/** @type {any} */ child) => child instanceof ToolExecutionBlock).length,
        2,
    );
});

Deno.test("createUiApi toggles one transient keyboard-help block outside the message list", () => {
    const { tui, messageList, renders } = makeTuiHarness();
    const inputAccessory = makeContainer();
    const ui = /** @type {any} */ (createUiApi(tui, messageList, new SpinnerBlock(), inputAccessory));
    const help = { title: "Keyboard shortcuts", items: [{ key: "?", description: "show help" }] };

    ui.showKeyboardHelp(help);
    assertEquals(inputAccessory.children.length, 2);
    assertEquals(inputAccessory.children[0] instanceof KeyboardHelpBlock, true);
    assertEquals(messageList.children.length, 0);

    ui.showKeyboardHelp(help);
    assertEquals(inputAccessory.children.length, 0);

    inputAccessory.addChild("unrelated");
    ui.showKeyboardHelp(help);
    assertEquals(inputAccessory.children.length, 3);
    ui.hideKeyboardHelp();
    assertEquals(inputAccessory.children, ["unrelated"]);
    assertEquals(renders() > 0, true);
});

Deno.test("createUiApi adds and removes exact queued-message blocks by runtime id", () => {
    const { tui, messageList } = makeTuiHarness();
    const ui = /** @type {any} */ (createUiApi(tui, messageList, new SpinnerBlock()));

    ui.appendQueuedMessage("queued-1", "first");
    ui.appendQueuedMessage("queued-1", "duplicate ignored");
    ui.appendQueuedMessage("queued-2", "second");

    assertEquals(messageList.children.length, 4);
    ui.removeQueuedMessage("queued-2");
    assertEquals(messageList.children.length, 2);
    assertEquals(messageList.children[0] instanceof SystemMessageBlock, true);
    ui.removeQueuedMessage("queued-1");
    assertEquals(messageList.children, []);
});

Deno.test("createUiApi renders live elapsed tool time and stops after completion", async () => {
    const harness = makeTuiHarness();
    const timedUi = /** @type {any} */ (createUiApi(harness.tui, harness.messageList, new SpinnerBlock()));
    const tool = /** @type {import('./blocks.js').ToolExecutionBlock} */ (
        timedUi.startToolExecution("tool-timer", "bash", "$ sleep 1")
    );
    await new Promise((resolve) => setTimeout(resolve, 650));

    const plain = tool.render(100).map((line) => stripAnsi(line)).join("\n");
    assertEquals(plain.includes("Elapsed time:"), true);
    assertEquals(harness.renders() > 1, true);

    const beforeEndRenders = harness.renders();
    tool.endExecution(false, 700);
    const afterEndRenders = harness.renders();
    await new Promise((resolve) => setTimeout(resolve, 250));

    const endedPlain = tool.render(100).map((line) => stripAnsi(line)).join("\n");
    assertEquals(endedPlain.includes("Elapsed time:"), false);
    assertEquals(endedPlain.includes("Took 0.7s"), true);
    assertEquals(afterEndRenders, beforeEndRenders + 1);
    assertEquals(harness.renders(), afterEndRenders);
});

Deno.test("createUiApi keeps semantic status messages independent from active tool output", () => {
    const { tui, messageList } = makeTuiHarness();
    const ui = /** @type {any} */ (createUiApi(tui, messageList, new SpinnerBlock()));

    const tool = ui.startToolExecution("plan-tool", "plan_written", "plan_written plans/example.md");
    ui.appendSystemMessage("[RunWield] Plan declared: plans/example.md");
    ui.appendSystemMessage("[RunWield] Opening plan review UI for: example");
    ui.appendSystemMessage("[RunWield] Review server stderr:\nserver warning");
    ui.appendSystemMessage("[RunWield] Waiting for user decision...\n");

    assertEquals(messageList.children.length, 4);
    assertEquals(tool.bodyText, "");

    tool.endExecution(false, 1);
    ui.appendSystemMessage("after completion", false, "RunWield");

    assertEquals(messageList.children.length, 4);
    assertEquals(messageList.children[2] instanceof SystemMessageBlock, true);
});

Deno.test("createUiApi setBusy animates frames until Runtime reports idle", async () => {
    const { tui, messageList, renders } = makeTuiHarness();
    const spinner = new SpinnerBlock();
    const ui = /** @type {any} */ (createUiApi(tui, messageList, spinner));

    ui.setBusy(true);
    assertEquals(spinner.isBusy, true);
    const firstFrame = stripAnsi(spinner.render(80)[0]);
    await new Promise((resolve) => setTimeout(resolve, 170));
    const laterFrame = stripAnsi(spinner.render(80)[0]);
    assertNotEquals(laterFrame, firstFrame);

    ui.setBusy(false);
    assertEquals(spinner.isBusy, false);
    const stoppedRenderCount = renders();
    await new Promise((resolve) => setTimeout(resolve, 120));
    assertEquals(renders(), stoppedRenderCount);
});

Deno.test("createUiApi promptSelect resolves selection, cancellation, and selection-change hook", async () => {
    const { tui, messageList, focus } = makeTuiHarness();
    const ui = /** @type {any} */ (createUiApi(tui, messageList, new SpinnerBlock()));
    /** @type {string[]} */
    const previews = [];

    const selectionPromise = ui.promptSelect("Pick one", [
        { value: "one", label: "One" },
        { value: "two", label: "Two" },
    ], {
        onSelectionChange: (/** @type {string} */ value) => previews.push(value),
    });
    const selectBlock = focus();
    assertEquals(messageList.children[1] instanceof Spacer, true);
    selectBlock.list.onSelectionChange({ value: "two" });
    selectBlock.list.onSelect({ value: "two" });

    assertEquals(await selectionPromise, "two");
    assertEquals(previews, ["two"]);

    const cancelPromise = ui.promptSelect("Cancel", [{ value: "one", label: "One" }]);
    assertEquals(messageList.children[3] instanceof Spacer, true);
    focus().list.onCancel();
    assertEquals(await cancelPromise, null);

    const childCountBeforeTransient = messageList.children.length;
    const transientPromise = ui.promptSelect("Transient", [{ value: "router", label: "router" }], {
        persistResult: false,
    });
    focus().list.onSelect({ value: "router" });
    assertEquals(await transientPromise, "router");
    assertEquals(messageList.children.length, childCountBeforeTransient);

    const agentPromptPromise = ui.promptSelect("Switch agent:", [{ value: "engineer", label: "engineer" }]);
    focus().list.onSelect({ value: "engineer" });
    assertEquals(await agentPromptPromise, "engineer");
    assertEquals(messageList.children.length, childCountBeforeTransient);
});

Deno.test("createUiApi promptText resolves submit, rejects empty required submit, and aborts", async () => {
    const { tui, messageList, focus } = makeTuiHarness();
    const ui = /** @type {any} */ (createUiApi(tui, messageList, new SpinnerBlock()));

    const textPromise = ui.promptText("Name", { defaultValue: "Ada", allowEmpty: false });
    const textBlock = focus();
    assertEquals(messageList.children[1] instanceof Spacer, true);
    textBlock.input.onSubmit("");
    assertEquals(await textPromise, "Ada");

    const requiredPromise = ui.promptText("Required", { allowEmpty: false });
    const requiredBlock = focus();
    requiredBlock.input.onSubmit("   ");
    let settled = false;
    requiredPromise.then(() => {
        settled = true;
    });
    await Promise.resolve();
    assertEquals(settled, false);
    requiredBlock.input.onSubmit("Grace");
    assertEquals(await requiredPromise, "Grace");

    const abortPromise = ui.promptText("Abort");
    ui.abortActivePrompt();
    assertEquals(await abortPromise, null);
});

Deno.test("createUiApi suppressOutput silences later UI mutations except clearing existing messages", () => {
    const { tui, messageList, renders } = makeTuiHarness();
    const ui = /** @type {any} */ (createUiApi(tui, messageList, new SpinnerBlock()));

    ui.appendUserMessage("visible");
    const beforeSuppressChildren = messageList.children.length;
    const beforeSuppressRenders = renders();
    ui.suppressOutput();
    ui.appendUserMessage("hidden");
    ui.appendSystemMessage("hidden");
    ui.appendAgentMessageStart("Agent").appendText("hidden");
    ui.startToolExecution("hidden", "bash", "$");
    ui.requestRender();
    ui.advanceSpinner();
    ui.setBusy(true);
    ui.setRunningTasks([]);

    assertEquals(ui.isOutputSuppressed(), true);
    assertEquals(messageList.children.length, beforeSuppressChildren);
    assertEquals(renders(), beforeSuppressRenders);
    assertEquals(ui.getActiveToolBlock("hidden"), undefined);

    ui.clearMessages();
    assertEquals(messageList.children, []);
});
