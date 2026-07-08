const COMPONENTS_CSS_URL = new URL("../../design-system/components.css", import.meta.url);

/** @type {import("astro").APIRoute} */
export const GET = async () => {
    const css = await Deno.readTextFile(COMPONENTS_CSS_URL);
    return new Response(css, { headers: { "content-type": "text/css; charset=utf-8" } });
};
