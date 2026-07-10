# Sleep

You are running RunWield sleep mode to optimize long-term memory quality conservatively.

## Goal

- Improve memory signal quality for future sessions without losing useful context.
- Remove exact duplication, truly deprecated facts, and explicitly superseded memories.
- Preserve durable decisions, rationale, constraints, exceptions, and the history needed to understand current truth.
- Keep core memories limited to the most critical and frequently accessed context.

Memory-count reduction is not a goal. When uncertain whether context remains useful, keep the memory.

## Safety Rules

- Never treat age, verbosity, completed implementation work, or discoverability in source code as sufficient reasons to
  delete a memory.
- Do not collapse distinct decisions merely because they concern the same feature. Preserve differences in scope,
  chronology, rationale, constraints, and exceptions.
- A consolidation must be lossless: its replacement must retain every durable fact from the source memories, including
  why a decision changed and which statement is current.
- Delete a superseded memory only when an authoritative replacement clearly captures the current truth and any useful
  transition context.
- Prefer demoting a memory from `core` to regular over deleting it when the content remains useful but is not needed in
  every session.
- Preserve all memories that are unrelated to an identified duplicate, deprecation, supersession, or lossless
  consolidation.

## Process

1. Analyze the pre-maintenance export supplied by RunWield and classify proposed changes as one of:
   - exact duplicate;
   - truly deprecated or contradicted by an identified current authority;
   - explicitly superseded by an identified replacement;
   - lossless consolidation;
   - core-tag promotion or demotion;
   - keep.
2. Before mutating Mnemosyne, write a timestamped deletion manifest in the supplied session artifact directory. For
   every proposed deletion, record the memory ID, its full content and tags, the classification and reason, and the
   replacement memory or authoritative source that preserves its context.
3. If the proposal would delete more than 25 memories or more than 10% of the collection, whichever threshold is reached
   first, stop before mutation and ask the user to review the immutable backup and manifest. Continue only after
   explicit approval.
4. Apply approved changes. Add and verify every consolidation or replacement before deleting its source memories. Move
   memories between core (`--tag core`) and regular storage as needed; core is for critical, frequently accessed context
   only.
5. Export the post-maintenance collection to a separate file in the supplied session artifact directory and verify:
   - every untouched memory is still present with its original content and tags;
   - every deleted memory appears in the manifest and has a verified replacement or authority;
   - every consolidation preserves the durable facts, rationale, constraints, and exceptions of its sources.
6. Report counts for kept, promoted, demoted, consolidated, and deleted memories, plus the backup, manifest, and
   post-maintenance export paths. Do not claim that deleted memories were unnecessary; report the specific reason each
   category was safe to remove.

Delete with `mnemosyne delete [memory id]` and add with `mnemosyne add [memory content] --tag tag1 --tag tag2`.
