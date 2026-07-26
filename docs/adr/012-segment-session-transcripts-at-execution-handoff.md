---
status: accepted
---

# ADR-012: Segment Session Transcripts at the Execution Handoff

## Context

Planner conversation and tool history consume context and can expose exploratory or superseded reasoning to the
Engineer. Reusing one Pi `SessionManager` across the planning-to-execution Agent switch therefore puts execution at a
disadvantage. Filtering one shared JSONL would be difficult to prove complete, while creating a separate user-facing
Session would break continuous scrollback and Plan workflow ownership.

## Decision

A stable RunWield **Session** may own multiple ordered Pi session JSONL files, each represented in the product as a
**Session Transcript Segment**. The UI projects all segments as one continuous Session Transcript, but the active root
Agent receives model context only from the current segment.

For **Approve & Run**, RunWield activates a fresh persisted execution segment transactionally after the Readiness Gate
and execution preparation succeed, immediately before the Engineer's first turn. The segment starts from the approved
Plan, approval annotations and images, and current execution state; it does not copy or summarize planning messages.
**Approve for Later** does not create an execution segment.

The execution segment remains current through implementation, Workflow Validation, Engineer repairs, interruption
recovery, and successful validation. Isolated Reviewer sessions do not replace it. The Engineer remains active after
validation until a new request requires fresh Router triage.

This changes ADR-011's one-to-one mapping between a stable RunWield Session ID and one Pi Session Manager ID/JSONL path:
the stable Session ID instead owns an ordered set of segment IDs and paths, with one current writable segment. Session
Activation and Plan Workflow Lease ownership remain keyed to the stable RunWield Session.

## Consequences

Resume, Workspace/TUI projection, context reporting, cross-process generation tracking, image rehydration, and
transcript search must treat the Session Transcript as an ordered aggregate without injecting sealed segments into
current model context. Segment rollover must be atomic so failed or canceled execution preparation cannot leave an empty
execution segment current.
