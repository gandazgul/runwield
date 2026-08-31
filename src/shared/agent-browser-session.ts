/**
 * Keeps agent-browser processes owned by this wld invocation isolated and
 * closes them when the invocation exits.
 */

interface AgentBrowserCommandRuntime {
    envSet(name: string, value: string): void;
    spawnCleanup(): void;
}

function createNamespace(): string {
    return `wld-${crypto.randomUUID()}`;
}

function createSystemRuntime(): AgentBrowserCommandRuntime {
    return {
        envSet: (name, value) => Deno.env.set(name, value),
        spawnCleanup: () =>
            new Deno.Command("agent-browser", {
                args: ["close", "--all"],
                stdout: "null",
                stderr: "null",
            }).outputSync(),
    };
}

export function createAgentBrowserSessionCleanup(
    runtime: AgentBrowserCommandRuntime = createSystemRuntime(),
) {
    const namespace = createNamespace();
    let cleanedUp = false;

    function initialize(): string {
        runtime.envSet("AGENT_BROWSER_NAMESPACE", namespace);
        return namespace;
    }

    function cleanupSync(): void {
        if (cleanedUp) return;
        cleanedUp = true;
        try {
            runtime.spawnCleanup();
        } catch {
            // Browser cleanup is best-effort and must not hide the exit reason.
        }
    }

    return { initialize, cleanupSync, namespace };
}

const agentBrowserSessionCleanup = createAgentBrowserSessionCleanup();

export function initializeAgentBrowserSession(): void {
    agentBrowserSessionCleanup.initialize();
}

export function cleanupAgentBrowserSessionSync(): void {
    agentBrowserSessionCleanup.cleanupSync();
}
