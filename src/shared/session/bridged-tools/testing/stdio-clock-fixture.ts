import { FakeTime } from "@std/testing/time";
import { runRunWieldMcpStdioTransport } from "../stdio-transport.ts";

// Advance only this subprocess's clock while the real HTTP/stdio tool call waits.
// Production uses its normal transports and timeout policy without injection.
const advancePath = Deno.args[0];
const advancedPath = Deno.args[1];
const realSetInterval = globalThis.setInterval;
const realClearInterval = globalThis.clearInterval;
using time = new FakeTime();
const timer = realSetInterval(() => {
    try {
        Deno.statSync(advancePath);
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) return;
        throw error;
    }
    realClearInterval(timer);
    time.tick(61_000);
    Deno.writeTextFileSync(advancedPath, "advanced");
}, 10);
try {
    await runRunWieldMcpStdioTransport();
} finally {
    realClearInterval(timer);
}
