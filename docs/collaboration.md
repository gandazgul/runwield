# Self-Hosted Collaborative Planning

RunWield can share a local Plan into a remote-canonical encrypted **Shared Space** so teammates can review it in a
browser without installing RunWield. The v1 collaboration path is self-hosted first: you run a Deno Workspace Plan
Server with SQLite storage, then point `wld plans share|pull|push|unshare` at that Plan Server.

Hosted RunWield Workspace and Cloudflare/D1 deployment are deferred follow-up work. This guide uses placeholder domains
such as `https://plans.example.com`; replace them with your own host.

## Run the Plan Server with Docker Compose

From the repository root:

```bash
docker compose up -d
curl http://127.0.0.1:8080/healthz
```

The compose service exposes the remote Workspace Plan Server on port `8080` and persists SQLite data in the
`runwield-plan-server-data` Docker volume at `/data/runwield-shared-spaces.sqlite` inside the container.

Useful environment variables:

| Variable                            | Default                               | Purpose                                               |
| ----------------------------------- | ------------------------------------- | ----------------------------------------------------- |
| `RUNWIELD_REMOTE_HOST`              | `0.0.0.0`                             | Bind host inside the container.                       |
| `RUNWIELD_REMOTE_PORT`              | `8080`                                | HTTP port inside the container.                       |
| `RUNWIELD_REMOTE_DB_PATH`           | `/data/runwield-shared-spaces.sqlite` | SQLite database path.                                 |
| `RUNWIELD_WORKSPACE_REMOTE_DB_PATH` | unset                                 | Backward-compatible alternate database path variable. |

For source development without Docker:

```bash
RUNWIELD_REMOTE_HOST=127.0.0.1 \
RUNWIELD_REMOTE_PORT=8080 \
RUNWIELD_REMOTE_DB_PATH=.wld/remote-workspace.sqlite \
deno task workspace:remote
```

The remote server mode does not mount or serve local Plan files. It registers only the Shared Space browser/API routes,
static Workspace assets, and `/healthz`.

## Public URL and reverse proxy

The URL used by `wld plans share` must be the externally reachable Plan Server URL. For local testing that is usually:

```text
http://127.0.0.1:8080
```

For a team deployment, put the container behind a reverse proxy with TLS and use a public base URL such as:

```text
https://plans.example.com
```

Make sure the proxy forwards normal HTTP requests to the container and does not log `Authorization` headers. Browser URL
fragments such as `#key=...&cap=...` are not sent to the server by browsers, but the remote review client reads the
fragment and sends the bearer capability in an `Authorization: Bearer ...` header for API calls.

If you need instance-level access control, put HTTP Basic Auth, SSO, VPN, or an auth proxy in front of the Plan Server.
RunWield v1 itself has no accounts; access is based on possession of reviewer or maintainer capability links.

## Configure the CLI Plan Server URL

`planServerUrl` is a non-secret setting containing only the normalized Plan Server base URL. It must not include
`/p/<space-id>`, query parameters, or a `#key=...` fragment.

Project setting example in `.wld/settings.json`:

```jsonc
{
    "planServerUrl": "https://plans.example.com"
}
```

Global setting example in `~/.wld/settings.json`:

```jsonc
{
    "planServerUrl": "http://127.0.0.1:8080"
}
```

For one command, pass `--plan-server` instead of editing settings:

```bash
wld plans share my-plan --plan-server http://127.0.0.1:8080
```

Pull, push, and unshare refuse a `--plan-server` override that does not match the Plan's stored
`collaborationServerUrl`, so a maintainer cannot accidentally mutate a different Plan Server.

## Collaboration workflow

1. Share an active local Plan:

   ```bash
   wld plans share my-plan
   ```

   RunWield encrypts the Plan payload, creates a remote Shared Space, writes non-secret collaboration metadata to the
   Plan Front Matter, stores secrets locally, and prints reviewer and maintainer URLs once.

2. Send reviewer URLs to stakeholders. Reviewers open the browser page, enter a display name, add global or inline
   comments, and resolve/reopen comments as needed. Reviewer URLs can read, comment, resolve, and reopen; they cannot
   pull, push, close, or unshare from the CLI.

3. Pull feedback as a maintainer:

   ```bash
   wld plans pull my-plan
   # or, in another checkout:
   wld plans pull '<maintainer-url>' --to my-plan
   ```

   Pull decrypts the latest Revision and its comments locally, updates or creates a locked local Plan, and launches
   Planner or Architect with decrypted review context for incorporation.

4. After accepting the local Plan revision, publish it:

   ```bash
   wld plans push my-plan
   ```

   Push encrypts the current local Plan body as the next remote Revision. The same reviewer link remains valid and can
   switch between Revisions; comments remain scoped to the Revision where they were created.

5. When review is intentionally over and the remote Shared Space should be removed:

   ```bash
   wld plans unshare my-plan
   ```

   Unshare is destructive and CLI-only in v1. It requires maintainer secrets, deletes the remote Shared Space, removes
   matching local collaboration secrets, and clears local Shared Plan Lock metadata. `--force` skips prompts but not
   authorization or safety checks.

## Privacy model

The Plan Server stores ciphertext for semantic content:

- Plan bodies and Plan metadata payloads intended for review.
- Comment bodies.
- Reviewer display names.
- Original/selected text and annotation anchor/context metadata.

Allowed plaintext server metadata is limited to routing and lifecycle data such as Shared Space ids, `planId`, status,
Revision numbers, timestamps, resolved flags, and capability hashes. Raw content keys, raw bearer capabilities,
maintainer URLs, reviewer URLs, and plaintext comments must not be stored in SQLite, Plan Front Matter, normal settings,
logs, docs, commits, or issue trackers.

Content keys live in the browser URL fragment and local secret stores. The fragment is not sent in HTTP requests. Bearer
capabilities authorize API requests and are stored on the server only as hashes.

## Secret storage

By default, maintainer secrets are stored in:

```text
~/.wld/collaboration-secrets.json
```

With `--project-secrets`, RunWield uses the ignored project-local file:

```text
.wld/collaboration-secrets.json
```

The project-local secret store is ignored by this repository's `.gitignore`. Do not remove that ignore rule. Treat
maintainer URLs like passwords: anyone with a maintainer URL can import maintainer capability material and then pull,
push, or unshare the Shared Space.

## Recovery cases

- **Lost local secrets:** re-import them by running `wld plans pull '<maintainer-url>'`. A reviewer URL is not enough
  for maintainer actions.
- **Reviewer-only URL:** can review in the browser but cannot pull, push, or unshare. Ask a maintainer for a maintainer
  URL if you need CLI maintenance access.
- **Deleted remote:** pull/push will report not found or deleted state and leave local Shared Plan Lock metadata in
  place. Run `wld plans unshare <plan>` and confirm the already-deleted cleanup path to clear local metadata/secrets.
- **Unavailable Plan Server or 5xx/network failure:** local Plans stay locked because RunWield cannot prove whether the
  remote is safe to detach. Retry when the server is reachable.
- **Wrong capability or wrong Plan Server:** commands fail without local cleanup. Check that you are using a maintainer
  URL and the Plan's stored Plan Server URL.
- **Out-of-band local edits while locked:** RunWield detects body-hash divergence and refuses silent overwrite. Pull or
  resolve recovery explicitly instead of editing remote-canonical Plans directly.

## Manual end-to-end checklist

Use this checklist after changing packaging or collaboration behavior:

1. `docker compose up -d`.
2. Confirm `curl http://127.0.0.1:8080/healthz` returns `{"ok":true,"mode":"remote"}`.
3. Configure `planServerUrl` or pass `--plan-server http://127.0.0.1:8080`.
4. Run `wld plans share <plan>` and save the reviewer and maintainer URLs securely.
5. Open the reviewer URL in a browser and add comments from two display names.
6. Resolve and reopen at least one comment.
7. In another checkout, run `wld plans pull '<maintainer-url>' --to <plan-name>`.
8. Let Planner or Architect incorporate the feedback into the local Plan.
9. Run `wld plans push <plan-name>`.
10. Reopen the reviewer URL and verify the new Revision is available while older Revision comments stay scoped.
11. Inspect SQLite and representative network payloads for ciphertext-only semantic content.
12. Run `wld plans unshare <plan-name>` and verify old reviewer/maintainer links stop working.
