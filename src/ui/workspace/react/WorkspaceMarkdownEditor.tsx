// @ts-nocheck: Workspace is the scoped TSX exception zone and Plannotator is consumed as browser-only UI.

import { MarkdownEditor } from "../../../../node_modules/@plannotator/markdown-editor/dist/index.js";
import "../../../../node_modules/@plannotator/markdown-editor/dist/styles/themes/plannotator.css";

function runWieldEditorMode() {
    const background = getComputedStyle(document.documentElement).getPropertyValue("--rw-page-bg").trim();
    const match = /^#([0-9a-f]{6})$/i.exec(background);
    if (!match) return "dark";
    const value = Number.parseInt(match[1], 16);
    const red = (value >> 16) & 0xff;
    const green = (value >> 8) & 0xff;
    const blue = value & 0xff;
    const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
    return luminance > 0.55 ? "light" : "dark";
}

export default function WorkspaceMarkdownEditor({ markdown, documentId, editorHandleRef, onMarkdownChange }) {
    return (
        <MarkdownEditor
            markdown={markdown || ""}
            documentId={documentId}
            editorHandleRef={editorHandleRef}
            mode={runWieldEditorMode()}
            maxWidth={null}
            onMarkdownChange={onMarkdownChange}
            className="rw-workspace-markdown-editor"
        />
    );
}
