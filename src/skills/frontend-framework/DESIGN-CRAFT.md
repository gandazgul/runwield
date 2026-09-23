# Design Craft Reference

Use this reference for visual refinement within an existing design system and for the craft details of a new design.
Project decisions and the user's brief determine the style. The values below are starting points where the project has
no established equivalent, not permission to replace its tokens or conventions.

## Choose the structure for the task

Make one user decision or reading goal dominant through position, scale, grouping, and contrast. Supporting content
should recede without becoming illegible. Avoid giving every panel equal weight merely to fill a grid.

- **Operational and developer tools:** stable navigation and scope, current state, related evidence, then detail. Use
  compact rows, timelines, tables, logs, or code regions when they help diagnosis. Make live, paused, and stale states
  explicit; keep time context and copyable evidence available. Dense content does not justify tiny decision text.
- **Object detail:** identity and status, key facts, body sections, and a clear primary action. Metadata supports the
  subject. At narrow widths, preserve access to the action and collapse secondary sections when useful. Sticky actions
  are an option only when they do not obscure content or the keyboard path.
- **Other products:** derive structure from their audience and job. A technical workbench is not a universal template
  for editorial, commerce, or consumer interfaces.

Use representative product content. Fake metrics, repeated icon chips, and equally sized placeholder cards conceal
hierarchy problems. Vary section composition only when content or task warrants it; consistency is useful for
comparison.

## Spacing, type, and containment

- Use the existing spacing scale. If none exists, a small scale such as 4, 8, 12, 16, 24, 32, 40, 48, and 64px is a
  starting point. Prefer a reused value; explain optical corrections instead of accumulating arbitrary offsets.
- Make between-group spacing visibly larger than within-group spacing; roughly twice as large is a useful diagnostic,
  not a required ratio for every layout.
- Aim for about 50–75 characters per line for sustained prose. Give tables, diagrams, and evidence the width they need
  while bounding reading columns inside them.
- Where no type system exists, start ordinary body copy around 16px. Dense desktop metadata may be 13–14px; retain
  readable decision and explanatory text. Body leading near 1.5 and heading leading near 1.2–1.35 are useful defaults.
- Keep a small, intentional family and weight set, often one UI face and one code face. Use monospace where alignment or
  literal text matters, not to decorate an entire developer interface. Use
  [tabular numerals](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/font-variant-numeric) for
  comparable metrics, timers, and money when supported by the chosen font.
- Try whitespace, then tone, then a hairline, then shadow as the need for separation increases. Combining a visible
  border and floating shadow needs a purpose or an established project pattern. Dark surfaces often separate better
  through tonal levels and borders than through stronger shadows.
- Match control heights within the same toolbar or form context. Keep one coherent icon family, stroke, and fill
  treatment. Icons carry meaning; emoji and decorative badges should not substitute for clear control labels.

## Palette judgment

Identify roles before selecting colors: canvas, surfaces, text, supporting text, borders, primary action, focus, and
status. Pair filled roles with explicit foreground roles. Primary, brand, categorical, syntax, and status colors can
coexist, but they should not compete equally for attention or change meaning between screens.

When creating a palette, consider lightness and chroma as well as hue: they strongly affect perceived intensity. Reserve
recognizable status roles before choosing secondary accents. Keep neutral areas dominant where the task needs quiet
evidence; a 60/30/10 allocation is at most a composition heuristic, not a quota or accessibility rule.

Generated ramps are source material. Map them into semantic tokens; do not have components consume raw ramp indices.
Inspect target-gamut output rather than trusting a generator's original colors. Recheck actual text/fill, status, and
focus combinations after mapping or overrides, including opacity and mixed backgrounds. See
[UX-DESIGN.md](UX-DESIGN.md#contrast-and-target-size) for accessibility thresholds.

Imagery should use the approved identity and support the content. Avoid competing accent fields or decorative gradients
where they weaken the task hierarchy. Keep interface text as real text rather than baking it into generated images. An
established gradient, illustration, or unusual shape can still have a valid product role.

## Review the rendered result

For material visual changes, inspect the real route with its actual components, content, and fonts. Cover a narrow and a
wide viewport when both are supported, plus relevant states from [UX-DESIGN.md](UX-DESIGN.md). Look for grouping,
primary-action visibility, readable metadata, clipping, layout shifts, font loading, image crop, and interference from
sticky regions or motion. Source review cannot establish those qualities.

Run appropriate project checks as well. Record reproducible commands, inspected routes and viewport sizes, screenshot
paths when captured, and cases that could not be exercised. A score or clean build is evidence about a particular check,
not proof of usability, visual quality, or user acceptance. Report limitations without inventing verification.

Keep functional requirements, accessibility thresholds, approved project choices, and adjustable heuristics distinct.
When a preset cannot express a project choice, identify the mismatch and make a scoped project-native adjustment; do not
silently reinterpret the identity to fit the preset. Improve reusable components, state examples, and token mappings
before adding more aesthetic rules.
