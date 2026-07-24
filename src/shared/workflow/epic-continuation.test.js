import { assertEquals } from "@std/assert";
import { dirname, join } from "@std/path";
import { resolveEpicContinuation } from "./epic-continuation.js";

/**
 * @param {string} cwd
 * @param {string} name
 * @param {Record<string, unknown>} attrs
 */
async function writePlan(cwd, name, attrs) {
    const path = join(cwd, "plans", `${name}.md`);
    await Deno.mkdir(dirname(path), { recursive: true });
    const lines = ["---"];
    for (const [key, value] of Object.entries(attrs)) {
        if (Array.isArray(value)) {
            lines.push(`${key}:`);
            for (const item of value) lines.push(`  - ${JSON.stringify(item)}`);
        } else {
            lines.push(`${key}: ${JSON.stringify(value)}`);
        }
    }
    lines.push("---", "", `# ${name}`, "");
    await Deno.writeTextFile(path, lines.join("\n"));
}

async function makeProject() {
    const cwd = await Deno.makeTempDir();
    await Deno.mkdir(join(cwd, "plans", "epic"), { recursive: true });
    await writePlan(cwd, "epic", {
        classification: "PROJECT",
        complexity: "HIGH",
        status: "ready_for_work",
        summary: "Parent epic",
        affectedPaths: [],
        createdAt: "2026-01-01T00:00:00.000Z",
    });
    return cwd;
}

Deno.test("resolveEpicContinuation selects the earliest non-terminal child by order", async () => {
    const cwd = await makeProject();
    await writePlan(cwd, "epic/01-done", {
        classification: "FEATURE",
        complexity: "MEDIUM",
        status: "verified",
        summary: "Done",
        affectedPaths: [],
        parentPlan: "epic",
        order: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
    });
    await writePlan(cwd, "epic/03-ready", {
        classification: "FEATURE",
        complexity: "MEDIUM",
        status: "ready_for_work",
        summary: "Ready",
        affectedPaths: [],
        parentPlan: "epic",
        order: 3,
        createdAt: "2026-01-01T00:00:00.000Z",
    });
    await writePlan(cwd, "epic/02-draft", {
        classification: "FEATURE",
        complexity: "MEDIUM",
        status: "draft",
        summary: "Draft",
        affectedPaths: [],
        parentPlan: "epic",
        order: 2,
        createdAt: "2026-01-01T00:00:00.000Z",
    });

    const result = await resolveEpicContinuation({ cwd, completedPlanName: "epic/01-done" });
    assertEquals(result.kind, "plan");
    assertEquals(result.childPlanName, "epic/02-draft");
});

Deno.test("resolveEpicContinuation stops on the first blocked child instead of skipping later work", async () => {
    const cwd = await makeProject();
    await writePlan(cwd, "epic/01-done", {
        classification: "FEATURE",
        complexity: "MEDIUM",
        status: "verified",
        summary: "Done",
        affectedPaths: [],
        parentPlan: "epic",
        order: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
    });
    await writePlan(cwd, "epic/02-hold", {
        classification: "FEATURE",
        complexity: "MEDIUM",
        status: "on_hold",
        summary: "Hold",
        affectedPaths: [],
        parentPlan: "epic",
        order: 2,
        createdAt: "2026-01-01T00:00:00.000Z",
    });
    await writePlan(cwd, "epic/03-ready", {
        classification: "FEATURE",
        complexity: "MEDIUM",
        status: "ready_for_work",
        summary: "Ready",
        affectedPaths: [],
        parentPlan: "epic",
        order: 3,
        createdAt: "2026-01-01T00:00:00.000Z",
    });

    const result = await resolveEpicContinuation({ cwd, completedPlanName: "epic/01-done" });
    assertEquals(result.kind, "blocked");
    assertEquals(result.reason, "child_on_hold");
    assertEquals(result.childPlanName, "epic/02-hold");
});

Deno.test("resolveEpicContinuation requires dependencies to be verified", async () => {
    const cwd = await makeProject();
    await writePlan(cwd, "epic/01-done", {
        classification: "FEATURE",
        complexity: "MEDIUM",
        status: "verified",
        summary: "Done",
        affectedPaths: [],
        parentPlan: "epic",
        order: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
    });
    await writePlan(cwd, "epic/02-next", {
        classification: "FEATURE",
        complexity: "MEDIUM",
        status: "ready_for_work",
        summary: "Next",
        affectedPaths: [],
        parentPlan: "epic",
        dependencies: ["missing-child"],
        order: 2,
        createdAt: "2026-01-01T00:00:00.000Z",
    });

    const result = await resolveEpicContinuation({ cwd, completedPlanName: "epic/01-done" });
    assertEquals(result.kind, "blocked");
    assertEquals(result.reason, "dependency_missing");
});
