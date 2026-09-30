// Vite replaces direct import.meta.env.DEV access at build time. Optional
// access makes it embed the entire build process environment in the server
// bundle, including runner-specific values and secrets.
export function isAstroDevelopmentMode() {
    try {
        return import.meta.env.DEV;
    } catch (error) {
        if (!(error instanceof TypeError)) throw error;
        // Native Deno imports (outside Astro) have no import.meta.env.
        return false;
    }
}
