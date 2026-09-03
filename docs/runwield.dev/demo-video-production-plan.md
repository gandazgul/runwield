# RunWield Demo Video Production Plan

## Recorded cut

The current silent cut is 3:39 at 1920×1080. It uses the disposable `wld_demo` authentication fixture and two real
RunWield Sessions: a short account-lockout Router-to-Planner example, followed by the completed authentication endpoint
workflow used for the Plan, execution, Workspace, and validation sections:

```text
account-lockout request -> Router -> Planner
protected-endpoint Plan -> execution -> Workspace -> validated Plan
```

The footage was captured without the user's personal browser, browser chrome, bookmarks, extensions, notifications, or
desktop. Workspace frames came only from the dedicated `RunWield` Chrome profile. TUI frames came from terminal casts.

Generated files live in `docs/runwield.dev/demo-media/`:

- `runwield-overview-demo.mp4` — silent 1080p master, ready for voice-over.
- `runwield-overview-poster.jpg` — poster frame.
- `router-to-plan.webm`, `router-to-plan.mp4`, and `router-to-plan.gif` — Router-to-Planner website loop.
- `tui-to-workspace.webm`, `tui-to-workspace.mp4`, and `tui-to-workspace.gif` — terminal-to-Workspace website loop.

The matching narration is in `demo-voiceover-script.md`.

## Goal

Show one believable piece of work moving through RunWield, with the user in control at the important moments:

```text
request -> Router -> Plan -> human review -> execution -> validation -> durable record
```

The demo should also prove that TUI and Workspace are two views of the same Session, then give Guide, Ideator, and
Operator a short overview without turning the video into a feature catalog.

## Deliverables

1. **Full narrated demo:** 3:30-4:30, 16:9, uploaded as the canonical walkthrough.
2. **Website loop 1 — Plan before code:** 8-12 seconds, silent, Router/Plan review/approval into execution.
3. **Website loop 2 — One Session, two surfaces:** 8-12 seconds, silent, a committed message appearing in Workspace and
   the already-open TUI.
4. **Fallback stills:** one poster frame for the full video and one poster for each loop.
5. **Captions/transcript:** edited from the final narration, not generated from the rough recording.

Export the website loops as WebM and MP4 for normal playback. Also make GIF versions for places that require GIF, but do
not use the GIF as the primary website asset; it will be larger and less clear.

## Story and demo repository

Use a clean, disposable repository made specifically for the demo. It should look like a credible small product, have
fast deterministic tests, and contain no personal paths, tokens, customer data, or unrelated work.

Recommended example: a small incident dashboard with a few cards and tests.

Main request:

> Add a severity filter to the incident board, preserve the selected filter after refresh, and cover the behavior with
> tests.

This is understandable without explanation, visible in a browser, and large enough to justify a Plan. Keep the demo
repository small enough that planning, execution, and validation finish predictably.

Prepare the repository at a clean tagged baseline. Do not stage fake Agent output. It is fine to remove waits and use
jump cuts, but every shown result should come from a real RunWield Session.

## Full video

| Time      | Picture                                                                                                           | Narration / point                                                                                                       |
| --------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 0:00-0:12 | Finished incident filter, then one fast flash of the reviewed Plan                                                | "Most coding agents start changing files immediately. RunWield first decides how much process the request deserves."    |
| 0:12-0:35 | TUI: submit the main request; Router publishes the Triage Report and hands off to Planner                         | Router scales ceremony with risk. This request is a Planned Change, so implementation cannot start yet.                 |
| 0:35-1:05 | TUI: Planner investigates; show the compact activity rather than every tool call; Plan artifact becomes available | The Planner grounds the proposal in the repository and writes a durable Markdown Plan.                                  |
| 1:05-1:42 | Open Plan Review in Workspace; scan the Plan, add one useful inline comment, receive the revision, approve it     | The user reviews intent while changing direction is still cheap. Make the comment substantive, not cosmetic.            |
| 1:42-2:15 | Return to the same Session in TUI; show execution starting in an isolated worktree and the current Plan step      | Approval authorizes execution. The implementation owner works from the approved Plan.                                   |
| 2:15-2:45 | Workspace: open that same Session and continue with one short message; show execution/validation progress         | Workspace is not a separate chat. It is the same durable Session and workflow viewed from the browser.                  |
| 2:45-3:15 | Show Mechanical Validation and semantic review progressing; reveal the finished UI change                         | "Done" is a proven lifecycle outcome, not the moment the Agent stops typing.                                            |
| 3:15-3:42 | Fast three-card montage: Guide, Ideator, Operator                                                                 | Guide answers, Ideator sharpens an unclear idea, and Operator performs direct non-code work. Router chooses among them. |
| 3:42-4:05 | Workspace Plan Board plus Work Record/artifact link                                                               | Plans and outcomes remain as readable project knowledge instead of disappearing into chat history.                      |
| 4:05-4:15 | Logo and URL                                                                                                      | "Review the Plan. Steer the work. Prove the result."                                                                    |

Do not show the entire model wait. Keep enough real activity to establish that the work happened, then cut on a clear
state change. Use simple hard cuts; the product already supplies the visual motion.

## Same-Session handoff shot

This is the proof shot and should be unmistakable:

1. Keep the TUI open on the named Session and wait until it is idle.
2. Open the same Session from the registered Project in Workspace.
3. Send a short continuation from Workspace: `Show me which Plan step is active now.`
4. Let the response commit fully.
5. Switch back to the already-open TUI and show the committed turn synchronize into the same transcript.
6. Keep the Session title visible in both surfaces so the viewer can verify continuity without narration.

Do not imply simultaneous writing. The visual story is safe continuation and synchronization between surfaces.

## Guide, Ideator, and Operator montage

Record these as separate short Sessions, then cut them into the full video. Each shot needs only the request, Router's
Triage Report, the specialist name, and the first useful part of the response.

### Guide

> How does this app decide which incidents are critical?

Show `INQUIRY -> Guide` and a grounded answer. Do not wait for a long explanation.

### Ideator

> I am considering incident snoozing, but I am not sure what the safest user experience should be. Help me shape it.

Show `IDEATION -> Ideator` followed by one sharp interview question. A finished PRD is not necessary in this montage.

### Operator

> Run the production build and report the final bundle size. Do not change source files.

Show `OPERATION -> Operator`, the command activity, and the verified result. Use a repository whose build is fast and
stable.

## Website loops

### Loop 1: Plan before code

Start on the Router's Planned Change decision. Cut to the Plan Review comment/approval. End on the visible transition to
execution. The loop should communicate the core value even with no sound or surrounding text.

Suggested nearby copy:

> Review what the Agent plans to do before it touches your code.

### Loop 2: One Session, two surfaces

Start with the Session title in TUI, switch to the same title in Workspace, submit the short continuation, then return
to TUI as the committed turn appears. End on the matching Session title so the loop joins cleanly.

Suggested nearby copy:

> Start in the terminal. Continue in Workspace. Keep one durable Session.

If one loop is substantially stronger, ship only that one. Two average loops are worse than one clear proof.

## Recording setup

- Capture the application area at 2560x1440 or 1920x1080 and 60 fps. Deliver the full video at 1080p.
- Make terminal and browser text readable at normal website width. Increase font/zoom before recording instead of
  digitally zooming in post.
- Use one theme, one window size, and the same Session title across the TUI/Workspace continuity sequence.
- Hide browser bookmarks, extensions, notifications, menu-bar clutter, shell usernames, tokens, and irrelevant tabs.
- Use a large, calm pointer and deliberate clicks. Do not circle the cursor while waiting.
- Record system audio only if it contributes something. Record narration afterward for clean pacing.
- Leave two seconds of stillness before and after every important action. This makes cuts and loops much easier.
- Capture each important interaction twice: one natural take and one slower safety take.

## Edit and export

1. Build the full cut first. Add chapter markers for Router, Plan Review, Execution, Workspace, Validation, and Roles.
2. Record the narration against that cut.
3. Add captions and only a few short callouts where the UI label is too small to carry the point.
4. Extract website loops from the clean source recording, not from the compressed uploaded video.
5. Crop loops around the relevant surface, remove dead frames, and make the final frame connect naturally to the first.
6. Export full video, WebM/MP4 loops, GIF fallbacks, and poster images from the same timeline.

Keep loop files small by shortening the clip and cropping before reducing quality. Never shrink terminal text until it
is unreadable merely to hit a file-size target.

## Publishing

- Upload the full narrated demo to the primary video channel for sharing and discovery.
- Put a poster image and click-to-play full-video embed on the website so the initial page load does not pay for the
  player immediately.
- Self-host the short WebM/MP4 loops with `autoplay muted loop playsinline`, a poster image, and reduced-motion behavior
  that shows the poster instead of autoplaying.
- Place the strongest loop near the primary value proposition. Put the second beside the TUI/Workspace continuity
  section rather than stacking both near the hero.
- Link the full transcript below the video. Reuse it for launch posts and accessibility.

## Pre-recording gate

Record the publishable take after all of the following are true:

- The shared Session sidebar and artifact links are visually stable in TUI and Workspace.
- The real same-Session TUI/Workspace continuation path has been rehearsed end to end.
- The demo repository starts from a clean resettable baseline.
- The selected Plan path reaches validation reliably without manual repair of the demo environment.
- Every visible label uses current product language: Router, Guide, Ideator, Operator, Planner, Plan Review, Workspace,
  Session, Mechanical Validation, semantic review, and Work Record.
- A scratch recording has been reviewed once at normal laptop size and once at website-column size for readability.

## Recording-day checklist

- Reset the demo repository to its tagged baseline.
- Restart TUI and Workspace from clean application state.
- Disable notifications and close private tabs/windows.
- Confirm the microphone track is not clipping, even if it is only a sync/reference track.
- Record the main workflow first, then the three role montage clips, then clean B-roll and poster frames.
- Write down the source-video timecodes for approval, execution start, cross-surface sync, validation, and Work Record.
- Preserve the untouched source recording until every web asset and caption file is published.
