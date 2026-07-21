import { renderMermaidASCII } from "beautiful-mermaid";
import { Markdown, visibleWidth } from "@earendil-works/pi-tui";

const MERMAID_RENDER_OPTIONS = Object.freeze({
    useAscii: false,
    colorMode: "none",
    paddingX: 1,
    paddingY: 1,
    boxBorderPadding: 0,
});

/** @typedef {import('@earendil-works/pi-tui').MarkdownTheme} MarkdownTheme */
/** @typedef {import('@earendil-works/pi-tui').DefaultTextStyle} DefaultTextStyle */
/** @typedef {import('@earendil-works/pi-tui').MarkdownOptions} MarkdownOptions */

/**
 * @typedef {Object} MermaidMarkdownOptions
 * @property {(source: string) => string} [renderMermaid]
 */

/**
 * @typedef {Object} CachedMermaidSuccess
 * @property {'success'} status
 * @property {string[]} lines
 */

/**
 * @typedef {Object} CachedMermaidFailure
 * @property {'failure'} status
 */

/** @typedef {CachedMermaidSuccess | CachedMermaidFailure} CachedMermaidResult */

/** @param {string} lang */
function normalizeFenceLanguage(lang) {
    return lang.trim().toLowerCase();
}

/** @param {string} raw */
function isCompletedBacktickFence(raw) {
    const opening = raw.match(/^(`{3,})[^\n]*(?:\n|$)/);
    if (!opening) return false;

    const markerLength = opening[1].length;
    const lines = raw.split(/\r?\n/);
    for (let i = lines.length - 1; i > 0; i--) {
        const line = lines[i];
        if (line.trim() === "") continue;
        const closing = line.match(/^(`{3,})\s*$/);
        return Boolean(closing && closing[1].length >= markerLength);
    }
    return false;
}

/** @param {string[]} lines */
function trimOuterBlankLines(lines) {
    let start = 0;
    let end = lines.length;
    while (start < end && lines[start].trim() === "") start++;
    while (end > start && lines[end - 1].trim() === "") end--;
    return lines.slice(start, end);
}

/**
 * Markdown adapter that renders completed top-level Mermaid fences as compact
 * Unicode diagrams when they fit, otherwise preserving upstream Markdown output.
 */
const RuntimeMarkdown = /** @type {any} */ (Markdown);

export class MermaidMarkdown extends RuntimeMarkdown {
    /**
     * @param {string} text
     * @param {number} paddingX
     * @param {number} paddingY
     * @param {MarkdownTheme} theme
     * @param {DefaultTextStyle} [defaultTextStyle]
     * @param {MarkdownOptions} [options]
     * @param {MermaidMarkdownOptions} [mermaidOptions]
     */
    constructor(text, paddingX, paddingY, theme, defaultTextStyle, options, mermaidOptions = {}) {
        super(text, paddingX, paddingY, theme, defaultTextStyle, options);
        /** @type {MarkdownTheme} */
        this.markdownTheme = theme;
        this.renderDepth = 0;
        /** @type {Map<string, CachedMermaidResult>} */
        this.mermaidCache = new Map();
        this.renderMermaid = mermaidOptions.renderMermaid ||
            ((source) => renderMermaidASCII(source, MERMAID_RENDER_OPTIONS));
    }

    /**
     * Override pi-tui's private runtime seam. Keep this localized so a future
     * upstream signature change fails in this adapter's tests instead of
     * spreading Markdown renderer knowledge through the TUI.
     *
     * @param {any} token
     * @param {number} width
     * @param {string | undefined} nextTokenType
     * @param {any} styleContext
     * @returns {string[]}
     */
    renderToken(token, width, nextTokenType, styleContext) {
        if (this.renderDepth === 0) {
            const mermaidLines = this.renderMermaidToken(token, width, nextTokenType);
            if (mermaidLines) return mermaidLines;
        }

        this.renderDepth++;
        try {
            return /** @type {any} */ (Markdown.prototype).renderToken.call(
                this,
                token,
                width,
                nextTokenType,
                styleContext,
            );
        } finally {
            this.renderDepth--;
        }
    }

    /**
     * @param {any} token
     * @param {number} width
     * @param {string | undefined} nextTokenType
     * @returns {string[] | null}
     */
    renderMermaidToken(token, width, nextTokenType) {
        if (!this.isEligibleMermaidToken(token)) return null;

        const source = token.text;
        const cached = this.getCachedMermaidResult(source);
        if (cached.status === "failure") return null;

        const indent = this.markdownTheme.codeBlockIndent ?? "  ";
        const linesFit = cached.lines.every((line) => line.trim() === "" || visibleWidth(`${indent}${line}`) <= width);
        if (!linesFit) return null;

        const rendered = cached.lines.map((line) => `${indent}${this.markdownTheme.codeBlock(line)}`);
        if (nextTokenType && nextTokenType !== "space") rendered.push("");
        return rendered;
    }

    /**
     * @param {any} token
     * @returns {boolean}
     */
    isEligibleMermaidToken(token) {
        return token?.type === "code" &&
            typeof token.text === "string" &&
            token.text.trim() !== "" &&
            typeof token.raw === "string" &&
            typeof token.lang === "string" &&
            normalizeFenceLanguage(token.lang) === "mermaid" &&
            isCompletedBacktickFence(token.raw);
    }

    /**
     * @param {string} source
     * @returns {CachedMermaidResult}
     */
    getCachedMermaidResult(source) {
        const cached = this.mermaidCache.get(source);
        if (cached) return cached;

        try {
            const rendered = this.renderMermaid(source);
            if (typeof rendered !== "string") {
                const failure = /** @type {CachedMermaidFailure} */ ({ status: "failure" });
                this.mermaidCache.set(source, failure);
                return failure;
            }

            const lines = trimOuterBlankLines(rendered.replace(/\r\n/g, "\n").split("\n"));
            if (lines.length === 0 || lines.every((line) => line.trim() === "")) {
                const failure = /** @type {CachedMermaidFailure} */ ({ status: "failure" });
                this.mermaidCache.set(source, failure);
                return failure;
            }

            const success = /** @type {CachedMermaidSuccess} */ ({ status: "success", lines });
            this.mermaidCache.set(source, success);
            return success;
        } catch (_error) {
            const failure = /** @type {CachedMermaidFailure} */ ({ status: "failure" });
            this.mermaidCache.set(source, failure);
            return failure;
        }
    }
}
