# Manual QA for conversational-checkpoints-and-acp-interviews

This checklist is advisory. It does not change RunWield verification status.

<!-- runwield:manual-qa:start child="conversational-checkpoints-and-acp-interviews/01-conversational-pair-checkpoints" -->

## Make Pair Checkpoints a Conversation

Manual verification steps for conversational-checkpoints-and-acp-interviews/01-conversational-pair-checkpoints

- [ ] In Workspace, report an increment, ask a question, request a revision, and continue with ordinary messages; verify
      the normal composer remains available, the report and evidence are readable, and no Pair form appears.
- [ ] Refresh the Workspace session after a checkpoint report; verify the conversation, checkpoint, Plan, worktree, and
      execution owner remain correct, then resolve the checkpoint.
- [ ] At desktop and phone widths, attach an image, request a revision, and give final assent; verify the revised
      increment produces a new checkpoint and final completion follows the normal validation flow.
- [ ] Repeat the conversation flow in TUI and through an unmodified OpenAB ACP host; verify both accept ordinary
      discussion without Pair elicitation forms.
- [ ] Verify a question does not change files or start validation, while Stop preserves the work and does not abandon
      the Plan.

<!-- runwield:manual-qa:end child="conversational-checkpoints-and-acp-interviews/01-conversational-pair-checkpoints" -->

<!-- runwield:manual-qa:start child="conversational-checkpoints-and-acp-interviews/02-acp-interview-chat-fallback" -->

## Answer ACP Interviews in Chat Without Native Forms

Manual verification steps for conversational-checkpoints-and-acp-interviews/02-acp-interview-chat-fallback

- [ ] With a no-form ACP client, complete a multi-question interview by replying first with a number and then with
      conversational text. Confirm each next question appears in chat and the answers retain their order and meaning.
- [ ] Start another interview, cancel it, then send a normal follow-up. Confirm the interview stops and the follow-up
      works.
- [ ] Run Pair discussion and confirm it still completes through its existing flow.

<!-- runwield:manual-qa:end child="conversational-checkpoints-and-acp-interviews/02-acp-interview-chat-fallback" -->
