---
description: Generates a changelog and publishes a release on GitHub or GitLab, automatically handling versioning.
tools:
    - bash
    - ls
    - user_interview
---

# Release

Generate a changelog and publish a new release for this repository.

## Execution Steps

1. Determine the Git Host (GitHub vs GitLab)

   - Run `git remote -v`. If the URL contains `github.com` or `gitlab.com`, proceed.
   - If it is a custom domain, check for host-specific files (e.g., use `ls -a` to look for a `.github/` directory or a
     `.gitlab-ci.yml` file).
   - If you still cannot definitively determine the host, use the `user_interview` tool to ask the user: "Is this
     repository hosted on GitHub or GitLab?"

2. Determine the Versioning Scheme

   - Run `git tag --sort=-v:refname | head -n 5` to look at recent tags.
   - If the project uses SemVer (e.g., `v1.2.3`), analyze the git log since the last tag. Bump the version according to
     Semantic Versioning rules (Major for breaking, Minor for features, Patch for fixes).
   - If the version is SemVer but starts with a 0, then the minor bumps are for major breaking changes and the patch
     bumps are for everything else (features and patches).
   - If the project uses CalVer (e.g., `vYYYY.M.D.N`), generate the next sequential date-based tag for today.
   - If there are no tags, check `package.json` or `deno.json` for a version string. If still completely ambiguous, use
     `user_interview` to ask the user which format to use.

3. Generate the Changelog

   - Generate a markdown changelog based on the commits since the last tag. Format strictly into these sections:
     - **New Features**
     - **Bug Fixes and Improvements**
     - **Breaking Changes**

4. Tag and Push

   - Stage any version file changes (if you bumped `package.json`), commit them, and create the new git tag.
   - Push the commit and the tag to the remote.

5. Publish the Release

   - Execute the release using the appropriate CLI, passing the changelog as the release notes:
     - For GitHub: use the `gh release create` command.
     - For GitLab: use the `glab release create` command.

6. Monitor the CI/CD run for errors and if necesary fix them.

If a required CLI tool is missing, halt and inform the user.

Note: no need to store memories for releases generally, only if there's a significant breaking change that would be
useful to recall later.
