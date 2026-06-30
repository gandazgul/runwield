---
description: Generates a concise commit message, stages changes, and pushes to the remote.
---

# Commit

Generate a concise, informative commit message and commit the current pending changes in the repo staged or not, even
unrelated to your current context. If the changes seem very different and unrelated then feel free to make several
commits instead of one.

**Execution Steps:**

1. Run `git status` and `git diff` to analyze the pending changes.
2. Generate a strict, imperative-mood commit message (e.g., "Add feature", not "Added feature").
3. Keep the subject line under 50 characters. If there are multiple distinct changes, add a blank line and list them as
   bullet points in the commit body.
4. Stage the modified files (e.g., `git add -A`) and execute the commit.
5. Run `git push` to sync the changes upstream.
6. Report to the user in a list all the commits made, highlighting with backticks the short hash followed by the
   50-character title.
