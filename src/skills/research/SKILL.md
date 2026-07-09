---
name: research
description: Investigate a question against high-trust primary sources and capture the findings as a cited Markdown note. Use when the user wants durable research, docs/API facts gathered, ecosystem comparisons, or reading legwork saved for Ideator, Planner, Architect, or future sessions.
---

# Research

Research is the durable layer above [ketch](../ketch/SKILL.md). Use `ketch` as the canonical web/docs/scrape tool, then
turn the findings into a compact Markdown artifact the repo can reuse.

Use this skill when the user wants more than an answer in chat:

- external facts, APIs, standards, or provider behavior investigated
- library/framework docs gathered for future implementation
- ecosystem options compared
- source-backed context prepared for Ideator, Planner, Architect, or a future session

Do not use this skill for ordinary one-off web lookup. Use `ketch` directly for that.

## Source Discipline

Prefer primary sources:

- official documentation
- source repositories
- specifications and standards
- first-party API references
- first-party release notes, changelogs, or migration guides

Use secondary sources only to discover primary sources or to understand broader context. Do not let a secondary source
own a factual claim when a primary source exists.

For library and framework APIs, use `ketch docs` first. For current ecosystem facts, use `ketch search`. For a specific
URL, use `ketch scrape`.

## Process

1. **Define the research question.** State the question in one sentence and the decision or artifact it should inform.
2. **Gather sources with ketch.** Use `ketch docs`, `ketch search`, or `ketch scrape` as appropriate. Prefer official
   sources and keep enough source detail to cite claims.
3. **Distinguish fact from inference.** Mark sourced facts separately from your synthesis or recommendation.
4. **Write one Markdown note.** Save it where the repo already keeps research notes. If there is no convention, use
   `docs/research/<slug>.md`.
5. **Keep it reusable.** Link to Plans, PRDs, ADRs, or files it informs. Do not duplicate existing durable artifacts;
   reference them by path.

## Note Format

```md
# <Research Topic>

## Question

<The research question and what decision/artifact it informs.>

## Findings

- <Sourced fact or constraint.> Source: <URL or doc path>
- <Sourced fact or constraint.> Source: <URL or doc path>

## Inference

<Your synthesis, clearly marked as inference rather than source fact.>

## Recommendation

<The practical recommendation, if the sources support one.>

## Open Questions

- <Anything the sources did not settle.>
```

## Rules

- Use local project language from `CONTEXT.md` when naming repo concepts.
- Respect ADRs; do not re-litigate documented decisions unless the research explicitly calls them into question.
- Keep citations close to the claims they support.
- Do not store secrets, private credentials, or copied proprietary content in research notes.
- Keep quoted text short. Prefer paraphrase plus source link.
