import { assertEquals, assertRejects } from "@std/assert";
import {
    getCachedUpdateAvailability,
    getTagPinnedInstallerUrl,
    isNewerRunWieldVersion,
    LATEST_RELEASE_API_URL,
    normalizeRunWieldVersion,
    parseRunWieldReleaseVersion,
    readUpdateCheckCache,
    refreshUpdateCheckCache,
    writeUpdateCheckCache,
} from "./update-check.js";

Deno.test("normalizes RunWield release versions", () => {
    assertEquals(normalizeRunWieldVersion("1.2.3"), "v1.2.3");
    assertEquals(normalizeRunWieldVersion("v1.2.3-rc.4"), "v1.2.3-rc.4");
    assertEquals(parseRunWieldReleaseVersion("v1.2.3"), {
        major: 1,
        minor: 2,
        patch: 3,
        rc: null,
        stable: true,
        normalized: "v1.2.3",
    });
});

Deno.test("compares stable and candidate release versions", () => {
    assertEquals(isNewerRunWieldVersion("v1.2.4", "v1.2.3"), true);
    assertEquals(isNewerRunWieldVersion("v1.2.3", "v1.2.3"), false);
    assertEquals(isNewerRunWieldVersion("v1.2.3", "v1.2.4"), false);
    assertEquals(isNewerRunWieldVersion("v1.2.3", "v1.2.3-rc.2"), true);
    assertEquals(isNewerRunWieldVersion("v1.2.3-rc.2", "v1.2.3-rc.1"), true);
    assertEquals(isNewerRunWieldVersion("v1.2.3-rc.1", "v1.2.3"), false);
});

Deno.test("non-release current versions are updateable when they differ from latest", () => {
    assertEquals(isNewerRunWieldVersion("v1.2.3", "abc1234"), true);
    assertEquals(isNewerRunWieldVersion("v1.2.3", "1.2.3"), false);
});

Deno.test("cache reads fresh valid metadata and rejects stale or malformed data", async () => {
    const dir = await Deno.makeTempDir({ prefix: "runwield-update-cache-" });
    try {
        const cachePath = `${dir}/update-check.json`;
        await writeUpdateCheckCache({ latestVersion: "1.2.3", checkedAt: 1000, cachePath });
        assertEquals(await readUpdateCheckCache({ now: 2000, ttlMs: 5000, cachePath }), {
            latestVersion: "v1.2.3",
            checkedAt: 1000,
        });
        assertEquals(await readUpdateCheckCache({ now: 7000, ttlMs: 5000, cachePath }), null);

        await Deno.writeTextFile(cachePath, "not json");
        assertEquals(await readUpdateCheckCache({ now: 2000, ttlMs: 5000, cachePath }), null);

        await Deno.writeTextFile(cachePath, JSON.stringify({ latestVersion: "bad", checkedAt: 1000 }));
        assertEquals(await readUpdateCheckCache({ now: 2000, ttlMs: 5000, cachePath }), null);
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test("cached availability recomputes against current version", async () => {
    const dir = await Deno.makeTempDir({ prefix: "runwield-update-availability-" });
    try {
        const cachePath = `${dir}/update-check.json`;
        await writeUpdateCheckCache({ latestVersion: "v2.0.0", checkedAt: 1000, cachePath });
        assertEquals(await getCachedUpdateAvailability({ currentVersion: "v1.0.0", now: 2000, cachePath }), {
            latestVersion: "v2.0.0",
            available: true,
            checkedAt: 1000,
        });
        assertEquals(await getCachedUpdateAvailability({ currentVersion: "v2.0.0", now: 2000, cachePath }), {
            latestVersion: "v2.0.0",
            available: false,
            checkedAt: 1000,
        });
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test("refresh fetches GitHub latest and ignores cache write failures", async () => {
    /** @type {string[]} */
    const calls = [];
    /** @param {string | URL | Request} url */
    const fetchImpl = (url) => {
        calls.push(String(url));
        return Promise.resolve(new Response(JSON.stringify({ tag_name: "v3.0.0" }), { status: 200 }));
    };
    const result = await refreshUpdateCheckCache({
        currentVersion: "v2.0.0",
        now: 10,
        cachePath: "/dev/null/update-check.json",
        fetch: fetchImpl,
    });
    assertEquals(calls, [LATEST_RELEASE_API_URL]);
    assertEquals(result.available, true);
    assertEquals(result.latestVersion, "v3.0.0");
});

Deno.test("latest API rejects malformed release data", async () => {
    const fetchImpl = () => Promise.resolve(new Response(JSON.stringify({ name: "RunWield" }), { status: 200 }));
    await assertRejects(
        () => refreshUpdateCheckCache({ currentVersion: "v1.0.0", fetch: fetchImpl }),
        Error,
        "tag_name",
    );
});

Deno.test("constructs tag-pinned installer URLs", () => {
    assertEquals(
        getTagPinnedInstallerUrl("1.2.3"),
        "https://raw.githubusercontent.com/gandazgul/runwield/v1.2.3/install.sh",
    );
});
