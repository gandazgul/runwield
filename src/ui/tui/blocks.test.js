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
    ValidationHandoffBlock,
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

Deno.test("AgentMessageBlock renders completed Mermaid fences as Unicode diagrams", () => {
    const block = new AgentMessageBlock("Planner");
    block.appendText("```mermaid\ngraph TD\n  A --> B\n```");

    const plain = block.render(120).map((line) => stripAnsi(line)).join("\n");

    assertEquals(plain.includes("Planner:"), true, "Should contain agent name");
    assertEquals(plain.includes("┌"), true, "Should render a Unicode diagram");
    assertEquals(plain.includes("```mermaid"), false, "Should not show source for fitting completed diagram");
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

    // The mdHeading color is peach (#fab387) → 250;179;135 (truecolor) or 216 (256-color).
    // Body text should remain normal text by default, not muted/dim, so the heading
    // may be the only explicit foreground color on this line.
    // deno-lint-ignore no-control-regex
    const fgMatches = contentLine.match(/\x1b\[(?:38;2;\d+;\d+;\d+|38;5;\d+)m/g) || [];
    const hasPeach = fgMatches.some((m) => m === "\x1b[38;2;250;179;135m" || m === "\x1b[38;5;216m");
    assertEquals(hasPeach, true, "Should contain the peach/mdHeading ANSI code");

    const mutedBlock = new SystemMessageBlock(text, false, header, { ...style, bodyColor: "dim" });
    const mutedContentLine = mutedBlock.render(w).find((l) => stripAnsi(l).trim().length > 0) || "";
    assertNotEquals(
        contentLine,
        mutedContentLine,
        "Default system body text should not render with the explicit dim/muted body style",
    );
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

Deno.test("SystemMessageBlock preserves OSC 8 hyperlinks on wrapped URL lines", () => {
    const w = 50;
    const url =
        "https://auth.example/oauth/authorize?client_id=runwield&redirect_uri=http%3A%2F%2Flocalhost%3A12345%2Fcallback&scope=openid%20profile%20email&state=long-state-token";
    const block = new SystemMessageBlock(`\x1b]8;;${url}\x07${url}\x1b]8;;\x07`);
    const lines = block.render(w);
    const urlLines = lines.filter((line) => line.includes("auth.example") || line.includes("redirect_uri"));

    assertEquals(urlLines.length > 1, true);
    for (const line of urlLines) {
        assertEquals(line.includes(`\x1b]8;;${url}\x07`), true);
        assertEquals(line.includes("\x1b]8;;\x07"), true);
    }
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

Deno.test("ValidationHandoffBlock renders owner validation labels and latest handoff reports", () => {
    const w = 180;
    const block = new ValidationHandoffBlock({
        progress: {
            kind: "workflow",
            outcome: "paused",
            stage: "engineer_repair",
            cycle: 2,
            maxCycles: 3,
            totalCycle: 5,
            repairAttempt: 1,
            maxRepairAttempts: 3,
            checks: { ci: "failed", semanticReview: "pending", humanReview: "pending", merge: "pending" },
            message: "Engineer continuation required.",
        },
        engineer: { agentName: "Engineer", markdown: "- Fixed CI", completedOrder: 2 },
        reviewer: { agentName: "Reviewer", markdown: "- Earlier feedback", approved: false, completedOrder: 1 },
    });
    const lines = block.render(w);
    const plain = lines.map((line) => stripAnsi(line)).join("\n");

    assertBlockBackground(lines, w, "ValidationHandoffBlock");
    assertEquals(plain.includes("Repair paused"), true);
    assertEquals(
        plain.includes("Tests and CI failed, AI code review pending, Human review pending, Combining commits pending"),
        true,
    );
    assertEquals(plain.includes("Round 2/3"), false);
    assertEquals(plain.includes("Stage: engineer repair"), false);
    assertEquals(plain.includes("Attempt 1/3"), false);
    assertEquals(plain.includes("Mechanical Validation"), false);
    assertEquals(plain.includes("Semantic review"), false);
    assertEquals(plain.includes("Engineer latest completion report"), true);
    assertEquals(plain.includes("Reviewer latest AI code review — rejected (feedback addressed; rechecking)"), true);
});

Deno.test("ValidationHandoffBlock renders tests and CI wording for QUICK_FIX progress", () => {
    const runningBlock = new ValidationHandoffBlock({
        progress: {
            kind: "mechanical",
            outcome: "running",
            stage: "ci",
            checks: { ci: "running", semanticReview: "skipped", humanReview: "skipped", merge: "skipped" },
        },
        engineer: { agentName: "Engineer", markdown: "- Repairing CI", completedOrder: 1 },
    });
    const runningPlain = stripAnsi(runningBlock.render(120).join("\n"));

    assertEquals(runningPlain.includes("Tests and CI running"), true);
    assertEquals(runningPlain.includes("Stage: CI"), false);
    assertEquals(runningPlain.includes("Mechanical Validation"), false);
    assertEquals(runningPlain.includes("Tests and CI running"), true);
    assertEquals(runningPlain.includes("Review skipped"), false);
    assertEquals(runningPlain.includes("Human skipped"), false);
    assertEquals(runningPlain.includes("Merge skipped"), false);
    assertEquals(runningPlain.includes("Engineer latest completion report"), true);
    assertEquals(runningPlain.includes("Reviewer latest AI code review"), false);

    const verifiedBlock = new ValidationHandoffBlock({
        progress: {
            kind: "mechanical",
            outcome: "verified",
            stage: "terminal",
            checks: { ci: "passed", semanticReview: "skipped", humanReview: "skipped", merge: "skipped" },
        },
    });
    const verifiedPlain = stripAnsi(verifiedBlock.render(120).join("\n"));

    assertEquals(verifiedPlain.includes("Tests and CI passed"), true);
    assertEquals(verifiedPlain.includes("Validation passed"), false);
    assertEquals(verifiedPlain.includes("Mechanical Validation"), false);
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

Deno.test("ToolExecutionBlock shows live elapsed time from execution start after it is enabled", () => {
    const originalNow = Date.now;
    let now = 1000;
    Date.now = () => now;
    try {
        const w = 100;
        const block = new ToolExecutionBlock("bash", "$ sleep 1");

        let plain = block.render(w).map((line) => stripAnsi(line)).join("\n");
        assertEquals(plain.includes("Elapsed time:"), false);

        block.enableElapsedTime();
        plain = block.render(w).map((line) => stripAnsi(line)).join("\n");
        assertEquals(plain.includes("Elapsed time: 0.0s"), true);

        now = 1500;
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

Deno.test("ToolExecutionBlock highlights the clickable plan review URL instruction", () => {
    const w = 120;
    const url = "http://127.0.0.1:4567/review/plan?token=test";
    const block = new ToolExecutionBlock("plan_written", "plan_written runtime-boundary");
    block.setOutput(
        "Plan name: docs/plans/runtime-boundary.md\n" +
            `Review Plan: \x1b]8;;${url}\x07${url}\x1b]8;;\x07\n` +
            "Status: Waiting for plan review decision.\n",
    );

    const rendered = block.render(w).join("\n");
    const plain = stripAnsi(rendered);

    assertEquals(plain.includes(`Review Plan: ${url}`), true);
    assertEquals(rendered.includes(`\x1b]8;;${url}\x07${url}\x1b]8;;\x07`), true);
    assertEquals(rendered.includes("\x1b[2mReview Plan:"), false);
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
