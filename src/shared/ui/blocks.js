import {
    Container,
    Input,
    Key,
    Markdown,
    matchesKey,
    SelectList,
    Spacer,
    Text,
    truncateToWidth,
    visibleWidth,
} from "@mariozechner/pi-tui";
import { markdownTheme, selectListTheme, theme } from "../ui/theme.js";
import stripAnsi from "strip-ansi";

// ─── Utilities ───────────────────────────────────────────────────────────────

/**
 * Format a system line from explicit text/header/style parts (no parsing).
 * `header` (when provided) is rendered bold in `style.headingColor` (default
 * `accent` / `error` based on isError). The body text uses the base color.
 *
 * @param {string} text
 * @param {boolean} isError
 * @param {string} [header]
 * @param {{ headingColor?: string }} [style]
 * @returns {string}
 */
function formatSystemLine(text, isError, header = "", style) {
    const baseColor = isError ? "error" : "dim";

    if (!header) {
        return theme.fg(baseColor, text);
    }

    const headerColor = style?.headingColor || (isError ? "error" : "accent");
    const renderedHeader = theme.fg(headerColor, theme.bold(header));

    if (!text) return renderedHeader;
    return `${renderedHeader} ${theme.fg(baseColor, text)}`;
}

// ─── Layout Primitives ───────────────────────────────────────────────────────

/**
 * Apply a background color to a line, handling embedded \x1b[0m (full reset)
 * codes that would otherwise kill the background mid-line.
 *
 * Instead of chalk.bgHex()(line) which can't handle raw resets, this manually
 * wraps the line with the bg open/close codes and re-applies the bg after any
 * embedded full reset.
 *
 * @param {string} bgCode - raw ANSI bg open code (e.g. "\x1b[48;2;49;50;68m")
 * @param {string} line
 * @returns {string}
 */
function applyBg(bgCode, line) {
    if (line.includes("\x1b[0m")) {
        // deno-lint-ignore no-control-regex
        return bgCode + line.replace(/\x1b\[0m/g, "\x1b[0m" + bgCode) + "\x1b[49m";
    }
    return bgCode + line + "\x1b[49m";
}

/** @type {Map<string, string>} */
const bgCodeCache = new Map();

/**
 * Get the raw ANSI background open code for a theme color name.
 * @param {string} bgColorName
 * @returns {string}
 */
function getBgCode(bgColorName) {
    const cached = bgCodeCache.get(bgColorName);
    if (cached !== undefined) return cached;
    // Render a single space with the bg to extract the open code
    const rendered = theme.bg(bgColorName, " ");
    // deno-lint-ignore no-control-regex
    const match = rendered.match(/^(\x1b\[48;2;\d+;\d+;\d+m)/);
    const code = match ? match[1] : "";
    bgCodeCache.set(bgColorName, code);
    return code;
}

/**
 * A block that applies a background color, horizontal/vertical padding,
 * and stretches each line to the full available width.
 *
 * Handles embedded ANSI full-reset codes (\x1b[0m) from child components
 * (e.g. pi-tui's truncateToWidth) by re-applying the bg after each reset.
 */
export class StyledBlock {
    /**
     * @param {string} bgColor - theme background color name (e.g. "surface0")
     * @param {number} paddingX - horizontal padding (left and right)
     * @param {number} paddingY - vertical padding (top and bottom empty lines)
     * @param {{ render: (w: number) => string[], invalidate?: () => void } | null | undefined} child
     */
    constructor(bgColor, paddingX, paddingY, child) {
        this.bgColor = bgColor;
        this.paddingX = paddingX;
        this.paddingY = paddingY;
        this.child = child;
        /** @type {string} */
        this._bgCode = getBgCode(bgColor);
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
            const vw = visibleWidth(line);
            const clamped = vw > innerW ? truncateToWidth(line, innerW) : line;
            const clampedW = vw > innerW ? visibleWidth(clamped) : vw;
            const rightPad = " ".repeat(Math.max(0, w - this.paddingX - clampedW));
            return padX + clamped + rightPad;
        });

        const padY = Array.from({ length: this.paddingY }, () => emptyLine);

        const bgCode = this._bgCode;
        const allLines = [...padY, ...lines, ...padY];
        return allLines.map((line) => applyBg(bgCode, line));
    }
}

// ─── Message Blocks ──────────────────────────────────────────────────────────

/**
 * The User Prompt Block.
 */
export class UserPromptBlock {
    /** @param {string} text */
    constructor(text) {
        this.content = new Container();
        this.content.addChild(new Text(theme.fg("text", text), 0, 0));
        this.block = new StyledBlock("surface0", 2, 1, this.content);
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
        this.markdown = new Markdown("", 0, 0, markdownTheme);
        this.container.addChild(this.markdown);
        this.container.addChild(new Spacer(1));

        this.block = new StyledBlock("crust", 2, 1, this.container);
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
 * System Message Block.
 */
export class SystemMessageBlock {
    /**
     * @param {string} text
     * @param {boolean} [isError=false]
     * @param {string} [header='']
     * @param {{ headingColor?: string }} [style]
     */
    constructor(text, isError = false, header = "", style = {}) {
        this.container = new Container();
        this.isError = isError;
        this.style = style;
        this.container.addChild(new Text(formatSystemLine(text, isError, header, style), 0, 0));
        this.block = new StyledBlock("mantle", 2, 1, this.container);
    }

    /**
     * @param {string} text
     * @param {string} [header='']
     * @param {{ headingColor?: string }} [style]
     */
    appendText(text, header = "", style) {
        this.container.addChild(
            new Text(formatSystemLine(text, this.isError, header, style || this.style), 0, 0),
        );
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

// ─── Tool Execution Block ────────────────────────────────────────────────────

/**
 * The Tool Execution Block.
 * Contains a header (tool name + args), a body for streaming output, and a footer (duration + expand hint).
 */
export class ToolExecutionBlock {
    /**
     * @param {string} toolName
     * @param {string} argsStr
     */
    constructor(toolName, argsStr) {
        this.previewLineLimit = 6;
        this.expanded = false;
        this.durationStr = "";
        this.bodyText = "";
        this.isError = false;
        this.startTime = Date.now();
        this.bgColor = "toolBg";

        // Header text
        const commandText = argsStr.trim();
        this.headerText = commandText ? `${toolName} ${commandText}` : toolName;

        // Body text component (rendered inside the block)
        this.bodyTextComponent = new Text("", 0, 0);
    }

    /**
     * @returns {string[]}
     */
    getOutputLines() {
        if (!this.bodyText) return [];
        return this.bodyText.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
    }

    /** @private */
    updateBodyText() {
        const lines = this.getOutputLines();
        const shown = !this.expanded && lines.length > this.previewLineLimit
            ? lines.slice(0, this.previewLineLimit)
            : lines;
        const renderedText = shown.join("\n");
        this.bodyTextComponent.setText(
            this.isError ? theme.fg("text", renderedText) : theme.fg("subtext0", renderedText),
        );
    }

    /** @param {boolean} expanded */
    setExpanded(expanded) {
        this.expanded = expanded;
        this.updateBodyText();
    }

    /** @param {string} text */
    appendOutput(text) {
        // Strip ANSI codes from tool output to prevent embedded resets (\x1b[0m)
        // from breaking the block's background coloring.
        this.bodyText += stripAnsi(text);
        this.updateBodyText();
    }

    /**
     * @param {boolean} isError
     * @param {number} durationMs
     */
    endExecution(isError, durationMs) {
        this.isError = isError;
        if (isError) {
            this.bgColor = "toolErrorBg";
        }
        this.durationStr = `Took ${(durationMs / 1000).toFixed(1)}s`;
        this.updateBodyText();
    }

    invalidate() {}

    /** @param {number} w */
    render(w) {
        const bg = this.bgColor;
        const paddingX = 2;
        const innerW = Math.max(0, w - paddingX * 2);

        /** @type {string[]} */
        const allLines = [];

        // ── Header: bold tool name, with vertical padding ──
        const rawHeaderLine = theme.fg("text", theme.bold(this.headerText));
        const headerLine = visibleWidth(rawHeaderLine) > innerW
            ? truncateToWidth(rawHeaderLine, innerW)
            : rawHeaderLine;
        const headerBlock = new StyledBlock(bg, paddingX, 1, { render: () => [headerLine], invalidate: () => {} });
        allLines.push(...headerBlock.render(w));

        // ── Body: tool output (no vertical padding) ──
        if (this.bodyText) {
            const bgCode = getBgCode(bg);
            const bodyLines = this.bodyTextComponent.render(innerW);
            const padX = " ".repeat(paddingX);
            for (const line of bodyLines) {
                const vw = visibleWidth(line);
                const clamped = vw > innerW ? truncateToWidth(line, innerW) : line;
                const clampedW = vw > innerW ? visibleWidth(clamped) : vw;
                const rightPad = " ".repeat(Math.max(0, w - paddingX - clampedW));
                allLines.push(applyBg(bgCode, padX + clamped + rightPad));
            }
        }

        // ── Footer: duration + expand/collapse hint, with vertical padding ──
        const footerContent = this.renderFooterContent(innerW);
        if (footerContent.length > 0) {
            const footerBlock = new StyledBlock(bg, paddingX, 1, {
                render: () => footerContent,
                invalidate: () => {},
            });
            allLines.push(...footerBlock.render(w));
        }

        return allLines;
    }

    /**
     * Render the footer content lines (duration left, expand hint right).
     * @param {number} innerW
     * @returns {string[]}
     * @private
     */
    renderFooterContent(innerW) {
        const canExpand = this.getOutputLines().length > this.previewLineLimit;
        const left = this.durationStr ? theme.fg("dim", this.durationStr) : "";
        const right = canExpand
            ? theme.fg("dim", this.expanded ? "press ctrl+o to collapse" : "press ctrl+o to expand")
            : "";

        if (!left && !right) return [];

        if (!left) {
            const rightPad = " ".repeat(Math.max(0, innerW - visibleWidth(right)));
            return [`${rightPad}${right}`];
        }

        if (!right) return [left];

        const leftLen = visibleWidth(left);
        const rightLen = visibleWidth(right);

        if (leftLen + 1 + rightLen <= innerW) {
            const spacing = " ".repeat(Math.max(1, innerW - leftLen - rightLen));
            return [`${left}${spacing}${right}`];
        }

        const rightPad = " ".repeat(Math.max(0, innerW - rightLen));
        return [left, `${rightPad}${right}`];
    }
}

// ─── Prompt Blocks ───────────────────────────────────────────────────────────

/**
 * SelectList subclass that filters by substring across value, label, and description.
 */
class SearchableSelectList extends SelectList {
    /**
     * @param {import("@mariozechner/pi-tui").SelectItem[]} items
     * @param {number} maxVisible
     * @param {import("@mariozechner/pi-tui").SelectListTheme} slTheme
     * @param {import("@mariozechner/pi-tui").SelectListLayoutOptions} [layout]
     */
    constructor(items, maxVisible, slTheme, layout = {}) {
        super(items, maxVisible, slTheme, layout);
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
        this.header = new StyledBlock("surface1", 2, 1, new Text(headerText, 0, 0));
        this.container.addChild(this.header);

        // Search input
        this.input = new Input();
        this.searchBlock = new StyledBlock("surface1", 2, 0, this.input);
        this.container.addChild(this.searchBlock);

        // Body with SelectList
        this.list = new SearchableSelectList(items, Math.min(items.length, 10), selectListTheme);
        this.bodyBlock = new StyledBlock("surface1", 2, 0, this.list);
        this.container.addChild(this.bodyBlock);

        // Footer with hint
        const hintText = hint || "Type to search, arrows to navigate, Enter to select, Esc to cancel";
        this.footer = new StyledBlock("surface1", 2, 1, new Text(theme.fg("dim", hintText), 0, 0));
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
        this.container.children = [];
        if (value !== null) {
            const summaryText = theme.fg("text", value);
            this.container.addChild(new StyledBlock("surface1", 2, 1, new Text(summaryText, 0, 0)));
        }
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
        this.header = new StyledBlock("surface1", 2, 1, new Text(headerText, 0, 0));
        this.container.addChild(this.header);

        // Body with Input
        this.input = new Input();
        this.bodyBlock = new StyledBlock("surface1", 2, 0, this.input);
        this.container.addChild(this.bodyBlock);

        // Footer with hint
        const hintText = hint || "Enter text and press Enter, Esc to cancel";
        this.footer = new StyledBlock("surface1", 2, 1, new Text(theme.fg("dim", hintText), 0, 0));
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
        this.container.children = [];
        if (value !== null) {
            const summaryText = theme.fg("text", value);
            this.container.addChild(new StyledBlock("surface1", 2, 1, new Text(summaryText, 0, 0)));
        }
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

// ─── Spinner Block ───────────────────────────────────────────────────────────

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
        if (this.isBusy || this.tasks.length > 0) {
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
                return line + " ".repeat(Math.max(0, w - visibleWidth(line)));
            });
        }

        // Generic busy spinner
        const line = theme.fg("accent", `${f} Thinking...`);
        return [line + " ".repeat(Math.max(0, w - visibleWidth(line)))];
    }
}
