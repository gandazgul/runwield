---
planId: "7525b0d3-0dbe-4b0b-a3fa-ce7cacb8de1a"
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
summary: "Replace macOS command-based TUI notifications with native terminal OSC notifications, focused-terminal suppression, and click-to-focus where terminals support it."
affectedPaths:
    - "src/ui/tui/system-notifications.js"
    - "src/ui/tui/system-notifications.ts"
    - "src/ui/tui/system-notifications.test.js"
    - "src/ui/tui/system-notifications.test.ts"
    - "src/ui/tui/terminal-focus-state.ts"
    - "src/ui/tui/terminal-focus-state.test.ts"
    - "src/ui/tui/tui.js"
    - "src/ui/tui/tui-manager.js"
    - "src/ui/tui/runtime-adapter.js"
    - "src/ui/tui/slash-dispatch.js"
    - "docs/settings.md"
    - "scripts/injection-seam-baseline.json"
objectiveChecks:
    - id: "OC1"
      command: "! grep -R -E 'terminal-notifier|display notification|buildOsascriptNotificationCommand|buildActivationCommand|buildExactActivationCommand' src/ui/tui/system-notifications.* src/ui/tui/system-notifications.test.*"
      rationale: "The external command-based macOS notification path is removed from active notification code and tests."
    - id: "OC2"
      command: "deno eval 'import { selectNativeNotificationProtocol } from \"./src/ui/tui/system-notifications.ts\"; const kitty = selectNativeNotificationProtocol({ sessionLabel: \"s\", terminalTitle: \"wld - s\", term: \"xterm-kitty\", kittyWindowId: \"1\" }); const wezterm = selectNativeNotificationProtocol({ sessionLabel: \"s\", terminalTitle: \"wld - s\", termProgram: \"WezTerm\", weztermPane: \"2\" }); const iterm = selectNativeNotificationProtocol({ sessionLabel: \"s\", terminalTitle: \"wld - s\", termProgram: \"iTerm.app\" }); if (kitty !== \"osc99\" || wezterm !== \"osc777\" || iterm !== \"osc9\") Deno.exit(1);'"
      rationale: "RunWield has native terminal protocol selection for Kitty, WezTerm, and iTerm2."
    - id: "OC3"
      command: "deno eval 'import { shouldSuppressAttentionNotification } from \"./src/ui/tui/system-notifications.ts\"; if (!shouldSuppressAttentionNotification({ suppressWhenFocused: true }, \"focused\")) Deno.exit(1); if (shouldSuppressAttentionNotification({ suppressWhenFocused: true }, \"unfocused\")) Deno.exit(1); if (shouldSuppressAttentionNotification({ suppressWhenFocused: true }, \"unknown\")) Deno.exit(1); if (shouldSuppressAttentionNotification({ suppressWhenFocused: false }, \"focused\")) Deno.exit(1);'"
      rationale: "Focused-terminal suppression exists, suppresses only known focused terminals by default, and remains configurable."
    - id: "OC4"
      command: "deno run -A scripts/run-tests.js src/ui/tui/system-notifications.test.ts src/ui/tui/terminal-focus-state.test.ts"
      rationale: "The new native notification and focus-tracking behavior is covered by targeted automated tests."
objectiveChecksBaseline:
    recordedAt: "2026-08-02T13:33:38.707Z"
    results:
        - id: "OC1"
          command: "! grep -R -E 'terminal-notifier|display notification|buildOsascriptNotificationCommand|buildActivationCommand|buildExactActivationCommand' src/ui/tui/system-notifications.* src/ui/tui/system-notifications.test.*"
          rationale: "The external command-based macOS notification path is removed from active notification code and tests."
          status: "unmet"
          stdout: "src/ui/tui/system-notifications.js:        const fallbackCommand = await buildOsascriptNotificationCommand({ title, message }, deps);\nsrc/ui/tui/system-notifications.js:        if (fallbackCommand && command.cmd === \"terminal-notifier\") {\nsrc/ui/tui/system-notifications.js:    // Prefer terminal-notifier whenever it is installed. Its stable -group is the\nsrc/ui/tui/system-notifications.js:    if (await commandExists(\"terminal-notifier\", deps)) {\nsrc/ui/tui/system-notifications.js:        const activationCommand = buildActivationCommand(options.terminal, options.settings.activation);\nsrc/ui/tui/system-notifications.js:            cmd: \"terminal-notifier\",\nsrc/ui/tui/system-notifications.js:    return await buildOsascriptNotificationCommand({ title: options.title, message: options.message }, deps);\nsrc/ui/tui/system-notifications.js:async function buildOsascriptNotificationCommand(options, deps) {\nsrc/ui/tui/system-notifications.js:            `display notification ${appleScriptString(options.message)} with title ${appleScriptString(options.title)}`,\nsrc/ui/tui/system-notifications.js:export function buildActivationCommand(terminal, activation = \"tab\") {\nsrc/ui/tui/system-notifications.js:        const exact = buildExactActivationCommand(terminal);\nsrc/ui/tui/system-notifications.js:export function buildExactActivationCommand(terminal) {\nsrc/ui/tui/system-notifications.test.js:    buildActivationCommand,\nsrc/ui/tui/system-notifications.test.js:    buildExactActivationCommand,\nsrc/ui/tui/system-notifications.test.js:Deno.test(\"buildExactActivationCommand prefers terminal-specific exact focus\", () => {\nsrc/ui/tui/system-notifications.test.js:        buildExactActivationCommand({ sessionLabel: \"s\", terminalTitle: \"wld - s\", weztermPane: \"9\" }),\nsrc/ui/tui/system-notifications.test.js:        buildExactActivationCommand({\nsrc/ui/tui/system-notifications.test.js:    const itermCommand = buildExactActivationCommand({\nsrc/ui/tui/system-notifications.test.js:    const terminalCommand = buildExactActivationCommand({\nsrc/ui/tui/system-notifications.test.js:Deno.test(\"buildActivationCommand falls back to app activation when exact tab activation is unavailable\", () => {\nsrc/ui/tui/system-notifications.test.js:        buildActivationCommand({ sessionLabel: \"s\", terminalTitle: \"wld - s\", term: \"xterm-kitty\" }, \"tab\"),\nsrc/ui/tui/system-notifications.test.js:        buildActivationCommand({ sessionLabel: \"s\", terminalTitle: \"wld - s\", term: \"xterm-kitty\" }, \"none\"),\nsrc/ui/tui/system-notifications.test.js:Deno.test(\"buildNotificationCommand uses terminal-notifier with click execute when available\", async () => {\nsrc/ui/tui/system-notifications.test.js:    const commands = makeCommandRecorder({ \"terminal-notifier\": true, osascript: true });\nsrc/ui/tui/system-notifications.test.js:    assertEquals(command.cmd, \"terminal-notifier\");\nsrc/ui/tui/system-notifications.test.js:Deno.test(\"buildNotificationCommand groups via terminal-notifier for terminals without a sender bundle\", async () => {\nsrc/ui/tui/system-notifications.test.js:    const commands = makeCommandRecorder({ \"terminal-notifier\": true, osascript: true });\nsrc/ui/tui/system-notifications.test.js:    assertEquals(command.cmd, \"terminal-notifier\");\nsrc/ui/tui/system-notifications.test.js:    const commands = makeCommandRecorder({ \"terminal-notifier\": true, osascript: true });\nsrc/ui/tui/system-notifications.test.js:    assertEquals(command.cmd, \"terminal-notifier\");\nsrc/ui/tui/system-notifications.test.js:Deno.test(\"buildNotificationCommand falls back to osascript when terminal-notifier is absent\", async () => {\nsrc/ui/tui/system-notifications.test.js:    assertStringIncludes(command.args.join(\" \"), \"display notification\");\nsrc/ui/tui/system-notifications.test.js:    const commands = makeCommandRecorder({ \"terminal-notifier\": true, osascript: true });\nsrc/ui/tui/system-notifications.test.js:Deno.test(\"notifyRunWieldEvent falls back to osascript when terminal-notifier command fails\", async () => {\nsrc/ui/tui/system-notifications.test.js:    const commands = makeCommandRecorder({ \"terminal-notifier\": \"fail\", osascript: true });\nsrc/ui/tui/system-notifications.test.js:    buildActivationCommand,\nsrc/ui/tui/system-notifications.test.js:    buildExactActivationCommand,\nsrc/ui/tui/system-notifications.test.js:Deno.test(\"buildExactActivationCommand prefers terminal-specific exact focus\", () => {\nsrc/ui/tui/system-notifications.test.js:        buildExactActivationCommand({ sessionLabel: \"s\", terminalTitle: \"wld - s\", weztermPane: \"9\" }),\nsrc/ui/tui/system-notifications.test.js:        buildExactActivationCommand({\nsrc/ui/tui/system-notifications.test.js:    const itermCommand = buildExactActivationCommand({\nsrc/ui/tui/system-notifications.test.js:    const terminalCommand = buildExactActivationCommand({\nsrc/ui/tui/system-notifications.test.js:Deno.test(\"buildActivationCommand falls back to app activation when exact tab activation is unavailable\", () => {\nsrc/ui/tui/system-notifications.test.js:        buildActivationCommand({ sessionLabel: \"s\", terminalTitle: \"wld - s\", term: \"xterm-kitty\" }, \"tab\"),\nsrc/ui/tui/system-notifications.test.js:        buildActivationCommand({ sessionLabel: \"s\", terminalTitle: \"wld - s\", term: \"xterm-kitty\" }, \"none\"),\nsrc/ui/tui/system-notifications.test.js:Deno.test(\"buildNotificationCommand uses terminal-notifier with click execute when available\", async () => {\nsrc/ui/tui/system-notifications.test.js:    const commands = makeCommandRecorder({ \"terminal-notifier\": true, osascript: true });\nsrc/ui/tui/system-notifications.test.js:    assertEquals(command.cmd, \"terminal-notifier\");\nsrc/ui/tui/system-notifications.test.js:Deno.test(\"buildNotificationCommand groups via terminal-notifier for terminals without a sender bundle\", async () => {\nsrc/ui/tui/system-notifications.test.js:    const commands = makeCommandRecorder({ \"terminal-notifier\": true, osascript: true });\nsrc/ui/tui/system-notifications.test.js:    assertEquals(command.cmd, \"terminal-notifier\");\nsrc/ui/tui/system-notifications.test.js:    const commands = makeCommandRecorder({ \"terminal-notifier\": true, osascript: true });\nsrc/ui/tui/system-notifications.test.js:    assertEquals(command.cmd, \"terminal-notifier\");\nsrc/ui/tui/system-notifications.test.js:Deno.test(\"buildNotificationCommand falls back to osascript when terminal-notifier is absent\", async () => {\nsrc/ui/tui/system-notifications.test.js:    assertStringIncludes(command.args.join(\" \"), \"display notification\");\nsrc/ui/tui/system-notifications.test.js:    const commands = makeCommandRecorder({ \"terminal-notifier\": true, osascript: true });\nsrc/ui/tui/system-notifications.test.js:Deno.test(\"notifyRunWieldEvent falls back to osascript when terminal-notifier command fails\", async () => {\nsrc/ui/tui/system-notifications.test.js:    const commands = makeCommandRecorder({ \"terminal-notifier\": \"fail\", osascript: true });\n"
          stderr: ""
          exitCode: 1
          durationMs: 13
          output: "src/ui/tui/system-notifications.js:        const fallbackCommand = await buildOsascriptNotificationCommand({ title, message }, deps);\nsrc/ui/tui/system-notifications.js:        if (fallbackCommand && command.cmd === \"terminal-notifier\") {\nsrc/ui/tui/system-notifications.js:    // Prefer terminal-notifier whenever it is installed. Its stable -group is the\nsrc/ui/tui/system-notifications.js:    if (await commandExists(\"terminal-notifier\", deps)) {\nsrc/ui/tui/system-notifications.js:        const activationCommand = buildActivationCommand(options.terminal, options.settings.activation);\nsrc/ui/tui/system-notifications.js:            cmd: \"terminal-notifier\",\nsrc/ui/tui/system-notifications.js:    return await buildOsascriptNotificationCommand({ title: options.title, message: options.message }, deps);\nsrc/ui/tui/system-notifications.js:async function buildOsascriptNotificationCommand(options, deps) {\nsrc/ui/tui/system-notifications.js:            `display notification ${appleScriptString(options.message)} with title ${appleScriptString(options.title)}`,\nsrc/ui/tui/system-notifications.js:export function buildActivationCommand(terminal, activation = \"tab\") {\nsrc/ui/tui/system-notifications.js:        const exact = buildExactActivationCommand(terminal);\nsrc/ui/tui/system-notifications.js:export function buildExactActivationCommand(terminal) {\nsrc/ui/tui/system-notifications.test.js:    buildActivationCommand,\nsrc/ui/tui/system-notifications.test.js:    buildExactActivationCommand,\nsrc/ui/tui/system-notifications.test.js:Deno.test(\"buildExactActivationCommand prefers terminal-specific exact focus\", () => {\nsrc/ui/tui/system-notifications.test.js:        buildExactActivationCommand({ sessionLabel: \"s\", terminalTitle: \"wld - s\", weztermPane: \"9\" }),\nsrc/ui/tui/system-notifications.test.js:        buildExactActivationCommand({\nsrc/ui/tui/system-notifications.test.js:    const itermCommand = buildExactActivationCommand({\nsrc/ui/tui/system-notifications.test.js:    const terminalCommand = buildExactActivationCommand({\nsrc/ui/tui/system-notifications.test.js:Deno.test(\"buildActivationCommand falls back to app activation when exact tab activation is unavailable\", () => {\nsrc/ui/tui/system-notifications.test.js:        buildActivationCommand({ sessionLabel: \"s\", terminalTitle: \"wld - s\", term: \"xterm-kitty\" }, \"tab\"),\nsrc/ui/tui/system-notifications.test.js:        buildActivationCommand({ sessionLabel: \"s\", terminalTitle: \"wld - s\", term: \"xterm-kitty\" }, \"none\"),\nsrc/ui/tui/system-notifications.test.js:Deno.test(\"buildNotificationCommand uses terminal-notifier with click execute when available\", async () => {\nsrc/ui/tui/system-notifications.test.js:    const commands = makeCommandRecorder({ \"terminal-notifier\": true, osascript: true });\nsrc/ui/tui/system-notifications.test.js:    assertEquals(command.cmd, \"terminal-notifier\");\nsrc/ui/tui/system-notifications.test.js:Deno.test(\"buildNotificationCommand groups via terminal-notifier for terminals without a sender bundle\", async () => {\nsrc/ui/tui/system-notifications.test.js:    const commands = makeCommandRecorder({ \"terminal-notifier\": true, osascript: true });\nsrc/ui/tui/system-notifications.test.js:    assertEquals(command.cmd, \"terminal-notifier\");\nsrc/ui/tui/system-notifications.test.js:    const commands = makeCommandRecorder({ \"terminal-notifier\": true, osascript: true });\nsrc/ui/tui/system-notifications.test.js:    assertEquals(command.cmd, \"terminal-notifier\");\nsrc/ui/tui/system-notifications.test.js:Deno.test(\"buildNotificationCommand falls back to osascript when terminal-notifier is absent\", async () => {\nsrc/ui/tui/system-notifications.test.js:    assertStringIncludes(command.args.join(\" \"), \"display notification\");\nsrc/ui/tui/system-notifications.test.js:    const commands = makeCommandRecorder({ \"terminal-notifier\": true, osascript: true });\nsrc/ui/tui/system-notifications.test.js:Deno.test(\"notifyRunWieldEvent falls back to osascript when terminal-notifier command fails\", async () => {\nsrc/ui/tui/system-notifications.test.js:    const commands = makeCommandRecorder({ \"terminal-notifier\": \"fail\", osascript: true });\nsrc/ui/tui/system-notifications.test.js:    buildActivationCommand,\nsrc/ui/tui/system-notifications.test.js:    buildExactActivationCommand,\nsrc/ui/tui/system-notifications.test.js:Deno.test(\"buildExactActivationCommand prefers terminal-specific exact focus\", () => {\nsrc/ui/tui/system-notifications.test.js:        buildExactActivationCommand({ sessionLabel: \"s\", terminalTitle: \"wld - s\", weztermPane: \"9\" }),\nsrc/ui/tui/system-notifications.test.js:        buildExactActivationCommand({\nsrc/ui/tui/system-notifications.test.js:    const itermCommand = buildExactActivationCommand({\nsrc/ui/tui/system-notifications.test.js:    const terminalCommand = buildExactActivationCommand({\nsrc/ui/tui/system-notifications.test.js:Deno.test(\"buildActivationCommand falls back to app activation when exact tab activation is unavailable\", () => {\nsrc/ui/tui/system-notifications.test.js:        buildActivationCommand({ sessionLabel: \"s\", terminalTitle: \"wld - s\", term: \"xterm-kitty\" }, \"tab\"),\nsrc/ui/tui/system-notifications.test.js:        buildActivationCommand({ sessionLabel: \"s\", terminalTitle: \"wld - s\", term: \"xterm-kitty\" }, \"none\"),\nsrc/ui/tui/system-notifications.test.js:Deno.test(\"buildNotificationCommand uses terminal-notifier with click execute when available\", async () => {\nsrc/ui/tui/system-notifications.test.js:    const commands = makeCommandRecorder({ \"terminal-notifier\": true, osascript: true });\nsrc/ui/tui/system-notifications.test.js:    assertEquals(command.cmd, \"terminal-notifier\");\nsrc/ui/tui/system-notifications.test.js:Deno.test(\"buildNotificationCommand groups via terminal-notifier for terminals without a sender bundle\", async () => {\nsrc/ui/tui/system-notifications.test.js:    const commands = makeCommandRecorder({ \"terminal-notifier\": true, osascript: true });\nsrc/ui/tui/system-notifications.test.js:    assertEquals(command.cmd, \"terminal-notifier\");\nsrc/ui/tui/system-notifications.test.js:    const commands = makeCommandRecorder({ \"terminal-notifier\": true, osascript: true });\nsrc/ui/tui/system-notifications.test.js:    assertEquals(command.cmd, \"terminal-notifier\");\nsrc/ui/tui/system-notifications.test.js:Deno.test(\"buildNotificationCommand falls back to osascript when terminal-notifier is absent\", async () => {\nsrc/ui/tui/system-notifications.test.js:    assertStringIncludes(command.args.join(\" \"), \"display notification\");\nsrc/ui/tui/system-notifications.test.js:    const commands = makeCommandRecorder({ \"terminal-notifier\": true, osascript: true });\nsrc/ui/tui/system-notifications.test.js:Deno.test(\"notifyRunWieldEvent falls back to osascript when terminal-notifier command fails\", async () => {\nsrc/ui/tui/system-notifications.test.js:    const commands = makeCommandRecorder({ \"terminal-notifier\": \"fail\", osascript: true });\n\n"
        - id: "OC2"
          command: "deno eval 'import { selectNativeNotificationProtocol } from \"./src/ui/tui/system-notifications.ts\"; const kitty = selectNativeNotificationProtocol({ sessionLabel: \"s\", terminalTitle: \"wld - s\", term: \"xterm-kitty\", kittyWindowId: \"1\" }); const wezterm = selectNativeNotificationProtocol({ sessionLabel: \"s\", terminalTitle: \"wld - s\", termProgram: \"WezTerm\", weztermPane: \"2\" }); const iterm = selectNativeNotificationProtocol({ sessionLabel: \"s\", terminalTitle: \"wld - s\", termProgram: \"iTerm.app\" }); if (kitty !== \"osc99\" || wezterm !== \"osc777\" || iterm !== \"osc9\") Deno.exit(1);'"
          rationale: "RunWield has native terminal protocol selection for Kitty, WezTerm, and iTerm2."
          status: "unmet"
          stdout: ""
          stderr: "\u001b[0m\u001b[1m\u001b[31merror\u001b[0m: Module not found \"file:///Users/gandazgul/.wld/worktrees/--Users-gandazgul-Documents-web-runwield--/runwield-runwield-native-terminal-notifications-00cfd77f/src/ui/tui/system-notifications.ts\".\n"
          exitCode: 1
          durationMs: 26
          output: "\n\u001b[0m\u001b[1m\u001b[31merror\u001b[0m: Module not found \"file:///Users/gandazgul/.wld/worktrees/--Users-gandazgul-Documents-web-runwield--/runwield-runwield-native-terminal-notifications-00cfd77f/src/ui/tui/system-notifications.ts\".\n"
        - id: "OC3"
          command: "deno eval 'import { shouldSuppressAttentionNotification } from \"./src/ui/tui/system-notifications.ts\"; if (!shouldSuppressAttentionNotification({ suppressWhenFocused: true }, \"focused\")) Deno.exit(1); if (shouldSuppressAttentionNotification({ suppressWhenFocused: true }, \"unfocused\")) Deno.exit(1); if (shouldSuppressAttentionNotification({ suppressWhenFocused: true }, \"unknown\")) Deno.exit(1); if (shouldSuppressAttentionNotification({ suppressWhenFocused: false }, \"focused\")) Deno.exit(1);'"
          rationale: "Focused-terminal suppression exists, suppresses only known focused terminals by default, and remains configurable."
          status: "unmet"
          stdout: ""
          stderr: "\u001b[0m\u001b[1m\u001b[31merror\u001b[0m: Module not found \"file:///Users/gandazgul/.wld/worktrees/--Users-gandazgul-Documents-web-runwield--/runwield-runwield-native-terminal-notifications-00cfd77f/src/ui/tui/system-notifications.ts\".\n"
          exitCode: 1
          durationMs: 27
          output: "\n\u001b[0m\u001b[1m\u001b[31merror\u001b[0m: Module not found \"file:///Users/gandazgul/.wld/worktrees/--Users-gandazgul-Documents-web-runwield--/runwield-runwield-native-terminal-notifications-00cfd77f/src/ui/tui/system-notifications.ts\".\n"
        - id: "OC4"
          command: "deno run -A scripts/run-tests.js src/ui/tui/system-notifications.test.ts src/ui/tui/terminal-focus-state.test.ts"
          rationale: "The new native notification and focus-tracking behavior is covered by targeted automated tests."
          status: "unmet"
          stdout: ""
          stderr: "\u001b[0m\u001b[1m\u001b[31merror\u001b[0m: Uncaught (in promise) Error: Deno cache prewarm failed:\n\u001b[0m\u001b[1m\u001b[31merror\u001b[0m: Import 'file:///Users/gandazgul/.wld/worktrees/--Users-gandazgul-Documents-web-runwield--/runwield-runwield-native-terminal-notifications-00cfd77f/src/ui/tui/system-notifications.test.ts' failed, not found.\n\n    throw new Error(`Deno cache prewarm failed:\\n${output}`);\n\u001b[0m\u001b[31m          ^\u001b[0m\n    at \u001b[0m\u001b[1m\u001b[3mprewarmDenoDir\u001b[0m (\u001b[0m\u001b[2m\u001b[38;5;245mfile:///Users/gandazgul/.wld/worktrees/--Users-gandazgul-Documents-web-runwield--/runwield-runwield-native-terminal-notifications-00cfd77f/\u001b[0m\u001b[0m\u001b[36mscripts/run-tests.js\u001b[0m:\u001b[0m\u001b[33m91\u001b[0m:\u001b[0m\u001b[33m11\u001b[0m)\n    at async \u001b[0m\u001b[2m\u001b[38;5;245mfile:///Users/gandazgul/.wld/worktrees/--Users-gandazgul-Documents-web-runwield--/runwield-runwield-native-terminal-notifications-00cfd77f/\u001b[0m\u001b[0m\u001b[36mscripts/run-tests.js\u001b[0m:\u001b[0m\u001b[33m180\u001b[0m:\u001b[0m\u001b[33m9\u001b[0m\n"
          exitCode: 1
          durationMs: 69
          output: "\n\u001b[0m\u001b[1m\u001b[31merror\u001b[0m: Uncaught (in promise) Error: Deno cache prewarm failed:\n\u001b[0m\u001b[1m\u001b[31merror\u001b[0m: Import 'file:///Users/gandazgul/.wld/worktrees/--Users-gandazgul-Documents-web-runwield--/runwield-runwield-native-terminal-notifications-00cfd77f/src/ui/tui/system-notifications.test.ts' failed, not found.\n\n    throw new Error(`Deno cache prewarm failed:\\n${output}`);\n\u001b[0m\u001b[31m          ^\u001b[0m\n    at \u001b[0m\u001b[1m\u001b[3mprewarmDenoDir\u001b[0m (\u001b[0m\u001b[2m\u001b[38;5;245mfile:///Users/gandazgul/.wld/worktrees/--Users-gandazgul-Documents-web-runwield--/runwield-runwield-native-terminal-notifications-00cfd77f/\u001b[0m\u001b[0m\u001b[36mscripts/run-tests.js\u001b[0m:\u001b[0m\u001b[33m91\u001b[0m:\u001b[0m\u001b[33m11\u001b[0m)\n    at async \u001b[0m\u001b[2m\u001b[38;5;245mfile:///Users/gandazgul/.wld/worktrees/--Users-gandazgul-Documents-web-runwield--/runwield-runwield-native-terminal-notifications-00cfd77f/\u001b[0m\u001b[0m\u001b[36mscripts/run-tests.js\u001b[0m:\u001b[0m\u001b[33m180\u001b[0m:\u001b[0m\u001b[33m9\u001b[0m\n"
tickets:
    - url: "https://github.com/anomalyco/opencode/issues/4454"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-08-02T09:29:18-04:00"
updatedAt: "2026-08-02T20:49:40.233Z"
status: "validated_reviewer"
origin: "internal"
implementedAt: "2026-08-02T14:12:11.124Z"
userVerifiedAt: null
executionReport: "- Implemented native terminal OSC notifications in `src/ui/tui/system-notifications.ts`: Kitty OSC 99 (`o=unfocused`), WezTerm/Ghostty OSC 777, iTerm2 OSC 9, unsupported BEL fallback, text sanitization, focused-terminal suppression, and `suppressWhenFocused` default `true`; command-based notifier helpers and imports were removed.\n- Added `src/ui/tui/terminal-focus-state.ts` and wired production TUI lifecycle cleanup to enable/disable xterm focus reporting and filter focus input; explicit test pairs stay opt-in, and Golden TUI env skips focus-reporting bytes.\n- Updated runtime/slash-dispatch imports and `docs/settings.md`; `scripts/injection-seam-baseline.json` was not changed because `deno task seams:check` still holds the existing baseline.\n- Test coverage changed from 19 replaced system-notification JS tests to 21 TS tests (+2): command-delivery tests for terminal-notifier grouping, osascript fallback, sender/activation scripts, exact-tab activation, command failure fallback, and desktop delivery were replaced because those command behaviors no longer exist; defaults/settings, terminal identity, Golden suppression, disabled/unknown events, bell behavior, compaction text, context text, write failures, protocol selection, sanitization, focus suppression, and unsupported fallback were rewritten against the native OSC/BEL shape; five new focus-state tests cover enable/disable, state transitions, filtering, passthrough, and idempotent disposal.\n- Verification passed: targeted tests (`deno run -A scripts/run-tests.js src/ui/tui/system-notifications.test.ts src/ui/tui/terminal-focus-state.test.ts`), objective checks OC1-OC3, `deno task check`, `deno task lint`, `deno task seams:check`, and rerun of initially failing golden/workspace files.\n- Verification did not pass cleanly overall: final `deno task test` failed on `src/ui/tui/golden-scenarios/concurrent-workflow.test.ts` with a Golden child idle timeout after 120000ms, although that file passed when rerun with the other initially failing files.\n- Manual terminal checks in iTerm2, Ghostty, WezTerm, Kitty, and Terminal.app were not run in this environment; native click-to-focus remains manually unverified."
humanReviewMode: "always"
humanReviewDecision: "approved"
humanReviewedAt: "2026-08-02T20:49:40.195Z"
executionMode: "worktree"
executionBaselineTree: "b93ede2a546fff98bfcf8e53176eb00c25dfe63b"
worktreeId: "00cfd77f"
worktreePath: "/Users/gandazgul/.wld/worktrees/--Users-gandazgul-Documents-web-runwield--/runwield-runwield-native-terminal-notifications-00cfd77f"
worktreeBranch: "runwield/worktree/native-terminal-notifications-00cfd77f"
worktreeBaseBranch: "main"
worktreeStatus: "validation_failed"
validationCiAttempts: 0
validationSemanticRounds: 2
---

# Native Terminal Notifications

## Context

RunWield currently sends TUI attention notifications through `src/ui/tui/system-notifications.js`. The current desktop
path is macOS-only: it prefers the optional `terminal-notifier` command when installed, then falls back to `osascript`.
That gives some click-to-return behavior, but it keeps notification delivery outside the terminal, can attribute
notifications to helper processes, and does not naturally know whether the user is already looking at the terminal.

The requested outcome is to adopt the terminal-native direction proposed in anomalyco/opencode#4454 for RunWield: do not
fire attention notifications while the RunWield terminal is focused, focus the terminal/session when the user clicks a
notification where the terminal supports that behavior, and remove the external notifier dependency. VS Code
integrated-terminal support is intentionally out of scope for this Planned Change.

RunWield's canonical terms remain TUI, attention events, Agent Session, and Session. This change does not introduce new
domain language in `CONTEXT.md`.

## Objective

Replace command-based desktop notification delivery with native terminal Operating System Command (OSC) notifications
for supported terminal emulators, while preserving RunWield's centralized attention-event model and settings controls.

The implemented behavior must be:

- TUI-only attention events still originate from `notifyRunWieldEvent` / `notifyRunWieldEventQuietly`.
- If RunWield knows the terminal is currently focused, no terminal BEL and no desktop OSC notification is emitted for
  that attention event by default.
- If focus is unknown or unfocused, RunWield emits one attention event using the best native terminal protocol
  available:
  - Kitty: OSC 99 with `o=unfocused` and default click-to-focus semantics.
  - WezTerm: OSC 777.
  - Ghostty: OSC 777.
  - iTerm2: OSC 9.
  - Unsupported terminals: terminal BEL fallback only, unless `notifications.terminalBell` is `false`.
- `terminal-notifier`, `osascript`, AppleScript activation scripts, command existence checks, and subprocess
  notification fallbacks are removed from active notification code and tests.
- Existing attention event names and per-event enable/disable settings remain compatible.

## Approach

Keep notification ownership inside the TUI layer. The Session Runtime and workflow lifecycle should continue to emit
semantic attention events; they should not know about terminal protocols or focus tracking.

Implement two focused modules/capabilities:

1. **Terminal focus state for the production TUI**
   - Add `src/ui/tui/terminal-focus-state.ts` to enable xterm focus reporting mode (`CSI ? 1004 h`) for the production
     TUI terminal, disable it on cleanup (`CSI ? 1004 l`), track `focused` / `unfocused` / `unknown`, and filter
     focus-reporting input sequences (`ESC [ I`, `ESC [ O`) before pi-tui/editor input receives them.
   - Install the focus tracker through the TUI lifecycle so crash cleanup and normal `stopTUI()` both disable focus
     reporting. Do not install it in Golden TUI or explicit virtual terminal composition tests unless a unit test opts
     into the focus tracker.
   - Treat `unknown` as not suppressible: when RunWield cannot prove the terminal is focused, it should still notify.

2. **Native OSC notification selection and emission**
   - Migrate `src/ui/tui/system-notifications.js` to `src/ui/tui/system-notifications.ts` because the file is materially
     touched and new code should be TypeScript.
   - Replace `CommandSpec` / `runCommand` / `buildNotificationCommand` with typed native-notification helpers that
     choose a protocol from `TerminalIdentity`, build safe OSC byte sequences, and write them through the existing
     terminal writer path.
   - Keep `notifications.terminalBell`, but apply focused-terminal suppression before BEL and OSC emission. This means
     the setting still controls BEL when an event is actually emitted, but focused terminals do not beep just because an
     agent stopped while the user is already there.
   - Add `notifications.suppressWhenFocused`, default `true`, so users can restore previous always-alert behavior if
     they prefer.
   - Keep `notifications.activation` as a compatibility setting if existing config contains it, but document that native
     OSC now owns click behavior. The setting should no longer cause RunWield to execute activation commands.

Use native terminal behavior for click-to-focus instead of reimplementing focus with AppleScript. This is the
compatibility trade-off the user accepted: Terminal.app, VS Code integrated terminals, and multiplexers without OSC
passthrough may fall back to BEL only, while Ghostty, WezTerm, Kitty, and iTerm2 get cleaner terminal-owned
notifications.

## Files to Modify

- `src/ui/tui/system-notifications.js` — migrate to `src/ui/tui/system-notifications.ts`; remove command-based desktop
  notifier code; add protocol selection, OSC payload building, focused-terminal suppression, and typed notification
  results.
- `src/ui/tui/system-notifications.test.js` — migrate to `src/ui/tui/system-notifications.test.ts`; replace
  terminal-notifier/osascript tests with native OSC protocol, focus suppression, sanitization, and fallback tests.
- `src/ui/tui/terminal-focus-state.ts` — new TypeScript module owning production TUI focus reporting enable/disable,
  input filtering, and focus-state read API.
- `src/ui/tui/terminal-focus-state.test.ts` — unit tests for enabling/disabling focus reporting, filtering `ESC[I` /
  `ESC[O`, state transitions, passthrough of normal input, and idempotent disposal.
- `src/ui/tui/tui.js` — wire production TUI construction to install the terminal focus tracker before pi-tui starts
  reading input.
- `src/ui/tui/tui-manager.js` — carry and dispose focus-tracking lifecycle state alongside crash guards and terminal
  title restoration; keep explicit test pairs deterministic.
- `src/ui/tui/runtime-adapter.js` — update imports from `./system-notifications.js` to `./system-notifications.ts` if
  the migrated module extension changes.
- `src/ui/tui/slash-dispatch.js` — update imports from `./system-notifications.js` to `./system-notifications.ts` if the
  migrated module extension changes.
- `docs/settings.md` — document native OSC notifications, focused-terminal suppression,
  `notifications.suppressWhenFocused`, terminal compatibility, and the removal of command-based notification helpers.
- `scripts/injection-seam-baseline.json` — update only if seam counts tighten after removing the notification subprocess
  seam; do not raise any seam baseline.

## Reuse Opportunities

- `src/ui/tui/system-notifications.js` — reuse existing event labels/messages, settings merge behavior, Golden TUI
  suppression, terminal identity detection from environment variables, message formatting, and best-effort result
  semantics.
- `src/ui/tui/tui-manager.js` — reuse the existing single TUI lifecycle boundary so focus reporting is enabled and
  disabled in the same place as crash guards and terminal title restoration.
- `src/ui/tui/testing/virtual-terminal.js` — reuse the fake terminal surface for focus-state tests and to assert escape
  sequences without touching the developer's real terminal.
- `docs/settings.md` — reuse the existing `notifications` settings section and update it rather than creating a new
  notification settings surface.

## Implementation Steps

- [ ] `src/ui/tui/terminal-focus-state.ts` exports a typed focus-state owner with states `"unknown"`, `"focused"`, and
      `"unfocused"`; it enables focus reporting with `\x1b[?1004h`, disables it with `\x1b[?1004l`, filters `\x1b[I` and
      `\x1b[O` from terminal input, updates state from those reports, passes non-focus input through unchanged and
      in-order, and disposes idempotently.
- [ ] Production TUI startup installs the focus-state owner before pi-tui begins input processing, and all
      normal/error/crash `stopTUI()` paths dispose it so the user's shell is not left in focus-reporting mode.
- [ ] Explicit TUI test pairs and Golden TUI composition do not get unexpected focus-reporting bytes in snapshots; focus
      tracking is covered by targeted unit tests instead.
- [ ] `src/ui/tui/system-notifications.ts` no longer exports or contains command-based notification helpers
      (`CommandSpec`, `runCommand`, `commandExists`, `buildNotificationCommand`, `buildOsascriptNotificationCommand`,
      AppleScript activation builders, or terminal-notifier-specific grouping/sender logic).
- [ ] `selectNativeNotificationProtocol` maps terminal identity to `"osc99"` for Kitty, `"osc777"` for WezTerm and
      Ghostty, `"osc9"` for iTerm2, and `"unsupported"` for Terminal.app/unknown terminals; unsupported terminals may
      still emit BEL when not focused and `notifications.terminalBell` is enabled.
- [ ] OSC builders sanitize or encode notification text so BEL, ESC, ST, and protocol separators from session names or
      agent text cannot break out of the notification payload; Kitty OSC 99 uses `o=unfocused` and retains default
      `a=focus` click behavior.
- [ ] `notifyRunWieldEvent` applies settings in this order: unknown event / Golden TUI suppression / global disabled /
      event disabled / focused-terminal suppression / terminal identity detection / BEL and native OSC emission. A
      focused terminal returns a structured result with `sent: false`, no BEL emission, no OSC write, and reason
      `focused` or equivalent.
- [ ] `resolveNotificationSettings` preserves existing defaults and adds `suppressWhenFocused: true`; setting it to
      `false` restores previous always-emit behavior for enabled events.
- [ ] Runtime and slash-dispatch imports compile after the `system-notifications.ts` migration, and no new
      `__deps`/dependency-bag seam names are added for notification focus state.
- [ ] Tests cover iTerm2 OSC 9, Ghostty OSC 777, WezTerm OSC 777, Kitty OSC 99, unsupported-terminal BEL fallback,
      `terminalBell: false`, `suppressWhenFocused: false`, Golden TUI suppression, malformed settings, text
      sanitization, and command-helper removal.
- [ ] `docs/settings.md` states that RunWield no longer shells out to `terminal-notifier`/AppleScript for notifications;
      native terminal OSC owns click-to-focus where supported; VS Code integrated-terminal support is out of scope for
      now; tmux/screen/zellij require terminal passthrough or fall back to BEL.
- [ ] If removing `runCommand`/subprocess notification injection tightens the seam ratchet,
      `scripts/injection-seam-baseline.json` is updated by `deno task seams:update`, and the resulting baseline change
      lowers counts only.

## Verification Plan

- Automated:
  `deno run -A scripts/run-tests.js src/ui/tui/system-notifications.test.ts src/ui/tui/terminal-focus-state.test.ts`
- Automated: `deno task check`
- Automated: `deno task lint`
- Automated: `deno task seams:check`
- Automated: `deno task test`
- Manual: in iTerm2 with escape-sequence notifications enabled, run RunWield, switch to another app while an attention
  event occurs, and confirm a native terminal notification appears and clicking it focuses iTerm2.
- Manual: in Ghostty and WezTerm, confirm attention notifications appear when the terminal is unfocused, do not appear
  when the terminal is focused, and click-to-focus follows the terminal's native behavior.
- Manual: in Kitty, confirm OSC 99 notifications honor `o=unfocused` and click returns focus to the Kitty window/tab
  according to Kitty's native behavior.
- Manual: in Terminal.app or another unsupported terminal, confirm no subprocess desktop notification is attempted and
  BEL fallback still works when `notifications.terminalBell` is enabled.
- Expected result: supported terminals receive terminal-owned native notifications without `terminal-notifier` or
  `osascript`; focused RunWield terminals stay quiet by default; unsupported environments degrade to BEL or no-op
  according to settings.
- Existing behavior that must still be protected: attention events remain limited to `agentStopped`, `planWritten`,
  `userInterview`, and `compactionFinished`; per-event settings still suppress individual events; Golden TUI tests never
  reach the developer's real desktop notification system; notification failures never crash workflow execution.
- Behavior expected to stop existing: macOS `terminal-notifier` grouping, `osascript` fallback banners, AppleScript
  exact-tab activation, and `notifications.activation`-driven command execution are intentionally removed from active
  notification delivery.

### Objective-Failing Checks

- `OC1` —
  `! grep -R -E 'terminal-notifier|display notification|buildOsascriptNotificationCommand|buildActivationCommand|buildExactActivationCommand' src/ui/tui/system-notifications.* src/ui/tui/system-notifications.test.*`
  — active notification code and tests no longer use the external command-based macOS notification path.
- `OC2` —
  `deno eval 'import { selectNativeNotificationProtocol } from "./src/ui/tui/system-notifications.ts"; const kitty = selectNativeNotificationProtocol({ sessionLabel: "s", terminalTitle: "wld - s", term: "xterm-kitty", kittyWindowId: "1" }); const wezterm = selectNativeNotificationProtocol({ sessionLabel: "s", terminalTitle: "wld - s", termProgram: "WezTerm", weztermPane: "2" }); const iterm = selectNativeNotificationProtocol({ sessionLabel: "s", terminalTitle: "wld - s", termProgram: "iTerm.app" }); if (kitty !== "osc99" || wezterm !== "osc777" || iterm !== "osc9") Deno.exit(1);'`
  — RunWield has native terminal protocol selection for the supported terminal families.
- `OC3` —
  `deno eval 'import { shouldSuppressAttentionNotification } from "./src/ui/tui/system-notifications.ts"; if (!shouldSuppressAttentionNotification({ suppressWhenFocused: true }, "focused")) Deno.exit(1); if (shouldSuppressAttentionNotification({ suppressWhenFocused: true }, "unfocused")) Deno.exit(1); if (shouldSuppressAttentionNotification({ suppressWhenFocused: true }, "unknown")) Deno.exit(1); if (shouldSuppressAttentionNotification({ suppressWhenFocused: false }, "focused")) Deno.exit(1);'`
  — focused-terminal suppression exists, suppresses only known focused terminals by default, and remains configurable.
- `OC4` —
  `deno run -A scripts/run-tests.js src/ui/tui/system-notifications.test.ts src/ui/tui/terminal-focus-state.test.ts` —
  the new native notification and focus-tracking behavior is covered by targeted automated tests.

## Edge Cases & Considerations

- **Terminal support varies:** OSC notification protocols are not one universal standard. The implementation must select
  conservatively by terminal identity and fall back rather than emitting unsupported sequences blindly.
- **Focus reporting can leak into input if mishandled:** the focus-state owner must filter `ESC[I` / `ESC[O` before
  editor input, and must disable mode on cleanup to avoid leaving the user's shell in focus reporting mode.
- **Unknown focus is not proof of focus:** RunWield should not suppress notifications unless it has received a focused
  report. Terminals that do not support focus reporting still notify when otherwise supported.
- **Click behavior is terminal-owned:** RunWield should document that click-to-focus is available where the terminal
  implements it. It should not preserve AppleScript exact-tab activation as a hidden fallback.
- **Multiplexers:** tmux/screen/zellij may require passthrough configuration for OSC notifications. Without passthrough,
  RunWield should still be safe and may only produce BEL fallback.
- **VS Code integrated terminal:** explicitly out of scope for this change. Future support may require an extension or a
  separate host-specific bridge.
- **Sound behavior:** RunWield should not request extra notification sounds. `notifications.terminalBell` remains the
  explicit RunWield sound/attention toggle; native terminal/OS notification sound policy may still vary by terminal and
  user settings.
