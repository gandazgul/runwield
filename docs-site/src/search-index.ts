import type { HookParameters } from "astro";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as pagefind from "pagefind";

function assertNoErrors(errors: string[]) {
    if (errors.length) throw new Error(`Pagefind failed: ${errors.join("; ")}`);
}

export async function writeSearchIndex({ dir, logger }: HookParameters<"astro:build:done">) {
    try {
        const created = await pagefind.createIndex();
        assertNoErrors(created.errors);
        if (!created.index) throw new Error("Pagefind did not create an index");
        const indexed = await created.index.addDirectory({
            path: fileURLToPath(dir),
        });
        assertNoErrors(indexed.errors);
        const generated = await created.index.getFiles();
        assertNoErrors(generated.errors);
        if (!generated.files?.length) {
            throw new Error("Pagefind did not generate search files");
        }
        await Promise.all(generated.files.map(async (file) => {
            const destination = join(fileURLToPath(dir), "pagefind", file.path);
            await mkdir(dirname(destination), { recursive: true });
            await writeFile(destination, file.content);
        }));
        logger.info(`Search index written: ${indexed.page_count} pages`);
    } finally {
        await pagefind.close();
    }
}
