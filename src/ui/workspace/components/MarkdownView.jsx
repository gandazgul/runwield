// @ts-ignore — quikdown .d.ts uses CommonJS-style exports while the ESM runtime has a default export.
import quikdown from "quikdown";

/**
 * Render Plan markdown through the shared markdown renderer instead of custom HTML parsing.
 * quikdown escapes raw HTML and rewrites unsafe link protocols before this HTML is passed to React.
 * @param {{ markdown: string }} props
 */
export function MarkdownView({ markdown }) {
    const html = renderMarkdown(markdown || "");
    return html
        ? <div className="markdown-view" dangerouslySetInnerHTML={{ __html: html }} />
        : (
            <div className="markdown-view">
                <p className="empty">No Plan body content.</p>
            </div>
        );
}

/**
 * @param {string} markdown
 * @returns {string}
 */
export function renderMarkdown(markdown) {
    return String(quikdown(markdown || "")).trim();
}
