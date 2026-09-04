import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";

import { createFixture, readCurlLog, runInstaller, runInstallerInPseudoTty } from "./install-test-helpers.js";

Deno.test("install.sh delegates missing Mnemoteca installs to the official installer", async (t) => {
    await t.step("sandbox database variable present", async () => {
        const fixture = await createFixture();
        try {
            const result = await runInstaller(fixture, {
                extraEnv: { MNEMOTECA_DB_PATH: join(fixture.root, "memory.db") },
            });
            assertEquals(result.code, 0, `${result.stdout}\n${result.stderr}`);
            const curlLog = await readCurlLog(fixture.curlLog);
            assertEquals(curlLog.split("raw.githubusercontent.com/gandazgul/mnemoteca/main/install.sh").length - 1, 1);
            const installerLog = await Deno.readTextFile(fixture.mnemotecaInstallerLog);
            assertStringIncludes(installerLog, "repo=gandazgul/mnemoteca");
            assertStringIncludes(installerLog, `install_dir=${fixture.installDir}`);
            assertStringIncludes(installerLog, `db_path=${join(fixture.root, "memory.db")}`);
            const stat = await Deno.stat(join(fixture.installDir, "mnemoteca"));
            assertEquals(stat.isFile, true);
        } finally {
            await Deno.remove(fixture.root, { recursive: true });
        }
    });

    await t.step("sandbox database variable absent", async () => {
        const fixture = await createFixture();
        try {
            const result = await runInstaller(fixture, { unsetEnv: ["MNEMOTECA_DB_PATH"] });
            assertEquals(result.code, 0, `${result.stdout}\n${result.stderr}`);
            const curlLog = await readCurlLog(fixture.curlLog);
            assertEquals(curlLog.split("raw.githubusercontent.com/gandazgul/mnemoteca/main/install.sh").length - 1, 1);
            const installerLog = await Deno.readTextFile(fixture.mnemotecaInstallerLog);
            assertStringIncludes(installerLog, "db_path=unset");
        } finally {
            await Deno.remove(fixture.root, { recursive: true });
        }
    });
});

Deno.test("install.sh rejects Mnemoteca installer failure and false success", async (t) => {
    await t.step("installer exits with failure", async () => {
        const fixture = await createFixture({ mnemotecaInstallerFails: true });
        try {
            const result = await runInstaller(fixture);
            assertEquals(result.code, 1);
            assertStringIncludes(result.stderr, "Mnemoteca installer failed");
            assertStringIncludes(result.stderr, "Required helper Mnemoteca could not be installed");
            await assertRejects(() => Deno.stat(join(fixture.installDir, "mnemoteca")), Deno.errors.NotFound);
        } finally {
            await Deno.remove(fixture.root, { recursive: true });
        }
    });

    await t.step("installer exits without producing executable", async () => {
        const fixture = await createFixture({ mnemotecaInstallerSkipsExecutable: true });
        try {
            const result = await runInstaller(fixture);
            assertEquals(result.code, 1);
            assertStringIncludes(result.stderr, "did not produce executable");
            assertStringIncludes(result.stderr, "Required helper Mnemoteca could not be installed");
            await assertRejects(() => Deno.stat(join(fixture.installDir, "mnemoteca")), Deno.errors.NotFound);
        } finally {
            await Deno.remove(fixture.root, { recursive: true });
        }
    });
});

Deno.test("install.sh forwards pseudo-terminal input to the delegated Mnemoteca installer", async () => {
    const fixture = await createFixture({ mnemotecaInstallerPrompts: true });
    try {
        const result = await runInstallerInPseudoTty(fixture, "\ny\n\nn\n");
        assertEquals(result.code, 0, `${result.stdout}\n${result.stderr}`);
        const installerLog = await Deno.readTextFile(fixture.mnemotecaInstallerLog);
        assertStringIncludes(installerLog, "answer=y");
    } finally {
        await Deno.remove(fixture.root, { recursive: true });
    }
});

Deno.test("install.sh rejects missing or corrupt checksum coverage for archive helpers", async (t) => {
    await t.step("missing manifest entry and missing release asset digest", async () => {
        const fixture = await createFixture({ omitChecksumFor: "cymbal", omitDigestFor: "cymbal" });
        try {
            const result = await runInstaller(fixture);
            assertEquals(result.code, 1);
            assertStringIncludes(result.stderr, "Checksum manifest lacks an entry for cymbal");
            assertStringIncludes(result.stderr, "Could not find a SHA-256 release asset digest for cymbal");
            assertStringIncludes(result.stderr, "Checksum verification failed for cymbal");
        } finally {
            await Deno.remove(fixture.root, { recursive: true });
        }
    });

    await t.step("corrupt checksum", async () => {
        const fixture = await createFixture({ badChecksumFor: "cymbal" });
        try {
            const result = await runInstaller(fixture);
            assertEquals(result.code, 1);
            assertStringIncludes(result.stderr, "Checksum verification failed for cymbal");
        } finally {
            await Deno.remove(fixture.root, { recursive: true });
        }
    });

    await t.step("corrupt release asset digest", async () => {
        const fixture = await createFixture({ omitChecksumFor: "cymbal", badDigestFor: "cymbal" });
        try {
            const result = await runInstaller(fixture);
            assertEquals(result.code, 1);
            assertStringIncludes(result.stderr, "Checksum manifest lacks an entry for cymbal");
            assertStringIncludes(result.stderr, "Checksum verification failed for cymbal");
        } finally {
            await Deno.remove(fixture.root, { recursive: true });
        }
    });
});

Deno.test("install.sh rejects missing executables in required archive helper archives", async () => {
    const fixture = await createFixture({ missingExecutableFor: "cymbal" });
    try {
        const result = await runInstaller(fixture);
        assertEquals(result.code, 1);
        assertStringIncludes(result.stderr, "does not contain executable 'cymbal'");
        assertStringIncludes(result.stderr, "Required helper Cymbal could not be installed");
    } finally {
        await Deno.remove(fixture.root, { recursive: true });
    }
});

Deno.test("install.sh aborts on required helper download failure but not optional Snip failure", async (t) => {
    await t.step("required Cymbal failure", async () => {
        const fixture = await createFixture({ missingAssetFor: "cymbal" });
        try {
            const result = await runInstaller(fixture);
            assertEquals(result.code, 1);
            assertStringIncludes(result.stderr, "Failed to download cymbal archive");
            assertStringIncludes(result.stderr, "Required helper Cymbal could not be installed");
        } finally {
            await Deno.remove(fixture.root, { recursive: true });
        }
    });

    await t.step("optional Snip failure", async () => {
        const fixture = await createFixture({ missingAssetFor: "snip" });
        try {
            const result = await runInstaller(fixture);
            assertEquals(result.code, 0, `${result.stdout}\n${result.stderr}`);
            assertStringIncludes(result.stderr, "Warning: optional helper Snip could not be installed");
            for (const name of ["wld", "mnemoteca", "cymbal", "agent-browser"]) {
                const stat = await Deno.stat(join(fixture.installDir, name));
                assertEquals(stat.isFile, true);
            }
            await assertRejects(() => Deno.stat(join(fixture.installDir, "snip")), Deno.errors.NotFound);
        } finally {
            await Deno.remove(fixture.root, { recursive: true });
        }
    });
});
