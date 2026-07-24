import { assertRejects } from "@std/assert";
import { join } from "@std/path";
import { assertReviewAssetsAvailableInRuntime } from "./assert-workspace-review-runtime.js";

Deno.test("Workspace review runtime asset gate follows nested JS and CSS references", async () => {
    const root = await Deno.makeTempDir({ prefix: "wld-review-runtime-assets-" });
    const assetDir = join(root, "client", "_astro");
    await Deno.mkdir(assetDir, { recursive: true });

    try {
        await Deno.writeTextFile(join(assetDir, "Review.js.asset"), "import './review.css';");
        await Deno.writeTextFile(join(assetDir, "review.css"), ".icon{background:url('./icon.svg')}");
        await Deno.writeTextFile(join(assetDir, "icon.svg"), "<svg></svg>");

        await assertReviewAssetsAvailableInRuntime(
            '<astro-island component-url="/_astro/Review.js"></astro-island>',
            "http://localhost/review/plan?token=test",
            assetDir,
        );
    } finally {
        await Deno.remove(root, { recursive: true });
    }
});

Deno.test("Workspace review runtime asset gate reports missing nested assets", async () => {
    const root = await Deno.makeTempDir({ prefix: "wld-review-runtime-assets-" });
    const assetDir = join(root, "client", "_astro");
    await Deno.mkdir(assetDir, { recursive: true });

    try {
        await Deno.writeTextFile(join(assetDir, "Review.js.asset"), "import './missing.css';");

        await assertRejects(
            () =>
                assertReviewAssetsAvailableInRuntime(
                    '<astro-island component-url="/_astro/Review.js"></astro-island>',
                    "http://localhost/review/plan?token=test",
                    assetDir,
                ),
            Error,
            "Workspace review runtime asset is missing",
        );
    } finally {
        await Deno.remove(root, { recursive: true });
    }
});

Deno.test("Workspace review runtime asset gate rejects empty asset markup", async () => {
    const root = await Deno.makeTempDir({ prefix: "wld-review-runtime-assets-" });
    try {
        await assertRejects(
            () => assertReviewAssetsAvailableInRuntime("<main></main>", "http://localhost/review/plan", root),
            Error,
            "Workspace review page did not reference any runtime assets",
        );
    } finally {
        await Deno.remove(root, { recursive: true });
    }
});
