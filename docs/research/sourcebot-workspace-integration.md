# Sourcebot Integration for RunWield Workspace

**Researched:** 2026-07-20 21:44 EDT

## Question

Can Sourcebot provide a tightly integrated, explicitly scoped cross-Project code-search experience for RunWield
Workspace without replacing Cymbal, weakening RunWield's Project boundaries, or making Sourcebot a mandatory part of the
personal self-hosted runtime?

This research informs the future Workspace PRD and the boundary between Project code search, cross-Project code search,
and the subordinate Code Surface.

## Findings

### Product and search capabilities

- Sourcebot is an actively maintained self-hosted code-search and code-understanding product. The latest release visible
  during research was `v5.1.3`. Its Basic tier includes multi-repository regex, symbol, language, file, repository, and
  branch-filtered search, plus a file browser, Git history, and blame. Sources:
  <https://github.com/sourcebot-dev/sourcebot/releases>, <https://www.sourcebot.dev/pricing>,
  <https://docs.sourcebot.dev/docs/features/search/overview>
- Sourcebot uses Zoekt trigram indexes for code search and universal-ctags symbols. Its paid code navigation derives
  definitions and references through search heuristics rather than a language-server-quality semantic graph. Sources:
  <https://docs.sourcebot.dev/docs/deployment/infrastructure/architecture>,
  <https://docs.sourcebot.dev/docs/features/code-navigation>
- Queries can be explicitly restricted by repository, revision, file, language, and symbol. Paid Search Contexts add
  named repository groups, but RunWield could enforce explicit Project selection with ordinary `repo:` filters without
  depending on Search Contexts. Sources: <https://docs.sourcebot.dev/docs/features/search/syntax-reference>,
  <https://docs.sourcebot.dev/docs/features/search/search-contexts>

### Integration APIs

- Sourcebot now publishes an OpenAPI-described public API. Relevant endpoints include blocking code search, repository
  listing, file contents/tree, diffs, blame, commits, and symbol definition/reference search. Search responses include
  repository identity, matched chunks and locations, and Sourcebot web URLs suitable for deep links. Sources:
  <https://docs.sourcebot.dev/llms.txt>, <https://docs.sourcebot.dev/api-reference/sourcebot-public.openapi.json>,
  <https://docs.sourcebot.dev/api-reference/search-%26-navigation/search-code>
- API requests use Sourcebot API keys as bearer tokens. Anonymous access can expose some endpoints, but authenticated
  server-to-server access is the appropriate RunWield integration boundary. Source:
  <https://docs.sourcebot.dev/docs/api-reference/authentication>
- Sourcebot offers a Streamable HTTP MCP server with code search, repository listing, file reads, trees, commits, diffs,
  definitions/references, and Ask Sourcebot. In v5 the MCP server and Ask Sourcebot moved to the paid commercial tier.
  Sources: <https://docs.sourcebot.dev/docs/features/mcp-server>,
  <https://docs.sourcebot.dev/docs/upgrade/v4-to-v5-guide>
- No first-party embeddable UI SDK or documented iframe integration was found. Sourcebot is a complete Next.js
  application with its own navigation and identity model. Its APIs and result `webUrl` values provide a cleaner
  integration seam than embedding or forking its UI. Sources:
  <https://docs.sourcebot.dev/docs/deployment/infrastructure/architecture>, <https://docs.sourcebot.dev/llms.txt>

### Local Project compatibility

- Current Sourcebot supports local Git repositories through read-only `file:///...` connections and glob patterns. The
  container must receive the repositories through mounted volumes. Each indexed directory must be a Git repository root
  and must have `remote.origin.url`; other directories are skipped. Source:
  <https://docs.sourcebot.dev/docs/connections/local-repos>
- Local repositories are read-only to Sourcebot, and Sourcebot indexes Git revisions. This is a good fit for committed
  main-branch history, but it is not a replacement for Cymbal's active working-tree view. Empty Projects, non-Git
  Projects, uncommitted code-server edits, and transient Plan worktree contents do not cleanly fit Sourcebot's local
  repository contract. Source: <https://docs.sourcebot.dev/docs/connections/local-repos>
- Sourcebot watches its declarative configuration file for changes. Its default full repository reindex interval is one
  hour, although the interval is configurable. This makes registration automation feasible but does not provide
  real-time working-copy indexing. Source: <https://docs.sourcebot.dev/docs/configuration/config-file>

### Operational footprint

- Sourcebot v5 uses a Sourcebot container plus required Postgres and Redis services. Its architecture also includes a
  backend worker, Zoekt, and persistent index/cache storage. Sources:
  <https://docs.sourcebot.dev/docs/deployment/infrastructure/architecture>,
  <https://docs.sourcebot.dev/docs/upgrade/v4-to-v5-guide>,
  <https://github.com/sourcebot-dev/sourcebot/blob/main/docker-compose.yml>
- The official minimum for a small deployment is 2 CPU cores, 4 GB RAM, and about 50 GB disk. Sourcebot recommends disk
  capacity of roughly two to three times the indexed source size. Multi-branch indexing can substantially increase
  storage. Source: <https://docs.sourcebot.dev/docs/deployment/sizing-guide>
- This footprint is reasonable for an optional organization-scale service but heavy for a mandatory personal Workspace
  dependency that otherwise runs directly on a developer laptop.

### Authentication and permissions

- Sourcebot v5 has mandatory built-in authentication by default. Its documentation says the authentication system cannot
  currently be disabled; anonymous access is a separately configured mode. Sourcebot uses Auth.js and maintains its own
  accounts and sessions. Sources: <https://docs.sourcebot.dev/docs/configuration/auth/authentication>,
  <https://docs.sourcebot.dev/docs/configuration/auth/faq>
- Sourcebot permission syncing, SSO-oriented enterprise controls, audit logs, and managed role behavior are paid
  features. Permission syncing can constrain web, API/MCP, Ask, and navigation results to repositories visible to the
  Sourcebot user. Sources: <https://docs.sourcebot.dev/docs/features/permission-syncing>,
  <https://www.sourcebot.dev/pricing>
- Sourcebot's independent identity model does not naturally inherit RunWield's private-network plus owner-approved
  device-pairing session. A backend API-key integration can avoid a second login for RunWield-rendered search results;
  opening the full Sourcebot UI would still cross into Sourcebot's authentication surface unless a separate supported
  identity integration is configured.

### Licensing

- Sourcebot core is currently under the Functional Source License 1.1 with an Apache 2.0 future license after two years.
  The FSL permits internal use but prohibits a commercial product or service that substitutes for Sourcebot or offers
  substantially similar functionality. `ee` portions use a separate commercial license. Source:
  <https://github.com/sourcebot-dev/sourcebot/blob/main/LICENSE.md>
- Since RunWield Workspace intends to offer integrated multi-Project code search, bundling, modifying, or presenting
  Sourcebot as a built-in commercial RunWield feature creates material license ambiguity. Consuming a separately
  deployed, user-licensed Sourcebot instance through its documented API is lower risk, but any commercial distribution
  or managed SaaS integration still deserves explicit vendor permission or legal review.

## Inference

Sourcebot is a strong fit for **committed, cross-repository human code search** and a weak fit for **live local Project
understanding**.

Its public API is sufficiently rich for RunWield to render a native Workspace search experience with explicit Project
selection, Sourcebot-backed results, and deep links into Sourcebot's file browser. That is a tighter and more coherent
integration than an iframe while preserving the RunWield Design System and authentication boundary.

Sourcebot should not replace Cymbal:

- Cymbal remains the Agent-facing, current-Project source of working-tree-aware semantic code exploration.
- Sourcebot can optionally search committed code across selected Projects or remote repositories.
- Sourcebot's MCP and Ask features duplicate RunWield Agent responsibilities, require a paid Sourcebot plan in v5, and
  would create a second Agent context policy. They are not necessary for the first integration.

Sourcebot should also not be a mandatory dependency of the personal Workspace proof. Its Docker/Postgres/Redis
footprint, separate authentication system, commit-oriented local indexing, and FSL commercial-use boundary add
disproportionate complexity before the core Workspace workflow is proven.

## Recommendation

Treat Sourcebot as an **optional external cross-Project code-search provider**, not an embedded RunWield subsystem.

Recommended product boundary:

1. The owner connects an existing self-hosted Sourcebot instance to Workspace using its base URL and an API key.
2. Workspace maps registered Projects to Sourcebot repository identities and exposes only explicitly selected Projects
   to each cross-Project query.
3. Workspace calls the documented public API and renders search results using the RunWield Design System.
4. Results deep-link to Sourcebot for its full file browser, blame, and history experience; Workspace does not iframe or
   fork Sourcebot.
5. Cymbal remains responsible for current-Project Agent search and active local working-tree truth.
6. Sourcebot MCP, Ask Sourcebot, code review Agents, and paid Search Contexts remain out of scope.
7. Sourcebot health, index freshness, indexed revision, and unmapped Projects are visible so users do not mistake stale
   committed-code results for the current checkout.
8. Before a bundled or SaaS-managed Sourcebot offering, obtain explicit licensing clarity from Taqla/Sourcebot.

For the personal proof, Sourcebot integration should be optional or deferred until the Attention Dashboard, persistent
Session Host, Project registration, and core Session/Plan workflow are working.

## Open Questions

- Does Taqla consider a commercial Workspace UI over Sourcebot's public API a competing use under FSL, or is an explicit
  integration agreement available?
- Are public search, file, diff, and symbol endpoints contractually included in the Basic plan, or merely technically
  present without a stable free-tier guarantee?
- Can Sourcebot provide a supported identity handoff or signed deep-link mechanism compatible with RunWield device
  pairing, avoiding a second login when opening Sourcebot's UI?
- How quickly and reliably do local read-only connections detect new commits when `reindexIntervalMs` is reduced, and
  what resource cost follows on a developer laptop?
- Should a future SaaS Workspace connect to a customer's Sourcebot deployment, run a licensed Sourcebot instance per
  organization, or provide cross-repository search through a different RunWield-owned service?
