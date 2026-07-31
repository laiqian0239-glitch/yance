'use strict';

const crypto = require('crypto');
const { getStore } = require('../repositories/storeProvider');
const { parseJson } = require('../lib/r32SqliteStore');
const resilientLeaseClock = require('../lib/resilientLeaseClock');
const { defaultCapturePidIdentity } = require('../lib/sqliteOwnership');

const STATES = Object.freeze({
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  SUCCEEDED: 'SUCCEEDED',
  RETRY_WAIT: 'RETRY_WAIT',
  FAILED_FINAL: 'FAILED_FINAL',
  CANCELLED: 'CANCELLED',
  SUPERSEDED: 'SUPERSEDED'
});

const DEFAULT_STALE_RUNNING_MS = 10 * 60 * 1000;
const DEFAULT_RETRY_DELAY_MS = 5 * 60 * 1000;
const DEFAULT_MAX_RETRY_DELAY_MS = 6 * 60 * 60 * 1000;
const PROCESS_GENERATION = crypto.randomUUID();
const PROCESS_PID = process.pid;
const PROCESS_IDENTITY = defaultCapturePidIdentity(PROCESS_PID) || `pid:${PROCESS_PID}`;

function defaultPidAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error?.code !== 'ESRCH'; }
}

function clean(value, max = 400) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function iso(value = resilientLeaseClock.now()) {
  return new Date(Number(value)).toISOString();
}

function parseAt(value) {
  const parsed = Date.parse(clean(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function digest(parts) {
  return crypto.createHash('sha256').update(parts.map(value => clean(value)).join('\u001f')).digest('hex');
}

function safePayload(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const forbidden = /token|secret|session|cookie|credential|password|api.?hash|access.?key/iu;
  return Object.fromEntries(Object.entries(source)
    .filter(([key]) => !forbidden.test(key))
    .map(([key, item]) => [clean(key, 100), typeof item === 'string' ? clean(item, 500) : item]));
}

function identity(input = {}) {
  const jobType = clean(input.jobType || input.type, 100).toLowerCase();
  const platform = clean(input.platform, 60).toLowerCase();
  const sourceAccountId = clean(input.sourceAccountId || input.accountId, 180);
  const conversationId = clean(input.conversationId, 220);
  const entityId = clean(input.entityId || input.messageId || input.contactId, 240);
  const revision = clean(input.revision || input.projectionVersion || 'v1', 240);
  const idempotencyKey = clean(input.idempotencyKey, 128) || digest([
    jobType, platform, sourceAccountId, conversationId, entityId, revision
  ]);
  return { jobType, platform, sourceAccountId, conversationId, entityId, revision, idempotencyKey };
}

function normalizeRow(row) {
  if (!row) return null;
  return {
    jobId: row.job_id,
    idempotencyKey: row.idempotency_key,
    jobType: row.job_type,
    platform: row.platform,
    sourceAccountId: row.source_account_id,
    conversationId: row.conversation_id,
    entityId: row.entity_id,
    revision: row.revision,
    state: row.state,
    attempt: Number(row.attempt || 0),
    maxAttempts: Number(row.max_attempts || 0),
    nextRetryAt: row.next_retry_at,
    lockToken: row.lock_token,
    ownerProcessGeneration: row.owner_process_generation || '',
    ownerPid: Number(row.owner_pid || 0),
    ownerProcessIdentity: row.owner_process_identity || '',
    lastHeartbeatAt: row.last_heartbeat_at || '',
    lastErrorCode: row.last_error_code,
    retryable: row.retryable === 1,
    firstStartedAt: row.first_started_at,
    lastStartedAt: row.last_started_at,
    finishedAt: row.finished_at,
    payload: parseJson(row.payload_json, {}) || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function ensureSchema(store) {
  store.db.exec(`
    CREATE TABLE IF NOT EXISTS background_job_state (
      job_id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL UNIQUE,
      job_type TEXT NOT NULL,
      platform TEXT NOT NULL DEFAULT '',
      source_account_id TEXT NOT NULL DEFAULT '',
      conversation_id TEXT NOT NULL DEFAULT '',
      entity_id TEXT NOT NULL DEFAULT '',
      revision TEXT NOT NULL DEFAULT 'v1',
      state TEXT NOT NULL DEFAULT 'PENDING',
      attempt INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 1,
      next_retry_at TEXT NOT NULL DEFAULT '',
      lock_token TEXT NOT NULL DEFAULT '',
      owner_process_generation TEXT NOT NULL DEFAULT '',
      owner_pid INTEGER NOT NULL DEFAULT 0,
      owner_process_identity TEXT NOT NULL DEFAULT '',
      last_heartbeat_at TEXT NOT NULL DEFAULT '',
      last_error_code TEXT NOT NULL DEFAULT '',
      retryable INTEGER NOT NULL DEFAULT 0,
      first_started_at TEXT NOT NULL DEFAULT '',
      last_started_at TEXT NOT NULL DEFAULT '',
      finished_at TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK(state IN ('PENDING','RUNNING','SUCCEEDED','RETRY_WAIT','FAILED_FINAL','CANCELLED','SUPERSEDED'))
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_background_job_state_claim
      ON background_job_state(job_type, state, next_retry_at, updated_at);
    CREATE INDEX IF NOT EXISTS idx_background_job_state_scope
      ON background_job_state(platform, source_account_id, conversation_id, entity_id);
  `);
  const columns = new Set(store.db.prepare('PRAGMA table_info(background_job_state)').all().map(row => String(row.name)));
  for (const [name, definition] of [
    ['owner_process_generation', "TEXT NOT NULL DEFAULT ''"],
    ['owner_pid', 'INTEGER NOT NULL DEFAULT 0'],
    ['owner_process_identity', "TEXT NOT NULL DEFAULT ''"],
    ['last_heartbeat_at', "TEXT NOT NULL DEFAULT ''"]
  ]) if (!columns.has(name)) store.db.exec(`ALTER TABLE background_job_state ADD COLUMN ${name} ${definition}`);
  store.db.exec(`CREATE INDEX IF NOT EXISTS idx_background_job_state_owner_heartbeat
    ON background_job_state(state, owner_process_generation, last_heartbeat_at)`);
}

class BackgroundJobAuthority {
  constructor(options = {}) {
    this.store = options.store || null;
    this.clock = typeof options.clock === 'function' ? options.clock : () => resilientLeaseClock.now();
    this.staleRunningMs = Math.max(1000, Number(options.staleRunningMs || DEFAULT_STALE_RUNNING_MS));
    this.processGeneration = clean(options.processGeneration || PROCESS_GENERATION, 100);
    this.pid = Number.isInteger(options.pid) && options.pid > 0 ? options.pid : PROCESS_PID;
    this.capturePidIdentity = typeof options.capturePidIdentity === 'function' ? options.capturePidIdentity : defaultCapturePidIdentity;
    this.processIdentity = clean(options.processIdentity || this.capturePidIdentity(this.pid) || (this.pid === PROCESS_PID ? PROCESS_IDENTITY : `pid:${this.pid}`), 240);
    this.pidAlive = typeof options.pidAlive === 'function' ? options.pidAlive : defaultPidAlive;
  }

  ownerIsActive(job, now, staleRunningMs) {
    if (!job || job.state !== STATES.RUNNING) return false;
    const ownerPid = Number(job.ownerPid || 0);
    if (Number.isInteger(ownerPid) && ownerPid > 0) {
      try {
        if (!this.pidAlive(ownerPid)) return false;
        const expected = clean(job.ownerProcessIdentity, 240);
        const actual = clean(this.capturePidIdentity(ownerPid), 240);
        if (expected && actual && expected !== actual) return false;
        // PID + process-creation identity are the cross-process fence. Do not
        // steal from a demonstrably live owner merely because another process
        // started after a Windows/NTP wall-clock jump and sees an old heartbeat.
        // A deliberately forced takeover remains available to explicit callers.
        return true;
      } catch (_) {
        // Indeterminate liveness remains fenced; an observation failure is not
        // sufficient authority to run the same durable side effect twice.
        return true;
      }
    }
    // Legacy rows without a process identity fall back to heartbeat staleness.
    const heartbeatAt = parseAt(job.lastHeartbeatAt || job.lastStartedAt || job.updatedAt);
    return Boolean(heartbeatAt && now - heartbeatAt < staleRunningMs);
  }

  resolveStore(override) {
    const store = override || this.store || getStore();
    ensureSchema(store);
    return store;
  }

  read(input, storeOverride) {
    const store = this.resolveStore(storeOverride);
    const key = typeof input === 'string' ? clean(input, 128) : identity(input).idempotencyKey;
    return normalizeRow(store.db.prepare('SELECT * FROM background_job_state WHERE idempotency_key=?').get(key));
  }

  enqueue(input = {}, options = {}, storeOverride) {
    const store = this.resolveStore(storeOverride);
    const at = iso(Number(options.now || this.clock()));
    const scope = identity(input);
    if (!scope.jobType || !scope.sourceAccountId || !scope.entityId) {
      const error = new Error('Background job identity is incomplete');
      error.code = 'BACKGROUND_JOB_IDENTITY_INCOMPLETE';
      error.details = scope;
      throw error;
    }
    const maxAttempts = Math.max(1, Number(options.maxAttempts || input.maxAttempts || 1));
    const payload = safePayload(input.payload || {});
    const jobId = clean(input.jobId, 180) || `job_${scope.idempotencyKey.slice(0, 32)}`;
    const before = normalizeRow(store.db.prepare('SELECT * FROM background_job_state WHERE idempotency_key=?').get(scope.idempotencyKey));
    store.db.prepare(`
      INSERT INTO background_job_state(
        job_id,idempotency_key,job_type,platform,source_account_id,conversation_id,entity_id,revision,
        state,attempt,max_attempts,next_retry_at,lock_token,last_error_code,retryable,
        first_started_at,last_started_at,finished_at,payload_json,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?, 'PENDING',0,?, '', '', '',0, '', '', '',?,?,?)
      ON CONFLICT(idempotency_key) DO UPDATE SET
        job_type=excluded.job_type, platform=excluded.platform, source_account_id=excluded.source_account_id,
        conversation_id=excluded.conversation_id, entity_id=excluded.entity_id, revision=excluded.revision,
        max_attempts=MAX(background_job_state.max_attempts, excluded.max_attempts),
        payload_json=CASE WHEN background_job_state.state='SUCCEEDED' THEN background_job_state.payload_json ELSE excluded.payload_json END,
        state=CASE WHEN background_job_state.state IN ('SUCCEEDED','RUNNING','RETRY_WAIT') THEN background_job_state.state ELSE 'PENDING' END,
        next_retry_at=CASE WHEN background_job_state.state='RETRY_WAIT' THEN background_job_state.next_retry_at ELSE '' END,
        updated_at=CASE WHEN background_job_state.state='SUCCEEDED' THEN background_job_state.updated_at ELSE excluded.updated_at END
    `).run(
      jobId, scope.idempotencyKey, scope.jobType, scope.platform, scope.sourceAccountId,
      scope.conversationId, scope.entityId, scope.revision, maxAttempts,
      JSON.stringify(payload), at, at
    );
    const row = this.read(scope.idempotencyKey, store);
    const enqueueOutcome = !before
      ? 'created'
      : before.state === STATES.SUCCEEDED
        ? 'already-succeeded'
        : before.state === STATES.RUNNING
          ? 'already-running'
          : before.state === STATES.RETRY_WAIT
            ? 'retry-wait'
            : 'updated';
    return { ...row, enqueueOutcome, created: enqueueOutcome === 'created', noop: enqueueOutcome.startsWith('already-') };
  }

  begin(input = {}, options = {}, storeOverride) {
    const store = this.resolveStore(storeOverride);
    const now = Number(options.now || this.clock());
    const at = iso(now);
    const scope = identity(input);
    if (!scope.jobType || !scope.sourceAccountId || !scope.entityId) {
      const error = new Error('Background job identity is incomplete');
      error.code = 'BACKGROUND_JOB_IDENTITY_INCOMPLETE';
      error.details = scope;
      throw error;
    }
    const maxAttempts = Math.max(1, Number(options.maxAttempts || input.maxAttempts || 1));
    const refreshAfterMs = Math.max(0, Number(options.refreshAfterMs || 0));
    const force = options.force === true || input.force === true;
    const staleRunningMs = Math.max(1000, Number(options.staleRunningMs || this.staleRunningMs));
    const payload = safePayload(input.payload || {});

    return store.transaction(() => {
      const existing = normalizeRow(store.db.prepare('SELECT * FROM background_job_state WHERE idempotency_key=?').get(scope.idempotencyKey));
      if (existing && !force) {
        if (existing.state === STATES.RUNNING && this.ownerIsActive(existing, now, staleRunningMs)) {
          return { acquired: false, reason: 'already-running', job: existing };
        }
        if (existing.state === STATES.RETRY_WAIT && parseAt(existing.nextRetryAt) > now) {
          return { acquired: false, reason: 'retry-wait', job: existing };
        }
        if (existing.state === STATES.FAILED_FINAL || existing.state === STATES.CANCELLED) {
          return { acquired: false, reason: existing.state.toLowerCase(), job: existing };
        }
        if (existing.state === STATES.SUCCEEDED) {
          const age = Math.max(0, now - parseAt(existing.finishedAt || existing.updatedAt));
          if (refreshAfterMs === 0 || age < refreshAfterMs) return { acquired: false, reason: 'already-succeeded', job: existing };
        }
      }

      const lockToken = crypto.randomUUID();
      const jobId = existing?.jobId || `job_${scope.idempotencyKey.slice(0, 32)}`;
      const resetAttempt = Boolean(existing && [STATES.SUCCEEDED, STATES.FAILED_FINAL, STATES.CANCELLED, STATES.SUPERSEDED].includes(existing.state));
      const nextAttempt = resetAttempt ? 1 : Number(existing?.attempt || 0) + 1;
      const firstStartedAt = resetAttempt ? at : (existing?.firstStartedAt || at);
      store.db.prepare(`
        INSERT INTO background_job_state(
          job_id,idempotency_key,job_type,platform,source_account_id,conversation_id,entity_id,revision,
          state,attempt,max_attempts,next_retry_at,lock_token,last_error_code,retryable,
          first_started_at,last_started_at,finished_at,payload_json,created_at,updated_at
        ) VALUES (?,?,?,?,?,?,?,?, 'RUNNING',?,?, '',?, '',0,?,?, '',?,?,?)
        ON CONFLICT(idempotency_key) DO UPDATE SET
          job_type=excluded.job_type, platform=excluded.platform, source_account_id=excluded.source_account_id,
          conversation_id=excluded.conversation_id, entity_id=excluded.entity_id, revision=excluded.revision,
          state='RUNNING', attempt=excluded.attempt, max_attempts=excluded.max_attempts,
          next_retry_at='', lock_token=excluded.lock_token, last_error_code='', retryable=0,
          first_started_at=CASE WHEN background_job_state.first_started_at='' THEN excluded.first_started_at ELSE background_job_state.first_started_at END,
          last_started_at=excluded.last_started_at, finished_at='', payload_json=excluded.payload_json, updated_at=excluded.updated_at
      `).run(
        jobId, scope.idempotencyKey, scope.jobType, scope.platform, scope.sourceAccountId,
        scope.conversationId, scope.entityId, scope.revision, nextAttempt, maxAttempts,
        lockToken, firstStartedAt, at, JSON.stringify(payload), existing?.createdAt || at, at
      );
      store.db.prepare(`UPDATE background_job_state SET owner_process_generation=?,owner_pid=?,owner_process_identity=?,last_heartbeat_at=?
        WHERE idempotency_key=? AND lock_token=? AND state='RUNNING'`)
        .run(this.processGeneration, this.pid, this.processIdentity, at, scope.idempotencyKey, lockToken);
      const job = normalizeRow(store.db.prepare('SELECT * FROM background_job_state WHERE idempotency_key=?').get(scope.idempotencyKey));
      const recoveredPriorOwner = existing?.state === STATES.RUNNING;
      return { acquired: true, reason: recoveredPriorOwner ? 'stale-or-dead-owner-recovered' : 'acquired', lease: { idempotencyKey: scope.idempotencyKey, lockToken, processGeneration: this.processGeneration, pid: this.pid, processIdentity: this.processIdentity }, job };
    });
  }

  heartbeat(lease = {}, storeOverride) {
    const store = this.resolveStore(storeOverride);
    const at = iso(this.clock());
    const run = store.db.prepare(`UPDATE background_job_state SET last_heartbeat_at=?,updated_at=?
      WHERE idempotency_key=? AND lock_token=? AND state='RUNNING' AND owner_process_generation=? AND owner_pid=? AND owner_process_identity=?`)
      .run(at, at, clean(lease.idempotencyKey, 128), clean(lease.lockToken, 80), clean(lease.processGeneration || this.processGeneration, 100), Number(lease.pid || this.pid), clean(lease.processIdentity || this.processIdentity, 240));
    return { updated: run.changes > 0, job: this.read(lease.idempotencyKey, store) };
  }

  succeed(lease = {}, result = {}, storeOverride) {
    const store = this.resolveStore(storeOverride);
    const at = iso(this.clock());
    const run = store.db.prepare(`
      UPDATE background_job_state SET state='SUCCEEDED', next_retry_at='', last_error_code='', retryable=0,
        lock_token='', owner_process_generation='', owner_pid=0, owner_process_identity='', last_heartbeat_at='', finished_at=?, payload_json=?, updated_at=?
      WHERE idempotency_key=? AND lock_token=? AND state='RUNNING'
    `).run(at, JSON.stringify(safePayload(result)), at, clean(lease.idempotencyKey, 128), clean(lease.lockToken, 80));
    if (!run.changes) return { updated: false, reason: 'lease-lost', job: this.read(lease.idempotencyKey, store) };
    return { updated: true, job: this.read(lease.idempotencyKey, store) };
  }

  fail(lease = {}, error = {}, options = {}, storeOverride) {
    const store = this.resolveStore(storeOverride);
    const now = Number(options.now || this.clock());
    const at = iso(now);
    return store.transaction(() => {
      const current = normalizeRow(store.db.prepare('SELECT * FROM background_job_state WHERE idempotency_key=?').get(clean(lease.idempotencyKey, 128)));
      if (!current || current.lockToken !== clean(lease.lockToken, 80) || current.state !== STATES.RUNNING) {
        return { updated: false, reason: 'lease-lost', job: current };
      }
      const retryable = options.retryable !== false;
      const maxAttempts = Math.max(1, Number(options.maxAttempts || current.maxAttempts || 1));
      const retryDelayMs = Math.max(1000, Number(options.retryDelayMs || DEFAULT_RETRY_DELAY_MS));
      const maxRetryDelayMs = Math.max(retryDelayMs, Number(options.maxRetryDelayMs || DEFAULT_MAX_RETRY_DELAY_MS));
      const canRetry = retryable && current.attempt < maxAttempts;
      const state = canRetry ? STATES.RETRY_WAIT : STATES.FAILED_FINAL;
      const delayMs = canRetry ? Math.min(maxRetryDelayMs, retryDelayMs * (2 ** Math.max(0, current.attempt - 1))) : 0;
      const nextRetryAt = canRetry ? iso(now + delayMs) : '';
      const code = clean(error.code || error.errorCode || error.message || error || 'BACKGROUND_JOB_FAILED', 180).toUpperCase();
      store.db.prepare(`
        UPDATE background_job_state SET state=?, max_attempts=?, next_retry_at=?, lock_token='', owner_process_generation='', owner_pid=0, owner_process_identity='', last_heartbeat_at='',
          last_error_code=?, retryable=?, finished_at=?, payload_json=?, updated_at=?
        WHERE idempotency_key=? AND lock_token=? AND state='RUNNING'
      `).run(
        state, maxAttempts, nextRetryAt, code, canRetry ? 1 : 0, canRetry ? '' : at,
        JSON.stringify(safePayload(options.payload || {})), at, current.idempotencyKey, lease.lockToken
      );
      return { updated: true, state, nextRetryAt, retryable: canRetry, attempt: current.attempt, job: this.read(current.idempotencyKey, store) };
    });
  }

  reconcileSucceeded(input = {}, result = {}, storeOverride) {
    const store = this.resolveStore(storeOverride);
    const scope = identity(input);
    const at = iso(this.clock());
    const run = store.db.prepare(`
      UPDATE background_job_state SET state='SUCCEEDED', next_retry_at='', lock_token='', owner_process_generation='', owner_pid=0, owner_process_identity='', last_heartbeat_at='', last_error_code='',
        retryable=0, finished_at=?, payload_json=?, updated_at=?
      WHERE idempotency_key=? AND state<>'SUCCEEDED'
    `).run(at, JSON.stringify(safePayload(result)), at, scope.idempotencyKey);
    return { updated: run.changes > 0, job: this.read(scope.idempotencyKey, store) };
  }

  cancel(input, reason = 'cancelled', storeOverride) {
    const store = this.resolveStore(storeOverride);
    const key = typeof input === 'string' ? clean(input, 128) : identity(input).idempotencyKey;
    const at = iso(this.clock());
    const result = store.db.prepare(`
      UPDATE background_job_state SET state='CANCELLED', lock_token='', owner_process_generation='', owner_pid=0, owner_process_identity='', last_heartbeat_at='', retryable=0, next_retry_at='',
        last_error_code=?, finished_at=?, updated_at=? WHERE idempotency_key=?
    `).run(clean(reason, 180).toUpperCase(), at, at, key);
    return { updated: result.changes > 0, job: this.read(key, store) };
  }

  recoverInterrupted(options = {}, storeOverride) {
    const store = this.resolveStore(storeOverride);
    const now = Number(options.now || this.clock());
    const staleRunningMs = Math.max(1000, Number(options.staleRunningMs || this.staleRunningMs));
    const retryAt = iso(now + Math.max(1000, Number(options.retryDelayMs || 30_000)));
    const clauses = ["state='RUNNING'"];
    const params = [];
    for (const [column, value, max] of [
      ['job_type', options.jobType, 100], ['platform', options.platform, 60],
      ['source_account_id', options.sourceAccountId || options.accountId, 180],
      ['conversation_id', options.conversationId, 220], ['entity_id', options.entityId, 240]
    ]) {
      if (clean(value, max)) { clauses.push(`${column}=?`); params.push(clean(value, max)); }
    }
    const where = clauses.join(' AND ');
    return store.transaction(() => {
      const candidates = store.db.prepare(`SELECT * FROM background_job_state WHERE ${where}`).all(...params).map(normalizeRow);
      const recovered = [];
      const update = store.db.prepare(`UPDATE background_job_state SET state='RETRY_WAIT', next_retry_at=?, lock_token='',
        owner_process_generation='', owner_pid=0, owner_process_identity='', last_heartbeat_at='', retryable=1,
        last_error_code='INTERRUPTED_PROCESS_RECOVERY', updated_at=?
        WHERE idempotency_key=? AND state='RUNNING' AND lock_token=? AND owner_process_generation=?
          AND owner_pid=? AND owner_process_identity=? AND last_heartbeat_at=?`);
      for (const candidate of candidates) {
        if (this.ownerIsActive(candidate, now, staleRunningMs)) continue;
        const changed = update.run(
          retryAt, iso(now), candidate.idempotencyKey, candidate.lockToken,
          candidate.ownerProcessGeneration, candidate.ownerPid, candidate.ownerProcessIdentity, candidate.lastHeartbeatAt
        );
        if (changed.changes) recovered.push(this.read(candidate.idempotencyKey, store));
      }
      return recovered;
    });
  }

  snapshot(filter = {}, storeOverride) {
    const store = this.resolveStore(storeOverride);
    const baseClauses = [];
    const baseParams = [];
    for (const [column, value, max] of [
      ['job_type', filter.jobType, 100], ['platform', filter.platform, 60],
      ['source_account_id', filter.sourceAccountId, 180], ['conversation_id', filter.conversationId, 220],
      ['entity_id', filter.entityId, 240], ['state', filter.state, 40]
    ]) {
      if (clean(value, max)) { baseClauses.push(`${column}=?`); baseParams.push(clean(value, max)); }
    }
    const states = Array.isArray(filter.states)
      ? [...new Set(filter.states.map(value => clean(value).toUpperCase()).filter(value => Object.values(STATES).includes(value)))]
      : [];
    if (states.length) {
      baseClauses.push(`state IN (${states.map(() => '?').join(',')})`);
      baseParams.push(...states);
    }
    const dueBefore = clean(filter.dueBefore);
    if (dueBefore) {
      baseClauses.push("(state<>'RETRY_WAIT' OR next_retry_at='' OR next_retry_at<=?)");
      baseParams.push(dueBefore);
    }
    const baseWhere = baseClauses.length ? `WHERE ${baseClauses.join(' AND ')}` : '';
    const pageClauses = [...baseClauses];
    const pageParams = [...baseParams];
    const order = clean(filter.order).toLowerCase() === 'oldest' ? 'oldest' : 'newest';
    const cursor = filter.cursor && typeof filter.cursor === 'object' ? filter.cursor : {};
    const cursorAt = clean(cursor.createdAt || cursor.created_at);
    const cursorId = clean(cursor.jobId || cursor.job_id);
    if (cursorAt && cursorId) {
      pageClauses.push(order === 'oldest'
        ? '(created_at>? OR (created_at=? AND job_id>?))'
        : '(created_at<? OR (created_at=? AND job_id<?))');
      pageParams.push(cursorAt, cursorAt, cursorId);
    }
    const pageWhere = pageClauses.length ? `WHERE ${pageClauses.join(' AND ')}` : '';
    const limit = Math.max(1, Math.min(5000, Number(filter.limit || 500)));
    const direction = order === 'oldest' ? 'ASC' : 'DESC';
    const rows = store.db.prepare(`SELECT * FROM background_job_state ${pageWhere} ORDER BY created_at ${direction},job_id ${direction} LIMIT ?`).all(...pageParams, limit + 1);
    const hasMore = rows.length > limit;
    const pageRows = rows.slice(0, limit);
    const jobs = pageRows.map(normalizeRow);
    const total = Number(store.db.prepare(`SELECT COUNT(*) AS count FROM background_job_state ${baseWhere}`).get(...baseParams)?.count || 0);
    const pageRemaining = Number(store.db.prepare(`SELECT COUNT(*) AS count FROM background_job_state ${pageWhere}`).get(...pageParams)?.count || 0);
    const stateRows = store.db.prepare(`SELECT state,COUNT(*) AS count FROM background_job_state ${baseWhere} GROUP BY state`).all(...baseParams);
    const counts = Object.fromEntries(Object.values(STATES).map(state => [state, 0]));
    for (const row of stateRows) if (Object.prototype.hasOwnProperty.call(counts, row.state)) counts[row.state] = Number(row.count || 0);
    const typeRows = store.db.prepare(`SELECT job_type,state,COUNT(*) AS count FROM background_job_state ${baseWhere} GROUP BY job_type,state ORDER BY job_type,state`).all(...baseParams);
    const byType = {};
    for (const row of typeRows) {
      const type = clean(row.job_type, 100) || 'unknown';
      byType[type] ||= { total: 0, pending: 0, running: 0, succeeded: 0, retryWait: 0, failedFinal: 0, cancelled: 0, superseded: 0 };
      const count = Number(row.count || 0);
      byType[type].total += count;
      if (row.state === STATES.PENDING) byType[type].pending += count;
      else if (row.state === STATES.RUNNING) byType[type].running += count;
      else if (row.state === STATES.SUCCEEDED) byType[type].succeeded += count;
      else if (row.state === STATES.RETRY_WAIT) byType[type].retryWait += count;
      else if (row.state === STATES.FAILED_FINAL) byType[type].failedFinal += count;
      else if (row.state === STATES.CANCELLED) byType[type].cancelled += count;
      else if (row.state === STATES.SUPERSEDED) byType[type].superseded += count;
    }
    const unresolved = Number(counts.PENDING + counts.RUNNING + counts.RETRY_WAIT + counts.FAILED_FINAL);
    const latestFinalFailures = store.db.prepare(`SELECT * FROM background_job_state ${baseWhere}${baseWhere ? ' AND' : ' WHERE'} state='FAILED_FINAL' ORDER BY updated_at DESC LIMIT 20`).all(...baseParams).map(normalizeRow);
    const counted = Object.values(counts).reduce((sum, value) => sum + Number(value || 0), 0);
    const last = pageRows[pageRows.length - 1] || null;
    const oldestPending = store.db.prepare(`SELECT created_at FROM background_job_state ${baseWhere}${baseWhere ? ' AND' : ' WHERE'} state IN ('PENDING','RUNNING','RETRY_WAIT') ORDER BY created_at ASC,job_id ASC LIMIT 1`).get(...baseParams);
    return {
      jobs, counts, total, byType, unresolved, latestFinalFailures, hasMore,
      nextCursor: hasMore && last ? { createdAt: last.created_at, jobId: last.job_id } : null,
      remaining: Math.max(0, pageRemaining - jobs.length),
      oldestPendingAt: clean(oldestPending?.created_at),
      consistency: { pass: counted === total, counted, total, rowsReturned: jobs.length, limit, hasMore, order }
    };
  }

}

const authority = new BackgroundJobAuthority();

module.exports = {
  STATES,
  BackgroundJobAuthority,
  authority,
  identity,
  ensureSchema,
  enqueue: (...args) => authority.enqueue(...args),
  begin: (...args) => authority.begin(...args),
  heartbeat: (...args) => authority.heartbeat(...args),
  succeed: (...args) => authority.succeed(...args),
  fail: (...args) => authority.fail(...args),
  reconcileSucceeded: (...args) => authority.reconcileSucceeded(...args),
  read: (...args) => authority.read(...args),
  recoverInterrupted: (...args) => authority.recoverInterrupted(...args),
  snapshot: (...args) => authority.snapshot(...args)
};
