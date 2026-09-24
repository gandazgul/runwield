import render from "@astrojs/react/client.js";

// Astro's client:only islands have no SSR marker, but this React renderer
// checks for the marker before it handles client-only rendering.
export default (element: HTMLElement) => (...args: Parameters<ReturnType<typeof render>>) => {
    if (args[3].client === "only") element.setAttribute("ssr", "");
    return render(element)(...args);
};
