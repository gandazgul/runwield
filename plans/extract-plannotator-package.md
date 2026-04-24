# Plan: Extract `plannotator-pi-extension-compiled` to sibling repo + tag-based npm publish CI

## Context

Confirmed requirements:
1. Move `plannotator-pi-extension-compiled/` out of Harness to sibling path `../plannotator-pi-extension-compiled`.
2. Make it its own repo (`git init`), add standard `.gitignore`, and add a brief README explaining this compiled package exists to make Plannotator usable from Deno.
3. CI/CD must live in that package repo (not Harness).
4. Harness should continue using a **local path** dependency for now.
5. npm publish should run only for tags starting with `v`.

Current code references:
- Harness `deno.json` currently points to in-repo paths:
  - `./plannotator-pi-extension-compiled/dist/index.mjs`
  - `./plannotator-pi-extension-compiled/dist/server.mjs`
- Harness runtime import in `src/tools/submit-plan.js` is package-name based (`@gandazgul/plannotator-pi-extension-compiled/server`), so only import mapping needs path adjustment.

## Approach

- Extract current package directory to `../plannotator-pi-extension-compiled`.
- Initialize it as independent git repo and add foundational repo files.
- Add package-local GitHub Actions workflow triggered on `push.tags: ['v*']` to install deps, build, and publish to npm with `NODE_AUTH_TOKEN` from `secrets.NPM_TOKEN`.
- Keep Harness wired to the local sibling build outputs by updating only `deno.json` import paths.

## Files to modify

### Harness repo
- `deno.json`
  - Update local alias paths from `./plannotator-pi-extension-compiled/dist/*` to `../plannotator-pi-extension-compiled/dist/*`.
- `README.md`
  - Update references that currently imply package exists inside this repo.

### Sibling repo: `../plannotator-pi-extension-compiled`
- `.gitignore` (new; usual Node ignores)
- `README.md` (new; brief purpose statement re: Deno compatibility)
- `.github/workflows/npm-publish.yml` (new; tag-based publish)
- `package.json` (add/confirm scripts used by CI, e.g. `build`)
- Keep and reuse existing:
  - `build.mjs`
  - `dist/*`
  - static assets (`plannotator.html`, `review-editor.html`, `plannotator.json`)

## Reuse

- Existing package build logic: `plannotator-pi-extension-compiled/build.mjs`
- Existing package metadata: `plannotator-pi-extension-compiled/package.json`
- Existing Harness integration point: `deno.json` import aliases
- Workflow reference pattern: `~/Documents/web/mnemosyne/opencode-mnemosyne/.github/workflows/npm-publish.yml`

## Steps

- [ ] Move folder from `./plannotator-pi-extension-compiled` to `../plannotator-pi-extension-compiled`.
- [ ] In sibling folder: run `git init`.
- [ ] Create sibling repo `.gitignore` with usual Node/OS/build ignores (e.g. `node_modules/`, `.DS_Store`, `.env*`, npm logs).
- [ ] Add brief sibling repo `README.md` stating this is a compiled wrapper of `@plannotator/pi-extension` for Deno consumption.
- [ ] Add/confirm `package.json` scripts (`build` at minimum) to support CI.
- [ ] Add `.github/workflows/npm-publish.yml` in sibling repo:
  - trigger: `on.push.tags: ['v*']`
  - setup Node + npm registry
  - run `npm ci`
  - run `npm run build`
  - run `npm publish` with `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}`
- [ ] Update Harness `deno.json` aliases to `../plannotator-pi-extension-compiled/dist/index.mjs` and `../plannotator-pi-extension-compiled/dist/server.mjs`.
- [ ] Update Harness README path references from in-repo package location to sibling location.

## Verification

- Sibling package local checks:
  - `npm ci`
  - `npm run build`
  - `npm pack` (confirm dist/assets/package files are included)
- Harness integration:
  - `deno task check`
  - run a Harness flow that touches submit-plan import resolution
- GitHub Actions publish behavior:
  - normal branch push: no publish
  - push tag like `v1.0.1`: workflow runs and publishes
