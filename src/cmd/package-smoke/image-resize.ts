import { resizeImage } from "@earendil-works/pi-coding-agent";
import { encodeCreatedImage } from "../../shared/image-generation.ts";

/** Exercise the real worker and Photon WASM inside the packaged executable. */
export async function checkPackagedImageResize(): Promise<void> {
    // A four-by-two red PNG, small enough to keep the package check self-contained.
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAIAAADwyuo0AAAAEElEQVR4nGP4z8AARwzIHABvqgf5gNwAKAAAAABJRU5ErkJggg==";
    const bytes = Uint8Array.from(atob(png), (character) => character.charCodeAt(0));
    const result = await resizeImage(bytes, "image/png", { maxWidth: 2, maxHeight: 2 });
    if (
        !result?.wasResized || result.originalWidth !== 4 || result.originalHeight !== 2 ||
        result.width !== 2 || result.height !== 1 || !result.data
    ) {
        throw new Error("Packaged image resize did not resize the fixture from 4x2 to 2x1.");
    }
    const decoded = await resizeImage(
        Uint8Array.from(atob(result.data), (character) => character.charCodeAt(0)),
        result.mimeType,
    );
    if (!decoded || decoded.width !== 2 || decoded.height !== 1 || decoded.wasResized) {
        throw new Error("Packaged image resize produced an invalid image.");
    }
    // create_image uses Photon directly to honor the requested output extension.
    for (const mimeType of ["image/jpeg", "image/webp"]) {
        const encoded = encodeCreatedImage({ type: "image", data: png, mimeType: "image/png" }, mimeType);
        const preview = await resizeImage(encoded.bytes, mimeType);
        if (!preview || preview.width !== 4 || preview.height !== 2) {
            throw new Error(`Packaged create_image conversion failed for ${mimeType}.`);
        }
    }
}

if (import.meta.main) await checkPackagedImageResize();
