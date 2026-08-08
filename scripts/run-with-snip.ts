#!/usr/bin/env -S deno run -A

import { basename } from "@std/path";

export interface SnipCommandOptions {
    cwd?: string;
    env?: Record<string, string>;
    failureLabel: string;
    stdin?: "inherit" | "null";
}

export interface SnipCommandResult {
    code: number;
    stdout: string;
    stderr: string;
    failureLogPath?: string;
}

const PASSING_DENO_OUTPUT = [
    /^Check .+$/,
    /^Checked \d+ files?$/,
    /^running \d+ tests? from .+$/,
    /^.+ \.\.\. ok(?: \(.+\))?$/,
    /^ok \| \d+ passed \| 0 failed.*$/,
];

function withoutSnipNoise(output: string): string {
    return output
        .split("\n")
        .filter((line) => !line.startsWith("snip: tracking error:"))
        .filter((line) => !line.startsWith("snip: no filter for "))
        .join("\n");
}

/** Keep only diagnostics when a Deno validation command fails. */
export function extractDenoFailureOutput(command: string, args: string[], output: string): string {
    if (basename(command) !== "deno" || !["check", "fmt", "lint", "test"].includes(args[0] || "")) {
        return withoutSnipNoise(output).trim();
    }

    return withoutSnipNoise(output)
        .split("\n")
        .filter((line) => !PASSING_DENO_OUTPUT.some((pattern) => pattern.test(line)))
        .map((line) => line.replace(/^FAILED \| \d+ passed \| ([1-9]\d*) failed/, "FAILED | $1 failed"))
        .join("\n")
        .replace(/^\s+|\s+$/g, "");
}

function failureLogPrefix(label: string): string {
    const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return `${slug || "command"}-failure-`;
}

/** Run one command through Snip and replace failed output with a filtered log pointer. */
export async function runWithSnip(
    command: string,
    args: string[],
    options: SnipCommandOptions,
): Promise<SnipCommandResult> {
    const env = {
        ...Deno.env.toObject(),
        ...options.env,
        // Snip's tee stores raw output. Plan 3 stores filtered diagnostics instead.
        SNIP_TEE: "0",
    };
    const result = await new Deno.Command("snip", {
        args: [command, ...args],
        cwd: options.cwd,
        env,
        stdin: options.stdin ?? "null",
        stdout: "piped",
        stderr: "piped",
    }).output();
    const decoder = new TextDecoder();
    const stdout = decoder.decode(result.stdout);
    const stderr = decoder.decode(result.stderr);

    if (result.success) return { code: 0, stdout, stderr: withoutSnipNoise(stderr) };

    const filtered = extractDenoFailureOutput(command, args, `${stdout}${stderr}`) ||
        `${options.failureLabel} failed with exit code ${result.code}.`;
    const failureLogPath = await Deno.makeTempFile({ prefix: failureLogPrefix(options.failureLabel), suffix: ".log" });
    await Deno.writeTextFile(failureLogPath, `${filtered}\n`);

    return {
        code: result.code,
        stdout: "",
        stderr: `${options.failureLabel} failed, read the failure log here: ${failureLogPath}\n`,
        failureLogPath,
    };
}

export async function writeSnipCommandResult(result: SnipCommandResult): Promise<void> {
    if (result.stdout) await Deno.stdout.write(new TextEncoder().encode(result.stdout));
    if (result.stderr) await Deno.stderr.write(new TextEncoder().encode(result.stderr));
}

if (import.meta.main) {
    const separator = Deno.args.indexOf("--");
    const failureLabel = separator > 0 ? Deno.args.slice(0, separator).join(" ") : "command";
    const command = separator >= 0 ? Deno.args[separator + 1] : undefined;
    const args = separator >= 0 ? Deno.args.slice(separator + 2) : [];
    if (!command) {
        console.error("usage: run-with-snip <failure label> -- <command> [args...]");
        Deno.exit(64);
    }

    const result = await runWithSnip(command, args, { failureLabel, stdin: "inherit" });
    await writeSnipCommandResult(result);
    Deno.exit(result.code);
}
