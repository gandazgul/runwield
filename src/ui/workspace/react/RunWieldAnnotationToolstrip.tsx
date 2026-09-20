import { useLayoutEffect, useRef } from "react";
import { AnnotationToolstrip } from "@plannotator/ui/components/AnnotationToolstrip.tsx";
import { attachSegmentedSelection } from "../../design-system/components/react/RunWieldSegmentedControl.tsx";
import type { EditorMode, InputMethod } from "@plannotator/ui/types.ts";

type RunWieldAnnotationToolstripProps = {
    inputMethod: InputMethod;
    onInputMethodChange: (method: InputMethod) => void;
    mode: EditorMode;
    onModeChange: (mode: EditorMode) => void;
    taterMode?: boolean;
    compact?: boolean;
    showHelpLink?: boolean;
    iconOnly?: boolean;
    hideInputMethodSwitch?: boolean;
};

export function RunWieldAnnotationToolstrip(props: RunWieldAnnotationToolstripProps) {
    const wrapperRef = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        const wrapper = wrapperRef.current;
        if (!wrapper) return;

        const groups = wrapper.querySelectorAll<HTMLDivElement>("div > div:has(> button[aria-pressed])");
        const cleanups = Array.from(groups, (group) => {
            group.classList.add("rw-segmented-toggle");
            return attachSegmentedSelection(group);
        });

        const buttons = wrapper.querySelectorAll<HTMLButtonElement>("button[aria-pressed]");
        for (const button of buttons) {
            const label = button.querySelector<HTMLSpanElement>("span:not([aria-hidden])")?.textContent?.trim();
            if (!label) continue;
            button.title = label;
            button.setAttribute("aria-label", label);
        }
        return () => cleanups.forEach((cleanup) => cleanup());
    }, []);

    return (
        <div ref={wrapperRef} className="rw-plannotator-annotation-toolstrip">
            <AnnotationToolstrip {...props} />
        </div>
    );
}
