import { renderRunWieldThemeCss } from "../../design-system/theme-bridge.ts";

export const GET = (): Response => {
    const css = renderRunWieldThemeCss();
    return new Response(css, {
        headers: {
            "content-type": "text/css; charset=utf-8",
            "cache-control": "no-store",
        },
    });
};
