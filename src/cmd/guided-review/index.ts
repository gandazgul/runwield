import { getCwd } from "../../constants.js";
import { createSessionRuntime } from "../../shared/session/session-runtime.js";
import { RuntimeEventTypes } from "../../shared/session/session-runtime-events.js";
import { encodeGuidedReviewUsageEvent, type GuidedReviewUsage } from "./protocol.ts";

export interface GuidedReviewCommandIo {
    readStdin: () => Promise<string>;
    writeStdout: (text: string) => void | Promise<void>;
    writeStderr: (text: string) => void | Promise<void>;
}

interface RuntimeUsageEventLike {
    type: string;
    usage?: GuidedReviewUsage;
}

const encoder = new TextEncoder();

async function readDefaultStdin(): Promise<string> {
    return await new Response(Deno.stdin.readable).text();
}

async function writeDefaultStdout(text: string): Promise<void> {
    await Deno.stdout.write(encoder.encode(text));
}

async function writeDefaultStderr(text: string): Promise<void> {
    await Deno.stderr.write(encoder.encode(text));
}

function isRuntimeUsageEvent(
    event: RuntimeUsageEventLike,
): event is RuntimeUsageEventLike & { usage: GuidedReviewUsage } {
    return event.type === RuntimeEventTypes.USAGE && Boolean(event.usage);
}

export function createGuidedReviewCliIo(): GuidedReviewCommandIo {
    return {
        readStdin: readDefaultStdin,
        writeStdout: writeDefaultStdout,
        writeStderr: writeDefaultStderr,
    };
}

export async function runGuidedReviewCommand(io: GuidedReviewCommandIo): Promise<number> {
    const prompt = await io.readStdin();
    if (!prompt.trim()) {
        await io.writeStderr("RunWield Guided Review requires a prompt on stdin.\n");
        return 1;
    }

    const runtime = createSessionRuntime({ ownerProcessKind: "workspace" });
    const sessionId = await runtime.createPromptReadySession({ cwd: getCwd(), agentName: "guide" });
    const pendingUsageWrites: Promise<void>[] = [];
    const unsubscribe = runtime.subscribeSessionEvents(sessionId, (event: RuntimeUsageEventLike) => {
        if (!isRuntimeUsageEvent(event)) return;
        pendingUsageWrites.push(
            Promise.resolve().then(() => io.writeStderr(encodeGuidedReviewUsageEvent(event.usage))),
        );
    });
    try {
        const result = await runtime.promptSession(sessionId, {
            initialRequest: prompt,
            emitInitialEvents: false,
        });
        await Promise.all(pendingUsageWrites);
        if (!result.ok) throw new Error(result.error || "Guided Review generation failed.");
        const output = await runtime.getLastAssistantText(sessionId);
        if (!output) throw new Error("RunWield Guided Review returned no assistant output.");
        await io.writeStdout(`${output}\n`);
        return 0;
    } finally {
        unsubscribe();
        runtime.closeSession(sessionId);
    }
}
