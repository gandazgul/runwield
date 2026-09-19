import { flushSync } from "react-dom";
import { animateSidebarChange } from "../../sidebar-motion.js";

/** @param {() => void} update */
export function animateSidebarUpdate(update) {
    animateSidebarChange(() => flushSync(update));
}
