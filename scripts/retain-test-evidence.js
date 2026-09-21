/** Keep Golden diagnostics outside the disposable test sandbox, not its cache or HOME. */
import { join } from "@std/path";

/** @param {string} sandbox @param {string} destination */
export async function retainTestEvidence(sandbox, destination) {
    for await (const slot of Deno.readDir(sandbox)) {
        if (!slot.isDirectory || !slot.name.startsWith("tmp-")) continue;
        for await (const entry of Deno.readDir(join(sandbox, slot.name))) {
            if (!entry.isDirectory || !/^runwield-golden-tui-(timeout|child-failure)-/.test(entry.name)) continue;
            await Deno.mkdir(destination, { recursive: true });
            await Deno.rename(join(sandbox, slot.name, entry.name), join(destination, entry.name));
        }
    }
}
