# Collaborative Planning — PRD

**Status:** Draft v1 **Author:** Ganda **Last Updated:** 2026-05-08

---

## 1. Objective

Enable Harns users to share plans with their team (technical and non-technical), collect structured feedback in a shared
space, and iteratively refine plans through revision cycles — all with end-to-end encryption so the server (including
any self-hosted instance) never sees plaintext plan content.

## 2. Problem Statement

Harns is currently a single-user planning tool. Users generate plans locally but have no mechanism to:

- Share a plan with non-technical stakeholders (PMs, designers, clients) in a readable format.
- Collect and organize feedback tied to specific parts of the plan.
- Iterate on the plan with the team's input without losing context or creating link fragmentation.
- Do any of this without requiring every participant to have a GitHub account or install tooling.

Chat-based solutions (Slack, Discord, Telegram) are structurally unsuited for long-form document review. Immutable
snapshot models (Plannotator's current approach) fragment discussion across multiple links. A **shared space** model
with revision tracking solves both problems.

## 3. Resolved Assumptions

| Decision                                    | Rationale                                                                                                                                                                                                    |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Shared space, not immutable snapshots**   | Single link for the team; comments stay in one place per revision. Reduces friction for non-technical users.                                                                                                 |
| **Dual deployment: hosted + self-hostable** | Hosted (`plans.hns.dev`) for convenience; Docker container for teams with data residency requirements. Client is backend-agnostic (configurable base URL).                                                   |
| **Backend: Cloudflare D1 + SQLite**         | D1 provides ACID transactions and SQL for the hosted path; SQLite is the self-hosted equivalent. Identical schema across both.                                                                               |
| **Encryption: client-side only**            | Plans and comments are encrypted in the browser before upload. The server stores only ciphertext. Encryption key lives in the URL fragment (`#key=...`), never sent to the server.                           |
| **Auth: free-form display name**            | No accounts, no passwords on the backend. Reviewers type a name when submitting a comment. Trust model: "people who have the link are the right people." Optional HTTP Basic Auth for self-hosted instances. |
| **Revisions: comments don't carry over**    | Each revision (`rev_1`, `rev_2`, …) is a frozen snapshot with its own comment thread. Devs can view previous revisions and their comments from the web UI.                                                   |
| **LLM incorporation on sync**               | `hns plan sync <ID>` presents the planner/architect agent with revision + comments and offers to generate a new revision. Privacy implications are deferred to a separate discussion.                        |
| **No automated notifications v1**           | Dev shares updated URLs manually. Future: gotify or similar push notification integration.                                                                                                                   |
| **Plans become read-only on close**         | Dev runs `hns plan close`. Backend sets `status = closed`. No further comments accepted. Read-only view remains available at the same URL.                                                                   |

## 4. Technical Approach

### 4.1 Architecture Overview

```
┌─────────────────────────────────────────────────┐
│  Client (hns CLI)                               │
│  hns plan share │ hns plan sync │ hns plan push │
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

> **Open question:** `original_text` should probably also be encrypted client-side for full E2EE. This means the server
> can't even show "this comment is about the following text" without the decryption key. The client would need to
> include it in the comment for server-side context, OR the web viewer matches comments to text client-side after
> decryption. Needs a small design spike.

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

- **Static SPA** served from a CDN (no server-side rendering needed — all data fetching is client-side via the API).
- The URL is `plans.hns.dev/p/<plan_id>#key=<encryption_key>`.
- On load: fetch the plan blob + all comments for the latest revision, decrypt client-side, render.
- **UI components:**
  - Markdown viewer (rendered plan)
  - Comment sidebar (global + inline, grouped by revision)
  - Revision switcher (dropdown or sidebar timeline)
  - "Add comment" button → opens inline/highlight mode or global comment box
  - "Resolved" toggle on each comment (for plan author)
- Plannotator's existing `SharePayload` type can be reused for the client-side encryption/decryption pipeline.

### 4.5 CLI Commands

| Command                    | Description                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------- |
| `hns plan share`           | Encrypt `plan.md`, POST to backend, print shareable URL                                           |
| `hns plan sync <plan_id>`  | Fetch latest revision + comments, decrypt locally, present to planner/architect for incorporation |
| `hns plan push <plan_id>`  | Encrypt updated plan, POST as new revision                                                        |
| `hns plan close <plan_id>` | Set plan status to `closed`                                                                       |
| `hns plan list`            | List plans the user has shared (by fetching plans they created — needs TODO: author tracking)     |

### 4.6 Deployment Model

**Hosted (`plans.hns.dev`):**

- A single Cloudflare Worker backed by D1.
- No auth at the instance level (the encryption key in the URL IS the auth).
- The Worker is stateless and cheap (~$0/month at low volume).

**Self-hosted (Docker):**

- Deno server using Oak or Hono.
- SQLite file on disk.
- Optional `BASIC_AUTH=true` env var for HTTP Basic Auth.
- Docker Compose file included in the repo.

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
- [ ] **LLM incorporation pipeline** — Define how `hns plan sync` sends comments + plan to an LLM and what guardrails
      exist (privacy, cost, token limits).
- [ ] **`original_text` encryption decision** — Determine whether comment anchor text should be encrypted client-side or
      sent in plaintext for server-side context.
- [ ] **Author tracking** — Currently `hns plan list` has no way to filter "my plans." Add an `author_id` or similar
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
- Harns project memory: `[139] Agent tool policy`, `[104] Agent definitions`, `[103] Monorepo structure`
- Plannotator D1 + SQLite precedent: `@/../chores-app/` uses Deno + SQLite in production
- Relevant Harns files: `packages/ui/utils/sharing.ts`, `packages/ui/utils/planDiffEngine.ts`,
  `packages/shared/crypto.ts`
