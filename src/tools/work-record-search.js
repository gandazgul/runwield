/**
 * @module tools/work-record-search
 * Agent Custom Tool for Work Record search.
 */

import { Type } from "@sinclair/typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { formatWorkRecordSearchResults, searchWorkRecords } from "../shared/work-records/index.js";

export const WORK_RECORD_SEARCH_TOOL_NAME = "work_record_search";

const PARAMETERS = Type.Object({
    query: Type.String({ minLength: 1, description: "Work Record search query." }),
}, { additionalProperties: false });

/**
 * @param {{ cwd: string, accessMode?: "current"|"all", searchWorkRecords?: typeof searchWorkRecords }} opts
 */
export function createWorkRecordSearchTool(opts) {
    const accessMode = opts.accessMode || "current";
    const search = opts.searchWorkRecords || searchWorkRecords;
    return defineTool(
        /** @type {any} */ ({
            name: WORK_RECORD_SEARCH_TOOL_NAME,
            label: "Work Record Search",
            description:
                "Search canonical Work Records through the derived index and return hydrated Markdown metadata.",
            promptSnippet: "Search current usable Work Records for planning context by query.",
            parameters: PARAMETERS,
            async execute(/** @type {string} */ _toolCallId, /** @type {any} */ params) {
                try {
                    const query = /** @type {{ query: string }} */ (params).query;
                    const result = await search(opts.cwd, query, { accessMode });
                    return {
                        content: [{ type: "text", text: formatWorkRecordSearchResults(result) }],
                        details: {
                            accessMode,
                            records: result.records,
                            staleRecordIds: result.staleRecordIds,
                            bootstrapped: result.bootstrapped,
                        },
                    };
                } catch (error) {
                    return {
                        content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
                        details: { accessMode, records: [], staleRecordIds: [], bootstrapped: false },
                        isError: true,
                    };
                }
            },
        }),
    );
}
