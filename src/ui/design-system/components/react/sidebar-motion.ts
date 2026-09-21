import { flushSync } from "react-dom";
import { animateSidebarChange } from "../../sidebar-motion.js";

export function animateSidebarUpdate(update: () => void) {
    animateSidebarChange(() => flushSync(update));
}
