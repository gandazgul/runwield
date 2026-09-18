# GitHub commands

For a pull request on GitHub. Requires the `gh` CLI, authenticated. `{owner}` and `{repo}` are placeholders `gh` fills
from the current repository; pass `--repo <owner>/<repo>` instead when you are outside it.

Replace `<n>` with the pull request number.

## Read the change

```bash
# Title, body, state, the head and base commits, and the files the diff touches.
gh pr view <n> --json number,title,body,state,url,headRefOid,baseRefOid,files,commits

# The discussion, including earlier reviews.
gh pr view <n> --comments

# Earlier line comments, with the file and line each one sits on.
gh api repos/{owner}/{repo}/pulls/<n>/comments --paginate \
  --jq '.[] | {path, line, user: .user.login, body}'

# The diff itself, and the file list alone.
gh pr diff <n> --patch
gh pr diff <n> --name-only
```

Keep `headRefOid`. It is the commit the review is anchored to.

## Post the review, batched

`gh pr review` cannot attach line comments — it has only `--approve`, `--request-changes`, `--comment`, and a body. Line
comments need one call to the reviews endpoint carrying every comment at once.

Write the review to a file:

```json
{
    "commit_id": "<headRefOid>",
    "event": "REQUEST_CHANGES",
    "body": "## Standards\n\n…\n\n## Spec\n\n…",
    "comments": [
        { "path": "src/session.ts", "line": 42, "side": "RIGHT", "body": "…" },
        { "path": "src/session.ts", "start_line": 60, "line": 64, "side": "RIGHT", "body": "…" }
    ]
}
```

Then submit it once:

```bash
gh api --method POST repos/{owner}/{repo}/pulls/<n>/reviews --input review.json
```

Field by field:

- `commit_id` — the head commit you read. Optional, but it pins the review to the code you actually reviewed.
- `event` — `REQUEST_CHANGES` when a blocking issue is open, `COMMENT` otherwise. Never `APPROVE`.
- `body` — the summary. Everything that is not anchored to a changed line.
- `comments[]` — one object per line comment. `path` is repository-relative. `line` is the line number **in the file
  after the change**. `side` is `RIGHT` for an added or unchanged line and `LEFT` for a removed one. For a range, add
  `start_line` (and `start_side` when the range crosses sides).

Omitting `event` leaves the review pending and unpublished, which looks posted to you and is invisible to everyone else.
Always set it.

## Post a summary with no line comments

```bash
gh pr review <n> --comment --body-file review-body.md
```

Use this only when nothing anchors to a line. It is one call; the reviews endpoint above is the same thing with
`comments[]` attached.

## When a comment is rejected

A comment anchored to a line the diff does not touch fails the whole call with `422 Unprocessable Entity` and a message
naming `pull_request_review_thread.line`. Nothing is posted — the batch is atomic.

Move that finding into `body`, naming the file and line in the text, and submit again. Do not retry the same payload,
and do not split the batch to get the rest through: a run of partial reviews is worse than one complete one.
