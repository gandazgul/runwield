# Mascot animation preview

Preview only, as requested. No TUI or Workspace runtime code is changed.

Open `preview.html` directly in a browser. It is self-contained, including both supplied TUI screenshots. Five roles
have six frames over a 1.8-second loop. Base has eight equal 300 ms frames (2.4 seconds). Architect has 13 frames over a
1.93-second construction loop. Operator has six frames over a 1.48-second lever loop. All roles include idle and
answering poses. Choose a role, pause, step frames, change speed, or use reduced motion. The preview stops advancing
when the document is hidden or its animation views are offscreen.

The concept has been hand-authored into a strict one-bit 20 × 18 grid. The current silhouette removes the side arms and
uses a deeper central split with tapering outer edges to recover the W shape. Small typing marks remain at the keyboard;
props sit beside or in front of the body. These tiny sprites are a first animation study derived from
`../concept-v3.png`; they need the owner's visual approval before integration. `sprites.ts` owns the frames for both
surfaces. Background pixels are transparent; the drawing needs only one foreground color against the surface. White on
black is shown in the preview.

Base holds the cursor on for two frames, then off for two frames (600 ms each). Eye blinks remain on frames 3 and 7. The
eight-frame sequence is normal/on, normal/on, blink/off, normal/off, normal/on, normal/on, blink/off, normal/off. The
cursor never moves. Static poses show normal eyes and a solid cursor.

Init uses Base. Guide shares Router's frames through `AGENT_MASCOT_ALIASES`, included in the JSON export. The terminal
demo accepts `guide`; the browser selector names the shared option Router / Guide.

All Engineer variants share Engineer's keyboard through the same alias map: Plan Engineer, Frontend Engineer, and
Reviewer Feedback Engineer. Recorder and Tester are intentionally omitted from the visible mascot set per the owner.
Operator currently tries a lever rocking on a fixed pedestal, with a chunky handle and pauses at both ends. The gear
drawing remains commented in `sprites.ts`; restore it and six 220 ms durations to return to the gear. The earlier
Unicode circle experiment was too tiny and was removed. Slicer shares Planner's clipboard. Delegated agents inherit
their parent's mascot, including aliases; nested delegation retains the inherited ancestor identity. Init uses Base.
Manual QA uses the Operator runtime identity.

## Files

- `sprites.ts`: shared source pixels, role loops, idle/answering states, SVG path and terminal conversion.
- `preview.html`: ready-to-open interactive comparison and placement studies.
- `preview.template.html`: editable preview source.
- `exports/*.svg`: eight looping browser assets, with static reduced-motion alternatives.
- `exports/frames.json`: all exact pixels, SVG paths, terminal lines, and frame durations.
- `terminal.ts`: standalone real-terminal animation, with cursor cleanup on Ctrl+C.

From the repository root:

```sh
deno run brand/mascot/loops/terminal.ts reviewer
deno run brand/mascot/loops/terminal.ts delegated --parent=planner
deno run brand/mascot/loops/terminal.ts engineer --cycles=2
deno run brand/mascot/loops/terminal.ts ideator --snapshot
deno run --allow-read --allow-write brand/mascot/loops/build.ts
```

The terminal preview takes no filesystem, network, or account permissions. Redirected output is automatically static.
Use a terminal at least 20 columns wide with room for ten rows including the label. Typical terminal font metrics can
change the apparent proportions; the pixel content is identical to the browser version.

Architect now uses three building blocks beside the body. The blocks drop into place one at a time: first the left
foundation, then the right, then the top. The completed stack holds briefly, disappears, and repeats. This replaces the
book, which did not read clearly at small size, and keeps the W silhouette visible.

## Placement recommendation

On the supplied wide TUI, anchor the mascot at bottom right above the input border, aligned with the agent identity in
the footer. With the sidebar visible, reserve its lower area for the mascot. Keep that area fixed while the conversation
scrolls. Without a sidebar, reserve a right-hand area instead of drawing over transcript content or the clipboard hint.
Do not increase the height of the input editor to fit a mascot.

The full terminal frame uses 20 columns × 9 rows. For short/narrow terminals or long sidebar content, a two-row face
with the written agent name is the proposed fallback; only its static layout is demonstrated here. Exact thresholds
should be chosen during real TUI integration.

For Workspace, the preview uses 60 × 54 CSS pixels (3× integer scale) beside the active agent name. Animate while
working; hold still while idle or awaiting user input. Ideator's steady full bulb starts only when an answer is
observed. Its fill loop is not a prediction of progress. Unknown/custom agents can use Base when integrated.

Standalone SVG exports contain only the thinking loop and reduced-motion fallback. A future runtime component must
select the idle/answering frames from the shared data and stop playback when hidden. Do not treat an always-looping
image as runtime state.

## Verification

Typechecked the three TypeScript sources, ran the terminal animation in a PTY through completion, and inspected the
browser at desktop and narrow widths. The terminal text uses Unicode half blocks, never emoji or an image protocol.
Inspected TUI placement over the supplied screenshots and exercised idle, answering, and keyboard playback controls. No
production test suite was needed for this isolated preview.

References: [Unicode block elements](https://unicode.org/charts/nameslist/n_2580.html),
[SVG crispEdges](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Attribute/shape-rendering).
