import { assertEquals } from "@std/assert";
import { animateSidebarChange } from "./sidebar-motion.js";

/** @param {boolean} reducedMotion */
function installBrowser(reducedMotion = false) {
    const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
    const previousMedia = Object.getOwnPropertyDescriptor(globalThis, "matchMedia");
    const classes = new Set();
    const browser = {
        documentElement: {
            classList: {
                add: (name) => classes.add(name),
                remove: (name) => classes.delete(name),
                contains: (name) => classes.has(name),
            },
        },
    };
    Object.defineProperty(globalThis, "document", { configurable: true, value: browser });
    Object.defineProperty(globalThis, "matchMedia", {
        configurable: true,
        value: () => ({ matches: reducedMotion }),
    });
    return {
        browser,
        classes,
        restore() {
            if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
            else delete globalThis.document;
            if (previousMedia) Object.defineProperty(globalThis, "matchMedia", previousMedia);
            else delete globalThis.matchMedia;
        },
    };
}

Deno.test("sidebar changes stay immediate without animation support or with reduced motion", () => {
    for (const reduced of [false, true]) {
        const fixture = installBrowser(reduced);
        try {
            if (reduced) {
                fixture.browser.startViewTransition = () => {
                    throw new Error("Reduced motion must not capture a transition.");
                };
            }
            let open = true;
            animateSidebarChange(() => open = false);
            assertEquals(open, false);
            assertEquals(fixture.classes.size, 0);
        } finally {
            fixture.restore();
        }
    }
});

Deno.test("rapid sidebar toggles preserve order before and during the animation", async () => {
    const fixture = installBrowser();
    const finished = Promise.withResolvers();
    let commit = () => {};
    let skipped = 0;
    fixture.browser.startViewTransition = (update) => {
        commit = update;
        return { ready: Promise.resolve(), finished: finished.promise, skipTransition: () => skipped++ };
    };
    try {
        const states = [];
        let open = true;
        const toggle = () => states.push(open = !open);
        animateSidebarChange(toggle);
        animateSidebarChange(toggle);
        assertEquals(states, []);
        commit();
        assertEquals(states, [false, true]);
        animateSidebarChange(toggle);
        assertEquals(states, [false, true, false]);
        assertEquals(skipped, 1);
        finished.resolve();
        await finished.promise;
        assertEquals(fixture.classes.size, 0);
    } finally {
        finished.resolve();
        await finished.promise;
        fixture.restore();
    }
});

Deno.test("a skipped sidebar snapshot still applies the change and clears motion styles", async () => {
    const fixture = installBrowser();
    const finished = Promise.withResolvers();
    let commit = () => {};
    fixture.browser.startViewTransition = (update) => {
        commit = update;
        return { ready: Promise.reject(new Error("Page hidden")), finished: finished.promise, skipTransition() {} };
    };
    try {
        let open = false;
        animateSidebarChange(() => open = true);
        commit();
        finished.resolve();
        await finished.promise;
        assertEquals(open, true);
        assertEquals(fixture.classes.size, 0);
    } finally {
        finished.resolve();
        await finished.promise;
        fixture.restore();
    }
});
