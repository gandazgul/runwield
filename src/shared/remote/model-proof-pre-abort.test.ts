import { assertRejects } from "@std/assert";
import { join } from "@std/path";
import { runRemoteModelProof } from "./model-proof.ts";

Deno.test("LIVE proof does not start after its connection closes", async () => {
    const root = await Deno.makeTempDir();
    const project = join(root, "project");
    const personal = join(root, "personal");
    await Deno.mkdir(project);
    await Deno.mkdir(personal);
    await Deno.writeTextFile(join(project, "sentinel.txt"), "remote-test");
    const controller = new AbortController();
    controller.abort();
    try {
        await assertRejects(
            () =>
                runRemoteModelProof({
                    proof: { provider: "proof-local", modelId: "test", sentinelFile: "sentinel.txt" },
                    mount: { globalRoot: personal, lost: Promise.resolve(), close: () => Promise.resolve() },
                    connection: { port: 1, credential: "a".repeat(64) },
                    cwd: project,
                    signal: controller.signal,
                }),
            DOMException,
            "aborted",
        );
    } finally {
        await Deno.remove(root, { recursive: true });
    }
});
