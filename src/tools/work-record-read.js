/**
 * @module tools/work-record-read
 * Agent Custom Tool for canonical Work Record read by stable ID.
 */

import { Type } from "@sinclair/typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { formatWorkRecordReadResult, readWorkRecordById } from "../shared/work-records/index.js";

export const WORK_RECORD_READ_TOOL_NAME = "work_record_read";

const PARAMETERS = Type.Object({
    recordId: Type.String({ minLength: 1, description: "Stable Work Record recordId." }),
}, { additionalProperties: false });

/**
 * @param {{ cwd: string, accessMode?: "current"|"all", readWorkRecordById?: typeof readWorkRecordById }} opts
 */
export function createWorkRecordReadTool(opts) {
    const accessMode = opts.accessMode || "current";
    const read = opts.readWorkRecordById || readWorkRecordById;
    return defineTool(
        /** @type {any} */ ({
            name: WORK_RECORD_READ_TOOL_NAME,
            label: "Work Record Read",
            description: "Read canonical Work Record Markdown by stable recordId, subject to agent access mode.",
            promptSnippet: "Read a Work Record by recordId when search results identify relevant planning context.",
            parameters: PARAMETERS,
            async execute(/** @type {string} */ _toolCallId, /** @type {any} */ params) {
                try {
                    const recordId = /** @type {{ recordId: string }} */ (params).recordId;
                    const result = await read(opts.cwd, recordId, { accessMode });
                    return {
                        content: [{ type: "text", text: formatWorkRecordReadResult(result) }],
                        details: { accessMode, record: result },
                    };
                } catch (error) {
                    return {
                        content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
                        details: { accessMode, record: null },
                        isError: true,
                    };
                }
            },
        }),
    );
}
