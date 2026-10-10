import { join } from "@std/path";

function isFile(path: string): boolean {
    try {
        return Deno.statSync(path).isFile;
    } catch {
        return false;
    }
}

/** Find Git Bash even when Windows exposes only Git's cmd directory on PATH. */
export function findWindowsBashPath(): string | undefined {
    const roots = [Deno.env.get("ProgramFiles"), Deno.env.get("ProgramFiles(x86)")]
        .filter((root): root is string => Boolean(root))
        .map((root) => join(root, "Git"));
    const localAppData = Deno.env.get("LOCALAPPDATA");
    if (localAppData) roots.push(join(localAppData, "Programs", "Git"));
    const pathDirs = (Deno.env.get("PATH") || "").split(";")
        .map((entry) => entry.trim().replace(/^"(.*)"$/, "$1")).filter(Boolean);
    for (const dir of pathDirs) {
        if (isFile(join(dir, "git.exe"))) roots.push(join(dir, ".."));
    }
    const candidates = roots.flatMap((root) => [join(root, "bin", "bash.exe"), join(root, "usr", "bin", "bash.exe")]);
    candidates.push(...pathDirs.map((dir) => join(dir, "bash.exe")));
    return candidates.find(isFile);
}
