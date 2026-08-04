/** External capability for asking the operating system to open a URL. */
export interface BrowserPort {
    open(url: string): Promise<boolean>;
}

export const SYSTEM_BROWSER_PORT: BrowserPort = {
    async open(url: string): Promise<boolean> {
        const launcher = Deno.build.os === "darwin"
            ? { command: "open", args: [url] }
            : Deno.build.os === "windows"
            ? { command: "cmd", args: ["/c", "start", "", url] }
            : { command: "xdg-open", args: [url] };

        try {
            const process = new Deno.Command(launcher.command, {
                args: launcher.args,
                stdout: "null",
                stderr: "null",
            }).spawn();
            await process.status.catch(() => {});
            return true;
        } catch {
            return false;
        }
    },
};

export const NO_OPEN_BROWSER_PORT: BrowserPort = {
    open: () => Promise.resolve(false),
};
