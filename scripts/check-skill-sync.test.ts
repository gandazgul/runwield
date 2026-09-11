import { assertEquals } from "@std/assert";
import {
    findProjectSpecificLeaks,
    findSkillSyncDrift,
    formatDrift,
    readCurrentPairs,
    type SkillSyncBaseline,
} from "./check-skill-sync.ts";

const BASELINE_PATH = new URL("./skill-sync-baseline.json", import.meta.url);

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
});

Deno.test("the committed skills carry none of it", async () => {
    const baseline: SkillSyncBaseline = JSON.parse(await Deno.readTextFile(BASELINE_PATH));

    for (const entry of baseline.pairs) {
        const content = await Deno.readTextFile(new URL(`../${entry.skill}`, import.meta.url));
        assertEquals(findProjectSpecificLeaks(entry.skill, content), []);
    }
});
