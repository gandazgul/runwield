/// <reference types="astro/client" />
/// <reference lib="deno.ns" />

// Astro's checker does not load Deno's standard library declarations.
declare namespace Deno {
    function readTextFile(path: string | URL): Promise<string>;
}
