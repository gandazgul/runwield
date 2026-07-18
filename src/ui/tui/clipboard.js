/**
 * @module ui/tui/clipboard
 * Terminal UI integration for reading images from the system clipboard.
 */

const defaultClipboardDeps = {
    os: Deno.build.os,
    Command: Deno.Command,
    makeTempFile: Deno.makeTempFile,
    remove: Deno.remove,
};

/** @type {typeof defaultClipboardDeps} */
let clipboardDeps = defaultClipboardDeps;

/**
 * Check whether the clipboard currently contains a PNG image.
 * Currently only implemented for macOS via AppleScript.
 *
 * @returns {Promise<boolean>}
 */
export async function hasClipboardImage() {
    if (clipboardDeps.os !== "darwin") {
        // Silently skip on non-macOS platforms for now
        return false;
    }

    const checkCmd = new clipboardDeps.Command("osascript", {
        args: [
            "-e",
            `try
        the clipboard as «class PNGf»
        return "image"
      on error
        return "none"
      end try`,
        ],
    });

    const checkRes = await checkCmd.output();
    const checkOutput = new TextDecoder().decode(checkRes.stdout).trim();

    return checkOutput === "image";
}

/**
 * Check if the clipboard contains an image, and if so, return it as base64.
 * Currently only implemented for macOS via AppleScript.
 *
 * @returns {Promise<{ base64: string, mimeType: string } | null>}
 */
export async function readClipboardImage() {
    if (!await hasClipboardImage()) {
        return null;
    }

    // 2. Extract the image to a temporary file
    const tempFile = await clipboardDeps.makeTempFile({
        prefix: "runwield-clipboard-",
        suffix: ".png",
    });

    const extractCmd = new clipboardDeps.Command("osascript", {
        args: [
            "-e",
            `set tempFile to "${tempFile}"
      set theImage to the clipboard as «class PNGf»
      set theFile to open for access POSIX file tempFile with write permission
      write theImage to theFile
      close access theFile`,
        ],
    });

    const extractRes = await extractCmd.output();
    if (!extractRes.success) {
        // Cleanup and return null if extraction failed
        try {
            await clipboardDeps.remove(tempFile);
        } catch (_e) { /* ignore */ }
        return null;
    }

    // 3. Read the image and base64 encode it
    try {
        const base64Cmd = new clipboardDeps.Command("base64", { args: ["-i", tempFile] });
        const base64Res = await base64Cmd.output();
        if (base64Res.success) {
            const base64Data = new TextDecoder().decode(base64Res.stdout).replace(
                /\s+/g,
                "",
            );
            return {
                base64: base64Data,
                mimeType: "image/png",
            };
        }
    } catch (_err) {
        // Ignore error
    } finally {
        // Cleanup
        try {
            await clipboardDeps.remove(tempFile);
        } catch (_e) { /* ignore */ }
    }

    return null;
}

/**
 * Override clipboard boundary dependencies for tests.
 *
 * @param {Partial<typeof defaultClipboardDeps>} [deps]
 */
export function __setClipboardDepsForTest(deps = {}) {
    clipboardDeps = { ...defaultClipboardDeps, ...deps };
}
