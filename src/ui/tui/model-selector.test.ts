import { assertEquals, assertInstanceOf, assertStringIncludes } from "@std/assert";
import { Container, Editor, type TUI, TuiMainScreen } from "@earendil-works/pi-tui";
import { withRuntimeCommandFixture } from "../../cmd/testing/runtime-command-fixture.ts";
import { getModelRegistry } from "../../shared/models/model-registry.ts";
import { getEditorTheme, initRunWieldTheme } from "../theme/theme.js";
import { VirtualTerminal } from "./testing/virtual-terminal.js";
import { RunWieldModelSelectorComponent } from "./model-selector.ts";

class CompatibleVirtualTerminal extends VirtualTerminal {
    override drainInput(): Promise<void> {
        return Promise.resolve();
    }

    override moveBy(lines: number, columns?: number): void {
        super.moveBy(lines, columns ?? 0);
    }

    override setProgress(active: boolean | number | null): void {
        super.setProgress(typeof active === "boolean" ? (active ? 1 : null) : active);
    }
}

function makeTui(): { tui: TUI; terminal: CompatibleVirtualTerminal; container: Container; editor: Editor } {
    initRunWieldTheme();
    const terminal = new CompatibleVirtualTerminal({ columns: 120, rows: 34 });
    const tui = new TuiMainScreen(terminal);
    const container = new Container();
    const editor = new Editor(tui, getEditorTheme());
    container.addChild(editor);
    tui.addChild(container);
    return { tui, terminal, container, editor };
}

Deno.test("^TUI model selector exposes Pi and Claude CLI models without API auth$", async () => {
    await withRuntimeCommandFixture("model-selector-mixed-", async () => {
        const { tui, container, editor } = makeTui();
        const selected: Array<{ id: string; provider: string }> = [];
        try {
            const registry = getModelRegistry();
            await registry.getRuntime();
            const currentModel = registry.find("runtime-command-fixture", "fixture-model");
            const selector = new RunWieldModelSelectorComponent({
                tui,
                currentModel,
                modelRegistry: registry,
                onSelect: (model) => {
                    selected.push({ id: model.id, provider: model.provider });
                },
                onCancel: () => container.children.splice(container.children.indexOf(selector), 1, editor),
            });
            container.children.splice(container.children.indexOf(editor), 1, selector);
            tui.setFocus(selector);
            tui.requestRender();

            const initialScreen = selector.render(120).join("\n");
            assertStringIncludes(initialScreen, "runtime-command-fixture/fixture-model");
            assertStringIncludes(initialScreen, "claude-cli/sonnet");
            assertStringIncludes(initialScreen, "Claude CLI");
            assertStringIncludes(initialScreen, "Use /login to add API providers");
            assertStringIncludes(initialScreen, "Claude CLI choices require Claude Code installed and signed in");
            assertStringIncludes(initialScreen, "current");

            selector.handleInput("haiku");
            const filteredScreen = selector.render(120).join("\n");
            assertStringIncludes(filteredScreen, "claude-cli/haiku");
            assertStringIncludes(filteredScreen, "Claude Code must be installed and signed in");
            assertEquals(filteredScreen.includes("runtime-command-fixture/fixture-model"), false);

            selector.handleInput("\r");
            assertEquals(selected, [{ id: "haiku", provider: "claude-cli" }]);
        } finally {
            tui.stop();
        }
    });
});

Deno.test("TUI model selector cancellation leaves selection callbacks untouched", async () => {
    await withRuntimeCommandFixture("model-selector-cancel-", async () => {
        const { tui } = makeTui();
        let selected = false;
        let cancelled = false;
        try {
            const registry = getModelRegistry();
            await registry.getRuntime();
            const selector = new RunWieldModelSelectorComponent({
                tui,
                modelRegistry: registry,
                onSelect: () => {
                    selected = true;
                },
                onCancel: () => {
                    cancelled = true;
                },
            });
            assertInstanceOf(selector, RunWieldModelSelectorComponent);
            selector.handleInput("\x1b");
            assertEquals(selected, false);
            assertEquals(cancelled, true);
        } finally {
            tui.stop();
        }
    });
});
