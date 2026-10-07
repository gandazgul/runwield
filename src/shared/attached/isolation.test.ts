/**
 * The Attached runtime is a sibling of SessionRuntime (ADR-014). Its module graph must
 * not reach Pi, Sessions, ACP, or UI code, directly or transitively.
 */

import { assert, assertEquals } from "@std/assert";
import { join, toFileUrl } from "@std/path";
import { DENO_CONFIG_PATH, REPO_ROOT } from "./attached-test-fixture.ts";

const ATTACHED_ENTRY_POINTS = [
    "src/cmd/attached/index.ts",
    "src/shared/attached/coordinator.ts",
    "src/attached/claude/mcp.ts",
];
const FORBIDDEN_FILE_PREFIXES = ["src/shared/session/", "src/acp/", "src/ui/"].map((path) =>
    toFileUrl(join(REPO_ROOT, path)).href
);
const CLAUDE_ADAPTER_URL = toFileUrl(join(REPO_ROOT, "src/attached/claude/")).href;
const ATTACHED_DOMAIN_URL = toFileUrl(join(REPO_ROOT, "src/shared/attached/")).href;

type ModuleDependency = { specifier: string; code?: { specifier?: string } };
type GraphModule = { specifier: string; dependencies?: ModuleDependency[] };
type ModuleGraph = { modules: GraphModule[] };

async function moduleGraph(path: string): Promise<ModuleGraph> {
    const output = await new Deno.Command(Deno.execPath(), {
        args: ["info", "--json", "--config", DENO_CONFIG_PATH, path],
        cwd: REPO_ROOT,
        stdout: "piped",
        stderr: "piped",
    }).output();
    assertEquals(output.code, 0, new TextDecoder().decode(output.stderr));
    const graph: ModuleGraph = JSON.parse(new TextDecoder().decode(output.stdout));
    return graph;
}

function forbiddenModules(graph: ModuleGraph): string[] {
    return graph.modules.map((module) => module.specifier).filter((specifier) =>
        specifier.startsWith("npm:/@earendil-works/") ||
        FORBIDDEN_FILE_PREFIXES.some((prefix) => specifier.startsWith(prefix))
    );
}

for (const entryPoint of ATTACHED_ENTRY_POINTS) {
    Deno.test(`${entryPoint} reaches no Pi, Session, ACP, or UI module`, async () => {
        assertEquals(forbiddenModules(await moduleGraph(join(REPO_ROOT, entryPoint))), []);
    });
}

Deno.test("the isolation check flags a module that imports a HostedSession", async () => {
    const probeDir = await Deno.makeTempDir({ prefix: "runwield-attached-isolation-probe-" });
    try {
        const probe = join(probeDir, "probe.ts");
        const hostedSession = toFileUrl(join(REPO_ROOT, "src/shared/session/hosted-session.js")).href;
        await Deno.writeTextFile(probe, `import ${JSON.stringify(hostedSession)};\n`);
        const forbidden = forbiddenModules(await moduleGraph(probe));
        assert(forbidden.includes(hostedSession), "The probe's HostedSession import must be reported.");
        assert(forbidden.some((specifier) => specifier.startsWith("npm:/@earendil-works/")));
    } finally {
        await Deno.remove(probeDir, { recursive: true });
    }
});

Deno.test("the Claude adapter imports no domain module outside src/shared/attached/", async () => {
    const graph = await moduleGraph(join(REPO_ROOT, "src/attached/claude/mcp.ts"));
    const adapterModules = graph.modules.filter((module) => module.specifier.startsWith(CLAUDE_ADAPTER_URL));
    assert(adapterModules.length > 0);
    const outsideImports = adapterModules.flatMap((module) =>
        (module.dependencies ?? []).map((dependency) => dependency.code?.specifier ?? dependency.specifier)
    ).filter((specifier) =>
        specifier.startsWith("file:") && !specifier.startsWith(ATTACHED_DOMAIN_URL) &&
        !specifier.startsWith(CLAUDE_ADAPTER_URL)
    );
    assertEquals(outsideImports, []);
});
