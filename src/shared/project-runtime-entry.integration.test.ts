import { assertEquals, assertRejects } from "@std/assert";
import { dirname, join } from "@std/path";
import { withProcessGlobalTestLock } from "../testing/process-global-lock.js";
import { defineCommittedGitFixture } from "./git-test-fixture.ts";
import {
    enterProjectRuntime,
    ProjectRuntimeEntryRefusedError,
    resolveProjectRuntimeLayout,
} from "./project-runtime-layout.ts";
import { listEntries } from "./worktree-registry.js";

const fixture = defineCommittedGitFixture({ "README.md": "# runtime entry\n" });

Deno.test("Project Runtime Entry adopts legacy registry before normal registry reads", async () => {
    await withProcessGlobalTestLock(async () => {
        const originalSandboxHome = Deno.env.get("WLD_TEST_SANDBOX_HOME");
        const projectRoot = await fixture.checkout({ prefix: "runwield-runtime-entry-adopt-" });
        try {
            Deno.env.delete("WLD_TEST_SANDBOX_HOME");
            const legacyPath = join(projectRoot, ".wld", "worktrees.json");
            await Deno.mkdir(dirname(legacyPath), { recursive: true });
            await Deno.writeTextFile(
                legacyPath,
                `${
                    JSON.stringify(
                        {
                            version: 2,
                            entries: [{
                                id: "entry-1",
                                planName: "demo-plan",
                                planId: "plan-demo",
                                baseBranch: "main",
                                baseRef: "HEAD",
                                baseCommit: "abc123",
                                branch: "runwield/worktree/demo-plan-entry-1",
                                path: projectRoot,
                                status: "active",
                                createdAt: "2026-01-01T00:00:00.000Z",
                                updatedAt: "2026-01-01T00:00:00.000Z",
                            }],
                        },
                        null,
                        2,
                    )
                }\n`,
            );

            const entries = await listEntries(projectRoot, { migrate: false });
            const layout = resolveProjectRuntimeLayout(projectRoot);
            const markerBefore = await Deno.readTextFile(layout.primary.layoutMarkerPath);
            await enterProjectRuntime(projectRoot);
            const markerAfter = await Deno.readTextFile(layout.primary.layoutMarkerPath);

            assertEquals(entries.map((entry) => entry.id), ["entry-1"]);
            assertEquals(markerAfter, markerBefore);
            await assertRejects(() => Deno.lstat(legacyPath), Deno.errors.NotFound);
        } finally {
            if (originalSandboxHome === undefined) Deno.env.delete("WLD_TEST_SANDBOX_HOME");
            else Deno.env.set("WLD_TEST_SANDBOX_HOME", originalSandboxHome);
            await Deno.remove(projectRoot, { recursive: true }).catch(() => {});
        }
    });
});

Deno.test("Project Runtime Entry refusal stops direct normal registry access", async () => {
    await withProcessGlobalTestLock(async () => {
        const originalSandboxHome = Deno.env.get("WLD_TEST_SANDBOX_HOME");
        const projectRoot = await fixture.checkout({ prefix: "runwield-runtime-entry-refuse-" });
        try {
            Deno.env.delete("WLD_TEST_SANDBOX_HOME");
            const legacyPath = join(projectRoot, ".wld", "worktrees.json");
            await Deno.mkdir(dirname(legacyPath), { recursive: true });
            await Deno.writeTextFile(legacyPath, "null\n");

            const refusal = await assertRejects(
                () => listEntries(projectRoot, { migrate: false }),
                ProjectRuntimeEntryRefusedError,
            );
            const layout = resolveProjectRuntimeLayout(projectRoot);

            assertEquals(refusal.reason, "malformed_registry");
            assertEquals(refusal.paths, [join(await Deno.realPath(projectRoot), ".wld", "worktrees.json")]);
            await assertRejects(() => Deno.lstat(layout.primary.worktreeRegistryPath), Deno.errors.NotFound);
            await assertRejects(() => Deno.lstat(layout.primary.layoutMarkerPath), Deno.errors.NotFound);
        } finally {
            if (originalSandboxHome === undefined) Deno.env.delete("WLD_TEST_SANDBOX_HOME");
            else Deno.env.set("WLD_TEST_SANDBOX_HOME", originalSandboxHome);
            await Deno.remove(projectRoot, { recursive: true }).catch(() => {});
        }
    });
});
