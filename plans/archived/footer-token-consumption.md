---
planId: "89409afa-fe27-4adc-bc77-980ffc17cdd9"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Add a token consumption data footer to the TUI, mirroring Pi.dev. This involves: 1. Tracking token usage (sent, received, cache reads) from the `@earendil-works/pi-coding-agent` session events. 2. Calculating the context window percentage using model data from `models.json`. 3. (Optional/Investigation) Determining a way to calculate costs based on provider pricing. 4. Updating the footer render logic in `chat-session.js` to display this information."
affectedPaths:
    - "src/shared/interactive/chat-session.js"
    - "src/shared/session/session.js"
    - "src/shared/session/session-state.js"
createdAt: "2026-06-15T13:30:00.000Z"
updatedAt: "2026-07-17T04:47:20.649Z"
status: "verified"
origin: "internal"
implementedAt: "2026-06-15T20:49:52.804Z"
verifiedAt: "2026-06-15T20:50:56.200Z"
workRecord:
    status: "generated"
    recordId: "22e87ad7-8ecc-4260-81b7-382c91339fcf"
    path: "docs/work-records/2026-07-17-added-tui-footer-token-consumption-data.md"
    lastAttemptAt: "2026-07-17T04:47:11.849Z"
executionBaselineTree: "138796165d084e98b01e46ade1dc939cd16c17f2"
---

# Footer Token Consumption Data

## Context

The Harns TUI currently shows a two-line footer with current working directory, git branch, active agent name, model,
and thinking level. Pi.dev shows richer footer data including token usage (↑ input, ↓ output, R cache-read), running
cost, and context window percentage. We want the same data in Harns.

## Objective

Add token consumption data to the **second line of the footer, on the left side** (under cwd/branch):

- `↑41k` — cumulative input (sent) tokens
- `↓1.3k` — cumulative output (received) tokens
- `R137k` — cumulative cache-read tokens
- `$0.000` — cumulative cost (with `(sub)` suffix if OAuth subscription)
- `32.6%/128k (auto)` — context window usage % / total window + auto-compact indicator

Model/thinking info stays on the right side of line 2, same as now. No third line is added.

## Approach

The data is already computed by `AgentSession.getContextUsage()` and available by iterating
`session.sessionManager.getEntries()` for `AssistantMessage` usage fields. The pricing comes from `models.json`
(per-million-token rates) and is automatically tracked in each message's `usage.cost.total` — no separate pricing lookup
needed (models.json defines `cost: { input: $/M, output: $/M, cacheRead: $/M, cacheWrite: $/M }` per model).

We'll modify the `footer.render()` function in `chat-session.js` to:

1. Access the root AgentSession on each render via `getRootAgentSession()`
2. If the session exists, iterate its entries and sum token/cost data
3. Call `session.getContextUsage()` for context window info
4. Format using the same `↑Nk ↓Nk RNk` style as Pi.dev
5. Add a `formatTokens(n)` helper local to `chat-session.js`
6. Show cost only when > 0 or when model uses OAuth subscription

Pricing question answered: prices come from `models.json` (per-million-token `input`, `output`, `cacheRead`,
`cacheWrite`). The `@earendil-works/pi-coding-agent` model registry + AI layer computes `usage.cost` automatically per
message. Harns reads the already-computed cumulative cost from session entries.

## Files to Modify

- **`src/shared/interactive/chat-session.js`** — Modify the `footer.render` callback to compute and display
  token/context data from the root AgentSession. Add a local `formatTokens(n)` helper.

## Reuse Opportunities

- **Reference (not direct import):** Pi's `FooterComponent` in
  `@earendil-works/pi-coding-agent/src/modes/interactive/components/footer.ts`. It **is** exported from the package but
  has three blockers for direct use:
  1. Depends on Pi's internal theme system (`theme.fg()`) with different color keys than Harns.
  2. Depends on `ReadonlyFooterDataProvider` for git branch — only the _type_ is exported, not the concrete class.
  3. Missing the agent-name-on-line-1 display that Harns has.

  → **Decision:** Reuse the _formatting logic_ (`formatTokens`, token summation, context percentage rendering, cost
  display) by reference, but implement directly in `chat-session.js` to match Harns' existing footer structure.

- `getRootAgentSession()` from `src/shared/session/session-state.js` — already used throughout `chat-session.js`.
- `AgentSession.getContextUsage()` — returns `{ tokens: number|null, contextWindow: number, percent: number|null }`.
  Already exposed on the `AgentSession` public API.
- `session.sessionManager.getEntries()` — iterate entries to sum `usage.input`, `usage.output`, `usage.cacheRead`,
  `usage.cacheWrite`, `usage.cost.total` from each `type === "message" && message.role === "assistant"` entry.

## Implementation Steps

- [ ] **1. Add `formatTokens()` helper to `chat-session.js`**

  Add a local function before `startInteractiveSession` (or just before the footer definition):

  ```js
  function formatTokens(count) {
      if (count < 1000) return String(count);
      if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
      if (count < 1000000) return `${Math.round(count / 1000)}k`;
      if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
      return `${Math.round(count / 1000000)}M`;
  }
  ```

  (Same formatting as Pi.dev's footer component — 1.5 decimal for <10k, round for >=10k.)

- [ ] **2. Modify the `footer.render` closure in `startInteractiveSession`**

  In the existing `footer.render` function (inside `startInteractiveSession` in `chat-session.js`):

  a. After `const { model, provider, thinkingLevel } = getModelAndProvider();`, add token data collection:

  ```js
  const session = getRootAgentSession();
  let totalInput = 0, totalOutput = 0, totalCacheRead = 0, totalCost = 0;
  let contextStr = "";

  if (session) {
      // Sum token usage from all session entries
      for (const entry of session.sessionManager.getEntries()) {
          if (entry.type === "message" && entry.message.role === "assistant") {
              totalInput += entry.message.usage.input;
              totalOutput += entry.message.usage.output;
              totalCacheRead += entry.message.usage.cacheRead;
              totalCost += entry.message.usage.cost.total;
          }
      }

      // Context usage
      const contextUsage = session.getContextUsage();
      if (contextUsage) {
          const cw = contextUsage.contextWindow ?? 0;
          const pct = contextUsage.percent;
          const pctDisplay = pct !== null ? `${pct.toFixed(1)}%` : "?";
          const cwStr = formatTokens(cw);
          const autoIndicator = " (auto)";
          const rawContext = `${pctDisplay}/${cwStr}${autoIndicator}`;
          // Colorize based on percentage
          const pctValue = pct ?? 0;
          contextStr = pctValue > 90
              ? theme.fg("error", rawContext)
              : pctValue > 70
              ? theme.fg("warning", rawContext)
              : rawContext;
      }
  }
  ```

  b. Build the stats segment string:

  ```js
  const statsParts = [];
  if (totalInput > 0) statsParts.push(`↑${formatTokens(totalInput)}`);
  if (totalOutput > 0) statsParts.push(`↓${formatTokens(totalOutput)}`);
  if (totalCacheRead > 0) statsParts.push(`R${formatTokens(totalCacheRead)}`);

  // Cost — only show if non-zero or if using OAuth subscription
  const usingSubscription = session?.state?.model ? session.modelRegistry?.isUsingOAuth?.(session.state.model) : false;
  if (totalCost > 0 || usingSubscription) {
      statsParts.push(`$${totalCost.toFixed(3)}${usingSubscription ? " (sub)" : ""}`);
  }

  if (contextStr) statsParts.push(contextStr);
  const statsSegment = statsParts.length > 0 ? statsParts.join(" ") : "";
  ```

- [ ] **3. Render the token stats on line 2, left side (under cwd/branch)**

  Final layout:
  - Line 1: `cwd (branch)` left | `agentName` right (unchanged)
  - Line 2: `↑41k ↓1.3k R137k $0.000 (sub) 32.6%/128k (auto)` left | `provider/model (thinking)` right

  Modify the existing `line2` computation. The current code has:

  ```js
  const line2LeftRaw = ctrlCPendingExit ? "Ctrl+C - Press again to exit" : "";
  const line2LeftStyled = ctrlCPendingExit ? theme.fg("warning", line2LeftRaw) : "";
  const thinkingPad = thinkingLevel !== "off" ? thinkingStr.length + 1 : 0;
  const line2Pad = Math.max(1, w - line2LeftRaw.length - modelStr.length - thinkingPad);
  const line2 = line2LeftStyled +
      " ".repeat(line2Pad) +
      theme.fg("dim", modelStr) +
      (thinkingPad > 0 ? " " + thinkingStyled : "");
  ```

  Change it to:

  ```js
  const line2LeftRaw = ctrlCPendingExit ? "Ctrl+C - Press again to exit" : statsSegment;
  const line2LeftStyled = ctrlCPendingExit ? theme.fg("warning", line2LeftRaw) : statsSegment;
  const thinkingPad = thinkingLevel !== "off" ? thinkingStr.length + 1 : 0;
  const line2Pad = Math.max(1, w - line2LeftRaw.length - modelStr.length - thinkingPad);
  const line2 = line2LeftStyled +
      " ".repeat(line2Pad) +
      theme.fg("dim", modelStr) +
      (thinkingPad > 0 ? " " + thinkingStyled : "");
  ```

  When `ctrlCPendingExit` is true, the exit warning overrides the stats (just like it currently overrides the empty
  left). When false and stats are available, show `statsSegment`. When false and no session yet (statsSegment empty),
  line2 left is empty (current behavior).

- [ ] **4. Run `deno run ci` to verify everything passes**

  This includes lint, format check, and tests. Fix any issues.

## Verification Plan

- **Automated:** `deno run ci` — verify no lint/format/test failures.
- **Manual:** Interactive test:
  1. Start `deno run -A src/cli.js`
  2. Send a few messages to generate token usage
  3. Verify footer line 2 shows `↑Nk ↓Nk RNk $0.000 0.0%/128k (auto)` on the left
  4. Verify context percentage colorizes properly (>70% warning, >90% error)
  5. Verify cost shows `(sub)` suffix when using OAuth model (e.g., Claude Sonnet)
  6. Verify empty state (before any turns) doesn't crash
  7. Verify Ctrl+C warning still overrides line 2

## Edge Cases & Considerations

- **No active root session:** `getRootAgentSession()` returns null before first session build and during agent switches.
  The render must handle null gracefully and leave line2 left empty (current behavior).
- **After compaction:** `getContextUsage()` returns `{ tokens: null, percent: null }` until the next LLM response. Show
  `?/128k (auto)` in that case.
- **Model without context window:** Some models may not define `contextWindow`. Default to `?` in that case.
- **Cost precision:** Pi.dev shows 3 decimal places (`$0.000`). Match this.
- **Performance:** The footer renders on every keystroke. Iterating session entries should be fast for typical session
  sizes (<1000 entries). No memoization needed.
- **OAuth subscription detection:** Use `session.modelRegistry?.isUsingOAuth?.(model)` — optional chaining guards
  against `modelRegistry` not being available.
- **No existing tests to modify:** The footer is rendered inside a closure with no isolated test. Rely on manual
  verification and `deno run ci`.
