import { dirname, join } from "@std/path";
import { getRunWieldRuntimeDir } from "../../constants.js";
import { migrateLegacyProjectRuntimeState } from "../project-runtime-layout.ts";

const [command, checkoutRoot, extra] = Deno.args;

if (command === "migrate") {
    const result = await migrateLegacyProjectRuntimeState(checkoutRoot);
    console.log(JSON.stringify(result));
} else if (command === "hold-controller-lock") {
    const lockPath = extra || join(getRunWieldRuntimeDir(checkoutRoot), "controller", "plans", "driver.json.lock");
    await Deno.mkdir(dirname(lockPath), { recursive: true }).catch(() => {});
    const file = await Deno.open(lockPath, { create: true, read: true, write: true });
    await file.lock(true);
    console.log(JSON.stringify({ ready: true, lockPath }));
    await new Promise(() => {});
} else {
    console.error(`Unknown project runtime migration process driver command: ${command}`);
    Deno.exit(2);
}
