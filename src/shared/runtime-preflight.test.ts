import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { withProcessGlobalTestLock } from "../testing/process-global-lock.js";
import { ensureCymbalBinary, ensureKetchBinary, ensureMnemosyneBinary, hasSnipBinary } from "./runtime-preflight.ts";

async function writeAvailableBinary(directory: string, name: string): Promise<string> {
    const path = join(directory, name);
    await Deno.writeTextFile(path, "#!/bin/sh\nexit 0\n");
    await Deno.chmod(path, 0o755);
    return path;
}

function runtimePreflightTest(name: string, run: (binaryDirectory: string) => Promise<void>): void {
    Deno.test(name, () =>
        withProcessGlobalTestLock(async () => {
            const previousPath = Deno.env.get("PATH");
            const binaryDirectory = await Deno.makeTempDir({ prefix: "runwield-runtime-binaries-" });
            Deno.env.set("PATH", binaryDirectory);
            try {
                await run(binaryDirectory);
            } finally {
                if (previousPath === undefined) Deno.env.delete("PATH");
                else Deno.env.set("PATH", previousPath);
                await Deno.remove(binaryDirectory, { recursive: true }).catch(() => {});
            }
        }));
}

runtimePreflightTest(
    "required runtime binaries cache real PATH probe results while optional Snip stays live",
    async (dir) => {
        const mnemosyne = await writeAvailableBinary(dir, "mnemosyne");
        const cymbal = await writeAvailableBinary(dir, "cymbal");
        const ketch = await writeAvailableBinary(dir, "ketch");
        const snip = await writeAvailableBinary(dir, "snip");

        await ensureMnemosyneBinary();
        await ensureCymbalBinary();
        await ensureKetchBinary();
        assertEquals(await hasSnipBinary(), true);

        await Deno.remove(mnemosyne);
        await Deno.remove(cymbal);
        await Deno.remove(ketch);
        await Deno.remove(snip);

        await ensureMnemosyneBinary();
        await ensureCymbalBinary();
        await ensureKetchBinary();
        assertEquals(await hasSnipBinary(), false);
    },
);

runtimePreflightTest("runtime preflight reports install guidance when fixture binaries are missing", async () => {
    const mnemosyneError = await assertRejects(
        () => ensureMnemosyneBinary(),
        Error,
        "Mnemosyne binary not found",
    );
    assertStringIncludes(mnemosyneError.message, "Rerun the RunWield installer");
    assertStringIncludes(mnemosyneError.message, "raw.githubusercontent.com/gandazgul/runwield/main/install.sh");

    const cymbalError = await assertRejects(
        () => ensureCymbalBinary(),
        Error,
        "Cymbal binary not found",
    );
    assertStringIncludes(cymbalError.message, "Rerun the RunWield installer");

    const ketchError = await assertRejects(
        () => ensureKetchBinary(),
        Error,
        "Ketch binary not found",
    );
    assertStringIncludes(ketchError.message, "Rerun the RunWield installer");
});
