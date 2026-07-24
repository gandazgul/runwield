---
status: accepted
---

# ADR-004: Plan Lifecycle Transitions Are Centralized

## Decision

RunWield workflow code records Plan Events into a single Plan Lifecycle module instead of directly mutating Plan Status
at each call site. The lifecycle module owns allowed transitions, timestamps, failure details, execution baseline
metadata, and the meaning of executable states. This keeps router, review, readiness, execution, validation, and
recovery code decoupled from the state machine so future workflow changes do not recreate conflicting status semantics.
