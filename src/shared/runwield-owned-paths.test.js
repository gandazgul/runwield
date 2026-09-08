import { assertEquals, assertStringIncludes } from "@std/assert";
import {
    CURRENT_PROJECT_RUNTIME_PATHS,
    isCurrentProjectRuntimePath,
    isLegacyProjectRuntimeHazardPath,
    isRunWieldOwnedRuntimePath,
    LEGACY_PROJECT_RUNTIME_HAZARD_PATHS,
    RUNWIELD_GITIGNORE_BLOCK,
    RUNWIELD_OWNED_RUNTIME_PATHS,
    runwieldOwnedPathspecExclusions,
} from "./runwield-owned-paths.ts";

Deno.test("RunWield runtime classifiers separate current state from legacy hazards", () => {
    const cases = [
        { path: ".wld/internal", current: true, legacy: false, aggregate: true },
        { path: "./.wld/internal", current: true, legacy: false, aggregate: true },
        { path: ".wld/internal/controller/plans/a.json", current: true, legacy: false, aggregate: true },
        { path: ".wld/internal/worktrees.json.abc.tmp", current: true, legacy: false, aggregate: true },
        { path: ".wld", current: false, legacy: false, aggregate: false },
        { path: ".wld/internal-other", current: false, legacy: false, aggregate: false },
        { path: ".wldx/internal", current: false, legacy: false, aggregate: false },
        { path: ".wld/settings.json", current: false, legacy: false, aggregate: false },
        { path: ".wld/agents/a.md", current: false, legacy: false, aggregate: false },
        { path: ".wld/skills/s/SKILL.md", current: false, legacy: false, aggregate: false },
        { path: ".wld/prompts/a.md", current: false, legacy: false, aggregate: false },
        { path: ".wld/prompt-templates/a.md", current: false, legacy: false, aggregate: false },
        { path: "src/main.js", current: false, legacy: false, aggregate: false },
    ];

    for (const { path, current, legacy, aggregate } of cases) {
        assertEquals(isCurrentProjectRuntimePath(path), current, `${path} current`);
        assertEquals(isLegacyProjectRuntimeHazardPath(path), legacy, `${path} legacy`);
        assertEquals(isRunWieldOwnedRuntimePath(path), aggregate, `${path} aggregate`);
    }
});

Deno.test("legacy runtime hazards cover only the bounded old catalog and temp-file shapes", () => {
    for (const path of LEGACY_PROJECT_RUNTIME_HAZARD_PATHS) {
        assertEquals(isCurrentProjectRuntimePath(path), false, `${path} is not current`);
        assertEquals(isLegacyProjectRuntimeHazardPath(path), true, `${path} is legacy`);
        assertEquals(isRunWieldOwnedRuntimePath(path), true, `${path} is aggregate`);
    }

    for (
        const path of [
            ".wld/plan-locks/demo.lock",
            ".wld/plan-transitions/transition.json",
            ".wld/plan-backups/recovery.json",
            ".wld/plan-staging/attempt-1/state.json",
            ".wld/worktrees/child",
            ".wld/debug/log.txt",
            ".wld/controller/plans/demo.json",
            ".wld/worktrees.json.dea8f5f0-04a1-4bb4-ab80-a22496a5a593.tmp",
            "./.wld/worktrees.json.abc.tmp",
            ".wld/collaboration-secrets.json.dea8f5f0-04a1-4bb4-ab80-a22496a5a593.tmp",
        ]
    ) {
        assertEquals(isCurrentProjectRuntimePath(path), false, `${path} is not current`);
        assertEquals(isLegacyProjectRuntimeHazardPath(path), true, `${path} is legacy`);
        assertEquals(isRunWieldOwnedRuntimePath(path), true, `${path} is aggregate`);
    }

    for (
        const path of [
            ".wld/plan-locks-other/demo.lock",
            ".wld/worktrees.json.tmp",
            ".wld/worktrees.json.abc.tmp/child.json",
            ".wld/collaboration-secrets.json.tmp",
            ".wld/collaboration-secrets.json.abc.tmp/child.json",
            ".wld/work-record-supersession.lock/child.json",
        ]
    ) {
        assertEquals(isCurrentProjectRuntimePath(path), false, `${path} is not current`);
        assertEquals(isLegacyProjectRuntimeHazardPath(path), false, `${path} is not legacy`);
        assertEquals(isRunWieldOwnedRuntimePath(path), false, `${path} is not aggregate`);
    }
});

Deno.test("temporary Git safety exports protect current and legacy runtime paths", () => {
    assertEquals(CURRENT_PROJECT_RUNTIME_PATHS, [".wld/internal"]);

    for (const path of CURRENT_PROJECT_RUNTIME_PATHS) {
        assertEquals(RUNWIELD_OWNED_RUNTIME_PATHS.includes(path), true, path);
        assertStringIncludes(RUNWIELD_GITIGNORE_BLOCK, path);
    }
    for (const path of LEGACY_PROJECT_RUNTIME_HAZARD_PATHS) {
        assertEquals(RUNWIELD_OWNED_RUNTIME_PATHS.includes(path), true, path);
        assertStringIncludes(RUNWIELD_GITIGNORE_BLOCK, path);
    }

    assertEquals(runwieldOwnedPathspecExclusions.includes(":(exclude).wld/internal/**"), true);
    assertEquals(runwieldOwnedPathspecExclusions.includes(":(exclude).wld/plan-locks/**"), true);
    assertEquals(runwieldOwnedPathspecExclusions.includes(":(exclude).wld/worktrees.json"), true);
});
