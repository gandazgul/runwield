import { readFile } from "node:fs/promises";

export const prerender = false;
const MOTION_URL = new URL("../../../design-system/sidebar-motion.js", import.meta.url);

export const GET = async () =>
    new Response(await readFile(MOTION_URL, "utf8"), {
        headers: { "content-type": "text/javascript; charset=utf-8" },
    });
