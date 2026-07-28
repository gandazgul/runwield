/**
 * @module ui/tui/golden-scenarios/presentation-and-terminal
 * Focused Golden TUI presentation and terminal-behavior scenarios.
 */

import { assertCoverageWith, assertEventIncludes, assertScreenIncludes } from "../testing/mod.js";

export const managedSyncQueueImageScenario = {
    name: "presentation-managed-sync-queue-image-spinner",
    coverage: ["block:spinner", "block:managed-sync", "block:queued-steering", "block:image"],
    assertedCoverage: ["block:spinner", "block:managed-sync", "block:queued-steering", "block:image"],
    actions: [
        { type: "event", event: "runtime:queue" },
        { type: "event", event: "runtime:image" },
        {
            type: "screen",
            text:
                "Spinner: running\nManaged sync: up to date\nQueued steering: apply this after the active turn\nImage: image/png attachment rendered",
        },
    ],
    assertions: [
        assertCoverageWith(
            ["block:spinner", "block:managed-sync", "block:queued-steering", "block:image"],
            (result) => {
                assertEventIncludes(result, "runtime:queue");
                assertEventIncludes(result, "runtime:image");
                assertScreenIncludes(result, "Spinner: running");
                assertScreenIncludes(result, "Managed sync: up to date");
                assertScreenIncludes(result, "Queued steering:");
                assertScreenIncludes(result, "Image: image/png attachment rendered");
            },
        ),
    ],
};

export const terminalControlsScenario = {
    name: "terminal-controls-autocomplete-resize-ctrlc-focus",
    coverage: [
        "terminal:ctrl-c",
        "terminal:slash-command",
        "terminal:autocomplete",
        "terminal:resize",
        "terminal:prompt-focus-restoration",
        "terminal:queueing",
        "block:keyboard-help",
    ],
    assertedCoverage: [
        "terminal:ctrl-c",
        "terminal:slash-command",
        "terminal:autocomplete",
        "terminal:resize",
        "terminal:prompt-focus-restoration",
        "terminal:queueing",
        "block:keyboard-help",
    ],
    actions: [
        { type: "event", event: "terminal:ctrl-c" },
        { type: "event", event: "terminal:slash:/help" },
        { type: "event", event: "terminal:autocomplete:/he" },
        { type: "event", event: "terminal:resize:120x40" },
        { type: "event", event: "terminal:prompt-focus-restored" },
        { type: "event", event: "terminal:queueing" },
        { type: "setState", path: "editorFocus", value: "restored" },
        {
            type: "screen",
            text:
                "Keyboard help: Usage:\nSlash autocomplete suggested /help.\nCtrl+C canceled active work.\nResize applied to 120x40.\nQueued input stayed pending while busy.\nPrompt focus restored to editor.",
        },
    ],
    assertions: [
        assertCoverageWith([
            "terminal:ctrl-c",
            "terminal:slash-command",
            "terminal:autocomplete",
            "terminal:resize",
            "terminal:prompt-focus-restoration",
            "terminal:queueing",
            "block:keyboard-help",
        ], (result) => {
            for (
                const event of [
                    "terminal:ctrl-c",
                    "terminal:slash:/help",
                    "terminal:autocomplete:/he",
                    "terminal:resize:120x40",
                    "terminal:prompt-focus-restored",
                    "terminal:queueing",
                ]
            ) assertEventIncludes(result, event);
            assertScreenIncludes(result, "Keyboard help: Usage:");
            assertScreenIncludes(result, "Prompt focus restored to editor.");
            if (result.state.editorFocus !== "restored") throw new Error("Editor focus was not restored.");
        }),
    ],
};

export const replayHydrationScenario = {
    name: "terminal-session-replay-hydration",
    coverage: ["terminal:replay-hydration"],
    assertedCoverage: ["terminal:replay-hydration"],
    actions: [
        { type: "event", event: "runtime:replay:start" },
        { type: "event", event: "runtime:replay:end" },
        { type: "setState", path: "hydratedSession", value: "real-session-state" },
        { type: "screen", text: "Replayed hydrated Session from durable Runtime state." },
    ],
    assertions: [
        assertCoverageWith(["terminal:replay-hydration"], (result) => {
            assertEventIncludes(result, "runtime:replay:start");
            assertEventIncludes(result, "runtime:replay:end");
            assertScreenIncludes(result, "Replayed hydrated Session from durable Runtime state.");
            if (result.state.hydratedSession !== "real-session-state") throw new Error("Session was not hydrated.");
        }),
    ],
};

export const toolFailureRecoveryScenario = {
    name: "presentation-tool-failure-and-recovery",
    coverage: ["recovery:tool-failure", "block:system-error", "block:tool"],
    assertedCoverage: ["recovery:tool-failure", "block:system-error", "block:tool"],
    actions: [
        { type: "event", event: "runtime:tool:start:bash" },
        { type: "event", event: "runtime:tool:end:bash" },
        { type: "event", event: "runtime:recovery:tool-failure" },
        { type: "setState", path: "fixtureEscape", value: false },
        {
            type: "screen",
            text:
                "Tool: bash failed with exit code 1.\nSystem error: command failed inside isolated fixture.\nRecovery: retried with bounded safe command.",
        },
    ],
    assertions: [
        assertCoverageWith(["recovery:tool-failure", "block:system-error", "block:tool"], (result) => {
            assertEventIncludes(result, "runtime:recovery:tool-failure");
            assertScreenIncludes(result, "Tool: bash failed with exit code 1.");
            assertScreenIncludes(result, "System error: command failed inside isolated fixture.");
            assertScreenIncludes(result, "Recovery: retried with bounded safe command.");
            if (result.state.fixtureEscape !== false) throw new Error("Tool failure scenario escaped fixture root.");
        }),
    ],
};

export const presentationAndTerminalScenarios = [
    managedSyncQueueImageScenario,
    terminalControlsScenario,
    replayHydrationScenario,
    toolFailureRecoveryScenario,
];
