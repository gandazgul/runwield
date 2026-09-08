import { join } from "@std/path";
import { getHomeDir } from "../../../../constants.js";

export interface AgyCustomAgentPaths {
    agentsRootPath: string;
    agentDirectoryPath: string;
    definitionPath: string;
}

export interface AgyCustomAgentOwnership {
    name: string;
    definition: string;
    agentsRootPath: string;
    agentDirectoryPath: string;
    definitionPath: string;
    createdAgentDirectory: boolean;
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
    const agentDirectoryPath = join(agentsRootPath, name);
    return { agentsRootPath, agentDirectoryPath, definitionPath: join(agentDirectoryPath, "agent.md") };
}

async function lstatOrNull(path: string): Promise<Deno.FileInfo | null> {
    try {
        return await Deno.lstat(path);
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) return null;
        throw error;
    }
}

async function chmodBestEffort(path: string, mode: number): Promise<void> {
    try {
        await Deno.chmod(path, mode);
    } catch {
        // Best effort on platforms without chmod support.
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
    await chmodBestEffort(paths.agentsRootPath, 0o700);

    const existingAgentDirectory = await lstatOrNull(paths.agentDirectoryPath);
    if (existingAgentDirectory?.isSymlink) {
        throw new Error(`Refusing symbolic link agent directory: ${paths.agentDirectoryPath}`);
    }
    if (existingAgentDirectory && !existingAgentDirectory.isDirectory) {
        throw new Error(`Agy custom agent path is not a directory: ${paths.agentDirectoryPath}`);
    }
    const createdAgentDirectory = !existingAgentDirectory;
    if (createdAgentDirectory) await Deno.mkdir(paths.agentDirectoryPath, { mode: 0o700 });
    await chmodBestEffort(paths.agentDirectoryPath, 0o700);

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
            agentDirectoryPath: paths.agentDirectoryPath,
            definitionPath: paths.definitionPath,
            createdAgentDirectory,
            createdDefinition: false,
        };
    }

    await Deno.writeTextFile(paths.definitionPath, definition, { createNew: true, mode: 0o600 });
    await chmodBestEffort(paths.definitionPath, 0o600);
    return {
        name,
        definition,
        agentsRootPath: paths.agentsRootPath,
        agentDirectoryPath: paths.agentDirectoryPath,
        definitionPath: paths.definitionPath,
        createdAgentDirectory,
        createdDefinition: true,
    };
}

export async function verifyAgyCustomAgentOwnership(ownership: AgyCustomAgentOwnership): Promise<void> {
    const directoryInfo = await lstatOrNull(ownership.agentDirectoryPath);
    if (!directoryInfo || directoryInfo.isSymlink || !directoryInfo.isDirectory) {
        throw new Error("Agy custom agent directory is missing or invalid");
    }
    const definitionInfo = await lstatOrNull(ownership.definitionPath);
    if (!definitionInfo || definitionInfo.isSymlink || !definitionInfo.isFile) {
        throw new Error("Agy custom agent definition is missing or invalid");
    }
    const currentText = await Deno.readTextFile(ownership.definitionPath);
    if (currentText !== ownership.definition) {
        throw new Error("Agy custom agent definition changed");
    }
}

export async function cleanupAgyCustomAgent(ownership: AgyCustomAgentOwnership): Promise<void> {
    if (ownership.createdDefinition) {
        const definitionInfo = await lstatOrNull(ownership.definitionPath);
        if (definitionInfo) {
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
    }

    if (!ownership.createdAgentDirectory) return;
    const directoryInfo = await lstatOrNull(ownership.agentDirectoryPath);
    if (!directoryInfo) return;
    if (directoryInfo.isSymlink || !directoryInfo.isDirectory) {
        throw new Error(
            `Refusing cleanup because agent directory is no longer the owned directory: ${ownership.agentDirectoryPath}`,
        );
    }
    for await (const _entry of Deno.readDir(ownership.agentDirectoryPath)) {
        throw new Error(`Refusing cleanup because agent directory changed: ${ownership.agentDirectoryPath}`);
    }
    await Deno.remove(ownership.agentDirectoryPath);
}
