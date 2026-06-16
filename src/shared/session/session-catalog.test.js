import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
    assembleFinalSystemPrompt,
    ensureBundledAgentDefFile,
    expandPromptTemplate,
    expandSkillCommand,
    getBundledAgentDefsPath,
    listLoadedAgentMdFiles,
    listPromptTemplates,
    listSkills,
    readGlobalAgentMd,
    steerRootSession,
} from "./session.js";
import { setRootAgentSession } from "./session-state.js";

const localPromptsDir = join(Deno.cwd(), ".hns", "prompts");
const localSkillsDir = join(Deno.cwd(), ".hns", "skills");

async function cleanupLocalCatalogFixtures() {
    await Deno.remove(join(localPromptsDir, "code-review.md")).catch(() => {});
    await Deno.remove(join(localPromptsDir, "coverage-local.md")).catch(() => {});
    await Deno.remove(join(localSkillsDir, "coverage-skill"), { recursive: true }).catch(() => {});
}

Deno.test("listPromptTemplates gives local templates precedence and parses metadata", async () => {
    await cleanupLocalCatalogFixtures();
    await Deno.mkdir(localPromptsDir, { recursive: true });
    try {
        await Deno.writeTextFile(
            join(localPromptsDir, "code-review.md"),
            [
                "---",
                'description: "Local review override"',
                'argument-hint: "<diff>"',
                'model: "test/model"',
                "---",
                "Local body",
            ].join("\n"),
        );
        await Deno.writeTextFile(
            join(localPromptsDir, "coverage-local.md"),
            "Describe local prompt from body.",
        );

        const templates = await listPromptTemplates();
        const names = templates.map((template) => template.name);
        const codeReview = templates.find((template) => template.name === "code-review");
        const local = templates.find((template) => template.name === "coverage-local");

        assertEquals(names.filter((name) => name === "code-review").length, 1);
        assertEquals(codeReview?.source, "local");
        assertEquals(codeReview?.description, "Local review override");
        assertEquals(codeReview?.argumentHint, "<diff>");
        assertEquals(codeReview?.model, "test/model");
        assertEquals(local?.description, "Describe local prompt from body.");
    } finally {
        await cleanupLocalCatalogFixtures();
    }
});

Deno.test("expandPromptTemplate strips front matter and appends user instructions", async () => {
    const path = await Deno.makeTempFile({ prefix: "harns-template-", suffix: ".md" });
    try {
        await Deno.writeTextFile(
            path,
            [
                "---",
                'description: "Template"',
                "---",
                "Template body",
                "",
            ].join("\n"),
        );

        assertEquals(await expandPromptTemplate(path, "Extra instructions"), "Template body\n\nExtra instructions");
        await assertRejects(
            () => expandPromptTemplate(`${path}.missing`),
            Error,
            "Failed to read prompt template",
        );
    } finally {
        await Deno.remove(path).catch(() => {});
    }
});

Deno.test("listSkills and expandSkillCommand read local skill definitions", async () => {
    await cleanupLocalCatalogFixtures();
    const skillDir = join(localSkillsDir, "coverage-skill");
    const skillPath = join(skillDir, "SKILL.md");
    await Deno.mkdir(skillDir, { recursive: true });
    try {
        await Deno.writeTextFile(
            skillPath,
            [
                "---",
                'name: "coverage-skill"',
                'description: "Exercise local skill loading"',
                "---",
                "Use this skill carefully.",
            ].join("\n"),
        );

        const skills = await listSkills();
        const skill = skills.find((item) => item.name === "coverage-skill");
        assertEquals(skill?.source, "local");
        assertEquals(skill?.description, "Exercise local skill loading");

        const expanded = await expandSkillCommand("coverage-skill", "User extra");
        assertStringIncludes(expanded, 'The user has invoked the "coverage-skill" skill.');
        assertStringIncludes(expanded, `<skill name="coverage-skill" location="${skillPath}">`);
        assertStringIncludes(expanded, "Use this skill carefully.");
        assertStringIncludes(expanded, "User extra");

        await assertRejects(
            () => expandSkillCommand("missing-skill"),
            Error,
            "Unknown skill: missing-skill",
        );
    } finally {
        await cleanupLocalCatalogFixtures();
    }
});

Deno.test("ensureBundledAgentDefFile resolves workflow prompt assets", async () => {
    const path = await ensureBundledAgentDefFile(join("workflow-prompts", "reviewer-prompt.md"));
    const prompt = await Deno.readTextFile(path);

    assertStringIncludes(path, "workflow-prompts");
    assertStringIncludes(prompt, "Workflow-only semantic review prompt");
});

Deno.test("bundled agent defs path and loaded instruction files are reported", async () => {
    const bundledPath = await getBundledAgentDefsPath();
    assertEquals(bundledPath.endsWith("agent-definitions") || bundledPath.includes("bundled-agent-definitions"), true);

    const projectHarnessPath = join(Deno.cwd(), "HARNS.md");
    const originalProjectHarness = await Deno.readTextFile(projectHarnessPath).catch(() => null);
    try {
        await Deno.writeTextFile(projectHarnessPath, "Project instructions for coverage");
        const files = await listLoadedAgentMdFiles();
        const projectFile = files.find((file) => file.path === projectHarnessPath);
        assertEquals(projectFile, { path: projectHarnessPath, source: "local" });
    } finally {
        if (originalProjectHarness === null) await Deno.remove(projectHarnessPath).catch(() => {});
        else await Deno.writeTextFile(projectHarnessPath, originalProjectHarness);
    }
});

Deno.test("readGlobalAgentMd falls through configured global instruction paths", async () => {
    const home = await Deno.makeTempDir({ prefix: "harns-global-agent-md-" });
    const hnsDir = join(home, ".hns");
    const externalDir = join(home, ".agents");
    await Deno.mkdir(hnsDir, { recursive: true });
    await Deno.mkdir(externalDir, { recursive: true });
    try {
        await Deno.writeTextFile(join(externalDir, "AGENTS.md"), "External instructions");
        assertEquals(await readGlobalAgentMd(home), "External instructions");

        await Deno.writeTextFile(join(hnsDir, "AGENTS.md"), "Legacy Harns instructions");
        assertEquals(await readGlobalAgentMd(home), "Legacy Harns instructions");

        await Deno.writeTextFile(join(hnsDir, "HARNS.md"), "Harns instructions");
        assertEquals(await readGlobalAgentMd(home), "Harns instructions");
        assertEquals(await readGlobalAgentMd(home, { includeExternal: false }), "Harns instructions");
    } finally {
        await Deno.remove(home, { recursive: true }).catch(() => {});
    }
});

Deno.test("assembleFinalSystemPrompt fills tools, instruction files, skills, and bundled paths", async () => {
    await cleanupLocalCatalogFixtures();
    const originalHome = Deno.env.get("HOME");
    const tempHome = await Deno.makeTempDir({ prefix: "harns-assemble-prompt-" });
    const projectHarnessPath = join(Deno.cwd(), "HARNS.md");
    const originalProjectHarness = await Deno.readTextFile(projectHarnessPath).catch(() => null);
    const skillDir = join(localSkillsDir, "coverage-skill");
    const skillPath = join(skillDir, "SKILL.md");

    try {
        Deno.env.set("HOME", tempHome);
        await Deno.mkdir(join(tempHome, ".hns"), { recursive: true });
        await Deno.writeTextFile(join(tempHome, ".hns", "HARNS.md"), "Global prompt context");
        await Deno.writeTextFile(projectHarnessPath, "Project prompt context");
        await Deno.mkdir(skillDir, { recursive: true });
        await Deno.writeTextFile(
            skillPath,
            [
                "---",
                'name: "coverage-skill"',
                'description: "Available for prompt assembly"',
                "---",
                "Use this skill carefully.",
            ].join("\n"),
        );

        const prompt = await assembleFinalSystemPrompt(
            /** @type {any} */ ({
                systemPrompt: [
                    "Tools:",
                    "{{AVAILABLE_TOOLS}}",
                    "Global:",
                    "{{GLOBAL_AGENTSMD}}",
                    "Project:",
                    "{{PROJECT_AGENTSMD}}",
                    "Memories:",
                    "{{MEMORIES}}",
                    "Skills:",
                    "{{SKILLS}}",
                    "Bundled:",
                    "{{BUNDLED_AGENT_DEFS_DIR}}",
                ].join("\n"),
            }),
            ["read", "custom_tool", "unknown_tool"],
            /** @type {any[]} */ ([{
                name: "custom_tool",
                description: "custom description",
                promptSnippet: "custom snippet",
            }]),
        );

        assertStringIncludes(prompt, "- read -");
        assertStringIncludes(prompt, "- custom_tool - custom snippet");
        assertStringIncludes(prompt, "- unknown_tool - Built-in tool");
        assertStringIncludes(prompt, "Global prompt context");
        assertStringIncludes(prompt, "Project prompt context");
        assertStringIncludes(prompt, `coverage-skill - Available for prompt assembly (read: ${skillPath})`);
        assertStringIncludes(prompt, "agent-definitions");
    } finally {
        if (originalHome === undefined) Deno.env.delete("HOME");
        else Deno.env.set("HOME", originalHome);
        if (originalProjectHarness === null) await Deno.remove(projectHarnessPath).catch(() => {});
        else await Deno.writeTextFile(projectHarnessPath, originalProjectHarness);
        await Deno.remove(tempHome, { recursive: true }).catch(() => {});
        await cleanupLocalCatalogFixtures();
    }
});

Deno.test("steerRootSession sends image content only while root is streaming", async () => {
    /** @type {Array<{ text: string, images?: unknown[] }>} */
    const steerCalls = [];
    const session = /** @type {any} */ ({
        isStreaming: false,
        steer: (/** @type {string} */ text, /** @type {unknown[]} */ images) => {
            steerCalls.push({ text, images });
            return Promise.resolve();
        },
    });

    try {
        setRootAgentSession(null);
        assertEquals(await steerRootSession("queued"), false);

        setRootAgentSession(session);
        assertEquals(await steerRootSession("queued"), false);
        assertEquals(steerCalls, []);

        session.isStreaming = true;
        assertEquals(
            await steerRootSession("interrupt", [{ base64: "abc123", mimeType: "image/png" }]),
            true,
        );
        assertEquals(steerCalls, [{
            text: "interrupt",
            images: [{ type: "image", data: "abc123", mimeType: "image/png" }],
        }]);
    } finally {
        setRootAgentSession(null);
    }
});
