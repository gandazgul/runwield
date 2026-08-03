import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { listAgentDefNames, loadAgentDef } from "./agents.js";

const BUNDLED_AGENT_DEFS = join("src", "agent-definitions");
const SHARED_PRACTICE_DIR = join(BUNDLED_AGENT_DEFS, "shared-practice");

/** Personas that compose shared practice, and the fragments each one claims. */
const SHARED_PRACTICE_CONSUMERS: ReadonlyArray<[string, readonly string[]]> = [
    ["engineer", ["engineering-practice", "plan-execution"]],
    ["frontend-engineer", ["engineering-practice", "plan-execution"]],
];

interface ProjectAgentFile {
    path: string;
    contents: string;
}

/**
 * Write agent definitions into a throwaway project root and load one from it.
 * The real loader walks the real filesystem — only the repository under it is faked.
 */
async function withProjectAgents<T>(
    files: readonly ProjectAgentFile[],
    run: (projectRoot: string) => Promise<T>,
): Promise<T> {
    const projectRoot = await Deno.makeTempDir({ prefix: "runwield-shared-practice-" });
    try {
        for (const file of files) {
            const target = join(projectRoot, ".wld", "agents", file.path);
            await Deno.mkdir(join(target, ".."), { recursive: true });
            await Deno.writeTextFile(target, file.contents);
        }
        return await run(projectRoot);
    } finally {
        await Deno.remove(projectRoot, { recursive: true });
    }
}

function agentFile(name: string, frontMatter: string, body: string): ProjectAgentFile {
    return { path: `${name}.md`, contents: `---\nname: ${name}\n${frontMatter}---\n\n${body}\n` };
}

function fragmentFile(name: string, body: string): ProjectAgentFile {
    return { path: join("shared-practice", `${name}.md`), contents: `---\nname: ${name}\n---\n\n${body}\n` };
}

Deno.test("shared practice fragments are appended after the agent's own prompt body", async () => {
    const def = await withProjectAgents([
        agentFile("temp-agent", "sharedPractice:\n    - house-rules\n", "## Process\n\nDo the process."),
        fragmentFile("house-rules", "## House Rules\n\nNever skip the rules."),
    ], (projectRoot) => loadAgentDef("temp-agent", projectRoot));

    const processIndex = def.systemPrompt.indexOf("Do the process.");
    const rulesIndex = def.systemPrompt.indexOf("Never skip the rules.");
    assertEquals(processIndex >= 0, true);
    assertEquals(rulesIndex > processIndex, true);
});

Deno.test("fragments compose in declaration order and dedupe repeats", async () => {
    const def = await withProjectAgents([
        agentFile(
            "temp-agent",
            "sharedPractice:\n    - first-fragment\n    - second-fragment\n    - first-fragment\n",
            "## Process\n\nBody.",
        ),
        fragmentFile("first-fragment", "FIRST_MARKER"),
        fragmentFile("second-fragment", "SECOND_MARKER"),
    ], (projectRoot) => loadAgentDef("temp-agent", projectRoot));

    assertEquals(def.systemPrompt.match(/FIRST_MARKER/g)?.length, 1);
    assertEquals(def.systemPrompt.indexOf("SECOND_MARKER") > def.systemPrompt.indexOf("FIRST_MARKER"), true);
});

Deno.test("a project fragment overrides the bundled fragment of the same name", async () => {
    const def = await withProjectAgents([
        agentFile("temp-agent", "sharedPractice:\n    - engineering-practice\n", "## Process\n\nBody."),
        fragmentFile("engineering-practice", "PROJECT_OVERRIDE_MARKER"),
    ], (projectRoot) => loadAgentDef("temp-agent", projectRoot));

    assertStringIncludes(def.systemPrompt, "PROJECT_OVERRIDE_MARKER");
    assertEquals(def.systemPrompt.includes("The Zero-Trust Implementation Protocol"), false);
});

Deno.test("an agent that declares no shared practice composes nothing extra", async () => {
    const def = await withProjectAgents([
        agentFile("temp-agent", "", "## Process\n\nBody."),
        fragmentFile("engineering-practice", "SHOULD_NOT_APPEAR"),
    ], (projectRoot) => loadAgentDef("temp-agent", projectRoot));

    assertEquals(def.systemPrompt.includes("SHOULD_NOT_APPEAR"), false);
});

Deno.test("a missing fragment fails loudly and names the paths it checked", async () => {
    const error = await withProjectAgents(
        [agentFile("temp-agent", "sharedPractice:\n    - no-such-fragment\n", "## Process\n\nBody.")],
        (projectRoot) =>
            assertRejects(
                () => loadAgentDef("temp-agent", projectRoot),
                Error,
                'Could not find shared practice fragment "no-such-fragment"',
            ),
    );

    assertStringIncludes(error.message, join("shared-practice", "no-such-fragment.md"));
});

Deno.test("a non-list sharedPractice field is rejected rather than silently ignored", async () => {
    await withProjectAgents(
        [agentFile("temp-agent", "sharedPractice: engineering-practice\n", "## Process\n\nBody.")],
        (projectRoot) =>
            assertRejects(
                () => loadAgentDef("temp-agent", projectRoot),
                Error,
                "non-list sharedPractice field",
            ),
    );
});

Deno.test("shared practice fragments are never offered as agents", async () => {
    const names = await listAgentDefNames();
    assertEquals(names.includes("engineering-practice"), false);
    assertEquals(names.includes("plan-execution"), false);
    assertEquals(names.includes("shared-practice"), false);
});

Deno.test("every bundled fragment is claimed by at least one agent", async () => {
    const claimed = new Set(SHARED_PRACTICE_CONSUMERS.flatMap(([, fragments]) => fragments));
    // The Reviewer-Feedback Engineer is a workflow-only subagent, so it is not in
    // the loadAgentDef listing above; it claims engineering-practice on its own.
    claimed.add("engineering-practice");

    for await (const entry of Deno.readDir(SHARED_PRACTICE_DIR)) {
        if (!entry.isFile || !entry.name.endsWith(".md")) continue;
        const fragment = entry.name.replace(/\.md$/, "");
        assertEquals(claimed.has(fragment), true, `Unclaimed shared practice fragment: ${fragment}`);
    }
});

Deno.test("bundled personas compose their declared shared practice", async () => {
    for (const [agentName] of SHARED_PRACTICE_CONSUMERS) {
        const def = await loadAgentDef(agentName);
        assertStringIncludes(def.systemPrompt, "The Zero-Trust Implementation Protocol");
        assertStringIncludes(def.systemPrompt, "When Verification Fails, Act");
        assertStringIncludes(def.systemPrompt, "Requests that are not the Plan");
    }
});
