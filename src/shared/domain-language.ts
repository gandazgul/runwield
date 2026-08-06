import { basename, dirname, join, normalize, relative, resolve } from "@std/path";

import { getCwd } from "../constants.js";

export const DOMAIN_LANGUAGE_PATHS = Object.freeze({
    singleContext: join("docs", "domain-language.md"),
    multiContextMap: join("docs", "domain-language-map.md"),
    perContextGlossary: "domain-language.md",
});

export const LEGACY_DOMAIN_LANGUAGE_NAMES = Object.freeze({
    singleContext: "CONTEXT.md",
    multiContextMap: "CONTEXT-MAP.md",
});

// Compatibility note: exact-uppercase legacy migration is temporary. It may be deleted only by a future
// breaking-change Planned Change. This module is not a permanent dual-read policy and does not make legacy names
// readable fallbacks after startup migration.

export type DomainLanguageMigrationKind = "single-context" | "multi-context-map";
export type DomainLanguageMigrationWarningCode =
    | "destination_conflict"
    | "non_file_source"
    | "unsupported_map_link"
    | "source_missing"
    | "filesystem_error";

export interface DomainLanguageMigrationWarning {
    kind: DomainLanguageMigrationKind;
    code: DomainLanguageMigrationWarningCode;
    message: string;
    sourcePath?: string;
    destinationPath?: string;
}

export interface DomainLanguageMigrationNotice {
    kind: DomainLanguageMigrationKind;
    message: string;
    sourcePath: string;
    destinationPath: string;
}

export interface DomainLanguageMigrationResult {
    notices: DomainLanguageMigrationNotice[];
    warnings: DomainLanguageMigrationWarning[];
}

interface MigrationFilePair {
    sourcePath: string;
    destinationPath: string;
}

interface ParsedMapLink {
    fullText: string;
    target: string;
    rewrittenTarget: string;
    sourcePath: string;
    destinationPath: string;
}

function emptyResult(): DomainLanguageMigrationResult {
    return { notices: [], warnings: [] };
}

function mergeResult(
    target: DomainLanguageMigrationResult,
    next: DomainLanguageMigrationResult,
): DomainLanguageMigrationResult {
    target.notices.push(...next.notices);
    target.warnings.push(...next.warnings);
    return target;
}

async function findExactEntryName(directoryPath: string, expectedName: string): Promise<string | undefined> {
    try {
        for await (const entry of Deno.readDir(directoryPath)) {
            if (entry.name === expectedName) return entry.name;
        }
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) return undefined;
        throw error;
    }
    return undefined;
}

async function pathExists(path: string): Promise<boolean> {
    try {
        await Deno.lstat(path);
        return true;
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) return false;
        throw error;
    }
}

async function assertPlainFile(
    kind: DomainLanguageMigrationKind,
    path: string,
): Promise<DomainLanguageMigrationWarning | undefined> {
    try {
        const exactEntryName = await findExactEntryName(dirname(path), basename(path));
        if (!exactEntryName) {
            return {
                kind,
                code: "source_missing",
                message: `Legacy domain-language source is not stored with exact legacy casing: ${path}`,
                sourcePath: path,
            };
        }
        const stat = await Deno.lstat(path);
        if (!stat.isFile || stat.isSymlink) {
            return {
                kind,
                code: "non_file_source",
                message: `Legacy domain-language source is not a regular file: ${path}`,
                sourcePath: path,
            };
        }
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) {
            return {
                kind,
                code: "source_missing",
                message: `Legacy domain-language source disappeared before migration: ${path}`,
                sourcePath: path,
            };
        }
        return {
            kind,
            code: "filesystem_error",
            message: `Could not inspect legacy domain-language source ${path}: ${
                error instanceof Error ? error.message : String(error)
            }`,
            sourcePath: path,
        };
    }
    return undefined;
}

async function preflightPair(
    kind: DomainLanguageMigrationKind,
    pair: MigrationFilePair,
): Promise<DomainLanguageMigrationWarning | undefined> {
    const sourceWarning = await assertPlainFile(kind, pair.sourcePath);
    if (sourceWarning) return sourceWarning;
    try {
        if (await pathExists(pair.destinationPath)) {
            return {
                kind,
                code: "destination_conflict",
                message:
                    `Canonical domain-language destination already exists and will not be overwritten: ${pair.destinationPath}`,
                sourcePath: pair.sourcePath,
                destinationPath: pair.destinationPath,
            };
        }
    } catch (error) {
        return {
            kind,
            code: "filesystem_error",
            message: `Could not inspect canonical domain-language destination ${pair.destinationPath}: ${
                error instanceof Error ? error.message : String(error)
            }`,
            sourcePath: pair.sourcePath,
            destinationPath: pair.destinationPath,
        };
    }
    return undefined;
}

function displayPath(projectRoot: string, path: string): string {
    const relativePath = relative(projectRoot, path);
    return relativePath.startsWith("..") ? path : relativePath || ".";
}

async function moveTextFileSafely(pair: MigrationFilePair, content: string): Promise<void> {
    await Deno.mkdir(dirname(pair.destinationPath), { recursive: true });
    await Deno.writeTextFile(pair.destinationPath, content, { createNew: true });
    await Deno.remove(pair.sourcePath);
}

export async function migrateDomainLanguageArtifacts(projectRoot = getCwd()): Promise<DomainLanguageMigrationResult> {
    const root = resolve(projectRoot);
    const result = emptyResult();
    mergeResult(result, await migrateSingleContextDomainLanguage(root));
    mergeResult(result, await migrateMultiContextDomainLanguage(root));
    return result;
}

async function migrateSingleContextDomainLanguage(projectRoot: string): Promise<DomainLanguageMigrationResult> {
    const result = emptyResult();
    const exactName = await findExactEntryName(projectRoot, LEGACY_DOMAIN_LANGUAGE_NAMES.singleContext);
    if (!exactName) return result;

    const pair = {
        sourcePath: join(projectRoot, exactName),
        destinationPath: join(projectRoot, DOMAIN_LANGUAGE_PATHS.singleContext),
    };
    const warning = await preflightPair("single-context", pair);
    if (warning) {
        result.warnings.push(warning);
        return result;
    }

    try {
        const content = await Deno.readTextFile(pair.sourcePath);
        await moveTextFileSafely(pair, content);
        result.notices.push({
            kind: "single-context",
            message: `Migrated legacy domain language ${displayPath(projectRoot, pair.sourcePath)} to ${
                displayPath(projectRoot, pair.destinationPath)
            }.`,
            sourcePath: pair.sourcePath,
            destinationPath: pair.destinationPath,
        });
    } catch (error) {
        result.warnings.push({
            kind: "single-context",
            code: "filesystem_error",
            message: `Could not migrate legacy domain language ${pair.sourcePath}: ${
                error instanceof Error ? error.message : String(error)
            }`,
            sourcePath: pair.sourcePath,
            destinationPath: pair.destinationPath,
        });
    }

    return result;
}

function isInsideProject(projectRoot: string, path: string): boolean {
    const relativePath = relative(projectRoot, path);
    return relativePath === "" || (!relativePath.startsWith("..") && !normalize(relativePath).startsWith("/"));
}

function splitTarget(target: string): { pathPart: string; suffix: string } {
    const hashIndex = target.indexOf("#");
    if (hashIndex === -1) return { pathPart: target, suffix: "" };
    return { pathPart: target.slice(0, hashIndex), suffix: target.slice(hashIndex) };
}

function rewriteLocalTarget(target: string): string {
    const { pathPart, suffix } = splitTarget(target);
    const lastSlash = pathPart.lastIndexOf("/");
    const prefix = lastSlash === -1 ? "" : pathPart.slice(0, lastSlash + 1);
    return `${prefix}${DOMAIN_LANGUAGE_PATHS.perContextGlossary}${suffix}`;
}

function extractInlineLinkTarget(linkTail: string): string | undefined {
    const trimmed = linkTail.trim();
    if (!trimmed) return undefined;
    if (trimmed.startsWith("<")) {
        const closeIndex = trimmed.indexOf(">", 1);
        if (closeIndex === -1) return undefined;
        return trimmed.slice(1, closeIndex);
    }
    const match = trimmed.match(/^([^\s)]+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*$/);
    return match?.[1];
}

function replaceInlineLinkTarget(fullText: string, oldTarget: string, newTarget: string): string {
    const openParenIndex = fullText.lastIndexOf("(");
    const before = fullText.slice(0, openParenIndex + 1);
    const tail = fullText.slice(openParenIndex + 1, -1);
    if (tail.trimStart().startsWith("<")) {
        return `${before}${tail.replace(`<${oldTarget}>`, `<${newTarget}>`)})`;
    }
    return `${before}${tail.replace(oldTarget, newTarget)})`;
}

function parseLegacyMapLinks(
    projectRoot: string,
    mapPath: string,
    content: string,
): ParsedMapLink[] | DomainLanguageMigrationWarning {
    const links: ParsedMapLink[] = [];
    const linkPattern = /!?\[[^\]\n]*\]\(([^\n()]*)\)/g;
    for (const match of content.matchAll(linkPattern)) {
        const fullText = match[0];
        const target = extractInlineLinkTarget(match[1]);
        if (!target) continue;
        if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//")) continue;
        const { pathPart } = splitTarget(target);
        if (pathPart.split("/").at(-1) !== LEGACY_DOMAIN_LANGUAGE_NAMES.singleContext) continue;
        const sourcePath = resolve(dirname(mapPath), pathPart);
        if (!isInsideProject(projectRoot, sourcePath)) {
            return {
                kind: "multi-context-map",
                code: "unsupported_map_link",
                message: `Legacy domain-language map link escapes the project root and will not be migrated: ${target}`,
                sourcePath: mapPath,
            };
        }
        const storedName = pathPart.split("/").at(-1);
        if (storedName !== LEGACY_DOMAIN_LANGUAGE_NAMES.singleContext) continue;
        links.push({
            fullText,
            target,
            rewrittenTarget: rewriteLocalTarget(target),
            sourcePath,
            destinationPath: join(dirname(sourcePath), DOMAIN_LANGUAGE_PATHS.perContextGlossary),
        });
    }

    if (content.includes(LEGACY_DOMAIN_LANGUAGE_NAMES.singleContext) && links.length === 0) {
        return {
            kind: "multi-context-map",
            code: "unsupported_map_link",
            message: "Legacy domain-language map mentions CONTEXT.md without a supported local Markdown link.",
            sourcePath: mapPath,
        };
    }

    return links;
}

function rewriteMapContent(content: string, links: ParsedMapLink[]): string {
    let rewritten = content;
    for (const link of links) {
        rewritten = rewritten.replace(
            link.fullText,
            replaceInlineLinkTarget(link.fullText, link.target, link.rewrittenTarget),
        );
    }
    return rewritten;
}

async function migrateMultiContextDomainLanguage(projectRoot: string): Promise<DomainLanguageMigrationResult> {
    const result = emptyResult();
    const exactName = await findExactEntryName(projectRoot, LEGACY_DOMAIN_LANGUAGE_NAMES.multiContextMap);
    if (!exactName) return result;

    const mapPair = {
        sourcePath: join(projectRoot, exactName),
        destinationPath: join(projectRoot, DOMAIN_LANGUAGE_PATHS.multiContextMap),
    };
    const mapWarning = await preflightPair("multi-context-map", mapPair);
    if (mapWarning) {
        result.warnings.push(mapWarning);
        return result;
    }

    let mapContent = "";
    try {
        mapContent = await Deno.readTextFile(mapPair.sourcePath);
    } catch (error) {
        result.warnings.push({
            kind: "multi-context-map",
            code: "filesystem_error",
            message: `Could not read legacy domain-language map ${mapPair.sourcePath}: ${
                error instanceof Error ? error.message : String(error)
            }`,
            sourcePath: mapPair.sourcePath,
            destinationPath: mapPair.destinationPath,
        });
        return result;
    }

    const parsedLinks = parseLegacyMapLinks(projectRoot, mapPair.sourcePath, mapContent);
    if (!Array.isArray(parsedLinks)) {
        result.warnings.push(parsedLinks);
        return result;
    }

    const uniquePairs = new Map<string, MigrationFilePair>();
    for (const link of parsedLinks) uniquePairs.set(link.sourcePath, link);
    for (const pair of uniquePairs.values()) {
        const warning = await preflightPair("multi-context-map", pair);
        if (warning) {
            result.warnings.push(warning);
            return result;
        }
    }

    try {
        const glossaryContents = new Map<string, string>();
        for (const pair of uniquePairs.values()) {
            glossaryContents.set(pair.sourcePath, await Deno.readTextFile(pair.sourcePath));
        }
        const rewrittenMap = rewriteMapContent(mapContent, parsedLinks);
        await Deno.mkdir(dirname(mapPair.destinationPath), { recursive: true });
        await Deno.writeTextFile(mapPair.destinationPath, rewrittenMap, { createNew: true });
        for (const pair of uniquePairs.values()) {
            await Deno.writeTextFile(pair.destinationPath, glossaryContents.get(pair.sourcePath) || "", {
                createNew: true,
            });
        }
        for (const pair of uniquePairs.values()) await Deno.remove(pair.sourcePath);
        await Deno.remove(mapPair.sourcePath);
        result.notices.push({
            kind: "multi-context-map",
            message: `Migrated legacy domain-language map ${displayPath(projectRoot, mapPair.sourcePath)} to ${
                displayPath(projectRoot, mapPair.destinationPath)
            }.`,
            sourcePath: mapPair.sourcePath,
            destinationPath: mapPair.destinationPath,
        });
    } catch (error) {
        result.warnings.push({
            kind: "multi-context-map",
            code: "filesystem_error",
            message: `Could not migrate legacy domain-language map ${mapPair.sourcePath}: ${
                error instanceof Error ? error.message : String(error)
            }`,
            sourcePath: mapPair.sourcePath,
            destinationPath: mapPair.destinationPath,
        });
    }

    return result;
}

export function formatDomainLanguageMigrationMessages(result: DomainLanguageMigrationResult): string[] {
    return [
        ...result.notices.map((notice) => `[RunWield] ${notice.message}`),
        ...result.warnings.map((warning) => `[RunWield] ${warning.message}`),
    ];
}
