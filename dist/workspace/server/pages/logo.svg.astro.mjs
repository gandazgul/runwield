export { renderers } from '../renderers.mjs';

const LOGO_URL = new URL("../../../../logo.svg", import.meta.url);

/** @type {import("astro").APIRoute} */
const GET = async () => {
    const logo = await Deno.readTextFile(LOGO_URL);
    return new Response(logo, { headers: { "content-type": "image/svg+xml; charset=utf-8" } });
};

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
    __proto__: null,
    GET
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
