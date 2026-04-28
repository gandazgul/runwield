/**
 * @module shared/chat-session
 * High-level interactive loop for the TUI. This manages the long-running
 * user interaction — distinct from individual agent invocations (see session.js).
 */

import { Container, Editor, Image, Key, Markdown, matchesKey, SelectList, Spacer, Text } from "@mariozechner/pi-tui";
import { initTUI, stopTUI } from "./tui.js";
import { editorTheme, imageTheme, markdownTheme, selectListTheme, theme } from "./theme.js";
import { readClipboardImage } from "./clipboard.js";
import { listPlans } from "../plan-store.js";

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
    const uiAPI = {
        /** @param {string} text */
        appendUserMessage: (text) => {
            messageList.addChild(
                new Text(
                    theme.fg("accent", theme.bold("You:")),
                    UI_PADDING.x,
                    UI_PADDING.y,
                ),
            );
            messageList.addChild(
                new Markdown(text, UI_PADDING.x, UI_PADDING.y, markdownTheme),
            );
            messageList.addChild(new Spacer(1));
            tui.requestRender();
        },
        /** @param {string} agentName */
        appendAgentMessageStart: (agentName) => {
            messageList.addChild(
                new Text(
                    theme.fg("success", theme.bold(`${agentName}:`)),
                    UI_PADDING.x,
                    UI_PADDING.y,
                ),
            );
            let currentText = "";
            const md = new Markdown("", UI_PADDING.x, UI_PADDING.y, markdownTheme);
            messageList.addChild(md);
            messageList.addChild(new Spacer(1));
            tui.requestRender();
            try {
                tui.requestRender();
            } catch (_e) {
                // Ignore render errors during initialization
            }
            return {
                /** @param {string} delta */
                appendText: (delta) => {
                    currentText += delta;
                    md.setText(currentText);
                    tui.requestRender();
                },
            };
        },
        /** @param {string} text */
        appendSystemMessage: (text) => {
            messageList.addChild(
                new Text(theme.fg("dim", text), UI_PADDING.x, UI_PADDING.y),
            );
            tui.requestRender();
        },
        /**
         * @param {string} title
         * @param {Array<{value: string, label: string}>} options
         */
        promptSelect: (title, options) => {
            return new Promise((resolve) => {
                const container = new Container();
                container.addChild(
                    new Text("─".repeat(40), UI_PADDING.x, UI_PADDING.y),
                );
                container.addChild(
                    new Text(
                        theme.fg("accent", theme.bold(title)),
                        UI_PADDING.x,
                        UI_PADDING.y,
                    ),
                );
                container.addChild(
                    new Text("─".repeat(40), UI_PADDING.x, UI_PADDING.y),
                );

                const selectList = new SelectList(
                    options,
                    Math.min(options.length, 10),
                    selectListTheme,
                );

                const cleanup = () => {
                    messageList.removeChild(container);
                    tui.setFocus(editor);
                    tui.requestRender();
                };

                selectList.onSelect = (item) => {
                    cleanup();
                    resolve(item.value);
                };

                selectList.onCancel = () => {
                    cleanup();
                    resolve(null);
                };

                container.addChild(selectList);
                container.addChild(
                    new Text("─".repeat(40), UI_PADDING.x, UI_PADDING.y),
                );
                container.addChild(
                    new Text(
                        theme.fg("dim", "↑↓ navigate • enter select • esc cancel"),
                        UI_PADDING.x,
                        UI_PADDING.y,
                    ),
                );

                messageList.addChild(container);
                tui.setFocus(selectList);
                tui.requestRender();
            });
        },
        /**
         * @param {string} base64
         * @param {string} mimeType
         */
        appendImage: (base64, mimeType) => {
            const img = new Image(base64, mimeType, imageTheme, {
                maxWidthCells: 60,
                maxHeightCells: 20,
            });
            messageList.addChild(img);
            tui.requestRender();
        },
        requestRender: () => {
            tui.requestRender();
        },
        /**
         * @param {string} agentName
         * @param {string} agentModel
         */
        setAgentInfo: (agentName, agentModel) => {
            activeAgentName = agentName;
            currentAgentModel = agentModel;
            tui.requestRender();
        },
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
        images.forEach((img) => uiAPI.appendImage(img.base64, img.mimeType));

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
        }
    };

    // Re-render UI after handling pasted images
    tui.requestRender();

    // Custom keybindings for Editor
    const originalHandleInput = editor.handleInput.bind(editor);
    /** @param {any} data */
    editor.handleInput = async (data) => {
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
