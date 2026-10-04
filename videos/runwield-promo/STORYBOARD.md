---
format: 1080x1080
duration: 30s
message: "Let agents write code. Keep engineering control."
arc: Promise → Plan Review → Execution → Validation loop → Human approval → Continuity → CTA
audience: experienced developers using AI coding agents
mode: collaborative
music: none
---

# RunWield — engineering control

## Direction

A 30-second promotional cut, not a compressed tutorial. Follow the real
account-lockout review/validation demo, with a labeled current execution example
from the user's mascot-setting Plan substituted at their request. Plannotator is
the centerpiece: nine seconds show feedback, revision, and approval. The
validation loop is proof of the promise, not a decorative checklist.

Use the real RunWield logo, dark navy and mint from `frame.md`, large editorial
type, and tightly framed original recordings. Keep a small stage label outside
the product footage so viewers always know where they are in the flow. Preserve
the same account-lockout title across interfaces wherever the crop permits.

No generated audio or narration in this first cut. It must read silently and
leave room for the user's later voice-over. No publishing, site changes, or
replacement of the accepted 90-second walkthrough.

## Review state

Sequence approved by the user: “go for it.” Static layout sheet v2 is available
at `storyboard.html`, with all eight frames sketched and marked built. Layout
approval is still pending; there are no animated frame compositions yet. Real
source stills show framing, not final timing. Source ranges below are
candidates; the exact click and post-click frames must be checked during
production.

## Changes from v1

User feedback: “can you get a new screenshot for execution that one is really
outdated and the colors look weird”. User supplied a current TUI screenshot.
Frame 04 uses `assets/storyboard/execution-current.png`, copied byte-for-byte
without recoloring or cropping. It depicts the mascot-setting Plan, not the
account-lockout Session. Treat it as a labeled current execution example, not
continuous evidence from the original demo. Other frames are unchanged.

## Evidence and framing rules

- Real UI only: no invented terminal output, approval states, or synthetic
  product screens.
- Use Plannotator Plan Review, never the Workspace Plan detail view as its
  substitute.
- Crop browser chrome out. Reframe the action, not merely the center of a
  screen.
- Keep failure and approval states legible. Never start a TUI shot on its
  footer.
- Compress elapsed execution time with cuts, not claims of instantaneous
  completion.
- The validation shot proves a failed check, repair, and passing checks. Passing
  tests alone must not be labeled final delivery approval.
- Hold human approval long enough to recognize the control. Confirm the click
  and resulting state before locking the cut.
- No role catalogue or installation tutorial in this promo; the existing
  walkthrough carries those details.

## Frame 1 — Keep control (0–3s)

- scene: RunWield's promise lands in large mint and white type on navy.
- duration: 3s
- transition_in: cut
- status: built
- src: compositions/frames/01-hook.html
- voiceover: ""
- type: hook
- persuasion: establish the benefit before the interface
- beat: Agents write; you retain control.
- blueprint: kinetic-type-beats
- asset_candidates: assets/logo.png

On-screen copy: **Let agents write code.** → **Keep engineering control.**

Two related statements, not two unrelated title cards. The word “control”
carries into the first human action. Keep the real logo small; the promise is
the hook.

## Frame 2 — Shape the Plan (3–8s)

- scene: A real Plannotator comment makes the concurrency requirement explicit.
- duration: 5s
- transition_in: cut
- status: built
- src: compositions/frames/02-plan-feedback.html
- voiceover: ""
- type: demo
- persuasion: demonstrate that the human can steer the proposed change
- beat: Annotate the Plan before execution.
- asset_candidates: assets/plan-review-feedback-loop-full.mp4

On-screen copy: **Shape the Plan.**

Source candidate: 12–20s. Focus on the actual comment about the atomic
fifth-failure transition and its submission. Show enough Plan Review identity to
establish the interface, then make the comment readable. This is the first hero
product shot.

## Frame 3 — Revise, then approve (8–12s)

- scene: Plan revision leads to the real Approve & Run control.
- duration: 4s
- transition_in: cut
- status: built
- src: compositions/frames/03-plan-approval.html
- voiceover: ""
- type: proof
- persuasion: show that feedback changes the Plan before work begins
- beat: Feedback → revision → explicit approval.
- asset_candidates: assets/plan-review-feedback-loop-full.mp4,
  assets/runwield-tui-full-flow.mp4

On-screen copy: **Revise. Approve. Run.**

Source candidates: Plan Review 30–36s; TUI 945–951s for the substantive revision
if the browser diff is mostly metadata. Do not present a metadata-only diff as
proof the concurrency requirement changed. Finish on Approve & Run, holding the
control and verifying the actual action before cutting into execution.

## Frame 4 — Let the agent build (12–14s)

- scene: A current user-supplied TUI screenshot shows real Plan execution.
- duration: 2s
- transition_in: cut
- status: built
- src: compositions/frames/04-execution.html
- voiceover: ""
- type: demo
- persuasion: connect approval to implementation
- beat: The agent executes the approved work.
- asset_candidates: assets/storyboard/execution-current.png

On-screen copy: **Then let it build.**

Source: user-provided screenshot of the mascot-setting Plan executing in the
current TUI. Preserve native colors, Session sidebar, and mascot. Editorial
label: **Current execution example**. This is a still, not moving footage, and
not the account-lockout Session; do not fabricate continuity or animation inside
the product UI. The original image remains unmodified.

## Frame 5 — Failure starts a repair loop (14–20s)

- scene: Failed validation starts repair, then real test evidence shows a pass.
- duration: 6s
- transition_in: cut
- status: built
- src: compositions/frames/05-validation-loop.html
- voiceover: ""
- type: proof
- persuasion: show recovery instead of implying the first attempt always works
- beat: Check fails → repair runs → checks pass.
- asset_candidates: assets/runwield-tui-full-flow.mp4

On-screen copy: **Check. Repair. Check again.**

Source candidates: 1900–1903s and 2800–2803s. The first shows “Tests and CI
failed” and “Validation Repair Engineer will fix it now.” The second shows
tests/CI passed and the repair report, including the unchanged count of 29
tests. Give each state a readable hold. Editorial progression is outside the
footage, not a fake UI badge.

## Frame 6 — You approve the code (20–24s)

- scene: Actual Code Review evidence leads to human approval.
- duration: 4s
- transition_in: cut
- status: built
- src: compositions/frames/06-code-review.html
- voiceover: ""
- type: proof
- persuasion: close the control promise with an explicit human decision
- beat: Inspect the change; approve it yourself.
- asset_candidates: assets/code-review-guided-full.mp4

On-screen copy: **You approve the code.**

Source candidates: 108–116s diff and 145–149s human approval. Keep the review
title or diff visible as context; focus on the annotation and Approve action.
Hold this moment rather than flashing the button past the viewer. Verify a
post-click state.

## Frame 7 — One Session, two surfaces (24–27s)

- scene: The same account-lockout Session continues in Workspace.
- duration: 3s
- transition_in: cut
- status: built
- src: compositions/frames/07-workspace.html
- voiceover: ""
- type: payoff
- persuasion: demonstrate continuity between terminal and Workspace
- beat: Same Session, now in Workspace.
- asset_candidates: assets/workspace-same-session-full.mp4

On-screen copy: **Same Session. TUI ↔ Workspace.**

Source candidate: 59–64s. Preserve the account-lockout Session name, visible
repair record, and Workspace identity. Do not substitute a disconnected product
screen.

## Frame 8 — RunWield (27–30s)

- scene: The real logo and clear destination close on the control promise.
- duration: 3s
- transition_in: cut
- status: built
- src: compositions/frames/08-brand.html
- voiceover: ""
- type: cta
- persuasion: attach the demonstrated benefit to a memorable product and
  destination
- beat: RunWield — keep engineering control.
- asset_candidates: assets/logo.png

On-screen copy: **RunWield** / **Keep engineering control.** / **runwield.dev**

Use the supplied logo unchanged, not a redrawn letter. Hold the URL for the
whole closing beat. No extra feature list or competing CTA.
