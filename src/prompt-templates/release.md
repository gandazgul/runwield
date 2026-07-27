---
description: Orchestrates a repository release by discovering its release policy, asking for the release kind, and following repository-owned automation.
---

# Release

You are running inside the wld harness. Release the current repository by discovering and following that repository's
own release policy and automation.

## Execution Steps

1. Choose the release operation first.

   - Use `user_interview` immediately with one multiple-choice question: "What kind of release operation should I run?"
   - The choices must be exactly:
     - `create_candidate` — Create Candidate
     - `promote_candidate` — Promote Candidate
     - `create_stable_direct` — Create Stable Directly
   - If the user cancels, stop without running commands.

2. Discover the repository's release policy and automation for the selected operation.

   - Look for `RELEASING.md`, `docs/releasing.md`, `docs/release.md`, package scripts/tasks, release scripts, and CI/CD
     workflows.
   - Follow repository-specific policy first. Do not apply Candidate tag grammar, promotion commands, GitHub latest
     rules, or post-publication notes steps unless the repository's own policy says to do so.
   - If policy and automation conflict, or the selected operation is unsupported, stop and report the contradiction
     instead of improvising.

3. Determine host and release mechanics only after policy discovery.

   - Inspect `git remote -v` and host-specific files such as `.github/` or `.gitlab-ci.yml`.
   - Prefer repository-owned commands over hand-written release steps.
   - If host or versioning is still ambiguous after discovery, ask a focused `user_interview` question.

4. Generate curated release notes.

   - Follow the repository's documented release-note scope. If no repository-specific release-note scope is documented,
     use commits since the previous stable tag and write notes for users deciding whether to install or upgrade.
   - Follow the repository's documented note format. If no repository-specific note format is documented, use this
     RunWield fallback format:
     - For Candidate and Stable operations, make notes cumulative from the previous Stable.
     - For later Candidates, also summarize validation-relevant changes since the prior Candidate so testers can see
       what changed between RCs.
     - For Candidate promotion, remove Candidate/testing warnings and do not treat the shared Candidate source commit as
       an empty release; present the cumulative Stable notes for the promoted version.
     - Start with **What's New** for important user-facing outcomes in plain language.
     - Add a concise **Detailed Changelog** grouped into **New Features**, **Bug Fixes and Improvements**, and
       **Breaking Changes** when relevant.
   - Omit purely internal refactors, test-only changes, dependency chores, and other details unless they affect user
     behavior.
   - Keep notes in a temporary file unless repository policy explicitly requires committing them.

5. Confirm before irreversible side effects.

   - Summarize the chosen operation, source commit/tag, target tag/version, release notes location, and exact
     repository-owned command(s) to run.
   - Use `user_interview` for a yes/no confirmation before creating or pushing a tag, publishing a release, or starting
     another irreversible operation.
   - If not confirmed, stop without side effects.

6. Execute and monitor.

   - Run the repository-owned release command or documented manual sequence for the selected operation.
   - Monitor CI/CD and release publication to completion.
   - If CI/CD fails, investigate and repair only issues in the release scope; otherwise report the exact failure and
     recovery command.

7. Complete release notes after publication when repository policy requires it.

   - When the repository policy says CI creates the host release and uploads assets first, edit the published release
     with the curated temporary notes afterward and verify the notes landed.
   - If post-publication note editing fails after assets are published, report the release as incomplete with assets
     published and notes pending, including the exact retry command.

If a required CLI tool or credential is missing, halt and inform the user.

Note: no need to store memories for releases generally, only if there's a significant breaking change or durable release
policy decision that would be useful to recall later.
