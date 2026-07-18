import { assert, assertEquals, assertNotEquals } from "@std/assert";
import chalk from "chalk";

// Force chalk to produce ANSI codes in non-TTY test environment
chalk.level = 3;

// Initialize the runwield theme before importing blocks (theme must be ready)
import { initRunWieldTheme } from "../theme/theme.js";
initRunWieldTheme();

import {
    AgentMessageBlock,
    KeyboardHelpBlock,
    PromptSelectBlock,
    PromptTextBlock,
    ReviewResultBlock,
    SpinnerBlock,
    StyledBlock,
    SystemMessageBlock,
    ThinkingBlock,
    ToolExecutionBlock,
    UserPromptBlock,
} from "./blocks.js";
import { Text } from "@earendil-works/pi-tui";
import stripAnsi from "strip-ansi";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Compute visible length by stripping all ANSI/APC/OSC sequences.
 * @param {string} str
 */
function visibleLength(str) {
    // deno-lint-ignore no-control-regex
    return str.replace(/\x1b\[[0-9;]*m|\x1b[_\]].*?\x07/g, "").length;
}

/**
 * Assert every line has correct visible width and consistent background.
 * Checks that:
 * 1. Every line is exactly `w` visible chars wide
 * 2. Every line starts with a bg ANSI code
 * 3. After any \x1b[0m (full reset), the bg is re-applied
 *
 * @param {string[]} lines
 * @param {number} w
 * @param {string} blockName - for error messages
 */
function assertBlockBackground(lines, w, blockName) {
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const vl = visibleLength(line);

        assertEquals(vl, w, `${blockName} line ${i}: visible length should be ${w}, got ${vl}`);

        // Every line should start with a bg code (truecolor or 256-color)
        assertEquals(
            // deno-lint-ignore no-control-regex
            /^\x1b\[(?:48;2;\d+;\d+;\d+|48;5;\d+)m/.test(line),
            true,
            `${blockName} line ${i}: should start with bg ANSI code`,
        );

        // After any \x1b[0m, the bg must be re-applied immediately
        const parts = line.split("\x1b[0m");
        if (parts.length > 1) {
            for (let p = 1; p < parts.length; p++) {
                assertEquals(
                    // deno-lint-ignore no-control-regex
                    /^\x1b\[(?:48;2;\d+;\d+;\d+|48;5;\d+)m/.test(parts[p]),
                    true,
                    `${blockName} line ${i}: bg must be re-applied after \\x1b[0m (part ${p})`,
                );
            }
        }
    }
}

// ─── StyledBlock ─────────────────────────────────────────────────────────────

Deno.test("StyledBlock renders full-width bg lines", () => {
    const w = 80;
    const block = new StyledBlock("userMessageBg", 2, 1, new Text("hello", 0, 0));
    const lines = block.render(w);
    assertBlockBackground(lines, w, "StyledBlock");
});

Deno.test("StyledBlock handles embedded \\x1b[0m in child content", () => {
    const w = 80;
    // Simulate a child that produces content with \x1b[0m (like truncateToWidth)
    const child = {
        render: () => ["before \x1b[0m after"],
        invalidate: () => {},
    };
    const block = new StyledBlock("userMessageBg", 2, 1, child);
    const lines = block.render(w);
    assertBlockBackground(lines, w, "StyledBlock(with reset)");
});

// ─── UserPromptBlock ─────────────────────────────────────────────────────────

Deno.test("UserPromptBlock renders with consistent background", () => {
    const w = 100;
    const block = new UserPromptBlock("Hello world");
    const lines = block.render(w);
    assertBlockBackground(lines, w, "UserPromptBlock");
});

// ─── AgentMessageBlock ───────────────────────────────────────────────────────

Deno.test("AgentMessageBlock renders without background (like Pi)", () => {
    const w = 100;
    const block = new AgentMessageBlock("TestAgent");
    block.appendText("Some markdown **content** here.");
    const lines = block.render(w);

    // Agent messages no longer have a bg — just verify they render without error
    assertEquals(lines.length > 0, true, "AgentMessageBlock should produce output");

    // Verify agent name is in the output
    const plain = lines.map((l) => stripAnsi(l)).join("\n");
    assertEquals(plain.includes("TestAgent:"), true, "Should contain agent name");
});

// ─── ThinkingBlock ───────────────────────────────────────────────────────────

Deno.test("ThinkingBlock renders reasoning with muted styling", () => {
    const block = new ThinkingBlock();
    block.appendText("\nThe user is greeting me.\nI should respond naturally.");

    const lines = block.render(80);
    const plain = lines.map((line) => stripAnsi(line)).join("\n");

    assertEquals(plain.includes("Thinking"), false);
    assertEquals(plain.includes("The user is greeting me."), true);
    assertNotEquals(lines.join("\n"), plain, "ThinkingBlock should include ANSI styling");
});

Deno.test("ThinkingBlock removes the thinking label after completion", () => {
    const block = new ThinkingBlock();
    block.appendText("Finished reasoning.");
    block.end();

    const plain = block.render(80).map((line) => stripAnsi(line)).join("\n");

    assertEquals(plain.includes("Thinking"), false);
    assertEquals(plain.includes("✓"), false);
    assertEquals(plain.includes("Finished reasoning."), true);
});

Deno.test("ThinkingBlock wraps long reasoning lines to the viewport width", () => {
    const block = new ThinkingBlock();
    block.appendText("This is a long reasoning line that should wrap instead of truncating at the viewport edge.");

    const lines = block.render(32).map((line) => stripAnsi(line));

    assertEquals(lines.some((line) => line.includes("truncating")), true);
    assertEquals(lines.some((line) => line.includes("viewport edge")), true);
    assert(lines.every((line) => visibleLength(line) <= 32));
});

Deno.test("ThinkingBlock can hide reasoning text", () => {
    const block = new ThinkingBlock({ hidden: true });
    block.appendText("private reasoning");

    const plain = block.render(80).map((line) => stripAnsi(line)).join("\n");

    assertEquals(plain.includes("Thinking"), false);
    assertEquals(plain.includes("hidden"), true);
    assertEquals(plain.includes("private reasoning"), false);
});

// ─── SystemMessageBlock ──────────────────────────────────────────────────────

Deno.test("SystemMessageBlock renders with consistent background", () => {
    const w = 100;
    const block = new SystemMessageBlock("[RunWield] System message");
    const lines = block.render(w);
    assertBlockBackground(lines, w, "SystemMessageBlock");
});

Deno.test("SystemMessageBlock error renders with consistent background", () => {
    const w = 100;
    const block = new SystemMessageBlock("[Error] Something failed", true);
    const lines = block.render(w);
    assertBlockBackground(lines, w, "SystemMessageBlock(error)");
});

Deno.test("SystemMessageBlock renders with mdHeading heading style", () => {
    const w = 100;
    const text = "skill1, skill2";
    const header = "Loaded skills (2):";
    const style = { headingColor: "mdHeading" };
    const block = new SystemMessageBlock(text, false, header, style);
    const lines = block.render(w);

    assertBlockBackground(lines, w, "SystemMessageBlock(mdHeading)");

    // StyledBlock adds padY top/bottom; content lives on the middle line(s).
    const contentLine = lines.find((l) => stripAnsi(l).trim().length > 0) || "";
    const plain = stripAnsi(contentLine).trim();
    assertEquals(plain, `${header} ${text}`, "Stripped content should be 'header text'");

    // We expect at least two distinct fg color codes.
    // deno-lint-ignore no-control-regex
    const fgMatches = contentLine.match(/\x1b\[(?:38;2;\d+;\d+;\d+|38;5;\d+)m/g) || [];
    const uniqueFg = [...new Set(fgMatches)];
    assertEquals(
        uniqueFg.length >= 2,
        true,
        "Should have at least two distinct foreground colors",
    );

    // The mdHeading color is peach (#fab387) → 250;179;135 (truecolor) or 216 (256-color).
    const hasPeach = fgMatches.some((m) => m === "\x1b[38;2;250;179;135m" || m === "\x1b[38;5;216m");
    assertEquals(hasPeach, true, "Should contain the peach/mdHeading ANSI code");
});

Deno.test("SystemMessageBlock appendText uses header and style", () => {
    const w = 100;
    const block = new SystemMessageBlock("First line");
    block.appendText("s1", "Loaded skills (1):", { headingColor: "mdHeading" });
    const lines = block.render(w);

    assertBlockBackground(lines, w, "SystemMessageBlock(append)");

    const plain = lines.map((l) => stripAnsi(l)).join("\n");
    assertEquals(plain.includes("First line"), true);
    assertEquals(plain.includes("Loaded skills (1): s1"), true);
});

// ─── ReviewResultBlock ───────────────────────────────────────────────────────

Deno.test("ReviewResultBlock renders approved markdown with success background", () => {
    const w = 100;
    const block = new ReviewResultBlock("Reviewer", "Semantic review **approved**.", true);
    const lines = block.render(w);
    const plain = lines.map((line) => stripAnsi(line)).join("\n");

    assertBlockBackground(lines, w, "ReviewResultBlock(approved)");
    assertEquals(plain.includes("Reviewer:"), true);
    assertEquals(plain.includes("Semantic review approved."), true);
});

Deno.test("ReviewResultBlock renders feedback markdown with error background", () => {
    const w = 100;
    const block = new ReviewResultBlock("Reviewer", "Semantic review rejected:\n- Missing `thing`", false);
    const lines = block.render(w);
    const plain = lines.map((line) => stripAnsi(line)).join("\n");

    assertBlockBackground(lines, w, "ReviewResultBlock(feedback)");
    assertEquals(plain.includes("Reviewer:"), true);
    assertEquals(plain.includes("Semantic review rejected:"), true);
    assertEquals(plain.includes("Missing thing"), true);
});

Deno.test("KeyboardHelpBlock renders ordered shortcuts with responsive wrapping", () => {
    const block = new KeyboardHelpBlock({
        title: "Keyboard shortcuts",
        items: [
            { key: "esc", description: "to interrupt" },
            { key: "ctrl+c", description: "to clear input" },
            { key: "shift+enter", description: "to insert newline" },
            { key: "?", description: "to show this keyboard help block" },
            { key: "/", description: "for commands" },
            { key: "!!", description: "to run bash (no context)" },
        ],
    });

    const wide = block.render(100);
    const widePlain = stripAnsi(wide.join("\n"));
    assertBlockBackground(wide, 100, "KeyboardHelpBlock wide");
    assertEquals(widePlain.includes("Keyboard shortcuts"), true);
    assertEquals(widePlain.includes("esc"), true);
    assertEquals(widePlain.includes("!!"), true);

    const narrow = block.render(24);
    assertBlockBackground(narrow, 24, "KeyboardHelpBlock narrow");
    for (const line of narrow) {
        assert(visibleLength(line) <= 24);
    }
    assertEquals(stripAnsi(narrow.join("\n")).includes("keyboard"), true);
});

// ─── ToolExecutionBlock ──────────────────────────────────────────────────────

Deno.test("ToolExecutionBlock renders with consistent background (no output)", () => {
    const w = 100;
    const block = new ToolExecutionBlock("bash", "$ ls -la");
    block.endExecution(false, 150);
    const lines = block.render(w);
    assertBlockBackground(lines, w, "ToolExecutionBlock(empty)");
});

Deno.test("ToolExecutionBlock renders with consistent background (with output)", () => {
    const w = 100;
    const block = new ToolExecutionBlock("bash", "$ ls -la");
    block.appendOutput("file1.txt\nfile2.txt\nfolder/\n");
    block.endExecution(false, 250);
    const lines = block.render(w);
    assertBlockBackground(lines, w, "ToolExecutionBlock(output)");
});

Deno.test("ToolExecutionBlock shows live elapsed time only after it is enabled", () => {
    const originalNow = Date.now;
    let now = 1000;
    Date.now = () => now;
    try {
        const w = 100;
        const block = new ToolExecutionBlock("bash", "$ sleep 1");

        let plain = block.render(w).map((line) => stripAnsi(line)).join("\n");
        assertEquals(plain.includes("Elapsed time:"), false);

        now = 1500;
        block.enableElapsedTime();
        plain = block.render(w).map((line) => stripAnsi(line)).join("\n");
        assertEquals(plain.includes("Elapsed time: 0.5s"), true);

        block.endExecution(false, 700);
        plain = block.render(w).map((line) => stripAnsi(line)).join("\n");
        assertEquals(plain.includes("Elapsed time:"), false);
        assertEquals(plain.includes("Took 0.7s"), true);
    } finally {
        Date.now = originalNow;
    }
});

Deno.test("ToolExecutionBlock keeps elapsed footer with expand hint inside the block", () => {
    const originalNow = Date.now;
    let now = 2000;
    Date.now = () => now;
    try {
        const w = 100;
        const block = new ToolExecutionBlock("bash", "$ echo lines");
        for (let i = 0; i < 10; i++) {
            block.appendOutput(`line ${i}\n`);
        }

        now = 2600;
        block.enableElapsedTime();
        const lines = block.render(w);
        const plain = lines.map((line) => stripAnsi(line)).join("\n");

        assertBlockBackground(lines, w, "ToolExecutionBlock(elapsed expand hint)");
        assertEquals(plain.includes("Elapsed time: 0.6s"), true);
        assertEquals(plain.includes("press ctrl+o to expand"), true);
    } finally {
        Date.now = originalNow;
    }
});

Deno.test("ToolExecutionBlock keeps multi-line command headers inside the block", () => {
    const w = 120;
    const block = new ToolExecutionBlock(
        "bash",
        '$ cd /Users/gandazgul/Documents/web/runwield && git commit -m "Consolidate formats\n- Move plan formats"',
    );
    block.appendOutput("[main abc123] Consolidate formats\n");
    block.endExecution(false, 100);

    const lines = block.render(w);
    assertBlockBackground(lines, w, "ToolExecutionBlock(multiline header)");

    for (let i = 0; i < lines.length; i++) {
        assertEquals(lines[i].includes("\n"), false, `rendered line ${i} should not contain embedded newlines`);
        assertEquals(lines[i].includes("\r"), false, `rendered line ${i} should not contain embedded carriage returns`);
    }

    const plain = lines.map((line) => stripAnsi(line)).join("\n");
    assertEquals(plain.includes("Consolidate formats - Move plan formats"), true);
});

Deno.test("ToolExecutionBlock error renders with consistent background", () => {
    const w = 100;
    const block = new ToolExecutionBlock("bash", "$ bad-command");
    block.appendOutput("command not found: bad-command\n");
    block.endExecution(true, 100);
    const lines = block.render(w);
    assertBlockBackground(lines, w, "ToolExecutionBlock(error)");
});

Deno.test("ToolExecutionBlock strips ANSI from tool output", () => {
    const w = 100;
    const block = new ToolExecutionBlock("bash", "$ ls --color");
    // Simulate colored ls output with full resets
    block.appendOutput("\x1b[35mfile.txt\x1b[0m\n\x1b[34mfolder\x1b[0m\n");
    block.endExecution(false, 50);
    // Body text should have ANSI stripped
    assertEquals(block.bodyText, "file.txt\nfolder\n");
    const lines = block.render(w);
    assertBlockBackground(lines, w, "ToolExecutionBlock(colored output)");
});

Deno.test("ToolExecutionBlock expansion and truncation logic", () => {
    const w = 100;
    const block = new ToolExecutionBlock("bash", "$ echo lines");

    // Add more lines than previewLineLimit (6)
    for (let i = 0; i < 10; i++) {
        block.appendOutput(`line ${i}\n`);
    }

    // While collapsed (default), it should only show a subset of lines
    assertEquals(block.expanded, false);
    const collapsedLines = block.render(w);

    // Expand it
    block.setExpanded(true);
    const expandedLines = block.render(w);

    // The expanded render should be taller than the collapsed render
    assertEquals(expandedLines.length > collapsedLines.length, true);
});

// ─── PromptSelectBlock ───────────────────────────────────────────────────────

Deno.test("PromptSelectBlock renders with uniform background", () => {
    const w = 100;
    const items = [
        { value: "option1", label: "Option 1", description: "First option" },
        { value: "option2", label: "Option 2", description: "Second option" },
    ];
    const block = new PromptSelectBlock("Choose:", items);
    block.focus();
    const lines = block.render(w);
    assertBlockBackground(lines, w, "PromptSelectBlock");

    // All lines should use the same bg color (selectedBg = surface0 = #313244)
    const bgCodes = lines.map((line) => {
        // deno-lint-ignore no-control-regex
        const m = line.match(/^\x1b\[(?:48;2;(\d+;\d+;\d+)|48;5;(\d+))m/);
        return m ? (m[1] || m[2]) : null;
    });
    const uniqueBgs = [...new Set(bgCodes)];
    assertEquals(uniqueBgs.length, 1, `PromptSelectBlock should have uniform bg, got: ${uniqueBgs.join(", ")}`);
});

Deno.test("PromptSelectBlock handles long items that trigger truncation", () => {
    const w = 80;
    const items = [
        {
            value: "very-long-plan-name-that-will-be-truncated-by-the-select-list",
            label: "very-long-plan-name-that-will-be-truncated-by-the-select-list",
            description: "This description is also quite long and should trigger truncation in the list",
        },
        { value: "short", label: "Short", description: "A short one" },
    ];
    const block = new PromptSelectBlock("Resume plan:", items);
    block.focus();
    const lines = block.render(w);
    assertBlockBackground(lines, w, "PromptSelectBlock(truncated)");
});

Deno.test("PromptSelectBlock handles filtering and settling", () => {
    const items = [
        { value: "apple", label: "Apple", description: "Red fruit" },
        { value: "banana", label: "Banana", description: "Yellow fruit" },
    ];
    const block = new PromptSelectBlock("Choose fruit:", items);

    // Test Filtering: simulate typing "ban"
    block.handleInput("b");
    block.handleInput("a");
    block.handleInput("n");

    // The list should now only contain "banana"
    // @ts-ignore: Accessing private field for test verification
    assertEquals(block.list.filteredItems.length, 1);
    // @ts-ignore: Accessing private field for test verification
    assertEquals(block.list.filteredItems[0].value, "banana");

    // Test Navigation: clear filter
    block.input.setValue("");
    block.list.setFilter("");

    block.handleInput("\x1b[B");
    // @ts-ignore: Accessing private field for test verification
    assertEquals(block.list.selectedIndex > 0, true);

    // Test Settling
    block.settle("banana");
    assertEquals(block.settled, true);
    assertEquals(block.chosenValue, "banana");
});

// ─── PromptTextBlock ─────────────────────────────────────────────────────────

Deno.test("PromptTextBlock renders with uniform background", () => {
    const w = 100;
    const block = new PromptTextBlock("Enter value:");
    block.focus();
    const lines = block.render(w);
    assertBlockBackground(lines, w, "PromptTextBlock");

    // All lines should use the same bg color
    const bgCodes = lines.map((line) => {
        // deno-lint-ignore no-control-regex
        const m = line.match(/^\x1b\[(?:48;2;(\d+;\d+;\d+)|48;5;(\d+))m/);
        return m ? (m[1] || m[2]) : null;
    });
    const uniqueBgs = [...new Set(bgCodes)];
    assertEquals(uniqueBgs.length, 1, `PromptTextBlock should have uniform bg, got: ${uniqueBgs.join(", ")}`);
});

Deno.test("PromptTextBlock handles input and settling", () => {
    const block = new PromptTextBlock("Enter value:");
    block.focus();

    // Simulate typing
    block.handleInput("h");
    block.handleInput("i");

    assertEquals(block.input.getValue(), "hi");

    block.settle(block.input.getValue());

    assertEquals(block.settled, true);
    assertEquals(block.chosenValue, "hi");

    // Verify visual output changes to a finalized line (contains "hi")
    const lines = block.render(80);
    const plainTextLines = lines.map((line) => stripAnsi(line));
    assertEquals(plainTextLines.some((line) => line.includes("hi")), true);
});

// ─── SpinnerBlock ────────────────────────────────────────────────────────────

Deno.test("SpinnerBlock renders full-width lines when busy", () => {
    const w = 80;
    const spinner = new SpinnerBlock();
    spinner.setBusy(true);
    const lines = spinner.render(w);
    for (let i = 0; i < lines.length; i++) {
        const vl = visibleLength(lines[i]);
        assertEquals(vl, w, `SpinnerBlock line ${i}: visible length should be ${w}, got ${vl}`);
    }
});

Deno.test("Spinner cycles animation frames", () => {
    const spinner = new SpinnerBlock();
    spinner.setBusy(true);

    const frame1 = spinner.render(80)[0];
    spinner.advance();
    const frame2 = spinner.render(80)[0];

    assertNotEquals(frame1, frame2);
});

Deno.test("SpinnerBlock renders tasks when provided", () => {
    const spinner = new SpinnerBlock();
    spinner.setBusy(true, [{ task: 1, assignee: "agent", description: "doing work" }]);

    const lines = spinner.render(80);
    const plainText = stripAnsi(lines[0]);
    assertEquals(plainText.includes("agent"), true);
    assertEquals(plainText.includes("Task 1"), true);
});
