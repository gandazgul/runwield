# WinGet first release checklist

Disposable guide. Delete this file after the first public WinGet listing is accepted and the lasting docs stay correct.

## Prerequisites

- Stable RunWield release that contains Windows package support.
- GitHub release workflow passed.
- Windows x64 machine or VM with Git for Windows and WinGet.
- Owner GitHub account that can submit to `microsoft/winget-pkgs`.
- No public PR is created by package generation.

## 1. Publish the Stable release

Follow `docs/releasing.md`. Use the normal commands only:

```bash
deno task release:promote --candidate vX.Y.Z-rc.N
# or, only when chosen:
deno task release:stable --tag vX.Y.Z
```

Expected result: the Stable GitHub release contains:

- `wld-vX.Y.Z-windows-x64.zip`
- `wld-vX.Y.Z-windows-x64.zip.sha256`
- `runwield-windows-package.json`
- `runwield-winget-manifests-vX.Y.Z` workflow artifact

Do not use Candidate bytes for Stable WinGet submission.

## 2. Confirm package checks

In the release workflow, confirm `windows-package-check` passed before asset publication.

On a disposable Windows x64 machine, download the ZIP and run:

```powershell
deno task package:windows:check --package .\wld-vX.Y.Z-windows-x64.zip
```

Expected result: `wld --version`, `wld --help`, `wld update`, PowerShell launch, and cmd launch pass from a path with
spaces.

If this fails, fix the release source and publish a new Stable. Do not submit the failed ZIP.

## 3. Generate final manifests from published bytes

From this repository:

```bash
deno task package:winget --tag vX.Y.Z --output /tmp/runwield-winget
```

Expected output:

```text
/tmp/runwield-winget/Gandazgul.RunWield/X.Y.Z/Gandazgul.RunWield.yaml
/tmp/runwield-winget/Gandazgul.RunWield/X.Y.Z/Gandazgul.RunWield.locale.en-US.yaml
/tmp/runwield-winget/Gandazgul.RunWield/X.Y.Z/Gandazgul.RunWield.installer.yaml
/tmp/runwield-winget/runwield-winget-package.json
```

The installer URL must be the immutable GitHub release ZIP URL. The checksum must match the ZIP.

For a pre-publication dry run only, serve the exact local ZIP and use:

```bash
deno task package:winget --tag vX.Y.Z --output /tmp/runwield-winget-test --base-url http://127.0.0.1:PORT --test-only
```

Never submit test-only manifests.

## 4. Validate and install locally

On Windows:

```powershell
winget validate --manifest C:\path\to\Gandazgul.RunWield\X.Y.Z
winget settings --enable LocalManifestFiles
winget install --manifest C:\path\to\Gandazgul.RunWield\X.Y.Z
wld --version
wld update
```

Expected result: `wld` resolves from the WinGet alias, the version is `vX.Y.Z`, and update prints:

```text
winget upgrade --id Gandazgul.RunWield --exact
```

Also run a clean-host helper check: memory add/search, code index/query, page fetch, and browser snapshot must use
bundled helper programs, not tools already on `PATH`.

## 5. Upgrade test

Use a controlled local WinGet source or other documented WinGet test setup with two local manifests.

Checklist:

- [ ] Install older test version.
- [ ] Create a Session and memory entry.
- [ ] Upgrade to `vX.Y.Z` with WinGet.
- [ ] Confirm new `wld --version`.
- [ ] Confirm Sessions and memory data survive.
- [ ] Uninstall.
- [ ] Confirm package private helper files are removed.
- [ ] Confirm separately installed tools are untouched.

Manual ZIP replacement is not upgrade proof.

## 6. Submit

Use the current supported submit command:

```powershell
wingetcreate submit C:\path\to\Gandazgul.RunWield\X.Y.Z
```

Authenticate when prompted. Confirm the PR exists in `microsoft/winget-pkgs`.

If review requests changes, update the generator or docs in this repo, regenerate, and resubmit. Do not hand-edit
long-term manifest content without copying the fix back to the generator.

## 7. After acceptance

On a clean Windows x64 machine:

```powershell
winget source update
winget show --id Gandazgul.RunWield --exact
winget install --id Gandazgul.RunWield --exact
wld --version
wld update
```

Expected result: catalog install works and update still prints the WinGet command.

Then:

- [ ] Keep lasting instructions in `docs/releasing.md`, `docs/quickstart.md`, and `docs/troubleshooting.md`.
- [ ] Delete `docs/winget-first-release.md` in a normal cleanup change.
