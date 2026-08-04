/**
 * @module cmd/wr
 * List, search, read, index, and backfill canonical Work Records.
 */

import { parseArgs } from "@std/cli/parse-args";
import { getCwd } from "../../constants.js";
import {
    formatWorkRecordBackfillOutcomes,
    formatWorkRecordBackfillPreview,
    formatWorkRecordList,
    formatWorkRecordSearchResults,
    listWorkRecords,
    previewWorkRecordBackfill,
    readWorkRecordById,
    rebuildWorkRecordIndex,
    runWorkRecordBackfill,
    searchWorkRecords,
} from "../../shared/work-records/index.ts";
import {
    SYSTEM_WORK_RECORD_MNEMOSYNE_PORT,
    type WorkRecordMnemosynePort,
} from "../../shared/work-records/mnemosyne-port.ts";
import { NO_OPEN_BROWSER_PORT, SYSTEM_BROWSER_PORT } from "../../shared/browser-port.ts";
import { startArtifactReadSurface } from "../../ui/review/review-launcher.ts";
import { printCommandHelp } from "../help/index.js";

export interface WorkRecordCommandOptions {
    uiAPI?: Pick<import("../../ui/tui/types.js").UiAPI, "appendSystemMessage">;
    mnemosynePort?: WorkRecordMnemosynePort;
}

function promptForBackfillConfirmation(message: string): boolean {
    const answer = prompt(`${message}\nType BACKFILL to continue:`) || "";
    return answer.trim() === "BACKFILL";
}

async function openWorkRecordReadSurface(
    record: Awaited<ReturnType<typeof readWorkRecordById>>,
    options: { noOpen?: boolean } = {},
): Promise<void> {
    const noOpen = options.noOpen === true;
    const server = await startArtifactReadSurface({
        cwd: getCwd(),
        markdown: record.markdown,
        artifactKind: "work-record",
        title: record.title,
        path: record.path,
        notices: record.notices,
        browser: noOpen ? NO_OPEN_BROWSER_PORT : SYSTEM_BROWSER_PORT,
    });
    console.log(`[RunWield] Work Record read-only view: ${server.url}`);
    if (!server.opened && !noOpen) {
        console.log(
            "[RunWield] Could not open your browser automatically. Open the URL above, then choose Close when finished.",
        );
    }
    try {
        await server.waitForDecision();
    } finally {
        await stopReadSurface(server);
    }
}

async function stopReadSurface(
    server: Pick<Awaited<ReturnType<typeof startArtifactReadSurface>>, "stop">,
): Promise<void> {
    await Promise.race([
        Promise.resolve(server.stop()),
        new Promise<void>((resolve) => setTimeout(resolve, 1000)),
    ]);
}

function rejectUnknownFlags(
    parsed: ReturnType<typeof parseArgs>,
    allowedFlags: string[] = [],
): void {
    const allowed = new Set(["_", "help", "h", ...allowedFlags]);
    for (const key of Object.keys(parsed)) {
        if (!allowed.has(key)) throw new Error(`Unsupported flag: --${key}`);
    }
}

function formatRebuildResult(result: Awaited<ReturnType<typeof rebuildWorkRecordIndex>>): string {
    const lines = [
        `[RunWield] Rebuilt Work Record index: ${result.collection}`,
        `  canonical records: ${result.total}`,
        `  indexed: ${result.added}`,
        `  failed: ${result.failed}`,
    ];
    for (const failure of result.failures || []) {
        lines.push(`  WARNING: ${failure.recordId} (${failure.path}): ${failure.error}`);
    }
    return lines.join("\n");
}

export async function runWorkRecordsCommand(
    argv: string[],
    options: WorkRecordCommandOptions = {},
): Promise<void> {
    const mnemosynePort = options.mnemosynePort || SYSTEM_WORK_RECORD_MNEMOSYNE_PORT;
    const subcommand = argv[0] && !argv[0].startsWith("-") ? argv[0] : "list";
    const rest = subcommand === "list" ? (argv[0] === "list" ? argv.slice(1) : argv) : argv.slice(1);

    if (subcommand === "help") {
        printCommandHelp("wr");
        return;
    }

    if (subcommand === "backfill") {
        const parsed = parseArgs(rest, {
            boolean: ["help", "yes", "dry-run"],
            alias: { h: "help", y: "yes" },
        });
        if (parsed.help) {
            printCommandHelp("wr");
            return;
        }
        rejectUnknownFlags(parsed, ["yes", "y", "dry-run"]);
        if (parsed.yes && parsed["dry-run"]) throw new Error("Cannot combine --yes with --dry-run.");
        const preview = await previewWorkRecordBackfill(getCwd());
        console.log(formatWorkRecordBackfillPreview(preview));
        if (parsed["dry-run"]) {
            console.log("[RunWield] Dry run only; no Work Records or Plan backlinks were written.");
            return;
        }
        if (!preview.eligible.length) return;
        const confirmed = parsed.yes || promptForBackfillConfirmation(
            `[RunWield] Backfill will process ${preview.eligible.length} eligible source(s).`,
        );
        if (!confirmed) {
            console.log("[RunWield] Backfill canceled; no Work Records or Plan backlinks were written.");
            return;
        }
        const result = await runWorkRecordBackfill(getCwd(), { mnemosynePort });
        console.log(formatWorkRecordBackfillOutcomes(result.outcomes));
        return;
    }

    if (subcommand === "search") {
        const parsed = parseArgs(rest, { boolean: ["help", "all"], alias: { h: "help" } });
        if (parsed.help) {
            printCommandHelp("wr");
            return;
        }
        rejectUnknownFlags(parsed, ["all"]);
        const query = parsed._.map(String).join(" ").trim();
        if (!query) throw new Error("Usage: wld wr search <query> [--all]");
        console.log(
            formatWorkRecordSearchResults(
                await searchWorkRecords(getCwd(), query, { includeAll: Boolean(parsed.all), mnemosynePort }),
            ),
        );
        return;
    }

    if (subcommand === "read") {
        const parsed = parseArgs(rest, { boolean: ["help", "no-open"], alias: { h: "help" } });
        if (parsed.help) {
            printCommandHelp("wr");
            return;
        }
        rejectUnknownFlags(parsed, ["no-open"]);
        if (parsed._.length !== 1) throw new Error("Usage: wld wr read <recordId> [--no-open]");
        await openWorkRecordReadSurface(
            await readWorkRecordById(getCwd(), String(parsed._[0]), { accessMode: "all" }),
            { noOpen: Boolean(parsed["no-open"]) },
        );
        return;
    }

    if (subcommand === "index") {
        const action = rest[0] || "";
        if (action !== "rebuild") throw new Error("Usage: wld wr index rebuild");
        const parsed = parseArgs(rest.slice(1), { boolean: ["help"], alias: { h: "help" } });
        if (parsed.help) {
            printCommandHelp("wr");
            return;
        }
        rejectUnknownFlags(parsed);
        if (parsed._.length) throw new Error("Usage: wld wr index rebuild");
        console.log(formatRebuildResult(await rebuildWorkRecordIndex(getCwd(), { mnemosynePort })));
        return;
    }

    if (subcommand !== "list") throw new Error(`Unknown Work Records command: ${subcommand}. Try wld wr --help.`);

    const parsed = parseArgs(rest, { boolean: ["help", "all"], alias: { h: "help" } });
    if (parsed.help) {
        printCommandHelp("wr");
        return;
    }
    rejectUnknownFlags(parsed, ["all"]);
    if (parsed._.length) throw new Error("Usage: wld wr list [--all]");
    console.log(formatWorkRecordList(await listWorkRecords(getCwd()), { includeAll: Boolean(parsed.all) }));
}
