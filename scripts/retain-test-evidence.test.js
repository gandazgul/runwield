import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { retainTestEvidence } from "./retain-test-evidence.js";

Deno.test("test cleanup retains Golden failure diagnostics but not sandbox HOME or caches", async () => {
    const root = await Deno.makeTempDir();
    try {
        const sandbox = join(root, "sandbox");
        const destination = join(root, "evidence");
        for (
            const path of ["home-slot", "deno-dir", "tmp-slot/unrelated", "tmp-slot/runwield-golden-tui-timeout-123"]
        ) {
            await Deno.mkdir(join(sandbox, path), { recursive: true });
            await Deno.writeTextFile(join(sandbox, path, "data.json"), "evidence");
        }
        await retainTestEvidence(sandbox, destination);
        await Deno.remove(sandbox, { recursive: true });
        assertEquals(
            await Deno.readTextFile(join(destination, "runwield-golden-tui-timeout-123/data.json")),
            "evidence",
        );
        assertEquals(await Array.fromAsync(Deno.readDir(destination), (entry) => entry.name), [
            "runwield-golden-tui-timeout-123",
        ]);
    } finally {
        await Deno.remove(root, { recursive: true });
    }
});
