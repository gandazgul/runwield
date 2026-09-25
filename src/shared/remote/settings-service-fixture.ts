import { startRemoteControlService } from "./control.ts";
import { setCustomSetting } from "../settings.js";

if (Deno.args[0] === "write") {
    await setCustomSetting("theme", "light", "global");
    Deno.exit(0);
}

const service = startRemoteControlService({ buildId: "b".repeat(64), protocol: 1 });
console.log(JSON.stringify({ port: service.port, credential: service.credential }));
const buffer = new Uint8Array(1);
await Deno.stdin.read(buffer);
await service.close();
