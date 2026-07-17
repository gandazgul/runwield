---
planId: "4c9c9710-739b-402d-8495-e53be5d1dd5f"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Recognize empty project directories at startup and provide greenfield guidance instead of normal init/banner behavior."
affectedPaths:
    - "src/shared/project-state.js"
    - "src/shared/project-state.test.js"
    - "src/shared/interactive/chat-session.js"
    - "src/shared/interactive/chat-session.test.js"
    - "src/shared/session/SYSTEM_PROMPT_TEMPLATE.md"
    - "src/shared/session/session.js"
    - "src/shared/session/session-prompt.test.js"
    - "src/cmd/init/index.js"
    - "src/cmd/init/index_test.js"
frontend: false
createdAt: "2026-07-02T16:09:00-04:00"
updatedAt: "2026-07-17T04:42:13.432Z"
status: "verified"
origin: "internal"
verifiedAt: "2026-07-03T03:28:31.455Z"
workRecord:
    status: "generated"
    recordId: "9a678b00-6f99-48dc-9242-73ca8ae416e5"
    path: "docs/work-records/2026-07-17-empty-project-directory-startup-ux.md"
    lastAttemptAt: "2026-07-17T04:42:05.810Z"
humanReviewMode: "ask"
humanReviewDecision: "approved"
humanReviewedAt: "2026-07-03T03:28:28.706Z"
---

# Empty Project Directory Startup UX

## Context

RunWield currently treats an empty folder like an uninitialized brownfield repository: it can show the normal
loaded-assets boot banner and offer `/init`. That is misleading because there are no meaningful project files to inspect
yet. The requested behavior is to recognize an **Empty Project Directory** as greenfield context, guide the user without
blocking, and preserve normal `/init` behavior for later once meaningful files exist.

Product choices are already sourced from prior decisions for this feature:

- Empty means no non-dot-prefixed, non-zero-size files are present; dot-prefixed files/folders, empty visible folders,
  and zero-byte visible files do not count as project context.
- Interactive `wld` with no initial user request should show a bright, non-blocking greenfield hint and suppress the
  loaded-assets boot banner plus normal `/init` offer.
- `wld "..."` from an empty directory should route normally without showing the hint, but the session should still carry
  empty-directory context.
- `/init` / `wld init` in an Empty Project Directory should be a no-op that does not record `initOffered` or `initDone`.

## Objective

Add first-class Empty Project Directory startup behavior:

- Detect empty project directories by looking for meaningful files, not folders.
- On interactive `wld` with no initial user request, suppress the normal boot banner and `/init` offer, then show a
  bright non-blocking guidance message.
- Keep `wld "..."` from an empty directory routing normally without showing the welcome hint.
- Give normal interactive agents a concise session-scoped greenfield context note, preserved across root-agent rebuilds
  and handoffs.
- Make `/init` / `wld init` in an Empty Project Directory explain that there is nothing to initialize yet without
  recording init as offered or done.

## Approach

Create a small shared project-state module that detects whether a directory contains any meaningful project file. A
meaningful file is a non-dot-prefixed, non-zero-size file reachable through non-dot-prefixed path segments; empty
folders and dot-prefixed files/folders are ignored.

At interactive startup, compute whether the session began in an Empty Project Directory. Use that session-start fact to:

1. replace the normal boot banner with a bright empty-directory hint only when there is no initial request,
2. skip the current init auto-offer while the directory is empty,
3. inject a simple greenfield note into normal agent system prompts for that session.

Thread the prompt note through the session-building path rather than individual agent definitions. Because
`ensureRootAgentSession()` is reused for initial root builds, root swaps, model changes, and reloads, persist the note
in session state or root metadata and explicitly preserve it during root-agent rebuilds.

For `/init`, perform the same empty-directory check after help parsing and before duplicate-init/init-state writes. If
empty, print a clear no-op message and return without updating init state.

## Files to Modify

- `src/shared/project-state.js` — new shared Empty Project Directory detector plus reusable guidance/message constants
  or builders.
- `src/shared/project-state.test.js` — new tests for meaningful-file detection boundaries and non-crashing
  transient/unreadable entries where practical.
- `src/shared/session/session-state.js` — store the session-scoped project-state prompt context, or extend pending/root
  metadata types so root swaps can preserve it.
- `src/shared/interactive/chat-session.js` — compute the session-start empty-directory state, suppress boot banner/init
  offer when appropriate, render bright guidance, and preserve/pass the greenfield note into root-agent session
  construction and rebuild paths.
- `src/shared/interactive/chat-session.test.js` — verify startup decisions and context preservation helpers without
  requiring a full live model turn.
- `src/shared/session/SYSTEM_PROMPT_TEMPLATE.md` — add a placeholder for session/project-state context near Project
  Context.
- `src/shared/session/session.js` — resolve the new placeholder from an optional session parameter; carry the parameter
  through `buildAgentSession()`, `ensureRootAgentSession()`, `runAgentSession()`, `runRootTurn()` rebuilds, root
  metadata, and reload/model-rebuild paths.
- `src/shared/session/session-prompt.test.js` — verify the note is included when provided and absent otherwise.
- `src/cmd/init/index.js` — short-circuit init in an Empty Project Directory before `isInitDone()` /
  `recordInitOffered()` and add a test dependency for the detector.
- `src/cmd/init/index_test.js` — verify empty init reports the no-op message and does not record offered/done state.

## Reuse Opportunities

- `src/shared/interactive/chat-session.js` — reuse the existing startup placement around `renderBootBanner()` and the
  existing init auto-offer branch; avoid introducing a second startup UI path.
- `src/shared/ui/api.js` — reuse `appendSystemMessage(text, isError, header, style)` with a brighter heading/body style
  instead of adding a new UI primitive.
- `src/shared/session/session.js` — reuse `assembleFinalSystemPrompt()` placeholder resolution rather than editing
  individual agent definitions.
- `src/shared/session/session-state.js` — reuse centralized interactive state for the session-scoped prompt note if that
  is the least invasive way to preserve context across root-agent swaps.
- `src/cmd/init/init-state.js` — keep existing state writes unchanged; avoid calling them for empty-directory no-op.

## Implementation Steps

- [ ] Add `isEmptyProjectDirectory(cwd)` in `src/shared/project-state.js`.
  - Recursively inspect entries under the provided `cwd` using runtime paths, not the module-level `CWD` constant.
  - Ignore entries whose relative path contains a dot-prefixed segment.
  - Return `false` as soon as a non-dot-prefixed regular file with `size > 0` is found.
  - Treat empty visible directories, zero-byte files, dot-prefixed files/folders, broken symlinks, unreadable entries,
    and transient race failures conservatively without crashing startup. Do not follow directory symlinks into cycles.
- [ ] Export shared text constants/builders from `project-state.js`:
  - Header: `Empty directory detected`
  - Welcome body:
    `Tell RunWield what you’d like to build. You can ask for a specific kind of project, ask “help me choose a tech stack,” or ask “help me sharpen my idea for this project.”`
  - Prompt note:
    `This RunWield session began in an Empty Project Directory. Treat this as greenfield work: there is no existing project architecture, conventions, validation command, or real Router-provided affected paths yet. When tech stack, product shape, or goals require a clear choice, defer to the user rather than inventing one.`
  - Init no-op body:
    `Nothing to initialize yet. This directory has no project files for RunWield to inspect. Add files or describe what you want to build; once the project has meaningful files, RunWield can initialize project context.`
- [ ] Add `src/shared/project-state.test.js` coverage:
  - truly empty directory => empty,
  - only `.git`, `.wld`, `.vscode`, `.DS_Store` => empty,
  - empty visible folder => empty,
  - zero-byte visible file => empty,
  - non-empty `README.md` => not empty,
  - non-empty nested visible file like `src/main.js` => not empty,
  - non-empty file under a dot-prefixed segment like `.cache/generated.txt` => empty.
- [ ] In `startInteractiveSession()`, compute
      `sessionStartedEmptyProjectDirectory = await isEmptyProjectDirectory(Deno.cwd())` once before startup
      banner/init-offer logic; failures should degrade to normal non-empty behavior with no user-facing crash.
- [ ] If the session started empty, set a session-scoped project-state prompt context before the root session can be
      built. Ensure model-welcome-triggered root builds and normal eager root builds both receive it.
- [ ] If `sessionStartedEmptyProjectDirectory && !initialUserRequest`, suppress the normal loaded-assets boot banner and
      render the bright non-blocking message with `appendSystemMessage()`:
  - Header: `Empty directory detected`
  - Body: shared welcome body above
  - Use a bright/accent heading/body style consistent with existing theme tokens.
  - Do not mention `/init` in this welcome message.
- [ ] If `sessionStartedEmptyProjectDirectory`, skip the current `/init` auto-offer entirely and do not call
      `recordInitOffered()`.
- [ ] Add a `{{PROJECT_STATE_CONTEXT}}` placeholder to `SYSTEM_PROMPT_TEMPLATE.md`, preferably under
      `## Project Context` before `{{PROJECT_AGENTSMD}}`.
- [ ] Update `assembleFinalSystemPrompt()` to accept an optional project-state context string and replace
      `{{PROJECT_STATE_CONTEXT}}` with either a small section containing that string or an empty string.
- [ ] Thread `projectStateContext` through session construction:
  - update JSDoc typedefs/param blocks in `session.js` without TypeScript syntax,
  - pass it from `buildAgentSession()` into `assembleFinalSystemPrompt()`,
  - store it in root metadata in `ensureRootAgentSession()`,
  - preserve it in `runRootTurn()` when rebuilding for missing custom tools,
  - preserve it in `reloadRootAgentSession()` and `setActiveModel()` root rebuilds,
  - preserve it for pending root swaps/handoffs via `chat-session.js` and/or `session-state.js`.
- [ ] Keep the prompt note session-scoped: if files are created later in the same session, do not remove the note from
      already-created or rebuilt root sessions.
- [ ] Update `runInitCommand()` to check `await isEmptyProjectDirectory(cwd())` after help parsing and before
      `isInitDone()` / `recordInitOffered()`.
- [ ] Add an `isEmptyProjectDirectory` test dependency to `CommandDependencies` so init tests can force empty/non-empty
      behavior without filesystem coupling.
- [ ] For empty init, print/append the shared no-op message. In CLI mode use the existing console path (`console.warn`
      is acceptable for consistency with duplicate init); in TUI mode use `options.uiAPI.appendSystemMessage()`.
- [ ] Verify empty init does not call `recordInitOffered()`, `recordInitDone()`, load the init agent definition, or run
      an init agent session.

## Verification Plan

- Automated: run `deno run ci`.
- Targeted tests before full CI:
  - `deno test src/shared/project-state.test.js`
  - `deno test src/cmd/init/index_test.js src/shared/session/session-prompt.test.js src/shared/interactive/chat-session.test.js`
- Manual checks:
  - Start `wld` in a directory containing only dotfiles/dotfolders and empty visible folders: bright empty-directory
    hint appears; normal loaded-assets boot banner and init offer do not.
  - Start `wld "help me choose a tech stack"` in the same empty directory: no welcome hint appears; Router receives the
    request normally with empty-directory context in its system prompt.
  - Run `wld init` in an empty directory: no-op message appears; init state is not recorded.
  - Add a non-empty `README.md`, start `wld`: normal uninitialized project behavior returns and `/init` can be offered.
  - During an empty-directory interactive session, switch agents or change model: rebuilt root agent prompt still
    includes the greenfield note.

## Edge Cases & Considerations

- The empty-directory state should be captured at session start for agent prompt context, so later file creation during
  the same greenfield session does not erase the fact that the session began without brownfield context.
- `/init` is not session-scoped; it should evaluate the current filesystem each time. If meaningful files are added
  after an empty no-op, normal init can be offered/run because no init state was recorded.
- Router-provided `affectedPaths` should remain real existing paths; in an Empty Project Directory it should be empty
  until files exist.
- Planning artifacts may still refer to files intended to be created.
- Avoid following symlinked directories during empty detection to prevent cycles and surprising traversal outside the
  project root.
- Do not create a project generator wizard. The hint should guide the user to provide intent, ask for stack help, or
  sharpen the idea.
- Keep the welcome message non-blocking; no modal/select prompt.
