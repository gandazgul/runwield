import { renderRunWieldThemeCss } from "../../design-system/theme-bridge.js";

/** @returns {Response} */
export const GET = () => {
    const css = renderRunWieldThemeCss();
    return new Response(css, {
        headers: {
            "content-type": "text/css; charset=utf-8",
            "cache-control": "no-store",
        },
    });
};
