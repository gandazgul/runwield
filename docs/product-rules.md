# RunWield product rules

Rules stated by the product owner that constrain how RunWield may behave. They are not derivable from the code, and each
one has been violated at least once by a change that looked locally correct. Cite the rule number in review when a
change crosses one.

Testing practice is deliberately not duplicated here. It lives in `src/skills/write-tests/SKILL.md`, which is what
agents actually load when they write tests — a rule repeated in two places drifts in one of them.

## Workflow rules

### PR-1 — RunWield owns Plan metadata; the user is never billed for RunWield's bookkeeping

Plan Front Matter, the worktree registry, transition journals, and lock files are RunWield's own state. A problem in
that state is RunWield's to resolve. RunWield may not fail an operation and hand the user an internal artifact to sort
out.

Consequences:

- Anything RunWield can prove from repository facts, it must fix itself — that is what `wld plans doctor --repair` is
  for.
- A diagnostic must never report less than it knows. An invariant violation is the moment per-item detail matters most,
  so diagnosis reads its own stores without enforcing invariants.
- RunWield may not manufacture a state it then refuses to read (for example, a migration that creates a duplicate live
  attempt and makes the registry unloadable).

### PR-2 — When the user genuinely must act, the instruction is specific and copy-ready

A block is only acceptable if the user can act on it. Every blocked or unresolved outcome carries: what RunWield was
protecting, the single thing that lacks evidence, commands ready to paste with real paths and ids, and what each outcome
means. Bare internal labels, hash-vs-hash diffs, and "restore from backup" are not acceptable messages.

### PR-3 — RunWield owns Front Matter; the user owns the body

The body may be edited with any tool, at any time, without going through RunWield, and never has to be valid to
RunWield.

Consequences:

- No lifecycle decision may be gated on whole-file Plan bytes. Compare Front Matter identity
  (`getPlanFrontMatterRevisionForText`, the `frontMatterRevision` on loads).
- Whole-file compare-and-set still belongs to writers that would clobber a body: review markdown apply, Workspace body
  save, Agent file edits.
- A failed transition may revert its own Front Matter onto whatever body is on disk now. It may never revert a body.
- Malformed Front Matter is reported as such: only the block between the `---` markers must parse, and the message must
  say so, because the user's prose cannot be the cause.

### PR-4 — Nothing that could hold work is destroyed without proof or explicit consent

Worktree directories, branches, and Plan files are never removed, force-deleted, or abandoned on RunWield's own
initiative. Automatic action requires proof from repository facts that nothing can be lost; otherwise RunWield prints
the command and lets the user decide. An unclaimed worktree is treated as the most likely place uncommitted work is
hiding.

Purely internal artifacts with no work content — a settled journal, an abandoned lock file, a stale registry row for an
already-settled attempt — are RunWield's to clean up under PR-1 and are not covered by this rule.

### PR-5 — Every lifecycle transition is all-or-nothing, and never silently uncertain

Advancing a Plan, moving Git, and updating the registry either all happen or none do. Where an external effect cannot be
undone, RunWield proves the outcome from repository facts or leaves durable evidence and a recovery recipe. It never
guesses, never replays uncertain Git work, and never reports a rollback it did not perform.

### PR-6 — External Plans are first-class: a file with no Front Matter is still loadable

Users write Plans in their own editors and drop them in `plans/`. A plain markdown file there is normal, not an error.

- **Reading tolerates it.** Anything that reads Front Matter ignores its absence and falls back to defaults. A bare
  `.md` in `plans/` never makes a command fail, and never shows up as drift in `wld plans doctor`.
- **Reading never claims it.** A listing is not consent to write. Passive reads leave the file byte-for-byte alone and
  report no `planId` rather than backfilling one — otherwise opening a Plan Board or reading the worktree registry would
  silently stamp RunWield metadata into a file the user was still drafting.
- **`load-plan` adopts it, and persists that.** Loading is the deliberate action, so it writes the defaults and the file
  stops being anonymous. The body is preserved exactly (PR-3).

Onboarding defaults: generated `planId`, `classification: PLANNED_CHANGE`, `complexity: MEDIUM`, `summary: ""`,
`affectedPaths: []`, `status: draft`, `origin: external`, `updatedAt` now, and `createdAt` from the file's own creation
time — the Plan existed before RunWield saw it, and that age is real history. `workKind` is left unset:
`BUG_FIX|FEATURE|REFACTOR|MAINTENANCE|DOCUMENTATION` has no "unknown" member, so absent _is_ unknown. `executionAgent`
and `collaborationRecommendation` stay unset so policy resolution supplies the defaults.

Onboarding is idempotent — a file that already has Front Matter is returned untouched, so loading a Plan twice cannot
reset lifecycle state. `createdAt` must be captured before the write: the atomic rename resets the file's birthtime, so
it is unrecoverable afterwards.

Implemented as `onboardExternalPlan()` in `src/plan-store.js`, called from `/load-plan`.
