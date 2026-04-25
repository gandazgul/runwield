/**
 * @module cmd/help
 * Global and command-specific help command.
 */

import { parseArgs } from "@std/cli/parse-args";
import { printCommandHelp, printGlobalHelp } from "../../shared/help-text.js";

/**
 * Run help command.
 *
 * @param {string[]} argv
 */
export async function runHelpCommand(argv) {
  await Promise.resolve();

  const parsed = parseArgs(argv, {
    boolean: ["help"],
    alias: { h: "help" },
  });

  const [commandName] = parsed._.map(String);

  if (!commandName) {
    printGlobalHelp();
    return;
  }

  const found = printCommandHelp(commandName);
  if (!found) {
    console.error(`[Harness] Unknown command for help: ${commandName}`);
    console.log();
    printGlobalHelp();
    Deno.exit(1);
  }
}
