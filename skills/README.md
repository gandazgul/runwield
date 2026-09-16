# Installable skills

Generic versions of two RunWield Agents, published for any coding agent in any project:

```bash
npx skills@latest add gandazgul/runwield
```

| Skill                           | Derived from                       |
| ------------------------------- | ---------------------------------- |
| [`ideator`](./ideator/SKILL.md) | `src/agent-definitions/ideator.md` |
| [`guide`](./guide/SKILL.md)     | `src/agent-definitions/guide.md`   |

The Agent Definition owns the wording. A skill is the same document with the parts that only make sense inside RunWield
removed: the product name, Agent handoffs, RunWield tool names, prompt template variables, and RunWield-only artifacts.
Nothing else changes. When the skill needs a capability the Agent calls a tool for, it describes the capability instead
of naming the tool, because the installing project has its own.

## Keeping a pair in sync

`deno task skills:sync:check` records the hash of both files in `scripts/skill-sync-baseline.json` and fails when either
side moves without the other. It runs in `deno task ci`.

1. Edit whichever file you meant to edit.
2. Carry the change to the other one.
3. `deno task skills:sync:update` to accept the pair.

The same check rejects a skill that still names RunWield, an Agent, or a RunWield tool.

## Keeping our own skills out of an install

The [skills CLI](https://github.com/vercel-labs/skills) offers every skill it finds in a skill container directory,
including the ones under `.agents/skills/` that this repository vendored for its own use. Those opt out with front
matter:

```yaml
metadata:
    internal: true
```

`deno task skills:sync:check` fails when a skill is neither listed in the baseline nor marked internal, so nothing
reaches an installer by accident.
