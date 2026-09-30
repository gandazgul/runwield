// A disposable module layout tests the real Workspace server with both entry paths.
// The synthetic entries count module evaluations; no loader or importer is injected.
import { dirname, fromFileUrl, join, toFileUrl } from "@std/path";

const sourceRoot = dirname(dirname(fromFileUrl(import.meta.url)));
const root = await Deno.makeTempDir({ prefix: "workspace-renderer-probe-" });
const marker = '"key":';

async function mirror(relative: string, excluded: string[]): Promise<void> {
    const source = join(sourceRoot, relative);
    const target = join(root, relative);
    await Deno.mkdir(target, { recursive: true });
    for await (const entry of Deno.readDir(source)) {
        if (excluded.includes(entry.name)) continue;
        await Deno.symlink(join(source, entry.name), join(target, entry.name));
    }
}

async function entry(path: string, name: string): Promise<void> {
    await Deno.mkdir(dirname(path), { recursive: true });
    await Deno.writeTextFile(
        path,
        `// ${marker}\nglobalThis.__rendererProbe ??= {};\nglobalThis.__rendererProbe.${name} = (globalThis.__rendererProbe.${name} || 0) + 1;\nexport const handle = async (request) => new Response('<h1>${name} ' + new URL(request.url).searchParams.get('page') + '</h1>', { headers: { 'content-type': 'text/html' } });\n`,
    );
}

try {
    await mirror("", ["runtime-root.js", "src", "dist"]);
    await Deno.copyFile(join(sourceRoot, "runtime-root.js"), join(root, "runtime-root.js"));
    await mirror("src", ["ui"]);
    await mirror("src/ui", ["workspace"]);
    await mirror("src/ui/workspace", ["server.js"]);
    await Deno.copyFile(join(sourceRoot, "src/ui/workspace/server.js"), join(root, "src/ui/workspace/server.js"));
    const source = join(root, "dist/workspace/server/entry.mjs");
    const runtime = join(root, "dist/workspace-runtime/server.mjs");
    if (Deno.args[0] !== "missing") await entry(source, "source");
    await entry(runtime, "runtime");
    const { createWorkspaceApp } = await import(toFileUrl(join(root, "src/ui/workspace/server.js")).href);
    const handler = createWorkspaceApp({ cwd: root, token: "secret" }).handler();
    const page = async (value: string): Promise<string> => {
        const response = await handler(new Request(`http://localhost/?token=secret&page=${value}`));
        return `${response.status}:${await response.text()}`;
    };
    if (Deno.args[0] === "missing") {
        // No valid entry on the first attempt; the next request may retry.
        await Deno.remove(runtime);
        if (!(await page("before")).startsWith("503:")) throw new Error("Missing entry did not fail");
        await entry(source, "source");
    }
    if (Deno.args[0] === "fallback") {
        await Deno.writeTextFile(source, "// no importable marker");
    }
    if (Deno.args[0] === "evaluation-failure") {
        for (const path of [source, runtime]) {
            await Deno.writeTextFile(path, `// ${marker}\nthrow new Error('Renderer evaluation failed');`);
        }
        const response = await page("broken");
        if (!response.startsWith("503:") || !response.includes("restart")) {
            throw new Error(`Evaluation failure did not require restart: ${response}`);
        }
        console.log(JSON.stringify({ mode: Deno.args[0], response }));
    } else {
        if (Deno.args[0] === "disabled") {
            Deno.env.set("WLD_WORKSPACE_DISABLE_BUILT_SERVER", "1");
            if (!(await page("disabled")).startsWith("503:")) throw new Error("Disabled renderer did not fail");
            Deno.env.delete("WLD_WORKSPACE_DISABLE_BUILT_SERVER");
        }
        const responses = await Promise.all(Array.from({ length: 12 }, (_, index) => page(String(index))));
        const expected = Deno.args[0] === "fallback" ? "runtime" : "source";
        for (const [index, response] of responses.entries()) {
            if (!response.includes(`<h1>${expected} ${index}</h1>`)) throw new Error(`Wrong response: ${response}`);
        }
        const count = Reflect.get(globalThis, "__rendererProbe") as Record<string, number>;
        if (count?.[expected] !== 1 || count[expected === "source" ? "runtime" : "source"]) {
            throw new Error(`Entry initialized more than once or wrong entry selected: ${JSON.stringify(count)}`);
        }
        console.log(JSON.stringify({ mode: Deno.args[0], count, responses: responses.length }));
    }
} finally {
    await Deno.remove(root, { recursive: true });
}
