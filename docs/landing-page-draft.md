# RunWield landing page draft

## Working positioning

RunWield is for experienced developers using AI agents on real codebases, where "looks right" is not good enough.

It gives the work a durable shape: a request becomes a reviewed plan, the plan executes in a controlled workflow,
validation has a record, and the outcome feeds future planning instead of disappearing into chat history.

## Homepage copy

### Hero

**AI coding agents are fast. The hard part is staying in control.**

RunWield turns agent work into reviewed plans, verified changes, and durable project records. It is built for developers
making non-trivial changes with Claude Code, Codex, OpenCode, Pi, and other agent workflows.

If your current AI workflow is a long chat, a pile of diffs, and a vague feeling that you should reread everything,
RunWield is the missing workflow layer.

**Primary CTA:** Request beta access\
**Secondary CTA:** See how it works

### Beta qualifier

RunWield is currently looking for experienced developers using AI agents on real projects. The beta is a fit if you:

- use coding agents for more than autocomplete;
- work on codebases where architecture, tests, and review actually matter;
- want plans, validation, and handoffs to survive beyond one chat session;
- are willing to give direct feedback on where the workflow helps and where it gets in your way.

It is probably not a fit yet if you only want a hosted chatbot, a generic task tracker, or a way to skip reviewing agent
output.

### Problem

AI coding tools can produce a lot of code quickly. They are much worse at preserving intent.

A typical agent session starts with a reasonable request, drifts through implementation details, and ends with a diff
you now have to audit from scratch. The plan may be buried in transcript history. The review notes may live in your
head. The next agent turn may forget the decisions that mattered.

That breaks down fastest on the work experienced developers actually care about: multi-file refactors, lifecycle
changes, test strategy, architecture seams, and changes that need careful validation.

### What RunWield does

RunWield adds a planning and review loop around AI-assisted development.

1. **Shape the request into a plan.**\
   RunWield routes the request, captures the intended change, and stores the plan as a real project artifact.

2. **Review before execution.**\
   You can approve, revise, or hold the plan before the agent starts changing code. The plan is not just chat context.
   It becomes the workflow contract.

3. **Execute with lifecycle state.**\
   RunWield tracks execution, validation, recovery, and review state instead of treating the session as one disposable
   conversation.

4. **Keep the useful memory.**\
   Completed work produces durable records that help future planning. The important lessons live with the project, not
   inside a transcript nobody will reread.

### Why developers use it

**You keep agency.**\
RunWield does not ask you to trust an agent blindly. It creates explicit checkpoints where you can review the plan,
inspect the change, and decide what happens next.

**The plan survives the chat.**\
Plans, PRDs, ADRs, and Work Records are ordinary project artifacts. They can be reviewed, changed, resumed, archived,
and used later.

**The workflow fits real changes.**\
RunWield is designed for changes that need review and validation, not just one-shot code generation.

**It works with the agents you already use.**\
Use RunWield Core locally through `wld`, use RunWield Connect from external agent hosts, or use Workspace to review and
continue work in the browser.

### Product surfaces

#### RunWield Core

A local CLI workflow for plan-first AI development. Core owns the plan lifecycle, validation loop, work records, and
local project truth.

#### RunWield Connect

Plugins for external agent hosts. Invoke RunWield workflows from tools like Claude Code, Codex, OpenCode, and Pi while
the host keeps the conversation and model access.

#### RunWield Workspace

A browser workspace for reviewing plans, continuing sessions, tracking project attention, and managing workflow state
across real projects.

Workspace is early, but it is the direction of the product: a practical home for AI-assisted software work that needs
more structure than chat.

### Example flow

You ask for a non-trivial change.

RunWield turns the request into a plan and shows the parts that need approval. You tighten scope, reject weak
assumptions, and approve the version you actually want built.

The agent executes against that plan. RunWield records what happened, runs validation, sends failures through repair
when appropriate, and keeps the plan state honest.

When the work is done, the project gets a Work Record. Next time, the agent can use the useful outcome instead of
guessing from scratch.

### What this is not

RunWield is not trying to be a faster autocomplete tool.

It is not a generic agent dashboard where every bot conversation becomes another thing to babysit.

It is not a replacement for engineering judgment. The point is to make that judgment easier to apply before, during, and
after agent work.

### Beta CTA

**Want to try it on a real codebase?**

RunWield is accepting a small number of beta users who already use AI coding agents and are willing to test the workflow
on meaningful changes.

Tell us what you are building, which agents you use today, and what kind of changes you would want RunWield to handle.

**CTA:** Request beta access

Suggested form fields:

- Name
- Email
- GitHub or personal site
- What AI coding tools do you use now?
- What kind of codebase would you test RunWield on?
- What is one recent AI-assisted change that was painful to review, validate, or continue?

## Short alternatives

### One-line description

RunWield is the planning, review, and validation layer for serious AI-assisted software work.

### Tighter hero option

**Make AI coding agents work like part of your engineering process.**

RunWield turns agent requests into reviewed plans, validated changes, and project records that survive beyond the chat.

### More pointed hero option

**Stop treating agent output like magic. Review the plan, control the work, keep the record.**

RunWield gives experienced developers a structured workflow for non-trivial AI-assisted code changes.

## Notes for revision

This draft intentionally avoids broad claims like "10x productivity" or "autonomous engineering." The sharper beta
promise is control, continuity, and better review for developers already pushing AI agents into serious work.

The next revision should decide whether the public page leads with:

1. local Core first, because it is available now;
2. Workspace first, because it is the startup product direction;
3. beta-user pain first, with product surfaces introduced lower on the page.

My recommendation: lead with the pain and beta fit, then show Core/Connect/Workspace as the concrete product path.
