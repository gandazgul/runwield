---
description: Generate a changelog for github release since last version, then create the release (vYYYY.M.D.N).
---

Generate a changelog for the next release based on the git commit history since the last tag (vYYYY.M.D.N). The
changelog should be formatted in markdown and include the following sections:

- **New Features**: List any new features added to the project.
- **Bug Fixes and Improvements**: List any bugs that were fixed and any improvements made.
- **Breaking Changes**: List any changes that may break backward compatibility.
- **Other Changes**: List any other changes that don't fit into the above categories.

Make the tag and push it to the repository. The tag should follow the format vYYYY.M.D.N, where YYYY is the year, M is
the month, D is the day, and N is a sequential number (starting with 1) for multiple releases on the same day.

Use gh cli to create a new release on GitHub with the generated changelog as the release notes. The release should be
tagged with the same tag pushed to the repository. Name the release after the tag.
