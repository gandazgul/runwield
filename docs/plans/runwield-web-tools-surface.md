---
planId: "4de05d1a-78a4-4694-a109-d6e9b2d816bc"
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "HIGH"
summary: "Replace the ketch Skill with four RunWield-owned web_* Custom Tools backed by a required ketch helper binary, and strip Claude CLI's native WebSearch/WebFetch so every backend has one identical web surface."
affectedPaths:
    - "src/extensions/ketch/tools.ts"
    - "src/extensions/ketch/index.ts"
    - "src/extensions/ketch/tools.test.ts"
    - "src/tools/registry.js"
    - "src/shared/session/session.js"
    - "src/shared/session/backends/claude-cli/capability-tools.ts"
    - "src/shared/session/backends/claude-cli/command.ts"
    - "src/shared/session/backends/claude-cli/claude-cli-backend.test.ts"
    - "src/shared/session/claude-cli-execution.test.ts"
    - "src/shared/session/session-catalog.test.js"
    - "src/shared/runtime-preflight.ts"
    - "src/shared/runtime-preflight.test.ts"
    - "src/ui/tui/chat-session.js"
    - "install.sh"
    - "scripts/install-test-helpers.js"
    - "scripts/install-platforms.test.js"
    - "Containerfile.wld-ux"
    - "src/agent-definitions/ideator.md"
    - "src/agent-definitions/architect.md"
    - "src/agent-definitions/planner.md"
    - "src/agent-definitions/guide.md"
    - "src/agent-definitions/engineer.md"
    - "src/agent-definitions/frontend-engineer.md"
    - "src/skills/ketch/SKILL.md"
    - "src/skills/research/SKILL.md"
    - "src/skills/frontend-framework/ENGINEERING.md"
    - "docs/customization.md"
    - "docs/domain-language.md"
objectiveChecks:
    - id: "OC1"
      command: "deno eval -A 'const { createKetchTools } = await import(\"./src/extensions/ketch/tools.ts\"); const { denoHelperBinaryExec } = await import(\"./src/extensions/helper-binary-exec.ts\"); const tools = createKetchTools({ cwd: Deno.cwd(), exec: denoHelperBinaryExec }); const names = tools.map((t) => t.name).sort().join(\",\"); if (names !== \"web_code_search,web_docs_search,web_fetch,web_search\") { console.error(\"names: \" + names); Deno.exit(1); } const r = await tools.find((t) => t.name === \"web_fetch\").execute(\"c\", { url: \"https://example.com\" }); const text = r.content.map((b) => b.text).join(\"\"); if (!/domain is for use in documentation examples/i.test(text)) { console.error(text.slice(0, 400)); Deno.exit(1); }'"
      rationale: "Requires the real ketch-backed factory to exist, expose exactly the four web_* tools, and return live scraped markdown from example.com. A placeholder, alias, or empty module cannot produce that page body."
    - id: "OC2"
      command: "deno eval -A 'const m = await import(\"./src/shared/session/backends/claude-cli/capability-tools.ts\"); const need = [\"web_search\",\"web_fetch\",\"web_code_search\",\"web_docs_search\"]; const have = new Set(m.CLAUDE_CLI_CAPABILITY_TOOL_NAMES); if (!need.every((n) => have.has(n))) Deno.exit(1); const tools = m.createClaudeCliCapabilityTools({ cwd: Deno.cwd() }); if (!need.every((n) => tools.some((t) => t.name === n))) Deno.exit(1);'"
      rationale: "createClaudeCliCapabilityTools throws when a listed name has no implementation, so this passes only when the web tools are genuinely wired into the Claude CLI MCP bridge, not merely named."
    - id: "OC3"
      command: "! grep -qE '\"(WebFetch|WebSearch)\"' src/shared/session/backends/claude-cli/command.ts"
      rationale: "The one-surface decision requires Claude Code's native web tools to be removed from the pre-authorized list; this is red today because both names are present at lines 32-33."
    - id: "OC4"
      command: "! test -e src/skills/ketch/SKILL.md && ! grep -rqE '\\bketch\\b' src/agent-definitions/ src/skills/"
      rationale: "Red today because the Skill exists and Ideator, Architect, research, and frontend-framework all instruct Agents to drive the ketch CLI. Green only when the Skill is deleted and every prompt names the tools instead."
    - id: "OC5"
      command: "deno eval -A 'const m = await import(\"./src/shared/runtime-preflight.ts\"); await m.ensureKetchBinary();' && grep -q 'ensureKetchBinary' src/ui/tui/chat-session.js"
      rationale: "ensureKetchBinary does not exist today. Passing requires both the preflight export and an actual startup call site, so the required-helper guarantee is enforced rather than merely declared."
    - id: "OC6"
      command: "grep -qE '\\bketch\\b' scripts/install-platforms.test.js && deno run -A scripts/run-tests.js scripts/install-platforms.test.js"
      rationale: "Red today because the installer fixture and test know nothing about ketch. Green requires install.sh to install ketch as a required helper and the platform test to prove preserve/idempotence behavior for it."
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-08-09T22:40:00-04:00"
updatedAt: "2026-08-16T03:51:46.755Z"
status: "user_verified"
origin: "internal"
failureReason: "Objective-Failing Checks unmet.\n\nObjective-Failing Checks: 3 met, 3 unmet, 0 broken (6 total).\n\n- OC1: unmet\n  command: deno eval -A 'const { createKetchTools } = await import(\"./src/extensions/ketch/tools.ts\"); const { denoHelperBinaryExec } = await import(\"./src/extensions/helper-binary-exec.ts\"); const tools = createKetchTools({ cwd: Deno.cwd(), exec: denoHelperBinaryExec }); const names = tools.map((t) => t.name).sort().join(\",\"); if (names !== \"web_code_search,web_docs_search,web_fetch,web_search\") { console.error(\"names: \" + names); Deno.exit(1); } const r = await tools.find((t) => t.name === \"web_fetch\").execute(\"c\", { url: \"https://example.com\" }); const text = r.content.map((b) => b.text).join(\"\"); if (!/domain is for use in documentation examples/i.test(text)) { console.error(text.slice(0, 400)); Deno.exit(1); }'\n  rationale: Requires the real ketch-backed factory to exist, expose exactly the four web_* tools, and return live scraped markdown from example.com. A placeholder, alias, or empty module cannot produce that page body.\n  exitCode: 1\n  output:\n    \u001b[0m\u001b[1m\u001b[31merror\u001b[0m: unexpected argument '-A' found\n    \n      tip: to pass '-A' as a value, use '-- -A'\n    \n    Usage: deno eval [OPTIONS] [CODE_ARG]...\n\n- OC2: unmet\n  command: deno eval -A 'const m = await import(\"./src/shared/session/backends/claude-cli/capability-tools.ts\"); const need = [\"web_search\",\"web_fetch\",\"web_code_search\",\"web_docs_search\"]; const have = new Set(m.CLAUDE_CLI_CAPABILITY_TOOL_NAMES); if (!need.every((n) => have.has(n))) Deno.exit(1); const tools = m.createClaudeCliCapabilityTools({ cwd: Deno.cwd() }); if (!need.every((n) => tools.some((t) => t.name === n))) Deno.exit(1);'\n  rationale: createClaudeCliCapabilityTools throws when a listed name has no implementation, so this passes only when the web tools are genuinely wired into the Claude CLI MCP bridge, not merely named.\n  exitCode: 1\n  output:\n    \u001b[0m\u001b[1m\u001b[31merror\u001b[0m: unexpected argument '-A' found\n    \n      tip: to pass '-A' as a value, use '-- -A'\n    \n    Usage: deno eval [OPTIONS] [CODE_ARG]...\n\n- OC3: met\n  command: ! grep -qE '\"(WebFetch|WebSearch)\"' src/shared/session/backends/claude-cli/command.ts\n  rationale: The one-surface decision requires Claude Code's native web tools to be removed from the pre-authorized list; this is red today because both names are present at lines 32-33.\n  exitCode: 0\n\n- OC4: met\n  command: ! test -e src/skills/ketch/SKILL.md && ! grep -rqE '\\bketch\\b' src/agent-definitions/ src/skills/\n  rationale: Red today because the Skill exists and Ideator, Architect, research, and frontend-framework all instruct Agents to drive the ketch CLI. Green only when the Skill is deleted and every prompt names the tools instead.\n  exitCode: 0\n\n- OC5: unmet\n  command: deno eval -A 'const m = await import(\"./src/shared/runtime-preflight.ts\"); await m.ensureKetchBinary();' && grep -q 'ensureKetchBinary' src/ui/tui/chat-session.js\n  rationale: ensureKetchBinary does not exist today. Passing requires both the preflight export and an actual startup call site, so the required-helper guarantee is enforced rather than merely declared.\n  exitCode: 1\n  output:\n    \u001b[0m\u001b[1m\u001b[31merror\u001b[0m: unexpected argument '-A' found\n    \n      tip: to pass '-A' as a value, use '-- -A'\n    \n    Usage: deno eval [OPTIONS] [CODE_ARG]...\n\n- OC6: met\n  command: grep -qE '\\bketch\\b' scripts/install-platforms.test.js && deno run -A scripts/run-tests.js scripts/install-platforms.test.js\n  rationale: Red today because the installer fixture and test know nothing about ketch. Green requires install.sh to install ketch as a required helper and the platform test to prove preserve/idempotence behavior for it.\n  exitCode: 0\n  output:\n    install.sh maps Darwin/Linux amd64/arm64 assets and preserves positional wld version ...\n    ok | 5 passed (4 steps) | 0 failed (2s)"
implementedAt: "2026-08-12T15:14:09.084Z"
userVerifiedAt: "2026-08-12T16:34:11.322Z"
userVerificationNote: "No feedback; verified manually from merged worktree runwield-web-tools-surface-0ac7eb0e."
executionReport: "- Implemented the RunWield-owned `web_search`, `web_fetch`, `web_code_search`, and `web_docs_search` tools over the injected `ketch` helper, with pinned backends, JSON formatting, truncation markers, exit-code guidance, and Context7 key setup passthrough.\n- Wired the ketch extension into Pi sessions and Claude CLI capability bridging; removed Claude native `WebFetch`/`WebSearch` from project tool authorization; protected the four `web_*` names from layered overrides.\n- Made `ketch` a required runtime helper in preflight, TUI startup, installer fixtures, installer platform tests, and UX container checks; also enabled Cymbal startup preflight on the same path.\n- Deleted `src/skills/ketch/` and rewrote agent definitions, research/frontend skills, customization docs, and domain language to use the `web_*` tools. Verified no whole-word `ketch` remains under `src/agent-definitions/` or `src/skills/`.\n- Updated tests without deleting coverage: replaced Claude CLI native web-tool presence assertions with absence plus `web_*` bridge assertions; replaced ketch Skill prompt/catalog assertions with `web_*` bridge and `research` Skill assertions; added ketch runtime/installer assertions; added 8 new `src/extensions/ketch/tools.test.ts` tests.\n- Verification passed: `deno run -A scripts/run-tests.js src/extensions/ketch/tools.test.ts`; `deno run -A scripts/run-tests.js src/shared/session/backends/claude-cli/`; `deno run -A scripts/run-tests.js scripts/install-platforms.test.js scripts/install-integrity.test.js`; `deno task ci`.\n- Manual spot checks passed: empty-home `ketch docs \"deno kv\"` returned exit 5 with `ketch config set context7_api_key`; `web_docs_search` surfaced the same setup text with empty `HOME`; `web_fetch` fetched `https://example.com` through the new factory.\n- Manual interactive Pi-backed and Claude CLI `wld` sessions were not exercised in this non-interactive run; bridge and startup behavior are covered by automated tests."
workRecord:
    status: "generated"
    recordId: "14846fc9-43d3-4b04-847a-0f233d8fa485"
    path: "docs/work-records/2026-08-16-runwield-owned-web-tools-surface-delivered.md"
    lastAttemptAt: "2026-08-16T03:51:30.245Z"
humanReviewMode: null
humanReviewDecision: null
executionMode: "worktree"
executionBaselineTree: "2d2968e1f71308c68685dfe53bbaccac9f38b977"
worktreeId: "0ac7eb0e"
worktreePath: "/Users/gandazgul/.wld/worktrees/--Users-gandazgul-Documents-web-runwield--/runwield-runwield-web-tools-surface-0ac7eb0e"
worktreeBranch: "worktree/runwield-web-tools-surface-0ac7eb0e"
worktreeBaseBranch: "main"
worktreeStatus: "validation_failed"
validationCiAttempts: 0
validationSemanticRounds: 0
---

# RunWield Web Tools Surface

## Context

RunWield Agents have no owned web capability. Ideator, Architect, the `research` Skill, and the `frontend-framework`
Skill all instruct Agents to "load and follow the `ketch` skill" and then drive the `ketch` command-line interface (CLI)
through `bash`. Three problems follow from that design.

**The instruction points at nothing on a fresh machine.** `install.sh` installs `mnemosyne`, `cymbal`, `agent-browser`,
and `snip`. It does not install `ketch`, and `src/shared/runtime-preflight.ts` does not know `ketch` exists. The prompts
promise a capability the installer never delivers.

**A Skill is advisory; a Tool is not.** An Agent can decline to read `src/skills/ketch/SKILL.md`, and the recorded
`.history/TODO_*.md` transcripts show exactly that failure: an Agent was denied the Skill file, then denied the raw
`ketch` CLI, and gave up. Web access that depends on an Agent choosing to read a document is web access that
intermittently does not exist.

**Behavior differs per model backend.** `src/shared/session/backends/claude-cli/command.ts:32-33` pre-authorizes Claude
Code's native `WebFetch` and `WebSearch`. Pi-backed models have neither. The same Agent definition therefore behaves
differently depending on which model the user selected, and prompts cannot state one true instruction.

A fourth problem is invisible on the author's own machine. `ketch` reads a user-global config
(`~/Library/Application Support/ketch/config.json` on macOS) that selects backends. A local run of `ketch code` used
`sourcegraph` because the local config says so, while an empty config uses `grepapp`. Any design that lets Agents drive
the CLI directly inherits per-machine behavior differences that never reproduce.

## Objective

Make web access a first-class RunWield capability with a RunWield-owned contract, identical on every model backend.

Ship four Custom Tools — `web_search`, `web_fetch`, `web_code_search`, `web_docs_search` — implemented over the `ketch`
helper binary, with every backend pinned by RunWield rather than read from the user's `ketch` config. Promote `ketch` to
a required helper installed by `install.sh` and enforced at startup preflight. Strip Claude Code's native `WebFetch` and
`WebSearch` from the Claude CLI allowed-tool list so one surface serves every backend. Delete the `ketch` Skill and
rewrite the prompts and Skills that referenced it to name the tools instead.

The `web_*` prefix is deliberate. The existing `code_*` tools mean _this repository, indexed by Cymbal_. `ketch code`
searches public repositories on the internet. Putting internet code search under `code_*` would let an Agent asked to
find a symbol in this project silently return a result from GitHub. `web_*` versus `code_*` maps exactly onto the
distinction Agents must not confuse: outside world versus this checkout.

## Approach

Follow the Cymbal extension pattern exactly. It is the established shape for a helper-binary-backed tool family and it
already solves the dual-backend problem.

`src/extensions/cymbal/tools.ts` exports bare `defineTool` definitions plus a `createCymbalTools(host)` factory that
attaches `execute` implementations over a `HelperBinaryExec`. `src/extensions/cymbal/index.js` registers those tools as
a Pi extension. `src/shared/session/backends/claude-cli/capability-tools.ts` re-creates the same factory output for the
Claude CLI MCP bridge. One implementation, two backends, no duplication.

`src/extensions/ketch/` mirrors that structure. New files are TypeScript because `deno task language-policy:check` fails
new `.js` under `src/`.

Every tool invocation passes `--json` and an explicit `-b <backend>`. The user's `ketch` config is read for credentials
only — `ketch` resolves API keys and the `gh` CLI token itself — and never for behavior. That is what makes "one
surface" true rather than aspirational.

Backend pins, each verified against an empty config home during planning:

| Tool              | `ketch` invocation          | Keyless | Verified                                                                                           |
| ----------------- | --------------------------- | ------- | -------------------------------------------------------------------------------------------------- |
| `web_search`      | `search -b keenable --json` | yes     | exit 0, results returned with `HOME` pointed at an empty directory                                 |
| `web_fetch`       | `scrape <url> --json`       | yes     | exit 0, `{url,title,markdown}` returned                                                            |
| `web_code_search` | `code -b grepapp --json`    | yes     | exit 0 with empty config; also observed exit 4 `grep.app returned status 504` under load           |
| `web_docs_search` | `docs -b context7 --json`   | **no**  | exit 5, `Error: context7: API key not set (get one then: ketch config set context7_api_key <key>)` |

`keenable` rather than `ddg`: `ddg` rate limits after one or two calls and returns exit 4, which would break an Agent
that searches three times in one turn on a fresh machine. `keenable` needs no key (`keenable_api_key_set: false` in the
probed config) and survived repeated sequential calls.

Two failure behaviors follow from the probe results and must be built in, not bolted on:

- **Backend failure is recoverable, not fatal.** `web_code_search` on `grepapp` returned exit 4 with a 504. The tool
  returns a structured error naming the working alternates (`sourcegraph`, `github`) and accepts an optional `backend`
  parameter so the Agent can retry. Same for `web_search` alternates (`ddg`, `brave`, `exa`, `searxng`).
- **A missing key is setup guidance, not an error the Agent must interpret.** `ketch docs` exit 5 already prints the
  exact remedy. `web_docs_search` passes that message through verbatim as its result text, so the user learns how to
  enable the tool at the moment they need it. `web_docs_search` is the one tool in the schema that cannot answer on a
  fresh machine; that is accepted, because library API lookup is the highest-value web call in a coding harness and a
  tool that teaches its own setup beats a Skill nobody loaded.

`web_search` returns titles and URLs by default and fuses retrieval only when asked.
`ketch search --scrape
--max-chars N` returns each result with its page body already extracted to markdown, and a probed
five-result fused search completed in about 1.4 seconds — concurrency, not serial fetching. The cost of fusing is
context size, not latency, so there is no hard cap: the Agent owns the depth decision through `scrape` and `maxChars`
parameters, and every result carries a `url` it can pass to `web_fetch` later.

## Files to Modify

- `src/extensions/ketch/tools.ts` — **new.** Four `defineTool` definitions plus `createKetchTools(host: KetchToolHost)`
  attaching `execute` over `HelperBinaryExec`. Owns backend pins, JSON parsing, output formatting, truncation, and
  structured error text.
- `src/extensions/ketch/index.ts` — **new.** Pi extension registering the four tools, mirroring
  `src/extensions/cymbal/index.js:26-46` (`session_start` updates `host.cwd`; `pi.registerTool` per tool). No `bash` or
  `grep` interception — that part of the Cymbal extension is Cymbal-specific.
- `src/extensions/ketch/tools.test.ts` — **new.** Unit tests over a fake `HelperBinaryExec` covering argument
  construction, JSON parsing per command, empty results, exit 4, and exit 5.
- `src/tools/registry.js` — add the four names to `PROTECTED_TOOL_NAMES` so a layered `.wld` override cannot strip them
  from an Agent that declares them.
- `src/shared/session/session.js` — import `ketchExtension` and add it to `extensionFactories` (near `cymbalExtension`,
  around line 1877) so Pi-backed sessions register the tools.
- `src/shared/session/backends/claude-cli/capability-tools.ts` — add the four names to
  `CLAUDE_CLI_CAPABILITY_TOOL_NAMES` and spread `createKetchTools(host)` into the tool list, so Claude CLI turns get
  them over the MCP bridge.
- `src/shared/session/backends/claude-cli/command.ts` — remove `"WebFetch"` and `"WebSearch"` from
  `CLAUDE_CLI_PROJECT_TOOL_NAMES`.
- `src/shared/session/backends/claude-cli/claude-cli-backend.test.ts` — lines 134-135 assert `WebFetch`/`WebSearch` are
  allowed; invert to assert they are absent and that the `web_*` aliases are present.
- `src/shared/session/claude-cli-execution.test.ts` — lines 174-175 assert the ketch Skill appears in the system prompt;
  replace with assertions that the `web_*` tools are bridged.
- `src/shared/session/session-catalog.test.js` — lines 236-247 use `ketch` as the bundled-Skill example; switch to a
  Skill that still exists (`research`).
- `src/shared/runtime-preflight.ts` — add `"ketch"` to the `RuntimeBinary` union and export `ensureKetchBinary()`.
- `src/shared/runtime-preflight.test.ts` — cover `ensureKetchBinary` alongside the existing binaries.
- `src/ui/tui/chat-session.js` — line 552 calls `ensureMnemosyneBinary()`; also call `ensureCymbalBinary()` and
  `ensureKetchBinary()`. `ensureCymbalBinary` currently exists but is called from nowhere in production, so the
  "required helper" guarantee is not actually enforced today; this makes it real for both.
- `install.sh` — add `KETCH_REPO="${WLD_KETCH_REPO:-1broseidon/ketch}"`, a `ketch` arm in `helper_asset_name`
  (`ketch_${version_no_v}_${WLD_OS}_${arch}.tar.gz`, with `amd64` mapped to `x86_64` as the `cymbal` arm does), and
  `install_helper ketch "$KETCH_REPO" required` with the abort message the other required helpers use.
- `scripts/install-test-helpers.js` — add `ketch` to `ReleaseBinaryName`, `VERSIONS`, `BINARY_NAMES`,
  `RELEASE_BINARY_NAMES`, `HELPER_NAMES`, the asset-name map, and the `curl` stub's release-API and redirect arms.
- `scripts/install-platforms.test.js` — extend the preserve/idempotence assertions to cover `ketch`.
- `Containerfile.wld-ux` — add `ketch` to both `command -v wld mnemosyne cymbal agent-browser snip` checks (lines 69,
  83).
- `src/agent-definitions/ideator.md` — add all four tools to `tools:`; rewrite the research guidance at lines 174-176 to
  name the tools instead of the Skill.
- `src/agent-definitions/architect.md` — add all four tools; rewrite the external-research guidance at line 190.
- `src/agent-definitions/planner.md` — add all four tools.
- `src/agent-definitions/guide.md` — add all four tools.
- `src/agent-definitions/engineer.md` — add `web_search`, `web_fetch`, `web_docs_search`.
- `src/agent-definitions/frontend-engineer.md` — add `web_search`, `web_fetch`, `web_docs_search`.
- `src/skills/ketch/SKILL.md` — **delete.** The directory is removed with it.
- `src/skills/research/SKILL.md` — rewrite the ketch-CLI instructions (lines 8, 18, 33-34, 39) to use the tools; remove
  the `../ketch/SKILL.md` link, which `deno task doc-links:check` would otherwise flag as broken.
- `src/skills/frontend-framework/ENGINEERING.md` — line 4 references the ketch Skill; name `web_docs_search`.
- `docs/customization.md` — line 69 lists `ketch` among bundled Skills; remove it.
- `docs/domain-language.md` — add the **Web Tools** entries to the `### Execution & Tools` section in the same change
  that makes them true.

## Reuse Opportunities

- `src/extensions/cymbal/tools.ts` — the exact structure to copy: exported bare tool definitions, a `createXTools(host)`
  factory, a private `runX(args, signal)` helper that formats non-zero exits as `Error (exit N): <cleaned stderr>`, and
  a `text()` helper that turns empty output into a plain "No results found."
- `src/extensions/helper-binary-exec.ts` — `HelperBinaryExec` and `denoHelperBinaryExec`. Already maps a missing binary
  to exit 127 with `command not found`, which the tools can surface as a preflight-style message.
- `src/extensions/cymbal/index.js` — the Pi extension registration shape.
- `src/shared/session/backends/claude-cli/capability-tools.ts` — the single insertion point that makes a helper-backed
  tool family reach Claude CLI. Its `byName` lookup throws on a missing tool, so a name added to the list without an
  implementation fails loudly at construction.
- `truncateCodeBatchOutput` in `src/extensions/cymbal/tools.ts:216-221` — the established truncation-with-marker
  pattern. `web_fetch` and fused `web_search` need the same treatment for oversized pages.
- `src/tools/registry.js` `PROTECTED_TOOL_NAMES` — the existing mechanism for tools that layered overrides must not
  remove.

## Implementation Steps

- [ ] `src/extensions/ketch/tools.ts` exports `createKetchTools` and exactly four tool definitions named `web_search`,
      `web_fetch`, `web_code_search`, and `web_docs_search`, each with a `promptSnippet`, and each `execute` invokes the
      `ketch` binary through the injected `HelperBinaryExec` with `--json` and an explicit `-b` backend argument
      (`keenable`, none for `scrape`, `grepapp`, `context7` respectively).
- [ ] `web_search` accepts `query`, optional `limit`, optional `scrape`, optional `maxChars`, and optional `backend`;
      with `scrape` absent it returns one line per result carrying title and URL parsed from the `[{title,url}]` JSON,
      and with `scrape` set it returns the `content` field per result.
- [ ] `web_fetch` accepts `url` and optional `maxChars`, and returns the `markdown` field of `ketch scrape`'s
      `{url,title,markdown}` JSON, truncated with an explicit marker when it exceeds the tool's char ceiling.
- [ ] `web_code_search` accepts `query`, optional `limit`, optional `lang`, optional `regex`, and optional `backend`,
      and returns `repo`, `path`, `line`, `snippet`, and `url` per result from the
      `[{repo,path,line,snippet,url,
      source}]` JSON.
- [ ] `web_docs_search` accepts `query`, optional `limit`, optional `library`, and optional `tokens`, returns `library`,
      `title`, and `snippet` per result from the `[{library,title,snippet}]` JSON, and on exit 5 returns `ketch`'s own
      stderr text containing `ketch config set context7_api_key` as a non-error result rather than an opaque failure.
- [ ] A non-zero `ketch` exit other than the `web_docs_search` key case produces a result whose text names the exit
      code, the cleaned `ketch` message, and the alternate backends accepted by that tool's `backend` parameter.
- [ ] `src/extensions/ketch/index.ts` default-exports a Pi extension that registers all four tools from
      `createKetchTools` and updates `host.cwd` on `session_start`.
- [ ] `src/shared/session/session.js` includes the ketch extension in `extensionFactories`, so a Pi-backed session for
      an Agent declaring `web_search` exposes a callable `web_search`.
- [ ] `CLAUDE_CLI_CAPABILITY_TOOL_NAMES` in `src/shared/session/backends/claude-cli/capability-tools.ts` contains the
      four `web_*` names and `createClaudeCliCapabilityTools({ cwd })` returns a tool for each without throwing.
- [ ] `CLAUDE_CLI_PROJECT_TOOL_NAMES` in `src/shared/session/backends/claude-cli/command.ts` contains neither
      `"WebFetch"` nor `"WebSearch"`.
- [ ] `PROTECTED_TOOL_NAMES` in `src/tools/registry.js` contains the four `web_*` names.
- [ ] `src/shared/runtime-preflight.ts` exports `ensureKetchBinary`, and `src/ui/tui/chat-session.js` calls
      `ensureKetchBinary` and `ensureCymbalBinary` on the same startup path that calls `ensureMnemosyneBinary`.
- [ ] `install.sh` installs `ketch` from `1broseidon/ketch` as a `required` helper with checksum verification, and
      `scripts/install-platforms.test.js` asserts `ketch` is preserved when already present and is not re-downloaded on
      a second run.
- [ ] `src/skills/ketch/` no longer exists, and no file under `src/agent-definitions/` or `src/skills/` contains the
      word `ketch`; the research, frontend-framework, Ideator, and Architect instructions name the `web_*` tools
      instead.
- [ ] `src/skills/research/SKILL.md` contains no link to `../ketch/SKILL.md` and `deno task doc-links:check` passes.
- [ ] `docs/domain-language.md` defines **Web Tools**, **Web-Search Tool**, **Web-Fetch Tool**, **Web-Code-Search
      Tool**, and **Web-Docs-Search Tool** in `### Execution & Tools`, each with an `_Avoid_` list, states that RunWield
      pins every backend and reads the user `ketch` config for credentials only, and the **Bridged Tool** entry's
      capability list mentions web access.
- [ ] `deno task ci` passes.

## Verification Plan

**Automated**

- `deno task ci` — the full gate, covering `check`, `lint`, `language-policy:check`, `seams:check`, `doc-links:check`,
  and `test`.
- `deno run -A scripts/run-tests.js src/extensions/ketch/tools.test.ts` — the new unit tests.
- `deno run -A scripts/run-tests.js src/shared/session/backends/claude-cli/` — bridge and command assertions.
- `deno run -A scripts/run-tests.js scripts/install-platforms.test.js scripts/install-integrity.test.js` — installer
  coverage for the new required helper.

**Manual**

- With `ketch` on `PATH`, start `wld`, select a Pi-backed model, and ask an Ideator session a question needing current
  facts. Confirm it calls `web_search`, not `bash ketch`.
- Repeat with a Claude CLI model. Confirm the same `web_search` tool is used and that Claude's native `WebSearch` is not
  offered.
- Run `HOME=$(mktemp -d) ketch docs "deno kv"`; confirm exit 5 and the `ketch config set context7_api_key` message. Then
  confirm `web_docs_search` surfaces that same text as a readable result.
- Temporarily rename the `ketch` binary and start `wld`; confirm startup fails with the installer message rather than an
  opaque tool error.

**Expected results**

- `web_search` with default parameters returns titles and URLs and completes in about one second.
- `web_search` with `scrape` set returns page content per result and stays within a few seconds for five results.
- `web_code_search` returns repository, path, line, and URL rows; on a `grep.app` outage it returns a readable error
  naming `sourcegraph` and `github` as alternates, and retrying with `backend: "sourcegraph"` succeeds.

**Behavior that must still be protected**

- `claude-cli-backend.test.ts` must continue to prove that project tools (`Read`, `Write`, `Edit`, `MultiEdit`, `Bash`,
  `EnterWorktree`) stay allowed and that lifecycle aliases appear exactly once. Only the `WebFetch`/`WebSearch`
  assertions change meaning.
- `session-catalog.test.js` must continue to prove that bundled Skills resolve from the runtime-readable cache. Only the
  example Skill changes.
- `claude-cli-execution.test.ts` must continue to prove that Skill descriptions and paths reach the Claude CLI system
  prompt. Only the specific Skill asserted changes.

**Behavior expected to stop existing**

- Claude CLI turns no longer have native `WebSearch` or `WebFetch`. Any test asserting their presence is wrong after
  this change and must be inverted, not deleted.
- The `ketch` bundled Skill no longer exists. Assertions that name it must move to another Skill, not be removed.

**Glossary**

- Confirm `docs/domain-language.md` describes the four tools as implemented, and does not describe `ketch crawl`,
  `ketch extract`, or a `web_crawl` tool, none of which this Plan builds.

## Edge Cases & Considerations

- **Making `ketch` required can break existing installs.** Anyone who upgrades `wld` without rerunning `install.sh` will
  hit the new startup preflight. The `missingBinaryError` message already names the installer command, so the remedy is
  one line, but this is a real upgrade-path break and is accepted as the cost of a tool that is always in the schema.
- **Air-gapped and sandboxed environments.** `ketch` presence is required; network reachability is not. Every tool
  returns a readable error rather than throwing when the backend is unreachable, so offline sessions degrade to a clear
  message instead of a crash.
- **Backend availability is outside RunWield's control.** `grep.app` returned 504 during planning and `ddg` rate limited
  within two calls. This is why every search-style tool exposes an optional `backend` parameter and names its alternates
  on failure.
- **`ketch` version drift.** The pinned backend names and the `--json` shapes were probed against `ketch` v0.13.0
  locally, while `install.sh` fetches the latest release. Argument construction should tolerate an unexpected JSON shape
  by returning the raw text rather than throwing on a parse failure.
- **Context cost.** Four tool schemas are always in the prompt for any Agent that declares them. This is why Router,
  Recorder, Operator, and Tester receive none.
- **Assumption — Agent tool distribution.** Ideator, Architect, Planner, and Guide receive all four; Engineer and
  Frontend Engineer receive `web_search`, `web_fetch`, and `web_docs_search` but not `web_code_search`, since public
  repository search is a research activity rather than an implementation one, and `frontend-framework/ENGINEERING.md`
  asks specifically for current framework documentation. This is the one open product decision in this Plan; change the
  per-Agent lists during review if the split should differ.
- **Assumption — Brave stays an optional upgrade.** RunWield never writes to the user's `ketch` config and the installer
  never prompts about backends. A user who sets a Brave or Context7 key gets better results; nothing in RunWield
  requires it.
- **`ketch crawl` and `ketch extract` stay uncovered.** Neither has a clear Agent use case that `web_fetch` does not
  already serve. Deliberately out of scope.
