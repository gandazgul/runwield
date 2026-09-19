declare module "@pagefind/default-ui" {
    export interface PagefindUIOptions {
        element: string;
        baseUrl: string;
        bundlePath: string;
        showImages: boolean;
        showSubResults: boolean;
    }

    export class PagefindUI {
        constructor(options: PagefindUIOptions);
    }
}
