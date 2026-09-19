import { PUBLIC_DOCS } from "./public-docs.ts";
import { getCwd } from "../src/constants.js";
import { join } from "@std/path";

const root = getCwd();
const output = join(root, "dist", "docs");
const failures: string[] = [];

for (const source of PUBLIC_DOCS) {
    const route = source === "index.md" ? "index.html" : join(source.slice(0, -3), "index.html");
    try {
        await Deno.stat(join(output, route));
    } catch {
        failures.push(`missing route /${route}`);
    }
}

const htmlRoutes = [
    "index.html",
    "404.html",
    ...PUBLIC_DOCS.filter((source) => source !== "index.md").map((source) => join(source.slice(0, -3), "index.html")),
];
for (const route of htmlRoutes) {
    const html = await Deno.readTextFile(join(output, route));
    for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
        const value = match[1];
        if (value.startsWith("#") || value.startsWith("data:")) continue;
        const url = new URL(value, "https://docs.runwield.dev");
        if (url.origin !== "https://docs.runwield.dev") continue;
        const pathname = decodeURIComponent(url.pathname);
        const target = pathname === "/404/"
            ? join(output, "404.html")
            : pathname.endsWith("/")
            ? join(output, pathname.slice(1), "index.html")
            : join(output, pathname.slice(1));
        let targetHtml = "";
        try {
            const info = await Deno.stat(target);
            if (info.isFile && target.endsWith(".html")) targetHtml = await Deno.readTextFile(target);
        } catch (error) {
            if (!(error instanceof Deno.errors.NotFound)) throw error;
            failures.push(`${route} links to missing published target ${value}`);
            continue;
        }
        if (url.hash && targetHtml && !targetHtml.includes(`id="${decodeURIComponent(url.hash.slice(1))}"`)) {
            failures.push(`${route} links to missing fragment ${value}`);
        }
    }
}

for (
    const excluded of [
        "prd",
        "plans",
        "research",
        "audits",
        "work-records",
        "vision",
    ]
) {
    try {
        await Deno.stat(join(output, excluded));
        failures.push(`excluded docs directory was published: ${excluded}`);
    } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
}

async function outputText(directory: string): Promise<string> {
    let text = "";
    for await (const entry of Deno.readDir(directory)) {
        const path = join(directory, entry.name);
        if (entry.isDirectory) text += await outputText(path);
        else text += new TextDecoder().decode(await Deno.readFile(path));
    }
    return text;
}

const completeOutput = await outputText(output);
for (const marker of ["Living central PRDs", "Active product direction", "RunWield vision"]) {
    if (completeOutput.includes(marker)) {
        failures.push(`published output exposes internal marker ${JSON.stringify(marker)}`);
    }
}

const sitemap = await Deno.readTextFile(join(output, "sitemap-0.xml"));
for (const excluded of ["/prd/", "/plans/", "/research/", "/audits/"]) {
    if (sitemap.includes(excluded)) failures.push(`sitemap exposes excluded route ${excluded}`);
}

const index = await Deno.readTextFile(join(output, "index.html"));
for (
    const text of ["RunWield Documentation", "Quickstart", "Configure RunWield"]
) {
    if (!index.includes(text)) {
        failures.push(`home page does not include ${JSON.stringify(text)}`);
    }
}
for (
    const text of [
        "Living central PRDs",
        "Active product direction",
        "RunWield vision",
    ]
) {
    if (index.includes(text)) {
        failures.push(`home page exposes internal section ${JSON.stringify(text)}`);
    }
}

if (failures.length > 0) {
    for (const failure of failures) console.error(`- ${failure}`);
    Deno.exit(1);
}
console.log(`Verified ${PUBLIC_DOCS.length} public documentation routes`);
