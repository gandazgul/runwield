import { DELIMITER, join, resolve } from "@std/path";
import { getCwd, getHomeDir } from "../../constants.js";

async function isExecutableFile(path: string): Promise<boolean> {
    try {
        const info = await Deno.stat(path);
        return info.isFile && (Deno.build.os === "windows" || (info.mode !== null && (info.mode & 0o111) !== 0));
    } catch (error) {
        if (error instanceof Deno.errors.NotFound || error instanceof Deno.errors.NotADirectory) return false;
        // Permission failures are not absence: report them rather than bypassing them with another installation.
        throw error;
    }
}

/** Resolve without starting Codex, changing PATH, or reading its credentials. */
export async function resolveCodexExecutable(): Promise<string> {
    const filenames = Deno.build.os === "windows" ? ["codex.exe", "codex.cmd", "codex.bat", "codex"] : ["codex"];
    const path = Deno.env.get("PATH");
    for (const directory of path === undefined ? [] : path.split(DELIMITER)) {
        for (const filename of filenames) {
            const candidate = resolve(getCwd(), directory, filename);
            if (await isExecutableFile(candidate)) return candidate;
        }
    }
    const bundledPaths = Deno.build.os === "darwin"
        ? [join(getHomeDir(), "Applications"), "/Applications"].map((directory) =>
            join(
                directory,
                "ChatGPT.app",
                "Contents",
                "Resources",
                "codex-cli",
                "CodexCLI.app",
                "Contents",
                "MacOS",
                "codex",
            )
        )
        : [];
    for (const candidate of bundledPaths) {
        if (await isExecutableFile(candidate)) return candidate;
    }
    throw new Error(
        `Codex executable not found: checked PATH${
            bundledPaths.length ? " and ChatGPT.app in ~/Applications and /Applications" : ""
        }. Install the Codex CLI on PATH${
            bundledPaths.length ? " or the ChatGPT desktop app in one of those locations" : ""
        }. No image generation was started.`,
    );
}
