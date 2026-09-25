import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { withProcessGlobalTestLock } from "../../testing/process-global-lock.js";
import { getCustomSetting, setCustomSetting } from "../settings.js";
import { startRemoteControlService } from "./control.ts";

const identity = { buildId: "b".repeat(64), protocol: 1 };

Deno.test("laptop settings updates need the live authenticated connection and preserve other fields", async () => {
    await withProcessGlobalTestLock(async () => {
        const home = await Deno.makeTempDir();
        const previous = Deno.env.get("HOME");
        Deno.env.set("HOME", home);
        const service = startRemoteControlService(identity);
        const address = `http://127.0.0.1:${service.port}`;
        const headers = { Authorization: `Bearer ${service.credential}` };
        const request = (id: string, update: { kind: string; key: string; value: number | string }) =>
            fetch(`${address}/settings/update`, { method: "POST", headers, body: JSON.stringify({ id, update }) });
        try {
            await Deno.mkdir(join(home, ".wld"));
            await Deno.writeTextFile(
                join(home, ".wld", "settings.json"),
                JSON.stringify({ other: 3, compaction: { keepRecentTokens: 9 } }),
            );
            const id = "1".repeat(32);
            assertEquals((await request(id, { kind: "set", key: "theme", value: "dark" })).status, 403);
            assertEquals((await fetch(`${address}/settings/snapshot`)).status, 401);
            await fetch(`${address}/handshake`, { method: "POST", headers, body: JSON.stringify(identity) });
            await fetch(`${address}/readiness`, { method: "POST", headers });
            assertEquals((await request(id, { kind: "set", key: "theme", value: "dark" })).status, 200);
            // A separate local settings writer may change an unrelated field before a retry.
            await setCustomSetting("other", 4, "global");
            assertEquals((await request(id, { kind: "set", key: "theme", value: "dark" })).status, 200);
            const receipt = await (await fetch(`${address}/settings/receipt/${id}`, { headers })).json();
            assertEquals(JSON.parse(receipt.snapshot).theme, "dark");
            assertEquals(getCustomSetting("other", "global"), 4);
            assertEquals((await request(id, { kind: "set", key: "theme", value: "light" })).status, 409);
            const nested = await request("2".repeat(32), { kind: "compaction", key: "reserveTokens", value: 120 });
            assertEquals(nested.status, 200);
            assertEquals(
                (await fetch(`${address}/settings/update`, {
                    method: "POST",
                    headers,
                    body: JSON.stringify({
                        id: "4".repeat(32),
                        update: { kind: "model", model: "model-x", provider: "provider-y" },
                    }),
                })).status,
                200,
            );
            const snapshot = await (await fetch(`${address}/settings/snapshot`, { headers })).json();
            assertEquals(JSON.parse(snapshot.snapshot), {
                other: 4,
                compaction: { keepRecentTokens: 9, reserveTokens: 120 },
                theme: "dark",
                defaultModel: "model-x",
                defaultProvider: "provider-y",
            });
            service.requestShutdown();
            assertEquals((await request("3".repeat(32), { kind: "set", key: "theme", value: "light" })).status, 403);
        } finally {
            await service.close();
            if (previous === undefined) Deno.env.delete("HOME");
            else Deno.env.set("HOME", previous);
            await Deno.remove(home, { recursive: true });
        }
    });
});
