import { join } from "@std/path";

// These executables model external services for composed workflow tests. Git,
// Deno, Snip, and every RunWield operation still use their real implementations.
// Unexpected calls are recorded as well as rejected: production may legitimately
// catch an optional helper failure, but a test must not silently miss a new call.
const SCRIPTS: Record<string, string> = {
    mnemoteca: `
case "$1" in
  --help) echo 'Usage: mnemoteca <command>'; exit 0 ;;
  update)
    if [ "$2" = "--help" ]; then
      echo 'Usage: mnemoteca update <id> --replace-tags'; exit 0
    fi ;;
  list) echo 'No documents'; exit 0 ;;
  search) echo '{"results":[]}'; exit 0 ;;
  init|add|forget) exit 0 ;;
  export)
    shift
    while [ "$#" -gt 0 ]; do
      if [ "$1" = "--output" ] && [ "$#" -ge 2 ]; then
        shift
        mkdir -p "$(dirname "$1")"
        printf '%s\\n' '{"type":"mnemoteca-export"}' > "$1"
        exit 0
      fi
      shift
    done ;;
esac
`,
    cymbal: `
case "$*" in
  --help) echo 'Usage: cymbal <command>'; exit 0 ;;
  'index .') exit 0 ;;
esac
if [ "$1" = "--no-federate" ] && [ "$2" = "hook" ] && [ "$3" = "nudge" ] && [ "$4" = "--format=text" ] && [ "$5" = "--" ]; then
  exit 0
fi
`,
    ketch: `
if [ "$*" = "--help" ]; then echo 'Usage: ketch <command>'; exit 0; fi
`,
    osascript: `
if [ "$#" -eq 2 ] && [ "$1" = "-e" ] && [ "$2" = 'try
        the clipboard as «class PNGf»
        return "image"
      on error
        return "none"
      end try' ]; then
  echo none
  exit 0
fi
`,
};

/** Install only external boundaries used by the default workflow scenarios. */
export async function writeWorkflowBinaryFixtures(root: string): Promise<string> {
    const binDir = join(root, "bin");
    await Deno.mkdir(binDir, { recursive: true });
    await Promise.all(
        Object.entries(SCRIPTS).map(async ([name, script]) => {
            const path = join(binDir, name);
            const quotedBinDir = "'" + binDir.replaceAll("'", "'\\''") + "'";
            await Deno.writeTextFile(
                path,
                `#!/bin/sh
fixture_bin_dir=${quotedBinDir}
printf '%s\\n' '${name}' "$@" >> "$fixture_bin_dir/calls.log"
${script}
printf 'Unsupported ${name} fixture call: %s\\n' "$*" >> "$fixture_bin_dir/unexpected.log"
printf 'Unsupported ${name} fixture call: %s\\n' "$*" >&2
exit 64
`,
            );
            await Deno.chmod(path, 0o755);
        }),
    );
    return binDir;
}

/** Fail even if an optional external-call error was caught by the application. */
export async function assertWorkflowBinaryCallsSupported(root: string): Promise<void> {
    let unexpected = "";
    try {
        unexpected = await Deno.readTextFile(join(root, "bin", "unexpected.log"));
    } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    if (unexpected) throw new Error(unexpected.trim());
}
