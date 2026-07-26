import { assertEquals, assertStringIncludes } from "@std/assert";

import { loadManualQaPrompt, loadReviewerPrompt, runManualQaChecklistPrompt } from "./validation.js";
import { HostedSession } from "../session/hosted-session.js";
import { makeRecordedSession, makeUi } from "./validation-test-helpers.js";

import { __resetSettingsForTests } from "../settings.js";

Deno.test("loadManualQaPrompt returns a bare tool-free prompt", async () => {
    /** @type {string[]} */
    const readPaths = [];
    const promptDef = await loadManualQaPrompt(
        (path) => {
            readPaths.push(path);
            return Promise.resolve([
                "---",
                "name: Manual QA",
                'description: "Checklist prompt"',
                "tools: []",
                "---",
                "",
                "Output only a manual verification checklist.",
                "",
            ].join("\n"));
        },
        (relativePath) => Promise.resolve(`/tmp/bundled-agent-definitions/${relativePath}`),
    );

    assertEquals(readPaths, ["/tmp/bundled-agent-definitions/workflow-prompts/manual-qa-prompt.md"]);
    assertEquals(promptDef.name, "operator");
    assertEquals(promptDef.displayName, "Manual QA");
    assertEquals(promptDef.tools, []);
    assertEquals(promptDef.systemPrompt, "Output only a manual verification checklist.");
});

Deno.test("bundled Manual QA prompt requires the user checklist shape", async () => {
    const prompt = await Deno.readTextFile(
        new URL("../../agent-definitions/workflow-prompts/manual-qa-prompt.md", import.meta.url),
    );

    assertStringIncludes(prompt, "Manual verification steps for <plan name>");
    assertStringIncludes(prompt, "- [ ] step 1");
    assertStringIncludes(prompt, "automated verification has already passed");
});

Deno.test("runManualQaChecklistPrompt uses isolated Plan context without tools", async () => {
    /** @type {any} */
    let invocation;
    const expectedMessages = /** @type {any} */ ([{ role: "assistant", content: "checklist" }]);
    const promptDef = /** @type {any} */ ({
        name: "operator",
        displayName: "Manual QA",
        model: "",
        description: "Checklist prompt",
        tools: [],
        systemPrompt: "Output a checklist.",
    });

    const hostedSession = makeRecordedSession("validation-test", makeUi());
    const result = await runManualQaChecklistPrompt({
        hostedSession,
        name: "settings-panel",
        classification: "FEATURE",
        context: "## Verification Plan\n- Manual: save settings and reload",
        cwd: "/repo",
        __deps: {
            loadManualQaPrompt: () => Promise.resolve(promptDef),
            runIsolatedAgentSession: (/** @type {any} */ args) => {
                invocation = args;
                return Promise.resolve(expectedMessages);
            },
        },
    });

    assertEquals(result, expectedMessages);
    assertEquals(invocation.agentName, "operator");
    assertEquals(invocation.cwd, "/repo");
    assertEquals(invocation._agentDefOverride, promptDef);
    assertEquals(invocation.includeEditFallback, false);
    assertEquals(Object.hasOwn(invocation, "useRootSession"), false);
    assertStringIncludes(invocation.userRequest, "Name: settings-panel");
    assertStringIncludes(invocation.userRequest, "Classification: FEATURE");
    assertStringIncludes(invocation.userRequest, "save settings and reload");
});

Deno.test("runManualQaChecklistPrompt persists visible checklist for resume replay", async () => {
    /** @type {Array<Record<string, unknown>>} */
    const entries = [];
    const session = new HostedSession({
        id: "manual-qa-persist",
        cwd: Deno.cwd(),
        sessionManager: /** @type {any} */ ({
            getSessionId: () => "manual-qa-persisted",
            getCwd: () => Deno.cwd(),
            getBranch: () => entries,
            appendCustomEntry: (/** @type {string} */ customType, /** @type {unknown} */ data) => {
                entries.push({ type: "custom", customType, data });
            },
        }),
    });
    const promptDef = /** @type {any} */ ({
        name: "operator",
        displayName: "Manual QA",
        model: "",
        description: "Checklist prompt",
        tools: [],
        systemPrompt: "Output a checklist.",
    });

    await runManualQaChecklistPrompt({
        hostedSession: session,
        name: "settings-panel",
        classification: "FEATURE",
        context: "context",
        cwd: Deno.cwd(),
        __deps: {
            loadManualQaPrompt: () => Promise.resolve(promptDef),
            runIsolatedAgentSession: () =>
                Promise.resolve(
                    /** @type {any} */ ([{
                        role: "assistant",
                        content: [{ type: "text", text: "Manual verification steps for settings-panel" }],
                    }]),
                ),
        },
    });

    assertEquals(entries, [{
        type: "custom",
        customType: "runwield.manual_qa_checklist",
        data: {
            agentName: "Operator",
            text: "Manual verification steps for settings-panel",
            name: "settings-panel",
            classification: "FEATURE",
        },
    }]);
});

Deno.test("loadReviewerPrompt returns a bare tool-free prompt", async () => {
    /** @type {string[]} */
    const readPaths = [];
    const reviewerDef = await loadReviewerPrompt(
        (path) => {
            readPaths.push(path);
            return Promise.resolve([
                "---",
                "name: Reviewer",
                'description: "Review prompt"',
                "tools: []",
                "---",
                "",
                "Review only the supplied plan and diff.",
                "",
            ].join("\n"));
        },
        (relativePath) => Promise.resolve(`/tmp/bundled-agent-definitions/${relativePath}`),
    );

    assertEquals(readPaths, ["/tmp/bundled-agent-definitions/workflow-prompts/reviewer-prompt.md"]);
    assertEquals(reviewerDef.name, "reviewer");
    assertEquals(reviewerDef.displayName, "Reviewer");
    assertEquals(reviewerDef.tools, []);
    assertEquals(reviewerDef.systemPrompt, "Review only the supplied plan and diff.");
    assertEquals(reviewerDef.systemPrompt.includes("{{SKILLS}}"), false);
    assertEquals(reviewerDef.systemPrompt.includes("Available tools"), false);
});

Deno.test("bundled reviewer prompt permits unrelated formatter-only changes", async () => {
    const prompt = await Deno.readTextFile(
        new URL("../../agent-definitions/workflow-prompts/reviewer-prompt.md", import.meta.url),
    );

    assertStringIncludes(prompt, "Ignore unrelated formatter-only changes");
    assertStringIncludes(prompt, "Do not fail a review merely because the diff touches files the plan did not mention");
});

Deno.test("bundled reviewer prompt reviews implementation semantics rather than verification completion", async () => {
    const prompt = await Deno.readTextFile(
        new URL("../../agent-definitions/workflow-prompts/reviewer-prompt.md", import.meta.url),
    );

    assertStringIncludes(prompt, "Do the changes adhere to the implementation requirements in the Plan's steps?");
    assertStringIncludes(prompt, "Does the resulting implementation meet the Plan's objective?");
    assertStringIncludes(prompt, "Do not audit whether the Engineer performed");
    assertStringIncludes(prompt, "browser/integration/server flow remains unverified");
    assertStringIncludes(prompt, "workflow context, not as semantic requirements or proof");
    assertStringIncludes(prompt, "external verification procedure so that the Reviewer can approve the code");
    assertStringIncludes(prompt, "If missing external verification evidence is your only concern, approve");
    assertStringIncludes(prompt, "Every blocking issue must identify a concrete implementation defect");
    assertStringIncludes(
        prompt,
        "Never send the Engineer a blocking issue whose requested fix is only to run a command",
    );
    assertStringIncludes(prompt, "not a verification-completion audit");
});

Deno.test("bundled reviewer prompt requires exhaustive findings in one review pass", async () => {
    const prompt = await Deno.readTextFile(
        new URL("../../agent-definitions/workflow-prompts/reviewer-prompt.md", import.meta.url),
    );

    assertStringIncludes(prompt, "private coverage checklist of every material implementation requirement");
    assertStringIncludes(prompt, "Do not call `review_complete` while any material");
    assertStringIncludes(prompt, "Finding one blocking issue does not finish the review");
    assertStringIncludes(prompt, "perform a final coverage sweep");
    assertStringIncludes(prompt, "Do not defer discoverable issues to a later review cycle");
    assertStringIncludes(prompt, "Report the complete set now, not one representative issue");
    assertStringIncludes(prompt, "Never stop reviewing after the first valid issue");
    assertStringIncludes(prompt, "Do not hold findings back for a later repair/review cycle");
});
