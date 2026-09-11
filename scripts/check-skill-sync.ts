#!/usr/bin/env -S deno run -A

/**
 * Keeps the installable skills under `skills/` in step with the Agent Definitions they were derived from.
 *
 * Each pair records the hash of both files. When either side changes, this check fails and names the side that moved,
 * so the edit is carried across before the baseline is accepted again with `deno task skills:sync:update`.
 *
 * It also holds the skills to their reason for existing: they are installed in projects that have never heard of
 * RunWield, so RunWield names, Agent handoffs, and RunWield tool names must not survive the port.
 */

const BASELINE_PATH = new URL("./skill-sync-baseline.json", import.meta.url);
const REPO_ROOT = new URL("../", import.meta.url);

export interface SkillSyncPair {
    /** Repository-relative path of the Agent Definition that owns the wording. */
    source: string;
    /** Repository-relative path of the generic skill derived from it. */
    skill: string;
    /** SHA-256 of the source file when the pair was last reviewed. */
    sourceHash: string;
    /** SHA-256 of the skill file when the pair was last reviewed. */
    skillHash: string;
}

export interface SkillSyncBaseline {
    pairs: SkillSyncPair[];
}

export interface SkillSyncDrift {
    source: string;
    skill: string;
    sourceChanged: boolean;
    skillChanged: boolean;
}

/**
 * Reports every pair whose recorded hashes no longer match the files on disk.
 */
export function findSkillSyncDrift(recorded: SkillSyncPair[], current: SkillSyncPair[]): SkillSyncDrift[] {
    const currentBySource = new Map(current.map((pair) => [pair.source, pair]));
    const drift: SkillSyncDrift[] = [];
    for (const pair of recorded) {
        const actual = currentBySource.get(pair.source);
        if (!actual) continue;
        const sourceChanged = actual.sourceHash !== pair.sourceHash;
        const skillChanged = actual.skillHash !== pair.skillHash;
        if (sourceChanged || skillChanged) {
            drift.push({ source: pair.source, skill: pair.skill, sourceChanged, skillChanged });
        }
    }
    return drift;
}

/**
 * Turns drift into the instruction a reader needs: which file moved, and which file must catch up.
 */
export function formatDrift(drift: SkillSyncDrift[]): string {
    const lines = drift.map((entry) => {
        if (entry.sourceChanged && entry.skillChanged) {
            return `- ${entry.source} and ${entry.skill} both changed. Confirm the skill still says the same thing.`;
        }
        if (entry.sourceChanged) {
            return `- ${entry.source} changed but ${entry.skill} did not. Carry the change into the skill.`;
        }
        return `- ${entry.skill} changed but ${entry.source} did not. Carry the change back into the Agent Definition, unless it only strips project-specific wording.`;
    });
    return [
        "Skill and Agent Definition pairs are out of sync:",
        ...lines,
        "",
        "After the pair says the same thing again, run: deno task skills:sync:update",
    ].join("\n");
}

const PROJECT_SPECIFIC_PATTERNS: { label: string; pattern: RegExp }[] = [
    { label: "RunWield product name", pattern: /\bRunWield\b/g },
    { label: "wld command", pattern: /\bwld\b/g },
    { label: "Agent handoff", pattern: /\/agent [a-z]+/g },
    { label: "prompt template variable", pattern: /\{\{[A-Z_]+\}\}/g },
    { label: "RunWield artifact name", pattern: /\bWork Record|\bPlan Lifecycle\b|\bAgent Definition\b/g },
    {
        label: "RunWield tool name",
        pattern:
            /\b(?:user_interview|artifact_written|delegate_agent|task_completed|write_docs|edit_docs|work_record_\w+|web_(?:search|fetch|code_search|docs_search)|code_(?:search|show|outline|batch|refs|impact|trace|investigate|structure|impls|importers)|multi_file_edit)\b/g,
    },
];

export interface ProjectSpecificLeak {
    skill: string;
    label: string;
    term: string;
}

/**
 * Reports RunWield-only vocabulary that a skill must not carry into someone else's project.
 */
export function findProjectSpecificLeaks(skill: string, content: string): ProjectSpecificLeak[] {
    const leaks: ProjectSpecificLeak[] = [];
    const seen = new Set<string>();
    for (const { label, pattern } of PROJECT_SPECIFIC_PATTERNS) {
        for (const match of content.matchAll(pattern)) {
            if (seen.has(match[0])) continue;
            seen.add(match[0]);
            leaks.push({ skill, label, term: match[0] });
        }
    }
    return leaks;
}

export function formatLeaks(leaks: ProjectSpecificLeak[]): string {
    return [
        "Installable skills still carry project-specific wording:",
        ...leaks.map((leak) => `- ${leak.skill}: ${leak.label} "${leak.term}"`),
        "",
        "Say the same thing without naming RunWield, its Agents, or its tools.",
    ].join("\n");
}

async function hashFile(relativePath: string): Promise<string> {
    const content = await Deno.readFile(new URL(relativePath, REPO_ROOT));
    const digest = await crypto.subtle.digest("SHA-256", content);
    return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function readCurrentPairs(pairs: SkillSyncPair[]): Promise<SkillSyncPair[]> {
    return await Promise.all(pairs.map(async (pair) => ({
        source: pair.source,
        skill: pair.skill,
        sourceHash: await hashFile(pair.source),
        skillHash: await hashFile(pair.skill),
    })));
}

async function readBaseline(): Promise<SkillSyncBaseline> {
    const parsed = JSON.parse(await Deno.readTextFile(BASELINE_PATH));
    if (!parsed || !Array.isArray(parsed.pairs)) {
        throw new Error("skill-sync-baseline.json must contain a `pairs` array");
    }
    return parsed;
}

if (import.meta.main) {
    const baseline = await readBaseline();
    const current = await readCurrentPairs(baseline.pairs);

    if (Deno.args.includes("--update")) {
        await Deno.writeTextFile(BASELINE_PATH, `${JSON.stringify({ pairs: current }, null, 4)}\n`);
        console.log("Updated scripts/skill-sync-baseline.json.");
        Deno.exit(0);
    }

    const leaks: ProjectSpecificLeak[] = [];
    for (const pair of baseline.pairs) {
        const content = await Deno.readTextFile(new URL(pair.skill, REPO_ROOT));
        leaks.push(...findProjectSpecificLeaks(pair.skill, content));
    }
    if (leaks.length > 0) {
        console.error(formatLeaks(leaks));
        Deno.exit(1);
    }

    const drift = findSkillSyncDrift(baseline.pairs, current);
    if (drift.length > 0) {
        console.error(formatDrift(drift));
        Deno.exit(1);
    }

    console.log(`Skill sync baseline matches ${baseline.pairs.length} Agent Definition pairs.`);
}
