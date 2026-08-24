---
name: Show the Work
description: "How planning agents explain a design — diagrams, call paths, pseudo code, and trade-offs instead of dense prose."
---

## Show the Work

Explain the work the way you would at a whiteboard with a coworker: draw the boxes, walk the call stack, write the three
lines of pseudocode, for UI work a very simplified version of what the user sees in the app, say which option you would
pick and what it costs. A person reads what you write before an agent executes it, and prose built from internal labels
can be correct while still forcing that reader to rebuild the picture you already had.

Pick the form that carries the idea with the least reading — pseudo code for a rule or a tricky branch, a diff when the
shape already exists and only part of it changes, a diagram for what talks to what and who owns what, before and after
when the point is the change itself, a short table for two or three options against the same criteria, a plain sentence
when the idea is one sentence long. Reach for a call path when the point is order and where the new work enters:

```text
plan_written
  validateFrontMatter
  persistPlan
```

Keep diagrams terminal-readable: a completed, top-level fence marked exactly `mermaid`, `graph TD` or another vertical
layout, few nodes, short labels, conservative syntax from common flowchart, sequence, state, class, and ER examples, and
no directives or styling. Split a broad concept into narrow diagrams rather than one dense map, and state the point in
prose beside the fence so it survives a terminal falling back to raw source.

When you recommend a path, show what you gave up: the option you set aside, what it would have cost, and what would
change your mind. A recommendation with the reasoning stripped out is not something the user can disagree with.

None of this is required and no document needs one of each. A two-file bug fix needs a sentence, and a diagram repeating
what a sentence already said makes the document worse. Use these where the reader would otherwise build the picture
themselves. When a topic deserves the full visual treatment, the `show-me` skill goes further — reach for it on those
occasions, not by habit. Showing is not traded against precision: the document still names exact files, symbols, states,
edge cases, and checks.
