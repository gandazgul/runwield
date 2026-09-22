// @ts-nocheck: this Deno-only stylesheet bundler is imported by the server, not the Astro browser program.
/** @module ui/workspace/workspace-styles */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Keep the editable CSS sections ordered while serving one production stylesheet.
 * Packaged Plan Servers already contain the flattened file and need no sections.
 * @param {string | URL} path
 * @returns {Promise<string>}
 */
export async function readWorkspaceStyles(path: string | URL) {
    const sourcePath = path instanceof URL ? fileURLToPath(path) : path;
    const css = await Deno.readTextFile(sourcePath);
    const imports = /@import "(\.\/workspace-styles\/[a-z-]+\.css)";\n?/g;
    const matches = [...css.matchAll(imports)];
    const sections = await Promise.all(
        matches.map((match) => Deno.readTextFile(join(dirname(sourcePath), match[1]))),
    );
    let index = 0;
    return css.replace(imports, () => sections[index++]);
}
