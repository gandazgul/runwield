diffstat only, patch not produced. Full patch: git show -p <rev>
---
planId: "29398c6b-fa02-4bb6-bada-14b2f8429451"
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
affectedPaths:
    - "src/shared/settings.js"
    - "src/ui/mascot/mascot.ts"
    - "src/ui/tui/agent-mascot.ts"
    - "src/ui/tui/chat-view.ts"
    - "src/cmd/settings/index.ts"
    - "src/ui/workspace/server/session-continuation.js"
    - "src/ui/workspace/islands/SessionSurface.jsx"
    - "docs/settings.md"
    - "docs/prd/runwield-core-prd.md"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-10-03T11:26:09-04:00"
origin: "internal"
userVerifiedAt: null
routingIntent: "PLANNED_CHANGE"
sessionName: "Mascot Visibility Setting"
targetBranch: "main"
status: "validated"
validatedCommit: "a94f7e11246bb5809716984debf3d9b585b873d9"
workRecord:
    status: "generated"
    recordId: "21b92d3b-60a4-4506-815a-48d48d54c168"
    path: "docs/work-records/2026-10-04-mascot-visibility-control-and-stable-tui-blinking.md"
    lastAttemptAt: "2026-10-04T00:55:05.481Z"
---
# Mascot visibility setting and base-mascot blink fix
## Context
The agent mascot is always visible today. Two problems:
1. Users cannot turn it off. The mascot renders in the TUI chat view (`src/ui/tui/chat-view.ts`) and the Workspace
   composer (`RunWieldMascot` in `src/ui/workspace/islands/SessionSurface.jsx`) with no setting controlling it.
2. The base mascot's blinking dot makes the whole mascot slide left and right. The dot occupies columns 15–16 while the
   body is 13 wide, and `TuiAgentMascot.render` centers the drawing on its per-frame trimmed width. The padding changes
   by ~2 cells every time the dot appears or disappears, so the mascot moves instead of blinking in place.
The user decided: the setting is honored on both surfaces, but toggling happens only through the TUI `/settings` menu or
by editing settings files. A Workspace settings page may be built later; this Plan does not add Workspace toggle UI.
Owning PRD capability: [Agent mascots](../prd/runwield-core-prd.md#agent-mascots) in `docs/prd/runwield-core-prd.md`.
This Plan adds a visibility setting to that capability and fixes the TUI centering behavior its acceptance scenario
already describes ("the mascot centered at each sidebar width").
## Objective
... more lines (truncated by snip)
