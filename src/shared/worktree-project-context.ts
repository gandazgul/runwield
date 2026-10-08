import { basename, dirname, join } from "@std/path";
import { enterProjectRuntime, resolveProjectRuntimeLayout } from "./project-runtime-layout.ts";
import { ensureRunWieldOwnedGitignoreBlock, RUNWIELD_GITIGNORE_BLOCK } from "./runwield-owned-paths.ts";

/** Versionable setup artifacts; these are not disposable .wld/internal runtime state. */
export const PROJECT_CONTEXT_PATHS = [".wld/settings.json", "docs/domain-language.md"] as const;

interface ContextFile {
    path: string;
    content: string;
    sourceDigest?: string;
}

export interface WorktreeProjectContext {
    files: ContextFile[];
    ownedGitignore: boolean;
}

async function git(cwd: string, args: string[]) {
    const result = await new Deno.Command("git", { cwd, args, stdout: "piped", stderr: "piped" }).output();
    return {
        code: result.code,
        stdout: new TextDecoder().decode(result.stdout),
        stderr: new TextDecoder().decode(result.stderr),
    };
}

export async function readProjectContextFile(root: string, path: string): Promise<string | null> {
    // Setup paths must stay inside their checkout, including parent directories.
    let current = root;
    for (const part of path.split("/")) {
        current = join(current, part);
        try {
            if ((await Deno.lstat(current)).isSymlink) {
                throw new Error(`Cannot carry project context through a symlink: ${path}`);
            }
        } catch (error) {
            if (error instanceof Deno.errors.NotFound) return null;
            throw error;
        }
    }
    return await Deno.readTextFile(current);
}

export async function readProjectContextRevision(root: string, ref: string, path: string): Promise<string | null> {
    const entry = await git(root, ["ls-tree", ref, "--", path]);
    if (entry.code !== 0) throw new Error(entry.stderr);
    if (!entry.stdout) return null;
    if (!/^100[0-7]{3} blob /.test(entry.stdout)) {
        throw new Error(`Project context must be a regular file: ${ref}:${path}`);
    }
    const result = await git(root, ["show", `${ref}:${path}`]);
    if (result.code !== 0) throw new Error(result.stderr);
    return result.stdout;
}

async function mergeContext(root: string, path: string, base: string, source: string, target: string): Promise<string> {
    const temporary = await Deno.makeTempDir({ prefix: "runwield-project-context-" });
    try {
        const paths = ["target", "base", "source"].map((name) => join(temporary, name));
        for (const [index, content] of [target, base, source].entries()) {
            await Deno.writeTextFile(paths[index], content);
        }
        const result = await git(root, ["merge-file", "-p", ...paths]);
        if (result.code !== 0) {
            throw new Error(
                `Uncommitted project context conflicts with the worktree target: ${path}. ` +
                    "The original files are unchanged; reconcile this file before retrying execution.",
            );
        }
        return result.stdout;
    } finally {
        await Deno.remove(temporary, { recursive: true });
    }
}

/**
 * Capture only uncommitted setup files (staged, unstaged, untracked, or ignored).
 * Merge against the source HEAD so another target branch keeps its own changes.
 * Resolve conflicts before creating a worktree, without modifying the source index.
 */
export async function captureWorktreeProjectContext(root: string, targetRef: string): Promise<WorktreeProjectContext> {
    const files: ContextFile[] = [];
    for (const path of PROJECT_CONTEXT_PATHS) {
        const source = await readProjectContextFile(root, path);
        if (source === null) continue;
        const base = await readProjectContextRevision(root, "HEAD", path);
        if (source === base) continue;
        const target = await readProjectContextRevision(root, targetRef, path);
        if (source === target) continue;
        const content = target === base ? source : await mergeContext(root, path, base ?? "", source, target ?? "");
        files.push({ path, content, sourceDigest: await digest(source) });
    }
    const ignore = await readProjectContextFile(root, ".gitignore");
    return { files, ownedGitignore: ignore?.includes(RUNWIELD_GITIGNORE_BLOCK.split("\n")[0]) ?? false };
}

/** Only call on a newly created checkout; resumed worktrees own their local edits. */
export async function materializeWorktreeProjectContext(root: string, context: WorktreeProjectContext): Promise<void> {
    for (const file of context.files) {
        await readProjectContextFile(root, file.path);
        await Deno.mkdir(dirname(join(root, file.path)), { recursive: true });
        await Deno.writeTextFile(join(root, file.path), file.content);
    }
    // Recreate only our managed block, never copy unrelated source ignore edits.
    if (context.ownedGitignore || context.files.length > 0) {
        await readProjectContextFile(root, ".gitignore");
        await ensureRunWieldOwnedGitignoreBlock(root);
    }
    if (context.files.length > 0) {
        await enterProjectRuntime(root);
        const files = [];
        for (const file of context.files) {
            files.push({ path: file.path, digest: await digest(file.content), sourceDigest: file.sourceDigest });
        }
        const receipt = receiptPath(root);
        const internalRoot = dirname(receipt);
        await readProjectContextFile(dirname(internalRoot), join(basename(internalRoot), basename(receipt)));
        await Deno.mkdir(dirname(receipt), { recursive: true });
        await Deno.writeTextFile(receipt, JSON.stringify({ files }) + "\n");
    }
}

interface ContextReceipt {
    files: Array<{ path: string; digest: string; sourceDigest?: string }>;
}

function receiptPath(root: string): string {
    return join(resolveProjectRuntimeLayout(root).selected.internalRoot, "worktree-project-context.json");
}

async function digest(content: string): Promise<string> {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
    return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Only the captured bytes count as preparation; later edits are implementation. */
export async function isTransferredProjectContext(root: string, path: string, ref?: string): Promise<boolean> {
    if (!PROJECT_CONTEXT_PATHS.some((candidate) => candidate === path)) return false;
    let receipt: ContextReceipt;
    try {
        receipt = JSON.parse(await Deno.readTextFile(receiptPath(root)));
    } catch (error) {
        if (error instanceof Deno.errors.NotFound || error instanceof SyntaxError) return false;
        throw error;
    }
    const recorded = Array.isArray(receipt?.files) ? receipt.files.find((file) => file?.path === path) : undefined;
    if (typeof recorded?.digest !== "string") return false;
    const content = ref ? await readProjectContextRevision(root, ref, path) : await readProjectContextFile(root, path);
    return content !== null && await digest(content) === recorded.digest;
}

/** Remember successful Init output without copying or changing the output files. */
export async function recordInitializedProjectContext(root: string): Promise<void> {
    await enterProjectRuntime(root);
    const files = [];
    for (const path of PROJECT_CONTEXT_PATHS) {
        const content = await readProjectContextFile(root, path);
        if (content !== null) files.push({ path, digest: await digest(content) });
    }
    const receipt = receiptPath(root);
    await Deno.mkdir(dirname(receipt), { recursive: true });
    await Deno.writeTextFile(receipt, JSON.stringify({ files }) + "\n");
}

/** Original source bytes may differ from the merged target bytes in the worktree. */
export async function isUnchangedTransferredSource(
    root: string,
    executionRoot: string,
    path: string,
): Promise<boolean> {
    if (!PROJECT_CONTEXT_PATHS.some((candidate) => candidate === path)) return false;
    let receipt: ContextReceipt;
    try {
        receipt = JSON.parse(await Deno.readTextFile(receiptPath(executionRoot)));
    } catch (error) {
        if (error instanceof Deno.errors.NotFound || error instanceof SyntaxError) return false;
        throw error;
    }
    const file = Array.isArray(receipt?.files) ? receipt.files.find((file) => file?.path === path) : undefined;
    const expected = file?.sourceDigest ?? file?.digest;
    if (typeof expected !== "string") return false;
    const content = await readProjectContextFile(root, path);
    return content !== null && await digest(content) === expected;
}
