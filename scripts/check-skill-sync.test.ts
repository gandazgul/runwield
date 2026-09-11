import { assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";
import {
    discoverSkillsInContainers,
    findProjectSpecificLeaks,
    findSkillSyncDrift,
    findUnpublishedSkills,
    formatDrift,
    isInternalSkill,
    readCurrentPairs,
    type SkillSyncBaseline,
} from "./check-skill-sync.ts";

const BASELINE_PATH = new URL("./skill-sync-baseline.json", import.meta.url);
const REPO_ROOT = fromFileUrl(new URL("../", import.meta.url)).replace(/\/$/, "");

function pair(sourceHash: string, skillHash: string) {
    return { source: "src/agent-definitions/ideator.md", skill: "skills/ideator/SKILL.md", sourceHash, skillHash };
}

Deno.test("a pair whose files both match the baseline reports no drift", () => {
    const recorded = [pair("aaa", "bbb")];
    assertEquals(findSkillSyncDrift(recorded, [pair("aaa", "bbb")]), []);
});

Deno.test("an Agent Definition edited without its skill names the skill that must catch up", () => {
    const drift = findSkillSyncDrift([pair("aaa", "bbb")], [pair("changed", "bbb")]);

    assertEquals(drift, [{
        source: "src/agent-definitions/ideator.md",
        skill: "skills/ideator/SKILL.md",
        sourceChanged: true,
        skillChanged: false,
    }]);
    assertEquals(
        formatDrift(drift).includes("src/agent-definitions/ideator.md changed but skills/ideator/SKILL.md did not"),
        true,
    );
});

Deno.test("a skill edited without its Agent Definition names the definition that must catch up", () => {
    const drift = findSkillSyncDrift([pair("aaa", "bbb")], [pair("aaa", "changed")]);

    assertEquals(drift[0].skillChanged, true);
    assertEquals(drift[0].sourceChanged, false);
    assertEquals(
        formatDrift(drift).includes("skills/ideator/SKILL.md changed but src/agent-definitions/ideator.md did not"),
        true,
    );
});

Deno.test("both sides moving is still reported so the wording gets compared", () => {
    const drift = findSkillSyncDrift([pair("aaa", "bbb")], [pair("x", "y")]);

    assertEquals(drift[0], {
        source: "src/agent-definitions/ideator.md",
        skill: "skills/ideator/SKILL.md",
        sourceChanged: true,
        skillChanged: true,
    });
});

Deno.test("the committed skills are in sync with the Agent Definitions they came from", async () => {
    const baseline: SkillSyncBaseline = JSON.parse(await Deno.readTextFile(BASELINE_PATH));
    const current = await readCurrentPairs(baseline.pairs);

    assertEquals(formatDrift(findSkillSyncDrift(baseline.pairs, current)), formatDrift([]));
});

Deno.test("an Agent Definition is full of the vocabulary a skill must shed", async () => {
    const definition = await Deno.readTextFile(new URL("../src/agent-definitions/ideator.md", import.meta.url));
    const leaks = findProjectSpecificLeaks("src/agent-definitions/ideator.md", definition);
    const terms = new Set(leaks.map((leak) => leak.term));

    assertEquals(terms.has("RunWield"), true);
    assertEquals(terms.has("/agent planner"), true);
    assertEquals(terms.has("user_interview"), true);
    assertEquals(terms.has("{{BUNDLED_AGENT_DEFS_DIR}}"), true);
    assertEquals(terms.has("`memory`"), true);
});

Deno.test("a skill is internal only when its metadata says so", () => {
    const frontmatter = (body: string) => `---\nname: x\ndescription: y\n${body}---\n\n# x\n`;

    assertEquals(isInternalSkill(frontmatter("metadata:\n  internal: true\n")), true);
    assertEquals(isInternalSkill(frontmatter("")), false);
    assertEquals(isInternalSkill(frontmatter("metadata:\n  internal: false\n")), false);
    assertEquals(isInternalSkill("# no front matter at all\n"), false);
});

Deno.test("a skill nobody meant to publish is reported, and an internal one is not", () => {
    const discovered = [
        { path: "skills/ideator/SKILL.md", internal: false },
        { path: ".agents/skills/borrowed/SKILL.md", internal: false },
        { path: ".agents/skills/ours-only/SKILL.md", internal: true },
    ];

    assertEquals(findUnpublishedSkills(discovered, ["skills/ideator/SKILL.md"]), [
        ".agents/skills/borrowed/SKILL.md",
    ]);
});

Deno.test("installing from this repository offers exactly the skills the baseline publishes", async () => {
    const baseline: SkillSyncBaseline = JSON.parse(await Deno.readTextFile(BASELINE_PATH));
    const discovered = await discoverSkillsInContainers(REPO_ROOT);

    assertEquals(
        discovered.filter((skill) => !skill.internal).map((skill) => skill.path).sort(),
        baseline.pairs.map((entry) => entry.skill).sort(),
    );
});

Deno.test("the skills vendored for our own use stay out of an install", async () => {
    const discovered = await discoverSkillsInContainers(REPO_ROOT);
    const vendored = discovered.filter((skill) => skill.path.startsWith(".agents/skills/"));

    assertEquals(vendored.length > 0, true);
    assertEquals(vendored.every((skill) => skill.internal), true);
});

Deno.test("the committed skills carry none of it", async () => {
    const baseline: SkillSyncBaseline = JSON.parse(await Deno.readTextFile(BASELINE_PATH));

    for (const entry of baseline.pairs) {
        const content = await Deno.readTextFile(new URL(`../${entry.skill}`, import.meta.url));
        assertEquals(findProjectSpecificLeaks(entry.skill, content), []);
    }
});
