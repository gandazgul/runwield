# Design It Twice

When the user wants to explore alternative interfaces for a chosen deepening candidate, use this parallel sub-agent
pattern. The first plausible interface is rarely the best one.

Uses the vocabulary in [SKILL.md](SKILL.md): **module**, **interface**, **seam**, **adapter**, and **leverage**.

## Process

### 1. Frame The Problem Space

Before spawning sub-agents, write a user-facing explanation of the problem space for the chosen candidate:

- The constraints any new interface would need to satisfy
- The dependencies it would rely on, and which category they fall into; see [DEEPENING.md](DEEPENING.md)
- A rough illustrative code sketch to ground the constraints, not a proposal

Show this to the user, then proceed to Step 2. The user can read and think while the sub-agents work in parallel.

### 2. Spawn Sub-Agents

Spawn 3 or more sub-agents in parallel. Each must produce a **radically different** interface for the deepened module.

Prompt each sub-agent with a separate technical brief: file paths, coupling details, dependency category, and what sits
behind the seam. The brief is independent of the user-facing problem-space explanation in Step 1. Give each agent a
different design constraint:

- Agent 1: minimize the interface; aim for 1-3 entry points and maximum leverage per entry point.
- Agent 2: maximize flexibility; support more use cases and future extension.
- Agent 3: optimize for the common caller; make the default case trivial.
- Agent 4, when applicable: design around ports and adapters for cross-seam dependencies.

Include both [SKILL.md](SKILL.md) vocabulary and `CONTEXT.md` vocabulary in the brief so each sub-agent names things
consistently with the architecture language and the project's domain language.

Each sub-agent outputs:

1. Interface: types, methods, params, invariants, ordering, and error modes
2. Usage example showing how callers use it
3. What the implementation hides behind the seam
4. Dependency strategy and adapters
5. Trade-offs: where leverage is high and where it is thin

### 3. Present And Compare

Present designs sequentially so the user can absorb each one, then compare them in prose. Contrast by **depth**,
**locality**, and **seam placement**.

After comparing, give your own recommendation. If elements from different designs would combine well, propose a hybrid.
Be opinionated: the user wants a strong read, not a menu.
