import { Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";
import { markdownTheme, theme } from "../theme.js";

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
     * @param {any} child - pi-tui component with render(w) method
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
     * @param {any} child
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

        // Header
        const headerText = argsStr ? `${toolName} ${argsStr}` : toolName;
        this.header = new ColoredBlock(
            "surface1",
            new PaddedBlock(2, 1, new Text(theme.fg("text", theme.bold(headerText)), 0, 0)),
        );
        this.container.addChild(this.header);

        // Body
        this.bodyContainer = new Container();
        // Body wrapper gets surface0 normally, or a different color if error occurs.
        this.bodyBlock = new ColoredBlock("surface0", new PaddedBlock(2, 1, this.bodyContainer));
        this.container.addChild(this.bodyBlock);

        // Footer
        this.footerContainer = new Container();
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

    /** @param {string} text */
    appendOutput(text) {
        this.bodyText += text;
        this.bodyTextComponent.setText(
            this.isError ? theme.fg("error", this.bodyText) : theme.fg("subtext0", this.bodyText),
        );
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
            // Repaint body text with error color
            this.bodyTextComponent.setText(theme.fg("error", this.bodyText));
        }

        const durationStr = `Took ${(durationMs / 1000).toFixed(1)}s`;
        this.footerContainer.addChild(new Text(theme.fg("dim", durationStr), 0, 0));
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
        const color = isError ? "error" : "dim";
        this.container.addChild(new Text(theme.fg(color, text), 0, 0));
        this.block = new ColoredBlock("mantle", new PaddedBlock(2, 1, this.container));
    }

    /** @param {string} text */
    appendText(text) {
        const color = this.isError ? "error" : "dim";
        this.container.addChild(new Text(theme.fg(color, text), 0, 0));
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
 * Inline Spinner Block for showing active operations.
 */
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
