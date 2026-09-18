# GitLab commands

For a merge request on GitLab. Requires the `glab` CLI and `jq`, authenticated.

Replace `<n>` with the merge request IID — the number in its URL, not the global ID. For `glab mr` commands outside the
repository, add `--repo <group>/<project>`. For API commands, replace `<project>` with the numeric project ID or the
URL-encoded path, such as `group%2Fproject`. On a self-managed host, also pass `--hostname <host>` to `glab api`.

> These commands were checked against the current `glab` and GitLab REST documentation. They were not executed against a
> live merge request.

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

# SHAs for the newest diff version.
glab api "projects/<project>/merge_requests/<n>/versions" \
  | jq 'max_by(.created_at) | {base_commit_sha, start_commit_sha, head_commit_sha}'
```

Copy the three returned values into `position.base_sha`, `position.start_sha`, and `position.head_sha`. They must come
from the same diff version.

## REST line comments

A line comment is a merge request discussion with a `position` object. For an added line, write:

```json
{
    "body": "…",
    "position": {
        "position_type": "text",
        "base_sha": "<base_commit_sha>",
        "start_sha": "<start_commit_sha>",
        "head_sha": "<head_commit_sha>",
        "old_path": "src/session.ts",
        "new_path": "src/session.ts",
        "new_line": 42
    }
}
```

Save it as `discussion.json`, then post it only after the user confirms the exact comment:

```bash
glab api --method POST \
  "projects/<project>/merge_requests/<n>/discussions" \
  --input discussion.json
```

For an unchanged context line, send both `old_line` with its old-file line number and `new_line` with its new-file line
number. For a removed line, replace `new_line` with its old-file line number as `old_line`. Always send both paths. For
a renamed file, `old_path` is the path before the change and `new_path` is the path after it.

The discussions call posts immediately. Use the draft-note flow below when the review has multiple comments.

## Post the review, batched

First show the user the exact summary and every line comment. Do not create any remote draft until the user confirms all
of them.

The bulk endpoint publishes every pending draft that belongs to the current user on this merge request. It cannot select
specific draft IDs. Before creating review drafts, require an empty draft queue:

```bash
glab api "projects/<project>/merge_requests/<n>/draft_notes" > existing-drafts.json
jq -e 'length == 0' existing-drafts.json
```

If that check fails, stop. Do not delete or publish the existing drafts. Ask the user to publish, remove, or preserve
them before this review continues.

For each confirmed line comment, create a JSON file with the matching `position` fields described above, but use `note`
instead of `body`. This added-line example needs only `new_line`:

```json
{
    "note": "…",
    "position": {
        "position_type": "text",
        "base_sha": "<base_commit_sha>",
        "start_sha": "<start_commit_sha>",
        "head_sha": "<head_commit_sha>",
        "old_path": "src/session.ts",
        "new_path": "src/session.ts",
        "new_line": 42
    }
}
```

Create the drafts and record every returned ID:

```bash
set -euo pipefail
: > review-draft-ids.txt
for payload in review-comments/*.json; do
  glab api --method POST \
    "projects/<project>/merge_requests/<n>/draft_notes" \
    --input "$payload" | jq -r '.id' >> review-draft-ids.txt
done
```

Immediately before publication, confirm that the queue contains exactly those IDs and no others:

```bash
sort -n review-draft-ids.txt -o review-draft-ids.txt
glab api "projects/<project>/merge_requests/<n>/draft_notes" \
  | jq -r '.[].id' | sort -n > all-draft-ids.txt
cmp review-draft-ids.txt all-draft-ids.txt
```

If `cmp` reports a difference, do not bulk-publish. Remove only this review's drafts, then resolve the unexpected drafts
with the user:

```bash
while read -r id; do
  glab api --method DELETE \
    "projects/<project>/merge_requests/<n>/draft_notes/$id"
done < review-draft-ids.txt
```

If the IDs match, publish the drafts and summary in one call. Run no other draft operation between the ID check and this
call:

```bash
# At least one blocking issue.
glab api --method POST \
  "projects/<project>/merge_requests/<n>/draft_notes/bulk_publish" \
  -f "note=$(cat review-body.md)" -f reviewer_state=requested_changes

# No blocking issues.
glab api --method POST \
  "projects/<project>/merge_requests/<n>/draft_notes/bulk_publish" \
  -f "note=$(cat review-body.md)" -f reviewer_state=reviewed
```

## Post a summary with no line comments

After the user confirms the summary, first confirm that there are no pending drafts. This keeps the bulk endpoint from
publishing unrelated work:

```bash
glab api "projects/<project>/merge_requests/<n>/draft_notes" \
  | jq -e 'length == 0'
```

Then post the summary with the matching verdict:

```bash
# At least one blocking issue.
glab api --method POST \
  "projects/<project>/merge_requests/<n>/draft_notes/bulk_publish" \
  -f "note=$(cat review-body.md)" -f reviewer_state=requested_changes

# No blocking issues.
glab api --method POST \
  "projects/<project>/merge_requests/<n>/draft_notes/bulk_publish" \
  -f "note=$(cat review-body.md)" -f reviewer_state=reviewed
```

Never run `glab mr approve`, and never run `glab mr revoke` against someone else's approval.

## When a comment is rejected

GitLab rejects a position that is not in the selected diff version. A failed draft is not queued; drafts already created
remain pending. Delete this review's recorded draft IDs, move the rejected finding into the summary body with its file
and line, ask the user to confirm the revised review, and rebuild the batch. Never bulk-publish a partial set.
