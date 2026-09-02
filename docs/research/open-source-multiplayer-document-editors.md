# Open-source multiplayer document editors for RunWield

## Question

Which open-source multiplayer document editors or editor frameworks are worth studying or adopting for RunWield
Workspace while repository Markdown and RunWield lifecycle rules remain canonical?

## Findings

### Embeddable foundations

| Candidate                                         | Strength                                                                                                                                         | Main concern for RunWield                                                                                                                                                                                     | Source                                                                                                                                                                                   |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Current Plannotator CodeMirror 6 editor + Yjs** | Exact text editing, shared cursors, concurrent changes, shared undo, MIT components, and the smallest change to RunWield's existing editor stack | Comments, tracked suggestions, durable identity, provenance, encrypted transport, persistence, and repository reconciliation remain RunWield work                                                             | <https://github.com/yjs/y-codemirror.next>, `third_party/plannotator/packages/ui/components/MarkdownEditor.tsx`                                                                          |
| **Milkdown + Yjs**                                | MIT, Markdown-oriented WYSIWYG editor built on ProseMirror and Remark, with React support and real-time collaboration                            | Parsing and serialization can normalize Markdown; exact Front Matter and unsupported syntax need explicit protection                                                                                          | <https://milkdown.dev>, <https://github.com/Milkdown/milkdown>                                                                                                                           |
| **ProseMirror + Yjs**                             | Mature structured-editor foundation with flexible document models and change-tracking primitives                                                 | High product and engineering cost; Markdown schema, React integration, comments, suggestions, and provenance are not a complete product                                                                       | <https://prosemirror.net>, <https://github.com/yjs/y-prosemirror>, <https://prosemirror.net/examples/track/>                                                                             |
| **Tiptap + Hocuspocus**                           | Mature ProseMirror developer layer with React support and an open-source Yjs collaboration server that can run on Deno                           | Tiptap recommends JSON or HTML as persisted editor state; advanced comments, versioning, and related collaboration features include paid packages; repository-canonical Markdown is not its natural authority | <https://github.com/ueberdosis/tiptap>, <https://tiptap.dev/docs/hocuspocus/introduction>, <https://tiptap.dev/docs/editor/core-concepts/persistence>                                    |
| **BlockNote**                                     | React-first Notion-style block editor with built-in Yjs collaboration and a polished editing experience                                          | Markdown conversion is explicitly lossy and BlockNote recommends its JSON format as canonical. Core is MPL-2.0; XL packages are GPL-3.0 or commercially licensed                                              | <https://www.blocknotejs.org/docs/features/collaboration>, <https://blocknotejs.org/docs/foundations/supported-formats>, <https://github.com/TypeCellOS/BlockNote/blob/main/LICENSE.txt> |
| **Lexical + Yjs**                                 | MIT, React-first, active, and supported by Meta; official collaboration package and Markdown transformers                                        | Lexical state is primary. Markdown support covers configured transformers rather than exact arbitrary source; comments are example code rather than a production feature                                      | <https://lexical.dev/docs/collaboration/react>, <https://lexical.dev/docs/packages/lexical-markdown>                                                                                     |

### Complete products worth studying

| Product           | Lesson for RunWield                                                                                                                                                                                                         | Why not adopt as the foundation                                                                                                                                                                                                  |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **La Suite Docs** | Strongest current open-source product benchmark for polished live cursors, comments, sharing, access control, offline work, optional AI interaction, and self-hosting. It is MIT and uses React, BlockNote, Tiptap, and Yjs | It is a complete Django-backed knowledge product whose block document is authoritative. Markdown is an import/export format, not exact repository truth. Some export features use BlockNote XL packages with different licensing |
| **Proof SDK**     | Best agent-specific benchmark for suggestion-first edits, agent presence, stable block operations, comments, and human/agent provenance                                                                                     | Early `0.1.0` extraction with no stable public package boundary; duplicates RunWield storage and collaboration authority                                                                                                         |
| **Etherpad**      | Best benchmark for visible per-character authorship and a scrubbable history; Apache-2.0 and long-lived                                                                                                                     | Its pad model is authoritative and it is not Markdown-first or a natural React component                                                                                                                                         |
| **CryptPad**      | Best benchmark for server-blind encrypted collaboration. Its Markdown application uses CodeMirror, supports author colors, and exports `.md`                                                                                | AGPL complete application with its own encrypted storage and document lifecycle                                                                                                                                                  |
| **HedgeDoc**      | Mature self-hosted collaborative Markdown experience for technical teams                                                                                                                                                    | AGPL complete application with database-backed note authority; limited structured suggestion and agent-provenance model                                                                                                          |

## Inference

There are two materially different RunWield products hidden in the phrase “multiplayer editor”:

1. **Multiplayer Markdown source:** users share cursors and concurrently edit the exact repository text. This protects
   arbitrary Markdown, Front Matter, and git diffs. The current Plannotator CodeMirror editor plus Yjs is the strongest
   starting point.
2. **Multiplayer rich document:** users edit blocks without seeing Markdown syntax. This is easier for Product Managers
   and Designers, but a JSON or ProseMirror document normally becomes canonical and Markdown export can lose or
   normalize content. La Suite Docs, BlockNote, Milkdown, and Tiptap are the useful references.

Real-time synchronization does not provide comments, suggestions, or trustworthy provenance by itself. Yjs awareness and
client IDs are temporary collaboration data, not durable human or Agent identity. A RunWield capability would still need
a separate review model and a safe commit boundary.

RunWield also has a stricter security constraint than most editor demos. Its Shared Space baseline keeps semantic
content encrypted from the server. A normal Yjs WebSocket or Hocuspocus server can inspect document updates unless
RunWield adds end-to-end encryption.

## Recommendation

1. **Study La Suite Docs first as the full product benchmark.** It is the strongest open-source example of the
   multiplayer experience RunWield may eventually want for PRDs and early planning.
2. **Study Etherpad for authorship/history, CryptPad for encrypted collaboration, and Proof for Agent suggestions and
   provenance.** Each has one unusually strong product lesson.
3. **If RunWield validates demand for source-style multiplayer editing, test the current Plannotator CodeMirror editor
   with stable `y-codemirror.next` and Yjs v13.** The current upstream package warns that its Yjs v14 branch is
   unstable.
4. **Keep Front Matter outside the collaborative body.** Initialize a collaboration room from an exact artifact
   revision, then commit through RunWield's existing locked save and revision checks. Yjs must remain an active
   projection, not artifact authority.
5. **Do not select a rich block editor until the product chooses convenience over exact Markdown preservation for a
   specific artifact type.** If that choice is made for PRDs, compare Milkdown and BlockNote in a disposable prototype.
   Do not start with Plans.

The option set aside is replacing Plannotator with a complete editor product. That could deliver visible multiplayer
behavior faster, but it would introduce a second artifact store, lifecycle, identity model, theme stack, and review
model while weakening repository-canonical Markdown.

## Open Questions

- Should the first collaborative artifact feel like a Markdown source editor or a Google Docs-style rich document?
- Is the first target a Plan, where exact source and lifecycle safety dominate, or a PRD, where accessibility to
  non-engineers may justify a rich editor?
- Is live simultaneous typing itself valuable, or are durable comments, suggestions, attribution, and asynchronous
  review the actual user need?
- Must hosted collaboration preserve the existing ciphertext-only server invariant from its first release?
