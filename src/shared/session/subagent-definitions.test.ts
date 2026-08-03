import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { AGENTS, SUBAGENTS } from "../../constants.js";
import {
    DELEGATED_ROLE_IDS,
    DELEGATED_ROLES,
    getDelegatedRole,
    loadSubAgentDefinition,
    SUBAGENT_DEFINITIONS,
    type SubAgentDefinitionId,
} from "./subagent-definitions.ts";

const EXPECTED_PROMPT_FILES = [
    "delegated-agent-prompt.md",
    "init-agent-prompt.md",
    "manual-qa-prompt.md",
    "reviewer-feedback-engineer.md",
    "reviewer-prompt.md",
    "reviewer-verify-prompt.md",
    "slicer-prompt.md",
];

const EXPECTED_ROLE_OVERLAY_FILES = ["verification-adversary.md"];

function sourcePromptPath(fileName: string) {
    return join("src", "agent-definitions", "subagent-definitions", fileName);
}

Deno.test("subagent prompt files live only in the subagent definitions directory", async () => {
    const entries = [];
    for await (const entry of Deno.readDir(join("src", "agent-definitions", "subagent-definitions"))) {
        if (entry.isFile) entries.push(entry.name);
    }
    entries.sort();

    const roleEntries = [];
    for await (const entry of Deno.readDir(join("src", "agent-definitions", "subagent-definitions", "roles"))) {
        if (entry.isFile) roleEntries.push(entry.name);
    }
    roleEntries.sort();

    assertEquals(entries, EXPECTED_PROMPT_FILES);
    assertEquals(roleEntries, EXPECTED_ROLE_OVERLAY_FILES);
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

Deno.test("loadSubAgentDefinition composes delegated role overlays", async () => {
    const general = await loadSubAgentDefinition(SUBAGENTS.DELEGATED);
    const adversary = await loadSubAgentDefinition(SUBAGENTS.DELEGATED, {
        delegatedRole: "verification-adversary",
    });

    // The base prompt stays the source of universal delegated-session rules.
    assertStringIncludes(general.systemPrompt, "Complete only the supplied brief.");
    assertStringIncludes(adversary.systemPrompt, "Complete only the supplied brief.");
    // The overlay adds only the role-specific adversarial task and handoff contract.
    assertStringIncludes(adversary.systemPrompt, "Role: Verification Adversary");
    assertStringIncludes(adversary.systemPrompt, "not-discriminating");
    assertEquals(general.systemPrompt.includes("not-discriminating"), false);
    assertEquals(adversary.systemPrompt.startsWith(general.systemPrompt), true);
    assertEquals(adversary.name, AGENTS.DELEGATED);
    assertEquals(adversary.displayName, "Verification Adversary");
});

Deno.test("explicit general role reproduces the unspecialized delegated prompt", async () => {
    const implicit = await loadSubAgentDefinition(SUBAGENTS.DELEGATED);
    const explicit = await loadSubAgentDefinition(SUBAGENTS.DELEGATED, { delegatedRole: "general" });

    assertEquals(explicit.systemPrompt, implicit.systemPrompt);
    assertEquals(explicit.displayName, implicit.displayName);
});

Deno.test("every registered delegated role resolves and declares an authority ceiling", async () => {
    assertEquals([...DELEGATED_ROLE_IDS], ["general", "verification-adversary"]);
    assertEquals(getDelegatedRole("general")?.authorityCeiling, "write");
    assertEquals(getDelegatedRole("verification-adversary")?.authorityCeiling, "read");
    assertEquals(getDelegatedRole(undefined)?.id, "general");
    assertEquals(getDelegatedRole("researcher"), null);

    for (const id of DELEGATED_ROLE_IDS) {
        const role = DELEGATED_ROLES[id];
        if (!role.overlayFile) continue;
        const overlay = await Deno.readTextFile(sourcePromptPath(join("roles", role.overlayFile)));
        assertEquals(overlay.trim().length > 0, true);
    }
});

Deno.test("an unregistered delegated role fails the load and names the valid roles", async () => {
    const error = await assertRejects(
        () =>
            loadSubAgentDefinition(SUBAGENTS.DELEGATED, {
                delegatedRole: "researcher" as never,
            }),
        Error,
    );

    assertStringIncludes(error.message, "Unknown delegated role: researcher");
    assertStringIncludes(error.message, "verification-adversary");
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
