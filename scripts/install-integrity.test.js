import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";

import { createFixture, runInstaller } from "./install-test-helpers.js";

Deno.test("install.sh uses GitHub asset digest when helper checksum manifest omits an asset", async () => {
    const fixture = await createFixture({ omitChecksumFor: "mnemosyne" });
    try {
        const result = await runInstaller(fixture);
        assertEquals(result.code, 0, `${result.stdout}\n${result.stderr}`);
        assertStringIncludes(result.stderr, "Checksum manifest lacks an entry for mnemosyne");
        assertStringIncludes(result.stdout, "Using GitHub release asset digest for mnemosyne");
        const stat = await Deno.stat(join(fixture.installDir, "mnemosyne"));
        assertEquals(stat.isFile, true);
    } finally {
        await Deno.remove(fixture.root, { recursive: true });
    }
});

Deno.test("install.sh rejects missing or corrupt checksum coverage", async (t) => {
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
        const fixture = await createFixture({ badChecksumFor: "mnemosyne" });
        try {
            const result = await runInstaller(fixture);
            assertEquals(result.code, 1);
            assertStringIncludes(result.stderr, "Checksum verification failed for mnemosyne");
        } finally {
            await Deno.remove(fixture.root, { recursive: true });
        }
    });

    await t.step("corrupt release asset digest", async () => {
        const fixture = await createFixture({ omitChecksumFor: "mnemosyne", badDigestFor: "mnemosyne" });
        try {
            const result = await runInstaller(fixture);
            assertEquals(result.code, 1);
            assertStringIncludes(result.stderr, "Checksum manifest lacks an entry for mnemosyne");
            assertStringIncludes(result.stderr, "Checksum verification failed for mnemosyne");
        } finally {
            await Deno.remove(fixture.root, { recursive: true });
        }
    });
});

Deno.test("install.sh rejects missing executables in required helper archives", async () => {
    const fixture = await createFixture({ missingExecutableFor: "mnemosyne" });
    try {
        const result = await runInstaller(fixture);
        assertEquals(result.code, 1);
        assertStringIncludes(result.stderr, "does not contain executable 'mnemosyne'");
        assertStringIncludes(result.stderr, "Required helper Mnemosyne could not be installed");
    } finally {
        await Deno.remove(fixture.root, { recursive: true });
    }
});

Deno.test("install.sh aborts on required helper download failure but not optional Snip failure", async (t) => {
    await t.step("required Mnemosyne failure", async () => {
        const fixture = await createFixture({ missingAssetFor: "mnemosyne" });
        try {
            const result = await runInstaller(fixture);
            assertEquals(result.code, 1);
            assertStringIncludes(result.stderr, "Failed to download mnemosyne archive");
            assertStringIncludes(result.stderr, "Required helper Mnemosyne could not be installed");
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
            for (const name of ["wld", "mnemosyne", "cymbal", "agent-browser"]) {
                const stat = await Deno.stat(join(fixture.installDir, name));
                assertEquals(stat.isFile, true);
            }
            await assertRejects(() => Deno.stat(join(fixture.installDir, "snip")), Deno.errors.NotFound);
        } finally {
            await Deno.remove(fixture.root, { recursive: true });
        }
    });
});
