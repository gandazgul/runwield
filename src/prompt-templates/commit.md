---
description: Generates a concise commit message, stages changes, and pushes to the remote.
---

# Commit

Generate a concise, informative commit message and commit the current pending changes in the repo staged or not, even
unrelated to your current context. If the changes seem very different and unrelated then feel free to make several
commits instead of one. If the changes are all docs or plans merge them together with a headline and a list of all the
docs changed dont make 1 commit per plan.

**Execution Steps:**

1. Run `git status` and `git diff` to analyze the pending changes.
2. Generate a detailed, imperative-mood commit message (e.g., "Add feature", not "Added feature").
3. Keep the subject line under 50 characters. If there are multiple distinct changes, add a blank line and list them as
   bullet points in the commit body. Also include in the body any clarifying details about the changes.
4. Stage the modified files (e.g., `git add -A`) and execute the commit.
5. Run `git push` to sync the changes upstream.
6. Finish by calling `task_completed`. The `message` field must be exactly this report format, with no extra prose, no
   verification details, and no missing list:

   ```markdown
   Committed and pushed:

   - `short-hash` - Full commit subject
   - `another-short-hash` - Full commit subject
   ```

   Include one bullet for each commit you made. Use the short commit hash in backticks, followed by a space, a hyphen,
   and a space, followed by the complete commit subject line (the same subject you used for that commit, up to the
   50-character limit).
