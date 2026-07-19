# Vision PRD: Research Evidence Set

Last updated: 2026-07-18 11:23 EDT

Status: Experimental product hypothesis

## Objective

Explore an opt-in **Research Evidence Set** for Ideator Agent Sessions: a private, session-persisted working set of
source references, qualified notes, and short supporting excerpts for source-heavy research.

The capability should graduate into normal RunWield behavior only if evaluation shows that it improves source fidelity
or context efficiency enough to justify the additional Agent and product complexity.

## Problem Statement

Ideator can research current technologies, compare external sources, inspect repository evidence, and synthesize PRDs or
research notes. In a long source-heavy Agent Session, the transcript may contain large scraped pages, tool results,
Delegated Agent Session reports, intermediate interpretations, and discarded hypotheses.

Compaction can preserve the broad conclusion while weakening the exact relationship between a claim, its source, the
supporting passage, and any qualification. Re-reading sources is expensive, but treating the entire transcript as
durable evidence is noisy and unsafe.

Little-coder addresses a narrower version of this problem with session-local Evidence tools that retain a source, note,
and short excerpt outside message history and remind the model that the entries remain available after compaction. That
mechanism is designed partly for citation-oriented benchmarks such as GAIA. RunWield should not copy it globally or
assume that smaller models benefit from extra bookkeeping.

## Working Hypothesis

For selected smaller or constrained Ideator models performing multi-source, current, or citation-sensitive research, a
small explicit evidence working set may:

- preserve source-to-claim traceability across compaction;
- reduce repeated source retrieval;
- help separate sourced fact from Agent inference;
- let concise Delegated Agent Session reports retain inspectable support without importing child transcripts;
- improve the accuracy of citations in PRDs and research notes.

The opposite may also be true: evidence capture may consume turns, encourage weak models to save low-quality excerpts,
or create false confidence. The vision is intentionally falsifiable.

## Resolved Assumptions

### Ideator-Only Experimental Scope

- Research Evidence Set is initially an Ideator capability, not a generic tool for every Agent.
- Planner and Architect should normally consume synthesized PRDs, research notes, ADRs, Plans, and agreed conclusions
  rather than inherit Ideator's scratch evidence.
- Repository evidence used during ordinary planning remains available through normal code and file tools.
- The capability is absent from Ideator prompts and tools when disabled.

### Explicit Opt-In

- The experiment is enabled only through an explicit Ideator/model preset or user setting.
- RunWield must not infer activation from model size, provider, local/cloud status, or context-window size.
- A preset may recommend the experiment for a tested model, but support status remains visible and reviewable.
- Ordinary Socratic ideation should not incur evidence bookkeeping merely because Ideator is active.

### Agent Session Artifact Lifecycle

- The Research Evidence Set belongs to the Agent Session, not the repository or project memory.
- It should be stored beside RunWield's existing session-associated artifacts under the encoded project session
  directory, following the ownership model used for image attachments and memory-maintenance backups.
- It survives compaction, process restart, and `/resume` for the owning Agent Session.
- It is not injected wholesale into message history, Mnemosyne, default search, Plans, or Work Records.
- It should follow future session deletion, retention, export, and privacy semantics rather than invent an independent
  lifecycle.

### Evidence Is Working Material, Not Truth

- An entry records where information came from and why it may matter; it does not certify that the source is
  authoritative or the claim is correct.
- Evidence should preserve source identity, a qualified note, and only the smallest useful supporting excerpt or
  reference.
- Full scraped documents, secrets, credentials, proprietary payloads, and unnecessary personal information should not be
  copied into the set.
- Conflicting or uncertain sources should remain visibly conflicting or uncertain.
- Source freshness and authority may be surfaced when known but must not be fabricated.

### Promotion Is Deliberate Synthesis

- The Research Evidence Set itself never becomes a durable project artifact automatically.
- Ideator may use selected evidence when writing a PRD or source-backed research note.
- A resulting artifact should cite the original source, not a session-local evidence identifier that will disappear.
- Durable conclusions belong in the appropriate PRD, ADR, Plan, Work Record, research note, `CONTEXT.md`, or Mnemosyne
  Memory according to existing artifact rules.
- Deleting the Agent Session must not invalidate citations already written to durable artifacts because those citations
  point to original sources.

### Evaluation Before Productization

- The first version is an experiment, not a committed default feature.
- Evaluation should compare the same research tasks with and without the capability for a selected Ideator model.
- The experiment should be removed or remain niche if it does not demonstrate material value.

## Proposed Experience

When the experiment is enabled, Ideator may capture a small evidence item after finding a source-backed fact likely to
matter in final synthesis. Ideator can later inspect a compact list, retrieve an item when needed, and distinguish its
own inference from source content.

After compaction or resume, RunWield should make Ideator aware that the Research Evidence Set remains available without
injecting every excerpt into context. The user may inspect or clear the set when a client supports that interaction, but
no new mandatory UI is required for the first experiment.

At synthesis time, Ideator writes normal source links and qualified claims into the requested PRD or research note. The
working set remains private session material.

## Evaluation Questions

The experiment should measure:

- citation correctness and source resolution;
- unsupported or overstated factual claims;
- preservation of qualifications and source disagreement;
- repeated retrieval of the same source;
- context use before and after compaction;
- task completion, latency, and tool-call count;
- evidence entries saved but never used;
- sensitive or excessive source capture;
- user-rated trust and usefulness of the final synthesis.

Evaluation should include tasks where no evidence set is needed so the cost of unnecessary activation is visible.

## Technical Approach

Treat the Research Evidence Set as a session-associated resource resolved through SessionRuntime and scoped by the
persisted Agent Session identity and absolute project root. Storage should be private local state adjacent to existing
session artifacts, not a repo-local file or global service.

Ideator-facing operations should remain minimal: capture, list, retrieve, and clear are sufficient for the hypothesis.
The model should receive concise confirmation rather than echoing saved excerpts back into context. Compaction and
resume should preserve addressability without copying the set into every prompt.

Any client surface must consume semantic Runtime operations and events rather than read session directories directly.
The exact storage representation, limits, and UI can remain implementation decisions after the experiment's product
value is established.

## Risks and Mitigations

- **Bookkeeping overhead:** keep activation explicit and measure unused captures.
- **False authority:** preserve qualifications and distinguish source presence from corroboration.
- **Stale excerpts:** retain original source identity and avoid presenting old captures as fresh retrieval.
- **Privacy and licensing:** save only short necessary excerpts; never default to full-page retention.
- **Context duplication:** store outside message history and retrieve only selected items.
- **Agent fixation:** cap automated correction or reminders; evidence capture is subordinate to useful research.
- **Artifact confusion:** use original citations in durable outputs and never index session-local evidence as project
  memory.

## Success Criteria for Graduation

- A selected Ideator/model preset produces materially more source-faithful synthesis on repeated evaluation tasks.
- Gains survive at least one compaction or resumed Agent Session scenario.
- Unsupported claims or incorrect citations decrease without unacceptable latency, context, or completion regressions.
- Disabled Ideator sessions receive no additional prompt/tool burden.
- Session isolation, deletion, export, and privacy behavior are understandable and testable.
- Users can tell that evidence is private working context rather than durable RunWield knowledge.

## Out of Scope

- A universal claim ledger for all software work.
- Requirement-to-diff-to-test traceability across the full Plan Lifecycle.
- Replacing source-backed research notes, PRDs, Plans, ADRs, Work Records, or Mnemosyne.
- Automatic ingestion of every Web, code, browser, or Delegated Agent Session result.
- Project-wide or cross-project evidence search.
- Treating saved snippets as validation evidence or source certification.
- Requiring every Ideator session to use the capability.
- A hosted evidence database or team collaboration surface.

## Relationship to Existing Vision

This focused hypothesis sharpens the source-aware context and external-representation ideas in
`docs/vision/domain-harness-blueprint.md` and `docs/vision/runwield-se-harness-opportunities.md`. Those documents remain
broader vision sources; this PRD defines one narrow experiment and preserves their warning that claim ledgers should not
become a default artifact for ordinary software work.
