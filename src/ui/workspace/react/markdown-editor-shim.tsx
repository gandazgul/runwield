// @ts-nocheck: shim for the Plannotator MarkdownEditor package in Workspace builds.

import { useEffect, useImperativeHandle, useRef, useState } from "react";
import "./markdown-editor-shim.css";

export function MarkdownEditor({ markdown, editorHandleRef, onMarkdownChange, cardClassName }) {
    const [value, setValue] = useState(markdown || "");
    const textRef = useRef(null);

    useImperativeHandle(editorHandleRef, () => ({
        getMarkdown: () => value,
        focus: () => textRef.current?.focus?.(),
    }), [value]);

    useEffect(() => {
        setValue(markdown || "");
    }, [markdown]);

    return (
        <div className={`rw-plannotator-markdown-editor ${cardClassName || ""}`}>
            <textarea
                ref={textRef}
                value={value}
                onChange={(event) => {
                    setValue(event.target.value);
                    onMarkdownChange?.(event.target.value);
                }}
                aria-label="Plan markdown editor"
            />
        </div>
    );
}
