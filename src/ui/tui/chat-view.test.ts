import { assertEquals, assertStringIncludes } from "@std/assert";
import { type Component, Container, Spacer, StdinBuffer, Text, TuiAltScreen } from "@earendil-works/pi-tui";
import { createChatView, findVisibleToolBlocks } from "./chat-view.ts";
import { ToolExecutionGroupBlock } from "./blocks.js";
import { VirtualTerminal } from "./testing/virtual-terminal.js";
import { RunWieldTui } from "./tui.ts";
import { installTerminalFocusState } from "./terminal-focus-state.ts";
import { installKeybindings } from "./keybindings.ts";
import { createGenerationGuard } from "./generation-guard.js";

Deno.test("TUI artifact shortcut opens the shared-reader picker without changing the draft", async () => {
    const terminal = new VirtualTerminal({ columns: 150, rows: 30 });
    const tui = new TuiAltScreen(terminal);
    const view = await createChatView({
        tui,
        suppressStartupHeader: true,
        getSessionId: () => "artifact-session",
        sessionRuntime: {
            getSessionSnapshot: () => ({
                cwd: "/tmp/artifact-picker-fixture",
                activeModel: { model: "fixture", provider: "test" },
                managed: { generation: 0 },
                artifacts: [{
                    artifactId: "prd-1",
                    kind: "prd",
                    title: "Reader requirements",
                    path: "docs/prd/reader.md",
                    registeredAt: "2026-09-19T00:00:00.000Z",
                    registeredBy: "Ideator",
                    sourceSegmentId: "segment-1",
                }],
            }),
        },
        setActiveModel: () => Promise.resolve({ status: "active" }),
    });
    try {
        tui.start();
        view.editor.setText("Keep my draft");
        terminal.input("\x1b]");
        tui.renderNow(true);
        await terminal.flush();
        assertStringIncludes(terminal.getScreenText(), "Open artifact");
        assertStringIncludes(terminal.getScreenText(), "Reader requirements");
        terminal.input("\x1b");
        await terminal.flush();
        assertEquals(view.editor.getText(), "Keep my draft");
    } finally {
        view.dispose();
        tui.stop();
    }
});

Deno.test("chat view reconstructs delayed mouse-wheel input without changing a draft or cancelling work", async () => {
    const terminal = new VirtualTerminal({ columns: 80, rows: 12 });
    const tui = new RunWieldTui(terminal);
    const focus = installTerminalFocusState(terminal, () => tui.requestRender(true));
    const view = await createChatView({
        tui,
        suppressStartupHeader: true,
        getSessionId: () => "fragmented-wheel-session",
        sessionRuntime: {
            getSessionSnapshot: () => ({ cwd: "/tmp/fragmented-wheel-fixture", activeModel: {} }),
        },
        setActiveModel: () => Promise.resolve({ status: "active" }),
    });
    let cancellationCount = 0;
    let ctrlCPendingExit = false;
    const submissions: string[] = [];
    view.editor.onSubmit = (text) => submissions.push(text);
    installKeybindings({
        editor: view.editor,
        tui,
        uiAPI: view.uiAPI,
        pastedImages: view.pastedImages,
        previewImages: view.previewImages,
        generationGuard: createGenerationGuard(),
        dismissActivePrompt: () => {},
        dequeueLastSubmission: () => false,
        recallQueuedSubmissionsToEditor: () => {},
        forceResetUI: () => {},
        markCtrlCPendingExit: () => {
            ctrlCPendingExit = true;
        },
        isCtrlCPendingExit: () => ctrlCPendingExit,
        cycleThinkingLevel: () => {},
        readClipboardImage: () => Promise.resolve(null),
        cancelRuntimeSession: () => {
            cancellationCount++;
            return true;
        },
    });
    const mouseSequence = "\x1b[<64;1;1M";

    try {
        tui.start();
        for (let index = 0; index < 30; index++) {
            view.uiAPI.appendUserMessage?.(`retained message ${index}`);
        }
        view.uiAPI.setBusy?.(true);
        view.editor.setText("keep this draft");
        tui.renderNow(true);
        await terminal.flush();

        for (let split = 1; split < mouseSequence.length; split++) {
            tui.scrollToBottom();
            tui.renderNow();
            const beforeScroll = tui.viewportTop;
            const input = new StdinBuffer({ timeout: 80, escapeTimeout: 80 });
            input.on("data", (data: string) => terminal.input(data));
            input.process(mouseSequence.slice(0, split));
            input.process(mouseSequence.slice(split));
            tui.renderNow();
            await terminal.flush();
            assertEquals(tui.viewportTop < beforeScroll, true);
            assertEquals(view.editor.getText(), "keep this draft");
            assertEquals(cancellationCount, 0);
            assertEquals(submissions, []);
        }

        tui.scrollToBottom();
        tui.renderNow();
        const beforeDelayedScroll = tui.viewportTop;
        const delayedInput = new StdinBuffer({ timeout: 1, escapeTimeout: 1 });
        delayedInput.on("data", (data: string) => terminal.input(data));
        delayedInput.process("\x1b");
        await new Promise((resolve) => setTimeout(resolve, 10));
        delayedInput.process(mouseSequence.slice(1));
        tui.renderNow();
        await terminal.flush();

        assertEquals(tui.viewportTop < beforeDelayedScroll, true);
        assertEquals(view.editor.getText(), "keep this draft");
        assertEquals(cancellationCount, 0);
        assertEquals(submissions, []);

        const incompleteInput = new StdinBuffer({ timeout: 1, escapeTimeout: 1 });
        incompleteInput.on("data", (data: string) => terminal.input(data));
        incompleteInput.process("\x1b");
        await new Promise((resolve) => setTimeout(resolve, 10));
        incompleteInput.process(mouseSequence.slice(1, -1));
        await new Promise((resolve) => setTimeout(resolve, 70));
        assertEquals(view.editor.getText(), "keep this draft");
        assertEquals(cancellationCount, 0);
        assertEquals(submissions, []);

        terminal.input("\x1b");
        await new Promise((resolve) => setTimeout(resolve, 70));
        assertEquals(cancellationCount, 1);
    } finally {
        view.uiAPI.setBusy?.(false);
        focus.dispose();
        view.dispose();
        tui.stop();
    }
});

Deno.test("chat view shows messages appended after the first frame", async () => {
    const terminal = new VirtualTerminal({ columns: 80, rows: 12 });
    const tui = new RunWieldTui(terminal);
    const view = await createChatView({
        tui,
        suppressStartupHeader: true,
        getSessionId: () => "append-after-first-frame",
        sessionRuntime: {
            getSessionSnapshot: () => ({ cwd: "/tmp/append-after-first-frame-fixture", activeModel: {} }),
        },
        setActiveModel: () => Promise.resolve({ status: "active" }),
    });
    try {
        tui.start();
        tui.renderNow(true);
        await terminal.flush();

        view.uiAPI.appendUserMessage?.("message after the first frame");
        tui.renderNow();
        await terminal.flush();

        assertStringIncludes(terminal.getScreenText(), "message after the first frame");
    } finally {
        view.dispose();
        tui.stop();
    }
});

Deno.test("chat view keeps unchanged retained blocks out of live-update renders", async () => {
    const retainedCounts = [100, 500, 998];
    for (const retainedCount of retainedCounts) {
        const terminal = new VirtualTerminal({ columns: 80, rows: 12 });
        const tui = new RunWieldTui(terminal);
        const view = await createChatView({
            tui,
            suppressStartupHeader: true,
            getSessionId: () => `retained-render-${retainedCount}`,
            sessionRuntime: {
                getSessionSnapshot: () => ({ cwd: "/tmp/retained-render-fixture", activeModel: {} }),
            },
            setActiveModel: () => Promise.resolve({ status: "active" }),
        });
        const renderCounts = Array.from({ length: retainedCount }, () => 0);
        for (let index = 0; index < retainedCount; index++) {
            const marker = `retained marker ${index}`;
            const component: Component = {
                invalidate: () => {},
                render: () => {
                    renderCounts[index]++;
                    return [marker];
                },
            };
            view.messageList.addChild(component);
        }
        try {
            tui.start();
            const thinking = view.uiAPI.appendThinkingStart?.();
            if (!thinking) throw new Error("TUI API is incomplete.");
            thinking.appendDelta("live update one");
            tui.renderNow(true);
            await terminal.flush();
            const initialRenderCounts = [...renderCounts];
            assertEquals(initialRenderCounts.every((count) => count > 0), true);

            tui.scrollToTop();
            tui.renderNow();
            await terminal.flush();
            assertStringIncludes(terminal.getScreenText(), "retained marker 0");

            thinking.appendDelta(" live update two");
            tui.renderNow();
            await terminal.flush();
            assertEquals(renderCounts, initialRenderCounts);

            tui.scrollToBottom();
            tui.renderNow();
            await terminal.flush();
            assertStringIncludes(terminal.getScreenText(), "live update two");
        } finally {
            view.dispose();
            tui.stop();
        }
    }
});

Deno.test("chat view refreshes an active tool without reformatting retained message blocks", async () => {
    const terminal = new VirtualTerminal({ columns: 80, rows: 12 });
    const tui = new RunWieldTui(terminal);
    const view = await createChatView({
        tui,
        suppressStartupHeader: true,
        getSessionId: () => "active-tool-render-session",
        sessionRuntime: {
            getSessionSnapshot: () => ({ cwd: "/tmp/active-tool-render-fixture", activeModel: {} }),
        },
        setActiveModel: () => Promise.resolve({ status: "active" }),
    });
    try {
        tui.start();
        for (let index = 0; index < 20; index++) {
            view.uiAPI.appendUserMessage?.(`retained message ${index}`);
        }
        const tool = view.uiAPI.startToolExecution?.("tool-1", "bash", "! echo streaming");
        if (!tool) throw new Error("TUI API is incomplete.");
        tool.setOutput("first tool output");
        tui.renderNow(true);
        await terminal.flush();
        assertStringIncludes(terminal.getScreenText(), "first tool output");

        tool.setOutput("updated tool output");
        tui.renderNow();
        await terminal.flush();
        assertStringIncludes(terminal.getScreenText(), "updated tool output");
    } finally {
        view.uiAPI.setBusy?.(false);
        view.dispose();
        tui.stop();
    }
});

Deno.test("chat view finds only tool groups intersecting the viewport", () => {
    const messageList = new Container();
    const firstGroup = new ToolExecutionGroupBlock();
    const secondGroup = new ToolExecutionGroupBlock();
    const containerLayout = [
        { component: new Text("header", 0, 0), height: 1 },
        { component: messageList, height: 7 },
    ];
    const messageLayout = [
        { component: firstGroup, height: 3 },
        { component: new Spacer(1), height: 1 },
        { component: secondGroup, height: 3 },
    ];

    const visibleBlocks = findVisibleToolBlocks(containerLayout, messageList, messageLayout, 5, 3);
    assertEquals(visibleBlocks.length, 1);
    assertEquals(visibleBlocks[0] === secondGroup, true);
});

Deno.test("chat view keeps sidebar tabs on the first row above a queued steering message", async () => {
    const terminal = new VirtualTerminal({ columns: 150, rows: 20 });
    const tui = new TuiAltScreen(terminal);
    const view = await createChatView({
        tui,
        suppressStartupHeader: true,
        getSessionId: () => "sidebar-session",
        sessionRuntime: {
            getSessionSnapshot: () => ({
                cwd: "/tmp/runwield-sidebar-fixture",
                activeModel: { model: "fixture", provider: "test" },
                managed: { generation: 0 },
                sessionStats: { userMessages: 12, assistantMessages: 0, toolCalls: 0, compactionCount: 0 },
                queuedMessages: [{ id: "steering-1" }],
            }),
        },
        setActiveModel: () => Promise.resolve({ status: "active" }),
    });

    try {
        tui.start();
        for (let index = 1; index <= 12; index++) {
            view.uiAPI.appendUserMessage?.(`message ${index}`);
        }
        view.uiAPI.appendQueuedMessage?.("steering-1", "Queued steering message");
        tui.renderNow(true);
        await terminal.flush();

        const tabs = "Workflow · Session · Artifacts";
        assertStringIncludes(terminal.getScreenText().split("\n")[0], tabs);

        tui.scrollBy(-5);
        tui.renderNow(true);
        await terminal.flush();
        assertStringIncludes(terminal.getScreenText().split("\n")[0], tabs);
    } finally {
        view.dispose();
        tui.stop();
    }
});

Deno.test("chat view keeps block backgrounds out of the sidebar when the scrollbar is visible", async () => {
    const terminal = new VirtualTerminal({ columns: 150, rows: 20 });
    const tui = new TuiAltScreen(terminal);
    const view = await createChatView({
        tui,
        suppressStartupHeader: true,
        getSessionId: () => "sidebar-scrollbar-session",
        sessionRuntime: {
            getSessionSnapshot: () => ({
                cwd: "/tmp/runwield-sidebar-scrollbar-fixture",
                activeModel: { model: "fixture", provider: "test" },
                managed: { generation: 0 },
                sessionStats: { userMessages: 20, assistantMessages: 0, toolCalls: 1, compactionCount: 0 },
            }),
        },
        setActiveModel: () => Promise.resolve({ status: "active" }),
    });

    try {
        tui.start();
        for (let index = 1; index <= 20; index++) {
            view.uiAPI.appendUserMessage?.(`message ${index}`);
        }
        view.uiAPI.startToolExecution?.("tool-1", "bash", "$ echo boundary");
        tui.renderNow(true);
        tui.scrollBy(-2);
        tui.renderNow(true);
        await terminal.flush();

        const lines = terminal.getViewportLines();
        const toolRow = lines.findIndex((line) => line.includes("$ echo boundary"));
        assertEquals(toolRow >= 0, true);
        assertEquals(lines[toolRow].includes("┃"), true);
        assertEquals(terminal.hasDefaultBackground(toolRow, 116), true);
    } finally {
        view.dispose();
        tui.stop();
    }
});

Deno.test("chat view keeps scrollback position during live thinking updates", async () => {
    const terminal = new VirtualTerminal({ columns: 80, rows: 10 });
    const tui = new TuiAltScreen(terminal);
    const view = await createChatView({
        tui,
        suppressStartupHeader: true,
        getSessionId: () => "scroll-session",
        sessionRuntime: {
            getSessionSnapshot: () => ({
                cwd: "/tmp/runwield-scroll-fixture",
                activeModel: { model: "fixture", provider: "test" },
            }),
        },
        setActiveModel: () => Promise.resolve({ status: "active" }),
    });

    try {
        tui.start();
        const appendUserMessage = view.uiAPI.appendUserMessage;
        const appendThinkingStart = view.uiAPI.appendThinkingStart;
        if (!appendUserMessage || !appendThinkingStart) throw new Error("TUI API is incomplete.");
        for (let index = 1; index <= 12; index++) {
            appendUserMessage(`older message ${index}`);
        }
        const thinking = appendThinkingStart();
        thinking.appendDelta("live update before scroll");
        tui.renderNow(true);
        await terminal.flush();

        tui.scrollBy(-5);
        tui.renderNow(true);
        await terminal.flush();
        const before = terminal.getScreenText();
        assertStringIncludes(before, "older message");

        thinking.appendDelta(" and after scroll");
        tui.renderNow(true);
        await terminal.flush();

        assertEquals(terminal.getScreenText(), before);
    } finally {
        view.dispose();
        tui.stop();
    }
});

for (const recovery of ["ctrl+l", "focus"] as const) {
    Deno.test(`chat view restores erased input on ${recovery} without losing draft or scroll position`, async () => {
        const terminal = new VirtualTerminal({ columns: 80, rows: 12 });
        const tui = new RunWieldTui(terminal);
        const focus = installTerminalFocusState(terminal, () => tui.requestRender(true));
        const view = await createChatView({
            tui,
            suppressStartupHeader: true,
            getSessionId: () => "redraw-session",
            sessionRuntime: {
                getSessionSnapshot: () => ({ cwd: "/tmp/redraw-fixture", activeModel: {} }),
            },
            setActiveModel: () => Promise.resolve({ status: "active" }),
        });
        const submissions: string[] = [];
        view.editor.onSubmit = (text) => submissions.push(text);
        try {
            tui.start();
            for (let index = 1; index <= 12; index++) {
                view.uiAPI.appendUserMessage?.(`older message ${index}`);
            }
            view.editor.setText("keep this draft");
            view.uiAPI.setBusy?.(true);
            tui.renderNow();
            tui.scrollBy(-5);
            tui.renderNow();
            await terminal.flush();
            const before = terminal.getScreenText();
            assertStringIncludes(before, "keep this draft");
            assertStringIncludes(before, "─".repeat(20));

            // Simulate screen damage outside the renderer. Its cached frame still
            // contains the input, so an ordinary render cannot restore it.
            terminal.write("\x1b[2J");
            tui.renderNow();
            await terminal.flush();
            assertEquals(terminal.getScreenText().trim(), "");

            if (recovery === "focus") {
                terminal.input("\x1b[O");
                terminal.input("\x1b[");
                terminal.input("I");
            } else {
                terminal.input("\x0c");
            }
            tui.renderNow();
            await terminal.flush();
            assertEquals(terminal.getScreenText(), before);
            assertEquals(view.editor.getText(), "keep this draft");
            assertEquals(submissions, []);
            assertEquals(view.runningTasksComponent.isBusy, true);
            terminal.pressEnter();
            assertEquals(submissions, ["keep this draft"]);
        } finally {
            view.uiAPI.setBusy?.(false);
            focus.dispose();
            view.dispose();
            tui.stop();
        }
    });
}
