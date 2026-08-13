import { assert, assertEquals } from "@std/assert";
import { listValidationUserMessages } from "./validation-user-messages.ts";
import { doctorCheckMessage, doctorCleanMessage, doctorNeedsHelpMessage } from "../../cmd/plans/doctor-messages.ts";

const FORBIDDEN = [
    "worktree registry",
    "front matter",
    "lifecycle",
    "projection",
    "checkpoint",
    "settlement",
    "execution context",
    "delivery evidence",
    "planid",
    "worktreeid",
];

function syllables(word: string): number {
    const cleaned = word.toLowerCase().replace(/[^a-z]/g, "");
    if (!cleaned) return 0;
    const groups = cleaned.replace(/e$/, "").match(/[aeiouy]+/g)?.length || 1;
    return Math.max(1, groups);
}

/** Flesch-Kincaid grade level after paths, code, ids, and allowed Git words are removed. */
function fleschKincaidGrade(message: string): number {
    const normalized = message
        .replace(/`[^`]*`/g, "")
        .replace(/(?:\.?\.?\/)?[\w.-]+(?:\/[\w.-]+)+/g, "")
        .replace(/\b(?:branch|commit|worktree|RunWield|Plan)\b/gi, "")
        .replace(/\b\w*[\d_-]\w*\b/g, "");
    const sentences = Math.max(1, (normalized.match(/[.!?]+/g) || []).length);
    const words = normalized.match(/[A-Za-z]+/g) || [];
    const syllableCount = words.reduce((sum, word) => sum + syllables(word), 0);
    return 0.39 * (words.length / sentences) + 11.8 * (syllableCount / Math.max(1, words.length)) - 15.59;
}

async function validationDisplaySources(): Promise<string[]> {
    const paths: string[] = [];
    for await (const entry of Deno.readDir(new URL(".", import.meta.url))) {
        if (entry.isFile && /^validation-.*\.(?:ts|js)$/.test(entry.name) && !entry.name.includes("test")) {
            paths.push(new URL(entry.name, import.meta.url).pathname);
        }
    }
    return paths;
}

Deno.test("all validation recovery and doctor messages stay plain", async () => {
    const messages = [
        ...listValidationUserMessages().map((entry) => entry.message),
        doctorCleanMessage(0),
        doctorCleanMessage(2),
        doctorNeedsHelpMessage(1, 1),
        doctorCheckMessage(2),
    ];
    for (const message of messages) {
        const lower = message.toLowerCase();
        for (const term of FORBIDDEN) assert(!lower.includes(term), `${term} leaked in: ${message}`);
        assert(message.split(/\s+/).length <= 24, `message is too long: ${message}`);
        assert(fleschKincaidGrade(message) <= 4, `message is above grade 4: ${message}`);
    }

    // Inventory real display edges. Raw caught errors must go to logs, never to
    // emitStatus or appendSystemMessage calls.
    let inventoriedCalls = 0;
    for (const path of await validationDisplaySources()) {
        const source = await Deno.readTextFile(path);
        inventoriedCalls += (source.match(/(?:emitStatus|appendSystemMessage)\s*\(/g) || []).length;
        assertEquals(/(?:emitStatus|appendSystemMessage)\s*\([^)]*\$\{error\}/s.test(source), false, path);
    }
    assert(inventoriedCalls > 10, "the display inventory did not find production calls");
});
