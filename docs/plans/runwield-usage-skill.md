---
classification: "PLANNED_CHANGE"
workKind: "DOCUMENTATION"
complexity: "MEDIUM"
summary: "Add a bundled model-invoked `runwield` skill that lets any agent answer user questions about how to use RunWield, plus the two docs cross-links that make it discoverable."
affectedPaths:
    - "src/skills/runwield/SKILL.md"
    - "src/skills/runwield/COMMANDS.md"
    - "src/skills/runwield/PLANS.md"
    - "src/skills/runwield/CUSTOMIZATION.md"
    - "src/skills/runwield/SETTINGS.md"
    - "docs/index.md"
    - "docs/customization.md"
objectiveChecks:
    - id: "OC1"
      command: "sh -c 'f=src/skills/runwield/SKILL.md; grep -q \"^name: runwield$\" \"$f\" && grep -q \"^description: \" \"$f\" && ! grep -q \"disable-model-invocation\" \"$f\"'"
      rationale: "Red today because src/skills/runwield/SKILL.md does not exist. Goes green only when the skill is created with the correct name and a model-invoked description, which is the delivery vehicle the whole Plan depends on."
    - id: "OC2"
      command: "sh -c 'for t in activeModelPreset modelPresets visionFallback codereview Plannotator \"wld load-plan\" \"plans doctor\" \"plans share\" write-a-skill \"src/prompt-templates\" ready_for_decomposition QUICK_FIX user_verified \"wld acp\" \"wld wr\" promptOverride models.json \"wld init\" AGENTS.md .wld/sessions; do grep -rqF -- \"$t\" src/skills/runwield/ 2>/dev/null || exit 1; done'"
      rationale: "Red today. Each term anchors one topic the user asked the skill to cover: model presets, vision fallback, the code-review gate, Plannotator, plan loading and recovery, plan sharing, skill authoring, prompt-template precedence, Epic decomposition, quick-fix validation, User Verified, ACP, Work Records, the prompt-append override rule, provider configuration, project instructions, and session storage. An empty or partial skill fails."
    - id: "OC3"
      command: "sh -c 'l=$(grep -rho \"https://github.com/gandazgul/runwield/blob/main/docs/[A-Za-z0-9/._-]*\" src/skills/runwield/ 2>/dev/null | sed \"s|.*/blob/main/||\" | sort -u); [ \"$(printf \"%s\" \"$l\" | grep -c .)\" -ge 6 ] || exit 1; for p in $l; do [ -f \"$p\" ] || exit 1; done'"
      rationale: "Red today. Requires at least six distinct GitHub docs links and that every one resolves to a real file under docs/. This is the decided depth mechanism, and the check catches fabricated or misspelled doc paths that a reader outside this repository could not detect."
    - id: "OC4"
      command: "sh -c 'grep -q \"src/skills/runwield\" docs/index.md && grep -q \"runwield\" docs/customization.md'"
      rationale: "Both sub-parts are red today (0 matches each). Goes green only when the two docs cross-links exist: the docs/index.md pointer that makes the skill discoverable to anyone editing docs, and the bundled-skill list entry in docs/customization.md that would otherwise be wrong the moment the skill ships."
    - id: "OC5"
      command: "sh -c 'd=src/skills/runwield; [ -d \"$d\" ] || exit 1; [ \"$(ls \"$d\"/*.md 2>/dev/null | wc -l)\" -ge 5 ] || exit 1; for f in \"$d\"/*.md; do [ \"$(wc -l < \"$f\")\" -le 200 ] || exit 1; done; [ \"$(cat \"$d\"/*.md | wc -l)\" -le 750 ]'"
      rationale: "Red today because the directory does not exist. Enforces the decided depth constraint from both sides: at least five Markdown files, so topics are split across the index and its four reference siblings rather than crammed into one page; and no file over 200 lines with 750 total, so the skill cannot become a mirror of docs/. The ceilings fit the planned content with headroom, so they only bind when a writer starts restating documentation instead of linking to it."
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-08-07T23:34:33-04:00"
updatedAt: "2026-08-08T03:57:38.698Z"
status: "ready_for_work"
origin: "internal"
userVerifiedAt: null
humanReviewMode: null
humanReviewDecision: null
worktreeStatus: "abandoned"
routingIntent: "PLANNED_CHANGE"
sessionName: "RunWield usage skill"
planId: "49566e81-b105-4637-a0c7-1a465c6752b6"
---

# RunWield Usage Skill

## Context

A user who runs RunWield in any repository has no way to ask the agent how RunWield itself works. The agent has its own
role instructions, but it holds no user-facing knowledge of routing intents, the Plan review cycle, Plannotator, the
`wld` commands, the customization precedence order, or model presets. Today the only correct answers live in `docs/`,
which ships nowhere: `scripts/release-check.js:25-30` bundles `src/agent-definitions/`, `src/prompt-templates/`,
`src/shared/session/SYSTEM_PROMPT_TEMPLATE.md`, `src/skills/`, and one theme file. `docs/` is not in that list.

So a skill under `src/skills/` is the only delivery vehicle that reaches a user outside this repository. It is compiled
into the binary and extracted at runtime to `~/.wld/bundled-skills/<skill>/`, which makes it available in every project.
Sibling Markdown files inside the skill folder ship the same way, so progressive disclosure works normally.

The unavoidable cost is a second copy of meaning that already lives in `docs/`. This Plan accepts that copy. The
maintenance anchors are a pointer from `docs/index.md` so anyone editing docs finds the skill, and a durable project
Memory that the user stores personally. This Plan does not add a repository rule and does not store the Memory.

### Decision: write the skill, do not bundle `docs/`

The alternative considered was to bundle `docs/` into the binary and let the skill point at it, or to bundle only
`docs/index.md` and have the agent follow GitHub links for the rest. This Plan writes a self-contained skill instead,
for three reasons measured against the current repository:

- **Binary size is not the constraint.** `bin/wld` is 316 MB. The user-facing subset of `docs/` — index, quickstart,
  usage, workflows, plan-lifecycle, settings, customization, collaboration, sessions, themes, providers,
  troubleshooting, router-model-selection, user-facing-features — is about 200 KB, which is 0.06 percent of the binary.
  The whole `docs/` tree without `docs/plans/` is 1.2 MB across 217 files, but most of that is `work-records/`, `adr/`,
  `prd/`, `research/`, and `vision/`, which no user question needs.
- **Context is the real cost, and it is paid per question.** `docs/plan-lifecycle.md` is 56 KB and `docs/settings.md` is
  42 KB. They are contributor specifications, not user answers. An agent asked "what does verified mean" would read
  roughly 14,000 tokens of state-machine specification to produce two sentences.
- **Index-only plus GitHub links fails without network or `ketch`.** No Agent has a native fetch tool; web access runs
  through the optional `ketch` CLI, which `install.sh` does not install. On a machine without `ketch`, or offline, the
  agent would hold a map of document names with no content behind it, and would answer from guesswork. That is worse
  than no skill, because the map looks authoritative.

Bundling stays available later. It is purely additive — add `docs/` to `STATIC_INCLUDE_PATHS` in `scripts/compile.js`,
add an extraction target beside `extractBundledSkills` in `src/shared/session/agent-assets.js`, and change the skill's
GitHub links to local paths. Nothing in this Plan blocks that, so choosing the skill now is not a one-way door.

## Objective

Ship a bundled, model-invoked `runwield` skill that lets any agent, in any project, answer "how do I use RunWield"
questions accurately and at the right depth, and wire it into the documentation workflow so it stays current.

The skill answers, at minimum:

- what RunWield is, the routing intents, and which Agent owns each;
- the Plan lifecycle, `wld load-plan`, and the Plannotator review cycle;
- worktree execution, Workflow Validation, semantic review, repair, and recovery;
- PROJECT Epics, Slicer decomposition, and automatic child continuation;
- Work Records;
- every `wld` command and every TUI slash command, each with a brief explanation rather than full reference detail;
- session management and where session data lives;
- the layering precedence for settings, agents, prompt templates, and skills;
- project instructions — `wld init`, `RUNWIELD.md`/`AGENTS.md`, and `docs/domain-language.md`;
- how to write a prompt template, and where to go to write a skill;
- settings, with model presets and `visionFallback` given first-class treatment;
- providers and authentication;
- self-hosted collaborative planning through `wld plans share|pull|push|unshare`.

Every topic is answered at **surface depth**: what the thing is, when a user reaches for it, and a link to the
authoritative document. The skill is an orientation map, not a second copy of `docs/`.

## Approach

Build the skill as one legible index plus four reference files reached by branch, following
`src/skills/write-a-skill/SKILL.md`. Every user question takes one of four paths — plans and review, commands,
customization, settings — so `SKILL.md` carries what all paths need and each path's depth sits behind a context pointer.

The skill is **model-invoked**: the user wants agents to reach it on their own, so it keeps a `description` and pays
context load in every session in every project. The description must therefore anchor on RunWield and `wld` by name, so
it does not fire on generic "how do I use this" questions in unrelated repositories.

Depth beyond the skill goes to GitHub absolute links, since repo-relative links resolve to nothing when the skill runs
in another project:

```text
https://github.com/gandazgul/runwield/blob/main/docs/<file>.md
```

A website may replace that base later; the link base appears in the skill body only, not in code.

Scope decided with the user: include `wld plans share|pull|push|unshare`. Exclude `wld workspace serve|pair`, which is
too alpha to document. Mention `wld acp` in one line as supported, with a pointer. Cover Memory only as user-facing
surface (`/sleep`, the `/reload` refresh) and not as agent mechanics, which the agents already hold in their own
instructions.

Coverage is **complete in breadth and brief in depth**, and this applies to the whole skill, not only to commands. Every
`wld` command, slash command, Plan status, and settings key that a user meets is named so they learn the surface exists,
but each gets roughly one line: what it does and when to reach for it. Flags, option tables, state-machine detail, and
subcommand matrices stay in `docs/` behind a GitHub link.

Model presets are the one deliberate exception. The user named them specifically, a wrong preset silently changes which
model runs, and the shape is not guessable, so `SETTINGS.md` carries the concrete key shape and one working JSON
example. Nothing else in the skill gets that treatment.

The depth rule is enforced mechanically, because "condense" is advice that erodes under a writing pass. No file in the
skill may exceed 200 lines and the directory total may not exceed 750. Those ceilings fit the content sketched in the
Implementation Steps with headroom, and they make mirroring `docs/` impossible: `docs/plan-lifecycle.md` alone is 56 KB.
If a file approaches its ceiling, cut prose and add a GitHub link — do not raise the ceiling.

This Plan touches no repository rule file. The maintenance obligation lives in a project Memory that the user stores
personally, so no Implementation Step writes one.

## Files to Modify

- `src/skills/runwield/SKILL.md` — new. Frontmatter (`name: runwield`, model-invoked `description`), what RunWield is,
  the answering discipline, routing intents, the Agent roster, and context pointers to the four reference files.
- `src/skills/runwield/COMMANDS.md` — new. Every `wld` command and every TUI slash command with a one-line explanation
  each, plus TUI input mechanics.
- `src/skills/runwield/PLANS.md` — new. Plan files, lifecycle statuses, the Plannotator review cycle, execution and
  worktrees, Workflow Validation and repair, `codereview`, Epics and Slicer, Work Records, recovery, Plan sharing.
- `src/skills/runwield/CUSTOMIZATION.md` — new. The layering model and per-resource precedence, agent overrides, prompt
  templates including how to write one, skills including the pointer to `write-a-skill`, themes, `/reload`.
- `src/skills/runwield/SETTINGS.md` — new. Settings file locations and merge behavior, per-agent overrides,
  `activeModelPreset`, `modelPresets`, `visionFallback`, and the other user-facing keys.
- `docs/index.md` — add a pointer to the skill under "RunWield basics" so a human or model reading the docs finds it.
- `docs/customization.md` — add `runwield` to the bundled-skill list at lines 69-76, which otherwise becomes wrong the
  moment this skill ships.

No domain-language change: this Plan documents existing behavior and introduces no new or redefined domain term, so
`docs/domain-language.md` is untouched.

No registry edit is needed. `scripts/release-check.js:10` bundles `src/skills/` as a directory, so a new skill folder is
picked up without a code change.

## Reuse Opportunities

- `src/skills/write-a-skill/SKILL.md` — the authority on invocation choice, information hierarchy, progressive
  disclosure, and pruning. Apply it to this skill, and point the reader at it for authoring their own.
- `src/skills/write-a-skill/GLOSSARY.md` — the disclosed-sibling pattern this skill's four reference files copy.
- `src/skills/documentation/SKILL.md` — the house voice for docs work: verify against source, avoid inventing paths and
  defaults, prefer focused structure.
- `docs/workflows.md`, `docs/plan-lifecycle.md`, `docs/usage.md`, `docs/customization.md`, `docs/settings.md`,
  `docs/collaboration.md`, `docs/sessions.md`, `docs/providers.md`, `docs/index.md` — the authoritative source content
  to condense. Read them, do not restate them at length.

## Implementation Steps

- [ ] `src/skills/runwield/SKILL.md` exists with YAML frontmatter whose `name` is `runwield` and whose `description`
      names RunWield and `wld` explicitly, lists the distinct trigger branches (how RunWield works, how to do something
      in RunWield, why RunWield behaved a certain way), and omits `disable-model-invocation`.
- [ ] `SKILL.md` states an **answering discipline** that changes agent behavior: answer from this skill because it ships
      with the running binary and matches its version; when the question is about the user's own configuration, read
      their actual `~/.wld/settings.json`, `.wld/`, and Plan files instead of describing defaults; link depth to
      `https://github.com/gandazgul/runwield/blob/main/docs/<file>.md`; and describe state-changing `wld` commands to
      the user rather than running them, naming `wld plans unshare` and `wld plans archive` as commands to never run to
      demonstrate.
- [ ] `SKILL.md` contains the routing-intent table with all six intents — `INQUIRY`, `IDEATION`, `OPERATION`,
      `QUICK_FIX`, `FEATURE`, `PROJECT` — each mapped to its owning Agent, and names the user-selectable Agents
      (`router`, `guide`, `ideator`, `operator`, `planner`, `architect`, `engineer`, `tester`) separately from the
      workflow-only pseudo-Agents Slicer and Reviewer.
- [ ] `SKILL.md` carries a context pointer to each of `COMMANDS.md`, `PLANS.md`, `CUSTOMIZATION.md`, and `SETTINGS.md`
      that states the branch it serves, and mentions `wld acp` in one line as supported for external ACP clients.
- [ ] `src/skills/runwield/COMMANDS.md` names every command in `wld help` — `router`, `acp`, `agent`, `model`,
      `load-plan`, `plans`, `workspace`, `wr`, `sleep`, `help`, `version`, `update`, `init`, `theme`, `install`,
      `remove`, `snip-filters` — the global flags `--continue`, `--help`, `--version`, `--mode acp`, and every slash
      command in the `docs/usage.md` table including `/context`, `/sleep`, `/session`, and `/name`. Each entry is one
      line: what it does and when a user reaches for it. No flag tables, no option reference; depth goes to a GitHub
      link to `docs/usage.md`.
- [ ] `COMMANDS.md` names the `wld plans` subcommands that this Plan includes — bare `plans`, `read`, `doctor` (with
      `--repair`), `share`, `pull`, `push`, `unshare`, `archive` and `archive restore`, `ui` — and the `wld wr`
      subcommands `list`, `search`, `read`, `backfill`, and `index rebuild`, at the same one-line depth. It does not
      document `wld workspace serve` or `wld workspace pair` beyond naming the command as available and not yet
      documented.
- [ ] `COMMANDS.md` documents the TUI input mechanics a user must be told: `@` file references, `!` and `!!` shell
      execution, Escape to cancel a running turn, the message queue, and image paste.
- [ ] `COMMANDS.md` covers session management as its own short section: `/new`, `/resume`, `/session`, `/context`,
      `/compact`, `/export`, `/share`, and the `--continue` flag, and states that sessions are stored under
      `~/.wld/sessions/`, which is separate from Pi's `~/.pi/agent/sessions/`.
- [ ] `src/skills/runwield/PLANS.md` describes Plan files as Markdown with YAML front matter under `docs/plans/`, with
      child FEATURE Plans under `docs/plans/<epic-name>/` pointing back through `parentPlan`, and explains that RunWield
      owns Front Matter while the user owns the body.
- [ ] `PLANS.md` explains the review cycle end to end for a FEATURE: Planner writes the Plan, the user reviews it in
      Plannotator in the browser, Feedback returns the Plan to Planner and approval records execution metadata and marks
      it ready for work, RunWield dispatches the recorded `executionAgent`, then Workflow Validation runs, and the Plan
      becomes verified only after delivery evidence and, for worktree execution, proof of merge-back.
- [ ] `PLANS.md` explains what Plannotator is — the browser review surface RunWield opens for Plan review — the Approve,
      Approve for Later, and Feedback outcomes, and the `executionAgent` and `collaborationRecommendation` controls that
      FEATURE Plan Review exposes.
- [ ] `PLANS.md` explains Workflow Validation as local CI plus semantic review in narrowing rounds with findings carried
      in a Review Issue Ledger, repaired in independent Engineer sessions, and states that `QUICK_FIX` runs Mechanical
      Validation only, with no Reviewer, no Plannotator code review, and no merge-back. It explains the `codereview`
      setting (`none`, `ask`, `always`) as the human code-review gate that runs after local validation and semantic
      review pass and before merge-back.
- [ ] `PLANS.md` lists the Plan statuses a user sees and what each means, covering at minimum `draft`, `feedback`,
      `approved`, `ready_for_decomposition`, `ready_for_work`, `implemented`, `validation_passed`, `verified`,
      `user_verified`, `done_enough`, and `closed_without_verification`, and distinguishes RunWield Verified from User
      Verified.
- [ ] `PLANS.md` explains `wld load-plan` including its Epic-aware behavior, PROJECT Epics and the interactive Slicer,
      automatic child continuation and where it stops, and the recovery surface: `wld plans doctor`, `--repair`, and the
      recovery record an interrupted lifecycle transaction leaves behind.
- [ ] `PLANS.md` explains Work Records as repo-local Markdown generated at Plan completion, retrievable and repairable
      with `wld wr`, and explains `wld plans share|pull|push|unshare` as remote-canonical Shared Spaces, including that
      sharing takes a Shared Plan Lock that blocks local mutation, that share prints reviewer and maintainer URLs once,
      and that unshare is destructive.
- [ ] `src/skills/runwield/CUSTOMIZATION.md` states the layering model — project `.wld/` overrides home `~/.wld/`
      overrides bundled defaults — and gives the concrete resolution list for agents (`.wld/agents/`, `~/.wld/agents/`,
      bundled `src/agent-definitions/`), prompt templates (`.wld/prompts/`, `~/.wld/prompts/`, bundled
      `src/prompt-templates/`, installed Pi package `pi.prompts`), and skills (`.wld/skills/`, `~/.wld/skills/`, bundled
      `src/skills/`, external `~/.agents/skills/`).
- [ ] `CUSTOMIZATION.md` states the two override rules that differ from plain replacement: scalar agent frontmatter
      overrides by precedence while a `tools` key fully replaces the lower layer, and agent prompts append unless
      `promptOverride: true` is set.
- [ ] `CUSTOMIZATION.md` tells a user how to write a prompt template: where the file goes, that its filename becomes the
      slash command, that it is passive Markdown, that it cannot override a built-in slash command name and RunWield
      warns at startup when a package prompt is blocked by that collision, and that `/reload` picks up edits. It names
      the bundled templates `code-optimizer`, `code-review`, `commit`, and `release` as working examples to copy.
- [ ] `CUSTOMIZATION.md` points a user who wants to write a skill at the bundled `write-a-skill` skill by name, and
      lists the other bundled skills with a one-line purpose each.
- [ ] `CUSTOMIZATION.md` covers project instructions: `wld init` explores the repository, writes
      `docs/domain-language.md` and durable project Memory; instructions are read from `RUNWIELD.md` or `AGENTS.md` in
      the project root and from `~/.wld/RUNWIELD.md` or `~/.wld/AGENTS.md` globally.
- [ ] `src/skills/runwield/SETTINGS.md` documents the settings files `~/.wld/settings.json` and `.wld/settings.json`,
      that project overrides global, and that RunWield merges the custom object keys `agents` and `modelPresets` rather
      than replacing them wholesale.
- [ ] `SETTINGS.md` documents model presets in full: the `agents.<name>` shape with `model` in `provider/model_id` form,
      `thinkingLevel` from `off`/`minimal`/`low`/`medium`/`high`/`xhigh`, and `temperature` from `0` to `2`; that
      `activeModelPreset` selects a named entry in `modelPresets` and falls back to base `agents` when unset, missing,
      or unknown; that presets are partial and fall back per agent; and that a manual `/model` override wins until the
      active agent changes. It includes a working JSON example.
- [ ] `SETTINGS.md` documents `visionFallback` with its resolution order — active preset, then top-level, then disabled
      — and states that vision-capable active models keep receiving images directly and do not get the `see_image` tool.
- [ ] `SETTINGS.md` covers providers and authentication at surface depth: `/login` configures subscription or API-key
      credentials, `/status` shows configured providers and available models, and `~/.wld/models.json` is the model
      registry for custom or self-hosted models such as Ollama. Depth links to `docs/providers.md`.
- [ ] No file under `src/skills/runwield/` exceeds 200 lines, and the directory total is at most 750 lines. This is the
      depth constraint made mechanical: the skill describes each topic at surface depth and links to `docs/` for the
      rest.
- [ ] `docs/index.md` links to `src/skills/runwield/SKILL.md` under "RunWield basics" and states that it is the shipped
      user-facing answer surface that must be updated alongside the docs.
- [ ] `docs/customization.md` includes `runwield` in its bundled-skill list with a one-line purpose.
- [ ] Every `https://github.com/gandazgul/runwield/blob/main/docs/...` link in the skill resolves to a file that exists
      under `docs/` in this repository.
- [ ] No Memory is stored and no repository rule file is edited by this Plan. The user owns the maintenance Memory that
      records what `src/skills/runwield/` is and asks for it to be updated when `docs/` changes user-facing behavior.

## Verification Plan

Automated:

- `deno task ci` — the repository gate. It must stay green; this Plan adds Markdown only and changes no code path.
- The Objective-Failing Checks recorded in Front Matter, which assert the skill exists, is model-invoked, covers every
  required topic, links only to real docs, and is cross-linked from `docs/index.md` and `docs/customization.md`.
- `deno task compile && ./bin/wld version` — proves the new skill directory compiles into the binary without breaking
  the embed step.

Manual:

- Run `deno task compile`, then from a directory **outside this repository** start `wld` and ask "how do I load a saved
  plan in RunWield?" and "how do I make Router use a cheaper model?". The agent must load the `runwield` skill and
  answer correctly from it. This is the real acceptance test: it proves the content ships and reaches a user who does
  not have `docs/`.
- In the same outside-repo session, ask "how do I write a prompt template?" and confirm the answer names the
  `.wld/prompts/` location, the filename-to-slash-command rule, and the built-in collision warning.
- Ask "how do I write a skill?" and confirm the answer points at the bundled `write-a-skill` skill rather than
  improvising authoring advice.
- Read `SKILL.md` against `src/skills/write-a-skill/SKILL.md`: the description must carry one trigger per branch with no
  synonym duplication, and `SKILL.md` must stay legible rather than absorbing reference that belongs in a sibling file.
- Spot-check five claims in the skill against source: one `wld` subcommand against `wld help <command>`, one slash
  command against `docs/usage.md`, one settings key against `docs/settings.md`, one Plan status against
  `docs/plan-lifecycle.md`, and one precedence list against `docs/customization.md`.

Expected results:

- Every check exits 0; `deno task ci` passes unchanged.
- The outside-repo questions are answered from the skill, with correct paths, command names, and settings keys.

Existing tests: this Plan reshapes no code, so no existing behavior loses coverage. `scripts/release-check.test.js`
already asserts bundled-Markdown extraction over the `src/skills/` directory rather than a fixed skill list, so it must
keep passing without modification. If it starts failing, the cause is a malformed skill file, not an expected change.

## Edge Cases & Considerations

- **Duplication with `docs/` is the central risk, and it is accepted rather than solved.** The user declined a
  command-name drift check because the command surface is not expected to grow. The two anchors — the `docs/index.md`
  pointer and the user's Memory — are social, not mechanical, and will not catch a silent divergence. Keep the skill
  condensed and link to GitHub for depth so there is less surface to drift. If drift does bite, bundling the user-facing
  `docs/` subset is the recorded escape hatch.
- **The line ceilings will bind, and that is their purpose.** The topic list is broad, so the natural writing instinct
  is one more paragraph per topic. When a file nears 200 lines, the correct move is to cut a paragraph down to its
  one-line surface description and let the GitHub link carry the rest. Raising a ceiling turns the skill back into the
  mirror of `docs/` that this Plan exists to avoid.
- **The skill is not a copy of `docs/`, and writing it as one would waste the effort.** `docs/plan-lifecycle.md` is a
  state-machine specification for contributors; the skill's `PLANS.md` is an answer sheet for a user who asked why their
  Plan is stuck. Same subject, different altitude, different reader. Condense and re-aim; do not paraphrase paragraph by
  paragraph.
- **Context load is paid in every project, every turn.** A model-invoked description sits in the window everywhere
  RunWield runs. Keep it tight and keep `SKILL.md` an index. If the description is written loosely, it will fire on
  unrelated "how do I use this" questions.
- **Spurious firing inside this repository.** An Engineer editing RunWield source may trip a skill about RunWield.
  Anchor the description on user-facing usage questions, and state in the body that changing RunWield's own behavior
  means reading the source, not this skill.
- **The GitHub link base is a bet on a public repository path.** If the repository moves or the site launches, every
  link in the skill changes. They are confined to the skill body, so the edit is one directory wide.
- **Prose cannot be fully protected by grep.** The Objective-Failing Checks prove the skill exists, is model-invoked,
  names every required topic, and links only to files that exist. They cannot prove the prose is accurate or useful —
  that is what the outside-repo manual test and the accuracy spot-checks are for. Do not treat green checks as
  sufficient.
- **Accuracy over recall.** Verify every command, flag, settings key, and status name against source before writing it.
  A confidently wrong answer about `wld plans unshare` is worse than no skill at all, because unshare is destructive.
- **Voice.** Write in ASD-STE100 Simplified Technical English, matching the existing `docs/` and skill voice.
- **Assumption, recorded for review:** the skill is named `runwield` and lives at `src/skills/runwield/`. Renaming later
  is a directory move plus the two cross-links, so this is cheap to change.
