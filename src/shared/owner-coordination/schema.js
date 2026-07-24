/*
 * @module shared/owner-coordination/schema
 * Owner-only coordination schema for registered Projects, paired devices, stable
 * Session cataloging, and Session activation state.
 */

export const OWNER_COORDINATION_SCHEMA_VERSION = 3;

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

export const OWNER_COORDINATION_SCHEMA_V2_SQL = `
CREATE TABLE IF NOT EXISTS pairing_requests (
    id TEXT PRIMARY KEY,
    code_hash TEXT NOT NULL,
    proof_hash TEXT NOT NULL UNIQUE,
    device_label TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('pending', 'approved', 'claimed', 'expired')),
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    approved_at TEXT,
    claimed_at TEXT,
    claimed_device_id TEXT,
    approval_attempts INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (claimed_device_id) REFERENCES paired_devices(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS paired_devices (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    credential_hash TEXT NOT NULL UNIQUE,
    csrf_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_seen_at TEXT,
    revoked_at TEXT,
    revoked_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_pairing_requests_code_hash ON pairing_requests(code_hash);
CREATE INDEX IF NOT EXISTS idx_pairing_requests_state ON pairing_requests(state);
CREATE INDEX IF NOT EXISTS idx_pairing_requests_expires_at ON pairing_requests(expires_at);
CREATE INDEX IF NOT EXISTS idx_paired_devices_revoked ON paired_devices(revoked_at);
`;

export const OWNER_COORDINATION_SCHEMA_V3_SQL = `
CREATE TABLE IF NOT EXISTS owner_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_runwield_sessions_id_project ON runwield_sessions(id, project_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_session_locators_id_project ON session_transcript_locators(runwield_session_id, project_id);

CREATE TABLE IF NOT EXISTS session_activation_state (
    runwield_session_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('uninitialized', 'idle', 'active', 'uncertain', 'reconcile_required')),
    phase TEXT CHECK (phase IS NULL OR phase IN ('bootstrap', 'preparing', 'hydrated', 'turning', 'checkpointing')),
    latest_generation INTEGER CHECK (latest_generation IS NULL OR latest_generation >= 0),
    fence INTEGER NOT NULL DEFAULT 0 CHECK (fence >= 0),
    owner_instance_id TEXT,
    owner_process_kind TEXT CHECK (owner_process_kind IS NULL OR owner_process_kind IN ('workspace', 'tui', 'acp', 'test')),
    operation_id TEXT,
    expected_generation INTEGER CHECK (expected_generation IS NULL OR expected_generation >= 0),
    acquired_at TEXT,
    heartbeat_at TEXT,
    heartbeat_deadline_at TEXT,
    updated_at TEXT NOT NULL,
    blocked_reason TEXT,
    FOREIGN KEY (runwield_session_id, project_id) REFERENCES runwield_sessions(id, project_id) ON DELETE RESTRICT,
    CHECK ((state = 'active') = (phase IS NOT NULL)),
    CHECK ((state = 'active') = (owner_instance_id IS NOT NULL AND owner_process_kind IS NOT NULL AND operation_id IS NOT NULL)),
    CHECK ((state = 'uninitialized') = (latest_generation IS NULL) OR (state <> 'uninitialized'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_session_activation_active_operation
    ON session_activation_state(owner_instance_id, operation_id)
    WHERE state = 'active';
CREATE INDEX IF NOT EXISTS idx_session_activation_project ON session_activation_state(project_id);
CREATE INDEX IF NOT EXISTS idx_session_activation_state ON session_activation_state(state);

CREATE TABLE IF NOT EXISTS session_committed_generations (
    runwield_session_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    generation INTEGER NOT NULL CHECK (generation >= 0),
    evidence_version INTEGER NOT NULL DEFAULT 1,
    digest_algorithm TEXT NOT NULL CHECK (digest_algorithm = 'sha256'),
    byte_length INTEGER NOT NULL CHECK (byte_length >= 0),
    terminal_entry_id TEXT,
    digest_hex TEXT NOT NULL,
    operation_id TEXT NOT NULL,
    fence INTEGER NOT NULL CHECK (fence > 0),
    committed_at TEXT NOT NULL,
    PRIMARY KEY (runwield_session_id, generation),
    FOREIGN KEY (runwield_session_id, project_id) REFERENCES runwield_sessions(id, project_id) ON DELETE RESTRICT,
    UNIQUE(runwield_session_id, project_id, generation),
    UNIQUE(runwield_session_id, digest_algorithm, byte_length, digest_hex)
);

CREATE TABLE IF NOT EXISTS owner_session_operations (
    id TEXT PRIMARY KEY,
    device_id TEXT,
    request_id TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    runwield_session_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    expected_generation INTEGER,
    kind TEXT NOT NULL CHECK (kind IN ('bootstrap', 'continuation')),
    status TEXT NOT NULL CHECK (status IN ('accepted', 'running', 'completed', 'failed', 'conflict')),
    operation_id TEXT NOT NULL UNIQUE,
    started_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT,
    result_generation INTEGER,
    error_code TEXT,
    error_message TEXT,
    FOREIGN KEY (runwield_session_id, project_id) REFERENCES runwield_sessions(id, project_id) ON DELETE RESTRICT,
    UNIQUE(device_id, runwield_session_id, request_id)
);

INSERT OR IGNORE INTO session_activation_state(runwield_session_id, project_id, state, latest_generation, updated_at)
    SELECT id, project_id, 'uninitialized', NULL, COALESCE(updated_at, created_at)
      FROM runwield_sessions;

CREATE TRIGGER IF NOT EXISTS trg_runwield_sessions_activation_state
AFTER INSERT ON runwield_sessions
BEGIN
    INSERT OR IGNORE INTO session_activation_state(runwield_session_id, project_id, state, latest_generation, updated_at)
    VALUES (NEW.id, NEW.project_id, 'uninitialized', NULL, NEW.created_at);
END;
`;
