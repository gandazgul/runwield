#!/usr/bin/env bash
set -euo pipefail

tag=${1:?Stable tag is required}
bootstrap=${2:-false}
source_sha=${3:-${GITHUB_SHA:-HEAD}}

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git fetch origin "refs/tags/$tag:refs/tags/$tag"
if git ls-remote --exit-code --heads origin docs/stable >/dev/null 2>&1; then
  git fetch origin docs/stable:refs/remotes/origin/docs/stable
  git checkout -B docs-update "$tag"
  git merge --no-edit refs/remotes/origin/docs/stable
else
  test "$bootstrap" = "true" || {
    echo "docs/stable does not exist; run the manual workflow with bootstrap=true" >&2
    exit 1
  }
  git checkout -B docs-bootstrap "$tag"
  git checkout "$source_sha" -- \
    .github/workflows/docs.yml .gitignore deno.json deno.lock \
    docs/index.md docs-site scripts/public-docs.ts scripts/check-public-docs.ts \
    scripts/public-docs.test.ts scripts/docs-workflow.test.ts \
    scripts/reconcile-docs-branch.sh
fi

deno eval '
const tag = Deno.args[0];
const path = "docs-site/release.json";
const release = JSON.parse(await Deno.readTextFile(path));
release.version = tag;
release.sourceRef = tag;
release.releaseUrl = `https://github.com/gandazgul/runwield/releases/tag/${encodeURIComponent(tag)}`;
await Deno.writeTextFile(path, `${JSON.stringify(release, null, 2)}\n`);
' "$tag"

git add docs-site/release.json
if ! git diff --cached --quiet; then
  git commit -m "docs: publish $tag manual"
fi
git push origin HEAD:docs/stable
