import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
    bundledHelperDirectoryForInstall,
    packageMetadataPathForExecutablePath,
    prependToPathEnv,
    readRunWieldPackageInstallSync,
} from "./package-install.ts";

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
        await Deno.writeTextFile(
            join(libexec, "runwield-install.json"),
            JSON.stringify({
                schemaVersion: 1,
                packageManager: "winget",
                packageIdentifier: "Gandazgul.RunWield",
                updateCommand: "winget upgrade --id Gandazgul.RunWield --exact",
                repairCommand: "winget repair --id Gandazgul.RunWield --exact",
                installDirectory: ".",
                version: "v1.2.3",
            }),
        );
        assertEquals(readRunWieldPackageInstallSync(link)?.installDirectory, await Deno.realPath(libexec));
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

Deno.test("WinGet helper lookup requires a complete sibling helper directory", async () => {
    const root = await Deno.makeTempDir({ prefix: "runwield package install spaces-" });
    try {
        const helpers = join(root, "runtime", "helpers");
        await Deno.mkdir(helpers, { recursive: true });
        const suffix = Deno.build.os === "windows" ? ".exe" : "";
        const install = {
            schemaVersion: 1 as const,
            packageManager: "winget" as const,
            packageIdentifier: "Gandazgul.RunWield",
            updateCommand: "winget upgrade --id Gandazgul.RunWield --exact",
            repairCommand: "winget repair --id Gandazgul.RunWield --exact",
            installDirectory: root,
            version: "v1.2.3",
        };
        for (const name of ["mnemoteca", "cymbal", "ketch"]) {
            await Deno.writeTextFile(join(helpers, `${name}${suffix}`), name);
        }
        assertEquals(bundledHelperDirectoryForInstall(install), null);
        await Deno.writeTextFile(join(helpers, `agent-browser${suffix}`), "agent-browser");
        assertEquals(bundledHelperDirectoryForInstall(install), helpers);
    } finally {
        await Deno.remove(root, { recursive: true });
    }
});

Deno.test("PATH prepending preserves Windows Path key casing", () => {
    const key = Deno.build.os === "windows" ? "Path" : "PATH";
    const env = prependToPathEnv({ [key]: "C:\\Windows" }, "C:\\Run Wield\\runtime\\helpers");
    assertEquals(env[key].startsWith("C:\\Run Wield\\runtime\\helpers"), true);
});
