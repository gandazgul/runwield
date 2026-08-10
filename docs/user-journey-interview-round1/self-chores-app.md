# Self interview about RunWield's readiness - Chores App

## Outline

Ideator → resolves the product direction → writes the PRD Router → recognizes a PROJECT Architect → creates the MVP Epic
Slicer → turns the Epic into ordered vertical slices Planner → makes the first slice executable Engineer → implements it
Validation → proves the result Recorder → preserves the learning

## Interview Questions

Ideator session conducted with claude/opus 5

Prompt:
`what would you say is left to do in this app, read the docs and ask me about the product vision to organize the work needed for the gap.`

### Did Ideator find contradictions without your help?

yes, e.g. after I mentioned how tasks are assigned and claimed, I used parent->child as an example. Ideator said this:

```text
The question

You said parent → child. That's the first mention of children as users, and it's upstream of everything else in P1.

If kids are real users, three things follow. Google-only sign-in becomes a practical problem — a young kid signing into a Google account on a shared tablet is real friction, and you'd need local accounts,
which is auth work this app has never done. Roles become real: a parent assigns to a child, and the child probably shouldn't be able to reassign it to a sibling or delete it — which reintroduces exactly the
authority asymmetry we just simplified away. And completion gets contested: a kid marks "cleaned my room," and you may want a parent to confirm before the nag stops.

If "parent → child" was just shorthand for anyone can assign to anyone between adults, P1 stays lean: persist users, invite gate, assignee, done.

My recommendation: if kids are in scope, keep roles out of the data model for now and rely on social trust — a shared household app where everyone is technically equal is far simpler, and "my kid maliciously
reassigned a chore" is a social problem, not a permissions one. But add local (non-Google) accounts to P1, because that one is a hard blocker on kids using it at all.

Are children actual logged-in users of this app, or is every account an adult and "parent → child" just describes who assigns to whom?
```

### Did it ask questions that changed your thinking?

The first one:

```
So: is this a shared household app where you assign chores to other real people who log in and get their own nags — or is it fundamentally a personal app for you, where "assigning" is at most a label and every
notification goes to you?
```

### Did it distinguish implemented truth from proposed product direction?

yes, sometimes with some nudging required

### Did the PRD capture your intent accurately?

Asked first for a roadmap. Then pivot to product direction questions.

yes, it does, and honestly, Ideator helped me refine what the product is and how it should behave.

### Did the handoff preserve the important context?

Didnt handoff unfortunately got interrupted by Claude's 5h limit had to switch to Kimi and decided to use a new session.
but architect was able to pick up all the context from the Ideator produced artifacts and commented on how detailed they
were.

### Did Architect produce a coherent product-level Epic?

### Did Slicer create customer-visible vertical slices?

### Could you redirect the roadmap through review annotations?

### Did the first slice move from approval to verified outcome?

### Did its Work Record make the next planning step better?
