import { fromFileUrl, join } from "@std/path";

// Only the executable contents are shared. Every fixture has its own command
// paths and logs; PATH still changes so production availability checks run.
const EXECUTABLE = fromFileUrl(new URL("./workflow-binary-fixture.sh", import.meta.url));
const BINARIES = ["mnemoteca", "cymbal", "ketch", "osascript"];

interface WorkflowBinaryFixtureOptions {
    githubUnavailable?: boolean;
}

/** Install only external boundaries used by the default workflow scenarios. */
export async function writeWorkflowBinaryFixtures(
    root: string,
    options: WorkflowBinaryFixtureOptions = {},
): Promise<string> {
    const binDir = join(root, "bin");
    await Deno.mkdir(binDir, { recursive: true });
    const names = options.githubUnavailable ? [...BINARIES, "gh"] : BINARIES;
    const script = Deno.build.os === "windows" ? await Deno.readTextFile(EXECUTABLE) : "";
    await Promise.all(names.map(async (name) => {
        const path = join(binDir, name);
        // Windows symlink creation can require privileges. Preserve the previous
        // independent-file behavior there without requiring Developer Mode.
        if (Deno.build.os === "windows") {
            const quotedBinDir = "'" + binDir.replaceAll("'", "'\\''") + "'";
            await Deno.writeTextFile(
                path,
                script
                    .replace("fixture_bin_dir=${0%/*}", `fixture_bin_dir=${quotedBinDir}`)
                    .replace("fixture_name=${0##*/}", `fixture_name='${name}'`),
            );
            await Deno.chmod(path, 0o755);
        } else {
            await Deno.symlink(EXECUTABLE, path);
        }
    }));
    return binDir;
}

/** Fail even if an optional external-call error was caught by the application. */
export async function assertWorkflowBinaryCallsSupported(root: string): Promise<void> {
    let unexpected = "";
    try {
        unexpected = await Deno.readTextFile(join(root, "bin", "unexpected.log"));
    } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    if (unexpected) throw new Error(unexpected.trim());
}
