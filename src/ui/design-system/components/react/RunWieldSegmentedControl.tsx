import { useLayoutEffect, useRef } from "react";
import type { HTMLAttributes } from "react";

/** Share this adapter with imported controls that cannot use our React wrapper. */
export function attachSegmentedSelection(group: HTMLDivElement) {
    const update = () => {
        const buttons = Array.from(group.querySelectorAll<HTMLButtonElement>(":scope > button"));
        if (!buttons.length) return;
        const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
        const labelWidth = Math.max(
            ...buttons.map((button) => button.querySelector<HTMLElement>("span:not([aria-hidden])")?.scrollWidth ?? 0),
        );
        // Reserve the longest selection's footprint. Only its highlight moves.
        const width = Math.ceil(Math.min(labelWidth, 12 * rem) + (0.875 + 0.35 + 1.1) * rem + 2);
        group.style.setProperty("--rw-segmented-selection-width", `${width}px`);
        const active = buttons.find((button) =>
            button.matches('.active, [aria-pressed="true"], [aria-selected="true"]')
        );
        if (!active) {
            delete group.dataset.selectionReady;
            return;
        }
        group.style.setProperty("--rw-segmented-highlight-width", `${active.offsetWidth}px`);
        group.style.setProperty("--rw-segmented-selection-x", `${active.offsetLeft}px`);
        group.style.setProperty("--rw-segmented-selection-y", `${active.offsetTop}px`);
        group.style.setProperty("--rw-segmented-selection-height", `${active.offsetHeight}px`);
        group.dataset.selectionReady = "true";
    };
    update();
    const frame = requestAnimationFrame(() => group.dataset.selectionMotion = "true");
    const mutations = new MutationObserver(update);
    mutations.observe(group, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["class", "aria-pressed", "aria-selected"],
    });
    const resize = new ResizeObserver(update);
    resize.observe(group);
    document.fonts.addEventListener("loadingdone", update);
    return () => {
        cancelAnimationFrame(frame);
        mutations.disconnect();
        resize.disconnect();
        document.fonts.removeEventListener("loadingdone", update);
        delete group.dataset.selectionReady;
        delete group.dataset.selectionMotion;
    };
}

type RunWieldSegmentedControlProps = HTMLAttributes<HTMLDivElement>;

export function RunWieldSegmentedControl({ className = "", ...props }: RunWieldSegmentedControlProps) {
    const ref = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => ref.current ? attachSegmentedSelection(ref.current) : undefined, []);
    return <div {...props} ref={ref} className={`rw-segmented-toggle ${className}`.trim()} />;
}
