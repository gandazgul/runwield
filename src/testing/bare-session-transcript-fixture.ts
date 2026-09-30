import { join } from "@std/path";
import { encodeCwdForSessionDir } from "../shared/session/root-session.js";

/** Write a minimal Pi transcript in the Session store's project directory. */
export async function writeBareSessionTranscript(
    sessionBaseDir: string,
    projectRoot: string,
    piSessionId: string,
    timestamp: string,
): Promise<string> {
    const sessionDir = join(sessionBaseDir, encodeCwdForSessionDir(await Deno.realPath(projectRoot)));
    await Deno.mkdir(sessionDir, { recursive: true });
    const transcriptPath = join(sessionDir, `${timestamp.replace(/[:.]/g, "-")}_${piSessionId}.jsonl`);
    await Deno.writeTextFile(
        transcriptPath,
        `${JSON.stringify({ type: "session", version: 3, id: piSessionId, timestamp, cwd: projectRoot })}\n`,
    );
    return transcriptPath;
}
