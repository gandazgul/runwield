import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import release from "./release.json" with { type: "json" };

const preview = release.version === "Preview";

export default defineConfig({
    site: "https://docs.runwield.dev",
    outDir: "../dist/docs",
    integrations: [
        starlight({
            title: "RunWield Docs",
            description: "Install, use, and configure RunWield.",
            logo: { src: "./src/assets/logo.svg" },
            social: [
                {
                    icon: "github",
                    label: "GitHub",
                    href: "https://github.com/gandazgul/runwield",
                },
            ],
            customCss: ["./src/styles/runwield.css"],
            components: { Head: "./src/components/Head.astro" },
            editLink: {
                baseUrl: "https://github.com/gandazgul/runwield/edit/docs/stable/docs/",
            },
            head: [
                { tag: "meta", attrs: { name: "theme-color", content: "#0b1020" } },
                {
                    tag: "link",
                    attrs: { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
                },
            ],
            sidebar: [
                { label: "Home", link: "/" },
                {
                    label: "RunWield.dev",
                    link: "https://runwield.dev",
                    attrs: { class: "external-link", "aria-label": "RunWield.dev (external link)" },
                },
                { label: "Start", items: ["quickstart", "workspace"] },
                {
                    label: "Use RunWield",
                    items: [
                        "usage",
                        "workflows",
                        "sessions",
                        "collaboration",
                        "workspace-container",
                    ],
                },
                {
                    label: "Configure",
                    items: ["providers", "settings", "customization", "themes", "mcp"],
                },
                {
                    label: "Help and reference",
                    items: [
                        "troubleshooting",
                        "plan-lifecycle",
                        "validation-authority",
                        "contributing",
                    ],
                },
                {
                    label: preview ? "Preview documentation" : `Stable ${release.version}`,
                    link: release.releaseUrl,
                },
            ],
        }),
    ],
});
