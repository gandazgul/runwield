#!/usr/bin/env -S deno run -A

/**
 * Keeps the installable skills under `skills/` in step with the Agent Definitions they were derived from.
 *
 * Each pair records the hash of both files. When either side changes, this check fails and names the side that moved,
 * so the edit is carried across before the baseline is accepted again with `deno task skills:sync:update`.
 *
 * It also holds the skills to their reason for existing: they are installed in projects that have never heard of
 * RunWield, so RunWield names, Agent handoffs, and RunWield tool names must not survive the port.
 *
 * Finally it guards the published surface. `npx skills add gandazgul/runwield` offers every skill it finds in the
 * repository's skill container directories, so a skill vendored for our own use would be handed to strangers unless it
 * opts out.
 */

import { fromFileUrl } from "@std/path";

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
        label: "RunWield memory tool call",
        pattern: /`memory`|\baction:\s*"(?:recall|store|delete)"/g,
    },
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

/**
 * The directories the skills CLI treats as skill containers, mirroring its own priority list. It walks each one three
 * levels deep; a directory that does not exist is simply empty.
 */
const SKILL_CONTAINER_DIRS = [
    "skills",
    ".agents/skills",
    ".claude/skills",
    ".codex/skills",
    ".cursor/skills",
    ".github/skills",
    ".opencode/skills",
];

const SKILL_CONTAINER_DEPTH = 3;

export interface DiscoveredSkill {
    /** Repository-relative path of the SKILL.md. */
    path: string;
    /** Whether the skill opts out of discovery with `metadata.internal`. */
    internal: boolean;
}

/**
 * Whether a SKILL.md marks itself internal, which is how the skills CLI is told to keep it out of an install.
 */
export function isInternalSkill(content: string): boolean {
    const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!frontmatter) return false;
    return /^metadata:[ \t]*$[\s\S]*?^[ \t]+internal:[ \t]*true[ \t]*$/m.test(frontmatter[1]);
}

/**
 * Reports skills that an installer would be offered but that this repository never meant to publish.
 */
export function findUnpublishedSkills(discovered: DiscoveredSkill[], publishedPaths: string[]): string[] {
    const published = new Set(publishedPaths);
    return discovered
        .filter((skill) => !published.has(skill.path) && !skill.internal)
        .map((skill) => skill.path);
}

export function formatUnpublishedSkills(paths: string[]): string {
    return [
        "Skills that this repository does not publish are still offered to anyone who installs from it:",
        ...paths.map((path) => `- ${path}`),
        "",
        "Add it to scripts/skill-sync-baseline.json to publish it, or keep it for this repository only by adding",
        "a `metadata:` block with `internal: true` to its front matter.",
    ].join("\n");
}

/**
 * Finds every SKILL.md the skills CLI would offer to someone installing from the repository at `rootPath`.
 */
export async function discoverSkillsInContainers(rootPath: string): Promise<DiscoveredSkill[]> {
    const discovered: DiscoveredSkill[] = [];

    const walk = async (relativeDir: string, depth: number): Promise<void> => {
        let entries: Deno.DirEntry[];
        try {
            entries = await Array.fromAsync(Deno.readDir(`${rootPath}/${relativeDir}`));
        } catch {
            return;
        }
        for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
            if (!entry.isDirectory) continue;
            const childDir = `${relativeDir}/${entry.name}`;
            const skillPath = `${childDir}/SKILL.md`;
            let content: string;
            try {
                content = await Deno.readTextFile(`${rootPath}/${skillPath}`);
            } catch {
                if (depth < SKILL_CONTAINER_DEPTH) await walk(childDir, depth + 1);
                continue;
            }
            // The CLI stops descending below a skill it found, so a nested SKILL.md is never offered.
            discovered.push({ path: skillPath, internal: isInternalSkill(content) });
        }
    };

    for (const container of SKILL_CONTAINER_DIRS) await walk(container, 1);
    return discovered;
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

    const unpublished = findUnpublishedSkills(
        await discoverSkillsInContainers(fromFileUrl(REPO_ROOT).replace(/\/$/, "")),
        baseline.pairs.map((pair) => pair.skill),
    );
    if (unpublished.length > 0) {
        console.error(formatUnpublishedSkills(unpublished));
        Deno.exit(1);
    }

    const drift = findSkillSyncDrift(baseline.pairs, current);
    if (drift.length > 0) {
        console.error(formatDrift(drift));
        Deno.exit(1);
    }

    console.log(`Skill sync baseline matches ${baseline.pairs.length} Agent Definition pairs.`);
}
