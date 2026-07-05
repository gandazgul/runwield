/** @param {{ Component: any }} props */
export function AppWrapper({ Component }) {
    return (
        <html lang="en">
            <head>
                <meta charSet="utf-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1" />
                <title>RunWield Workspace</title>
                <link rel="icon" href="/logo.svg" type="image/svg+xml" />
                <link rel="stylesheet" href="/tokens.css" />
                <link rel="stylesheet" href="/components.css" />
                <link rel="stylesheet" href="/workspace.css" />
                <link rel="stylesheet" href="/theme.css" />
            </head>
            <body>
                <Component />
            </body>
        </html>
    );
}
