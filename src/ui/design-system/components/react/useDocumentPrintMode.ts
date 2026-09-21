import { useEffect } from "react";

/** Print a static document, independent of the application's scroll and popup layers. */
export async function printDocument() {
    const article = [...document.querySelectorAll<HTMLElement>(".rw-plan-review [data-print-region='article']")]
        .find((element) => !element.closest("[hidden]"));
    if (!article) return;
    globalThis.dispatchEvent(new Event("runwield:prepare-print"));
    const frame = document.createElement("iframe");
    frame.title = "Printable document";
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "position:fixed;left:-10000px;top:0;width:800px;height:1000px;border:0";
    document.body.append(frame);
    const target = frame.contentDocument;
    const targetWindow = frame.contentWindow;
    if (!target || !targetWindow) {
        frame.remove();
        globalThis.dispatchEvent(new Event("afterprint"));
        return;
    }
    target.title = document.title;
    const base = target.createElement("base");
    base.href = document.baseURI;
    target.head.append(base);
    const styles = [...document.querySelectorAll("style, link[rel='stylesheet']")].map((node) => node.cloneNode(true));
    target.head.append(...styles);
    target.documentElement.className = document.documentElement.className;
    const reader = target.createElement("div");
    reader.className = "rw-plan-review";
    const page = target.createElement("div");
    page.append(article.cloneNode(true));
    reader.append(page);
    target.body.append(reader);
    const finish = () => {
        frame.remove();
        globalThis.dispatchEvent(new Event("afterprint"));
    };
    targetWindow.addEventListener("afterprint", finish, { once: true });
    await Promise.all(
        [...target.querySelectorAll<HTMLLinkElement>("link[rel='stylesheet']")].map((link) =>
            link.sheet ? Promise.resolve() : new Promise<void>((resolve) => {
                link.onload = () => resolve();
                link.onerror = () => resolve();
            })
        ),
    );
    await target.fonts.ready;
    await Promise.all([...target.images].map((image) => image.decode().catch(() => {})));
    // Paint the static document before Chrome opens its blocking print dialog.
    targetWindow.requestAnimationFrame(() =>
        setTimeout(() => {
            try {
                targetWindow.print();
            } finally {
                finish();
            }
        }, 0)
    );
}

/** Fit diagrams to paper without changing the reader's zoom or saved theme. */
export function useDocumentPrintMode() {
    useEffect(() => {
        const views = new Map<SVGSVGElement, string>();
        function prepare() {
            if (document.documentElement.classList.contains("plannotator-print")) return;
            document.documentElement.classList.add("plannotator-print");
            for (const svg of document.querySelectorAll<SVGSVGElement>(".rw-plan-review svg[id^='mermaid-']")) {
                if (views.has(svg)) continue;
                const bounds = svg.getBBox();
                if (!bounds.width || !bounds.height) continue;
                views.set(svg, svg.getAttribute("viewBox") || "");
                const padding = 12;
                svg.setAttribute(
                    "viewBox",
                    `${bounds.x - padding} ${bounds.y - padding} ${bounds.width + padding * 2} ${
                        bounds.height + padding * 2
                    }`,
                );
            }
        }
        function restore() {
            document.documentElement.classList.remove("plannotator-print");
            for (const [svg, viewBox] of views) {
                if (viewBox) svg.setAttribute("viewBox", viewBox);
                else svg.removeAttribute("viewBox");
            }
            views.clear();
        }
        function visible() {
            if (!document.hidden) restore();
        }
        globalThis.addEventListener("runwield:prepare-print", prepare);
        globalThis.addEventListener("beforeprint", prepare);
        globalThis.addEventListener("afterprint", restore);
        document.addEventListener("visibilitychange", visible);
        return () => {
            globalThis.removeEventListener("runwield:prepare-print", prepare);
            globalThis.removeEventListener("beforeprint", prepare);
            globalThis.removeEventListener("afterprint", restore);
            document.removeEventListener("visibilitychange", visible);
            restore();
        };
    }, []);
}
