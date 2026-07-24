---
name: agent-browser-use
description: Use this skill when building, fixing, reviewing, or debugging web UI, UX, or frontend behavior and you need to exercise the app in a real browser with agent-browser. Use it to reproduce user-reported browser bugs, inspect accessibility snapshots, interact with forms and controls, capture screenshots for visual verification, check console/network failures, or compare UI before and after changes.
compatibility: Requires the agent-browser CLI. RunWield's installer provisions it as a required helper when missing; run agent-browser install to fetch Chrome for Testing when needed.
metadata:
    version: "1.0"
---

# Agent Browser Use

Use `agent-browser` as the browser feedback loop for web UI work. It is strongest when the question is visual,
interactive, or browser-specific: "does this screen render correctly?", "can the user complete the flow?", "can I
reproduce the reported bug?", and "what screenshot proves the fix?".

## Install or Repair the Tool

Before relying on it, check whether the CLI exists:

```bash
command -v agent-browser
```

If it is missing in a RunWield environment, rerun the RunWield installer to restore the required helper outside the
target project so browser tooling does not create project-local `package.json`, manifest, or lockfile changes:

```bash
curl -fsSL https://raw.githubusercontent.com/gandazgul/runwield/main/install.sh | bash
```

Then install Chrome for Testing when needed:

```bash
agent-browser install
```

Do **not** run `npm install --save-dev agent-browser`, add `agent-browser` to the project manifest, or change project
lockfiles unless the approved Plan explicitly scopes that tooling change. On Linux, use browser dependency installation
when Chrome cannot launch, again outside the target project unless scoped:

```bash
agent-browser install --with-deps
```

## UI Feedback Loop

1. Start or reconnect to the target app using the project's normal dev server or preview command. Prefer the Plan's
   recorded `devServerCommand`/`devServerUrl` when present, keep HMR-capable servers alive across increments, and
   reconnect/restart only after confirming the process and named browser session belong to the current execution
   worktree. Do not attach to or kill a server from another worktree; if ownership is ambiguous, start a separate
   worktree-scoped process on an available port and report the URL used.
2. Open the page in an isolated named browser session so the same headed window can persist across implementation, Pair
   checkpoints, and validation repairs. The session name must be assignment- and worktree-specific (for example, include
   the Plan slug plus a short worktree or branch identifier); do not reuse a fixed shared name across assignments:

```bash
agent-browser --headed --session runwield-<plan-slug>-<worktree-id> open http://localhost:3000
```

3. Set the viewport or device that matches the bug report or acceptance target:

```bash
agent-browser set viewport 1440 1000
agent-browser set device "iPhone 14"
agent-browser set media dark
```

4. Wait for the app to settle before judging it:

```bash
agent-browser wait --load networkidle
agent-browser wait --text "Dashboard"
```

5. Inspect the page through the accessibility tree before clicking:

```bash
agent-browser snapshot -i -c
```

6. Interact through semantic locators or snapshot refs:

```bash
agent-browser find role button click --name "Save"
agent-browser find label "Email" fill "test@example.com"
agent-browser click @e2
agent-browser press Enter
```

7. Capture evidence:

```bash
agent-browser screenshot ./artifacts/ui-check.png
agent-browser screenshot --full ./artifacts/ui-check-full.png
agent-browser screenshot --annotate ./artifacts/ui-check-annotated.png
```

The loop is complete when the browser state, screenshot, console/errors, and relevant network checks support the same
conclusion. In Pair Execution, use this evidence for the next `pair_checkpoint`; checkpoint approval is implementation
steering, not final verification or Task Completion evidence.

## Reproducing User-Reported Bugs

Treat the report as a script. Match the user's URL, viewport/device, color scheme, auth state, and sequence of actions
before changing code.

Useful commands:

```bash
agent-browser open http://localhost:3000/reported-route
agent-browser set viewport 390 844
agent-browser wait --load networkidle
agent-browser snapshot -i -c
agent-browser console
agent-browser errors
agent-browser network requests --type xhr,fetch
```

If the bug depends on login or app storage, use an isolated persistent session rather than redoing setup every run:

```bash
agent-browser --session runwield-<plan-slug>-<worktree-id>-bug --restore open http://localhost:3000/login
```

For protected origins or setup that must happen before first navigation, launch blank, stage state, then navigate:

```bash
agent-browser batch \
  '["open"]' \
  '["cookies","set","session","dev-token"]' \
  '["navigate","http://localhost:3000/protected"]'
```

Do not call the bug reproduced until the visible symptom, console or network evidence, and the user's described steps
line up.

## Visual Verification

Screenshots are the primary artifact for UI/UX work. Capture at least one desktop and one relevant mobile viewport when
the change is responsive, layout-heavy, or visual.

```bash
agent-browser set viewport 1440 1000
agent-browser screenshot ./artifacts/desktop.png
agent-browser set device "iPhone 14"
agent-browser screenshot ./artifacts/mobile.png
```

Use annotated screenshots when refs or icon-only controls are hard to identify:

```bash
agent-browser screenshot --annotate ./artifacts/annotated.png
agent-browser click @e4
```

Use visual diffs when comparing a known-good baseline to the changed UI:

```bash
agent-browser screenshot ./artifacts/before.png
agent-browser diff screenshot --baseline ./artifacts/before.png -o ./artifacts/diff.png
```

When text, spacing, overlap, clipping, or responsive wrapping is the concern, combine screenshots with bounding boxes
and computed styles:

```bash
agent-browser get box ".primary-panel"
agent-browser get styles ".primary-panel"
```

## Browser Diagnostics

Run these checks before declaring a frontend fix complete:

```bash
agent-browser errors
agent-browser console
agent-browser network requests --type xhr,fetch --status 400-599
agent-browser get url
agent-browser get title
```

For deeper issues:

```bash
agent-browser network har start
agent-browser network har stop ./artifacts/session.har
agent-browser trace start
agent-browser trace stop ./artifacts/browser-trace.zip
```

Use `eval` sparingly for observations that are not exposed by the accessibility tree:

```bash
agent-browser eval "Array.from(document.querySelectorAll('button')).map(b => b.textContent)"
```

## Cleanup

Keep the named headed session available while the workflow is active, especially during Pair Execution or validation
repair, so user-visible state is not discarded unnecessarily. Close sessions at terminal workflow completion, and always
close auth or persistent-state sessions that are no longer needed:

```bash
agent-browser close
agent-browser close --all
```

Report the exact URL, viewport/device, commands or action sequence, screenshot paths, and remaining browser diagnostics
in the final answer. If `agent-browser` could not be installed, launched, or reconnected, say which command failed, what
browser evidence remains unverified, and fall back only to the project's existing browser test tooling.
