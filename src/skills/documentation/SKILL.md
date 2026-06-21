---
name: documentation
description: Creates and updates Markdown project documentation, including READMEs, API docs, user guides, ADRs, and plan-required documentation changes. Use when the user requests docs work, a FEATURE step mentions documentation, or code changes require user/developer-facing docs updates. Do not use for non-Markdown implementation or test work.
---

# Documentation

Use this skill to create or update project documentation accurately from source, in the project's existing voice.

## Workflow

1. **Confirm scope**
   - Identify the requested document, section, audience, and purpose.
   - If the request is part of a broader code change, keep docs changes within that assigned scope.
   - Only write Markdown (`.md`) files unless the user explicitly routes a non-docs implementation task outside this
     skill.

2. **Discover source and conventions**
   - Read the relevant implementation code, existing docs, plans, ADRs, or examples before drafting.
   - Match the repository's terminology, heading style, tone, command formatting, and linking conventions.
   - Check project glossary/context files when they exist; use canonical terms.

3. **Draft the docs**
   - Prefer focused edits over broad rewrites.
   - Organize content around reader tasks and decisions, not internal implementation chronology.
   - Include practical examples only when they are supported by the current source.
   - Avoid inventing APIs, file paths, commands, defaults, or behavior.

4. **Verify accuracy**
   - Re-read the changed docs against source code and existing docs.
   - Verify code samples, command examples, option names, file paths, settings keys, and API references.
   - If source behavior is ambiguous or contradictory, document only what is known and report the ambiguity in the final
     summary.

5. **Complete multi-item requests**
   - If the prompt names multiple documents or sections, check each one before finishing.
   - Summarize what changed and call out any docs intentionally left untouched.

## Quality bar

- Documentation is concise, precise, and maintainable.
- Headings create a navigable structure.
- Links and paths are repo-relative when possible.
- Examples are minimal and copy-pasteable when appropriate.
- The docs explain user-visible behavior and operational consequences, not every implementation detail.
