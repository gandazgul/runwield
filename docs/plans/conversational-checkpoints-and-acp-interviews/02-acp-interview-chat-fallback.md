---
planId: "8acc37a5-f9ad-4ec3-b093-315bbbe7b180"
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "HIGH"
affectedPaths:
    - "src/acp/server.js"
    - "src/acp/session-map.js"
    - "src/acp/interaction-mapper.js"
    - "src/acp/server.test.js"
    - "src/shared/session/session-runtime.js"
    - "src/shared/session/session-runtime-interactions.js"
    - "src/tools/user-interview.ts"
    - "docs/prd/runwield-acp-protocol-prd.md"
    - "docs/acp-implementation-details.md"
tickets:
    - url: "https://github.com/openabdev/openab/pull/1533"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-09-20"
origin: "internal"
parentPlan: "conversational-checkpoints-and-acp-interviews"
order: 2
dependencies:
    - "01-conversational-pair-checkpoints"
userVerifiedAt: null
targetBranch: "main"
status: "validated"
validatedCommit: "43bfd8b503357a8a648dd04ffa276367a8ce1a76"
---

# Answer ACP Interviews in Chat Without Native Forms

## Context

OpenAB did not merge the referenced form-elicitation PR. RunWield currently uses native `elicitation/create` when
advertised; otherwise `interaction-mapper.js` opens a loopback browser question and waits. That fallback is not useful
for a remote chat user without access to the local browser. Keeping the ACP request open also prevents an ordinary
follow-up from reaching the waiting tool.

The owner chose this scope: native forms stay preferred; only `user_interview` gets a new ACP text fallback. A number or
exact label selects a choice. Any other meaningful reply becomes Other with the user's text. The model decides what it
means or whether to ask a further question. The parser must not repeatedly ask for a reformatted answer.

Owning [ACP negotiation and interactions](../../prd/runwield-acp-protocol-prd.md#protocol-negotiation-and-interactions)
requirement, **Negotiate capabilities and settle interactions truthfully**: change the no-form interview fallback from
local browser to ordinary chat. Preserve native forms, cancellation settlement, multiple-choice labels, Other text, and
explicit handling of unsupported non-interview interactions. Update affected references in
[reference-client portability](../../prd/runwield-acp-protocol-prd.md#reference-client-portability) and the chat
journey: this interview path no longer needs an OpenAB contribution branch. Do not claim the whole Telegram workflow,
remote review access, or full ACP conformance is proven by this feature.

Child 1 supplies conversational Pair. This child does not turn command menus, approvals, recovery decisions, or browser
reviews into model questions. `/agent` and model menus retain exact selections and their current presentation fallback.

## Objective

An unmodified ACP client with no form capability can display and answer a complete `user_interview` through normal chat
messages. The original tool returns the same ordered, typed answers to its waiting model. No OpenAB patch, local
question page, extra answer-interpreting model call, or custom client protocol is required.

## Approach

Preserve the existing tool await and interaction broker. Separate the lifetime of an ACP `session/prompt` request from
the lifetime of the Runtime operation. Do not restart the model or complete the interview with fabricated answers.

```text
ACP prompt A -> one Runtime operation -> user_interview -> question 1
  -> send readable question; finish ACP request A with end_turn
  -> Runtime operation and tool remain waiting
ACP prompt B (answer) -> existing interaction answer callback
  -> next question: finish B after delivering it
  -> or interview completes: same model continues; finish B after Runtime settles
```

This differs from Pair: a Pair checkpoint commits and ends the Runtime operation; an interview still has one live tool
await. Its Session Writer Lock remains held, as with existing native/browser forms, until completion or cancellation.
This is process-local continuation, not a durable suspended tool. Process loss requires retry under existing recovery.

### Transport ownership

Use a small ACP-owned operation coordinator, colocated with or extracted from `server.js`. It owns the Runtime promise,
subscription, current runtime Session mapping, pending interview, and notifications. `AcpSessionMap.activePrompt`
remains request-scoped. Attach each new answer request before resolving the question, because a batch can immediately
ask the next question. Do not release the operation subscription or adapter when finishing only a question's ACP
request.

Keep release-after-response ordering from `startRunWieldAcpServer`/`releasePromptsAfterResponses`. A response-flushing
request is still active. An old request's cleanup must never release a successor request or its continuing operation.
Use a defined notification flush boundary rather than a growing-array snapshot that can omit the question.

Route pending interview replies before slash dispatch, normal prompt conversion, and the operation-busy path, but after
checking for a still-active ACP request. An interview reply is not a new Agent turn or a queued follow-up. Native
`session/set_config_option` cannot change the model during the retained operation merely because `activePrompt` is null.

The broker already owns active interaction IDs and answer callbacks. Expose a narrow Runtime answer method if needed; it
must call that existing callback, not create another answer authority. Another surface can win the answer race; an
adapter abort then means its presentation lost, not necessarily that the user canceled.

Current OpenAB removes its prompt subscriber after each response. If an existing other surface answers while no ACP
request is attached, retain the resulting undelivered updates for the next request in connection-local operation state.
Do not silently lose them, send a second response to the old request, or consume a reply for a question not yet
delivered. On that next request, deliver any newer question first; if the operation has settled, flush its updates and
process the new message through the normal path. Clear this temporary state with the connection, not a new persistence
system.

### Fallback selection and answer rules

`createAcpInteractionAdapter` selects chat only when form support is absent and the SELECT/TEXT request has
`_meta.source === "user_interview"`. The existing tool sets this marker for choices, text, and Other follow-ups.

| Reply                                                     | Result                                                   |
| --------------------------------------------------------- | -------------------------------------------------------- |
| Whole displayed number, such as `2`                       | That option's canonical value                            |
| Exact unambiguous label                                   | That option's canonical value                            |
| Any other nonblank text, including `1, but include tests` | Other plus the complete substantive reply                |
| Exact Other option without explanation                    | Existing free-text follow-up, not an invalid-choice loop |
| Text-question reply                                       | Text answer using the existing interview text rules      |

Trim boundary whitespace for matching and accept case-insensitive labels. Show recommendation notes separately so labels
remain clear. Preserve internal whitespace, multiline content, qualifiers, and punctuation in Other/text results; do not
summarize or silently drop the user's conditions. Keep existing boundary-whitespace normalization unless needed for
correctness. Never fuzzy-match prose to a listed option. Duplicate labels are not a unique choice: use Other rather than
pick the first. Numbers remain unambiguous.

Send prompt, numbered labels, recommendation if any, and a short “Reply with a number or write your answer” instruction
as ordinary text. No metadata is required to read or answer. Sequential batches remain sequential and return ordered
answers. Defaults are suggestions, never submitted answers.

While a question is pending, slash-looking text is answer text, not a command. Protocol cancel/close remains available.
Empty required answers and replies consisting of unsupported attachments leave the question available and explain the
input requirement; they do not turn into a default answer. Do not silently discard attached content. Native forms and
non-interview browser questions keep their existing contracts.

A simple “ask again in prose” tool result was set aside: it would lose the original structured result and tool
continuation. General conversational conversion for all menus was also set aside by the owner.

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint
during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report
only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture
shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

- `src/acp/server.js`, `session-map.js`, and an ACP-local coordinator/parser — separate request/operation lifetimes,
  formatted questions, answer routing, ordered output, and cleanup.
- `src/acp/interaction-mapper.js` — native-first interview-only fallback; other interaction paths stay intact.
- `src/shared/session/session-runtime.js` and interaction broker tests — use the existing authoritative answer callback
  without exposing HostedSession internals or weakening managed-operation exclusion.
- `src/tools/user-interview.ts` and its tests — preserve ordered result, Other text, and cancellation through the new
  transport. Avoid an ACP dependency in Core/tools.
- ACP stdio, adapter, cancellation, and managed-session tests — real question/reply round trips and race checks.
- `docs/prd/runwield-acp-protocol-prd.md`, `docs/acp-implementation-details.md`, ADR-010/015, and
  `docs/domain-language.md` — document native-first selection, the request/operation distinction, and the process-local
  pending interview. Do not redefine a live interview as durable or change the committed Pair semantics from child 1.

## Reuse Opportunities

- `user_interview`'s `otherOptionValue`, `otherText`, metadata, and existing batch loop — no new question model.
- `requestHostedSessionInteraction` and HostedSession active-interaction callbacks — one winner, existing cancellation.
- `releasePromptAfterResponse`, event mapping, Session replacement, and managed-operation cleanup — retain their
  ordering and identity protections while separating the two lifetimes.
- `withRuntimeCommandFixture`, scripted provider messages, stdio harness, and `createHeldOutput` — exercise real
  protocol boundaries without injecting replacements for RunWield-owned machinery.

## Implementation Steps

1. ACP request ownership is separate from retained operation ownership. An interview question is delivered before its
   request ends; the operation's subscription/adapter stay live. The next answer attaches a new request before the
   broker is resolved. Normal requests and child 1's settled Pair turns retain their normal operation lifetime.
2. The adapter uses native forms when supported, otherwise readable chat for interview SELECT/TEXT only. Matching rules
   produce canonical choices or Other text, without an extra model call or invalid-choice loop for meaningful prose.
3. Real `user_interview` calls complete one-, two-, and three-question batches through successive ACP prompts, including
   yes/no, Other follow-ups, and text. Their original ordered result reaches the waiting model; replies are not also
   submitted as new turns. Completed question/answer content remains readable in saved tool history.
4. Cancellation, close, disconnect, failed output, and Runtime settlement clear the correct pending wait and operation.
   Cancellation between ACP requests still reaches Runtime. During cancellation no replacement interview can reopen.
   Final mapped updates precede a cancelled response when one is attached. No stale answer resumes a settled tool.
5. Existing remote answers, Session replacement, and response-write races cannot lose a question, answer twice, or clear
   newer state. Duplicate load of an already mapped Session is rejected before side effects. Model controls stay blocked
   for the retained operation. Notifications produced between requests remain available as described above.
6. Owning ACP requirements, acceptance scenarios, audit, ADRs, and glossary reflect the implemented scope and
   limitations. Remove the interview's dependency on an upstream OpenAB merge while preserving unmet broader chat/review
   journeys. Keep non-interview local browser fallback, command validation, and native form requirements explicit.

## Approval Confirmation

No Work Record supersession is proposed. The linked PR is the user's external demand reference; this Plan neither
updates that PR nor depends on its merge. Native-first behavior, permissive Other text, and interview-only scope were
confirmed in this planning Session.

## Verification Plan

```sh
deno run -A scripts/run-tests.js src/acp/server.test.js src/acp/interaction-mapper.test.js src/acp/managed-session.integration.test.ts src/tools/__tests__/user-interview.test.js src/tools/__tests__/user-interview-combinations.test.js src/shared/session/session-runtime.test.js src/shared/session/managed-operation-boundary.test.ts
deno task seams:check
deno task ci
```

Include new coordinator/parser tests in the focused run. Use the sandboxed runner, not direct `deno test`.

- **Decisive wire test:** initialize with `{}` capabilities, have a scripted provider call the real `user_interview`,
  observe the numbered question and completed ACP response before sending the answer. Send `1`, an exact label, and
  multiline qualifying prose in separate cases. Inspect the subsequent provider request/tool result for canonical choice
  or Other text. Assert no question URL, elicitation request, second runtime operation, or extra model turn for parsing.
  A stub parser, browser fallback, or tool returning unanswered cannot pass this test.
- **Batch/Other:** complete three mixed questions in order through distinct prompt requests. Bare Other gets one text
  follow-up; a full free-text answer gets none. `1, but include tests` preserves its qualification as Other. Duplicate
  labels, out-of-range numbers, and slash-looking prose reach Other. Required blank/unsupported-content replies do not
  consume the question. Defaults never answer for the user.
- **Native preservation:** capability `{ elicitation: { form: {} } }` still emits the standard schema, inline Other
  field, and original cancel/decline/invalid-response behavior. No text interception replaces native forms.
- **Scope preservation:** bare `/agent` and model/settings/workflow selections without native support still follow the
  current browser path and reject invalid choices. Browser Plan/code review remain unchanged. Child 1 Pair still commits
  and ends its Runtime operation rather than using this live-interview continuation.
- **Ordering:** use held output to delay the question response. An overlapping answer cannot enter early; after response
  release it succeeds. Cover request ID `0`, successive questions arriving immediately, and old cleanup after a new
  request attaches. Verify question notifications precede each response and each request gets one response.
- **Lifecycle:** cancel both with and without an attached prompt, including Other follow-up; close/disconnect with a
  pending interview; force output failure; inject provider failure after an answer. Assert Runtime settlement, released
  Session lock, no active interaction or leaked listener, and a usable next Session turn where the connection remains.
- **Other-surface race:** answer the same interaction through the real local connection while ACP is between requests.
  The broker accepts once; the next ACP request receives pending output/new question, not an invented answer or lost
  model result. Repeat with Session replacement and no request attached at operation settlement.
- **Recovery:** after the process ends with an unanswered question, loading the same saved Session does not fabricate a
  completed interview or resume a vanished Promise. Saved history remains available and retry follows existing recovery.
- **Manual:** run a pinned, unmodified OpenAB version in the owner's chat channel with a no-form capability handshake.
  Ask a multi-question interview, answer once by number and once conversationally, cancel another, then send a normal
  follow-up. Also run Pair discussion from child 1. Record host version/commit and observed protocol trace; never claim
  real OpenAB compatibility solely from the faux provider. Missing host access remains explicit unverified evidence.
- **Semantic Review:** inspect every cleanup path and capability branch, not just parser tests. Confirm the docs
  distinguish an ACP response from Runtime settlement and native/browser/interview fallbacks from each other.

## Edge Cases & Considerations

- An unanswered interview keeps the existing operation/lock alive. OpenAB may evict an idle process; this feature does
  not promise durable tool continuation or add a heartbeat, timeout takeover, or permanent OpenAB fork.
- A meaningful reply always reaches the model, but the model may need clarification. Do not add semantic guessing in the
  transport or treat an unknown number as permission for an unrelated workflow decision.
- Text-only interview inputs do not imply new image/attachment interpretation. Leave unsupported-content feedback
  visible without consuming the pending question or silently discarding part of a reply.
- Native capability claims remain authoritative. Do not mask native form failures as approvals or silently switch
  transport after a submitted native answer.
- Preserve the single-operation rule. Accepting an interview answer is not permission to start concurrent execution or
  change models while the original tool is waiting.
