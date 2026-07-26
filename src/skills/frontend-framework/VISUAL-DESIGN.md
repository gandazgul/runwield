# Visual Design Reference

Use this reference only for greenfield browser UI or explicitly authorized visual redesign. It adapts design-process and
critique language from Anthropic's Apache-2.0 `frontend-design` Skill:
`https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md`.

Convention-first still applies. A project can be visually greenfield while still having framework, accessibility, data,
state, testing, or CSS conventions. An explicit redesign may change the visual language, but the existing system remains
an input and migration constraint.

## Ground the direction

Before code, define the design basis in concrete terms:

- **Subject:** what product, domain, or object the UI is really about.
- **Audience:** who uses it, what they know, and what level of trust, speed, delight, calm, density, or precision they
  need.
- **Real content:** representative labels, entities, numbers, errors, media, and edge cases that should shape the page.
- **Single job:** the primary task the composition must make easier.
- **Constraints:** existing brand, design system, accessibility baseline, platform conventions, responsive needs,
  performance budget, and user-supplied aesthetic direction.

A user-supplied design brief wins over generic creative instincts, including when it intentionally asks for a familiar
style.

## Make the composition a thesis

The first screen should state an opinion about what matters most. Decide what the eye should understand first, second,
and third; then use layout, grouping, whitespace, scale, density, and progressive disclosure to make that order visible.
Avoid evenly weighted panels, generic dashboards, and default centered cards unless the brief or product pattern makes
that the right thesis.

## Seed a reusable system

Leave behind project-native foundations that later work can follow. This can be a small token file, CSS variables,
utility layer, component variants, documented primitives, or local theme object; it does not need to be a large design
system package.

Define only what the chosen direction needs:

- Semantic color roles, including surfaces, text, borders, focus, critical states, and color-mode behavior when
  relevant.
- Type roles and scale for page titles, section headings, body, labels, metadata, numbers, and code-like content.
- Spacing, layout, radius, elevation, density, and breakpoint/container rules.
- Components and states for the UI being built: default, hover, focus, active, disabled, selected, loading, empty,
  error, and success.
- Motion roles for transitions or attention, plus reduced-motion behavior.

Extend an existing formal or informal system minimally. Introduce new values only when reused values cannot express the
chosen direction.

## Choose one signature element

Concentrate boldness in one defensible signature element tied to the subject and job: a distinctive layout move,
interaction, data visualization, illustration style, type treatment, spatial rhythm, or color accent. Let surrounding UI
support it. Remove decorative flourishes that do not clarify the task, express the subject, or improve hierarchy.

## Compare concepts before code

Sketch two or three short layout concepts in words or rough structure before implementation. Compare them against the
single job, real content, audience, existing system, implementation complexity, and accessibility/responsive risk. Pick
one direction and match implementation complexity to that direction rather than building every idea.

## Critique generic defaults before code

Before implementation, name the default-template traps the design could fall into: ungrounded gradients, stock SaaS
cards, arbitrary shadows, decorative icons, uniform spacing, low-contrast gray text, unexplained glass effects, fake
data symmetry, or a layout that could fit any product. Replace them with choices grounded in the subject, audience,
content, and system.

## Build from the chosen system

Implement tokens/primitives first when they are needed by more than one element. Then compose the screen from those
foundations and the project's existing conventions. Keep visual states, focus visibility, reduced motion, responsive
behavior, content resilience, and product usability as baseline requirements, not optional polish.

## Critique screenshots after code

Use real-browser screenshots when visual implementation matters. Critique the result against the intended thesis:

- Does the eye land on the primary job first?
- Does the signature element feel necessary rather than decorative?
- Do type, spacing, color, motion, and density serve the content and audience?
- Does it still fit or deliberately migrate from the existing system?
- Does realistic content break the composition?
- Are accessibility, focus, reduced motion, and responsive states visible and usable?

Remove unsupported decoration and tighten the system before finishing.

## Visual completion criterion

The branch is complete when the UI has a grounded subject/audience/job, a chosen concept, one defensible signature
element, a compact reusable project-native design foundation, a critique against generic defaults before code, and a
screenshot-based critique after code for materially visual work.
