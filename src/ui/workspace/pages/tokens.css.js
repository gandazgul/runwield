const TOKENS_CSS_URL = new URL("../../design-system/tokens.css", import.meta.url);

/** @type {import("astro").APIRoute} */
export const GET = async () => {
    const css = await Deno.readTextFile(TOKENS_CSS_URL);
    return new Response(css, { headers: { "content-type": "text/css; charset=utf-8" } });
};
