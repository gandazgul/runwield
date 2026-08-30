# RunWield Engineering Quality Principles

## Failure Trends to Prevent

### Fake Tests

- Tests that do not prove behavior.
- Tests that inject RunWield-owned dependencies and hide real interaction bugs. Internal machinery must not be mocked.
- Tests that still pass after the function interaction or behavior is changed incorrectly. Use mutation checks when they
  provide useful proof.

### Monolithic Files

- One large file contains many submodules even when the file has one broad domain responsibility.
- Responsibilities and reasons to change are hidden inside the file.

### Control-flow Complexity

- Large nested loops use `continue` and `break` as orchestration.
- Very long functions combine sequencing, state transitions, effects, and error handling.
- Prefer function composition or explicit event-driven state machines when those structures make ownership clear.

### Weak Types

Avoid broad types such as:

- `any`
- `unknown`
- `object`
- `Record<string, any>`
- `Record<string, unknown>`
- `Record<string, object>`

Define named domain shapes or let the language infer a precise type.

### Local Changes with System-level Risk

Locally reasonable changes can create system-level unknowns. Review architecture and cross-surface invariants separately
from the local implementation.

### Symptom-only Fixes

- The fix addresses the visible symptom but not the underlying cause.
- Trace the failure to its source and correct the faulty ownership, invariant, or design instead of patching around its
  effects.

## Positive Design Principles

- Deep modules with small interfaces.
- Explicit information ownership.
- Complexity absorbed at the lowest appropriate layer.
- Alternatives considered before implementation.
- Design quality reviewed separately from test correctness.
- Unnecessary concepts removed, not only duplicate code.

## Sources for Continued Study

- Martin Fowler, _Refactoring_: <https://martinfowler.com/books/refactoring.html>
- John Ousterhout, _A Philosophy of Software Design_:
  <https://www.amazon.com/Philosophy-Software-Design-John-Ousterhout/dp/1732102201>
- David Thomas and Andrew Hunt, _The Pragmatic Programmer_:
  <https://www.amazon.com/Pragmatic-Programmer-journey-mastery-Anniversary/dp/0135957052/>
