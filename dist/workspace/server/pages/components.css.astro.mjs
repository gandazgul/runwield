export { renderers } from '../renderers.mjs';

const COMPONENTS_CSS_URL = new URL("../../design-system/components.css", import.meta.url);

/** @type {import("astro").APIRoute} */
const GET = async () => {
    const css = await Deno.readTextFile(COMPONENTS_CSS_URL);
    return new Response(css, { headers: { "content-type": "text/css; charset=utf-8" } });
};

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
    __proto__: null,
    GET
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
