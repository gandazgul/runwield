---
name: prompt-writing
description: Use when writing or tightening prompts for AI systems — system prompts, agent instructions, skills, or any LLM prompt. Triggers on user mentioning prompt writing, prompt improvement, or making instructions tighter.
---

# Prompt Writing

Good prompts are tight. Longer prompts cause attention dilution — the model pays less attention to each part.

## What Improves Prompts

### Remove Redundancy

Same instruction said multiple ways dilutes attention.

**Before:** "You must always verify each item. Do not skip items. Every item needs to be checked. Make sure you don't
miss any items."

**After:** "Verify each item individually. No skipping."

**But keep intentional attention anchors:** Terse end-of-prompt "Important Rules" sections that restate critical
guidance are not redundant — they are an intentional attention anchor that improves reliability across model quality
tiers (SOTA, open-source, and smaller models). Optimize verbose explanatory duplication elsewhere, but do not remove
critical restatements merely because they repeat earlier content.

### Remove Noise

State only requirements the model doesn't already know.

**Before:** 40-line example of what a code walkthrough looks like

**After:** "Write a detailed walkthrough: what changed, line numbers, analysis of the flow, data transformations,
dependencies."

**Don't describe unavailable capabilities.** Describe only what the agent can actually do in its current workflow. Do
not mention unavailable tools as negative alternatives, obsolete/legacy mechanisms, internal bypasses, or backward-
looking compatibility behavior — unless the agent must act on that history. Every sentence about something the agent
doesn't have or can't do is noise that dilutes the instructions that matter.

### Sharpen Instructions

Tight instructions say "Do X", not "You should consider doing X because..."

**Before:** "It's important that you remember to always navigate to the project root directory before starting any work,
as this ensures that all file paths will be correct..."

**After:** `cd "$CLAUDE_PROJECT_DIR"`

### Keep Load-Bearing Content

These must stay:

- Workflow steps and their order
- Quality criteria
- Critical rules and constraints
- Output format requirements (if parsed programmatically)
- Behavioral guardrails
- Terse end-of-prompt "Important Rules" sections (attention anchors — keep even when they restate earlier guidance)

### Write Clean Prose

Write as if it was always this way — not "correction" style.

**Before:** "Remember that you should do TWO interviews, not just one. The first interview is for business requirements,
and then after discovery you should do a second interview..."

**After:**

```
### 0. Business Requirements Interview
Interview the user to understand what needs to be built.

### 2. Technical Interview
With discovery complete, interview the user about implementation details.
```

## Structure

Good prompts have clear sections. Adapt this pattern to your use case:

```
[1-2 sentence role/purpose]

## Core Concept or Approach
[Key principle guiding behavior]

## Workflow / Steps
[What to do, in order]

## Rules / Constraints
[Non-negotiable requirements]

## Quality Criteria
[What good looks like, what to avoid]

## Output Format
[Expected structure if applicable]
```

For procedural agents, number the steps clearly — each with what to produce and when to proceed. For guidance prompts,
use descriptive sections.

Quality criteria work best as two lists: DO (what matters) and DON'T (what to ignore). For parsed output, include the
exact schema; for human-readable output, describe what to include.

## Checklist

- [ ] Every instruction serves a purpose (no redundancy)
- [ ] No verbose examples of things the model knows
- [ ] Instructions are tight — direct, not hedged
- [ ] Load-bearing content preserved
- [ ] Written in tight prose, not "correction" style
- [ ] Intentional attention anchors (end-of-prompt restatements) kept, not removed as redundant
