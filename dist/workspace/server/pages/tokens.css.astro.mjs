export { renderers } from '../renderers.mjs';

const TOKENS_CSS_URL = new URL("../../design-system/tokens.css", import.meta.url);

/** @type {import("astro").APIRoute} */
const GET = async () => {
    const css = await Deno.readTextFile(TOKENS_CSS_URL);
    return new Response(css, { headers: { "content-type": "text/css; charset=utf-8" } });
};

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
    __proto__: null,
    GET
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
