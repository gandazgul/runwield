import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { TuiAltScreen } from "@earendil-works/pi-tui";
import { createChatView } from "./chat-view.ts";
import { VirtualTerminal } from "./testing/virtual-terminal.js";
import { mascotForAgent } from "../mascot/mascot.ts";

Deno.test("live TUI reserves mascot space and pauses for questions without covering input", async () => {
    const terminal = new VirtualTerminal({ columns: 150, rows: 45 });
    const tui = new TuiAltScreen(terminal);
    let agentName = "operator";
    const view = await createChatView({
        tui,
        suppressStartupHeader: true,
        getSessionId: () => "mascot-session",
        sessionRuntime: {
            getSessionSnapshot: () => ({
                cwd: "/tmp/mascot-view",
                activeModel: {},
                managed: { generation: 0 },
                activeAgent: agentName,
            }),
        },
        setActiveModel: () => Promise.resolve({ status: "active" }),
    });
    try {
        tui.start();
        view.editor.setText("Preserve this draft");
        view.uiAPI.appendUserMessage?.("Keep the conversation visible");
        view.uiAPI.setBusy?.(true);
        tui.renderNow(true);
        await terminal.flush();
        const screen = terminal.getScreenText();
        assertStringIncludes(screen, "Preserve this draft");
        assertStringIncludes(screen, "Keep the conversation visible");
        const drawing = mascotForAgent("operator")!.frames[0].lines.filter((line) => line.trim());
        for (const line of drawing) assertStringIncludes(screen, line.trimEnd());
        const question = view.uiAPI.promptText("Your answer?");
        tui.renderNow(true);
        await terminal.flush();
        assertEquals(view.runningTasksComponent.isBusy, false);
        assertStringIncludes(terminal.getScreenText(), "Your answer?");
        view.uiAPI.abortActivePrompt();
        await question;
        view.uiAPI.setBusy?.(false);
        agentName = "recorder";
        tui.renderNow(true);
        await terminal.flush();
        assert(!terminal.getScreenText().includes("██   ██"));
        agentName = "operator";
        terminal.resize(60, 16);
        tui.renderNow(true);
        await terminal.flush();
        assertStringIncludes(terminal.getScreenText(), "▛▀▀▀▀▀▜");
        assertStringIncludes(terminal.getScreenText(), "Preserve this draft");
    } finally {
        view.uiAPI.dispose?.();
        view.dispose();
        tui.stop();
    }
});
