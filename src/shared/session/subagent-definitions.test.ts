import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { AGENTS, SUBAGENTS } from "../../constants.js";
import { loadSubAgentDefinition, SUBAGENT_DEFINITIONS, type SubAgentDefinitionId } from "./subagent-definitions.ts";

const EXPECTED_PROMPT_FILES = [
    "delegated-agent-prompt.md",
    "init-agent-prompt.md",
    "manual-qa-prompt.md",
    "reviewer-feedback-engineer.md",
    "reviewer-prompt.md",
    "reviewer-verify-prompt.md",
    "slicer-prompt.md",
];

function sourcePromptPath(fileName: string) {
    return join("src", "agent-definitions", "subagent-definitions", fileName);
}

Deno.test("subagent prompt files live only in the subagent definitions directory", async () => {
    const entries = [];
    for await (const entry of Deno.readDir(join("src", "agent-definitions", "subagent-definitions"))) {
        if (entry.isFile) entries.push(entry.name);
    }
    entries.sort();

    assertEquals(entries, EXPECTED_PROMPT_FILES);
    const oldPromptDirectory = join("src", "agent-definitions", "workflow-" + "prompts");
    await assertRejects(
        () => Deno.stat(oldPromptDirectory),
        Deno.errors.NotFound,
    );
});

Deno.test("every registered subagent loads from the moved bundled prompt files", async () => {
    const loadedIds: string[] = [];
    for (const id of Object.keys(SUBAGENT_DEFINITIONS) as SubAgentDefinitionId[]) {
        const definition = SUBAGENT_DEFINITIONS[id];
        const agentDef = await loadSubAgentDefinition(id);
        const prompt = await Deno.readTextFile(sourcePromptPath(definition.file));

        loadedIds.push(id);
        assertEquals(agentDef.name, definition.agentName);
        assertEquals(prompt.trim().length > 0, true);
    }

    assertEquals(loadedIds.sort(), Object.values(SUBAGENTS).sort());
});

Deno.test("reviewer discovery and verify prompts load through one registry id", async () => {
    const discovery = await loadSubAgentDefinition(SUBAGENTS.REVIEWER, { reviewerMode: "discovery" });
    const verify = await loadSubAgentDefinition(SUBAGENTS.REVIEWER, { reviewerMode: "verify" });

    assertEquals(discovery.name, AGENTS.REVIEWER);
    assertEquals(verify.name, AGENTS.REVIEWER);
    assertStringIncludes(discovery.systemPrompt, "Your Default Is Approval");
    assertStringIncludes(verify.systemPrompt, "verification round");
});

Deno.test("bare-prompt subagents are tool-free and do not receive the shared system prompt", async () => {
    const delegated = await loadSubAgentDefinition(SUBAGENTS.DELEGATED);
    const manualQa = await loadSubAgentDefinition(SUBAGENTS.MANUAL_QA);
    const reviewer = await loadSubAgentDefinition(SUBAGENTS.REVIEWER);

    assertEquals(delegated.tools, []);
    assertEquals(manualQa.tools, []);
    assertEquals(reviewer.tools, []);
    assertEquals(delegated.systemPrompt.includes("## Available tools"), false);
    assertEquals(manualQa.systemPrompt.includes("{{SKILLS}}"), false);
    assertEquals(reviewer.systemPrompt.includes("{{AVAILABLE_TOOLS}}"), false);
    assertEquals(manualQa.name, AGENTS.OPERATOR);
});

Deno.test("full-agent subagents keep shared system-prompt composition and runtime names", async () => {
    const slicer = await loadSubAgentDefinition(SUBAGENTS.SLICER);
    const init = await loadSubAgentDefinition(SUBAGENTS.INIT);
    const feedbackEngineer = await loadSubAgentDefinition(SUBAGENTS.REVIEWER_FEEDBACK_ENGINEER);

    assertEquals(slicer.name, AGENTS.SLICER);
    assertEquals(init.name, AGENTS.INIT);
    assertEquals(feedbackEngineer.name, AGENTS.REVIEWER_FEEDBACK_ENGINEER);
    assertStringIncludes(slicer.systemPrompt, "## Available tools");
    assertStringIncludes(init.systemPrompt, "## Skills");
    assertStringIncludes(feedbackEngineer.systemPrompt, "## Memory System");
});

Deno.test("bare-prompt loading retries a transient cold-cache read failure", async () => {
    const readPaths: string[] = [];
    const ensuredPaths: string[] = [];
    let readAttempts = 0;

    const reviewer = await loadSubAgentDefinition(SUBAGENTS.REVIEWER, {
        readTextFile: async (path) => {
            readPaths.push(path);
            readAttempts += 1;
            if (readAttempts === 1) throw new Deno.errors.NotFound("cache refresh removed prompt");
            return await Deno.readTextFile(sourcePromptPath("reviewer-prompt.md"));
        },
        ensurePromptFile: (relativePath) => {
            ensuredPaths.push(relativePath);
            return Promise.resolve(`/tmp/bundled-agent-definitions/${relativePath}`);
        },
    });

    assertEquals(ensuredPaths, [
        "subagent-definitions/reviewer-prompt.md",
        "subagent-definitions/reviewer-prompt.md",
    ]);
    assertEquals(readPaths, [
        "/tmp/bundled-agent-definitions/subagent-definitions/reviewer-prompt.md",
        "/tmp/bundled-agent-definitions/subagent-definitions/reviewer-prompt.md",
    ]);
    assertEquals(reviewer.name, AGENTS.REVIEWER);
    assertStringIncludes(reviewer.systemPrompt, "Your Default Is Approval");
});
