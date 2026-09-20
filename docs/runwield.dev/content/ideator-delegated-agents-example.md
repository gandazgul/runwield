# Content: the Ideator delegated-agents example

**Use for:** the "just use Plan Mode / just tell it not to implement yet" objection. It comes up every time the skills
are posted. This is the answer — a real transcript with shipped code at the end, not "try it and see."

**Source:** Ideator session 2026-07-17. Carlos opened with a throwaway line ("so we need type: epic anymore?"). It ended
up designing delegated sub-agents. The four answers are `src/tools/delegate-agent.ts` today.

**Where it ran:** r/ClaudeAI and r/ChatGPTCoding, September 2026. Those posts are gone. Reuse the text.

---

## The reply

Fair push. Concrete example instead of me saying "try it."

I opened a session with a lazy one-liner about my schema. It turned into designing delegated sub-agents. First thing it
asked:

> **What should an ephemeral delegated agent be allowed to do in the first version?**
>
> - Read-only investigation/review; return findings to the parent _(recommended)_
> - Normal role tools, including edits in the parent's working tree
> - May edit, but only in an isolated worktree with an explicit result/merge protocol

I answered: _"is read only useful enough? or could an agent delegate one part of coding while the main agent tackles
another. I don't know, let's examine the pros and cons and the possible failures for letting subagents write."_

That's the part plan mode doesn't do. It didn't pick for me and start writing. It went and worked the failure modes,
then came back with three more, one at a time, each only answerable after the previous one:

1. **When a delegated writer fails after changing files, what happens to those edits?** Preserve them and return the
   changed paths / auto-rollback the tree / pause and ask.
2. **Can read-only and writing delegates overlap?** Parallel readers or one exclusive writer, never both?
3. **Foreground batch, or real background spawn/wait/cancel?**

I had not thought about #1 at all. "A sub-agent dies halfway through editing your working tree" is the thing that
actually bites, and I would have found it in production instead of in a design doc.

Those four answers _are_ the design. It shipped as one tool with `mode: read|write` and a `brief`, a lease that enforces
readers-or-one-writer, and a snapshot taken before any write delegate starts, so a failure hands back changed paths
instead of a mess.

Note what it never asked me: what to name the tool, what the params should be called, what the result shape is. It
inferred those and told me what it assumed. That's the triage rule — only ask where a different answer produces a
different product. Plan mode asks nothing and assumes everything.

---

## Notes for reuse

- The strongest line is the one about question #1. Lead with it if you need a shorter version.
- Do not shorten away the "it didn't pick for me" beat. That is the whole difference from plan mode.
- The shipped-code ending is what makes it proof. Keep the `mode`/lease/snapshot sentence.
- Related framing that landed in the same threads: "Ideator is grill-me with more rules around what makes good questions
  and a research protocol bolted in." That reference frame is what the audience already has. Consider leading a future
  post with it.
