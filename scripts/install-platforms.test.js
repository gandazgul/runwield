import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";

import {
    BINARY_NAMES,
    createFixture,
    readCurlLog,
    RELEASE_BINARY_NAMES,
    runInstaller,
    VERSIONS,
    writeExecutable,
} from "./install-test-helpers.js";

Deno.test("install.sh maps Darwin/Linux amd64/arm64 assets and preserves positional wld version", async (t) => {
    /** @type {Array<{ os: import("./install-test-helpers.js").TestOs, arch: import("./install-test-helpers.js").TestArch }>} */
    const platforms = [
        { os: "Darwin", arch: "x86_64" },
        { os: "Darwin", arch: "arm64" },
        { os: "Linux", arch: "x86_64" },
        { os: "Linux", arch: "arm64" },
    ];

    for (const platform of platforms) {
        await t.step(`${platform.os} ${platform.arch}`, async () => {
            const fixture = await createFixture(platform);
            try {
                const result = await runInstaller(fixture, { requestedVersion: VERSIONS.runwield });
                assertEquals(result.code, 0, `${result.stdout}\n${result.stderr}`);
                const curlLog = await readCurlLog(fixture.curlLog);
                for (const name of RELEASE_BINARY_NAMES) {
                    assertStringIncludes(curlLog, fixture.assets[name]);
                }
                for (const name of BINARY_NAMES) {
                    const stat = await Deno.stat(join(fixture.installDir, name));
                    assertEquals(stat.isFile, true);
                }
                assertStringIncludes(curlLog, `/download/${VERSIONS.runwield}/${fixture.assets.wld}`);
            } finally {
                await Deno.remove(fixture.root, { recursive: true });
            }
        });
    }
});

Deno.test("install.sh preserves helpers on PATH and in install dir, and idempotent reruns skip helper downloads", async () => {
    const fixture = await createFixture();
    const externalBin = join(fixture.root, "external-bin");
    await Deno.mkdir(externalBin);
    await writeExecutable(join(externalBin, "mnemosyne"), "#!/usr/bin/env bash\necho external mnemosyne\n");
    await writeExecutable(join(fixture.installDir, "cymbal"), "#!/usr/bin/env bash\necho existing cymbal\n");
    try {
        const first = await runInstaller(fixture, { extraPathDir: externalBin });
        assertEquals(first.code, 0, `${first.stdout}\n${first.stderr}`);
        assertStringIncludes(first.stdout, "Preserving existing mnemosyne");
        assertStringIncludes(first.stdout, "Preserving existing cymbal");
        assertStringIncludes(first.stdout, "agent-browser");
        assertStringIncludes(first.stdout, "snip");

        await Deno.writeTextFile(fixture.curlLog, "");
        const second = await runInstaller(fixture, { extraPathDir: externalBin });
        assertEquals(second.code, 0, `${second.stdout}\n${second.stderr}`);
        assertStringIncludes(second.stdout, "Preserving existing mnemosyne");
        assertStringIncludes(second.stdout, "Preserving existing cymbal");
        assertStringIncludes(second.stdout, "Preserving existing snip");
        const curlLog = await readCurlLog(fixture.curlLog);
        assertEquals(curlLog.includes("mnemosyne_"), false);
        assertEquals(curlLog.includes("cymbal_"), false);
        assertEquals(curlLog.includes("snip_"), false);
    } finally {
        await Deno.remove(fixture.root, { recursive: true });
    }
});
