# Homebrew tap preparation

This directory prepares `gandazgul/homebrew-tap` output for macOS.

Generate formulas from immutable Stable release assets:

```bash
deno task package:homebrew --wld-tag vX.Y.Z --mnemoteca-tag v0.3.1 --output /tmp/runwield-tap
```

Check the rendered tap on macOS before publishing it:

```bash
deno task package:homebrew:check --tap /tmp/runwield-tap
```

The first public tap must use a RunWield Stable release that includes package-owner metadata. Do not publish a formula
that points at an older `wld` binary and only test a newer local binary.

The generated `wld` formula depends on:

- `gandazgul/tap/mnemoteca`
- `1broseidon/tap/cymbal`
- `1broseidon/tap/ketch`
- `agent-browser`
- `git`

Formula installation does not run account setup, Mnemoteca model setup, or `agent-browser install`. Those remain first
use steps.
