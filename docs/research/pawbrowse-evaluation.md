# PawBrowse Evaluation

**Researched:** 2026-09-27\
**Status:** Recommendation only; no replacement approved.

## Question

Should RunWield replace Agent Browser with PawBrowse as its browser tool for Agents?

## Recommendation

**Keep Agent Browser as the default.** PawBrowse is worth a bounded trial if users need Agents to act in their existing,
logged-in Chrome tabs. That is a different need from isolated UI verification. Do not add a second required tool without
that need.

This is a source and documentation review, not a runtime comparison. No browser tools were installed or changed.

## Findings

### Current RunWield use

RunWield's [browser Skill](../../src/skills/agent-browser/SKILL.md) asks Agents to use worktree-specific browser
sessions, keep headed windows available during active work, test desktop and mobile views, save screenshots, and check
console, page errors, and network failures. Its [installer](../../install.sh) provisions Agent Browser outside the
target Project. A replacement must preserve these outcomes, not just navigation and form entry.

### Comparison

| Need                 | Agent Browser                                                                             | PawBrowse                                                                                                                   |
| -------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Existing login state | Profile copies, persistent profiles, saved auth, or CDP attachment                        | Drives existing Chrome tabs through an extension; no debug-port relaunch                                                    |
| Concurrent work      | Separate browser instances with separate cookies and storage by default                   | Separate tab groups inside the same browser profile                                                                         |
| UI evidence          | Screenshots, diffs, viewport/device controls, console/errors, network diagnostics, traces | Current MCP surface includes viewport screenshots and page assertions, but no equivalent diagnostic or device-control tools |
| Setup                | CLI and browser installation; already provisioned by RunWield                             | Chrome extension, Node 18+, and MCP server connection                                                                       |
| Interaction loop     | Compact accessibility snapshots and reference-based actions                               | Compact control table; actions return updated rows or a fresh table                                                         |

Sources: [Agent Browser overview](https://agent-browser.dev), [sessions](https://agent-browser.dev/sessions),
[debugging](https://agent-browser.dev/debugging),
[PawBrowse README](https://github.com/ItaiZeilig/pawbrowse/blob/12a24522c9b1e8167438ba4f2a17f123482c24f7/README.md),
[MCP tool definitions](https://github.com/ItaiZeilig/pawbrowse/blob/12a24522c9b1e8167438ba4f2a17f123482c24f7/mcp/server.mjs),
[extension source](https://github.com/ItaiZeilig/pawbrowse/blob/12a24522c9b1e8167438ba4f2a17f123482c24f7/extension/background.js).

### Important qualifications

- **The PawBrowse README is stale in places.** Current source includes multiple client connections, screenshots,
  uploads, and cross-origin frame support. The README still lists some as unsupported. Package metadata says 0.6.5; the
  MCP initialization response still says 0.5.1. The changelog records active fixes through September 27. These are
  maintenance signals, not proof of poor runtime reliability. Sources: pinned source above,
  [package](https://github.com/ItaiZeilig/pawbrowse/blob/12a24522c9b1e8167438ba4f2a17f123482c24f7/package.json),
  [changelog](https://github.com/ItaiZeilig/pawbrowse/blob/12a24522c9b1e8167438ba4f2a17f123482c24f7/CHANGELOG.md).
- **Its speed claim is not an Agent Browser comparison.** The README compares one task against Claude in Chrome. Its
  timing model uses round-trip count multiplied by fixed latency, not measured end-to-end duration. Agent Browser also
  uses compact text snapshots. No RunWield performance advantage is established.
- **Tab groups are not auth isolation.** PawBrowse separates default tab selection, not cookies or site storage.
  Explicit tab targeting also does not enforce exclusive ownership in the inspected source. Two tasks on the same site
  can affect shared login state. Source: pinned extension source above.
- **Existing-profile access changes the risk.** PawBrowse has no per-site permission gate in its documented comparison.
  Its local broker has no pairing token in the inspected source. This does not establish an exploit, but it warrants
  review before broad distribution. Agent Browser offers optional domain and action restrictions; they are not enabled
  by default. Sources:
  [PawBrowse broker](https://github.com/ItaiZeilig/pawbrowse/blob/12a24522c9b1e8167438ba4f2a17f123482c24f7/mcp/broker.mjs),
  [Agent Browser security](https://agent-browser.dev/security).
- **Local transport does not mean local model processing.** PawBrowse returns page content to the calling Agent. If that
  Agent uses a hosted model, the content can enter that model's context. Its lack of a separate AI service does not
  change the calling Agent's data flow.

## Inference

PawBrowse offers a useful convenience: act in the user's current browser without a debug-port relaunch. Its automatic
post-action observation could reduce Agent turns. Neither advantage justifies losing the current diagnostic surface or
sharing authentication state across verification tasks.

A second tool would also add setup, support, and tool-selection costs. For login reuse alone, first test Agent Browser's
existing profile support. For operating the user's exact open tab, a PawBrowse trial is more relevant.

## Open Questions

- Is the unmet need login setup, operation of existing tabs, speed, or unreliable interaction with particular controls?
- Can a trial complete the same representative journeys with fewer retries, lower total cost, and equivalent evidence?
- Do the published extension and npm package match the reviewed source? The Chrome Web Store build was not verified.

No live reliability, speed, security, or cross-platform claims were verified. Agent Browser documentation links are
live; PawBrowse source links are pinned to the reviewed commit.
