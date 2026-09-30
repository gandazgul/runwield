// Run isolated source and standalone renderer, saved-operation, and combined workloads.
import { join, resolve } from "@std/path";
import { buildCompileArgs } from "./compile.js";
import { sha256File } from "./build-metadata.js";

interface Sample {
    type: string;
    label: string;
    heapUsed: number;
    external: number;
    rss: number;
    responses: number;
    standalone: boolean;
    scenario?: string;
    completed?: number;
    pages?: number;
}

interface Result {
    samples: Sample[];
    stdout: string;
}

const decoder = new TextDecoder();
const fixturePath = resolve("scripts/workspace-memory-fixture.ts");
const artifactPath = resolve("dist/workspace-runtime/server.mjs");
const sourcePath = resolve("dist/workspace/server/entry.mjs");
const timeoutMs = 210_000;

async function run(
    command: string,
    args: string[],
    env?: Record<string, string>,
    timeout = timeoutMs,
): Promise<Result> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort("timeout"), timeout);
    try {
        const output = await new Deno.Command(command, {
            args,
            env,
            signal: controller.signal,
            stdout: "piped",
            stderr: "piped",
        }).output();
        const stdout = decoder.decode(output.stdout);
        const stderr = decoder.decode(output.stderr);
        if (!output.success) {
            throw new Error(`INCOMPLETE: ${command} ${args.join(" ")} exited ${output.code}\n${stdout}\n${stderr}`);
        }
        return {
            stdout,
            samples: stdout.split("\n").filter(Boolean).map((line) => JSON.parse(line)).filter((entry) =>
                entry.type === "sample"
            ),
        };
    } catch (error) {
        if (controller.signal.aborted) throw new Error(`INCOMPLETE: subprocess exceeded ${timeout} ms: ${command}`);
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

async function isolatedRoot(): Promise<{ root: string; env: Record<string, string> }> {
    const root = await Deno.makeTempDir({ prefix: "runwield-workspace-memory-" });
    const home = join(root, "home");
    await Deno.mkdir(home);
    return {
        root,
        env: {
            HOME: home,
            MNEMOTECA_DB_PATH: join(root, "memory.sqlite3"),
            WLD_MEMORY_FIXTURE_ROOT: root,
            WLD_WORKSPACE_DISABLE_BUILT_SERVER: "0",
        },
    };
}

async function compiledBinary(root: string, gc = false): Promise<string> {
    const output = join(root, gc ? "workspace-memory-fixture-gc" : "workspace-memory-fixture");
    // Reuse the production compile inclusion list: the runtime entry must be
    // embedded as a passive asset, not imported as a normal Deno module.
    const args = buildCompileArgs({ output });
    args.splice(args.length - 1, 1, ...(gc ? ["--v8-flags=--expose-gc"] : []), fixturePath);
    const result = await run("deno", args, undefined, 600_000);
    if (result.stdout) console.log(result.stdout);
    return output;
}

function assertSamples(result: Result, gc: boolean, standalone: boolean, scenario: string): void {
    const samples = result.samples;
    if (samples.length !== 3 || samples.map((s) => s.label).join(",") !== "baseline,batch-1,batch-2") {
        throw new Error(`INCOMPLETE: expected baseline and two complete batches: ${result.stdout}`);
    }
    if (samples.some((s) => s.standalone !== standalone || s.rss >= 1024 ** 3)) {
        throw new Error(`INCOMPLETE: wrong runtime or RSS guard: ${result.stdout}`);
    }
    if (scenario === "renderer") {
        const batchSize = samples[1].responses - samples[0].responses;
        if (batchSize < 70 || samples[2].responses - samples[1].responses !== batchSize) {
            throw new Error(`INCOMPLETE: request counts differ: ${result.stdout}`);
        }
    } else if (
        samples.some((s) => s.scenario !== scenario) ||
        samples.map((s) => s.completed).join(",") !== "0,10,20" ||
        samples.map((s) => s.pages).join(",") !== (scenario === "combined" ? "12,132,252" : "0,0,0")
    ) {
        throw new Error(`INCOMPLETE: fixed operation/page batches differ: ${result.stdout}`);
    }
    if (gc && samples[2].external - samples[1].external > 4 * 1024 ** 2) {
        throw new Error(`Retained external buffers grew more than 4 MiB: ${result.stdout}`);
    }
    if (gc && samples[2].heapUsed - samples[1].heapUsed > 10 * 1024 ** 2) {
        throw new Error(`Retained heap grew more than 10 MiB: ${result.stdout}`);
    }
}

async function measure(scenario: "renderer" | "operations" | "combined"): Promise<void> {
    await Deno.stat(sourcePath);
    await Deno.stat(artifactPath);
    const { root } = await isolatedRoot();
    try {
        const hash = await sha256File(artifactPath);
        console.log(
            JSON.stringify({
                type: "artifact",
                path: artifactPath,
                sha256: hash,
                source: sourcePath,
                sourceSha256: await sha256File(sourcePath),
            }),
        );
        const binary = await compiledBinary(root);
        const binaryGc = await compiledBinary(root, true);
        for (
            const [label, command, standalone] of [
                ["source", "deno", false],
                ["compiled", binary, true],
            ] as const
        ) {
            for (const gc of [true, false]) {
                const workload = scenario === "renderer"
                    ? []
                    : [scenario === "combined" ? "--combined" : "--operations"];
                const args = standalone ? ["--measure", ...workload, ...(gc ? ["--gc"] : [])] : [
                    "run",
                    "-A",
                    ...(gc ? ["--v8-flags=--expose-gc"] : []),
                    "--unstable-no-legacy-abort",
                    fixturePath,
                    "--measure",
                    ...workload,
                    ...(gc ? ["--gc"] : []),
                ];
                const isolated = await isolatedRoot();
                try {
                    const result = await run(standalone && gc ? binaryGc : command, args, isolated.env);
                    assertSamples(result, gc, standalone, scenario);
                    console.log(
                        JSON.stringify({
                            type: "outcome",
                            scenario,
                            mode: label,
                            flags: gc ? "forced-gc" : "production-default",
                            samples: result.samples,
                        }),
                    );
                } finally {
                    await Deno.remove(isolated.root, { recursive: true });
                }
            }
        }
    } finally {
        await Deno.remove(root, { recursive: true });
    }
}

async function serve(): Promise<void> {
    await Deno.stat(artifactPath);
    const { root, env } = await isolatedRoot();
    let child: Deno.ChildProcess | undefined;
    try {
        const binary = await compiledBinary(root);
        child = new Deno.Command(binary, { args: ["--serve"], env, stdout: "piped", stderr: "inherit" }).spawn();
        const reader = child.stdout.getReader();
        const first = await Promise.race([
            reader.read(),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Fixture startup timeout")), 60_000)),
        ]);
        const line = decoder.decode(first.value).split("\n")[0];
        const listening = JSON.parse(line);
        if (listening.type !== "listening" || !listening.url) throw new Error(`Fixture did not start: ${line}`);
        console.log(`Fixture URL: ${listening.url}/`);
        console.log(`Fixture routes: ${JSON.stringify(listening.routes)}`);
        console.log(`Memory samples: ${listening.url}/__memory`);
        console.log(`Shutdown: kill -INT ${Deno.pid} (or Ctrl-C)`);
        const onInterrupt = () => child?.kill("SIGTERM");
        Deno.addSignalListener("SIGINT", onInterrupt);
        Deno.addSignalListener("SIGTERM", onInterrupt);
        try {
            await child.status;
        } finally {
            Deno.removeSignalListener("SIGINT", onInterrupt);
            Deno.removeSignalListener("SIGTERM", onInterrupt);
        }
    } finally {
        if (child) {
            try {
                child.kill("SIGTERM");
            } catch { /* already exited */ }
            await child.status;
        }
        await Deno.remove(root, { recursive: true });
    }
}

if (import.meta.main) {
    const arg = Deno.args.join(" ");
    if (arg === "--scenario renderer" || arg === "--scenario operations" || arg === "--scenario combined") {
        await measure(arg.split(" ")[1] as "renderer" | "operations" | "combined");
    } else if (arg === "--serve-fixture") await serve();
    else throw new Error("Usage: --scenario renderer|operations|combined | --serve-fixture");
}
