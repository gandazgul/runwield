export const prerender = false;

type DenoRuntime = {
    readTextFile: (path: URL) => Promise<string>;
};

const runtime = globalThis as typeof globalThis & { Deno?: DenoRuntime };

export const GET = async () => {
    const scriptUrl = new URL("../static/workspace-shell.ts", import.meta.url);
    const body = await runtime.Deno?.readTextFile(scriptUrl) ?? "";
    return new Response(body, {
        headers: {
            "content-type": "text/javascript; charset=utf-8",
            "cache-control": "no-store",
        },
    });
};
