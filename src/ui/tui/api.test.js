import { assertEquals } from "@std/assert";
import { Spacer } from "@earendil-works/pi-tui";
import { createFooterOnlyUiApi, createSilentUiApi, createUiApi } from "./api.js";
import { SpinnerBlock, SystemMessageBlock } from "./blocks.js";
import { initRunWieldTheme } from "../theme/theme.js";

initRunWieldTheme();

/**
 * @returns {{ tui: any, messageList: any, renders: () => number, focus: () => any }}
 */
function makeTuiHarness() {
    let renderCount = 0;
    let focused = /** @type {any} */ (null);
    const messageList = {
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
    ui.appendSystemMessage("ignored");
    const tool = ui.startToolExecution("1", "bash", "echo hi");
    tool.appendOutput("ignored");
    tool.endExecution(false, 1);
    ui.toggleToolOutputsExpanded();
    ui.requestRender();
    ui.advanceSpinner();
    ui.setBusy(true);
    ui.setRunningTasks([{ task: 1, assignee: "Tester", description: "Check" }]);
    ui.clearMessages();
    ui.showModelSelector();
    ui.setAgentInfo("Agent", "provider/model");
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

    const tool = ui.startToolExecution("tool-1", "bash", "echo hi");
    tool.appendOutput("output");
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

Deno.test("createUiApi folds plan_written system messages into the active tool block", () => {
    const { tui, messageList } = makeTuiHarness();
    const ui = /** @type {any} */ (createUiApi(tui, messageList, new SpinnerBlock()));

    const tool = ui.startToolExecution("plan-tool", "plan_written", "plans/example.md");
    ui.appendSystemMessage("[RunWield] Plan declared: plans/example.md");
    ui.appendSystemMessage("[RunWield] Opening plan review UI for: example");
    ui.appendSystemMessage("[RunWield] Waiting for user decision...\n");

    assertEquals(messageList.children.length, 2);
    assertEquals(
        tool.bodyText,
        "[RunWield] Plan declared: plans/example.md\n[RunWield] Opening plan review UI for: example\n[RunWield] Waiting for user decision...\n",
    );

    tool.endExecution(false, 1);
    ui.appendSystemMessage("after completion", false, "RunWield");

    assertEquals(messageList.children[2] instanceof SystemMessageBlock, true);
});

Deno.test("createUiApi setBusy starts and stops the spinner loop", () => {
    const { tui, messageList, renders } = makeTuiHarness();
    const spinner = new SpinnerBlock();
    const ui = /** @type {any} */ (createUiApi(tui, messageList, spinner));

    ui.setBusy(true);
    assertEquals(spinner.isBusy, true);
    ui.setBusy(false);
    assertEquals(spinner.isBusy, false);
    assertEquals(renders() > 0, true);
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
    ui.startToolExecution("hidden", "bash", "");
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
