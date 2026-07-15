import { assertEquals, assertRejects } from "@std/assert";
import { dirname, fromFileUrl, join, relative, resolve } from "@std/path";
import { SessionRuntime } from "./session-runtime.js";

const REPO_ROOT = resolve(dirname(fromFileUrl(import.meta.url)), "../../..");

/** @param {string} path @returns {Promise<string[]>} */
async function productionJavaScriptFiles(path) {
    const files = [];
    for await (const entry of Deno.readDir(path)) {
        const entryPath = join(path, entry.name);
        if (entry.isDirectory) {
            files.push(...await productionJavaScriptFiles(entryPath));
            continue;
        }
        if (!entry.isFile || !/\.jsx?$/.test(entry.name)) continue;
        if (/\.test\.[jt]sx?$/.test(entry.name) || /_test\.[jt]sx?$/.test(entry.name)) continue;
        files.push(entryPath);
    }
    return files;
}

/**
 * @param {string[]} roots
 * @param {Array<{ label: string, pattern: RegExp }>} rules
 */
async function findViolations(roots, rules) {
    const violations = [];
    for (const root of roots) {
        for (const file of await productionJavaScriptFiles(join(REPO_ROOT, root))) {
            const source = await Deno.readTextFile(file);
            for (const rule of rules) {
                if (rule.pattern.test(source)) violations.push(`${relative(REPO_ROOT, file)}: ${rule.label}`);
            }
        }
    }
    return violations;
}

Deno.test("core has no consumer presentation knowledge", async () => {
    const violations = await findViolations(["src/shared", "src/tools"], [
        { label: "UI API reference", pattern: /\buiAPI\b|\bUiAPI\b|SessionUiPort/ },
        { label: "consumer name", pattern: /\bTUI\b|\bACP\b|Plannotator/ },
        { label: "consumer import", pattern: /(?:from|import\()\s*["'][^"']*(?:\/ui\/|\/acp\/)/ },
    ]);
    assertEquals(violations, []);
});

Deno.test("TUI, ACP, commands, and scripts use the public Runtime surface only", async () => {
    const violations = await findViolations(["src/ui/tui", "src/acp", "src/cmd", "scripts"], [
        { label: "HostedSession reference", pattern: /HostedSession|hosted-session/ },
        { label: "SessionHost reference", pattern: /SessionHost|session-host/ },
        {
            label: "root-session internal access",
            pattern: /getRootAgentSession|getRootSessionManager|createRootSessionManager|openPersistedRootSession/,
        },
        { label: "session implementation import", pattern: /shared\/session\/session\.js/ },
        {
            label: "session internal import",
            pattern: /shared\/session\/(?:agent-handler|agent-switching|root-session|hosted-session|session-host)\.js/,
        },
        { label: "Runtime host escape", pattern: /\.sessionHost\b|\.getSession\s*\(/ },
        { label: "Runtime event producer escape", pattern: /\.emitSessionEvent\s*\(/ },
        { label: "Runtime transcript-internal escape", pattern: /\.recordLocalToolExchange\s*\(/ },
        {
            label: "consumer-side Runtime event normalization",
            pattern: /normalizeRuntimeToolResult|normalizeRuntimeUsage|describeRuntimeTool|formatToolEventTitle/,
        },
        {
            label: "parallel operation-cancellation seam",
            pattern: /registerOperationCancel|cancelSessionCompaction/,
        },
    ]);
    assertEquals(violations, []);
});

Deno.test("SessionRuntime does not expose compatibility object APIs", () => {
    const methods = Object.getOwnPropertyNames(SessionRuntime.prototype);
    assertEquals(methods.includes("createSession"), false);
    assertEquals(methods.includes("adoptSession"), false);
    assertEquals(methods.includes("getSession"), false);
    assertEquals(methods.includes("attachRuntimeEventSink"), false);
    assertEquals(methods.includes("emitSessionEvent"), false);
    assertEquals(methods.includes("recordLocalToolExchange"), false);
    assertEquals(methods.includes("cancelSessionCompaction"), false);
    assertEquals(methods.includes("setSessionHandler"), false);
    assertEquals(methods.includes("ensureSessionReady"), false);
    const runtime = new SessionRuntime();
    for (
        const internal of [
            "sessionHost",
            "switchActiveAgent",
            "abortActiveSession",
            "createRootSessionManager",
            "openPersistedRootSession",
            "resolveResumeAgentName",
            "createAgentHandler",
            "ensureRootAgentSession",
            "steerRootSessionWithTarget",
            "eventListeners",
            "turnSettlements",
            "queuedMessages",
            "queueSourceSubscriptions",
        ]
    ) {
        assertEquals(Object.hasOwn(runtime, internal), false, `${internal} must remain private`);
    }
});

for (
    const deletedPath of [
        "src/shared/session/presentation-messages.js",
        "src/shared/session/session-runtime-ui.js",
        "src/ui/tui/message-hydration.js",
        "src/ui/tui/task-completed-message.js",
        "src/shared/workflow/code-review.js",
        "src/shared/workflow/review-launcher.js",
        "src/shared/workflow/submit-plan.js",
    ]
) {
    Deno.test(`removed compatibility seam stays deleted: ${deletedPath}`, async () => {
        await assertRejects(() => Deno.stat(join(REPO_ROOT, deletedPath)), Deno.errors.NotFound);
    });
}
