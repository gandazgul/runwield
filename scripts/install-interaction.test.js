import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";

import { createFixture, runInstaller, runInstallerInPseudoTty } from "./install-test-helpers.js";

Deno.test("install.sh non-interactive mode prints one PATH recommendation without prompts", async () => {
    const fixture = await createFixture();
    try {
        const result = await runInstaller(fixture);
        assertEquals(result.code, 0, `${result.stdout}\n${result.stderr}`);
        assertStringIncludes(result.stdout, "Restart your shell or run:");
        assertStringIncludes(result.stdout, `export PATH=\"${fixture.installDir}:$PATH\"`);
        assertEquals(result.stdout.includes("Add " + fixture.installDir + " to your PATH"), false);
    } finally {
        await Deno.remove(fixture.root, { recursive: true });
    }
});

Deno.test("install.sh recognizes newly installed Snip for filter setup before shell reload", async () => {
    const fixture = await createFixture();
    const filterLog = join(fixture.root, "filter.log");
    try {
        const result = await runInstallerInPseudoTty(fixture, "n\n\n", { extraEnv: { WLD_FILTER_LOG: filterLog } });
        assertEquals(result.code, 0, `${result.stdout}\n${result.stderr}`);
        assertStringIncludes(result.stdout, "RunWield Deno Snip filters installed");
        const log = await Deno.readTextFile(filterLog);
        assertStringIncludes(log, `snip=${join(fixture.installDir, "snip")}`);
        assertStringIncludes(log, `path=${fixture.installDir}:`);
    } finally {
        await Deno.remove(fixture.root, { recursive: true });
    }
});
