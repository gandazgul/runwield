// @ts-nocheck: Astro dev runs through Vite's SSR loader, which cannot statically resolve Deno JSR imports.
// Keep Workspace data canonical by dynamically importing the real adapter through Deno instead of reimplementing it.

const ADAPTER_URL_KEY = Symbol.for("runwield.workspace.plan-adapter-url");
const runtime = globalThis;
const ADAPTER_URL = runtime[ADAPTER_URL_KEY] || new URL("./plan-adapter.js", import.meta.url).href;

async function workspaceAdapter() {
    const nativeImport = Function("specifier", "return import(specifier)");
    try {
        return await nativeImport(ADAPTER_URL);
    } catch (error) {
        const cwd = runtime.Deno?.cwd?.();
        if (!cwd) throw error;
        const sourceAdapterUrl = new URL("src/ui/workspace/server/plan-adapter.js", `file://${cwd}/`).href;
        return await nativeImport(sourceAdapterUrl);
    }
}

/** @param {string} cwd */
export async function loadCanonicalBoard(cwd) {
    const adapter = await workspaceAdapter();
    return await adapter.loadBoard(cwd);
}

/** @param {string} cwd @param {string} planId */
export async function loadCanonicalWorkspaceDetail(cwd, planId) {
    const adapter = await workspaceAdapter();
    return await adapter.loadWorkspaceDetail(cwd, planId);
}

/** @param {unknown} error */
export async function serializeCanonicalPlanError(error) {
    const adapter = await workspaceAdapter();
    return adapter.serializePlanError(error);
}
