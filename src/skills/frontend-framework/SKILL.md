---
name: front-end-framework-use
description: Convention-first frontend engineering for browser UI work. Use when implementing, fixing, debugging, or reviewing frontend JavaScript/HTML/CSS across frameworks; when UX behavior, visual design, design-system fit, framework conventions, or real-browser evidence matter. Don't use for TUI work.
license: Apache-2.0; complete terms in LICENSE.txt
---

# Front-End Framework Use

**Convention-first** browser frontend work starts from the project's source, framework conventions, and design basis.
Preserve and extend what exists before inventing. Use this skill as a compact reference index, not as an execution loop;
hard sequencing remains with the active agent definition.

This complete `src/skills/frontend-framework/` Skill package is licensed under Apache 2.0; see `LICENSE.txt`. It is
inspired by Anthropic's `frontend-design` Skill at
`https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md`. This nested license covers only this
Skill package and does not change the root RunWield license or any other repository path.

## Design-basis invariant

Discover the design system before visual invention:

- Treat formal systems, component libraries, token files, CSS variables, utility scales, style guides, and neighboring
  UI as an existing design basis.
- Name the tokens, primitives, typography, layout, motion, states, and adjacent patterns you are reusing.
- Extend incomplete systems minimally with project-native reusable tokens, primitives, utilities, or component variants.
- Use the creative visual branch only when no coherent system exists, or when the User Request explicitly authorizes a
  redesign. For redesigns, inspect the existing system and treat it as a compatibility and migration input.
- In RunWield browser UI, start from `docs/design-system.md` and `src/ui/design-system/` before changing Workspace or
  other browser surfaces.

## Read this when...

- Read [ENGINEERING.md](ENGINEERING.md) when changing components, routing, state, runtime boundaries, styling systems,
  i18n, performance-sensitive frontend code, tests, or browser-side safety.
- Read [UX-DESIGN.md](UX-DESIGN.md) when the change affects a user's goal, information hierarchy, interface copy, forms,
  accessibility, responsive/content behavior, or loading/empty/error/success flows.
- Read [VISUAL-DESIGN.md](VISUAL-DESIGN.md) only for greenfield UI or explicitly authorized visual redesign.
- Invoke `agent-browser-use` when the work needs real-browser interaction, screenshots, accessibility snapshots,
  console/network diagnostics, or visual comparison. Browser commands and session lifecycle live there.

Completion for this skill's reference use: every rule relevant to the active branch is applied or consciously ruled out,
and every visual decision traces back to either the discovered design basis or the authorized visual direction.
