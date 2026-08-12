import { createKetchTools } from "./tools.ts";
export {
    createKetchTools,
    webCodeSearchToolDef,
    webDocsSearchToolDef,
    webFetchToolDef,
    webSearchToolDef,
} from "./tools.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function ketchExtension(pi: ExtensionAPI): void {
    const host = {
        cwd: Deno.cwd(),
        exec(command: string, args: string[], options: { cwd: string; signal?: AbortSignal }) {
            return pi.exec(command, args, options);
        },
    };

    pi.on("session_start", (_event, ctx) => {
        host.cwd = ctx.cwd;
    });

    for (const tool of createKetchTools(host)) {
        pi.registerTool(tool);
    }
}
