import { assertEquals, assertStringIncludes } from "@std/assert";
import { Container, Spacer, Text, TuiAltScreen } from "@earendil-works/pi-tui";
import { createChatView, findVisibleToolBlocks } from "./chat-view.ts";
import { ToolExecutionGroupBlock } from "./blocks.js";
import { VirtualTerminal } from "./testing/virtual-terminal.js";
import { RunWieldTui } from "./tui.ts";
import { installTerminalFocusState } from "./terminal-focus-state.ts";

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
