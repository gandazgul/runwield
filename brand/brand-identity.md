# RunWield Brand Identity

This file defines the practical RunWield brand direction for product UI, marketing images, and brand-system mockups. It
extends [`docs/design-system.md`](../docs/design-system.md); it does not replace it. For browser UI, the current Plan
Review and Code Review surfaces remain the source of truth.

Use [`brandboard.png`](brandboard.png) in this folder as inspiration.

## Brand position

RunWield is a coding harness that makes agents slow down at the moments that matter. It sorts work by risk, creates a
Plan for human review when the blast radius is real, executes through specialized roles, and does not call the work done
until CI and review agree with the approved Plan.

The identity should feel like a serious local tool for engineers. It should be dark, compact, precise, and workflow-led.
It should move away from terminal-only imagery and toward Workspace, Plan Review, Code Review, CI proof, and review-gate
surfaces.

## Core idea

**Core metaphor:** the review gate.

RunWield is the controlled point between agent speed and human trust. The brand should show that work can move fast, but
only after it passes the right gates: risk routing, Plan review, implementation, CI, and separate review.

**Emotional promise:** fast work with visible judgment, proof, and accountability.

**Tagline direction:** short, declarative, and proof-oriented.

Preferred tagline:

> Risk slows. Proof ships.

## Logo

Use the existing RunWield logo asset. Do not redraw it as a generic `W`.

Source asset:

- [`logo.svg`](logo.svg)
- [`logo.png`](logo.png)

Frozen logo description:

> The RunWield logo is an angular geometric W mark in mint `#85CBBF` with a solid square cursor block at the
> lower-right, set inside a wide `140×110` viewBox with the W occupying the left and center and the cursor square offset
> to the right.

Rules:

- Preserve the logo geometry exactly.
- Preserve the cursor square as a separate block.
- Do not simplify the mark into a normal letter `W`.
- Do not add bevels, chrome, shadows, extra cuts, sparkles, or gradients to the mark.
- Use the same logo geometry in every surface where it appears.
- When an image-generation tool cannot read SVG, export the logo to a transparent PNG at 1024px or larger and use that
  PNG as the locked asset.

## Color

Use the product design-system colors as the brand base. Catppuccin Mocha can inform warmth, but it must not become a
copy of the Catppuccin palette.

| Role           | Color     | Use                                                     |
| -------------- | --------- | ------------------------------------------------------- |
| Deep slate     | `#0B1020` | Page and board background.                              |
| Surface        | `#0F172A` | Panels, sidebars, and cards.                            |
| Raised surface | `#111827` | Prominent cards and product mockups.                    |
| Muted surface  | `#1E293B` | Selected states, chips, and secondary panels.           |
| Text           | `#E2E8F0` | Main text.                                              |
| Dim text       | `#94A3B8` | Metadata and low-emphasis labels.                       |
| Logo mint      | `#85CBBF` | Logo, code accent, and proof emphasis.                  |
| Review blue    | `#60A5FA` | Primary action, navigation, and review emphasis.        |
| Proof green    | `#22C55E` | CI passed, reviewer agreed, validated, and done states. |
| Warning amber  | `#F59E0B` | Risk, caution, and in-progress states.                  |
| Border         | `#334155` | Panel boundaries and quiet separators.                  |

Palette rules:

- Dark slate is the dominant color.
- Mint and blue are signals, not decoration.
- Green appears only for proof or success.
- Amber appears only for risk or caution.
- Avoid random rainbow accents.
- Avoid default purple-blue AI glow unless it is a small secondary atmosphere, not the identity.

## Typography

Use a refined sans system with monospace accents.

- Headings: clear neo-grotesk or geometric sans, medium to semibold weight.
- Body and controls: compact sans, readable at 12-14px in product UI.
- Labels and technical markers: small uppercase monospace with wide tracking and lower opacity.
- Reserve large type for document headings, brand lockups, and marketing boards.

Typography should feel engineered and calm. It should not feel like a sci-fi terminal skin.

## Layout and surfaces

The product identity comes from compact review workspaces, not from hero art.

Use:

- strict grids;
- 6-8px panel radius;
- thin slate borders;
- compact toolbar controls;
- status chips for proof states;
- visible workflow rails;
- plan, diff, CI, and review surfaces;
- dense but readable spacing.

Avoid:

- large soft SaaS cards;
- terminal-only pages;
- decorative dashboards;
- generic device mockups with empty screens;
- random floating icons;
- glossy 3D objects.

## Image direction

Marketing and brand-board imagery should show RunWield as a workspace and review system.

Good image subjects:

- Plan Review surface with risk, approval, and Plan summary areas;
- Code Review surface with diff and reviewer decision;
- CI proof chips such as `CI passed`, `Reviewer agreed`, and `Plan approved`;
- compact workflow rail showing request routing, Plan, execution, CI, and review;
- physical reviewer badge or access card using the exact logo;
- social profile or app icon proof using the exact logo.

Use atmosphere sparingly: dark desks, screen glow, slate panels, and soft mint-blue light are acceptable when the
product surface remains the subject.

## Voice

RunWield copy should be direct and specific. Name the workflow concepts instead of using generic AI language.

Use phrases like:

- Plan approved
- CI passed
- Reviewer agreed
- Risk slows. Proof ships.
- Review gates for coding agents
- Slow down only where it matters

Avoid phrases like:

- Elevate your workflow
- Seamless AI solutions
- Unleash agent power
- Next-gen developer productivity
- Revolutionary coding automation
