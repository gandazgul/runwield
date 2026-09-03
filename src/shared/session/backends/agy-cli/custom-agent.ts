import { join } from "@std/path";
import { getHomeDir } from "../../../../constants.js";

export interface AgyCustomAgentPaths {
    agentsRootPath: string;
    definitionPath: string;
}

export interface AgyCustomAgentOwnership {
    name: string;
    definition: string;
    agentsRootPath: string;
    definitionPath: string;
    createdDefinition: boolean;
}

export function assertRunWieldAgentName(name: string): void {
    if (!/^runwield-[A-Za-z0-9._-]+$/.test(name)) {
        throw new Error("Agy custom agent name must match runwield-* and contain no path separators");
    }
}

export function resolveAgyCustomAgentPaths(name: string): AgyCustomAgentPaths {
    assertRunWieldAgentName(name);
    const agentsRootPath = join(getHomeDir(), ".gemini", "config", "agents");
    return { agentsRootPath, definitionPath: join(agentsRootPath, `${name}.md`) };
}

async function lstatOrNull(path: string): Promise<Deno.FileInfo | null> {
    try {
        return await Deno.lstat(path);
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) return null;
        throw error;
    }
}

export async function materializeAgyCustomAgent(
    name: string,
    definition: string,
): Promise<AgyCustomAgentOwnership> {
    const trimmedDefinition = definition.trim();
    if (!trimmedDefinition) throw new Error("Agy custom agent definition is required");
    const paths = resolveAgyCustomAgentPaths(name);
    const existingRoot = await lstatOrNull(paths.agentsRootPath);
    if (existingRoot?.isSymlink) throw new Error(`Refusing symbolic link agents directory: ${paths.agentsRootPath}`);
    if (existingRoot && !existingRoot.isDirectory) {
        throw new Error(`Agy agents path is not a directory: ${paths.agentsRootPath}`);
    }
    await Deno.mkdir(paths.agentsRootPath, { recursive: true, mode: 0o700 });
    try {
        await Deno.chmod(paths.agentsRootPath, 0o700);
    } catch {
        // Best effort on platforms without chmod support.
    }

    const existingDefinition = await lstatOrNull(paths.definitionPath);
    if (existingDefinition?.isSymlink) {
        throw new Error(`Refusing symbolic link agent definition: ${paths.definitionPath}`);
    }
    if (existingDefinition) {
        if (!existingDefinition.isFile) {
            throw new Error(`Agy custom agent definition path is not a file: ${paths.definitionPath}`);
        }
        const existingText = await Deno.readTextFile(paths.definitionPath);
        if (existingText !== definition) {
            throw new Error(`Agy custom agent already exists with different content: ${paths.definitionPath}`);
        }
        return {
            name,
            definition,
            agentsRootPath: paths.agentsRootPath,
            definitionPath: paths.definitionPath,
            createdDefinition: false,
        };
    }

    await Deno.writeTextFile(paths.definitionPath, definition, { createNew: true, mode: 0o600 });
    try {
        await Deno.chmod(paths.definitionPath, 0o600);
    } catch {
        // Best effort on platforms without chmod support.
    }
    return {
        name,
        definition,
        agentsRootPath: paths.agentsRootPath,
        definitionPath: paths.definitionPath,
        createdDefinition: true,
    };
}

export async function cleanupAgyCustomAgent(ownership: AgyCustomAgentOwnership): Promise<void> {
    if (!ownership.createdDefinition) return;
    const definitionInfo = await lstatOrNull(ownership.definitionPath);
    if (!definitionInfo) return;
    if (definitionInfo.isSymlink || !definitionInfo.isFile) {
        throw new Error(
            `Refusing cleanup because agent definition is no longer the owned file: ${ownership.definitionPath}`,
        );
    }
    const currentText = await Deno.readTextFile(ownership.definitionPath);
    if (currentText !== ownership.definition) {
        throw new Error(`Refusing cleanup because agent definition changed: ${ownership.definitionPath}`);
    }
    await Deno.remove(ownership.definitionPath);
}
