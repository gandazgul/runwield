import { dirname, fromFileUrl, join, normalize, relative, resolve, SEPARATOR } from "@std/path";

export const PUBLIC_DOCS = [
    "index.md",
    "quickstart.md",
    "workspace.md",
    "workspace-container.md",
    "usage.md",
    "workflows.md",
    "collaboration.md",
    "sessions.md",
    "providers.md",
    "customization.md",
    "troubleshooting.md",
    "settings.md",
    "themes.md",
    "mcp.md",
    "plan-lifecycle.md",
    "validation-authority.md",
    "contributing.md",
] as const;

export interface DocsRelease {
    version: string;
    sourceRef: string;
    releaseUrl: string;
}

const PUBLIC_SET = new Set<string>(PUBLIC_DOCS);
const REPOSITORY_URL = "https://github.com/gandazgul/runwield";

function routeFor(path: string): string {
    return path === "index.md" ? "/" : `/${path.slice(0, -3)}/`;
}

function splitTarget(target: string): { path: string; suffix: string } {
    const index = target.search(/[?#]/);
    return index < 0 ? { path: target, suffix: "" } : { path: target.slice(0, index), suffix: target.slice(index) };
}

function rewriteTarget(
    target: string,
    sourcePath: string,
    release: DocsRelease,
    image = false,
): string {
    if (
        !target || target.startsWith("#") || target.startsWith("/") ||
        /^[a-z][a-z+.-]*:/i.test(target) || target.startsWith("//")
    ) return target;
    const { path, suffix } = splitTarget(target);
    const sourceDirectory = dirname(`docs/${sourcePath}`);
    const repositoryPath = normalize(join(sourceDirectory, path)).split(SEPARATOR)
        .join("/");
    const docsPath = repositoryPath.startsWith("docs/") ? repositoryPath.slice(5) : "";
    if (docsPath && PUBLIC_SET.has(docsPath)) {
        return `${routeFor(docsPath)}${suffix}`;
    }
    if (image) return `/docs-assets/${repositoryPath}${suffix}`;
    const kind = path.endsWith("/") || !path.split("/").at(-1)?.includes(".") ? "tree" : "blob";
    return `${REPOSITORY_URL}/${kind}/${encodeURIComponent(release.sourceRef)}/${repositoryPath}${suffix}`;
}

interface LocalTarget {
    target: string;
    image: boolean;
}

function imageReferenceLabels(source: string): Set<string> {
    return new Set(
        Array.from(source.matchAll(/!\[[^\]]*\]\[([^\]]+)\]/g), (match) => match[1].toLowerCase()),
    );
}

function localTargets(source: string): LocalTarget[] {
    const targets = Array.from(
        source.matchAll(/(!?)\[[^\]]*\]\(([^\s)]+)\)/g),
        (match) => ({ target: match[2], image: match[1] === "!" }),
    );
    const imageLabels = imageReferenceLabels(source);
    for (const match of source.matchAll(/^\s*\[([^\]]+)\]:\s*(\S+)/gm)) {
        targets.push({ target: match[2], image: imageLabels.has(match[1].toLowerCase()) });
    }
    return targets;
}

async function validateLocalTargets(
    projectRoot: string,
    source: string,
    sourcePath: string,
): Promise<string[]> {
    const images: string[] = [];
    for (const localTarget of localTargets(source)) {
        const { target, image } = localTarget;
        if (
            !target || target.startsWith("#") || target.startsWith("/") ||
            /^[a-z][a-z+.-]*:/i.test(target) || target.startsWith("//")
        ) continue;
        const { path } = splitTarget(target);
        const repositoryPath = resolve(projectRoot, dirname(`docs/${sourcePath}`), path);
        const projectRelativePath = relative(projectRoot, repositoryPath);
        if (projectRelativePath.startsWith("..")) {
            throw new Error(`Public document docs/${sourcePath} links outside the repository: ${target}`);
        }
        try {
            const info = await Deno.stat(repositoryPath);
            if (image && !info.isFile) {
                throw new Error(`Public document docs/${sourcePath} uses a directory as an image: ${target}`);
            }
            if (image) images.push(repositoryPath);
        } catch (error) {
            if (!(error instanceof Deno.errors.NotFound)) throw error;
            throw new Error(`Public document docs/${sourcePath} has a missing local target: ${target}`);
        }
    }
    return images;
}

export function renderPublicDocument(
    source: string,
    sourcePath: string,
    release: DocsRelease,
): string {
    const heading = source.match(/^#\s+(.+)$/m);
    if (!heading) {
        throw new Error(`Public document docs/${sourcePath} needs one H1 heading`);
    }
    let body = source.replace(heading[0], "").replace(/^\s+/, "");
    body = body.replace(
        /(!?\[[^\]]*\]\()([^\s)]+)(\))/g,
        (_match, open, target, close) =>
            `${open}${rewriteTarget(target, sourcePath, release, open.startsWith("!"))}${close}`,
    );
    const imageLabels = imageReferenceLabels(source);
    body = body.replace(
        /^(\s*\[([^\]]+)\]:\s*)(\S+)/gm,
        (_match, prefix, label, target) =>
            `${prefix}${rewriteTarget(target, sourcePath, release, imageLabels.has(label.toLowerCase()))}`,
    );
    const title = JSON.stringify(heading[1].trim());
    return `---\ntitle: ${title}\ndescription: ${JSON.stringify(`RunWield ${heading[1].trim()}`)}\n---\n\n${body}`;
}

export async function stagePublicDocs(
    projectRoot: string,
    outputDirectory: string,
): Promise<void> {
    const releasePath = join(projectRoot, "docs-site", "release.json");
    const release = JSON.parse(
        await Deno.readTextFile(releasePath),
    ) as DocsRelease;
    await Deno.remove(outputDirectory, { recursive: true }).catch((error) => {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
    });
    await Deno.mkdir(outputDirectory, { recursive: true });
    const assetDirectory = join(projectRoot, "docs-site", "public", "docs-assets");
    await Deno.remove(assetDirectory, { recursive: true }).catch((error) => {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
    });
    for (const path of PUBLIC_DOCS) {
        const source = await Deno.readTextFile(join(projectRoot, "docs", path));
        const images = await validateLocalTargets(projectRoot, source, path);
        for (const image of images) {
            const destination = join(assetDirectory, relative(projectRoot, image));
            await Deno.mkdir(dirname(destination), { recursive: true });
            await Deno.copyFile(image, destination);
        }
        await Deno.writeTextFile(
            join(outputDirectory, path),
            renderPublicDocument(source, path, release),
        );
    }
}

if (import.meta.main) {
    const scriptDirectory = dirname(fromFileUrl(import.meta.url));
    const projectRoot = resolve(scriptDirectory, "..");
    const output = join(projectRoot, "docs-site", "src", "content", "docs");
    await stagePublicDocs(projectRoot, output);
    console.log(
        `Staged ${PUBLIC_DOCS.length} public documents in ${relative(projectRoot, output)}`,
    );
}
