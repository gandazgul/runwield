import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";

Deno.test("package:homebrew:check registers a tap when brew reports a missing conventional path", async () => {
    const root = await Deno.makeTempDir();
    const tap = join(root, "rendered-tap");
    const bin = join(root, "bin");
    const log = join(root, "brew.log");
    const missingTap = join(root, "missing-homebrew-tap");
    try {
        await Deno.mkdir(join(tap, "Formula"), { recursive: true });
        await Deno.mkdir(bin);
        await Deno.writeTextFile(join(tap, "Formula", "wld.rb"), "class Wld < Formula\nend\n");
        await Deno.writeTextFile(join(tap, "Formula", "mnemoteca.rb"), "class Mnemoteca < Formula\nend\n");
        await Deno.writeTextFile(
            join(tap, "runwield-homebrew-package.json"),
            `${JSON.stringify({ wldTag: "v1.2.3", mnemotecaTag: "v0.3.3" })}\n`,
        );
        const brew = join(bin, "brew");
        await Deno.writeTextFile(
            brew,
            `#!/bin/sh
printf '%s\\n' "$*" >> "$BREW_LOG"
if [ "$1" = "--repo" ]; then
    printf '%s\\n' "$MISSING_TAP"
    exit 0
fi
if [ "$1" = "trust" ]; then exit 0; fi
if [ "$1" = "tap" ]; then exit 0; fi
printf 'intentional stop after tap registration\\n' >&2
exit 42
`,
        );
        await Deno.chmod(brew, 0o755);

        const output = await new Deno.Command(Deno.execPath(), {
            args: ["run", "-A", "scripts/package-homebrew-check.js", "--tap", tap],
            cwd: Deno.cwd(),
            env: {
                PATH: `${bin}:${Deno.env.get("PATH") || ""}`,
                BREW_LOG: log,
                MISSING_TAP: missingTap,
            },
            stdout: "piped",
            stderr: "piped",
        }).output();
        const stderr = new TextDecoder().decode(output.stderr);
        const calls = (await Deno.readTextFile(log)).trim().split("\n");

        assertEquals(output.success, false);
        assertStringIncludes(stderr, "intentional stop after tap registration");
        assertEquals(calls.slice(0, 3), [
            "--repo gandazgul/tap",
            `trust file://${tap}`,
            `tap gandazgul/tap file://${tap}`,
        ]);
    } finally {
        await Deno.remove(root, { recursive: true });
    }
});
