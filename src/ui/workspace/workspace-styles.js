/** @module ui/workspace/workspace-styles */
import { dirname, fromFileUrl, join } from "@std/path";

/**
 * Keep the editable CSS sections ordered while serving one production stylesheet.
 * Packaged Plan Servers already contain the flattened file and need no sections.
 * @param {string | URL} path
 * @returns {Promise<string>}
 */
export async function readWorkspaceStyles(path) {
    const sourcePath = path instanceof URL ? fromFileUrl(path) : path;
    const css = await Deno.readTextFile(sourcePath);
    const imports = /@import "(\.\/workspace-styles\/[a-z-]+\.css)";\n?/g;
    const matches = [...css.matchAll(imports)];
    const sections = await Promise.all(
        matches.map((match) => Deno.readTextFile(join(dirname(sourcePath), match[1]))),
    );
    let index = 0;
    return css.replace(imports, () => sections[index++]);
}
