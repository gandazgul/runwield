import { dirname, fromFileUrl, join, resolve } from "@std/path";
import { stagePublicDocs } from "./public-docs.ts";

const projectRoot = resolve(dirname(fromFileUrl(import.meta.url)), "..");
const output = join(projectRoot, "docs-site", "src", "content", "docs");

await stagePublicDocs(projectRoot, output);

const server = new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", "npm:astro@7.3.3", "dev", "--host", "127.0.0.1", "--port", "4322"],
    cwd: join(projectRoot, "docs-site"),
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
}).spawn();

type Timer = ReturnType<typeof setTimeout>;
let timer: Timer | undefined;
const watcher = Deno.watchFs([
    join(projectRoot, "docs"),
    join(projectRoot, "docs-site", "release.json"),
]);

async function watchSources(): Promise<void> {
    for await (const event of watcher) {
        if (!event.paths.some((path) => path.endsWith(".md") || path.endsWith("release.json"))) continue;
        clearTimeout(timer);
        timer = setTimeout(async () => {
            try {
                await stagePublicDocs(projectRoot, output);
                console.log("Restaged public documentation source");
            } catch (error) {
                console.error(error);
            }
        }, 75);
    }
}

const stop = () => {
    watcher.close();
    try {
        server.kill("SIGTERM");
    } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
};
Deno.addSignalListener("SIGINT", stop);
Deno.addSignalListener("SIGTERM", stop);

await Promise.race([server.status, watchSources()]);
