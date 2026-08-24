import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { parse as parseJsonc } from "@std/jsonc";
import type { AgentToolResult, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
    createInitVerificationCommandOperation,
    INIT_VERIFICATION_COMMAND_PLACEHOLDER,
} from "./init-verification-command.ts";
import { getCustomSetting } from "../shared/settings.js";

interface InitVerificationCommandParams {
    command?: string;
    verificationNotImplemented?: boolean;
}

interface InitVerificationCommandDetails {
    outcome: "saved" | "rejected";
    verificationCommand?: string;
    reason?: string;
}

const EXTENSION_CONTEXT = {} as ExtensionContext;

async function executeTool(
    operation: ReturnType<typeof createInitVerificationCommandOperation>,
    params: InitVerificationCommandParams,
) {
    return await operation.tool.execute(
        "tool-call-1",
        params,
        undefined,
        undefined,
        EXTENSION_CONTEXT,
    ) as AgentToolResult<InitVerificationCommandDetails>;
}

async function readProjectSettings(projectRoot: string) {
    const text = await Deno.readTextFile(join(projectRoot, ".wld", "settings.json"));
    return parseJsonc(text) as { verification_command?: string; codereview?: string; nested?: { retained?: boolean } };
}

Deno.test("init verification command operation saves a confirmed command in project settings", async () => {
    const projectRoot = await Deno.makeTempDir({ prefix: "init-verification-command-" });
    const operation = createInitVerificationCommandOperation({ projectRoot });

    const result = await executeTool(operation, { command: "deno task ci" });

    assertEquals(result.details, { outcome: "saved", verificationCommand: "deno task ci" });
    assertEquals(operation.getConfirmedCommand(), "deno task ci");
    assertEquals(getCustomSetting("verification_command", "project", projectRoot), "deno task ci");
    assertEquals((await readProjectSettings(projectRoot)).verification_command, "deno task ci");
});

Deno.test("init verification command operation saves the exact placeholder for no implemented verification", async () => {
    const projectRoot = await Deno.makeTempDir({ prefix: "init-verification-placeholder-" });
    const operation = createInitVerificationCommandOperation({ projectRoot });

    const result = await executeTool(operation, { verificationNotImplemented: true });

    assertEquals(result.details, {
        outcome: "saved",
        verificationCommand: INIT_VERIFICATION_COMMAND_PLACEHOLDER,
    });
    assertEquals(operation.getConfirmedCommand(), INIT_VERIFICATION_COMMAND_PLACEHOLDER);
    assertEquals((await readProjectSettings(projectRoot)).verification_command, INIT_VERIFICATION_COMMAND_PLACEHOLDER);
});

Deno.test("init verification command operation preserves unrelated project settings", async () => {
    const projectRoot = await Deno.makeTempDir({ prefix: "init-verification-preserve-" });
    await Deno.mkdir(join(projectRoot, ".wld"));
    await Deno.writeTextFile(
        join(projectRoot, ".wld", "settings.json"),
        '{\n  // keep review gate\n  "codereview": "ask",\n  "nested": { "retained": true }\n}\n',
    );
    const operation = createInitVerificationCommandOperation({ projectRoot });

    await executeTool(operation, { command: "npm run verify" });

    assertEquals(await readProjectSettings(projectRoot), {
        codereview: "ask",
        nested: { retained: true },
        verification_command: "npm run verify",
    });
});

Deno.test("init verification command operation rejects unresolved outcomes", async () => {
    const projectRoot = await Deno.makeTempDir({ prefix: "init-verification-reject-" });
    const cases: InitVerificationCommandParams[] = [
        {},
        { command: "   " },
        { command: "deno task ci", verificationNotImplemented: true },
    ];

    for (const params of cases) {
        const operation = createInitVerificationCommandOperation({ projectRoot });
        const result = await executeTool(operation, params);

        assertEquals(result.details.outcome, "rejected");
        assertEquals(operation.getConfirmedCommand(), undefined);
    }

    await assertRejects(
        () => Deno.stat(join(projectRoot, ".wld", "settings.json")),
        Deno.errors.NotFound,
    );
});
