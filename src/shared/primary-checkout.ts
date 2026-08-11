import { dirname, join, normalize } from "@std/path";

function isGitEntry(path: string): boolean {
    try {
        const stat = Deno.statSync(path);
        return stat.isDirectory || stat.isFile;
    } catch {
        return false;
    }
}

/**
 * Resolve the primary checkout root for a linked Git worktree.
 *
 * This is synchronous and filesystem-only because settings path resolution is
 * synchronous. Non-worktree roots are returned unchanged.
 */
export function resolvePrimaryCheckoutRoot(root: string): string {
    const gitPath = join(root, ".git");
    let gitStat: Deno.FileInfo;
    try {
        gitStat = Deno.statSync(gitPath);
    } catch {
        return root;
    }
    if (!gitStat.isFile) return root;

    let text = "";
    try {
        text = Deno.readTextFileSync(gitPath).trim();
    } catch {
        return root;
    }
    const match = /^gitdir:\s*(.+)$/i.exec(text);
    if (!match) return root;

    const rawGitDir = match[1].trim();
    const gitDir = rawGitDir.startsWith("/") ? rawGitDir : normalize(join(root, rawGitDir));
    const primaryRoot = dirname(dirname(dirname(gitDir)));
    if (!isGitEntry(join(primaryRoot, ".git"))) return root;
    return primaryRoot;
}
