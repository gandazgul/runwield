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
