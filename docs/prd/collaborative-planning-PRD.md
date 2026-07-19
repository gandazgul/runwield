# Collaborative Planning — PRD

**Status:** Current self-hosted SQLite implementation with hardening follow-up **Author:** Gandazgul **Last Updated:**
2026-07-18

---

## 1. Objective

Enable RunWield users to share Plans with teammates and stakeholders, collect structured encrypted feedback in a Shared
Space, and iteratively refine Plans through Revision cycles without requiring accounts, GitHub, or local tooling for
reviewers.

## 2. Problem Statement

RunWield is local-first. Users can create durable markdown Plans locally, but team review needs:

- readable browser access for technical and non-technical stakeholders;
- comments attached to specific Plan text or to the whole Revision;
- one stable link that survives Revision updates;
- maintainer handoff without accounts; and
- server-side privacy where semantic Plan/comment content remains ciphertext.

Chat-based feedback fragments long-form review. Immutable snapshot links fragment discussion across multiple URLs. A
remote-canonical Shared Space with explicit local Shared Plan Lock keeps one collaboration surface while preserving
local Plan lifecycle semantics.

## 3. Resolved Decisions

| Decision                                                        | Current product reality                                                                                                                                                                                         |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Shared Space, not immutable snapshots**                       | One Shared Space contains Revisions and per-Revision comments. Comments do not carry over to new Revisions.                                                                                                     |
| **Self-hosted SQLite first**                                    | V1 is a source-built Deno/Astro/React Workspace Plan Server with SQLite, Dockerfile, and Docker Compose. Published images, Cloudflare/D1, and hosted RunWield Workspace are deferred.                           |
| **Remote-canonical while shared**                               | Local Plans carry non-secret collaboration Front Matter and enter a hard Shared Plan Lock. Pull/push/unshare are the controlled mutation paths.                                                                 |
| **Encryption: client-side only**                                | Plan bodies, comment bodies, display names, selected/original text, and annotation metadata are encrypted before upload. Content keys live in URL fragments and local secret stores.                            |
| **Authorization: bearer capabilities, no accounts**             | Reviewer and maintainer links carry capability material. The server stores only capability hashes. Reverse proxies must preserve `Authorization: Bearer`; generic Basic Auth is not recommended.                |
| **Accountless public operation is bounded, not solved by auth** | Public self-hosting may be placed behind Nginx/equivalent rate limits and optional inactivity retention. A separate creation credential is deferred until its CLI storage/rotation UX is designed.              |
| **CLI-owned destructive lifecycle**                             | Browser review supports read/comment/resolve/reopen/revision switching. Push, close, browser Plan body editing, and destructive unshare/delete controls are not exposed in the browser v1; unshare is CLI-only. |
| **Planner/Architect incorporation on pull**                     | `wld plans pull` decrypts Revisions/comments locally and launches the appropriate planning Agent with review context.                                                                                           |

## 4. Architecture Overview

```text
wld CLI                         Plan Server                         Browser reviewer
share/pull/push/unshare  <-->   /api/spaces + SQLite ciphertext  <--> /p/<space-id>#key=...&cap=...
```

- The Plan Server serves HTTP inside the deployment boundary. Operators own TLS termination through Nginx or an
  equivalent reverse proxy.
- Docker Compose binds the container to host loopback by default. Public exposure is intentional proxy configuration.
- SQLite is file-backed under `/data`, uses WAL, and is intended for a single active Plan Server container.
- `/healthz` is liveness; `/readyz` checks SQLite readiness.
- `RUNWIELD_REMOTE_MAX_REQUEST_BYTES` defaults to 5 MiB for complete JSON request bodies.
- Optional `RUNWIELD_REMOTE_RETENTION_DAYS` adds visible inactivity expiry. Writes refresh expiry; reads do not; cleanup
  hard-deletes expired ciphertext and capability hashes.

## 5. Implemented Shared Space API Contract

All semantic payloads are ciphertext. API errors are structured JSON with `error`, `message`, and `status`.

| Endpoint                                                 | Authorization                 | Purpose                                                                                  |
| -------------------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------- |
| `POST /api/spaces`                                       | none in v1                    | Create a Shared Space from capability hashes and an encrypted initial Revision.          |
| `GET /api/spaces/:spaceId`                               | reviewer or maintainer bearer | Read Shared Space metadata, status, latest Revision, optional expiry, and Revision list. |
| `GET /api/spaces/:spaceId/revisions/:revision`           | reviewer or maintainer bearer | Read one encrypted Revision payload.                                                     |
| `POST /api/spaces/:spaceId/revisions`                    | maintainer bearer             | Append the next encrypted Revision.                                                      |
| `GET /api/spaces/:spaceId/revisions/:revision/comments`  | reviewer or maintainer bearer | List encrypted comments scoped to one Revision.                                          |
| `POST /api/spaces/:spaceId/revisions/:revision/comments` | reviewer or maintainer bearer | Append one encrypted comment.                                                            |
| `POST /api/spaces/:spaceId/comments/:commentId/state`    | reviewer or maintainer bearer | Resolve or reopen a comment.                                                             |
| `POST /api/spaces/:spaceId/lifecycle`                    | maintainer bearer             | Close or destructively delete the Shared Space.                                          |

Plaintext server metadata is limited to ids, `planId`, status, Revision numbers, timestamps, resolved flags, optional
`expiresAt`, and capability hashes. Deleted and expired Shared Spaces use not-found/deleted semantics so local Plans
remain locked until explicit maintainer recovery.

## 6. CLI Commands

| Command                                              | Description                                                                                                                                                                                     |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wld plans share <plan-name-or-id>`                  | Encrypt a local Plan, create a remote Shared Space, store local secrets, lock the local Plan, and print reviewer/maintainer URLs once. Reports expiry when retention is enabled.                |
| `wld plans pull <maintainer-url-or-plan-name-or-id>` | Fetch and decrypt latest Revision/comments, import maintainer secrets when a URL is provided, update/create a locked local Plan, report expiry when present, and launch Planner/Architect.      |
| `wld plans push <plan-name-or-id>`                   | Encrypt the accepted local Plan body and append it as the next remote Revision.                                                                                                                 |
| `wld plans unshare <plan-name-or-id>`                | CLI-only destructive delete/recovery command using maintainer authorization; clears local matching secrets and lock metadata only after safe remote delete or confirmed deleted-remote cleanup. |

## 7. Deployment Model

### Self-hosted source-built package

- Deno remote Workspace Plan Server.
- Astro/React remote review UI reusing Plannotator annotation primitives.
- SQLite under a persistent `/data` volume.
- Dockerfile and Docker Compose in the repository.
- Loopback-only host port by default.
- Nginx example for public TLS termination, bearer-header preservation, request-size limits, and rate limits.
- Backup/restore/upgrade guidance based on stopped-service SQLite volume copies.

### Hosted / Cloudflare follow-up

Cloudflare/D1 and hosted RunWield Workspace remain deferred. They must preserve the ciphertext-only semantic-content
invariant, capability model, and remote-canonical local lock behavior.

## 8. Out of Scope for Current V1

- User accounts or full role-based access control.
- Built-in public-instance creation authentication.
- RunWield-managed TLS or certificate renewal.
- Real-time collaborative editing or browser Plan body editing.
- Browser-side push, close, or destructive unshare/delete controls.
- Notifications.
- Attachments in comments.
- Diff view between Revisions.
- Hosted SaaS or Cloudflare/D1 deployment.
- Published signed/versioned multi-architecture container images.

## 9. Success Metrics

- A maintainer can self-host the source-built Plan Server, share a Plan, receive comments from at least two reviewers,
  pull comments locally, revise through Planner/Architect, push a new Revision, and unshare safely.
- A network capture and SQLite inspection show only ciphertext for Plan/comment semantic content.
- A public trial deployment can be placed behind a reverse proxy with request/rate limits and optional seven-day
  inactivity retention without RunWield owning TLS or adding accounts.
- Backup/restore instructions recover Revisions/comments/capability hashes from the SQLite volume and `/readyz` confirms
  the restored server.

## 10. Future Work

- Creation credentials or another abuse-resistant public creation model with CLI storage, rotation, and recovery UX.
- Hosted RunWield Workspace and Cloudflare/D1 deployment.
- Published signed container images and release provenance.
- Notifications and activity/audit feeds.
- Browser diff view between Revisions.
- Optional export/summary view for closed Shared Spaces.
