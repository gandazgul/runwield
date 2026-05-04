import { assertEquals } from "@std/assert";
import { injectFrontMatter, parsePlanFrontMatter, updatePlanStatus } from "./plan-store.js";

Deno.test("injectFrontMatter escapes YAML double-quoted values", () => {
    const markdown = "## Plan\n\nBody";
    const withFm = injectFrontMatter(markdown, {
        summary: 'Handle "Other" and \\slashes',
        affectedPaths: ['<|"|src/tools/user-interview.js<|"|'],
    });

    const { attrs } = parsePlanFrontMatter(withFm);

    assertEquals(attrs.summary, 'Handle "Other" and \\slashes');
    assertEquals(attrs.affectedPaths, ['<|"|src/tools/user-interview.js<|"|']);
});

Deno.test("updatePlanStatus self-heals malformed front matter using recovery attrs", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        const plansDir = `${cwd}/plans`;
        await Deno.mkdir(plansDir, { recursive: true });
        const planPath = `${plansDir}/broken.md`;

        const malformed = [
            "---",
            'classification: "FEATURE"',
            'summary: "bad "quote"',
            "affectedPaths:",
            '  - "<|"|src/tools/user-interview.js<|"|"',
            'status: "in_review"',
            "---",
            "## Objective",
            "Keep going",
            "",
        ].join("\n");
        await Deno.writeTextFile(planPath, malformed);

        await updatePlanStatus(cwd, "broken", "approved", {
            classification: "FEATURE",
            complexity: "LOW",
            summary: "Recovered summary",
            affectedPaths: ["src/tools/user-interview.js"],
            origin: "internal",
        });

        const healed = await Deno.readTextFile(planPath);
        const { attrs, body } = parsePlanFrontMatter(healed);
        assertEquals(attrs.status, "approved");
        assertEquals(attrs.summary, "Recovered summary");
        assertEquals(attrs.affectedPaths, ["src/tools/user-interview.js"]);
        assertEquals(body.includes("## Objective"), true);
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});
