# Session Compaction — Pi's Architecture & Harns Integration Plan

## Overview

Session compaction compresses long conversations into a structured summary, allowing sessions to continue past context
window limits without losing accumulated knowledge.

## The Problem

Sessions accumulate messages over time. At some point, the LLM's context window fills up. Compaction compresses the past
into a summary so the session can keep going.

## How Pi's Compaction Works

### Two Trigger Paths

1. **Overflow** — The LLM returns a context overflow error. Pi removes the error message from agent state, compacts, and
   **auto-retries** the last prompt.

2. **Threshold** — After each agent turn ends, Pi checks if `contextTokens > contextWindow - reserveTokens` (default
   `reserveTokens: 16384`). If so, it compacts but **does NOT auto-retry** — the user continues manually.

Both paths are gated by `compaction.enabled` (default `true`).

### Configuration

From `../pi-mono/packages/coding-agent/src/core/compaction/compaction.ts`:

```ts
export interface CompactionSettings {
    enabled: boolean;
    reserveTokens: number; // Space to reserve in the context window (default: 16384)
    keepRecentTokens: number; // Tokens to keep from recent messages (default: 20000)
}

export const DEFAULT_COMPACTION_SETTINGS: CompactionSettings = {
    enabled: true,
    reserveTokens: 16384,
    keepRecentTokens: 20000,
};
```

The SettingsManager exposes these via:

- `getCompactionSettings()` — returns `{ enabled, reserveTokens, keepRecentTokens }`
- `getCompactionEnabled()` — boolean
- `setCompactionEnabled(enabled)` — toggle
- `getCompactionReserveTokens()` / `getCompactionKeepRecentTokens()`

---

### The Algorithm (Step by Step)

Imagine a session like this:

```
[1] User: "Build me a login page"
[2] Assistant: "Sure, let me look at the project structure"
[3] User: (tool call: read index.html)
[4] Assistant: "I see the structure..."
[5] User: "Also add a signup form"
[6] Assistant: "Let me check the signup page"
[7] User: (tool call: read signup.html)
[8] Assistant: "Here's what I'll do..."
... (20 more turns) ...
[n] Assistant: "Done! Everything's working."
```

#### Step 1: Determine the boundary

Pi finds the **last compaction entry** in the session (if any). If this is the first compaction, the boundary starts at
the first message. If the session was already compacted before, the boundary starts at `firstKeptEntryId` — the entry Pi
is keeping.

#### Step 2: Find the cut point

Pi walks **backwards from the newest entry**, accumulating estimated token sizes (chars/4 heuristic), until it has
enough recent tokens to keep (`keepRecentTokens`, default 20k). The cut point must land on a valid message boundary —
**never in the middle of a tool call** (tool results must stay with their tool calls).

Valid cut points are:

- User messages
- Assistant messages
- Custom messages
- Bash execution messages
- Branch summary entries
- Custom message entries

Tool result entries are explicitly excluded.

#### Step 3: Extract file operations

Before discarding old messages, Pi scans them for file operations — `read`, `write`, and `edit` tool calls — and records
which files were touched. This metadata is appended to the summary.

From `../pi-mono/packages/coding-agent/src/core/compaction/utils.ts`:

```ts
export interface FileOperations {
    read: Set<string>;
    written: Set<string>;
    edited: Set<string>;
}
```

#### Step 4: Generate the summary

Pi calls the LLM with a structured summarization prompt. The prompt has the conversation serialized to text (not as a
conversation the LLM might try to continue), wrapped in `<conversation>` tags. The prompt asks for this exact format:

```
## Goal
[What is the user trying to accomplish?]

## Constraints & Preferences
- [...]

## Progress
### Done
- [x] [...]

### In Progress
- [ ] [...]

## Key Decisions
- **[Decision]**: [rationale]

## Next Steps
1. [...]

## Critical Context
- [Data, examples, references]

## Read Files
<path>...

## Modified Files
<path>...
```

**Update mode**: If there's a previous summary (not the first compaction), Pi uses `UPDATE_SUMMARIZATION_PROMPT` that
merges new information into the existing summary rather than starting fresh. It preserves all existing information while
adding new progress, decisions, and context.

**Turn prefix summarization**: If the cut point falls in the middle of a turn (split turn), Pi also generates a separate
"turn prefix" summary explaining the original request and early progress, appended after `---`.

#### Step 5: Replace the old messages

Pi inserts a new `compaction` entry into the session at the cut point. This entry contains:

```ts
interface CompactionEntry {
    type: "compaction";
    id: string;
    parentId: string; // child of current leaf
    timestamp: string;
    summary: string;
    firstKeptEntryId: string; // UUID of the first entry to keep
    tokensBefore: number;
    details?: CompactionDetails; // { readFiles: string[], modifiedFiles: string[] }
    fromHook?: boolean; // true if from extension, false if Pi-generated
}
```

#### Step 6: Rebuild session context

When the session is later rebuilt (e.g., when the user reopens it or continues working), Pi's `buildSessionContext()`
walks from the current leaf to root, handling compaction specially:

1. Emit the compaction summary as a `compactionSummary` message
2. Emit all kept messages from `firstKeptEntryId` up to the compaction entry
3. Emit all messages after the compaction

This is done in `../pi-mono/packages/coding-agent/src/core/session-manager.ts`:

```ts
if (compaction) {
    // Emit summary first
    messages.push(createCompactionSummaryMessage(compaction.summary, compaction.tokensBefore, compaction.timestamp));

    // Emit kept messages (before compaction, starting from firstKeptEntryId)
    // ...walk path entries until firstKeptEntryId

    // Emit messages after compaction
    // ...continue from compaction entry onward
}
```

The agent's `state.messages` is updated with the rebuilt message list.

---

### Token Estimation

Pi uses a chars/4 heuristic for estimating message token sizes (conservative, overestimates):

```ts
// User messages: chars / 4
// Assistant messages: chars / 4 (text + thinking + tool call args)
// Tool results: chars / 4 (truncated to 2000 chars in summaries)
// Bash execution: (command + output).length / 4
// Compaction/branch summary: summary.length / 4
// Images: 4800 chars estimated (~1200 tokens)
```

Actual token usage comes from the LLM's `usage` field on assistant messages when available.

---

### Cancel / Interrupt

During compaction, pressing Escape aborts the operation via an `AbortController`. The UI shows a loader/spinner and the
user can cancel. Pi handles this through:

```ts
this._compactionAbortController = new AbortController();
// ... AbortSignal passed to LLM summarization calls

// User presses Escape →
this.session.abortCompaction(); // aborts both manual and auto compaction
```

---

### Compaction Events

Pi's AgentSession emits events during compaction:

| Event              | When                | Data                                           |
| ------------------ | ------------------- | ---------------------------------------------- |
| `compaction_start` | Compaction begins   | `{ reason: "manual"                            |
| `compaction_end`   | Compaction finishes | `{ result, aborted, willRetry, errorMessage }` |

These are handled by the interactive mode's UI layer to show loaders, status messages, and rebuild the chat after
compaction.

---

### Extension Hook: `session_before_compact`

Pi supports extensions providing their own compaction content:

```ts
interface SessionBeforeCompactResult {
    cancel?: boolean;
    compaction?: CompactionResult;
}
```

An extension handler receives the prepared compaction data and can either cancel or provide its own compaction content.
This is how custom compaction strategies work.

Example from `../pi-mono/packages/coding-agent/examples/extensions/trigger-compact.ts`:

```ts
pi.on("turn_end", (_event, ctx) => {
    const usage = ctx.getContextUsage();
    if (usage?.tokens > COMPACT_THRESHOLD_TOKENS) {
        ctx.compact({ customInstructions: "focus on architecture" });
    }
});

pi.registerCommand("trigger-compact", {
    description: "Trigger compaction immediately",
    handler: async (args, ctx) => {
        ctx.compact({ customInstructions: args.trim() || undefined });
    },
});
```

---

### The `/compact` Slash Command

In pi's interactive mode (`interactive-mode.ts`):

```ts
if (text === "/compact" || text.startsWith("/compact ")) {
    const customInstructions = text.startsWith("/compact ") ? text.slice(9).trim() : undefined;
    this.editor.setText("");
    await this.handleCompactCommand(customInstructions);
    return;
}

// handler:
private async handleCompactCommand(customInstructions?: string): Promise<void> {
    const entries = this.sessionManager.getEntries();
    const messageCount = entries.filter((e) => e.type === "message").length;
    if (messageCount < 2) {
        this.showWarning("Nothing to compact (no messages yet)");
        return;
    }
    // ... show loader
    try {
        await this.session.compact(customInstructions);
    } catch {
        // Ignore, will be emitted as events
    }
}
```

The slash command is registered in `BUILTIN_SLASH_COMMANDS`:

```ts
{ name: "compact", description: "Manually compact the session context" }
```

---

## How This Fits Harns Right Now

### What Harns Already Has

| Piece                                                       | Status | Details                                                       |
| ----------------------------------------------------------- | ------ | ------------------------------------------------------------- |
| `SessionManager` (persisted sessions in `~/.hns/sessions/`) | ✅     | Created via `createRootSessionManager()` in `root-session.js` |
| `AgentSession` (via `createAgentSession`)                   | ✅     | Used in `session.js` `runAgentSession()`                      |
| `AgentSession.compact()` method                             | ✅     | Exists in pi's AgentSession, fully functional                 |
| `SettingsManager.getCompactionSettings()`                   | ✅     | Available through pi's SettingsManager                        |
| `SettingsManager.setCompactionEnabled()`                    | ✅     | Available through pi's SettingsManager                        |
| Auto-compaction trigger (`_checkCompaction`)                | ✅     | Fires after every `turn_end` — already running                |
| Compaction entry rendering in `/session`                    | ✅     | `session/index.js` already counts compactions                 |
| Compaction entry rendering in exported HTML                 | ✅     | `root-session.js` renders compaction entries                  |

### What Needs Wiring

| Piece                        | Status                                           |
| ---------------------------- | ------------------------------------------------ |
| `/compact` slash command     | ✅ **Implemented** in `src/cmd/compact/index.js` |
| `COMPACT` in `COMMAND_NAMES` | ✅ Added to `constants.js`                       |
| Registry entry               | ✅ Registered in `cmd/registry.js`               |

---

## Harns Implementation Details

### File: `src/cmd/compact/index.js`

```js
import { getRootAgentSession } from "../../shared/session/session-state.js";

export async function runCompactCommand(argv, options = {}) {
    // 1. Guard: TUI-only command
    if (!options?.uiAPI) return;

    const { uiAPI } = options;
    const session = getRootAgentSession();
    if (!session) {
        uiAPI.appendSystemMessage("Error: No active agent session.");
        return;
    }

    // 2. Guard: prevent double-compaction
    if (session.isCompacting) {
        uiAPI.appendSystemMessage("Compaction is already in progress. Press Escape to cancel.");
        return;
    }

    // 3. Parse optional custom instructions
    const customInstructions = argv.join(" ").trim() || undefined;

    // 4. Show status message
    uiAPI.appendSystemMessage(`Compacting context...`);

    // 5. Delegate to pi's AgentSession.compact()
    try {
        const result = await session.compact(customInstructions);
        uiAPI.appendSystemMessage(
            `Session compacted successfully. Tokens before: ${result.tokensBefore.toLocaleString()}`,
        );
    } catch (error) {
        // Handle cancelled / too-small / general failure
    }
}
```

### Auto-Compaction (Already Working)

Auto-compaction is **already running** in Harns — it's baked into pi's `AgentSession._checkCompaction()` which fires
after every `turn_end`. No extra wiring needed. The default threshold triggers when:

```
contextTokens > contextWindow - reserveTokens (16384)
```

Two auto-triggers:

1. **Overflow** — LLM returns context overflow error → compact + auto-retry
2. **Threshold** — context approaching limit → compact, no retry

### Settings Exposure (Future)

To let users toggle auto-compaction on/off, Harns could expose a `/compaction-settings` or `/compact-settings` command
that calls:

```js
const settingsManager = getSettingsManager(); // from settings.js
settingsManager.setCompactionEnabled(false); // or true
```

The default values (enabled: true, reserveTokens: 16384, keepRecentTokens: 20000) work well out of the box.

---

## Summary

Pi's compaction is a well-designed system with:

1. **Automatic triggers** (overflow + threshold) — already running in Harns
2. **Manual trigger** (`/compact`) — already wired in Harns
3. **Structured summaries** — LLM-generated, preserved across sessions
4. **Extension hooks** — for custom compaction strategies
5. **Safe cut points** — never splits tool calls
6. **File tracking** — preserves which files were read/modified
7. **Iterative summaries** — merges new info into old summaries on re-compaction

Harns benefits from all of this out of the box. The `/compact` slash command delegates directly to pi's
`AgentSession.compact()`, and auto-compaction fires automatically after every turn.
