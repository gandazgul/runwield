# Collaborative Planning — PRD

**Status:** Draft v1, implementation updated for self-hosted SQLite packaging **Author:** Gandazgul **Last Updated:**
2026-07-16

---

## 1. Objective

Enable RunWield users to share plans with their team (technical and non-technical), collect structured feedback in a
shared space, and iteratively refine plans through revision cycles — all with end-to-end encryption so the server
(including any self-hosted instance) never sees plaintext plan content.

## 2. Problem Statement

RunWield is currently a single-user planning tool. Users generate plans locally but have no mechanism to:

- Share a plan with non-technical stakeholders (PMs, designers, clients) in a readable format.
- Collect and organize feedback tied to specific parts of the plan.
- Iterate on the plan with the team's input without losing context or creating link fragmentation.
- Do any of this without requiring every participant to have a GitHub account or install tooling.

Chat-based solutions (Slack, Discord, Telegram) are structurally unsuited for long-form document review. Immutable
snapshot models (Plannotator's current approach) fragment discussion across multiple links. A **shared space** model
with revision tracking solves both problems.

## 3. Resolved Assumptions

| Decision                                            | Rationale                                                                                                                                                                                                  |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Shared Space, not immutable snapshots**           | Single link for the team; comments stay in one place per Revision. Reduces friction for non-technical users.                                                                                               |
| **Self-hosted SQLite first**                        | The implemented v1 packages the remote Workspace Plan Server as Docker + SQLite. Hosted RunWield Workspace and Cloudflare/D1 remain deferred follow-up work.                                               |
| **Astro/React remote Workspace**                    | The current browser implementation lives under `src/ui/workspace/` and reuses Plannotator-backed markdown annotation primitives. Older Fresh/Preact wording is stale.                                      |
| **Encryption: client-side only**                    | Plans and comments are encrypted before upload. The server stores ciphertext for semantic content. The content key lives in the URL fragment and local secret stores, never in normal server request URLs. |
| **Authorization: bearer capabilities, no accounts** | Reviewer and maintainer links carry bearer capability material. The server stores capability hashes, not raw capabilities. Optional HTTP Basic/Auth proxy can sit in front of a self-hosted instance.      |
| **Revisions: comments don't carry over**            | Each Revision is a frozen snapshot with its own comments. Reviewers can inspect prior Revisions; current planning should use the latest accepted Revision.                                                 |
| **Planner/Architect incorporation on pull**         | `wld plans pull` decrypts Revisions/comments locally and launches Planner or Architect with review context.                                                                                                |
| **No automated notifications v1**                   | Maintainers share updated URLs manually. Future notification integrations remain out of scope.                                                                                                             |
| **CLI-owned destructive lifecycle**                 | Browser review supports read/comment/resolve/reopen. Push, close, browser body editing, and destructive unshare/delete controls are not exposed in the browser v1; unshare is CLI-only.                    |

## 4. Technical Approach

### 4.1 Architecture Overview

```
┌─────────────────────────────────────────────────┐
│  Client (wld CLI)                               │
│  wld plans share │ wld plans pull │ wld plans push │
│  ┌─────────────┐  ┌────────────┐  ┌───────────┐ │
│  │ encrypt plan │  │ decrypt +  │  │ encrypt + │ │
│  │ POST → API   │  │ display +  │  │ POST rev  │ │
│  │              │  │ LLM offer  │  │           │ │
│  └─────────────┘  └────────────┘  └───────────┘ │
└────────────────┬────────────────────────────────┘
                 │ REST API (backend-agnostic)
                 ▼
┌─────────────────────────────────────────────────┐
│  Backend                                        │
│  ┌──────────┐  ┌────────────┐  ┌──────────────┐ │
│  │ D1 / SQL │  │ Encrypted  │  │ Append-only  │ │
│  │ plans    │  │ blobs only │  │ comment feed │ │
│  │ revisions│  │            │  │              │ │
│  └──────────┘  └────────────┘  └──────────────┘ │
└─────────────────────────────────────────────────┘
                 ▲
                 │ Rendered plan + comment UI
┌─────────────────────────────────────────────────┐
│  Web Viewer (static client-side JS)              │
│  • Decrypt plan from URL hash or paste fetch     │
│  • Render markdown                               │
│  • Plannotator-style inline + global comments    │
│  • Revision switcher (sidebar)                   │
│  • Submit encrypted comments via API             │
└─────────────────────────────────────────────────┘
```

### 4.2 API Contract (v1)

Implementation update: the verified remote Workspace API uses `/api/spaces` Shared Space endpoints, encrypted
`payloadCiphertext`/`ciphertext` blobs, and capability-bearing `Authorization` headers. The older `/api/plans` examples
below are retained as historical PRD shape only; implementation docs and tests should follow the Shared Space API.

All endpoints return JSON. The client library abstracts these calls; direct API consumers can hit the same endpoints.

#### `POST /api/plans`

Create a new plan (first revision).

```json
// Request body
{
  "encrypted_plan": "<base64 ciphertext>",
  "key_hash": "<SHA-256 of encryption key>"
}

// Response 201
{
  "plan_id": "p_8xK3mQ2",
  "revision_id": 1
}
```

#### `POST /api/plans/{plan_id}/revisions`

Push a new revision (plan update).

```json
{
  "encrypted_plan": "<base64 ciphertext>",
  "created_by": "Ganda"
}

// Response 201
{
  "revision_id": 2
}
```

#### `GET /api/plans/{plan_id}`

Get plan metadata + latest revision info.

```json
// Response 200
{
    "plan_id": "p_8xK3mQ2",
    "status": "review_open",
    "current_revision": 2,
    "revisions": [
        { "revision_id": 1, "created_at": "...", "created_by": "Ganda" },
        { "revision_id": 2, "created_at": "...", "created_by": "Ganda" }
    ]
}
```

#### `GET /api/plans/{plan_id}/revisions/{revision_id}`

Get a specific revision's encrypted blob.

```json
// Response 200
{
    "revision_id": 2,
    "encrypted_plan": "<base64 ciphertext>",
    "created_at": "...",
    "created_by": "Ganda"
}
```

#### `POST /api/plans/{plan_id}/revisions/{revision_id}/comments`

Submit a comment on a specific revision.

```json
{
  "encrypted_body": "<base64 ciphertext>",
  "author_name": "Alice",
  "block_id": "",            // empty = global comment
  "original_text": "..."     // the plaintext anchor text (encrypted by client? or sent as-is?)
}

// Response 201
{
  "comment_id": 42
}
```

> **Implementation update:** selected/original text, display names, comment bodies, and anchor/context metadata are
> encrypted inside the comment payload. The server stores only comment ciphertext plus routing metadata such as ids,
> Revision numbers, timestamps, and resolved state.

#### `GET /api/plans/{plan_id}/revisions/{revision_id}/comments`

List all comments on a revision (ordered by creation time).

```json
// Response 200
{
    "comments": [
        {
            "comment_id": 42,
            "encrypted_body": "<base64>",
            "author_name": "Alice",
            "block_id": "",
            "created_at": "..."
        }
    ]
}
```

#### `PATCH /api/plans/{plan_id}/revisions/{revision_id}/comments/{comment_id}/resolve`

Mark a comment as resolved. (`POST` could also work.)

```json
{ "resolved": true }
```

#### `PATCH /api/plans/{plan_id}`

Update plan status.

```json
{ "status": "closed" }
```

### 4.3 Database Schema (D1 + SQLite)

```sql
CREATE TABLE plans (
  id              TEXT PRIMARY KEY,
  encryption_key_hash TEXT NOT NULL,
  current_rev     INTEGER DEFAULT NULL,
  status          TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'review_open', 'closed')),
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE revisions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id         TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  revision_number INTEGER NOT NULL,
  encrypted_plan  TEXT NOT NULL,
  created_by      TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(plan_id, revision_number)
);

CREATE TABLE comments (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  revision_id     INTEGER NOT NULL REFERENCES revisions(id) ON DELETE CASCADE,
  encrypted_body  TEXT NOT NULL,
  author_name     TEXT NOT NULL,
  block_id        TEXT NOT NULL DEFAULT '',
  original_text   TEXT,
  resolved        BOOLEAN NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_comments_revision ON comments(revision_id);
CREATE INDEX idx_revisions_plan ON revisions(plan_id);
```

> **SQLite note:** For the Docker container, use WAL journal mode for concurrent reads during sync. The `.db` file is a
> single volume mount.

### 4.4 Web Viewer

- Remote review page served by the Workspace Plan Server.
- The URL shape is `https://plans.example.com/p/<space-id>#key=<content-key>&cap=<capability>&role=<role>`.
- On load: fetch Shared Space metadata, encrypted Revision payloads, and encrypted comments, then decrypt client-side.
- **UI components:**
  - Markdown viewer (rendered plan)
  - Comment sidebar (global + inline, grouped by revision)
  - Revision switcher (dropdown or sidebar timeline)
  - "Add comment" button → opens inline/highlight mode or global comment box
  - "Resolved" toggle on each comment (for plan author)
- Plannotator's existing `SharePayload` type can be reused for the client-side encryption/decryption pipeline.

### 4.5 CLI Commands

| Command                                              | Description                                                                                                                                                                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wld plans share <plan-name-or-id>`                  | Encrypt a local Plan, create a remote Shared Space, store local secrets, lock the local Plan, and print reviewer/maintainer URLs once.                                                                              |
| `wld plans pull <maintainer-url-or-plan-name-or-id>` | Fetch and decrypt the latest Revision/comments, import maintainer secrets when a URL is provided, update/create a locked local Plan, and launch Planner or Architect for incorporation.                             |
| `wld plans push <plan-name-or-id>`                   | Encrypt the accepted local Plan body and append it as the next remote Revision.                                                                                                                                     |
| `wld plans unshare <plan-name-or-id>`                | CLI-only destructive delete/recovery command that uses maintainer authorization, clears local matching secrets, and removes local lock metadata only after safe remote delete or confirmed already-deleted cleanup. |

### 4.6 Deployment Model

**Self-hosted (Docker):**

- Deno remote Workspace Plan Server.
- SQLite file on disk, normally mounted under `/data` in Docker.
- Optional HTTP Basic/Auth proxy, VPN, or SSO can sit in front of the container.
- Docker Compose file included in the repo.

**Hosted (`plans.example.com` / Cloudflare/D1 follow-up):**

- Deferred until the self-hosted protocol and product loop are proven.
- Must preserve the same ciphertext-only semantic content invariant and capability model.

---

## 5. Out of Scope (v1)

- [ ] User accounts / authentication system
- [ ] Role-based access control (viewer vs. commenter vs. editor)
- [ ] Real-time collaborative editing (like Google Docs)
- [ ] Automated notification system (gotify, email, Slack webhooks) — manual URL sharing only
- [ ] File/image attachments in comments
- [ ] Diff viewer in the web UI (show what changed between revisions)
- [ ] LLM-assisted comment incorporation (offered during sync, but actual LLM call is a separate discussion)
- [ ] Audit log / activity feed
- [ ] Plan templates or branching

---

## 6. TODO Items (Future Iterations)

- [ ] **Web UI spec** — Design the viewer, revision switcher, and comment sidebar in detail; hand off to a frontend
      contributor.
- [ ] **Notification system** — Evaluate gotify or similar for push notifications when a new revision is pushed.
- [ ] **Planner/Architect incorporation pipeline** — Continue refining how `wld plans pull` presents decrypted comments
      and Plan revisions to Planner/Architect, including privacy, cost, and token-limit guardrails.
- [ ] **`original_text` encryption decision** — Determine whether comment anchor text should be encrypted client-side or
      sent in plaintext for server-side context.
- [ ] **Author tracking** — Currently `wld plan list` has no way to filter "my plans." Add an `author_id` or similar
      field if needed.
- [ ] **Diff viewer** — Show a visual diff between revisions in the web UI.
- [ ] **Smoothen "closed plan" DX** — Add a summary view, export to PDF, etc.
- [ ] **Rate limiting and abuse prevention** — Needed if the hosted instance is public.
- [ ] **Docker Compose + self-hosted setup docs** — Write deployment guide for self-hosted users.

---

## 7. Success Metrics (v1)

- A user can create a plan, share a URL, receive comments from at least 2 reviewers, and sync those comments locally.
- The hosted instance runs within the free tier of Cloudflare D1.
- A self-hosted Docker container can be stood up in under 5 minutes following the README.
- End-to-end encryption is verifiable: a network traffic capture shows only ciphertext leaving the client.

---

## 8. References

- Plannotator codebase: `@/../plannotator/` — sharing pipeline, encryption utilities, `SharePayload` type
- RunWield project memory: `[139] Agent tool policy`, `[104] Agent definitions`, `[103] Monorepo structure`
- Plannotator D1 + SQLite precedent: `@/../chores-app/` uses Deno + SQLite in production
- Relevant RunWield files: `packages/ui/utils/sharing.ts`, `packages/ui/utils/planDiffEngine.ts`,
  `packages/shared/crypto.ts`
