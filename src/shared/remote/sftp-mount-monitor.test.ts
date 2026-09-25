import { assertMatch } from "@std/assert";

// On hosts without Linux FUSE, these checks guard the independent monitor wiring.
// The opt-in real SSHFS test in sftp-mount.test.ts verifies mount loss end to end.
Deno.test("mounted storage has an independent bounded lookup and mount identity check", async () => {
    const source = await Deno.readTextFile(new URL("./sftp-mount.ts", import.meta.url));
    assertMatch(source, /setInterval\(\(\) => \{\s*void checkStorage\(\);\s*\}, 5_000\)/);
    assertMatch(source, /Deno\.stat\(join\(path, `\.wld-health-\$\{crypto\.randomUUID\(\)\}`\)\)/);
    assertMatch(source, /before\?\.id !== mountId[\s\S]*after\?\.id !== mountId/);
    assertMatch(source, /Promise\.race\(\[\s*lookup\(\)[\s\S]*setTimeout\(\(\) => resolve\("timed out"\), 30_000\)/);
    assertMatch(source, /lost: Promise\.race\(\[storageFailure, \.\.\.active\.map/);
});

Deno.test("a timed-out storage request keeps cleanup uncertain", async () => {
    const source = await Deno.readTextFile(new URL("./sftp-mount.ts", import.meta.url));
    assertMatch(source, /if \(probePending\) uncertain = true/);
    assertMatch(source, /if \(result === "timed out"\) uncertain = true/);
    assertMatch(source, /if \(uncertain\) \{\s*throw new Error\([\s\S]*?SSHFS cleanup uncertain;/);
});
