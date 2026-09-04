import { assertEquals } from "@std/assert";
import {
    applyWorkRecordSupersession,
    filterWorkRecordsForList,
    findWorkRecordById,
    listWorkRecords,
    writeWorkRecord,
} from "../../src/shared/work-records/index.ts";
import type { MnemotecaCommandResult, WorkRecordMnemotecaPort } from "../../src/shared/work-records/mnemoteca-port.ts";

interface IndexedDocument {
    id: number;
    tags: string[];
    content: string;
}

class ObjectiveMnemotecaPort implements WorkRecordMnemotecaPort {
    #documents: IndexedDocument[] = [];
    #nextId = 1;

    #result(stdout = "", code = 0): MnemotecaCommandResult {
        return {
            success: code === 0,
            code,
            stdout: new TextEncoder().encode(stdout),
            stderr: new Uint8Array(),
        };
    }

    #optionValues(args: string[], name: string): string[] {
        const values: string[] = [];
        for (let index = 0; index < args.length - 1; index += 1) {
            if (args[index] === name) values.push(args[index + 1]);
        }
        return values;
    }

    run(args: string[]): Promise<MnemotecaCommandResult> {
        const command = args[0] || "";
        if (command === "update" && args[1] === "--help") {
            return Promise.resolve(this.#result("Usage: mnemoteca update <id> --replace-tags"));
        }
        if (command === "init") return Promise.resolve(this.#result());
        if (command === "list") {
            const locator = this.#optionValues(args, "--tag")[0];
            const matches = locator
                ? this.#documents.filter((document) => document.tags.includes(locator))
                : this.#documents;
            return Promise.resolve(this.#result(matches.map((document) => `[${document.id}] objective`).join("\n")));
        }
        if (command === "add") {
            this.#documents.push({
                id: this.#nextId++,
                tags: this.#optionValues(args, "--tag"),
                content: args.at(-1) || "",
            });
            return Promise.resolve(this.#result());
        }
        if (command === "update") {
            const document = this.#documents.find((candidate) => candidate.id === Number(args[1]));
            if (!document) return Promise.resolve(this.#result("", 1));
            document.tags = this.#optionValues(args, "--tag");
            document.content = args.at(-1) || "";
            return Promise.resolve(this.#result());
        }
        return Promise.resolve(this.#result(`Unsupported objective command: ${command}`, 1));
    }
}

const PREDECESSOR_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SUCCESSOR_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

export async function runWorkRecordSupersessionObjectiveCheck() {
    const cwd = await Deno.makeTempDir();
    try {
        const base = {
            kind: "work_record" as const,
            status: "approved" as const,
            scope: "quick_fix" as const,
            origin: "external" as const,
            completionMode: "verified" as const,
            createdAt: "2026-08-01T00:00:00.000Z",
        };
        await writeWorkRecord(
            cwd,
            { ...base, recordId: PREDECESSOR_ID },
            "# Prior outcome\n\n## Summary\n\nThe prior outcome.",
            { fileName: "prior.md" },
        );
        await writeWorkRecord(
            cwd,
            { ...base, recordId: SUCCESSOR_ID },
            "# Current outcome\n\n## Summary\n\nThe current outcome.",
            { fileName: "current.md" },
        );

        const mnemotecaPort = new ObjectiveMnemotecaPort();
        await applyWorkRecordSupersession(cwd, {
            successorRecordId: SUCCESSOR_ID.toUpperCase(),
            predecessorRecordIds: [PREDECESSOR_ID.toUpperCase()],
            mnemotecaPort,
        });
        await applyWorkRecordSupersession(cwd, {
            successorRecordId: SUCCESSOR_ID,
            predecessorRecordIds: [PREDECESSOR_ID],
            mnemotecaPort,
        });

        assertEquals((await findWorkRecordById(cwd, PREDECESSOR_ID.toUpperCase()))?.attrs.supersededBy, SUCCESSOR_ID);
        assertEquals((await findWorkRecordById(cwd, SUCCESSOR_ID))?.attrs.supersedes, [PREDECESSOR_ID]);
        const all = filterWorkRecordsForList(await listWorkRecords(cwd), { includeAll: true });
        const current = filterWorkRecordsForList(all);
        assertEquals(all.length, 2);
        assertEquals(current.map((record) => record.attrs.recordId), [SUCCESSOR_ID]);
        return { passed: true, canonicalRecords: all.length, currentRecords: current.length };
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
}

if (import.meta.main) {
    console.log(JSON.stringify(await runWorkRecordSupersessionObjectiveCheck()));
}
