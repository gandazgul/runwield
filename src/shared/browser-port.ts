/** External capability for asking the operating system to open a URL. */
export interface BrowserPort {
    open(url: string): Promise<boolean>;
}
