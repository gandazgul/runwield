# Manual QA for package-manager-distribution

This checklist is advisory. It does not change RunWield verification status.

<!-- runwield:manual-qa:start child="package-manager-distribution/01-homebrew-tap" -->

## Prepare the RunWield and Mnemoteca Homebrew Tap

Manual verification steps for package-manager-distribution/01-homebrew-tap

- [ ] On Apple Silicon and Intel macOS, install the generated `wld` and `mnemoteca` formulas and confirm both commands
      run.
- [ ] Confirm formula installation does not run the shell installer, download models or browsers, request credentials,
      or replace unrelated helper installations.
- [ ] Use the documented first-use setup and verify Mnemoteca, Cymbal, Ketch, and agent-browser produce real results.
- [ ] From the Homebrew installation, run `wld update` and `wld upgrade` and confirm they show the Homebrew upgrade
      instruction, do not run the shell installer, and leave package files unchanged.
- [ ] Upgrade and uninstall RunWield, then confirm user data and separately installed helpers remain available and the
      RunWield command is removed.
- [ ] Review the exported tap and release instructions and confirm they contain real version, URL, checksum, and license
      values and clearly mark owner publication as pending.

<!-- runwield:manual-qa:end child="package-manager-distribution/01-homebrew-tap" -->

<!-- runwield:manual-qa:start child="package-manager-distribution/02-windows-winget-readiness" -->

## Prepare Native Windows and the WinGet Release Handoff

Manual verification steps for package-manager-distribution/02-windows-winget-readiness

- [ ] On a clean Windows x64 machine, install the package with WinGet from the generated manifest, then run
      `wld version` and `wld help` from both PowerShell and cmd.
- [ ] With no bundled helper on global PATH, run a provider setup and one authenticated Agent turn; save and resume the
      Session on a disposable user profile.
- [ ] Launch ACP and Workspace from the installed package, complete a Session request and browser pairing, and confirm
      an authorized artifact loads while an unrelated Session returns 404.
- [ ] Create a Git project, make a change, and publish it through both local and local-bare-remote workflows; confirm
      file contents, commit ancestry, and unrelated dirty files remain unchanged.
- [ ] Run both update aliases with version, RC, downgrade, and `WLD_INSTALL_DIR` options; confirm they show the WinGet
      upgrade command, do not run Bash, and do not change package files.
- [ ] Upgrade and uninstall the package through WinGet; confirm the new version runs, user Sessions and settings remain,
      bundled files are removed, and separately installed tools remain unchanged.

<!-- runwield:manual-qa:end child="package-manager-distribution/02-windows-winget-readiness" -->
