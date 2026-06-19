/**
 * @module shared/session/image-attachments
 * Helpers for session-scoped image attachments and vision fallback routing.
 */

import { basename, extname, isAbsolute, join, normalize, relative, resolve } from "@std/path";
import { discoverProviderModel, getModelRegistry } from "../models/model-registry.js";
import { parseProviderModel } from "../models/model-validation.js";
import { getResolvedVisionFallbackModelSetting } from "../settings.js";
import { getHarnsSessionDir } from "./root-session.js";

export const IMAGE_FALLBACK_BLOCK_MESSAGE =
    "Cannot attach image: current model does not support vision and no visionFallback.model is configured.\nSee docs/settings.md#visionfallback to configure an image fallback model.";

const MIME_TO_EXT = new Map([
    ["image/png", ".png"],
    ["image/jpeg", ".jpg"],
    ["image/jpg", ".jpg"],
    ["image/gif", ".gif"],
    ["image/webp", ".webp"],
]);

const EXT_TO_MIME = new Map([
    [".png", "image/png"],
    [".jpg", "image/jpeg"],
    [".jpeg", "image/jpeg"],
    [".gif", "image/gif"],
    [".webp", "image/webp"],
]);

/** @param {unknown} model */
export function modelSupportsImageInput(model) {
    const input = /** @type {{ input?: unknown }} */ (model || {}).input;
    return Array.isArray(input) && input.includes("image");
}

/**
 * @param {string} mimeType
 * @returns {string}
 */
export function extensionForMimeType(mimeType) {
    const ext = MIME_TO_EXT.get(String(mimeType || "").toLowerCase());
    if (!ext) throw new Error(`Unsupported image MIME type: ${mimeType}`);
    return ext;
}

/**
 * @param {string} filePath
 * @returns {string}
 */
export function mimeTypeForImagePath(filePath) {
    const mimeType = EXT_TO_MIME.get(extname(filePath).toLowerCase());
    if (!mimeType) throw new Error(`Unsupported image file type: ${filePath}`);
    return mimeType;
}

/**
 * @param {import('@earendil-works/pi-coding-agent').SessionManager | undefined} sessionManager
 * @param {string} cwd
 * @returns {string}
 */
export function getSessionImageDir(sessionManager, cwd) {
    if (!sessionManager || typeof sessionManager.getSessionId !== "function") {
        throw new Error("Cannot persist image attachment: no active session is available.");
    }
    return join(getHarnsSessionDir(cwd), `${sessionManager.getSessionId()}_images`);
}

/**
 * @param {{ base64: string, mimeType: string }} image
 * @param {import('@earendil-works/pi-coding-agent').SessionManager | undefined} sessionManager
 * @param {string} cwd
 * @returns {Promise<import('./types.js').ImageAttachment>}
 */
export async function persistImageAttachment(image, sessionManager, cwd) {
    const ext = extensionForMimeType(image.mimeType);
    const uuid = crypto.randomUUID();
    const dir = getSessionImageDir(sessionManager, cwd);
    await Deno.mkdir(dir, { recursive: true });
    const path = join(dir, `${uuid}${ext}`);
    const bytes = Uint8Array.from(atob(image.base64), (char) => char.charCodeAt(0));
    await Deno.writeFile(path, bytes);
    return { ...image, ref: `attachment:${uuid}`, path };
}

/**
 * @param {string} imageRef
 * @returns {string | null}
 */
function parseAttachmentRef(imageRef) {
    const match = /^attachment:([0-9a-fA-F-]{32,36})$/.exec(imageRef.trim());
    return match ? match[1] : null;
}

/**
 * @param {string} imageRef
 * @param {{ sessionManager?: import('@earendil-works/pi-coding-agent').SessionManager, cwd: string }} opts
 * @returns {Promise<{ path: string, mimeType: string, refType: "attachment" | "local" }>}
 */
export async function resolveImageRef(imageRef, opts) {
    const ref = String(imageRef || "").trim();
    if (!ref) throw new Error("imageRef is required.");

    const attachmentUuid = parseAttachmentRef(ref);
    if (attachmentUuid) {
        const dir = getSessionImageDir(opts.sessionManager, opts.cwd);
        for (const ext of EXT_TO_MIME.keys()) {
            const candidate = join(dir, `${attachmentUuid}${ext}`);
            try {
                const stat = await Deno.stat(candidate);
                if (stat.isFile) {
                    return { path: candidate, mimeType: mimeTypeForImagePath(candidate), refType: "attachment" };
                }
            } catch (_e) { /* try next extension */ }
        }
        throw new Error(`Image attachment not found in this session: ${ref}`);
    }

    if (ref.startsWith("attachment:")) throw new Error(`Invalid image attachment reference: ${ref}`);
    if (isAbsolute(ref)) throw new Error("Local image paths must be project-relative.");

    const cleaned = ref.startsWith("@") ? ref.slice(1) : ref;
    const normalized = normalize(cleaned);
    if (normalized.startsWith("..") || normalized === ".." || isAbsolute(normalized)) {
        throw new Error("Local image path escapes the project directory.");
    }

    const root = resolve(opts.cwd);
    const path = resolve(root, normalized);
    const rel = relative(root, path);
    if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("Local image path escapes the project directory.");

    const stat = await Deno.stat(path).catch(() => null);
    if (!stat?.isFile) throw new Error(`Image file not found: ${cleaned}`);
    return { path, mimeType: mimeTypeForImagePath(path), refType: "local" };
}

/** @param {import('./types.js').ImageAttachment} image */
export function formatImageAttachmentMarker(image) {
    const ref = image.ref || (image.path ? basename(image.path) : "unpersisted-image");
    return `[Image attached: ${ref} ${image.mimeType}]`;
}

/**
 * @param {{ text: string, images?: import('./types.js').ImageAttachment[], activeModel?: unknown, fallbackModelRef?: string }} opts
 * @returns {{ ok: true, text: string, images: Array<{ type: "image", data: string, mimeType: string }> | undefined, mode: "direct" | "fallback" | "none" } | { ok: false, message: string }}
 */
export function prepareImagesForModel(opts) {
    const images = opts.images || [];
    if (images.length === 0) return { ok: true, text: opts.text, images: undefined, mode: "none" };
    if (modelSupportsImageInput(opts.activeModel)) {
        return {
            ok: true,
            text: opts.text,
            images: images.map((img) => ({ type: "image", data: img.base64, mimeType: img.mimeType })),
            mode: "direct",
        };
    }
    if (opts.fallbackModelRef) {
        const markers = images.map(formatImageAttachmentMarker).join("\n");
        return { ok: true, text: `${opts.text}\n\n${markers}`, images: undefined, mode: "fallback" };
    }
    return { ok: false, message: IMAGE_FALLBACK_BLOCK_MESSAGE };
}

/**
 * @param {import('./types.js').ImageAttachment[]} images
 * @param {{ activeModel?: unknown, fallbackModelRef?: string }} opts
 * @returns {{ ok: true, warning?: string, mode: "direct" | "fallback" | "none" } | { ok: false, message: string }}
 */
export function preflightImageAttachments(images, opts) {
    if (!images || images.length === 0) return { ok: true, mode: "none" };
    if (modelSupportsImageInput(opts.activeModel)) return { ok: true, mode: "direct" };
    if (opts.fallbackModelRef) {
        return {
            ok: true,
            mode: "fallback",
            warning:
                `Current model does not support vision. Images will be described using visionFallback.model: ${opts.fallbackModelRef}.`,
        };
    }
    return { ok: false, message: IMAGE_FALLBACK_BLOCK_MESSAGE };
}

/**
 * @param {any} [modelRegistry]
 * @returns {Promise<{ model: any, modelRef: string } | undefined>}
 */
export async function resolveVisionFallbackModel(modelRegistry = getModelRegistry()) {
    const configured = getResolvedVisionFallbackModelSetting();
    if (!configured) return undefined;

    const parsed = parseProviderModel(configured);
    if (!parsed.ok) throw new Error(`Invalid visionFallback.model: ${configured}. Use provider/id.`);

    let found = modelRegistry.find(parsed.provider, parsed.id);
    if (!found) {
        try {
            // The fallback model is explicitly configured for vision, so register
            // discovered models with image input even though /models can't report it.
            found = await discoverProviderModel(modelRegistry, parsed.provider, parsed.id, {
                input: ["text", "image"],
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Unknown visionFallback.model: ${configured}. ${message}`);
        }
    }
    if (!found) throw new Error(`Unknown visionFallback.model: ${configured}`);
    if (!modelRegistry.hasConfiguredAuth(found)) {
        throw new Error(`No API key configured for visionFallback.model: ${configured}`);
    }
    if (!modelSupportsImageInput(found)) throw new Error(`visionFallback.model is not vision-capable: ${configured}`);
    return { model: found, modelRef: `${found.provider}/${found.id}` };
}
