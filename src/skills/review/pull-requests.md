# Reviewing a pull request

Read this only when the target is a pull request on GitHub or a merge request on GitLab. For a commit range or the
working tree, none of it applies — report in the conversation and stop.

## Find the host

1. **The URL the user gave.** `…/<owner>/<repo>/pull/<number>` is GitHub.
   `…/<group>/<project>/-/merge_requests/<number>` is GitLab, on gitlab.com and on a self-hosted instance alike.
2. **The `origin` remote**, when the user gave a bare number: `git remote get-url origin`.
3. **Ask**, when neither answers.

Then read the commands from `github.md` or `gitlab.md` in this directory. Only one of them applies. Do not guess a
command for the other host.

If the host CLI is missing or unauthenticated, say so and deliver the review in the conversation. An unusable CLI is not
a reason to skip the review.

## What to fetch

- The title, description, and state of the change.
- Every comment on it, discussion and earlier review comments both. The description plus its comments is rung 4 of the
  spec ladder, and an earlier reviewer may have already settled the point you are about to raise.
- The diff, and the files it touches with their line ranges.
- The head and base commit identifiers. The line-comment calls need them.

## Which findings become line comments

A finding becomes a **line comment** when it names a file and a line that the diff actually changed. Anchor it there.

Everything else goes in the **summary body**:

- the rollup for each axis
- a missing requirement, which has no single line to point at
- scope creep that spans several files
- the verdict
- a finding whose line is outside the diff. Both hosts reject a comment anchored to an unchanged line. Move it to the
  body and name the file and line in the text.

Keep a line comment to the finding itself: what breaks, and which requirement or standard it breaks. The reasoning goes
in the body.

## Draft everything, submit once

Collect every comment first, then submit them together in one call. A review with twelve findings must arrive as one
notification, not twelve. Both hosts support this, and the host file gives the call.

If a batched submission fails partway, say exactly which comments landed. A partial post that reads as complete is worse
than no post.

## Verdict

| Findings                    | Action          |
| --------------------------- | --------------- |
| One or more blocking issues | request changes |
| Advisories only, or nothing | plain comment   |

**Never approve.** Approval is the user's to give. An agent that approves spends authority it was not handed.

## Ask before you submit

Show the user the summary body, the line comments, and the action you intend. Then wait.

Posting notifies every subscriber and cannot be quietly undone. If the user declines, leave the review in the
conversation and post nothing — not even a shortened version.
