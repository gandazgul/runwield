import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { loadPlanBodyById, savePlanBodyById } from "../../plan-store.js";
import { createRendererFixture } from "../../../scripts/workspace-memory-fixture.ts";
import { RUNWIELD_ROOT } from "../../../runtime-root.js";

for (const mode of ["normal", "missing", "fallback", "disabled"]) {
    Deno.test(`renderer entry lifecycle: ${mode}`, async () => {
        const result = await new Deno.Command(Deno.execPath(), {
            args: ["run", "-A", "scripts/workspace-renderer-probe.ts", mode],
            cwd: RUNWIELD_ROOT,
            stdout: "piped",
            stderr: "piped",
        }).output();
        assertEquals(result.success, true, new TextDecoder().decode(result.stderr));
        const report = JSON.parse(new TextDecoder().decode(result.stdout));
        assertEquals(report.responses, 12);
        assertEquals(report.count[mode === "fallback" ? "runtime" : "source"], 1);
    });
}

Deno.test("shared renderer serves concurrent pages with independent current Plan, review and question content", async () => {
    const root = await Deno.makeTempDir({ prefix: "renderer-lifecycle-" });
    const fixture = await createRendererFixture(root, "http://127.0.0.1");
    try {
        const routes = [
            ["/fixture/local/plans/fixture-id-0", "Memory plan body 0"],
            ["/fixture/local/plans/fixture-id-1", "Memory plan body 1"],
            ["/fixture/review/plan", "Memory plan review marker"],
            ["/fixture/review/code", "Memory code review marker"],
            ["/fixture/question/session-question", "Memory question marker"],
            ...fixture.routes.filter((route) => route.path.startsWith("/fixture/owner/")).map((
                route,
            ) => [route.path, route.marker]),
        ];
        for (let round = 0; round < 2; round++) {
            const responses = await Promise.all(routes.map(async ([path, marker]) => {
                const response = await fixture.request(path);
                return { status: response.status, body: await response.text(), marker };
            }));
            for (const { status, body, marker } of responses) {
                assertEquals(status, 200);
                assertStringIncludes(body, marker);
            }
        }
        const project = join(root, "project-a");
        const plan = await loadPlanBodyById(project, "fixture-id-0");
        await savePlanBodyById(
            project,
            "fixture-id-0",
            "# Fixture Plan 0\n\n## Context\n\nUpdated Plan body",
            plan.bodyHash,
            { expectedRevision: plan.revision },
        );
        const current = await fixture.request("/fixture/local/plans/fixture-id-0");
        assertEquals(current.status, 200);
        assertStringIncludes(await current.text(), "Updated Plan body");
        const other = await fixture.request("/fixture/local/plans/fixture-id-1");
        assertEquals(other.status, 200);
        assertStringIncludes(await other.text(), "Memory plan body 1");
    } finally {
        await fixture.close();
        await Deno.remove(root, { recursive: true });
    }
});
