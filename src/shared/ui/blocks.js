import { Container, Input, Key, Markdown, matchesKey, SelectList, Spacer, Text } from "@mariozechner/pi-tui";
import { markdownTheme, selectListTheme, theme } from "../ui/theme.js";

/**
 * Format system line text. If line starts with a bracketed prefix (e.g. `[Harns]`),
 * render the prefix in accent/error color without brackets to avoid terminal glyph
 * alignment issues for `[` in some fonts.
 *
 * @param {string} text
 * @param {boolean} isError
 * @returns {string}
 */
function formatSystemLine(text, isError) {
    const baseColor = isError ? "error" : "dim";
    const prefixMatch = text.match(/^\[([^\]]+)\]\s*(.*)$/);

    if (!prefixMatch) {
        return theme.fg(baseColor, text);
    }

    const [, prefix, rest] = prefixMatch;
    const prefixColor = isError ? "error" : "accent";
    const renderedPrefix = theme.fg(prefixColor, theme.bold(prefix));

    if (!rest) return renderedPrefix;
    return `${renderedPrefix} ${theme.fg(baseColor, rest)}`;
}

/**
 * @param {string[]} lines
 * @param {string} bgColor
 */
function applyBackground(lines, bgColor) {
    return lines.map((line) => theme.bg(bgColor, line));
}

/**
 * A block with a background color that stretches to full width.
 */
export class ColoredBlock {
    /**
     * @param {string} bgColor
     * @param {{ render: (w: number) => string[], invalidate?: () => void } | null | undefined} child - pi-tui component with render(w) method
     */
    constructor(bgColor, child) {
        this.bgColor = bgColor;
        this.child = child;
    }

    invalidate() {
        if (this.child && typeof this.child.invalidate === "function") {
            this.child.invalidate();
        }
    }

    /** @param {number} w */
    render(w) {
        if (!this.child) return [];
        const lines = this.child.render(w);
        return applyBackground(lines, this.bgColor);
    }
}

/**
 * A block that adds horizontal and vertical padding around a child.
 */
export class PaddedBlock {
    /**
     * @param {number} paddingX
     * @param {number} paddingY
     * @param {{ render: (w: number) => string[], invalidate?: () => void } | null | undefined} child
     */
    constructor(paddingX, paddingY, child) {
        this.paddingX = paddingX;
        this.paddingY = paddingY;
        this.child = child;
    }

    invalidate() {
        if (this.child && typeof this.child.invalidate === "function") {
            this.child.invalidate();
        }
    }

    /** @param {number} w */
    render(w) {
        if (!this.child) return [];
        const innerW = Math.max(0, w - this.paddingX * 2);
        const innerLines = this.child.render(innerW);

        const padX = " ".repeat(this.paddingX);
        const emptyLine = " ".repeat(w);

        const lines = innerLines.map((/** @type {string} */ line) => {
            // deno-lint-ignore no-control-regex
            const visibleLength = line.replace(/\x1b\[[0-9;]*m/g, "").length;
            const rightPad = " ".repeat(Math.max(0, w - this.paddingX - visibleLength));
            return padX + line + rightPad;
        });

        const padY = [];
        for (let i = 0; i < this.paddingY; i++) {
            padY.push(emptyLine);
        }

        return [...padY, ...lines, ...padY];
    }
}

/**
 * The User Prompt Block.
 */
export class UserPromptBlock {
    /** @param {string} text */
    constructor(text) {
        this.container = new Container();
        this.container.addChild(new Text(theme.fg("text", text), 0, 0));

        // Wrap the container in a colored block
        this.block = new ColoredBlock("surface0", new PaddedBlock(2, 1, this.container));
    }

    invalidate() {
        this.block.invalidate();
    }

    /** @param {number} w */
    render(w) {
        return this.block.render(w);
    }
}

/**
 * The Tool Execution Block.
 * Contains a header (e.g. `ls .`), a body for streaming output, and a footer (`Took X.Xs`).
 */
export class ToolExecutionBlock {
    /**
     * @param {string} toolName
     * @param {string} argsStr
     */
    constructor(toolName, argsStr) {
        this.container = new Container();

        this.previewLineLimit = 6;
        this.expanded = false;
        this.durationStr = "";

        // Header
        const commandText = argsStr.trim();
        const headerText = commandText ? `${toolName} ${commandText}` : toolName;
        this.header = new ColoredBlock(
            "surface1",
            new PaddedBlock(2, 1, new Text(theme.fg("text", theme.bold(headerText)), 0, 0)),
        );
        this.container.addChild(this.header);

        // Body
        this.bodyContainer = new Container();
        // Body wrapper gets surface0 normally, or a different color if error occurs.
        this.bodyBlock = new ColoredBlock("surface0", new PaddedBlock(2, 0, this.bodyContainer));
        this.container.addChild(this.bodyBlock);

        // Footer (left: duration, right: expand/collapse hint)
        this.footerContainer = new Container();
        this.footerLine = {
            invalidate: () => {},
            /** @param {number} w */
            render: (w) => {
                const canExpand = this.getOutputLines().length > this.previewLineLimit;
                const left = this.durationStr ? theme.fg("dim", this.durationStr) : "";
                const right = canExpand
                    ? theme.fg("dim", this.expanded ? "press ctrl+o to collapse" : "press ctrl+o to expand")
                    : "";

                if (!left && !right) return [];

                // deno-lint-ignore no-control-regex
                const visibleLength = (/** @type {string} */ line) => line.replace(/\x1b\[[0-9;]*m/g, "").length;

                if (!left) {
                    const rightPad = " ".repeat(Math.max(0, w - visibleLength(right)));
                    return [`${rightPad}${right}`];
                }

                if (!right) {
                    return [left];
                }

                const leftLen = visibleLength(left);
                const rightLen = visibleLength(right);

                if (leftLen + 1 + rightLen <= w) {
                    const spacing = " ".repeat(Math.max(1, w - leftLen - rightLen));
                    return [`${left}${spacing}${right}`];
                }

                const rightPad = " ".repeat(Math.max(0, w - rightLen));
                return [left, `${rightPad}${right}`];
            },
        };
        this.footerContainer.addChild(this.footerLine);
        this.footerBlock = new ColoredBlock("surface1", new PaddedBlock(2, 1, this.footerContainer));
        this.container.addChild(this.footerBlock);

        // Store body text
        this.bodyText = "";
        this.bodyTextComponent = new Text("", 0, 0);
        this.bodyContainer.addChild(this.bodyTextComponent);

        this.isError = false;

        // For animation in footer, we can store startTime
        this.startTime = Date.now();
    }

    /**
     * @returns {string[]}
     */
    getOutputLines() {
        if (!this.bodyText) return [];
        return this.bodyText.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
    }

    updateBodyText() {
        const lines = this.getOutputLines();
        const shown = !this.expanded && lines.length > this.previewLineLimit
            ? lines.slice(0, this.previewLineLimit)
            : lines;
        const renderedText = shown.join("\n");
        this.bodyTextComponent.setText(
            this.isError ? theme.fg("error", renderedText) : theme.fg("subtext0", renderedText),
        );
    }

    /** @param {boolean} expanded */
    setExpanded(expanded) {
        this.expanded = expanded;
        this.updateBodyText();
        this.invalidate();
    }

    /** @param {string} text */
    appendOutput(text) {
        this.bodyText += text;
        this.updateBodyText();
        this.invalidate();
    }

    /**
     * @param {boolean} isError
     * @param {number} durationMs
     */
    endExecution(isError, durationMs) {
        this.isError = isError;

        if (isError) {
            this.header.bgColor = "maroon"; // Highlight header in red on error
            this.bodyBlock.bgColor = "mantle"; // Darker background for error body
            this.footerBlock.bgColor = "maroon";
        }

        this.durationStr = `Took ${(durationMs / 1000).toFixed(1)}s`;
        this.updateBodyText();
        this.invalidate();
    }

    invalidate() {
        this.container.invalidate();
    }

    /** @param {number} w */
    render(w) {
        return this.container.render(w);
    }
}

/**
 * System Message Block.
 */
export class SystemMessageBlock {
    /**
     * @param {string} text
     * @param {boolean} [isError=false]
     */
    constructor(text, isError = false) {
        this.container = new Container();
        this.isError = isError;
        this.container.addChild(new Text(formatSystemLine(text, isError), 0, 0));
        this.block = new ColoredBlock("mantle", new PaddedBlock(2, 1, this.container));
    }

    /** @param {string} text */
    appendText(text) {
        this.container.addChild(new Text(formatSystemLine(text, this.isError), 0, 0));
        this.invalidate();
    }

    invalidate() {
        this.block.invalidate();
    }

    /** @param {number} w */
    render(w) {
        return this.block.render(w);
    }
}

/**
 * Agent Message Block (Markdown).
 */
export class AgentMessageBlock {
    /** @param {string} agentName */
    constructor(agentName) {
        this.container = new Container();

        if (agentName) {
            this.container.addChild(new Text(theme.fg("success", theme.bold(`${agentName}:`)), 0, 0));
        }

        this.currentText = "";
        // We override theme to ensure code blocks and lists look good with catppuccin
        this.markdown = new Markdown("", 0, 0, markdownTheme);
        this.container.addChild(this.markdown);
        this.container.addChild(new Spacer(1));

        this.block = new ColoredBlock("crust", new PaddedBlock(2, 1, this.container));
    }

    /** @param {string} delta */
    appendText(delta) {
        this.currentText += delta;
        this.markdown.setText(this.currentText);
        this.invalidate();
    }

    invalidate() {
        this.block.invalidate();
    }

    /** @param {number} w */
    render(w) {
        return this.block.render(w);
    }
}

/**
 * SelectList subclass that filters by substring across value, label, and description.
 */
class SearchableSelectList extends SelectList {
    /**
     * @param {import("@mariozechner/pi-tui").SelectItem[]} items
     * @param {number} maxVisible
     * @param {import("@mariozechner/pi-tui").SelectListTheme} theme
     * @param {import("@mariozechner/pi-tui").SelectListLayoutOptions} [layout]
     */
    constructor(items, maxVisible, theme, layout = {}) {
        super(items, maxVisible, theme, layout);
    }

    /** @override */
    // @ts-ignore: SelectList private fields not accessible to subclass in TS
    setFilter(filter) {
        const lower = filter.toLowerCase();
        // @ts-ignore: SelectList private fields not accessible to subclass in TS
        this.filteredItems = this.items.filter((/** @type {import("@mariozechner/pi-tui").SelectItem} */ item) =>
            item.value.toLowerCase().includes(lower) ||
            (item.label && item.label.toLowerCase().includes(lower))
        );
        // @ts-ignore: SelectList private fields not accessible to subclass in TS
        this.selectedIndex = 0;
    }
}

/**
 * Prompt Select Block
 * Embeds a searchable SelectList vertically in the chat stream.
 */
export class PromptSelectBlock {
    /**
     * @param {string} promptTitle
     * @param {import("@mariozechner/pi-tui").SelectItem[]} items
     * @param {string} [hint]
     */
    constructor(promptTitle, items, hint = "") {
        this.container = new Container();

        // Header
        const headerText = theme.fg("text", theme.bold(promptTitle));
        this.header = new ColoredBlock("surface1", new PaddedBlock(2, 1, new Text(headerText, 0, 0)));
        this.container.addChild(this.header);

        // Search input
        this.input = new Input();
        this.searchBlock = new ColoredBlock("surface0", new PaddedBlock(2, 0, this.input));
        this.container.addChild(this.searchBlock);

        // Body with SelectList
        this.list = new SearchableSelectList(items, Math.min(items.length, 10), selectListTheme);

        this.bodyBlock = new ColoredBlock("surface0", new PaddedBlock(2, 0, this.list));
        this.container.addChild(this.bodyBlock);

        // Footer with hint
        const hintText = hint || "Type to search, arrows to navigate, Enter to select, Esc to cancel";
        this.footer = new ColoredBlock("surface1", new PaddedBlock(2, 1, new Text(theme.fg("dim", hintText), 0, 0)));
        this.container.addChild(this.footer);

        this.settled = false;
        this.chosenValue = null;

        // Wire input callbacks to delegate to list selection
        this.input.onSubmit = () => {
            if (this.settled) return;
            const selected = this.list.getSelectedItem();
            if (selected && this.list.onSelect) {
                this.list.onSelect(selected);
            }
        };
        this.input.onEscape = () => {
            if (this.settled) return;
            if (this.list.onCancel) {
                this.list.onCancel();
            }
        };
    }

    /**
     * Called when selection completes
     * @param {string|null} value
     */
    settle(value) {
        this.settled = true;
        this.chosenValue = value;
        // Strip out the interactive parts to leave a single-line summary
        this.container.children = [];
        let summaryText;
        if (value === null) {
            summaryText = theme.fg("surface2", "(Cancelled)");
        } else {
            summaryText = theme.fg("text", value);
        }
        this.container.addChild(new ColoredBlock("surface0", new PaddedBlock(2, 1, new Text(summaryText, 0, 0))));
        this.invalidate();
    }

    /** @param {string} data */
    handleInput(data) {
        if (this.settled) return;

        // Navigation keys go to the list
        if (matchesKey(data, Key.up) || matchesKey(data, Key.down)) {
            this.list.handleInput(data);
            return;
        }

        // Enter and Escape are handled by the input's onSubmit / onEscape callbacks
        if (matchesKey(data, Key.enter) || matchesKey(data, Key.escape)) {
            this.input.handleInput(data);
            return;
        }

        // Everything else (typing, backspace, etc.) goes to the input, then filter the list
        this.input.handleInput(data);
        this.list.setFilter(this.input.getValue());
    }

    focus() {
        this.input.focused = true;
    }

    blur() {
        this.input.focused = false;
    }

    invalidate() {
        this.container.invalidate();
    }

    /** @param {number} w */
    render(w) {
        return this.container.render(w);
    }
}

/**
 * Prompt Text Block
 * Embeds an Input vertically in the chat stream.
 */
export class PromptTextBlock {
    /**
     * @param {string} promptTitle
     * @param {string} [hint]
     */
    constructor(promptTitle, hint = "") {
        this.container = new Container();

        // Header
        const headerText = theme.fg("text", theme.bold(promptTitle));
        this.header = new ColoredBlock("surface1", new PaddedBlock(2, 1, new Text(headerText, 0, 0)));
        this.container.addChild(this.header);

        // Body with Input
        this.input = new Input();
        this.bodyBlock = new ColoredBlock("surface0", new PaddedBlock(2, 0, this.input));
        this.container.addChild(this.bodyBlock);

        // Footer with hint
        const hintText = hint || "Enter text and press Enter, Esc to cancel";
        this.footer = new ColoredBlock("surface1", new PaddedBlock(2, 1, new Text(theme.fg("dim", hintText), 0, 0)));
        this.container.addChild(this.footer);

        this.settled = false;
        this.chosenValue = null;
    }

    /**
     * Called when input completes
     * @param {string|null} value
     */
    settle(value) {
        this.settled = true;
        this.chosenValue = value;
        // Strip out the interactive parts to leave a single-line summary
        this.container.children = [];
        let summaryText;
        if (value === null) {
            summaryText = theme.fg("surface2", "(Cancelled)");
        } else {
            summaryText = theme.fg("text", value);
        }
        this.container.addChild(new ColoredBlock("surface0", new PaddedBlock(2, 1, new Text(summaryText, 0, 0))));
        this.invalidate();
    }

    /** @param {string} data */
    handleInput(data) {
        if (this.settled) return;
        this.input.handleInput(data);
    }

    focus() {
        this.input.focused = true;
    }

    blur() {
        this.input.focused = false;
    }

    invalidate() {
        this.container.invalidate();
    }

    /** @param {number} w */
    render(w) {
        return this.container.render(w);
    }
}
export class SpinnerBlock {
    constructor() {
        this.frame = 0;
        this.isBusy = false;
        /** @type {Array<{task: number, assignee: string, description: string}>} */
        this.tasks = [];
        this.frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    }

    /**
     * @param {boolean} busy
     * @param {Array<{task: number, assignee: string, description: string}>} tasks
     */
    setBusy(busy, tasks = []) {
        this.isBusy = busy;
        this.tasks = tasks;
        this.invalidate();
    }

    advance() {
        if (this.isBusy) {
            this.frame++;
            this.invalidate();
        }
    }

    invalidate() {}

    /** @param {number} w */
    render(w) {
        if (!this.isBusy && this.tasks.length === 0) return [];

        const f = this.frames[this.frame % this.frames.length];
        if (this.tasks.length > 0) {
            return this.tasks.map((t) => {
                const line = theme.fg("accent", f) + " " + theme.fg("success", t.assignee) + " " +
                    theme.fg("dim", `(Task ${t.task})`);
                // deno-lint-ignore no-control-regex
                const padded = line + " ".repeat(Math.max(0, w - line.replace(/\x1b\[[0-9;]*m/g, "").length));
                return padded;
            });
        }

        // Generic busy spinner
        const line = theme.fg("accent", `${f} Thinking...`);
        // deno-lint-ignore no-control-regex
        const padded = line + " ".repeat(Math.max(0, w - line.replace(/\x1b\[[0-9;]*m/g, "").length));
        return [padded];
    }
}
