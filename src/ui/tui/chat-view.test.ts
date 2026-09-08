import { assertEquals, assertStringIncludes } from "@std/assert";
import { TuiAltScreen } from "@earendil-works/pi-tui";
import { createChatView } from "./chat-view.ts";
import { VirtualTerminal } from "./testing/virtual-terminal.js";

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
