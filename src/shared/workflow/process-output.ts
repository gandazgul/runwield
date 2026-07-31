/**
 * @module shared/workflow/process-output
 * Capture the tail of a child process's output without buffering all of it.
 *
 * Nothing here is validation-specific — it is the stream handling that local
 * validation commands need and that `Deno.Command.output()` cannot provide.
 */

/** The retained tail of one process stream, plus what was dropped to keep it. */
export interface CapturedProcessStream {
    text: string;
    totalBytes: number;
    truncated: boolean;
}

/** Default tail budget per stream. Large enough that most runs are not truncated at all. */
export const PROCESS_STREAM_OUTPUT_LIMIT_BYTES = 1024 * 1024;

function concatBytes(left: Uint8Array<ArrayBufferLike>, right: Uint8Array<ArrayBufferLike>): Uint8Array<ArrayBuffer> {
    const combined = new Uint8Array(left.byteLength + right.byteLength);
    combined.set(left, 0);
    combined.set(right, left.byteLength);
    return combined;
}

/**
 * Read a process stream without using `Deno.Command.output()`, whose internal
 * buffer can throw before a large-but-successful validation command finishes.
 *
 * The tail is kept rather than the head because build and test failures are
 * reported last.
 */
export async function captureProcessStreamTail(
    stream: ReadableStream<Uint8Array>,
    limitBytes: number,
): Promise<CapturedProcessStream> {
    const reader = stream.getReader();
    let retained: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
    let totalBytes = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            totalBytes += value.byteLength;
            if (value.byteLength >= limitBytes) {
                retained = value.slice(value.byteLength - limitBytes);
                continue;
            }
            retained = concatBytes(retained, value);
            if (retained.byteLength > limitBytes) {
                retained = retained.slice(retained.byteLength - limitBytes);
            }
        }
    } finally {
        reader.releaseLock();
    }
    return {
        text: new TextDecoder().decode(retained),
        totalBytes,
        truncated: totalBytes > retained.byteLength,
    };
}

/**
 * Join both streams into what the agent reads, and say so when output was dropped.
 *
 * Silent truncation is the failure mode worth avoiding: an agent that cannot see
 * the note will treat a truncated log as the whole story.
 */
export function formatCapturedProcessOutput(
    stdout: CapturedProcessStream,
    stderr: CapturedProcessStream,
    limitBytes: number = PROCESS_STREAM_OUTPUT_LIMIT_BYTES,
): string {
    const output = `${stdout.text}\n${stderr.text}`;
    if (!stdout.truncated && !stderr.truncated) return output;
    const notices: string[] = [];
    if (stdout.truncated) {
        notices.push(`[RunWield] stdout truncated; showing last ${limitBytes} of ${stdout.totalBytes} bytes.`);
    }
    if (stderr.truncated) {
        notices.push(`[RunWield] stderr truncated; showing last ${limitBytes} of ${stderr.totalBytes} bytes.`);
    }
    return `${output}\n${notices.join("\n")}\n`;
}
