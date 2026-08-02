import { fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai";
import { registerFauxProvider } from "@earendil-works/pi-ai/compat";
import { join } from "@std/path";
import { __resetSettingsForTests } from "../../shared/settings.js";
import { withProcessGlobalTestLock } from "../../testing/process-global-lock.js";
import { initRunWieldTheme } from "../../ui/theme/theme.js";

export interface RuntimeCommandFixture {
    alternateRoot: string;
    homeDir: string;
    projectRoot: string;
    settingsPath: string;
    setModelMessages(messages: RuntimeModelMessage[]): void;
    setModelResponse(text: string): void;
}

export type RuntimeModelMessage = ReturnType<typeof fauxAssistantMessage>;

const TEST_PROVIDER = "runtime-command-fixture";
const TEST_MODEL = "fixture-model";
const TEST_API = "runtime-command-faux";

export async function withRuntimeCommandFixture(
    prefix: string,
    run: (fixture: RuntimeCommandFixture) => Promise<void>,
): Promise<void> {
    await withProcessGlobalTestLock(async () => {
        const previousHome = Deno.env.get("HOME");
        const previousSandboxHome = Deno.env.get("WLD_TEST_SANDBOX_HOME");
        const previousMnemosyneDbPath = Deno.env.get("MNEMOSYNE_DB_PATH");
        const previousCwd = Deno.cwd();
        const previousExitCode = Deno.exitCode;
        const fixtureRoot = await Deno.makeTempDir({ prefix });
        const homeDir = join(fixtureRoot, "home");
        const projectRoot = join(fixtureRoot, "project");
        const alternateRoot = join(fixtureRoot, "alternate-project");
        const runwieldDir = join(homeDir, ".wld");
        const settingsPath = join(runwieldDir, "settings.json");
        await Promise.all([
            Deno.mkdir(runwieldDir, { recursive: true }),
            Deno.mkdir(projectRoot, { recursive: true }),
            Deno.mkdir(alternateRoot, { recursive: true }),
        ]);
        await Deno.writeTextFile(
            join(runwieldDir, "models.json"),
            JSON.stringify({
                providers: {
                    [TEST_PROVIDER]: {
                        name: "Runtime Command Fixture Provider",
                        baseUrl: "http://127.0.0.1:0",
                        apiKey: "fixture-key",
                        api: TEST_API,
                        models: [{
                            id: TEST_MODEL,
                            name: "Runtime Command Fixture Model",
                            api: TEST_API,
                            input: ["text"],
                            contextWindow: 128000,
                            maxTokens: 4096,
                        }],
                    },
                },
            }),
        );
        await Deno.writeTextFile(
            settingsPath,
            JSON.stringify({
                defaultProvider: TEST_PROVIDER,
                defaultModel: TEST_MODEL,
                notifications: { enabled: false },
            }),
        );
        const canonicalProjectRoot = await Deno.realPath(projectRoot);
        const canonicalAlternateRoot = await Deno.realPath(alternateRoot);
        const fauxProvider = registerFauxProvider({
            api: TEST_API,
            provider: TEST_PROVIDER,
            tokensPerSecond: 1000,
            models: [{ id: TEST_MODEL, name: "Runtime Command Fixture Model", input: ["text"] }],
        });

        try {
            Deno.env.set("HOME", homeDir);
            Deno.env.set("WLD_TEST_SANDBOX_HOME", homeDir);
            Deno.env.set("MNEMOSYNE_DB_PATH", join(fixtureRoot, "mnemosyne.db"));
            Deno.chdir(canonicalAlternateRoot);
            Deno.exitCode = 0;
            __resetSettingsForTests();
            initRunWieldTheme();
            await run({
                alternateRoot: canonicalAlternateRoot,
                homeDir,
                projectRoot: canonicalProjectRoot,
                settingsPath,
                setModelMessages: (messages) => {
                    fauxProvider.setResponses(messages.map((message) => () => message));
                },
                setModelResponse: (response) => {
                    fauxProvider.setResponses([() => fauxAssistantMessage(fauxText(response))]);
                },
            });
        } finally {
            fauxProvider.unregister?.();
            initRunWieldTheme();
            __resetSettingsForTests();
            Deno.chdir(previousCwd);
            if (previousHome === undefined) Deno.env.delete("HOME");
            else Deno.env.set("HOME", previousHome);
            if (previousSandboxHome === undefined) Deno.env.delete("WLD_TEST_SANDBOX_HOME");
            else Deno.env.set("WLD_TEST_SANDBOX_HOME", previousSandboxHome);
            if (previousMnemosyneDbPath === undefined) Deno.env.delete("MNEMOSYNE_DB_PATH");
            else Deno.env.set("MNEMOSYNE_DB_PATH", previousMnemosyneDbPath);
            Deno.exitCode = previousExitCode;
            await Deno.remove(fixtureRoot, { recursive: true }).catch(() => {});
        }
    });
}
