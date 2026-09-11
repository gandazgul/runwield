import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { packageMetadataPathForExecutablePath, readRunWieldPackageInstallSync } from "./package-install.ts";

Deno.test("package metadata is read beside the real executable", async () => {
    const root = await Deno.makeTempDir({ prefix: "runwield-package-install-" });
    try {
        const libexec = join(root, "Cellar", "wld", "libexec");
        const bin = join(root, "bin");
        await Deno.mkdir(libexec, { recursive: true });
        await Deno.mkdir(bin, { recursive: true });
        const exe = join(libexec, "wld");
        const link = join(bin, "wld");
        await Deno.writeTextFile(exe, "fixture");
        await Deno.symlink(exe, link);
        await Deno.writeTextFile(
            join(libexec, "runwield-install.json"),
            JSON.stringify({
                schemaVersion: 1,
                packageManager: "homebrew",
                packageIdentifier: "gandazgul/tap/wld",
                updateCommand: "brew upgrade gandazgul/tap/wld",
                repairCommand: "brew reinstall gandazgul/tap/wld",
                installDirectory: libexec,
                version: "v1.2.3",
            }),
        );

        assertEquals(
            packageMetadataPathForExecutablePath(link),
            join(await Deno.realPath(libexec), "runwield-install.json"),
        );
        assertEquals(readRunWieldPackageInstallSync(link)?.updateCommand, "brew upgrade gandazgul/tap/wld");
    } finally {
        await Deno.remove(root, { recursive: true });
    }
});

Deno.test("invalid or absent package metadata does not classify a standalone executable", async () => {
    const root = await Deno.makeTempDir({ prefix: "runwield-package-install-" });
    try {
        const exe = join(root, "wld");
        await Deno.writeTextFile(exe, "fixture");
        assertEquals(readRunWieldPackageInstallSync(exe), null);
        await Deno.writeTextFile(join(root, "runwield-install.json"), JSON.stringify({ packageManager: "homebrew" }));
        assertEquals(readRunWieldPackageInstallSync(exe), null);
    } finally {
        await Deno.remove(root, { recursive: true });
    }
});
