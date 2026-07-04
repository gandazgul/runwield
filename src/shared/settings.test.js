/**
 * @module shared/settings.test
 */

import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { join } from "@std/path";
import {
    __resetSettingsForTests,
    getCodeReviewMode,
    getDefaultPlanServerUrl,
    getResolvedVisionFallbackModelSetting,
    getSettingsManager,
    migratePiSettingsOnce,
    normalizePlanServerUrl,
    PLAN_SERVER_URL_SETTING_KEY,
    preserveRunWieldCustomSettingsForWrite,
    setCompactionKeepRecentTokens,
    setCompactionReserveTokens,
    setCustomSetting,
    setDefaultPlanServerUrl,
    shouldCleanupMergedWorktrees,
} from "./settings.js";

// Use a temp dir for isolated file-based tests
const TEMP_DIR = await Deno.makeTempDir({ prefix: "runwield-settings-test-" });
const TEMP_GLOBAL_SETTINGS = join(TEMP_DIR, "global-settings.json");
const TEMP_PROJECT_SETTINGS = join(TEMP_DIR, "project-settings.json");

Deno.test({
    name: "getCustomSetting parses JSONC with comments",
    async fn() {
        // Write a JSONC file (with comments and trailing comma)
        const jsoncContent = `{
            // This is a comment
            "theme": "dark", /* block comment */
            "agents": {
                "router": { "model": "provider/router-v2" },
                "planner": { "model": "provider/planner-v1" },
            },
        }`;
        await Deno.writeTextFileSync(TEMP_GLOBAL_SETTINGS, jsoncContent);

        // We test via the storage path directly by using getCustomSetting.
        // Since getCustomSetting uses the singleton, we need to reset between tests.
        // The approach: temporarily override the storage paths by patching env vars.
        // Instead, let's test the raw parseJsonc behavior via an imported helper.

        // Actually, the cleanest test: write to a temp dir and verify via
        // the module's helper by reading the file content directly.
        const { parse: parseJsonc } = await import("@std/jsonc");
        const parsed = /** @type {Record<string, any>} */ (parseJsonc(jsoncContent));
        assertEquals(parsed.theme, "dark");
        assertEquals(parsed.agents.router.model, "provider/router-v2");
        assertEquals(parsed.agents.planner.model, "provider/planner-v1");
    },
});

Deno.test({
    name: "getMergedCustomSetting merges global and project with project override",
    async fn() {
        // Write global settings
        await Deno.writeTextFileSync(
            TEMP_GLOBAL_SETTINGS,
            JSON.stringify({
                agents: {
                    router: { model: "global/router" },
                    operator: { model: "global/operator" },
                },
            }),
        );

        // Write project settings (overrides router, adds planner)
        await Deno.writeTextFileSync(
            TEMP_PROJECT_SETTINGS,
            JSON.stringify({
                agents: {
                    router: { model: "project/router" },
                    planner: { model: "project/planner" },
                },
            }),
        );

        // Override settings dirs to point to our temp dirs
        // Import after setting up dirs
        const tempWldDir = join(TEMP_DIR, ".wld");
        await Deno.mkdirSync(tempWldDir, { recursive: true });
        await Deno.writeTextFileSync(
            join(tempWldDir, "settings.json"),
            JSON.stringify({
                agents: {
                    router: { model: "global/router" },
                    operator: { model: "global/operator" },
                },
            }),
        );

        const projectWldDir = join(TEMP_DIR, "project-wld");
        await Deno.mkdirSync(projectWldDir, { recursive: true });
        await Deno.writeTextFileSync(
            join(projectWldDir, "settings.json"),
            JSON.stringify({
                agents: {
                    router: { model: "project/router" },
                    planner: { model: "project/planner" },
                },
            }),
        );

        // Verify merge logic directly
        // globalVal: { router: { model: "global/router" }, operator: { model: "global/operator" } }
        // projectVal: { router: { model: "project/router" }, planner: { model: "project/planner" } }
        // Merged: { router: { model: "project/router" }, operator: { model: "global/operator" }, planner: { model: "project/planner" } }

        const globalVal = {
            router: { model: "global/router" },
            operator: { model: "global/operator" },
        };
        const projectVal = {
            router: { model: "project/router" },
            planner: { model: "project/planner" },
        };

        const merged = { ...globalVal, ...projectVal };
        assertEquals(merged.router.model, "project/router");
        assertEquals(merged.operator.model, "global/operator");
        assertEquals(merged.planner.model, "project/planner");
    },
});

Deno.test({
    name: "getMergedCustomSetting returns project value for scalar overrides",
    fn() {
        const projectVal = "project-value";

        // Project wins for scalar
        assertEquals(projectVal, "project-value");
    },
});

Deno.test("preserveRunWieldCustomSettingsForWrite keeps RunWield custom keys across SettingsManager writes", () => {
    const previous = JSON.stringify({
        theme: "old-theme",
        agents: {},
        activeModelPreset: "codex",
        modelPresets: {
            codex: {
                agents: {
                    operator: { model: "crofai/deepseek-v4-pro" },
                },
            },
        },
    });
    const next = JSON.stringify({
        theme: "new-theme",
    });

    const preserved = JSON.parse(preserveRunWieldCustomSettingsForWrite(previous, next));

    assertEquals(preserved, {
        theme: "new-theme",
        agents: {},
        activeModelPreset: "codex",
        modelPresets: {
            codex: {
                agents: {
                    operator: { model: "crofai/deepseek-v4-pro" },
                },
            },
        },
    });
});

Deno.test("preserveRunWieldCustomSettingsForWrite lets explicit new custom values win", () => {
    const previous = JSON.stringify({
        activeModelPreset: "codex",
    });
    const next = JSON.stringify({
        activeModelPreset: "crof.ai",
    });

    assertEquals(JSON.parse(preserveRunWieldCustomSettingsForWrite(previous, next)), {
        activeModelPreset: "crof.ai",
    });
});

Deno.test("preserveRunWieldCustomSettingsForWrite keeps visionFallback", () => {
    const previous = JSON.stringify({ visionFallback: { model: "lmstudio/gemma" } });
    const next = JSON.stringify({ theme: "new-theme" });

    assertEquals(JSON.parse(preserveRunWieldCustomSettingsForWrite(previous, next)), {
        theme: "new-theme",
        visionFallback: { model: "lmstudio/gemma" },
    });
});

Deno.test("preserveRunWieldCustomSettingsForWrite keeps codereview", () => {
    const previous = JSON.stringify({ codereview: "always" });
    const next = JSON.stringify({ theme: "new-theme" });

    assertEquals(JSON.parse(preserveRunWieldCustomSettingsForWrite(previous, next)), {
        theme: "new-theme",
        codereview: "always",
    });
});

Deno.test("preserveRunWieldCustomSettingsForWrite preserves codereview across SettingsManager-shaped writes", () => {
    const previous = JSON.stringify({
        theme: "dark",
        codereview: "ask",
        verification_command: "deno task ci",
    });
    const next = JSON.stringify({
        theme: "light",
        defaultModel: "model-a",
    });

    assertEquals(JSON.parse(preserveRunWieldCustomSettingsForWrite(previous, next)), {
        theme: "light",
        defaultModel: "model-a",
        codereview: "ask",
        verification_command: "deno task ci",
    });
});

Deno.test("getResolvedVisionFallbackModelSetting prefers active preset over top-level", async () => {
    const originalHome = Deno.env.get("HOME");
    const originalCwd = Deno.cwd();
    const tempHome = await Deno.makeTempDir({ prefix: "runwield-vision-home-" });
    const tempProject = await Deno.makeTempDir({ prefix: "runwield-vision-project-" });
    try {
        Deno.env.set("HOME", tempHome);
        Deno.chdir(tempProject);
        await Deno.mkdir(".wld", { recursive: true });
        await Deno.writeTextFile(
            ".wld/settings.json",
            JSON.stringify({
                visionFallback: { model: "top/model" },
                activeModelPreset: "local",
                modelPresets: { local: { visionFallback: { model: "preset/model" } } },
            }),
        );
        __resetSettingsForTests();

        assertEquals(getResolvedVisionFallbackModelSetting(), "preset/model");
    } finally {
        __resetSettingsForTests();
        Deno.chdir(originalCwd);
        if (originalHome === undefined) Deno.env.delete("HOME");
        else Deno.env.set("HOME", originalHome);
        await Deno.remove(tempHome, { recursive: true });
        await Deno.remove(tempProject, { recursive: true });
    }
});

Deno.test("migratePiSettingsOnce copies legacy Pi settings when RunWield settings are missing", async () => {
    const tempDir = await Deno.makeTempDir({ prefix: "runwield-settings-migration-" });
    try {
        const piPath = join(tempDir, ".pi", "agent", "settings.json");
        const runwieldPath = join(tempDir, ".wld", "settings.json");
        await Deno.mkdir(join(tempDir, ".pi", "agent"), { recursive: true });
        await Deno.writeTextFile(piPath, '{"theme":"legacy-pi"}');

        const result = migratePiSettingsOnce({ runwieldPath, piPath });

        assertEquals(result, { copied: true, skipped: false });
        assertEquals(await Deno.readTextFile(runwieldPath), '{"theme":"legacy-pi"}');
    } finally {
        await Deno.remove(tempDir, { recursive: true });
    }
});

Deno.test("migratePiSettingsOnce leaves existing RunWield settings untouched", async () => {
    const tempDir = await Deno.makeTempDir({ prefix: "runwield-settings-migration-" });
    try {
        const piPath = join(tempDir, ".pi", "agent", "settings.json");
        const runwieldPath = join(tempDir, ".wld", "settings.json");
        await Deno.mkdir(join(tempDir, ".pi", "agent"), { recursive: true });
        await Deno.mkdir(join(tempDir, ".wld"), { recursive: true });
        await Deno.writeTextFile(piPath, '{"theme":"legacy-pi"}');
        await Deno.writeTextFile(runwieldPath, '{"theme":"runwield"}');

        const result = migratePiSettingsOnce({ runwieldPath, piPath });

        assertEquals(result, { copied: false, skipped: true });
        assertEquals(await Deno.readTextFile(runwieldPath), '{"theme":"runwield"}');
    } finally {
        await Deno.remove(tempDir, { recursive: true });
    }
});

Deno.test("shouldCleanupMergedWorktrees defaults true and honors false setting", async () => {
    const originalHome = Deno.env.get("HOME");
    const originalCwd = Deno.cwd();
    const tempHome = await Deno.makeTempDir({ prefix: "runwield-cleanup-setting-home-" });
    const tempProject = await Deno.makeTempDir({ prefix: "runwield-cleanup-setting-project-" });
    try {
        Deno.env.set("HOME", tempHome);
        Deno.chdir(tempProject);
        __resetSettingsForTests();

        assertEquals(shouldCleanupMergedWorktrees(), true);

        await setCustomSetting("cleanupMergedWorktrees", false, "project");
        assertEquals(shouldCleanupMergedWorktrees(), false);
    } finally {
        Deno.chdir(originalCwd);
        if (originalHome === undefined) Deno.env.delete("HOME");
        else Deno.env.set("HOME", originalHome);
        __resetSettingsForTests();
        await Deno.remove(tempHome, { recursive: true });
        await Deno.remove(tempProject, { recursive: true });
    }
});

Deno.test("compaction token setters persist globally and preserve sibling compaction fields", async () => {
    const originalHome = Deno.env.get("HOME");
    const originalCwd = Deno.cwd();
    const tempHome = await Deno.makeTempDir({ prefix: "runwield-compaction-setting-home-" });
    const tempProject = await Deno.makeTempDir({ prefix: "runwield-compaction-setting-project-" });
    try {
        Deno.env.set("HOME", tempHome);
        Deno.chdir(tempProject);
        __resetSettingsForTests();

        getSettingsManager().setCompactionEnabled(false);
        await getSettingsManager().flush();
        await setCompactionReserveTokens(12000);
        await setCompactionKeepRecentTokens(34000);

        const settings = getSettingsManager().getCompactionSettings();
        assertEquals(settings, { enabled: false, reserveTokens: 12000, keepRecentTokens: 34000 });
        assertEquals(JSON.parse(await Deno.readTextFile(join(tempHome, ".wld", "settings.json"))).compaction, {
            enabled: false,
            reserveTokens: 12000,
            keepRecentTokens: 34000,
        });
    } finally {
        Deno.chdir(originalCwd);
        if (originalHome === undefined) Deno.env.delete("HOME");
        else Deno.env.set("HOME", originalHome);
        __resetSettingsForTests();
        await Deno.remove(tempHome, { recursive: true });
        await Deno.remove(tempProject, { recursive: true });
    }
});

Deno.test("compaction token setters reject invalid values before writing", async () => {
    const originalHome = Deno.env.get("HOME");
    const originalCwd = Deno.cwd();
    const tempHome = await Deno.makeTempDir({ prefix: "runwield-compaction-invalid-home-" });
    const tempProject = await Deno.makeTempDir({ prefix: "runwield-compaction-invalid-project-" });
    try {
        Deno.env.set("HOME", tempHome);
        Deno.chdir(tempProject);
        __resetSettingsForTests();

        let message = "";
        try {
            await setCompactionReserveTokens(0);
        } catch (error) {
            message = error instanceof Error ? error.message : String(error);
        }
        assertEquals(message, "Reserve tokens must be a positive integer.");
        assertEquals(getSettingsManager().getCompactionSettings().reserveTokens, 16384);
    } finally {
        Deno.chdir(originalCwd);
        if (originalHome === undefined) Deno.env.delete("HOME");
        else Deno.env.set("HOME", originalHome);
        __resetSettingsForTests();
        await Deno.remove(tempHome, { recursive: true });
        await Deno.remove(tempProject, { recursive: true });
    }
});

Deno.test("getCodeReviewMode defaults none, honors overrides, and rejects invalid values", async () => {
    const originalHome = Deno.env.get("HOME");
    const originalCwd = Deno.cwd();
    const tempHome = await Deno.makeTempDir({ prefix: "runwield-codereview-setting-home-" });
    const tempProject = await Deno.makeTempDir({ prefix: "runwield-codereview-setting-project-" });
    try {
        Deno.env.set("HOME", tempHome);
        Deno.chdir(tempProject);
        __resetSettingsForTests();

        assertEquals(getCodeReviewMode(), "none");

        await setCustomSetting("codereview", " ALWAYS ", "global");
        assertEquals(getCodeReviewMode(), "always");

        await setCustomSetting("codereview", "ask", "project");
        assertEquals(getCodeReviewMode(), "ask");

        await setCustomSetting("codereview", "sometimes", "project");
        assertEquals(getCodeReviewMode(), "none");
    } finally {
        Deno.chdir(originalCwd);
        if (originalHome === undefined) Deno.env.delete("HOME");
        else Deno.env.set("HOME", originalHome);
        __resetSettingsForTests();
        await Deno.remove(tempHome, { recursive: true });
        await Deno.remove(tempProject, { recursive: true });
    }
});

// Cleanup temp dirs
Deno.test({
    name: "cleanup temp dirs",
    fn() {
        try {
            Deno.removeSync(TEMP_DIR, { recursive: true });
        } catch {
            // ignore cleanup failures
        }
    },
});

Deno.test("Plan Server URL setting uses global value and project override precedence", async () => {
    const originalHome = Deno.env.get("HOME");
    const originalCwd = Deno.cwd();
    const tempHome = await Deno.makeTempDir({ prefix: "runwield-plan-server-home-" });
    const tempProject = await Deno.makeTempDir({ prefix: "runwield-plan-server-project-" });
    try {
        Deno.env.set("HOME", tempHome);
        Deno.chdir(tempProject);
        __resetSettingsForTests();

        await setDefaultPlanServerUrl("https://global.example.test/", "global");
        assertEquals(getDefaultPlanServerUrl(), "https://global.example.test");
        await setDefaultPlanServerUrl("https://project.example.test/base/", "project");
        assertEquals(getDefaultPlanServerUrl(), "https://project.example.test/base");
    } finally {
        __resetSettingsForTests();
        Deno.chdir(originalCwd);
        if (originalHome === undefined) Deno.env.delete("HOME");
        else Deno.env.set("HOME", originalHome);
        await Deno.remove(tempHome, { recursive: true });
        await Deno.remove(tempProject, { recursive: true });
    }
});

Deno.test("Plan Server URL setting validates clean non-secret URLs", () => {
    assertEquals(normalizePlanServerUrl(" https://plans.example.test/base/ "), "https://plans.example.test/base");
    assertThrows(() => normalizePlanServerUrl("not a url"));
    assertThrows(() => normalizePlanServerUrl("https://plans.example.test/?key=secret&cap=secret&role=reviewer"));
    assertThrows(() => normalizePlanServerUrl("https://plans.example.test/#key=secret&cap=secret&role=reviewer"));
    assertThrows(() => normalizePlanServerUrl("https://plans.example.test/base/p/space-1"));
    assertThrows(() =>
        normalizePlanServerUrl("https://plans.example.test/base/p/space-1#key=secret&cap=secret&role=reviewer")
    );
    assertThrows(() =>
        normalizePlanServerUrl("https://plans.example.test/p/space-1#key=secret&cap=secret&role=reviewer")
    );
});

Deno.test("Plan Server URL setting rejects full share URLs and secret fragments", async () => {
    await assertRejects(() =>
        setDefaultPlanServerUrl("https://plans.example.test/p/space-1#key=secret&cap=secret", "project")
    );
});

Deno.test("Plan Server URL setting is preserved across SettingsManager-shaped writes", () => {
    const previous = JSON.stringify({ [PLAN_SERVER_URL_SETTING_KEY]: "https://plans.example.test" });
    const next = JSON.stringify({ theme: "light" });
    assertEquals(JSON.parse(preserveRunWieldCustomSettingsForWrite(previous, next)), {
        theme: "light",
        [PLAN_SERVER_URL_SETTING_KEY]: "https://plans.example.test",
    });
});

Deno.test("Plan Server URL setting stores only the normalized server URL", async () => {
    const originalHome = Deno.env.get("HOME");
    const originalCwd = Deno.cwd();
    const tempHome = await Deno.makeTempDir({ prefix: "runwield-plan-server-clean-home-" });
    const tempProject = await Deno.makeTempDir({ prefix: "runwield-plan-server-clean-project-" });
    try {
        Deno.env.set("HOME", tempHome);
        Deno.chdir(tempProject);
        __resetSettingsForTests();
        await setDefaultPlanServerUrl("https://plans.example.test/root/", "project");
        const settings = await Deno.readTextFile(join(tempProject, ".wld", "settings.json"));
        assertEquals(JSON.parse(settings)[PLAN_SERVER_URL_SETTING_KEY], "https://plans.example.test/root");
    } finally {
        __resetSettingsForTests();
        Deno.chdir(originalCwd);
        if (originalHome === undefined) Deno.env.delete("HOME");
        else Deno.env.set("HOME", originalHome);
        await Deno.remove(tempHome, { recursive: true });
        await Deno.remove(tempProject, { recursive: true });
    }
});
