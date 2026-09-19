export type ReviewDiffScope = "full" | "repair";

export interface ReviewDiffSpan {
    scope: ReviewDiffScope;
    path: string;
    start: number;
    end: number;
}

export interface ReviewDiffSize {
    scope: ReviewDiffScope;
    path: string;
    byteLength: number;
}

/** Per-round receipts for bytes actually returned by review_diff(show). */
export class ReviewInspection {
    private reads: ReviewDiffSpan[] = [];

    constructor(private readonly files: ReviewDiffSize[]) {}

    record(scope: ReviewDiffScope, path: string, start: number, end: number): void {
        if (end > start) this.reads.push({ scope, path, start, end });
    }

    unread(): ReviewDiffSpan[] {
        return this.files.flatMap((file) => {
            const spans = this.reads.filter((read) => read.scope === file.scope && read.path === file.path)
                .sort((a, b) => a.start - b.start);
            const missing: ReviewDiffSpan[] = [];
            let cursor = 0;
            for (const span of spans) {
                if (span.start > cursor) missing.push({ ...file, start: cursor, end: span.start });
                cursor = Math.max(cursor, Math.min(span.end, file.byteLength));
            }
            if (cursor < file.byteLength) missing.push({ ...file, start: cursor, end: file.byteLength });
            return missing;
        });
    }

    feedback(): string {
        const unread = this.unread();
        if (!unread.length) return "";
        return [
            "Review is incomplete. Read every remaining diff chunk before approving or rejecting. Keep findings already collected.",
            ...unread.map((span) =>
                `${span.path} (${span.scope}), unread bytes ${span.start}–${span.end - 1}: review_diff(${
                    JSON.stringify({
                        command: "show",
                        scope: span.scope,
                        path: span.path,
                        offsetBytes: span.start,
                        maxBytes: Math.max(256, Math.min(65536, span.end - span.start)),
                    })
                })`
            ),
            "After reading these chunks, call review_complete again. Listing files does not count as reading them.",
        ].join("\n");
    }
}
