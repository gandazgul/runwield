---
planId: "2735bd6a-955b-40e1-a71a-e0f015b94488"
classification: "PLANNED_CHANGE"
workKind: "DOCUMENTATION"
complexity: "HIGH"
affectedPaths:
    - "docs/index.md"
    - "docs-site/"
    - ".github/workflows/release.yml"
    - ".github/workflows/docs.yml"
    - "scripts/run-ci.ts"
    - "docs/releasing.md"
    - "docs/prd/runwield.md"
    - "deno.json"
executionAgent: "frontend-engineer"
collaborationRecommendation: "autonomous"
devServerCommand: "deno task docs:dev"
devServerUrl: "http://localhost:4322"
devServerHmr: true
createdAt: "2026-09-19"
origin: "internal"
userVerifiedAt: null
targetBranch: "main"
status: "validated"
workRecord:
    status: "generated"
    recordId: "fd8b0c45-5d82-43dd-9714-857a6de311b5"
    path: "docs/work-records/2026-09-20-publish-release-aligned-documentation-system.md"
    lastAttemptAt: "2026-09-20T03:13:31.894Z"
archivedAt: "2026-09-23T16:08:14.117Z"
archivedFromStatus: "validated"
archivedFromPath: "docs/plans/publish-release-aligned-documentation.md"
---

# Publish release-aligned RunWield documentation

## Context

RunWield has useful Markdown guides, but `docs/index.md` mixes instructions with PRDs, research, internal design,
audits, and product proposals. There is no docs-site build or deployment in this repo. The separate sibling
`runwield.dev` repo already publishes the landing site through GitHub Pages; leave that deployment alone.

The user chose Starlight and GitHub Pages at `https://docs.runwield.dev`. The cleaned-up `docs/index.md` must be the
home page. Public instructions must describe the latest Stable release, not `main`. Documentation corrections must
publish without a product release; product hotfixes must remain possible through the existing release process.

Requirements ownership:

- Add **Public documentation** to [the root PRD](../prd/runwield.md#capability-requirements), with stable heading
  `#public-documentation`, capability navigation, and ownership reference. Proposed named requirements: **Find usable
  instructions**, **Read documentation for the latest Stable release**, and **Correct documentation independently**.
- Preserve [Core installation and updates](../prd/runwield-core-prd.md#installation-and-updates), including honest
  package availability. Link that owner rather than duplicate its requirements.
- Preserve [Core execution, validation, and recovery](../prd/runwield-core-prd.md#execution-validation-and-recovery) and
  the release rules in [Releasing](../releasing.md). This change does not redesign product publication or make a failed
  docs deployment invalidate a published product.

## Objective

A reader can use a searchable, mobile-friendly Starlight manual whose home comes from `docs/index.md`, see the Stable
version it describes, and follow working guide links. Internal documents are absent from published pages and search.
Stable releases update the manual; independent documentation corrections do not change the product version.

## Approach

### Content and site

Add an isolated static site under `docs-site/`, with its own pinned compatible Astro/Starlight dependencies and
lockfile. Use Deno tasks to operate it. Do not attach this to the Workspace server build or upgrade Workspace
dependencies.

Keep Markdown under `docs/` as the maintained source, not a second hand-edited site content tree. An explicit
publication manifest selects files and navigation. Load or stage those files at build time, supplying Starlight titles
from the manifest or Markdown heading and preventing duplicate H1 headings. Map `docs/index.md` to `/`.

Initial publication scope: `index`, `quickstart`, `usage`, `workspace`, `workspace-container`, `workflows`, `sessions`,
`providers`, `settings`, `customization`, `themes`, `collaboration`, `mcp`, `troubleshooting`, `plan-lifecycle`,
`validation-authority`, and `contributing` Markdown files. Review these against released behavior. Omit unavailable
features instead of describing target behavior as available. Contributor guidance is a small secondary section.

Make the home a short introduction and grouped guide links: Start, Use, Configure, and Get Help. Move useful detailed
instructions to their owning guides instead of discarding them. Remove PRD, vision, research, audit, internal design,
release-engineering, and model-evaluation listings from the home. Keep those source documents in the repository.
Necessary contributor links to internal documents may open GitHub; those documents must not become site pages.

Transform relative Markdown links at build time: published targets become site routes; excluded repository files and
directories become GitHub links pinned to the source commit being published. Preserve fragments, reference-style links,
external URLs, explicit anchors, and referenced assets. Do not point release reference links at `main`. Do not copy the
whole `docs/` tree or demo-media directory into the output. Retained Mermaid diagrams must render as diagrams.

Use Starlight's standard navigation, typography, search, theme switch, code blocks, and mobile menu. Reuse RunWield's
existing fonts and semantic color tokens through a small Starlight theme mapping; inspect the existing theme bridge. Do
not recreate Workspace's application shell or introduce a new shared visual pattern. Include links to the landing site,
repository, source editing on the docs branch, and the documented Stable version. Provide canonical URLs and a sitemap
for the custom domain. No historical version selector in this change.

### Release-aligned publishing

Use a maintained Git branch, provisionally named `docs/stable`, based on a published Stable snapshot. It holds the same
repo-relative guide and site paths, plus a small record of the documented Stable tag. It is a documentation source
branch, not a product Release Branch and not an independent second copy of Markdown within a checkout.

```text
main: code + future docs
  → existing Candidate / Stable release process
  → successful Stable asset publication and qualification
  → reconcile Stable tag into docs/stable, retaining docs corrections
  → check and build exact docs branch commit
  → deploy GitHub Pages

docs correction on docs/stable
  → check against documented Stable version
  → deploy GitHub Pages, same product version
  → forward-port correction to main

product hotfix
  → existing release operation → new Stable patch tag → same docs update path
```

Use ordinary Git history and merges to advance the docs branch from the selected Stable tag. Do not reset it, force-push
it, or silently overwrite corrections. If reconciliation conflicts, retain the live site and report the precise files
for correction, then retry. A successful build alone cannot decide whether conflicting instructions are correct.
Docs-only branch updates may change selected guides, site configuration/assets, and required docs tooling; they must not
publish modified product code or trigger a product release. Forward-port corrections to `main` explicitly, through
normal review. Before the next docs release, reconcile any corrections not yet in the tagged source.

Extend `.github/workflows/release.yml` after the successful `release` job, only for Stable releases. Reuse its selected
`metadata.outputs.tag`, including manual recovery; do not use the workflow's `head_sha`. The existing `published` output
only means a GitHub Release exists and is not a sufficient success signal. Preserve asset qualification/recovery checks.
Use an explicit job status condition, such as `!cancelled()` plus successful required results, so GitHub's implicit
success condition cannot skip docs recovery when an upstream build was intentionally skipped for an existing release.
Verify the selected release is still GitHub latest before updating the docs branch and before deployment. Never let an
older release retry, a Candidate, or a `main` push replace the live manual.

Put shared publication logic in one reusable workflow and small scripts. Call it explicitly from the release workflow;
do not rely on a workflow bot's branch push or `release: published` event to start another workflow. Support docs-branch
pushes and explicit retry without creating another product tag. Serialize docs branch synchronization and deployment
across both entry paths; deploy the checked source commit, and reject stale queued work. Use normal non-force pushes to
prevent overwriting a correction that arrived while a release update was being prepared. Grant write/Pages/OIDC rights
only to jobs that need them; pull requests build and check without deployment credentials.

A separate branch costs reconciliation work, but supports the user's requested docs hotfixes. Publishing only immutable
release tags was set aside because it would delay docs corrections until another product release.

### First launch

Resolve the actual latest Stable release during execution. Do not use a remembered version number. Bootstrap
`docs/stable` from that tag and backport only the site support and reviewed user-doc cleanup needed to publish it. Use
that tag's behavior as the content reference, not terminology or feature availability from current `main`. Carry the
same cleanup and site support in the implementation change so future releases contain them. If the first launch waits
for a new Stable release, use that published tag instead; never manufacture a product release merely to launch docs.

Configure this repo's Pages source as GitHub Actions and set `docs.runwield.dev`. Verify domain ownership and set the
DNS CNAME to `gandazgul.github.io`, not a repository path. Enable HTTPS after certificate provisioning. Do not alter the
landing site's apex-domain settings. Use existing authenticated access where available; provide a bounded setup wizard
for settings/DNS actions that require the owner. Report local build success separately from confirmed public deployment.

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint
during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report
only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture
shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

- `docs/index.md` and selected guides — clear public home, released instructions, and coherent navigation.
- `docs-site/` — isolated Starlight build, publication manifest, source/link handling, search, theme mapping, version
  display, and build tests. Ignore generated content/output.
- `.github/workflows/docs.yml`, `.github/workflows/release.yml`, and focused `scripts/` helpers/tests — one tested
  publication path for Stable updates, docs corrections, bootstrap, and retry.
- `deno.json`, `scripts/run-ci.ts`, and its tests — root docs tasks and the same public-docs gate locally and in CI.
- `scripts/check-doc-links.js` and tests — preserve existing repository-link checks; reuse compatible helpers without
  changing their meaning to site routes.
- `docs/prd/runwield.md`, `docs/releasing.md`, `docs/contributing.md`, `README.md`, and `docs/ai-visibility.md` — owning
  requirements, correction/release procedure, public entry links, and truthful delivered-versus-target status.
- Workspace code and the sibling landing-site repo are outside scope. Record its Docs-link update as a follow-up, not an
  unannounced cross-repo edit. Preserve the current dirty Workspace and design-system files.

No new RunWield domain concept or existing architectural decision needs replacement. Explain the ordinary docs-branch
convention in contributing/releasing guidance; do not rename the glossary's existing **Release Branch** concept.

## Reuse Opportunities

- `.github/workflows/release.yml` — Stable classification, selected tag, qualification, and successful publication jobs.
- `scripts/release.js` and `scripts/release.test.js` — existing release operations and immutable-tag protections;
  preserve rather than replace them with a docs-owned release path.
- `scripts/check-doc-links.js` — existing repository path/heading checks; extend coverage through built HTML rather than
  assume repository links prove published links.
- `src/shared/git-test-fixture.ts` — real local repositories, tags, and remotes for synchronization tests.
- `scripts/run-tests.js` — isolated test processes and sandboxed home directories.
- `src/ui/design-system/{tokens.css,fonts.css,theme-bridge.js}` — existing brand values, without importing application
  runtime code or changing shared styles.
- The sibling landing site's workflow is a reference for GitHub Pages setup, not a dependency to edit.

## Implementation Steps

1. **The home is a usable manual index.** `docs/index.md` contains the agreed public guide groups, no internal-document
   catalog, and no duplicated long workflow explanation. Published instructions are checked against their documented
   Stable source; useful removed instructions survive in the appropriate guides.
2. **The real Starlight build uses those Markdown files.** `deno task docs:dev` serves port 4322 with HMR;
   `deno task docs:build` produces only selected pages/assets in `dist/docs/`. Search, routes, anchors, code blocks,
   version display, and any retained diagrams work. Editing source Markdown changes the generated page without editing a
   second content file. Pre-release local builds are visibly previews, not falsely labeled released documentation.
3. **Docs updates preserve release identity and corrections.** The shared publisher checks the selected Stable tag,
   safely advances the docs branch, builds an exact commit, and preserves pending corrections. Independent docs fixes
   leave product tags/assets unchanged. Non-doc changes on a docs-only update fail validation. Conflict, stale-source,
   API failure, build failure, and rejected-push cases leave the published site intact and can be retried.
4. **Actual release and docs events reach the shared publisher.** Qualified Stable publication invokes it explicitly;
   Candidate, failed release, and `main` events do not publish. Docs pushes and manual retry use the same checks and
   deployment concurrency. Product patch releases continue to use the existing commands and protections.
5. **Checks prove the publishing contract.** CI includes the isolated docs build/check and behavioral regression tests
   described below. Existing release tests and repository-link coverage remain; no owned synchronization or Plan
   machinery is replaced by injected test substitutes.
6. **Guidance matches the delivered behavior.** The root PRD owns the three named requirements and scenarios for first
   use, Stable release updates, independent corrections, exclusion of internal content, and failed/retried publication.
   Contributing/releasing docs explain branch setup, correction forward-porting, conflict repair, and patch release
   flow. README links to the public manual while retaining contributor entry points. Deferred work remains explicit.
7. **The public site is verified, or the exact external prerequisite is recorded.** Bootstrap and run a checked
   deployment from an actual Stable snapshot, verify custom-domain HTTPS and routes, and record tag, docs commit, and
   Actions run. If access or DNS is unavailable, provide the owner setup wizard and mark live publication unverified; do
   not claim the public site shipped from a local screenshot.

## Approval Confirmation

No Work Records are proposed for supersession. Approval covers the docs site and publishing integration, not creation of
an arbitrary product release or changes to the landing-site repository.

## Verification Plan

### Automated behavior

Add `deno task docs:check` to build/type-check the isolated site and inspect its output. Add focused tests under
`scripts/` and/or `docs-site/`; run test files through `deno run -A scripts/run-tests.js <file paths>`, never
`deno test` directly. Run `deno task doc-links:check`, `deno task seams:check`, and `deno task ci` before completion.
Any test that changes cwd or HOME must use `withProcessGlobalTestLock`; runtime path lookup follows `getHomeDir()` /
`getCwd()`.

Required discriminating evidence:

- **Real source to page:** change a unique phrase in a fixture's `docs/index.md`, build through the production loader,
  and assert `/index.html` contains it. Assert a selected guide renders its actual sections and code example. A static
  placeholder home or second maintained copy fails this test.
- **Publication boundary:** include uniquely marked PRD, Plan, research file, and unrelated media in the fixture. Assert
  they have no output page, copied asset, sitemap entry, or search-index content. A hidden sidebar entry is not
  exclusion.
- **Link correctness:** inspect built routes/fragments and referenced assets. Cover sibling links, reference links,
  excluded files/directories pinned to the published commit, anchors, and one local image. Build must reject a broken
  internal target rather than silently turn it into an unverified external link.
- **Release isolation:** create a real fixture Git remote with Stable A and unreleased B containing distinct guide
  phrases. Publish A through the real source-selection/build path: output must show A's version/content and not B's. Run
  this once with no docs branch to prove bootstrap, and again with an existing docs branch to prove release update.
  Assert the documented Stable tag is an ancestor of the published docs source and that bootstrap differences contain
  only approved docs/site support. Inject external GitHub responses only at the network/command boundary, not a fake
  internal selector.
- **Independent correction:** commit a docs correction on the docs branch; rebuild/publish and assert changed HTML,
  unchanged Stable version, unchanged product tags, and no product release invocation. A product-code change submitted
  through this path must fail. Forward-port the correction, then publish Stable B and verify it survives. Also cover a
  correction absent from B and a conflicting correction: preserve it on a clean merge or stop without losing it.
- **Hotfix release:** model a new patch Stable tag through the existing release metadata path and prove its updated
  docs/version reach the site. Preserve existing tests for Candidate exclusion, exact promotion source, immutable
  published tags, and checked recovery assets. None of these behaviors is intended to disappear.
- **Failure and ordering:** Candidate, failed publication, incomplete release assets, an API error, an old release
  retry, stale queued docs job, failed build, and non-fast-forward branch push must not replace the live artifact. Test
  successful retry from the same release without moving its tag. Include a docs correction arriving during preparation
  so the publisher cannot overwrite it.
- **Event wiring:** inspect actual workflow inputs, dependencies, permissions, and concurrency, and exercise the
  production publishing command under the event cases above. Test both fresh publication and existing-release recovery
  with the build job skipped and the qualification/release jobs successful. Evaluate the actual job condition and
  inputs, not just the presence of `needs` or `stable` strings; prove recovery still invokes publication with the
  selected tag. Record one real Actions docs deployment as end-to-end evidence, naming the entry path exercised; it does
  not by itself prove the other paths. Tests of a disconnected helper alone are insufficient. Do not create a fake
  public product release for a test.

### Headed browser and live checks

Use `agent-browser --headed` with an isolated named session. Check the dev site at `http://localhost:4322`; also serve
the production build for search checks because its search index is produced at build time.

- At desktop and narrow phone widths, open home, follow Quickstart, use sidebar navigation and mobile menu, and return
  home. No clipped menu, unreadable text, or horizontal page overflow; wide code blocks can scroll independently.
- Search for a known guide phrase and open the result. Search for an excluded internal-document marker and confirm no
  result. Check keyboard search/menu use, visible focus, light/dark themes, code copying, and readable version label.
- Open a deep guide URL directly, follow an anchor, refresh it, and check a missing URL. Confirm no console/network
  errors and no `.md` route failures. Verify retained Mermaid renders, not merely a fenced code listing.
- On `https://docs.runwield.dev`, repeat home, search, deep-link refresh, version, and HTTPS checks. Compare visible
  version with GitHub latest and inspect canonical URL/sitemap. Confirm `runwield.dev` remains unaffected.
- Semantic Review checks that instructions agree with the documented release, PRD scenarios describe actual results,
  internal files remain in Git but out of public output, and documentation never presents an unshipped feature as ready.

## Edge Cases & Considerations

- GitHub Pages hosts static public files. No server-side search, credentials, login, Workspace backend, or SaaS hosting
  is part of this site. No historical manuals, translations, analytics service, or broad documentation rewrite.
- `docs/stable` is a reviewable branch-name default, not the Plan's execution target branch. Implement normal support in
  the current development flow, then bootstrap/backport only the required site support to the released-docs source.
- Package-manager availability can lag GitHub release assets. Keep existing availability caveats; docs deployment must
  not claim Homebrew/WinGet publication solely because the Stable GitHub Release exists.
- The existing release procedure verifies release notes after CI. Preserve that procedure; successful downloadable asset
  publication selects the documentation version and is not a claim that all release operations finished.
- GitHub Pages settings, domain verification, branch protection, token permissions, and DNS access remain external
  prerequisites. Do not bypass protections or add personal access tokens merely to make workflow chaining work.
- Dirty files at planning time are `docs/design-system.md`, the Workspace PRD, and Workspace review UI/tests. This Plan
  does not need to alter them. Read current design guidance, reuse existing patterns, and preserve those changes.
