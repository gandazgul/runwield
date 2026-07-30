#!/usr/bin/env -S deno run --allow-read --allow-write=scripts/injection-seam-baseline.json

/**
 * Ratchet for test-injection seams.
 *
 * A seam — an entry in a module's `__deps`/`__testDeps` bag — is a public claim that
 * something is not ours. That makes it an architectural statement, not a testing
 * convenience, and it needs the same guard rails as the JS-to-TS baseline: freeze
 * where we are, refuse to slide back, tighten as each module is refactored.
 *
 * Three rules, in descending strictness:
 *
 * 1. No conditional seams, anywhere, ever. `__deps ? fake : real` makes a module's
 *    behaviour depend on whether *anything at all* was injected, so injecting a clock
 *    can silently disable a transaction. Nothing at the call site shows it and
 *    coverage still counts the lines as run. This is zero-tolerance because the
 *    codebase currently has none, and it is how the worst defects hid.
 *
 * 2. No new machinery seams. RunWield's own state machine — Plan writes, lifecycle
 *    transitions, registry writes, locks — must never be replaceable. A guarantee
 *    that only exists when components compose cannot be tested with the composing
 *    part removed. Existing ones are listed per file and may only shrink.
 *
 * 3. The seam set may only shrink. Thirty-eight injectables in one module is not a
 *    testability achievement; it is an unmade design decision deferred into the test
 *    bag. Every seam is recorded by name, so a module cannot trade one for another at a
 *    flat count, and a module absent from the baseline may not introduce any.
 *
 * Run with `--update` after removing seams to tighten the baseline. It refuses to
 * loosen: an update that would raise a count or add a machinery seam fails, so
 * "just re-baseline it" is not an escape hatch.
 *
 * Renaming a seam looks like removing one and adding another, which the ratchet is
 * right to reject. Declare it instead:
 *
 *     deno run -A scripts/check-injection-seams.js --update --rename old=new
 *
 * A rename rewrites the name in the baseline before comparing, so it can carry an
 * existing seam to a new name but can never introduce one — the old name has to be
 * there already.
 */

const BASELINE_PATH = new URL("./injection-seam-baseline.json", import.meta.url);
const SOURCE_ROOT = new URL("../src/", import.meta.url);
const SKIP_DIRS = new Set([
    ".astro",
    ".vite",
    "_fresh",
    "coverage",
    "dist",
    "node_modules",
    "__fixtures__",
    "__tests__",
    "fixtures",
    "test-fixtures",
    "tests",
]);
const TEST_FILE_PATTERN = /(?:^|[._-])(?:test|spec)(?:\.|$)|_test\./;
const SOURCE_FILE_PATTERN = /\.(?:[jt]sx?|mjs|mts)$/;

/**
 * Names that must never sit behind a seam.
 *
 * Matched as whole injectable names, so `recordPlanEvent` is caught while an
 * unrelated `recordPlanEventMetric` would not be. Prefix entries end in `*`.
 */
const MACHINERY_SEAMS = [
    "recordPlanEvent",
    "updatePlanFrontMatter",
    "updatePlanStatus",
    "updateArchivedPlanFrontMatter",
    "savePlan",
    "saveChildFeaturePlans",
    "writePlanMarkdownWithRevision",
    "withPlanLock",
    "withPlanCatalogLock",
    "withWorktreeRegistryLock",
    "addWorktreeRegistryEntry",
    "updateWorktreeRegistryEntry",
    "removeWorktreeRegistryEntry",
    "reconcileEntryIdentity",
    "pruneEntry",
    "run*Transition",
    // Worktree *policy*, not Git. These have Git-sounding names and call Git, but each
    // one encodes a RunWield decision: mergeExecutionWorktree proves a sealed candidate
    // and enforces allowed dirty paths, preparePrimaryPlanPathForMerge refuses non-Plan
    // paths, sealExecutionWorktreeCandidate is the checkpoint policy. Replacing them in
    // a test replaces the behaviour under test. The genuine Git boundary is GitPort
    // (src/shared/git-port.ts); everything here is ours.
    "mergeExecutionWorktree",
    "sealExecutionWorktreeCandidate",
    "checkpointExecutionWorktree",
    "createExecutionWorktree",
    "removeExecutionWorktree",
    "preparePrimaryPlanPathForMerge",
    "restorePrimaryPlanPathAfterMergeFailure",
    "verifyExecutionWorktreeMerged",
    "assertNoUnvalidatedPostSealChanges",
    "stageValidationPassedInExecutionWorktree",
];

/** @param {string} path */
function toPosixPath(path) {
    return path.replaceAll("\\", "/");
}

/** @param {string} relativePath */
function isProductionSourcePath(relativePath) {
    const normalized = toPosixPath(relativePath);
    if (!SOURCE_FILE_PATTERN.test(normalized)) return false;
    const parts = normalized.split("/");
    const fileName = parts.at(-1) || "";
    if (TEST_FILE_PATTERN.test(fileName)) return false;
    return !parts.some((part) => SKIP_DIRS.has(part));
}

/** @param {string} name */
function isMachinerySeam(name) {
    return MACHINERY_SEAMS.some((pattern) =>
        pattern.endsWith("*") ? name.startsWith(pattern.slice(0, -1)) : name === pattern
    );
}

/**
 * Injectable names a module reads out of its dependency bag.
 *
 * Reads the source text rather than the module graph on purpose: the point is to
 * see the declared seams, and a text scan cannot be defeated by indirection that
 * would also defeat a reviewer.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function collectSeamNames(text) {
    /** @type {Set<string>} */
    const names = new Set();
    for (const match of text.matchAll(/__(?:test)?[Dd]eps\s*(?:\?\.|\.)\s*([A-Za-z_$][\w$]*)/g)) {
        names.add(match[1]);
    }
    // Destructured reads: `const { a, b } = __deps`.
    for (const match of text.matchAll(/(?:const|let)\s*\{([^}]*)\}\s*=\s*(?:options\.)?__(?:test)?[Dd]eps/g)) {
        for (const part of match[1].split(",")) {
            const name = part.split(":")[0].trim().replace(/^\.\.\./, "");
            if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
        }
    }
    return [...names].sort();
}

/**
 * Blank out comments so declarations cannot be mistaken for code.
 *
 * JSDoc describes these bags in TypeScript-ish syntax (`__deps?: { … }`), which
 * looks exactly like a ternary to a text scan. Newlines are preserved so reported
 * line numbers still point at the real source line.
 *
 * @param {string} text
 * @returns {string}
 */
function blankComments(text) {
    return text
        .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
        .replace(/(^|[^:])\/\/[^\n]*/g, (line, prefix) => prefix + " ".repeat(line.length - prefix.length));
}

/**
 * Seams whose value depends on whether anything at all was injected.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function collectConditionalSeams(text) {
    /** @type {string[]} */
    const offenders = [];
    // `__deps ? x : y`, including across a line break, which is how both known
    // instances were formatted. The lookahead excludes optional chaining
    // (`__deps?.name`), nullish coalescing, and optional-property syntax — ordinary
    // reads of an injected value rather than a branch on whether anything was
    // injected at all.
    const scanned = blankComments(text);
    for (const match of scanned.matchAll(/__(?:test)?[Dd]eps\s*\n?\s*\?(?![.?:])[^:;{}]{0,300}:/g)) {
        const line = text.slice(0, match.index || 0).split("\n").length;
        offenders.push(`line ${line} (gated on the bag itself)`);
    }
    // Worse still: a seam gated on a *different* dep — `__deps?.a ? fakeB : realB`.
    // Injecting one dependency then silently replaces an unrelated one, so a test that
    // fakes a merge also gets a fake branch head and a fake ancestry check without
    // asking for either. Nothing at the call site shows it.
    for (
        const match of scanned.matchAll(
            /__(?:test)?[Dd]eps\??\.[A-Za-z_$][\w$]*\s*\n?\s*\?(?![.?:])[\s\S]{0,300}?:/g,
        )
    ) {
        const line = text.slice(0, match.index || 0).split("\n").length;
        offenders.push(`line ${line} (one seam gated on another dep)`);
    }
    return offenders;
}

/** @param {URL} rootUrl */
async function collectSeams(rootUrl = SOURCE_ROOT) {
    /** @type {Record<string, { count: number, machinery: string[] }>} */
    const seams = {};
    /** @type {Record<string, string[]>} */
    const conditional = {};

    /** @param {URL} directoryUrl @param {string} relativeDirectory */
    async function walk(directoryUrl, relativeDirectory) {
        for await (const entry of Deno.readDir(directoryUrl)) {
            const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
            if (entry.isDirectory) {
                if (SKIP_DIRS.has(entry.name)) continue;
                await walk(new URL(`${entry.name}/`, directoryUrl), relativePath);
                continue;
            }
            if (!isProductionSourcePath(relativePath)) continue;
            const text = await Deno.readTextFile(new URL(entry.name, directoryUrl));
            if (!/__(?:test)?[Dd]eps/.test(text)) continue;
            const names = collectSeamNames(text);
            const conditionalHits = collectConditionalSeams(text);
            if (conditionalHits.length > 0) conditional[`src/${relativePath}`] = conditionalHits;
            if (names.length === 0) continue;
            seams[`src/${relativePath}`] = {
                seams: names,
                machinery: names.filter(isMachinerySeam),
            };
        }
    }

    await walk(rootUrl, "");
    return { seams, conditional };
}

/** @param {string[]} entries */
function formatList(entries) {
    return entries.map((entry) => `  - ${entry}`).join("\n");
}

/** @typedef {Record<string, { seams: string[], machinery: string[] }>} SeamEntry */

async function readBaseline() {
    const parsed = JSON.parse(await Deno.readTextFile(BASELINE_PATH));
    if (!parsed || typeof parsed.files !== "object") {
        throw new Error("injection-seam-baseline.json must contain a { files: { path: { seams, machinery } } } object");
    }
    return /** @type {SeamEntry} */ (parsed.files);
}

/**
 * @param {SeamEntry} current
 * @param {SeamEntry} baseline
 */
function findRegressions(current, baseline) {
    /** @type {string[]} */
    const problems = [];
    for (const [path, entry] of Object.entries(current)) {
        const before = baseline[path];
        if (!before) {
            problems.push(
                `${path}: new module with ${entry.seams.length} injection seam(s) (${
                    entry.seams.join(", ")
                }). Pass capability ports as required arguments instead of a dependency bag.`,
            );
            continue;
        }
        // Compared by name, not by count: swapping one seam for another keeps the count
        // flat while quietly changing what the module claims it does not own.
        const added = entry.seams.filter((name) => !before.seams.includes(name));
        if (added.length > 0) {
            problems.push(`${path}: new injection seam(s): ${added.join(", ")}.`);
        }
        // Only a *new* seam over machinery is a regression. When the denylist grows to
        // recognize a seam that already existed, the code did not get worse — our
        // understanding did, and refusing that would mean never being allowed to admit
        // a mistake. Those are recorded by `--update` so they can still only shrink.
        const addedMachinery = entry.machinery
            .filter((name) => !before.machinery.includes(name))
            .filter((name) => !before.seams.includes(name));
        if (addedMachinery.length > 0) {
            problems.push(
                `${path}: machinery must never be replaceable, but these became injectable: ${
                    addedMachinery.join(", ")
                }.`,
            );
        }
    }
    return problems;
}

/**
 * @param {SeamEntry} current
 * @param {SeamEntry} baseline
 */
function findStaleBaseline(current, baseline) {
    /** @type {string[]} */
    const stale = [];
    for (const [path, before] of Object.entries(baseline)) {
        const entry = current[path];
        if (!entry) {
            stale.push(`${path}: no seams left — remove it from the baseline to lock the win in.`);
            continue;
        }
        const removed = before.seams.filter((name) => !entry.seams.includes(name));
        if (removed.length > 0) {
            stale.push(`${path}: seam(s) removed (${removed.join(", ")}) — tighten the baseline.`);
        }
        const reclassified = entry.machinery.filter((name) => !before.machinery.includes(name));
        if (reclassified.length > 0) {
            stale.push(
                `${path}: existing seam(s) now recognized as machinery (${
                    reclassified.join(", ")
                }) — record them so they can only shrink.`,
            );
        }
    }
    return stale;
}

/**
 * @param {SeamEntry} baseline
 * @param {Array<[string, string]>} renames
 * @returns {SeamEntry}
 */
function applyRenames(baseline, renames) {
    if (renames.length === 0) return baseline;
    const map = new Map(renames);
    /** @type {SeamEntry} */
    const renamed = {};
    for (const [path, entry] of Object.entries(baseline)) {
        renamed[path] = {
            seams: [...new Set(entry.seams.map((name) => map.get(name) || name))].sort(),
            machinery: [...new Set(entry.machinery.map((name) => map.get(name) || name))].sort(),
        };
    }
    return renamed;
}

if (import.meta.main) {
    const update = Deno.args.includes("--update");
    /** @type {Array<[string, string]>} */
    const renames = [];
    for (let index = 0; index < Deno.args.length; index++) {
        if (Deno.args[index] !== "--rename") continue;
        const pair = Deno.args[index + 1] || "";
        const [from, to] = pair.split("=");
        if (!from || !to) {
            console.error(`--rename expects old=new, received "${pair}".`);
            Deno.exit(1);
        }
        renames.push([from, to]);
    }
    const { seams, conditional } = await collectSeams();
    const sortedSeams = Object.fromEntries(Object.entries(seams).sort(([a], [b]) => a.localeCompare(b)));

    const conditionalPaths = Object.entries(conditional);
    if (conditionalPaths.length > 0) {
        console.error(
            "Conditional injection seams are never allowed. A module whose behaviour changes because " +
                "something unrelated was injected cannot be reasoned about from its call sites:\n" +
                formatList(conditionalPaths.map(([path, hits]) => `${path} (${hits.join(", ")})`)) +
                "\n\nRewrite it as an unconditional seam (`__deps?.name || realName`) or, better, a required\n" +
                "capability port. Never gate a real implementation on whether anything was injected.\n" +
                "Background: plans/replace-deps-bag-with-capability-ports.md.",
        );
        Deno.exit(1);
    }

    if (update) {
        const baseline = applyRenames(await readBaseline().catch(() => ({})), renames);
        const regressions = findRegressions(sortedSeams, baseline);
        if (Object.keys(baseline).length > 0 && regressions.length > 0) {
            console.error(
                `Refusing to loosen the injection-seam baseline:\n${formatList(regressions)}`,
            );
            Deno.exit(1);
        }
        await Deno.writeTextFile(
            BASELINE_PATH,
            `${
                JSON.stringify(
                    {
                        comment:
                            "Injection-seam ratchet. Counts and machinery lists may only shrink. See plans/replace-deps-bag-with-capability-ports.md.",
                        files: sortedSeams,
                    },
                    null,
                    4,
                )
            }\n`,
        );
        console.log("Updated scripts/injection-seam-baseline.json.");
        Deno.exit(0);
    }

    const baseline = applyRenames(await readBaseline(), renames);
    const regressions = findRegressions(sortedSeams, baseline);
    const stale = findStaleBaseline(sortedSeams, baseline);

    if (regressions.length > 0 || stale.length > 0) {
        const sections = [];
        if (regressions.length > 0) {
            sections.push(`Injection-seam regressions:\n${formatList(regressions)}`);
        }
        if (stale.length > 0) {
            sections.push(
                `Seams were removed — run \`deno task seams:update\` to lock the progress in:\n${formatList(stale)}`,
            );
        }
        sections.push(
            "Why this is enforced: a seam is a public claim that something is not ours. RunWield's own\n" +
                "machinery (Plan writes, lifecycle transitions, registry writes, locks) must never be replaceable,\n" +
                "because a guarantee that only exists when components compose cannot be tested with the composing\n" +
                "part removed. Fake the environment instead — `defineGitFixture` gives a real Git repo in ~5ms and\n" +
                "`makeValidationProjectRoot` a real Plan project.\n\n" +
                "If you ADDED a seam: remove it and pass a capability port as a required argument instead.\n" +
                "If you REMOVED seams: run `deno task seams:update` to tighten the baseline in the same change.\n" +
                "Never run `--update` to silence an addition; it refuses to loosen and will reject it.\n" +
                "Background: plans/replace-deps-bag-with-capability-ports.md and src/skills/write-tests/SKILL.md.",
        );
        console.error(sections.join("\n\n"));
        Deno.exit(1);
    }

    const total = Object.values(sortedSeams).reduce((sum, entry) => sum + entry.seams.length, 0);
    const machinery = Object.values(sortedSeams).reduce((sum, entry) => sum + entry.machinery.length, 0);
    console.log(
        `Injection-seam baseline holds: ${total} seam(s) across ${
            Object.keys(sortedSeams).length
        } module(s), ${machinery} of them machinery still to remove.`,
    );
}
