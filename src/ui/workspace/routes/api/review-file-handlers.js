/** Host contracts used by the embedded Plannotator code-review components. */

import { isAbsolute, relative, resolve } from "node:path";

/**
 * Return the current working-tree content when it is safely available.
 * The workflow diff's baseline tree is intentionally not guessed here, so
 * oldContent remains null instead of showing content from the wrong revision.
 *
 * @param {Request} request
 * @param {{ cwd?: string }} [options]
 */
export async function reviewFileContentApi(request, options = {}) {
    const url = new URL(request.url);
    const filePath = url.searchParams.get("path")?.trim();
    const oldPath = url.searchParams.get("oldPath")?.trim();
    if (!filePath) return Response.json({ error: "File path required." }, { status: 400 });

    const cwd = resolve(options.cwd || Deno.cwd());
    if (!isSafeRelativePath(filePath, cwd) || (oldPath && !isSafeRelativePath(oldPath, cwd))) {
        return Response.json({ error: "File path is outside this review workspace." }, { status: 403 });
    }

    try {
        return Response.json({
            oldContent: null,
            newContent: await readWorkspaceTextFile(cwd, filePath),
        }, {
            headers: { "cache-control": "no-store" },
        });
    } catch (error) {
        if (error instanceof Deno.errors.PermissionDenied) {
            return Response.json({ error: "File path is outside this review workspace." }, { status: 403 });
        }
        return Response.json({ error: "Unable to read file content." }, { status: 500 });
    }
}

/** Plannotator hides its open-in control when the host reports unavailable. */
export function reviewOpenInAppsApi() {
    return Response.json({ available: false, apps: [] }, {
        headers: { "cache-control": "no-store" },
    });
}

/**
 * Plannotator's config store already persists these settings in its cookies.
 * Acknowledge its optional server-sync request without introducing a second
 * RunWield settings source.
 */
export function reviewLocalConfigApi() {
    return Response.json({ ok: true }, {
        headers: { "cache-control": "no-store" },
    });
}

/** @param {string} path @param {string} cwd */
function isSafeRelativePath(path, cwd) {
    if (!path || path.includes("\0") || isAbsolute(path)) return false;
    return isPathInside(resolve(cwd, path), cwd);
}

/** @param {string} cwd @param {string} filePath */
async function readWorkspaceTextFile(cwd, filePath) {
    const candidate = resolve(cwd, filePath);
    try {
        const realCwd = await Deno.realPath(cwd);
        const realPath = await Deno.realPath(candidate);
        if (!isPathInside(realPath, realCwd)) throw new Deno.errors.PermissionDenied();
        const stat = await Deno.stat(realPath);
        return stat.isFile ? await Deno.readTextFile(realPath) : null;
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) return null;
        throw error;
    }
}

/** @param {string} path @param {string} root */
function isPathInside(path, root) {
    const rel = relative(resolve(root), resolve(path));
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}
