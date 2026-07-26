/*
 * @module shared/owner-coordination/session-activations
 * Fenced Session Activation Lease and committed generation APIs.
 */

/** @typedef {'uninitialized' | 'idle' | 'active' | 'uncertain' | 'reconcile_required'} SessionActivationState */
/** @typedef {'bootstrap' | 'preparing' | 'hydrated' | 'turning' | 'checkpointing'} SessionActivationPhase */

/**
 * @typedef {Object} ActivationProof
 * @property {string} runwieldSessionId
 * @property {string} projectId
 * @property {string} ownerInstanceId
 * @property {'workspace' | 'tui' | 'acp' | 'test'} ownerProcessKind
 * @property {string} operationId
 * @property {number} fence
 * @property {SessionActivationPhase} phase
 * @property {number | null} expectedGeneration
 */

/**
 * @typedef {Object} GenerationEvidence
 * @property {number} generation
 * @property {number} byteLength
 * @property {string | null} terminalEntryId
 * @property {string} digestHex
 * @property {string} [digestAlgorithm]
 * @property {number} [evidenceVersion]
 */

/** @param {unknown} value */
function requireDatabase(value) {
    if (!value || typeof value !== "object" || !("handle" in value)) throw new Error("Owner database is required");
    return /** @type {import('./database.js').OwnerCoordinationDatabase} */ (value);
}

/** @param {() => string} [now] */
function isoNow(now) {
    return now ? now() : new Date().toISOString();
}

/** @param {() => string} [idFactory] */
function newId(idFactory) {
    return idFactory ? idFactory() : crypto.randomUUID();
}

/** @param {any} row */
function activationFromRow(row) {
    if (!row) return null;
    return {
        runwieldSessionId: row.runwield_session_id,
        projectId: row.project_id,
        state: row.state,
        phase: row.phase,
        latestGeneration: row.latest_generation === null || row.latest_generation === undefined
            ? null
            : Number(row.latest_generation),
        fence: Number(row.fence),
        ownerInstanceId: row.owner_instance_id,
        ownerProcessKind: row.owner_process_kind,
        operationId: row.operation_id,
        expectedGeneration: row.expected_generation === null || row.expected_generation === undefined
            ? null
            : Number(row.expected_generation),
        acquiredAt: row.acquired_at,
        heartbeatAt: row.heartbeat_at,
        heartbeatDeadlineAt: row.heartbeat_deadline_at,
        updatedAt: row.updated_at,
        blockedReason: row.blocked_reason,
    };
}

/** @param {any} row */
function generationFromRow(row) {
    if (!row) return null;
    return {
        runwieldSessionId: row.runwield_session_id,
        projectId: row.project_id,
        generation: Number(row.generation),
        evidenceVersion: Number(row.evidence_version),
        digestAlgorithm: row.digest_algorithm,
        byteLength: Number(row.byte_length),
        terminalEntryId: row.terminal_entry_id,
        digestHex: row.digest_hex,
        operationId: row.operation_id,
        fence: Number(row.fence),
        committedAt: row.committed_at,
    };
}

/**
 * @param {import('./database.js').OwnerCoordinationDatabase} database
 * @param {string} runwieldSessionId
 */
export function inspectSessionActivation(database, runwieldSessionId) {
    const db = requireDatabase(database).handle;
    const activation = activationFromRow(
        db.prepare("SELECT * FROM session_activation_state WHERE runwield_session_id = ?").get(runwieldSessionId),
    );
    const generation = generationFromRow(
        db.prepare(
            "SELECT * FROM session_committed_generations WHERE runwield_session_id = ? ORDER BY generation DESC LIMIT 1",
        ).get(runwieldSessionId),
    );
    return { activation, generation };
}

/**
 * @param {ActivationProof} proof
 */
function requireProof(proof) {
    const value = /** @type {Record<string, unknown>} */ (proof || {});
    for (const field of ["runwieldSessionId", "projectId", "ownerInstanceId", "ownerProcessKind", "operationId"]) {
        if (typeof value[field] !== "string" || !value[field]) throw new Error(`Activation proof missing ${field}`);
    }
    if (!Number.isInteger(proof.fence) || proof.fence <= 0) throw new Error("Activation proof fence is invalid");
    if (!proof.phase) throw new Error("Activation proof phase is required");
}

const LEGAL_PHASE_TRANSITIONS = new Map([
    ["bootstrap", new Set(["checkpointing"])],
    ["preparing", new Set(["hydrated"])],
    ["hydrated", new Set(["turning", "checkpointing"])],
    ["turning", new Set(["checkpointing"])],
    ["checkpointing", new Set()],
]);

/** @param {NonNullable<ReturnType<typeof activationFromRow>>} current @param {ActivationProof} proof */
function proofMatches(current, proof) {
    return current.ownerInstanceId === proof.ownerInstanceId &&
        current.ownerProcessKind === proof.ownerProcessKind &&
        current.operationId === proof.operationId &&
        current.fence === proof.fence &&
        current.phase === proof.phase &&
        current.expectedGeneration === proof.expectedGeneration;
}

/**
 * @param {import('./database.js').OwnerCoordinationDatabase} ownerDb
 * @param {NonNullable<ReturnType<typeof activationFromRow>>} current
 * @param {ActivationProof} proof
 * @param {string} now
 */
function assertActiveProofFresh(ownerDb, current, proof, now) {
    if (current.state !== "active") throw new Error("Activation is not active");
    if (!proofMatches(current, proof)) throw new Error("Activation proof was rejected");
    if (current.heartbeatDeadlineAt && current.heartbeatDeadlineAt <= now) {
        ownerDb.handle.prepare(
            `UPDATE session_activation_state
                SET state = 'uncertain', phase = NULL, owner_instance_id = NULL, owner_process_kind = NULL,
                    operation_id = NULL, expected_generation = NULL, heartbeat_deadline_at = NULL,
                    updated_at = ?, blocked_reason = 'heartbeat_expired'
              WHERE runwield_session_id = ? AND project_id = ? AND state = 'active'
                AND owner_instance_id = ? AND owner_process_kind = ? AND operation_id = ? AND fence = ? AND phase = ?
                AND expected_generation IS ?`,
        ).run(
            now,
            proof.runwieldSessionId,
            proof.projectId,
            proof.ownerInstanceId,
            proof.ownerProcessKind,
            proof.operationId,
            proof.fence,
            proof.phase,
            proof.expectedGeneration ?? null,
        );
        throw new Error("Activation heartbeat expired");
    }
}

/**
 * @param {import('./database.js').OwnerCoordinationDatabase} database
 * @param {ActivationProof} proof
 * @param {{ now?: () => string }} [options]
 */
export function heartbeatSessionActivation(database, proof, options = {}) {
    requireProof(proof);
    const ownerDb = requireDatabase(database);
    const now = isoNow(options.now);
    const transactionResult = ownerDb.transaction(() => {
        const current = activationFromRow(
            ownerDb.handle.prepare(
                "SELECT * FROM session_activation_state WHERE runwield_session_id = ? AND project_id = ?",
            ).get(proof.runwieldSessionId, proof.projectId),
        );
        if (!current || current.state !== "active") throw new Error("Activation is not active");
        if (!proofMatches(current, proof)) throw new Error("Activation proof was rejected");
        if (current.heartbeatDeadlineAt && current.heartbeatDeadlineAt <= now) {
            ownerDb.handle.prepare(
                `UPDATE session_activation_state
                    SET state = 'uncertain', phase = NULL, owner_instance_id = NULL, owner_process_kind = NULL,
                        operation_id = NULL, expected_generation = NULL, heartbeat_deadline_at = NULL,
                        updated_at = ?, blocked_reason = 'heartbeat_expired'
                  WHERE runwield_session_id = ? AND project_id = ? AND state = 'active'
                    AND owner_instance_id = ? AND owner_process_kind = ? AND operation_id = ? AND fence = ? AND phase = ?
                    AND expected_generation IS ?`,
            ).run(
                now,
                proof.runwieldSessionId,
                proof.projectId,
                proof.ownerInstanceId,
                proof.ownerProcessKind,
                proof.operationId,
                proof.fence,
                proof.phase,
                proof.expectedGeneration ?? null,
            );
            return { expired: true };
        }
        const result = ownerDb.handle.prepare(
            `UPDATE session_activation_state
                SET heartbeat_at = ?, heartbeat_deadline_at = ?, updated_at = ?
              WHERE runwield_session_id = ? AND project_id = ? AND state = 'active'
                AND owner_instance_id = ? AND owner_process_kind = ? AND operation_id = ? AND fence = ? AND phase = ?
                AND expected_generation IS ?`,
        ).run(
            now,
            deadlineFrom(now),
            now,
            proof.runwieldSessionId,
            proof.projectId,
            proof.ownerInstanceId,
            proof.ownerProcessKind,
            proof.operationId,
            proof.fence,
            proof.phase,
            proof.expectedGeneration ?? null,
        );
        if (result.changes !== 1) throw new Error("Activation heartbeat proof was rejected");
        return {
            expired: false,
            activation: activationFromRow(
                ownerDb.handle.prepare(
                    "SELECT * FROM session_activation_state WHERE runwield_session_id = ?",
                ).get(proof.runwieldSessionId),
            ),
        };
    });
    if (transactionResult.expired) throw new Error("Activation heartbeat expired");
    return /** @type {NonNullable<ReturnType<typeof activationFromRow>>} */ (transactionResult.activation);
}

/** @param {string} iso */
function deadlineFrom(iso) {
    return new Date(Date.parse(iso) + 30_000).toISOString();
}

/**
 * @param {import('./database.js').OwnerCoordinationDatabase} database
 * @param {{ runwieldSessionId: string, projectId: string, ownerInstanceId: string, ownerProcessKind: 'workspace' | 'tui' | 'acp' | 'test', operationId?: string, expectedGeneration?: number | null, phase?: SessionActivationPhase, idFactory?: () => string, now?: () => string }} options
 * @returns {ActivationProof}
 */
export function acquireSessionActivation(database, options) {
    const ownerDb = requireDatabase(database);
    const now = isoNow(options.now);
    const operationId = options.operationId || newId(options.idFactory);
    const phase = options.phase || "preparing";
    return ownerDb.transaction(() => {
        const current = activationFromRow(
            ownerDb.handle.prepare(
                "SELECT * FROM session_activation_state WHERE runwield_session_id = ? AND project_id = ?",
            ).get(options.runwieldSessionId, options.projectId),
        );
        if (!current) throw new Error(`Activation state not found: ${options.runwieldSessionId}`);
        const expectedGeneration = options.expectedGeneration ?? current.latestGeneration;
        const isBootstrap = current.state === "uninitialized" && phase === "bootstrap" && expectedGeneration === null;
        const isPreparing = current.state === "uninitialized" && phase === "preparing" && expectedGeneration === null;
        const isNormal = current.state === "idle" && current.latestGeneration === expectedGeneration;
        if (!isBootstrap && !isPreparing && !isNormal) {
            throw new Error(`Session activation is not available: ${current.state}`);
        }
        const nextFence = current.fence + 1;
        const result = ownerDb.handle.prepare(
            `UPDATE session_activation_state
                SET state = 'active', phase = ?, fence = ?, owner_instance_id = ?, owner_process_kind = ?,
                    operation_id = ?, expected_generation = ?, acquired_at = ?, heartbeat_at = ?,
                    heartbeat_deadline_at = ?, updated_at = ?, blocked_reason = NULL
              WHERE runwield_session_id = ? AND project_id = ? AND state = ? AND fence = ?`,
        ).run(
            phase,
            nextFence,
            options.ownerInstanceId,
            options.ownerProcessKind,
            operationId,
            expectedGeneration,
            now,
            now,
            deadlineFrom(now),
            now,
            options.runwieldSessionId,
            options.projectId,
            current.state,
            current.fence,
        );
        if (result.changes !== 1) throw new Error("Session activation race lost");
        return {
            runwieldSessionId: options.runwieldSessionId,
            projectId: options.projectId,
            ownerInstanceId: options.ownerInstanceId,
            ownerProcessKind: options.ownerProcessKind,
            operationId,
            fence: nextFence,
            phase,
            expectedGeneration,
        };
    });
}

/**
 * @param {import('./database.js').OwnerCoordinationDatabase} database
 * @param {ActivationProof} proof
 * @param {SessionActivationPhase} nextPhase
 * @param {{ now?: () => string }} [options]
 */
export function changeSessionActivationPhase(database, proof, nextPhase, options = {}) {
    requireProof(proof);
    const ownerDb = requireDatabase(database);
    const now = isoNow(options.now);
    return ownerDb.transaction(() => {
        const current = activationFromRow(
            ownerDb.handle.prepare(
                "SELECT * FROM session_activation_state WHERE runwield_session_id = ? AND project_id = ?",
            ).get(proof.runwieldSessionId, proof.projectId),
        );
        if (!current) throw new Error("Activation is not active");
        assertActiveProofFresh(ownerDb, current, proof, now);
        if (!LEGAL_PHASE_TRANSITIONS.get(proof.phase)?.has(nextPhase)) {
            throw new Error(`Illegal activation phase transition: ${proof.phase} -> ${nextPhase}`);
        }
        const result = ownerDb.handle.prepare(
            `UPDATE session_activation_state SET phase = ?, updated_at = ?, heartbeat_at = ?, heartbeat_deadline_at = ?
              WHERE runwield_session_id = ? AND project_id = ? AND state = 'active'
                AND owner_instance_id = ? AND owner_process_kind = ? AND operation_id = ? AND fence = ? AND phase = ?
                AND expected_generation IS ?`,
        ).run(
            nextPhase,
            now,
            now,
            deadlineFrom(now),
            proof.runwieldSessionId,
            proof.projectId,
            proof.ownerInstanceId,
            proof.ownerProcessKind,
            proof.operationId,
            proof.fence,
            proof.phase,
            proof.expectedGeneration ?? null,
        );
        if (result.changes !== 1) throw new Error("Activation phase proof was rejected");
        return { ...proof, phase: nextPhase };
    });
}

/**
 * @param {import('./database.js').OwnerCoordinationDatabase} database
 * @param {ActivationProof} proof
 * @param {GenerationEvidence} evidence
 * @param {{ now?: () => string }} [options]
 */
export function publishGenerationAndRelease(database, proof, evidence, options = {}) {
    requireProof(proof);
    const ownerDb = requireDatabase(database);
    const now = isoNow(options.now);
    return ownerDb.transaction(() => {
        const current = activationFromRow(
            ownerDb.handle.prepare(
                "SELECT * FROM session_activation_state WHERE runwield_session_id = ? AND project_id = ?",
            ).get(proof.runwieldSessionId, proof.projectId),
        );
        if (!current) throw new Error("Activation is not active");
        assertActiveProofFresh(ownerDb, current, proof, now);
        if (proof.phase !== "checkpointing") throw new Error("Generation publication requires checkpointing phase");
        const previous = current.latestGeneration;
        const expectedNext = previous === null ? 0 : previous + 1;
        if (evidence.generation !== expectedNext) throw new Error(`Generation must advance to ${expectedNext}`);
        ownerDb.handle.prepare(
            `INSERT INTO session_committed_generations(runwield_session_id, project_id, generation, evidence_version,
                digest_algorithm, byte_length, terminal_entry_id, digest_hex, operation_id, fence, committed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
            proof.runwieldSessionId,
            proof.projectId,
            evidence.generation,
            evidence.evidenceVersion || 1,
            evidence.digestAlgorithm || "sha256",
            evidence.byteLength,
            evidence.terminalEntryId ?? null,
            evidence.digestHex,
            proof.operationId,
            proof.fence,
            now,
        );
        const result = ownerDb.handle.prepare(
            `UPDATE session_activation_state
                SET state = 'idle', phase = NULL, latest_generation = ?, owner_instance_id = NULL,
                    owner_process_kind = NULL, operation_id = NULL, expected_generation = NULL, acquired_at = NULL,
                    heartbeat_at = NULL, heartbeat_deadline_at = NULL, updated_at = ?, blocked_reason = NULL
              WHERE runwield_session_id = ? AND project_id = ? AND state = 'active'
                AND owner_instance_id = ? AND owner_process_kind = ? AND operation_id = ? AND fence = ? AND phase = ?
                AND expected_generation IS ?`,
        ).run(
            evidence.generation,
            now,
            proof.runwieldSessionId,
            proof.projectId,
            proof.ownerInstanceId,
            proof.ownerProcessKind,
            proof.operationId,
            proof.fence,
            proof.phase,
            proof.expectedGeneration ?? null,
        );
        if (result.changes !== 1) throw new Error("Activation release proof was rejected");
        return inspectSessionActivation(ownerDb, proof.runwieldSessionId);
    });
}

/**
 * @param {import('./database.js').OwnerCoordinationDatabase} database
 * @param {ActivationProof} proof
 * @param {{ now?: () => string }} [options]
 */
export function releaseUnchangedActivation(database, proof, options = {}) {
    requireProof(proof);
    const ownerDb = requireDatabase(database);
    const now = isoNow(options.now);
    return ownerDb.transaction(() => {
        const current = activationFromRow(
            ownerDb.handle.prepare(
                "SELECT * FROM session_activation_state WHERE runwield_session_id = ? AND project_id = ?",
            ).get(proof.runwieldSessionId, proof.projectId),
        );
        if (!current) throw new Error("Activation is not active");
        assertActiveProofFresh(ownerDb, current, proof, now);
        if (proof.phase !== "bootstrap" && proof.phase !== "preparing") {
            throw new Error("Unchanged release is only allowed before hydration");
        }
        const result = ownerDb.handle.prepare(
            `UPDATE session_activation_state
                SET state = CASE WHEN latest_generation IS NULL THEN 'uninitialized' ELSE 'idle' END,
                    phase = NULL, owner_instance_id = NULL, owner_process_kind = NULL, operation_id = NULL,
                    expected_generation = NULL, acquired_at = NULL, heartbeat_at = NULL, heartbeat_deadline_at = NULL,
                    updated_at = ?, blocked_reason = NULL
              WHERE runwield_session_id = ? AND project_id = ? AND state = 'active'
                AND owner_instance_id = ? AND owner_process_kind = ? AND operation_id = ? AND fence = ? AND phase = ?
                AND expected_generation IS ?`,
        ).run(
            now,
            proof.runwieldSessionId,
            proof.projectId,
            proof.ownerInstanceId,
            proof.ownerProcessKind,
            proof.operationId,
            proof.fence,
            proof.phase,
            proof.expectedGeneration ?? null,
        );
        if (result.changes !== 1) throw new Error("Activation unchanged release proof was rejected");
        return inspectSessionActivation(ownerDb, proof.runwieldSessionId);
    });
}

/**
 * @param {import('./database.js').OwnerCoordinationDatabase} database
 * @param {ActivationProof | { runwieldSessionId: string, projectId: string }} proof
 * @param {{ reason?: string, now?: () => string }} [options]
 */
export function markSessionUncertain(database, proof, options = {}) {
    const ownerDb = requireDatabase(database);
    const now = isoNow(options.now);
    const result = ownerDb.handle.prepare(
        `UPDATE session_activation_state
            SET state = 'uncertain', phase = NULL, owner_instance_id = NULL, owner_process_kind = NULL,
                operation_id = NULL, expected_generation = NULL, heartbeat_deadline_at = NULL, updated_at = ?,
                blocked_reason = ?
          WHERE runwield_session_id = ? AND project_id = ?`,
    ).run(now, options.reason || "uncertain", proof.runwieldSessionId, proof.projectId);
    if (result.changes !== 1) throw new Error("Unable to mark Session uncertain");
    return inspectSessionActivation(ownerDb, proof.runwieldSessionId);
}

/**
 * @param {import('./database.js').OwnerCoordinationDatabase} database
 * @param {{ runwieldSessionId: string, projectId: string }} session
 * @param {{ reason?: string, now?: () => string }} [options]
 */
export function markSessionReconcileRequired(database, session, options = {}) {
    const ownerDb = requireDatabase(database);
    const now = isoNow(options.now);
    const result = ownerDb.handle.prepare(
        `UPDATE session_activation_state
            SET state = 'reconcile_required', phase = NULL, owner_instance_id = NULL, owner_process_kind = NULL,
                operation_id = NULL, expected_generation = NULL, heartbeat_deadline_at = NULL, updated_at = ?,
                blocked_reason = ?
          WHERE runwield_session_id = ? AND project_id = ?`,
    ).run(now, options.reason || "reconcile_required", session.runwieldSessionId, session.projectId);
    if (result.changes !== 1) throw new Error("Unable to mark Session reconcile_required");
    return inspectSessionActivation(ownerDb, session.runwieldSessionId);
}

/**
 * @param {import('./database.js').OwnerCoordinationDatabase} database
 * @param {{ deviceId?: string | null, requestId: string, requestHash: string, runwieldSessionId: string, projectId: string, expectedGeneration?: number | null, kind: 'bootstrap' | 'continuation', operationId?: string, idFactory?: () => string, now?: () => string }} options
 */
export function createOrGetOperationReceipt(database, options) {
    const ownerDb = requireDatabase(database);
    const now = isoNow(options.now);
    return ownerDb.transaction(() => {
        const existing = ownerDb.handle.prepare(
            "SELECT * FROM owner_session_operations WHERE device_id IS ? AND runwield_session_id = ? AND request_id = ?",
        ).get(options.deviceId ?? null, options.runwieldSessionId, options.requestId);
        if (existing) {
            if (existing.request_hash !== options.requestHash) {
                throw new Error("Operation request id was reused with different input");
            }
            return operationFromRow(existing);
        }
        const id = newId(options.idFactory);
        const operationId = options.operationId || newId(options.idFactory);
        ownerDb.handle.prepare(
            `INSERT INTO owner_session_operations(id, device_id, request_id, request_hash, runwield_session_id,
                project_id, expected_generation, kind, status, operation_id, started_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'accepted', ?, ?, ?)`,
        ).run(
            id,
            options.deviceId ?? null,
            options.requestId,
            options.requestHash,
            options.runwieldSessionId,
            options.projectId,
            options.expectedGeneration ?? null,
            options.kind,
            operationId,
            now,
            now,
        );
        return operationFromRow(ownerDb.handle.prepare("SELECT * FROM owner_session_operations WHERE id = ?").get(id));
    });
}

/**
 * @param {import('./database.js').OwnerCoordinationDatabase} database
 * @param {{ deviceId?: string | null, requestId: string, requestHash: string, runwieldSessionId: string }} options
 */
export function findOperationReceiptByRequest(database, options) {
    const ownerDb = requireDatabase(database);
    const existing = ownerDb.handle.prepare(
        "SELECT * FROM owner_session_operations WHERE device_id IS ? AND runwield_session_id = ? AND request_id = ?",
    ).get(options.deviceId ?? null, options.runwieldSessionId, options.requestId);
    if (!existing) return null;
    if (existing.request_hash !== options.requestHash) {
        throw new Error("Operation request id was reused with different input");
    }
    return operationFromRow(existing);
}

/**
 * @param {import('./database.js').OwnerCoordinationDatabase} database
 * @param {string} operationId
 * @param {{ status: 'accepted' | 'running' | 'completed' | 'failed' | 'conflict', resultGeneration?: number | null, errorCode?: string | null, errorMessage?: string | null, now?: () => string }} updates
 */
export function updateOperationReceipt(database, operationId, updates) {
    const ownerDb = requireDatabase(database);
    const now = isoNow(updates.now);
    const completedAt = updates.status === "completed" || updates.status === "failed" || updates.status === "conflict"
        ? now
        : null;
    const result = ownerDb.handle.prepare(
        `UPDATE owner_session_operations
            SET status = ?, updated_at = ?, completed_at = COALESCE(?, completed_at), result_generation = ?,
                error_code = ?, error_message = ?
          WHERE operation_id = ?`,
    ).run(
        updates.status,
        now,
        completedAt,
        updates.resultGeneration ?? null,
        updates.errorCode ?? null,
        updates.errorMessage ?? null,
        operationId,
    );
    if (result.changes !== 1) throw new Error("Operation receipt not found");
    return getOperationReceipt(database, operationId);
}

/**
 * @param {import('./database.js').OwnerCoordinationDatabase} database
 * @param {string} operationId
 */
export function getOperationReceipt(database, operationId) {
    const ownerDb = requireDatabase(database);
    return operationFromRow(
        ownerDb.handle.prepare("SELECT * FROM owner_session_operations WHERE operation_id = ?").get(operationId),
    );
}

/** @param {any} row */
function operationFromRow(row) {
    if (!row) return null;
    return {
        id: row.id,
        deviceId: row.device_id,
        requestId: row.request_id,
        requestHash: row.request_hash,
        runwieldSessionId: row.runwield_session_id,
        projectId: row.project_id,
        expectedGeneration: row.expected_generation === null || row.expected_generation === undefined
            ? null
            : Number(row.expected_generation),
        kind: row.kind,
        status: row.status,
        operationId: row.operation_id,
        startedAt: row.started_at,
        updatedAt: row.updated_at,
        completedAt: row.completed_at,
        resultGeneration: row.result_generation === null || row.result_generation === undefined
            ? null
            : Number(row.result_generation),
        errorCode: row.error_code,
        errorMessage: row.error_message,
    };
}
