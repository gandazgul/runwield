# Domain Harness Blueprint

Working draft. This document is exploratory: it is meant to name the concept clearly enough to think with it, not to
lock the product direction.

> Shape the environment so the human plus LLM can do cognition neither could do alone.

## Core Idea

A domain harness is a purpose-built cognitive system for human and LLM collaboration in a specific field.

The goal is not merely to give an LLM more tools. The goal is to shape a domain environment so that the coupled system
of human, LLM, memory, tools, representations, evaluators, and action channels can reason and act in ways neither the
human nor the model could reliably do alone.

In the language of extended cognition, the harness is the external structure that lets the human and model form a
tighter cognitive loop. It supplies the domain's notebooks, instruments, tests, maps, procedures, review norms, and
hands.

RunWield is the first example: a software engineering harness. It turns a repository into a more legible environment for
LLM-partnered planning and execution by combining agents, plans, code search, shell tools, memory, validation, review,
and user judgment.

## The Domain Harness Loop

Every domain harness should make this loop explicit:

1. **Frame the intent**
   - What kind of work is this?
   - What role should the LLM play?
   - What level of ceremony, risk, and review is appropriate?

2. **Gather the right context**
   - Retrieve prior project memory, source material, domain records, constraints, user preferences, and current state.
   - Prefer targeted context over dumping everything into the model.

3. **Externalize the problem**
   - Create the representation the domain thinks through: a plan, claim ledger, diagram, timeline, table, model,
     experiment design, issue map, case brief, budget, protocol, or checklist.
   - Treat these artifacts as cognition, not just output.

4. **Reason through the representation**
   - Let the LLM propose, compare, critique, simulate, decompose, and revise.
   - Let the human supply values, stakes, domain judgment, taste, and lived context.

5. **Use domain tools**
   - Search, calculate, simulate, inspect, run tests, query records, call APIs, generate drafts, or manipulate the
     working environment.
   - Tool use should be domain-shaped, not just generic shell/browser access.

6. **Evaluate and calibrate**
   - Check claims, run tests, compare against sources, ask a critic, validate against rules, or request expert review.
   - Replace blind trust with calibrated endorsement.

7. **Act with appropriate gates**
   - Make a change, send a message, file a document, update a record, publish a result, or hand work to another system.
   - Match permission gates to risk.

8. **Consolidate or forget**
   - Save durable decisions, corrected beliefs, reusable procedures, and unresolved questions.
   - Avoid memory bloat by keeping temporary scratch state temporary.

The loop is:

```text
intent -> context -> representation -> reasoning -> tools -> evaluation -> action -> consolidation
```

## Key Elements

### 1. Domain Ontology

The harness needs to know the domain's basic objects and work types.

For software engineering, those objects include repositories, files, symbols, tests, issues, plans, diffs, branches,
builds, releases, and incidents.

For another domain, the objects might be patients, studies, statutes, contracts, assays, permits, budgets, lesson plans,
datasets, properties, policies, or field observations.

The ontology does not need to be academically complete. It needs to be operational enough that the harness can route
work, retrieve context, choose tools, and recognize what kind of artifact should be produced.

### 2. Domain Memory

The harness needs memory at several time scales:

- **Session memory:** what is being discussed right now.
- **Project memory:** durable facts, preferences, decisions, and open questions.
- **Artifact memory:** plans, reports, records, issue histories, decisions, and evidence.
- **Procedural memory:** reusable workflows, playbooks, checklists, and review rubrics.
- **Correction memory:** known mistakes, contradicted assumptions, and things not to repeat.

Good memory is inspectable, editable, source-aware, and easy to delete. A memory the user cannot audit becomes a source
of drift.

### 3. Domain Perception

The harness needs ways to observe the domain's world.

In software, this means reading files, searching symbols, inspecting diffs, running commands, reading logs, and seeing
test output.

In other domains, perception may mean reading PDFs, querying databases, viewing images, parsing spreadsheets, monitoring
sensors, searching literature, importing emails, inspecting records, or receiving expert annotations.

Perception should return structured evidence where possible, not just blobs of text.

### 4. External Representations

The harness should provide the representations that make the domain thinkable.

Examples:

- Plans and epics
- Claim ledgers
- Source maps
- Concept graphs
- Timelines
- Risk registers
- Decision logs
- Test matrices
- Review checklists
- Simulation outputs
- Annotated documents
- State machines
- Tables of alternatives

These are the domain equivalent of Otto's notebook and the Tetris rotation example: external structures that change the
cognitive task.

### 5. Domain Tools

Tools should be selected because they play a real cognitive role in the domain.

Useful categories:

- **Retrieval tools:** search prior work, sources, records, and domain knowledge.
- **Analysis tools:** calculate, simulate, classify, compare, trace, or summarize.
- **Construction tools:** draft, edit, generate, transform, or assemble artifacts.
- **Inspection tools:** view, diff, validate, render, audit, or replay.
- **Coordination tools:** create tasks, route work, request review, track state.
- **Action tools:** update the world through commits, filings, messages, forms, records, deployments, orders, or
  tickets.

A strong harness makes tool affordances visible to the LLM. The model should know when a tool is useful, what evidence
it returns, what assumptions it carries, and what risks require confirmation.

### 6. Roles and Routing

Different work needs different cognitive posture.

A domain harness should route between roles such as:

- Guide: explain, answer, orient.
- Ideator: explore unclear ideas.
- Planner: turn intention into a reviewable artifact.
- Operator: perform direct, bounded operations.
- Builder: make changes or produce work.
- Reviewer: critique against requirements and domain standards.
- Specialist: apply a domain-specific lens.
- Slicer: decompose large efforts into shippable or reviewable units.

The role system is not theater. It is a way of controlling attention, ceremony, risk, and tools.

### 7. Evaluation and Review

Every domain has its own version of "does this hold up?"

Software has tests, lint, type checks, code review, benchmarks, acceptance criteria, and production telemetry.

Other domains may use peer review, expert sign-off, source triangulation, legal rules, medical guidelines, financial
controls, lab protocols, simulation checks, audit trails, statistical validation, or safety reviews.

The harness should make evaluation part of the loop instead of an afterthought.

### 8. Permission and Governance

The more useful the harness becomes, the more capable it becomes of changing the world.

Action tools need:

- permission scopes
- approval gates
- audit logs
- reversible steps where possible
- risk tiers
- human ownership of consequential decisions
- clear handoff points

The harness should not pretend every domain action has the same risk profile.

### 9. Domain Expert Interface

The expert is not just a user who types prompts. The expert teaches the harness what matters.

The harness should make it easy for the expert to:

- correct the model
- annotate artifacts
- approve or reject interpretations
- name domain heuristics
- mark trusted and untrusted sources
- define review criteria
- capture reusable procedures
- identify what the model is missing

This is where domain knowledge becomes part of the external cognitive system.

### 10. Learning and Evolution

A good harness should improve without turning every conversation into permanent memory.

It should distinguish:

- scratch notes
- temporary task state
- durable decisions
- reusable domain knowledge
- personal preferences
- contradicted memories
- product-level lessons

The hard problem is not saving everything. The hard problem is deciding what should become part of the future loop.

## RunWield as the First Domain Harness

RunWield's domain is software engineering. Its current shape already contains many of the generic harness elements.

### Current Strengths

- **Intent framing:** Router classifies work into inquiry, ideation, operation, quick fix, feature, and project.
- **Role separation:** Guide, Ideator, Operator, Planner, Architect, Slicer, Engineer, Tester, and Reviewer provide
  different cognitive postures.
- **Durable artifacts:** Plans, PRDs, ADRs, lifecycle state, and future work records make work inspectable.
- **Execution loop:** Feature work moves from plan to review to execution to validation.
- **External tools:** Shell, git, tests, code search, project files, browser workspace, Mnemosyne, Cymbal, and Snip
  extend the model's reach.
- **Validation:** Mechanical validation, semantic review, and merge-back create a stronger feedback loop than chat-only
  coding.
- **Local-first control:** The user keeps the repo, plans, config, memory, and credentials in their own environment.
- **Customization:** Agents, skills, prompts, tools, models, and settings can be adapted.

### Gaps Toward a Fuller Software Engineering Harness

These are possible gaps, not finalized requirements.

#### 1. A More Explicit SE Ontology

RunWield has routing intents and plan types, but the harness could make the software domain model more explicit:

- code areas, ownership, and architectural boundaries
- product surfaces and user workflows
- dependency graph, call graph, and data-flow concepts
- test types and confidence levels
- release, migration, incident, and rollback concepts
- risk categories such as security, data loss, performance, and UX regression

This would let the harness reason in domain-native terms rather than only in files and plans.

#### 2. Evidence and Traceability

Plans and validation exist, but the harness could better preserve why it believes something:

- source-backed claim ledger
- requirement-to-diff traceability
- test evidence linked to plan items
- unresolved assumptions
- reviewer objections and resolutions
- confidence levels for risky claims

This would make review less vibe-based and more inspectable.

#### 3. Better Context Curation

RunWield already uses targeted context, memory, plans, and code search. A fuller harness would improve:

- when to retrieve memory
- when not to retrieve memory
- how to separate scratch state from durable state
- how to expire stale assumptions
- how to surface contradictory context
- how to let the user inspect and prune the active context set

The goal is a clean cognitive loop, not maximum context.

#### 4. Richer External Representations

Plans are powerful, but SE work often wants other thinking surfaces:

- architecture maps
- dependency graphs
- state machines
- API contract tables
- test matrices
- risk registers
- migration timelines
- user workflow diagrams
- debugging timelines
- incident narratives

RunWield Workspace could become the place where these representations are created, inspected, and revised.

#### 5. Tool Affordance Model

The harness has tools, but it could better teach agents what each tool is for:

- what questions a tool can answer
- what evidence the tool returns
- when the tool is expensive or risky
- when a result needs corroboration
- what permissions are required
- what domain role should use it

This is important if RunWield becomes a kernel for non-SE harnesses.

#### 6. Evaluation Beyond "CI Passed"

Mechanical validation is necessary but incomplete.

Potential additions:

- acceptance criteria checks tied to plan items
- UX/browser evidence for frontend work
- performance baselines and regressions
- security review triggers
- migration rehearsal
- property-based or scenario testing prompts
- human review rubrics by risk type

The harness should ask: what would count as real confidence for this kind of change?

#### 7. Expert Teaching Loop

RunWield can store project memory and customize agents, but the expert teaching loop could be more deliberate:

- "remember this pattern" with scoped memory preview
- "this was wrong" contradiction handling
- reusable playbook extraction after successful work
- domain-specific review rubric authoring
- team conventions captured from repeated corrections
- guided memory curation instead of hidden accumulation

This is where the user's software judgment becomes part of the harness.

#### 8. Harness Kernel and Domain Packs

RunWield could eventually separate:

- a general harness kernel: session runtime, agents, memory, tools, plans, permissions, evaluation, workspace
- a software engineering domain pack: repo tools, code search, CI, git, plans, code review, release workflows
- future domain packs: field-specific ontology, tools, representations, evaluators, and action gates

This is the bridge from RunWield as a coding harness to RunWield as a way to build domain harnesses.

## Domain Harness Questionnaire

Use these questions for each new candidate domain.

### Domain Fit

- What domain has real work that matters?
- Where do you or a partner have enough expertise to judge quality?
- Where are current tools fragmented or poorly coupled?
- What external representations do experts already use?
- What could an LLM help reason through if the environment were shaped correctly?

### Work and Users

- Who is the primary expert user?
- Who else participates in the work?
- What common work types should the harness recognize?
- Which work types are low-risk drafting, medium-risk workflow changes, or high-risk real-world actions?

### Domain Objects

- What are the domain's core objects?
- What states do those objects move through?
- What relationships matter between those objects?
- What metadata, provenance, or history must be preserved?

### Context and Sources

- What sources are trusted?
- What sources are useful but need skepticism?
- What records or files define the current state of the work?
- What information is private, regulated, time-sensitive, or safety-critical?

### External Representations

- What artifacts do experts already think with?
- What tables, maps, diagrams, timelines, models, ledgers, briefs, checklists, or protocols make the work clearer?
- What representation would let the human and LLM inspect the same problem together?

### Tools and Instruments

- What tools retrieve evidence?
- What tools analyze, calculate, simulate, or compare?
- What tools construct or edit domain artifacts?
- What tools inspect, validate, render, audit, or replay?
- What action tools change the world?

### Evaluation and Review

- What counts as evidence?
- What counts as "done"?
- What can be mechanically checked?
- What requires expert judgment?
- What failure modes are common, costly, or dangerous?
- What review rubric would make output trustworthy?

### Memory and Learning

- What should be remembered only for the session?
- What should become durable project memory?
- What should be saved as a reusable procedure or playbook?
- What should be easy to correct, expire, or delete?
- How should contradictions be surfaced?

### Permission and Governance

- What actions can the harness take without confirmation?
- What actions require explicit approval?
- What actions should only be drafted, never executed?
- What audit trail is required?
- What must remain under human ownership?

### Prototype Loop

Pick one narrow loop first:

```text
user intent -> targeted context -> domain artifact -> LLM reasoning -> tool/evidence -> expert review -> revised artifact
```

The first prototype does not need full automation. It needs to prove that the external representation and tool loop make
the human plus LLM think better.

## Candidate Domain Patterns

Some reusable patterns may appear across many fields:

- **Research harness:** sources, claim ledger, concept map, citation checks, literature search, synthesis drafts.
- **Legal harness:** matter file, facts, issues, authorities, argument map, drafting, citation validation, risk review.
- **Medical/clinical support harness:** patient timeline, guidelines, differential reasoning, evidence review, strict
  clinician gates.
- **Finance harness:** accounts, transactions, forecasts, scenarios, controls, reconciliation, audit trail.
- **Education harness:** learner model, curriculum map, lesson plans, assessments, feedback loops.
- **Policy harness:** stakeholders, constraints, precedents, impact analysis, drafts, review cycles.
- **Scientific lab harness:** protocols, observations, instruments, datasets, analysis notebooks, replication checks.
- **Operations harness:** incidents, runbooks, telemetry, decision logs, mitigation plans, postmortems.

Each domain needs its own cognitive loop. The generic harness pattern is useful only if it becomes specific enough to
respect the domain.

## Open Questions

- What is the smallest domain harness that would prove the idea outside software engineering?
- Which parts of RunWield are a general harness kernel, and which are only software-specific?
- How should memory be curated so the harness learns without becoming polluted?
- What interface lets a domain expert teach the harness without becoming a prompt engineer?
- What forms of evaluation are strong enough for domains where "tests passed" has no direct equivalent?
- How should permission gates vary across low-risk drafting, medium-risk workflow updates, and high-risk real-world
  actions?
- What should be inspectable to preserve user trust: context, memory, tools, reasoning traces, evidence, or all of them?

## Working Thesis

The next generation of useful LLM systems may not be generic assistants. They may be domain harnesses: structured
extended-mind environments where humans and models share memory, tools, representations, evaluation, and action.

RunWield is the software engineering instance of that thesis. The broader opportunity is to learn which parts of its
loop generalize, then build new harnesses with domain experts who know what good cognition looks like in their field.
