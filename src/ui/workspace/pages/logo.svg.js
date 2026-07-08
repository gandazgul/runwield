const LOGO_URL = new URL("../../../../logo.svg", import.meta.url);

/** @type {import("astro").APIRoute} */
export const GET = async () => {
    const logo = await Deno.readTextFile(LOGO_URL);
    return new Response(logo, { headers: { "content-type": "image/svg+xml; charset=utf-8" } });
};
