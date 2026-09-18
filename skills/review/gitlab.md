# GitLab commands

For a merge request on GitLab. Everything here goes through the `glab` CLI, authenticated.

Replace `<n>` with the merge request IID — the number in its URL, not the global ID. Add `--repo <group>/<project>` to
any command when you are outside the repository.

> These commands were checked against the current `glab` command reference. They were not executed against a live merge
> request.

## Read the change

```bash
# Title, body, state, author, and the branches.
glab mr view <n> --output json

# The discussion, including earlier review comments.
glab mr view <n> --comments

# Only the threads nobody has settled yet.
glab mr view <n> --unresolved

# Earlier line comments, with the file each one sits on.
glab mr note list <n> --type diff --output json

# The diff.
glab mr diff <n> --raw
```

## Post the review, batched

`--draft` queues a note instead of posting it. Queued notes are visible only to you until you publish, which is how a
multi-finding review arrives as one notification rather than one per finding.

```bash
# A finding on a line the change added.
glab mr note create <n> --draft --file src/session.ts --line 42 --message "…"

# A finding on a line the change removed.
glab mr note create <n> --draft --file src/session.ts --old-line 17 --message "…"

# A finding spanning a range.
glab mr note create <n> --draft --file src/session.ts --line 60:64 --message "…"

# The summary: no --file, so it publishes as a plain comment on the change.
glab mr note create <n> --draft --message "$(cat review-body.md)"
```

`--file` targets the latest diff version, so you never resolve commit SHAs yourself.

Then, after the user agrees:

```bash
glab api --method POST "projects/:fullpath/merge_requests/<n>/draft_notes/bulk_publish"
```

`glab` has no publish subcommand, so this is the one place the review needs `glab api`. `:fullpath` is filled from the
current repository.

## Post a single comment instead

When nothing anchors to a line, drop `--draft` and one note posts immediately:

```bash
glab mr note create <n> --message "$(cat review-body.md)"
```

Posting each finding this way without `--draft` also works and needs no `glab api`, but every note is its own
notification. Prefer the draft queue.

## Verdict

GitLab has no "request changes" action. Carry the verdict in the first line of the summary note:

```text
**Changes requested** — 2 blocking issues, 3 advisories.
```

Never run `glab mr approve`, and never run `glab mr revoke` against someone else's approval.

## When a comment is rejected

A `--file` and `--line` the diff does not contain is rejected, and only that note fails — the ones already queued stay
queued. Move that finding into the summary body and carry on. Nothing reaches the merge request until you publish, so a
rejected draft never leaves a half-posted review behind.

To remove a note you queued by mistake, `glab mr note delete <n> <note-id> --yes`, taking the numeric id from
`glab mr note list <n> -F json`. That subcommand is marked experimental, and the list may not include unpublished
drafts; when it does not, remove the draft from the merge request page before publishing.
