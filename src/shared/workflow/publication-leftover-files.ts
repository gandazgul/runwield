import { dirname, join, resolve } from "@std/path";

async function git(root: string, args: string[]): Promise<string> {
    const result = await new Deno.Command("git", { cwd: root, args, stdout: "piped", stderr: "piped" }).output();
    if (!result.success) throw new Error("Could not check the saved checkout. Its files were kept.");
    return new TextDecoder().decode(result.stdout).trim();
}

export function publicationSavedFilesPath(executionCwd: string): string {
    return join(`${executionCwd}.saved`, "files");
}

export async function existingPublicationSavedFiles(executionCwd: string): Promise<string | undefined> {
    const path = publicationSavedFilesPath(executionCwd);
    try {
        return (await Deno.lstat(path)).isDirectory ? path : undefined;
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) return undefined;
        throw error;
    }
}

/** Called only after publication is proven. Preserve bytes; never infer that an
 * unregistered checkout is clean from its committed branch history. */
export async function preserveUnregisteredPublicationFiles(
    projectRoot: string,
    executionCwd: string,
): Promise<string | undefined> {
    const source = await Deno.realPath(executionCwd);
    if (source === await Deno.realPath(projectRoot)) return undefined;
    if (!(await Deno.lstat(executionCwd)).isDirectory) return undefined;
    const registered = await git(projectRoot, ["worktree", "list", "--porcelain"]);
    for (const line of registered.split("\n")) {
        if (!line.startsWith("worktree ")) continue;
        const path = line.slice("worktree ".length);
        const canonical = await Deno.realPath(path).catch(() => path);
        if (canonical === source) return undefined;
    }
    const markerPath = join(executionCwd, ".git");
    const markerStat = await Deno.lstat(markerPath).catch(() => null);
    if (!markerStat?.isFile) return undefined;
    const marker = (await Deno.readTextFile(markerPath)).trim();
    if (!marker.startsWith("gitdir: ")) return undefined;
    const admin = resolve(executionCwd, marker.slice("gitdir: ".length));
    const common = await git(projectRoot, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    const adminParent = await Deno.realPath(dirname(admin)).catch(() => dirname(admin));
    const expectedParent = await Deno.realPath(join(common, "worktrees")).catch(() => join(common, "worktrees"));
    if (adminParent !== expectedParent) return undefined;
    try {
        await Deno.lstat(admin);
        return undefined;
    } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    const saved = publicationSavedFilesPath(executionCwd);
    // Reserve the container without following an existing symlink or replacing
    // a previous saved directory. Rename keeps ignored and untracked files too.
    await Deno.mkdir(dirname(saved)).catch((error) => {
        if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
    });
    if (!(await Deno.lstat(dirname(saved))).isDirectory) {
        throw new Error("The folder for saved files is not available. No files were moved.");
    }
    try {
        await Deno.lstat(saved);
        throw new Error("A saved copy already exists. Both copies were kept.");
    } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    await Deno.rename(executionCwd, saved);
    return saved;
}
