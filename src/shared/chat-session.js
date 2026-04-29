/**
 * @module shared/chat-session
 * High-level interactive loop for the TUI. This manages the long-running
 * user interaction — distinct from individual agent invocations (see session.js).
 */

import { Container, Editor, Image, Key, matchesKey, Spacer, Text } from "@mariozechner/pi-tui";
import { initTUI, stopTUI } from "./tui.js";
import { editorTheme, imageTheme, theme } from "./theme.js";
import { readClipboardImage } from "./clipboard.js";
import { createUiApi } from "./ui/api.js";
import { SpinnerBlock } from "./ui/blocks.js";
import { listPlans } from "../plan-store.js";
import { abortActiveSession } from "./session.js";
import { listAvailableAgents } from "./agents.js";
import { createDirectAgentHandler } from "./direct-agent.js";

const UI_PADDING = { x: 0, y: 0 };

let activeAgentName = "Router";
/** @type {((userRequest: string, images: any[], uiAPI: import('./workflow.js').UiAPI) => Promise<void>) | null} */
let activeOnMessage = null;

/**
 * Update the active agent and its message handler dynamically.
 * @param {string} agentName
 * @param {(userRequest: string, images: any[], uiAPI: import('./workflow.js').UiAPI) => Promise<void>} handler
 */
export function setActiveAgent(agentName, handler) {
    activeAgentName = agentName;
    activeOnMessage = handler;
}

let currentAgentModel = "";

/**
 * @param {string} model
 */
export function setActiveModel(model) {
    currentAgentModel = model;
}

/**
 * Starts the interactive TUI loop.
 * @param {string | null} initialUserRequest
 * @param {((userRequest: string, images: any[], uiAPI: import('./workflow.js').UiAPI) => Promise<void>) | null} onMessage - Handler for user submissions
 */
// deno-lint-ignore require-await
export async function startInteractiveSession(initialUserRequest, onMessage) {
    activeOnMessage = onMessage;
    const tui = initTUI();

    const container = new Container();

    // Header
    container.addChild(new Spacer(1));
    container.addChild(
        new Text(
            theme.fg("accent", theme.bold("Harns ─ Plan-by-Default Harness")),
            UI_PADDING.x,
            UI_PADDING.y,
        ),
    );
    container.addChild(new Spacer(1));

    const messageList = new Container();
    container.addChild(messageList);
    container.addChild(new Spacer(1));

    const runningTasksComponent = new SpinnerBlock();
    container.addChild(runningTasksComponent);

    /** @type {Array<{base64: string, mimeType: string}>} */
    const pastedImages = [];
    const previewImages = new Container();
    container.addChild(previewImages);

    const editor = new Editor(tui, editorTheme);
    container.addChild(editor);

    // Footer
    const cwd = Deno.cwd().replace(Deno.env.get("HOME") || "", "~");
    let branch = "main";
    try {
        const cmd = new Deno.Command("git", { args: ["branch", "--show-current"] });
        const { success, stdout } = cmd.outputSync();
        if (success) {
            branch = new TextDecoder().decode(stdout).trim();
        }
    } catch (_e) {
        branch = "unknown";
    }

    const getModelAndProvider = () => {
        let model = "gemini-2.5-flash";
        let provider = "unknown";
        try {
            const homeDir = Deno.env.get("HOME") || "";
            /** @type {Record<string, any>} */
            let settings = {};
            try {
                const globalPath = `${homeDir}/.pi/agent/settings.json`;
                settings = JSON.parse(Deno.readTextFileSync(globalPath));
            } catch (_e) { /* ignore */ }
            try {
                const localPath = `${Deno.cwd()}/.pi/settings.json`;
                const projSettings = JSON.parse(Deno.readTextFileSync(localPath));
                settings = { ...settings, ...projSettings };
            } catch (_e) { /* ignore */ }

            if (settings.defaultModel) model = settings.defaultModel;
            if (settings.defaultProvider) provider = settings.defaultProvider;

            if (currentAgentModel) {
                model = currentAgentModel;
            }
        } catch (_e) { /* ignore */ }

        return { model, provider };
    };

    const footer = {
        invalidate: () => {},
        /** @param {number} w */
        render: (w) => {
            const { model, provider } = getModelAndProvider();
            const leftStr = `${cwd} (${branch})`;
            const rightStr = `(${provider}) ${model}`;
            const spaceCount = Math.max(0, w - leftStr.length - rightStr.length);
            const agentLine = " ".repeat(Math.max(0, w - activeAgentName.length)) +
                theme.fg("accent", activeAgentName);
            return [
                agentLine,
                theme.fg("dim", leftStr + " ".repeat(spaceCount) + rightStr),
            ];
        },
    };
    container.addChild(footer);

    const rootWrapper = {
        invalidate: () => container.invalidate(),
        /** @param {number} w */
        render: (w) => {
            const rightMargin = 2;
            const rendered = container.render(Math.max(10, w - rightMargin));
            return rendered;
        },
    };

    tui.addChild(rootWrapper);
    tui.setFocus(editor);

    const autocompleteProvider = {
        /**
         * @param {string[]} lines
         * @param {number} cursorLine
         * @param {number} cursorCol
         * @param {any} _options
         */
        async getSuggestions(lines, cursorLine, cursorCol, _options) {
            const currentLine = lines[cursorLine] || "";
            const textBeforeCursor = currentLine.slice(0, cursorCol);

            if (textBeforeCursor.startsWith("/") && !textBeforeCursor.includes(" ")) {
                const prefix = textBeforeCursor.slice(1);
                const commandDefs = [
                    {
                        name: "quit",
                        aliases: ["exit", "q"],
                        description: "Exit the application",
                    },
                    { name: "resume", aliases: [], description: "Resume a saved plan" },
                    { name: "agent", aliases: [], description: "Switch active agent" },
                ];

                const items = [];
                for (const cmd of commandDefs) {
                    const matchTarget = [cmd.name, ...cmd.aliases];
                    if (matchTarget.some((t) => t.startsWith(prefix))) {
                        items.push({
                            value: cmd.name,
                            label: cmd.name,
                            description: cmd.description,
                        });
                    }
                }
                if (items.length === 0) return null;
                return { items, prefix: textBeforeCursor };
            }

            if (textBeforeCursor.startsWith("/resume ")) {
                const prefix = textBeforeCursor.slice(8);
                const plans = await listPlans(Deno.cwd());
                const items = plans
                    .filter((p) => p.name.startsWith(prefix))
                    .map((p) => ({
                        value: p.name,
                        label: p.name,
                        description: `${p.attrs.classification} - ${p.attrs.status}`,
                    }));
                if (items.length === 0) return null;
                return { items, prefix };
            }

            if (textBeforeCursor.startsWith("/agent ")) {
                const prefix = textBeforeCursor.slice(7);
                const agents = await listAvailableAgents();
                const items = [
                    { value: "router", label: "router", description: "Reset to default router (triage) flow" },
                    ...agents
                        .filter((a) => a.name.startsWith(prefix))
                        .map((a) => ({
                            value: a.name,
                            label: a.name,
                            description: a.description,
                        })),
                ].filter((item) => item.value.startsWith(prefix));
                if (items.length === 0) return null;
                return { items, prefix };
            }

            return null;
        },
        /**
         * @param {string[]} lines
         * @param {number} cursorLine
         * @param {number} cursorCol
         * @param {any} item
         * @param {string} prefix
         */
        applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
            const currentLine = lines[cursorLine] || "";
            const beforePrefix = currentLine.slice(0, cursorCol - prefix.length);
            const afterCursor = currentLine.slice(cursorCol);

            let newLine;
            let offset;
            if (beforePrefix === "") {
                newLine = `/${item.value} ${afterCursor}`;
                offset = item.value.length + 2;
            } else {
                newLine = `${beforePrefix}${item.value}${afterCursor}`;
                offset = beforePrefix.length + item.value.length;
            }

            const newLines = [...lines];
            newLines[cursorLine] = newLine;
            return { lines: newLines, cursorLine, cursorCol: offset };
        },
    };
    editor.setAutocompleteProvider(autocompleteProvider);

    // Expose a UI API for agents to append to the message list
    const uiAPI = createUiApi(tui, messageList, runningTasksComponent);

    // Chat session specific UI overrides/extensions
    uiAPI.setAgentInfo = (agentName, agentModel) => {
        activeAgentName = agentName;
        currentAgentModel = agentModel;
        tui.requestRender();
    };

    uiAPI.disableInput = () => {
        if (editor) {
            editor.disableSubmit = true;
            tui.requestRender();
        }
    };

    uiAPI.enableInput = () => {
        if (editor) {
            editor.disableSubmit = false;
            tui.requestRender();
        }
    };

    uiAPI.appendImage = (base64, mimeType) => {
        const img = new Image(base64, mimeType, imageTheme, {
            maxWidthCells: 60,
            maxHeightCells: 20,
        });
        messageList.addChild(img);
        tui.requestRender();
    };

    // @ts-ignore: TS doesn't know about pi-tui Editor internals
    editor.onFocus = () => {
        try {
            tui.requestRender();
        } catch (_e) {
            // Ignore
        }
    };
    // @ts-ignore: TS doesn't know about pi-tui Editor internals
    editor.onBlur = () => {
        try {
            tui.requestRender();
        } catch (_e) {
            // Ignore
        }
    };
    editor.onChange = () => {
        try {
            tui.requestRender();
        } catch (_e) {
            // Ignore
        }
    };

    // Handle Editor events
    editor.onSubmit = async (text) => {
        const userRequest = text.trim();
        if (!userRequest) return;

        /** @type {any} */ (editor).addToHistory(userRequest);

        if (userRequest === "/quit" || userRequest === "/exit" || userRequest === "/q") {
            editor.setText("");
            tui.requestRender();
            setTimeout(() => {
                stopTUI();
                setTimeout(() => Deno.exit(0), 100);
            }, 50);
            return;
        }

        if (userRequest.startsWith("/")) {
            const [rawCmd, ...args] = userRequest.slice(1).split(" ");
            const cmd = rawCmd.trim();

            // Built-in /agent command
            if (cmd === "agent") {
                editor.setText("");
                const targetName = args.join(" ").trim();

                if (targetName === "router") {
                    // Reset to default router flow
                    const { routerCmdOnMessage } = await import("../cmd/router/index.js");
                    setActiveAgent("Router", routerCmdOnMessage);
                    uiAPI.appendSystemMessage("Switched to Router (triage flow).");
                    tui.setFocus(editor);
                    return;
                }

                if (targetName) {
                    // Direct switch: /agent <name>
                    const agents = await listAvailableAgents();
                    const match = agents.find((a) => a.name === targetName);
                    if (!match) {
                        uiAPI.appendSystemMessage(
                            `Unknown agent: "${targetName}". Use /agent to see available agents.`,
                        );
                        tui.setFocus(editor);
                        return;
                    }
                    const handler = createDirectAgentHandler(targetName);
                    setActiveAgent(match.displayName, handler);
                    uiAPI.appendSystemMessage(`Switched to ${match.displayName}.`);
                    tui.setFocus(editor);
                    return;
                }

                // No args: show interactive selection
                const agents = await listAvailableAgents();
                const options = [
                    { value: "router", label: "router — Reset to default router (triage flow)" },
                    ...agents.map((a) => ({
                        value: a.name,
                        label: `${a.name} — ${a.description}`,
                    })),
                ];

                const chosen = await uiAPI.promptSelect("Switch agent:", options);
                if (!chosen) {
                    tui.setFocus(editor);
                    return; // cancelled
                }

                if (chosen === "router") {
                    const { routerCmdOnMessage } = await import("../cmd/router/index.js");
                    setActiveAgent("Router", routerCmdOnMessage);
                    uiAPI.appendSystemMessage("Switched to Router (triage flow).");
                } else {
                    const handler = createDirectAgentHandler(chosen);
                    const match = agents.find((a) => a.name === chosen);
                    setActiveAgent(match?.displayName || chosen, handler);
                    uiAPI.appendSystemMessage(`Switched to ${match?.displayName || chosen}.`);
                }
                tui.setFocus(editor);
                return;
            }

            const { commandRegistry } = await import("../cmd/registry.js");

            if (commandRegistry[cmd]) {
                editor.disableSubmit = true;
                try {
                    await commandRegistry[cmd](args, {
                        uiAPI,
                        editor,
                        tui,
                        originalHandleInput,
                        text, // pass raw text so handlers can check spacing
                    });
                } catch (err) {
                    uiAPI.appendSystemMessage(
                        `Error: ${err instanceof Error ? err.message : String(err)}`,
                    );
                } finally {
                    editor.disableSubmit = false;
                }
            } else {
                uiAPI.appendSystemMessage(`Unknown command: /${cmd}`);
                editor.setText("");
                editor.disableSubmit = false;
            }
            return;
        }

        editor.disableSubmit = true;
        editor.setText("");

        const images = [...pastedImages];
        pastedImages.length = 0;
        previewImages.clear();

        uiAPI.appendUserMessage(userRequest);
        images.forEach((img) => {
            if (uiAPI.appendImage) uiAPI.appendImage(img.base64, img.mimeType);
        });

        try {
            if (activeOnMessage) {
                await activeOnMessage(userRequest, images, uiAPI);
            } else {
                uiAPI.appendSystemMessage("Error: No active agent handler.");
            }
        } catch (err) {
            uiAPI.appendSystemMessage(
                `Error: ${err instanceof Error ? err.message : String(err)}`,
            );
        } finally {
            editor.disableSubmit = false;
            if (uiAPI.setBusy) uiAPI.setBusy(false);
            if (uiAPI.enableInput) uiAPI.enableInput();
        }
    };

    // Re-render UI after handling pasted images
    tui.requestRender();

    let lastCtrlC = 0;

    // Custom keybindings for Editor
    const originalHandleInput = editor.handleInput.bind(editor);
    /** @param {any} data */
    editor.handleInput = async (data) => {
        // Intercept Esc to abort agent
        if (matchesKey(data, Key.escape)) {
            uiAPI.appendSystemMessage("[Harns] Canceling operation...");
            abortActiveSession();
            tui.requestRender();
            return;
        }

        // Intercept Ctrl+C
        if (matchesKey(data, Key.ctrl("c"))) {
            const now = Date.now();
            if (now - lastCtrlC < 1000) {
                stopTUI();
                setTimeout(() => Deno.exit(0), 100);
                return;
            } else {
                lastCtrlC = now;
                uiAPI.appendSystemMessage("[Harns] Keyboard interrupt. Press again to quit.");
                abortActiveSession();
                tui.requestRender();
                return;
            }
        }

        // Check if Enter is pressed and text matches /quit exactly
        if (matchesKey(data, Key.enter) || matchesKey(data, Key.return)) {
            const currentText = /** @type {any} */ (editor).getText().trim();
            if (currentText === "/quit" || currentText === "/exit" || currentText === "/q") {
                editor.setText("");
                tui.requestRender();
                setTimeout(() => {
                    stopTUI();
                    setTimeout(() => Deno.exit(0), 100);
                }, 50);
                return;
            }
        }

        // Ctrl+V for paste image
        if (matchesKey(data, Key.ctrl("v"))) {
            const img = await readClipboardImage();
            if (img) {
                pastedImages.push(img);
                previewImages.addChild(
                    new Text(theme.fg("dim", `[Attached image: ${img.mimeType}]`)),
                );
                tui.requestRender();
            }
            return;
        }
        // Shift+Enter or Alt+Enter for new line
        if (
            matchesKey(data, Key.shift("enter")) || matchesKey(data, Key.alt("enter"))
        ) {
            /** @type {any} */ (editor).addNewLine();
            tui.requestRender();
            return;
        }
        // Delete pasted images when editor is empty
        if (
            matchesKey(data, Key.backspace) && /** @type {any} */
            (editor).isEditorEmpty() && pastedImages.length > 0
        ) {
            pastedImages.pop();
            const lastChild = previewImages.children[previewImages.children.length - 1];
            if (lastChild) previewImages.removeChild(lastChild);
            tui.requestRender();
            return;
        }
        originalHandleInput(data);
    };

    // Trigger initial user request
    if (initialUserRequest) {
        editor.setText(initialUserRequest);
        editor.onSubmit(initialUserRequest);
    }

    return uiAPI;
}
