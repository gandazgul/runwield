import { assertEquals, assertRejects } from "@std/assert";
import {
    __resetRuntimePreflightForTest,
    ensureCymbalBinary,
    ensureMnemosyneBinary,
    hasSnipBinary,
} from "./runtime-preflight.js";

Deno.test("runtime preflight caches required binaries and probes optional Snip live", async () => {
    /** @type {string[]} */
    const probes = [];
    __resetRuntimePreflightForTest((binary) => {
        probes.push(binary);
        return Promise.resolve(true);
    });
    try {
        await ensureMnemosyneBinary();
        await ensureMnemosyneBinary();
        await ensureCymbalBinary();
        await ensureCymbalBinary();
        assertEquals(await hasSnipBinary(), true);
        assertEquals(await hasSnipBinary(), true);
    } finally {
        __resetRuntimePreflightForTest();
    }

    assertEquals(probes, ["mnemosyne", "cymbal", "snip", "snip"]);
});

Deno.test("runtime preflight reports install guidance when binaries are missing", async () => {
    __resetRuntimePreflightForTest(() => Promise.resolve(false));
    try {
        await assertRejects(
            () => ensureMnemosyneBinary(),
            Error,
            "Mnemosyne binary not found",
        );
        await assertRejects(
            () => ensureCymbalBinary(),
            Error,
            "Cymbal binary not found",
        );
    } finally {
        __resetRuntimePreflightForTest();
    }
});
