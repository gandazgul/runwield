import { assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";
import {
    collectPublishedSkillFiles,
    discoverSkillsInContainers,
    findProjectSpecificLeaks,
    findSkillSyncDrift,
    findUnpublishedSkills,
    formatDrift,
    isInternalSkill,
    type PublishedSkill,
    readCurrentSkills,
    type SkillSyncBaseline,
    type SupportFileHash,
} from "./check-skill-sync.ts";

const BASELINE_PATH = new URL("./skill-sync-baseline.json", import.meta.url);
const REPO_ROOT = fromFileUrl(new URL("../", import.meta.url)).replace(/\/$/, "");

/** A skill derived from an Agent Definition, so both sides are held together. */
function derived(sourceHash: string, skillHash: string): PublishedSkill {
    return {
        source: "src/agent-definitions/ideator.md",
        skill: "skills/ideator/SKILL.md",
        sourceHash,
        skillHash,
        supportFiles: [],
    };
}

/** A skill that stands on its own, with no Agent Definition behind it. */
function standalone(skillHash: string, supportFiles: SupportFileHash[] = []): PublishedSkill {
    return { skill: "skills/review/SKILL.md", skillHash, supportFiles };
}

Deno.test("a pair whose files both match the baseline reports no drift", () => {
    assertEquals(findSkillSyncDrift([derived("aaa", "bbb")], [derived("aaa", "bbb")]), []);
});

Deno.test("an Agent Definition edited without its skill names the skill that must catch up", () => {
    const drift = findSkillSyncDrift([derived("aaa", "bbb")], [derived("changed", "bbb")]);

    assertEquals(drift, [{
        source: "src/agent-definitions/ideator.md",
        skill: "skills/ideator/SKILL.md",
        sourceChanged: true,
        skillChanged: false,
        supportFilesAdded: [],
        supportFilesRemoved: [],
        supportFilesChanged: [],
    }]);
    assertEquals(
        formatDrift(drift).includes("src/agent-definitions/ideator.md changed but skills/ideator/SKILL.md did not"),
        true,
    );
});

Deno.test("a skill edited without its Agent Definition names the definition that must catch up", () => {
    const drift = findSkillSyncDrift([derived("aaa", "bbb")], [derived("aaa", "changed")]);

    assertEquals(drift[0].skillChanged, true);
    assertEquals(drift[0].sourceChanged, false);
    assertEquals(
        formatDrift(drift).includes("skills/ideator/SKILL.md changed but src/agent-definitions/ideator.md did not"),
        true,
    );
});

Deno.test("both sides moving is still reported so the wording gets compared", () => {
    const drift = findSkillSyncDrift([derived("aaa", "bbb")], [derived("x", "y")]);

    assertEquals(drift[0].sourceChanged, true);
    assertEquals(drift[0].skillChanged, true);
});

Deno.test("a skill with no Agent Definition behind it is held to its own hash alone", () => {
    assertEquals(findSkillSyncDrift([standalone("aaa")], [standalone("aaa")]), []);

    const drift = findSkillSyncDrift([standalone("aaa")], [standalone("changed")]);
    assertEquals(drift[0].skillChanged, true);
    assertEquals(drift[0].sourceChanged, false);
    assertEquals(formatDrift(drift).includes("skills/review/SKILL.md changed."), true);
});

Deno.test("a support file whose contents moved is reported by name", () => {
    const recorded = [standalone("aaa", [{ path: "skills/review/github.md", hash: "one" }])];
    const current = [standalone("aaa", [{ path: "skills/review/github.md", hash: "two" }])];

    const drift = findSkillSyncDrift(recorded, current);

    assertEquals(drift[0].supportFilesChanged, ["skills/review/github.md"]);
    assertEquals(drift[0].skillChanged, false);
    assertEquals(formatDrift(drift).includes("skills/review/github.md changed."), true);
});

Deno.test("a support file on disk that nobody registered is reported", () => {
    const drift = findSkillSyncDrift(
        [standalone("aaa")],
        [standalone("aaa", [{ path: "skills/review/scratch.md", hash: "one" }])],
    );

    assertEquals(drift[0].supportFilesAdded, ["skills/review/scratch.md"]);
    assertEquals(
        formatDrift(drift).includes("skills/review/scratch.md ships with skills/review/SKILL.md"),
        true,
    );
});

Deno.test("a support file the baseline records but the skill no longer ships is reported", () => {
    const drift = findSkillSyncDrift(
        [standalone("aaa", [{ path: "skills/review/gitlab.md", hash: "one" }])],
        [standalone("aaa")],
    );

    assertEquals(drift[0].supportFilesRemoved, ["skills/review/gitlab.md"]);
    assertEquals(formatDrift(drift).includes("skills/review/gitlab.md is recorded"), true);
});

Deno.test("every Markdown file a published skill ships is collected, not only its SKILL.md", async () => {
    assertEquals(await collectPublishedSkillFiles(REPO_ROOT, "skills/review/SKILL.md"), [
        "skills/review/SKILL.md",
        "skills/review/github.md",
        "skills/review/gitlab.md",
        "skills/review/pull-requests.md",
    ]);
});

Deno.test("the committed skills are in sync with what they were last reviewed against", async () => {
    const baseline: SkillSyncBaseline = JSON.parse(await Deno.readTextFile(BASELINE_PATH));
    const current = await readCurrentSkills(baseline.skills);

    assertEquals(formatDrift(findSkillSyncDrift(baseline.skills, current)), formatDrift([]));
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

Deno.test("a leak is reported against a support file, not only against a SKILL.md", () => {
    const leaks = findProjectSpecificLeaks("skills/review/github.md", "Post the review with task_completed.\n");

    assertEquals(leaks, [{ skill: "skills/review/github.md", label: "RunWield tool name", term: "task_completed" }]);
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
        baseline.skills.map((entry) => entry.skill).sort(),
    );
});

Deno.test("ignored local skill containers stay out of an install", async () => {
    const discovered = await discoverSkillsInContainers(REPO_ROOT);
    const localSkills = discovered.filter((skill) => skill.path.startsWith(".agents/skills/"));

    assertEquals(localSkills, []);
});

Deno.test("every file the committed skills ship carries none of it", async () => {
    const baseline: SkillSyncBaseline = JSON.parse(await Deno.readTextFile(BASELINE_PATH));

    for (const entry of baseline.skills) {
        for (const path of await collectPublishedSkillFiles(REPO_ROOT, entry.skill)) {
            const content = await Deno.readTextFile(new URL(`../${path}`, import.meta.url));
            assertEquals(findProjectSpecificLeaks(path, content), []);
        }
    }
});
