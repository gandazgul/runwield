---
name: runwield-workspace-journey-mapping
description: Use when mapping RunWield Workspace personas, journeys, UX gaps, polish priorities, or beta-user test scenarios for experienced developers doing real AI-assisted code changes.
---

# RunWield Workspace Journey Mapping

Map the Workspace as a working journey for an experienced developer, not as a generic UX exercise. The output must help
Planner or Ideator decide what to change next so beta users can trust RunWield on real code work.

## Core Lens

The Workspace must make four things clear:

1. What is happening now.
2. What the user can control.
3. What changed because of an agent or plan action.
4. Whether the work is safe enough to continue, hand off, or finish.

Treat confusion, hidden state, weak affordances, and trust breaks as product blockers.

## Workflow

1. **Name the user and job**
   - Identify the developer persona, project context, and real task.
   - State what success looks like in the user's words.
   - State what they already know and what they distrust.

2. **Trace the Workspace journey**
   - Entry point: how the user arrives and what they expect to do first.
   - Orientation: how they understand project state, active plan, agents, and available actions.
   - Planning flow: how they review, shape, split, approve, or reject work.
   - Workspace review/edit flow: how they inspect artifacts, changes, comments, decisions, and unresolved work.
   - Execution handoff: how they move from plan to code execution or agent work.
   - Feedback loop: how they see progress, intervene, recover, and iterate.
   - Completion/confidence moment: how they know the work is done enough to trust.

3. **Find friction**
   - Mark each point where the user gets confused, slowed, surprised, or forced to infer state.
   - Separate cosmetic polish from journey blockers.
   - Prefer observable friction: unclear labels, missing empty states, hidden status, weak hierarchy, no recovery path,
     stale context, duplicated concepts, or actions with unclear consequence.

4. **Find trust gaps** Check whether the journey answers:
   - Can I tell what happened?
   - Can I tell why it happened?
   - Can I control or revise the plan?
   - Can I recover from a mistake?
   - Can I see what the AI used as evidence?
   - Can I safely hand this to real code work?

5. **Turn gaps into a polish backlog**
   - **Must fix before beta:** blocks understanding, control, recovery, or confidence.
   - **Should fix soon:** slows experienced users but does not block the core path.
   - **Acceptable rough edge:** visible but tolerable if the value is clear.
   - Each item needs a concrete UI or copy change, not just a diagnosis.

6. **Define one dogfood scenario**
   - Write one realistic developer task that exercises the journey.
   - Include starting state, intended path, expected confidence moment, and failure signs.

## Output Format

Use this structure:

```md
# Workspace Journey: <persona + job>

## Persona

- Role / experience:
- Project context:
- Existing AI coding workflow:
- What they trust:
- What they distrust:

## Primary Job

- Task:
- Success in the user's words:
- Stakes if RunWield gets it wrong:

## Journey Map

| Stage             | User intent | Workspace surface/action | What must be clear | Friction / trust risk |
| ----------------- | ----------- | ------------------------ | ------------------ | --------------------- |
| Entry             |             |                          |                    |                       |
| Orientation       |             |                          |                    |                       |
| Planning          |             |                          |                    |                       |
| Review / edit     |             |                          |                    |                       |
| Execution handoff |             |                          |                    |                       |
| Feedback loop     |             |                          |                    |                       |
| Completion        |             |                          |                    |                       |

## Friction Points

1. <specific friction>
   - Evidence or reason:
   - User impact:
   - Fix direction:

## Trust Gaps

- <question the Workspace fails to answer> → <effect on confidence>

## Polish Backlog

### Must fix before beta

- <specific change> — <why it matters>

### Should fix soon

- <specific change> — <why it matters>

### Acceptable rough edges

- <rough edge> — <why it can wait>

## Dogfood Scenario

- Starting state:
- Developer task:
- Intended path:
- Expected confidence moment:
- Failure signs:
```

## Quality Bar

A good journey map is specific enough that another agent can turn the top backlog item into a Plan without redoing
discovery.

Do:

- Anchor every point in an experienced developer's real workflow.
- Prioritize trust, control, continuity, and recovery over visual novelty.
- Use Workspace terminology from the current product when available.
- Preserve uncertainty: label assumptions when the current UI or user evidence is missing.

Do not:

- Produce generic personas like "busy developer" without a real task.
- Treat marketing-page feedback as Workspace UX evidence.
- Recommend broad redesigns when a smaller journey fix would unblock beta use.
- Hide weak evidence behind confident product language.

## Final Check

Before finishing, verify the output answers:

1. Who is this for?
2. What real code-work job are they doing?
3. Where does the Workspace journey lose clarity, control, or trust?
4. What should be fixed first?
5. How will we dogfood that journey?
