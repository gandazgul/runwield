# Proof SDK and Plannotator for RunWield

## Question

Should Proof SDK replace Plannotator, complement it, or only inform future RunWield Workspace collaboration work?

## Findings

- Plannotator is a local review surface for Markdown, Plans, agent messages, HTML artifacts, local code changes, and
  forge change requests. It sends structured feedback back to supported coding agents. Its team-sharing direction is a
  separate hosted Workspaces product. Source: <https://github.com/backnotprop/plannotator>
- RunWield already embeds pinned Plannotator source and uses Plannotator-based Plan and code review. RunWield owns
  canonical Plan files, Plan Lifecycle, approval evidence, validation, and worktree safety. Sources:
  `third_party/README.md`, `src/skills/runwield/PLANS.md`, `docs/domain-language.md`
- RunWield also has a verified self-hosted Shared Space baseline with encrypted Plan and comment content, capability
  links, Revision cycles, and a Shared Plan Lock. Real-time editing, browser Plan-body editing, notifications,
  attachments, and Revision diffs remain out of scope for that baseline. Sources:
  `docs/prd/collaborative-planning-PRD.md`,
  `docs/work-records/2026-07-21-self-hosted-collaborative-planning-shared-spaces-completed.md`
- Proof SDK is an MIT-licensed collaborative Markdown editor, collaboration server, provenance model, SQLite store, and
  agent HTTP bridge. It supports live presence, comments, suggestions, rewrite operations, event polling, stable block
  references, optimistic revision checks, and Yjs/Hocuspocus collaboration. Sources:
  <https://github.com/EveryInc/proof-sdk>, <https://github.com/EveryInc/proof-sdk/blob/main/AGENT_CONTRACT.md>,
  <https://github.com/EveryInc/proof-sdk/blob/main/docs/agent-docs.md>
- Proof tracks human and agent authorship and defaults agent document changes to reviewable suggestions. Source:
  <https://proofeditor.ai>, <https://github.com/EveryInc/proof-sdk/blob/main/docs/proof.SKILL.md>
- Proof SDK is an early extraction rather than a stable packaged dependency. The repository is version `0.1.0`, has no
  tags, and its five internal packages are marked `private` and export source files through paths outside each package.
  The public history had ten commits as of 2026-09-01, with the latest SDK sync on 2026-03-23. The hosted Proof setup
  page also states that the SDK is a point-in-time snapshot that lags the hosted product. Sources:
  <https://github.com/EveryInc/proof-sdk/blob/main/package.json>,
  <https://github.com/EveryInc/proof-sdk/tree/main/packages>, <https://proofeditor.ai>
- Proof SDK does not provide Plannotator's broad code-diff and rendered-HTML review jobs. Plannotator does not provide
  Proof's live multi-author document model and character-level human/agent provenance. Sources: the two official
  repositories above.
- RunWield's strategy calls for Multiplayer AI, shared artifacts, reviewable team intelligence, and repository-canonical
  PRDs, Plans, ADRs, and Work Records. Source: `docs/product-strategy.md`, `docs/prd/runwield-workspace-prd.md`

## Inference

Proof and Plannotator solve adjacent jobs:

- **Plannotator:** inspect an artifact or change, annotate it, and make a gate decision.
- **Proof:** let humans and agents co-author a living Markdown document while preserving presence, authorship, comments,
  and proposed changes.

Replacing Plannotator with Proof would reduce RunWield's review coverage and discard a mature integration. Adding Proof
SDK wholesale would duplicate RunWield's document storage, SQLite collaboration service, sharing credentials, comments,
and synchronization rules. It could also weaken RunWield's repository-canonical artifact and lifecycle ownership unless
a strict adapter boundary kept Proof as a temporary collaboration projection.

Proof's strongest contribution is therefore a product model, not yet a dependency: live human-agent co-authoring with
visible provenance and suggestion-first agent edits. This directly supports RunWield's Multiplayer AI direction and
fills a known gap for PRDs, ADRs, and early Plans before formal approval.

## Recommendation

1. Keep Plannotator as RunWield's review and approval surface.
2. Do not replace it with Proof SDK and do not add Proof SDK wholesale now.
3. Explore one narrow Workspace capability: collaborative editing of a repository-canonical PRD or draft Plan, with
   human/agent attribution, presence, comments, and suggestion-first agent edits.
4. Treat Proof SDK as a reference implementation during discovery. Reconsider it as a dependency only after it publishes
   stable package boundaries, versions its public protocol, keeps the open-source SDK in step with the hosted contract,
   and demonstrates an integration mode that does not become the canonical artifact or lifecycle owner.
5. Preserve RunWield's existing boundaries: repository Markdown remains canonical; Plan Lifecycle and approval remain
   RunWield-owned; Plannotator remains the gate surface; shared-content security must not regress from the
   ciphertext-only baseline.

The option set aside is a full Proof-based collaboration replacement. It would deliver real-time editing sooner, but at
the cost of two overlapping editor stacks, two collaboration authorities, a large Yjs/Milkdown/Hocuspocus/Express
dependency surface, and migration risk in RunWield's already verified Plan review and Shared Space workflows.

## Open Questions

- Is the near-term user problem better review of completed artifacts, or true concurrent co-authoring before an artifact
  is ready for review?
- Is character-level human/agent provenance valuable enough to experienced developers to justify the visual and
  conceptual weight it adds?
- Should the first multiplayer editing trial target PRDs, where lifecycle risk is low, rather than Plans, where stale
  edits can affect execution authority?
- Can a collaboration projection round-trip Markdown and Front Matter without altering RunWield-owned artifact
  semantics?
