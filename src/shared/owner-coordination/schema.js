/**
 * @module shared/owner-coordination/schema
 * Owner-only coordination schema for registered Projects and stable Session cataloging.
 *
 * Later Personal Remote Workspace slices add activation leases, committed generations,
 * devices, checkpoints, Plan workflow leases, and attention tables through new migrations.
 */

export const OWNER_COORDINATION_SCHEMA_VERSION = 1;

export const OWNER_COORDINATION_SCHEMA_V1_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    registered_root TEXT NOT NULL,
    current_root TEXT NOT NULL,
    lifecycle TEXT NOT NULL CHECK (lifecycle IN ('enabled', 'disabled', 'removed')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    disabled_at TEXT,
    removed_at TEXT,
    restored_at TEXT,
    relinked_at TEXT
);

CREATE TABLE IF NOT EXISTS project_roots (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    entered_root TEXT NOT NULL,
    canonical_root TEXT NOT NULL,
    root_state TEXT NOT NULL CHECK (root_state IN ('current', 'historical')),
    created_at TEXT NOT NULL,
    ended_at TEXT,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT,
    UNIQUE(project_id, entered_root)
);

CREATE TABLE IF NOT EXISTS runwield_sessions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    display_name TEXT,
    source TEXT NOT NULL DEFAULT 'catalog' CHECK (source IN ('catalog', 'created', 'imported')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS session_transcript_locators (
    id TEXT PRIMARY KEY,
    runwield_session_id TEXT NOT NULL UNIQUE,
    project_id TEXT NOT NULL,
    pi_session_id TEXT NOT NULL,
    transcript_path TEXT NOT NULL UNIQUE,
    transcript_cwd TEXT NOT NULL,
    header_version INTEGER,
    header_timestamp TEXT,
    first_cataloged_at TEXT NOT NULL,
    last_cataloged_at TEXT NOT NULL,
    FOREIGN KEY (runwield_session_id) REFERENCES runwield_sessions(id) ON DELETE RESTRICT,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT,
    UNIQUE(project_id, pi_session_id)
);

CREATE TABLE IF NOT EXISTS project_session_catalog_scans (
    project_id TEXT NOT NULL,
    cwd TEXT NOT NULL,
    session_dir TEXT NOT NULL,
    last_scanned_dir_mtime_ms INTEGER,
    last_scanned_jsonl_count INTEGER NOT NULL DEFAULT 0,
    last_scanned_at TEXT NOT NULL,
    PRIMARY KEY (project_id, cwd),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_project_roots_project ON project_roots(project_id);
CREATE INDEX IF NOT EXISTS idx_project_roots_state ON project_roots(root_state);
CREATE INDEX IF NOT EXISTS idx_projects_lifecycle ON projects(lifecycle);
CREATE INDEX IF NOT EXISTS idx_runwield_sessions_project ON runwield_sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_project_session_catalog_scans_project ON project_session_catalog_scans(project_id);
CREATE INDEX IF NOT EXISTS idx_session_transcript_locators_project ON session_transcript_locators(project_id);
CREATE INDEX IF NOT EXISTS idx_session_transcript_locators_pi ON session_transcript_locators(pi_session_id);
`;
