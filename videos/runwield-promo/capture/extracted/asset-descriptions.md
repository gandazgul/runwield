# Provided local assets

No website was captured. These are user-owned RunWield assets from the existing
accepted demo and its preserved source recordings, copied without modification.
Candidate paths below refer to the project's assets directory after staging.

- assets/logo.png [image] — actual mint W. mark from ../../brand/logo.png.
  Closing brand frame, never redrawn.
- assets/runwield-demo.mp4 [video] — accepted 90-second 1920x1080 edit with
  chapter captions; timing reference, not the preferred footage for new shots.
- assets/plan-review-feedback-loop-full.mp4 [video] — real Plannotator Plan
  Review. 0–4s establishes the plan; 12–18s adds atomic fifth-failure feedback;
  18–20s submits feedback; 30–36s shows the revised plan and Approve & Run.
- assets/runwield-tui-full-flow.mp4 [video] — original terminal Session. 0–4s
  request; 15–23s route; 945–951s revision; 1135–1163s execution handoff;
  1290–1310s implementation; 1900–1903s failed test; 2800–2803s 29 tests pass;
  3040–3043s semantic review finding; 3100–3103s repair; 3647–3652s
  validated/merged receipt. These source ranges are documented by the accepted
  edit-map.json; verify exact UI rows before final cropping.
- assets/code-review-guided-full.mp4 [video] — real guided review of the
  account-lockout implementation. 69–77s guided explanation; 108–116s actual
  side-by-side diff; 145–149s human approval.
- assets/workspace-same-session-full.mp4 [video] — real Workspace continuation
  of the same account-lockout Session. 59–64s Session/Plan view.

- assets/storyboard/execution-current.png [image] — user-supplied 3024×1762
  screenshot, current RunWield TUI executing mascot-setting-and-blink-fix; Plan
  Engineer, Session sidebar and mascot. Frame 04 replacement, native colors
  unchanged. Different Plan from account-lockout footage; label as current
  execution example.

## Source provenance

All recordings: ../../docs/runwield.dev/demo-media/source/. Accepted timing map:
../../docs/runwield.dev/demo-media/edit-90s/edit-map.json. Marketing
palette/type: sibling runwield.dev/src/styles/global.css. Brand guidance:
../../docs/design-system.md.

## Capture constraints

Use close crops that retain the genuine action and result. Do not fabricate or
retype evidence into a fake product screen. Editorial headings may summarize
what the real recording proves, but must be visibly separate from product UI.
Keep browser chrome out of the crop. Never crop away approval or failure state.
