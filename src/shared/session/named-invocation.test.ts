import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { withRuntimeCommandFixture } from "../../cmd/testing/runtime-command-fixture.ts";
import { resolveNamedInvocation } from "./named-invocation.ts";

async function writePrompt(projectRoot: string, name: string, frontMatter: string[], body: string): Promise<void> {
    const promptDir = join(projectRoot, ".wld", "prompts");
    await Deno.mkdir(promptDir, { recursive: true });
    await Deno.writeTextFile(join(promptDir, `${name}.md`), ["---", ...frontMatter, "---", body].join("\n"));
}

async function writeSkill(projectRoot: string, name: string): Promise<void> {
    const skillDir = join(projectRoot, ".wld", "skills", name);
    await Deno.mkdir(skillDir, { recursive: true });
    await Deno.writeTextFile(
        join(skillDir, "SKILL.md"),
        ["---", `name: "${name}"`, "description: fixture skill", "---", "Use the fixture skill body."].join("\n"),
    );
}

Deno.test("resolveNamedInvocation resolves Prompt Template Front Matter and exact expansion", async () => {
    await withRuntimeCommandFixture("named-invocation-resolve-template-", async ({ projectRoot }) => {
        await writePrompt(
            projectRoot,
            "summarize",
            ["agent: operator", "model: runtime-command-fixture/fixture-model"],
            "Summarize: {{input}}",
        );

        const resolved = await resolveNamedInvocation({ cwd: projectRoot, text: "/summarize the active diff" });

        assertEquals(resolved.kind, "prompt_template");
        if (resolved.kind !== "prompt_template") return;
        assertEquals(resolved.name, "summarize");
        assertEquals(resolved.agentName, "operator");
        assertEquals(resolved.model, "runtime-command-fixture/fixture-model");
        assertEquals(resolved.expandedRequest, "Summarize: {{input}}\n\nthe active diff");
        const payload = resolved.payload;
        assertEquals(payload.compactInvocation, "/summarize the active diff");
        assertEquals(payload.expandedRequest, "Summarize: {{input}}\n\nthe active diff");
        assertEquals(payload.profile.agentName, "operator");
    });
});

Deno.test("resolveNamedInvocation defaults Prompt Templates to Operator when agent is omitted", async () => {
    await withRuntimeCommandFixture("named-invocation-default-agent-", async ({ projectRoot }) => {
        await writePrompt(projectRoot, "commit-message", [], "Write a commit message for {{input}}");

        const resolved = await resolveNamedInvocation({ cwd: projectRoot, text: "/commit-message staged files" });

        assertEquals(resolved.kind, "prompt_template");
        if (resolved.kind !== "prompt_template") return;
        assertEquals(resolved.agentName, "operator");
    });
});

Deno.test("resolveNamedInvocation resolves Skills without changing the Agent profile", async () => {
    await withRuntimeCommandFixture("named-invocation-resolve-skill-", async ({ projectRoot }) => {
        await writeSkill(projectRoot, "diagnose-fixture");

        const resolved = await resolveNamedInvocation({
            cwd: projectRoot,
            text: "/skill:diagnose-fixture inspect logs",
        });

        assertEquals(resolved.kind, "skill");
        if (resolved.kind !== "skill") return;
        assertEquals(resolved.name, "diagnose-fixture");
        assertStringIncludes(resolved.expandedRequest, 'The user has invoked the "diagnose-fixture" skill.');
        assertStringIncludes(resolved.expandedRequest, "Use the fixture skill body.");
        assertStringIncludes(resolved.expandedRequest, "inspect logs");
        assertEquals(resolved.payload.profile, {});
    });
});

Deno.test("resolveNamedInvocation rejects invalid Prompt Template execution Front Matter clearly", async () => {
    await withRuntimeCommandFixture("named-invocation-invalid-profile-", async ({ projectRoot }) => {
        await writePrompt(projectRoot, "bad-agent", ["agent: definitely-not-an-agent"], "Bad agent.");
        await writePrompt(projectRoot, "bad-model", ["model: fixture-model"], "Bad model.");
        await writePrompt(projectRoot, "bad-thinking", ["thinkingLevel: maximum"], "Bad thinking.");

        await assertRejects(
            () => resolveNamedInvocation({ cwd: projectRoot, text: "/bad-agent" }),
            Error,
            'Prompt template "bad-agent" declares unknown agent',
        );
        await assertRejects(
            () => resolveNamedInvocation({ cwd: projectRoot, text: "/bad-model" }),
            Error,
            'Prompt template "bad-model" declares invalid model',
        );
        await assertRejects(
            () => resolveNamedInvocation({ cwd: projectRoot, text: "/bad-thinking" }),
            Error,
            'Prompt template "bad-thinking" declares invalid thinkingLevel',
        );
    });
});
