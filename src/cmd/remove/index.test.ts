import { DefaultPackageManager } from "@earendil-works/pi-coding-agent";
import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
    approveMetricsExporter,
    listInstalledMetricsExporters,
    type MetricsExporterApproval,
} from "../../shared/extensions/metrics-exporter.ts";
import {
    __resetSettingsForTests,
    getCustomSetting,
    getSettingsDir,
    getSettingsManager,
} from "../../shared/settings.js";
import { withProcessGlobalTestLock } from "../../testing/process-global-lock.ts";
import { discoverAndRegisterThemes, getAvailableThemes, initRunWieldTheme, setTheme } from "../../ui/theme/theme.js";
import { runRemoveCommand } from "./index.ts";

interface RemoveCommandFixture {
    homeDir: string;
    packageDir: string;
    projectRoot: string;
    source: string;
}

async function withRemoveCommandFixture(run: (fixture: RemoveCommandFixture) => Promise<void>): Promise<void> {
    await withProcessGlobalTestLock(async () => {
        const previousHome = Deno.env.get("HOME");
        const previousSandboxHome = Deno.env.get("WLD_TEST_SANDBOX_HOME");
        const previousCwd = Deno.cwd();
        const previousExitCode = Deno.exitCode;
        const fixtureRoot = await Deno.makeTempDir({ prefix: "runwield-remove-command-" });
        const homeDir = join(fixtureRoot, "home");
        const packageDir = join(fixtureRoot, "fixture-theme-package");
        const projectRoot = join(fixtureRoot, "project");
        await Promise.all([
            Deno.mkdir(homeDir, { recursive: true }),
            Deno.mkdir(join(packageDir, "themes"), { recursive: true }),
            Deno.mkdir(projectRoot, { recursive: true }),
        ]);
        await Deno.writeTextFile(
            join(packageDir, "package.json"),
            JSON.stringify({
                name: "fixture-theme-package",
                version: "1.0.0",
                pi: { themes: ["themes/*.json"] },
            }),
        );
        await Deno.writeTextFile(
            join(packageDir, "themes", "fixture-theme.json"),
            JSON.stringify({
                name: "fixture-theme",
                vars: { fixtureAccent: "#abcdef" },
                colors: { accent: "fixtureAccent" },
            }),
        );
        const canonicalPackageDir = await Deno.realPath(packageDir);
        const canonicalProjectRoot = await Deno.realPath(projectRoot);

        try {
            Deno.env.set("HOME", homeDir);
            Deno.env.set("WLD_TEST_SANDBOX_HOME", homeDir);
            Deno.chdir(canonicalProjectRoot);
            Deno.exitCode = 0;
            __resetSettingsForTests();
            initRunWieldTheme();
            await run({
                homeDir,
                packageDir: canonicalPackageDir,
                projectRoot: canonicalProjectRoot,
                source: canonicalPackageDir,
            });
        } finally {
            initRunWieldTheme();
            __resetSettingsForTests();
            Deno.chdir(previousCwd);
            if (previousHome === undefined) Deno.env.delete("HOME");
            else Deno.env.set("HOME", previousHome);
            if (previousSandboxHome === undefined) Deno.env.delete("WLD_TEST_SANDBOX_HOME");
            else Deno.env.set("WLD_TEST_SANDBOX_HOME", previousSandboxHome);
            Deno.exitCode = previousExitCode;
            await Deno.remove(fixtureRoot, { recursive: true }).catch(() => {});
        }
    });
}

async function captureConsole(run: () => Promise<void>): Promise<{ logs: string[]; errors: string[] }> {
    const originalLog = console.log;
    const originalError = console.error;
    const logs: string[] = [];
    const errors: string[] = [];
    console.log = (message = "") => logs.push(String(message));
    console.error = (message = "") => errors.push(String(message));
    try {
        await run();
    } finally {
        console.log = originalLog;
        console.error = originalError;
    }
    return { logs, errors };
}

async function installFixturePackage(projectRoot: string, source: string): Promise<void> {
    const settings = getSettingsManager(projectRoot);
    const packageManager = new DefaultPackageManager({
        cwd: projectRoot,
        agentDir: getSettingsDir("global", projectRoot),
        settingsManager: settings,
    });
    await packageManager.installAndPersist(source);
}

Deno.test("runRemoveCommand unregisters a real local package and resets its active theme", async () => {
    await withRemoveCommandFixture(async ({ packageDir, projectRoot, source }) => {
        await installFixturePackage(projectRoot, source);
        const settings = getSettingsManager(projectRoot);
        await discoverAndRegisterThemes();
        assert(getAvailableThemes().includes("fixture-theme"));
        assertEquals(setTheme("fixture-theme").success, true);
        settings.setTheme("fixture-theme");

        const output = await captureConsole(() => runRemoveCommand([source]));

        assertEquals(output.errors, []);
        assertEquals(output.logs, [
            'Active theme "fixture-theme" was provided by the removed package — reset to catppuccin-mocha.',
            `Successfully removed ${source}`,
        ]);
        assertEquals(settings.getGlobalSettings().packages, []);
        assertEquals(settings.getTheme(), "catppuccin-mocha");
        assertEquals(getAvailableThemes().includes("fixture-theme"), false);
        assert((await Deno.stat(join(packageDir, "themes", "fixture-theme.json"))).isFile);
        assertEquals(Deno.exitCode, 0);
    });
});

Deno.test("runRemoveCommand reports a real local package that is not installed", async () => {
    await withRemoveCommandFixture(async ({ source }) => {
        const output = await captureConsole(() => runRemoveCommand([source]));

        assertEquals(output.errors, []);
        assertEquals(output.logs, [`Package "${source}" is not currently installed — nothing to remove.`]);
        assertEquals(Deno.exitCode, 0);
    });
});

Deno.test("runRemoveCommand reports usage without terminating the test process", async () => {
    await withRemoveCommandFixture(async () => {
        const output = await captureConsole(() => runRemoveCommand([]));

        assertEquals(output.logs, []);
        assertEquals(output.errors, ["Usage: wld remove <source>"]);
        assertEquals(Deno.exitCode, 1);
    });
});

Deno.test("runRemoveCommand deletes only the removed source's exporter approvals", async () => {
    await withRemoveCommandFixture(async ({ packageDir, projectRoot, source }) => {
        const manifestPath = join(packageDir, "package.json");
        const manifest = JSON.parse(await Deno.readTextFile(manifestPath));
        manifest.wld = { metricsExporter: { contract: 1, id: "fixture", entry: "./exporter.js" } };
        await Deno.writeTextFile(manifestPath, JSON.stringify(manifest));
        await Deno.writeTextFile(join(packageDir, "exporter.js"), "export default () => {};\n");
        await installFixturePackage(projectRoot, source);
        const other = join(projectRoot, "other-package");
        await Deno.mkdir(other);
        await Deno.writeTextFile(join(other, "package.json"), JSON.stringify(manifest));
        await Deno.writeTextFile(join(other, "exporter.js"), "export default () => {};\n");
        await installFixturePackage(projectRoot, other);
        await getSettingsManager().flush();
        for (const exporter of await listInstalledMetricsExporters()) await approveMetricsExporter(exporter);
        const before: MetricsExporterApproval[] = getCustomSetting("metricsExporterApprovals", "global");
        assertEquals(before.length, 2);
        const output = await captureConsole(() => runRemoveCommand([source]));
        assertEquals(output.errors, []);
        assertEquals(
            getCustomSetting("metricsExporterApprovals", "global"),
            before.filter((record) => record.installedPath === other),
        );
    });
});
