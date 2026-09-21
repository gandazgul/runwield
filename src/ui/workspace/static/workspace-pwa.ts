/** Workspace stays online-only. A connection notice never replaces a draft or retries an action. */
let disconnected = !navigator.onLine;

function renderConnection() {
    const notice = document.querySelector("[data-workspace-connection]");
    if (notice instanceof HTMLElement) notice.hidden = !disconnected;
}

globalThis.addEventListener("offline", () => {
    disconnected = true;
    renderConnection();
});
globalThis.addEventListener("online", () => void checkConnection());
document.addEventListener("astro:page-load", renderConnection);

async function checkConnection() {
    const status = document.querySelector("[data-connection-status]");
    const retry = document.querySelector("[data-connection-retry]");
    if (retry instanceof HTMLButtonElement) retry.disabled = true;
    if (status) status.textContent = "Connecting…";
    try {
        const response = await fetch("/workspace.webmanifest", {
            cache: "no-store",
            signal: AbortSignal.timeout(10000),
        });
        disconnected = !response.ok;
    } catch {
        disconnected = true;
    } finally {
        if (retry instanceof HTMLButtonElement) retry.disabled = false;
        if (status) status.textContent = disconnected ? "Still unable to connect. Please try again." : "";
        renderConnection();
    }
}

document.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest("[data-connection-retry]")) void checkConnection();
});

if ("serviceWorker" in navigator && globalThis.isSecureContext) {
    navigator.serviceWorker.addEventListener("message", (event) => {
        if (event.data?.type !== "runwield:connection") return;
        disconnected = event.data.connected !== true;
        renderConnection();
    });
    navigator.serviceWorker.register("/workspace-worker.js", { scope: "/", updateViaCache: "none" }).catch(() => {
        // Installation is progressive enhancement; normal online browsing remains available.
    });
}
renderConnection();
