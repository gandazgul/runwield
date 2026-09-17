import { join } from "@std/path";

/**
 * List repository files that CI owns: tracked files plus untracked files that Git does not ignore.
 * `.wld/` contains project and runtime metadata, not CI source, so it is always outside this boundary.
 */
export async function listCiFiles(repoRoot: string): Promise<string[]> {
    const output = await new Deno.Command("git", {
        args: ["ls-files", "--cached", "--others", "--exclude-standard", "--deduplicate", "-z"],
        cwd: repoRoot,
        stdout: "piped",
        stderr: "piped",
    }).output();
    if (!output.success) {
        const detail = new TextDecoder().decode(output.stderr).trim();
        throw new Error(detail || "git ls-files failed");
    }

    const candidates = new TextDecoder().decode(output.stdout)
        .split("\0")
        .filter((path) => path && path !== ".wld" && !path.startsWith(".wld/"));
    const files = await Promise.all(candidates.map(async (path) => {
        const isFile = await Deno.lstat(join(repoRoot, path))
            .then((stat) => stat.isFile || stat.isSymlink)
            .catch((error) => {
                if (error instanceof Deno.errors.NotFound) return false;
                throw error;
            });
        return isFile ? path : "";
    }));
    return files.filter(Boolean).sort();
}
