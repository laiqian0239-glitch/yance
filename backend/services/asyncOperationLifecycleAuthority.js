'use strict';

const crypto = require('crypto');
const { getStore } = require('../repositories/storeProvider');
const { parseJson } = require('../lib/r32SqliteStore');

const STATES = Object.freeze({
  CREATED: 'CREATED',
  RUNNING: 'RUNNING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  SUPERSEDED: 'SUPERSEDED'
});
const TERMINAL = new Set([STATES.SUCCEEDED, STATES.FAILED, STATES.CANCELLED, STATES.SUPERSEDED]);

function clean(value, max = 500) { return String(value == null ? '' : value).trim().slice(0, max); }
function nowIso(clock) { return new Date(Number(clock())).toISOString(); }
function safeJson(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const forbidden = /token|secret|password|cookie|authorization|credential|api.?key|phone.?code|qr/i;
  return Object.fromEntries(Object.entries(source)
    .filter(([key]) => !forbidden.test(key))
    .map(([key, item]) => [clean(key, 120), typeof item === 'string' ? clean(item, 1000) : item]));
}
function ensureSchema(store) {
  store.db.exec(`
    CREATE TABLE IF NOT EXISTS async_operation_state (
      operation_id TEXT PRIMARY KEY,
      operation_type TEXT NOT NULL,
      scope_key TEXT NOT NULL,
      object_fingerprint TEXT NOT NULL,
      generation INTEGER NOT NULL,
      state TEXT NOT NULL DEFAULT 'CREATED',
      progress INTEGER NOT NULL DEFAULT 0,
      result_json TEXT NOT NULL DEFAULT '{}',
      error_code TEXT NOT NULL DEFAULT '',
      error_message TEXT NOT NULL DEFAULT '',
      superseded_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      started_at TEXT NOT NULL DEFAULT '',
      finished_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      CHECK(state IN ('CREATED','RUNNING','SUCCEEDED','FAILED','CANCELLED','SUPERSEDED')),
      CHECK(progress >= 0 AND progress <= 100),
      UNIQUE(operation_type, scope_key, generation)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_async_operation_scope
      ON async_operation_state(operation_type, scope_key, generation DESC);
    CREATE INDEX IF NOT EXISTS idx_async_operation_state
      ON async_operation_state(state, updated_at DESC);
  `);
  const columns = new Set(store.db.prepare('PRAGMA table_info(async_operation_state)').all().map(row => String(row.name)));
  for (const [name, definition] of [
    ['resume_policy', "TEXT NOT NULL DEFAULT 'fail_on_restart'"],
    ['lease_owner', "TEXT NOT NULL DEFAULT ''"],
    ['lease_expires_at', "TEXT NOT NULL DEFAULT ''"],
    ['challenge_expires_at', "TEXT NOT NULL DEFAULT ''"],
    ['adapter_session_id', "TEXT NOT NULL DEFAULT ''"]
  ]) if (!columns.has(name)) store.db.exec(`ALTER TABLE async_operation_state ADD COLUMN ${name} ${definition}`);
}
function normalize(row) {
  if (!row) return null;
  return {
    operationId: row.operation_id,
    operationType: row.operation_type,
    scopeKey: row.scope_key,
    objectFingerprint: row.object_fingerprint,
    generation: Number(row.generation || 0),
    state: row.state,
    progress: Number(row.progress || 0),
    result: parseJson(row.result_json, {}) || {},
    errorCode: row.error_code,
    errorMessage: row.error_message,
    supersededBy: row.superseded_by,
    resumePolicy: row.resume_policy || 'fail_on_restart',
    leaseOwner: row.lease_owner || '',
    leaseExpiresAt: row.lease_expires_at || '',
    challengeExpiresAt: row.challenge_expires_at || '',
    adapterSessionId: row.adapter_session_id || '',
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    updatedAt: row.updated_at
  };
}

class AsyncOperationLifecycleAuthority {
  constructor(options = {}) {
    this.store = options.store || null;
    this.clock = typeof options.clock === 'function' ? options.clock : () => Date.now();
  }
  resolveStore(override) {
    const store = override || this.store || getStore();
    ensureSchema(store);
    return store;
  }
  read(operationId, storeOverride) {
    const store = this.resolveStore(storeOverride);
    return normalize(store.db.prepare('SELECT * FROM async_operation_state WHERE operation_id=?').get(clean(operationId, 240)));
  }
  latest(input = {}, storeOverride) {
    const store = this.resolveStore(storeOverride);
    return normalize(store.db.prepare(`
      SELECT * FROM async_operation_state WHERE operation_type=? AND scope_key=?
      ORDER BY generation DESC LIMIT 1
    `).get(clean(input.operationType, 120), clean(input.scopeKey, 500)));
  }
  create(input = {}, storeOverride) {
    const store = this.resolveStore(storeOverride);
    const operationType = clean(input.operationType || input.type, 120).toLowerCase();
    const scopeKey = clean(input.scopeKey || input.scope || input.entityId, 500);
    const objectFingerprint = clean(input.objectFingerprint || input.fingerprint, 500);
    if (!operationType || !scopeKey || !objectFingerprint) {
      const error = new Error('Async operation identity is incomplete');
      error.code = 'ASYNC_OPERATION_IDENTITY_INCOMPLETE';
      throw error;
    }
    const at = nowIso(this.clock);
    return store.transaction(() => {
      const current = normalize(store.db.prepare(`
        SELECT * FROM async_operation_state WHERE operation_type=? AND scope_key=?
        ORDER BY generation DESC LIMIT 1
      `).get(operationType, scopeKey));
      if (current && current.objectFingerprint === objectFingerprint && !TERMINAL.has(current.state)) {
        return { created: false, reason: 'same-operation-active', operation: current };
      }
      const generation = Math.max(Number(input.generation || 0), Number(current?.generation || 0) + 1);
      const requestedOperationId = clean(input.operationId, 240);
      let operationId = requestedOperationId || `op_${crypto.randomUUID()}`;
      if (store.db.prepare('SELECT 1 AS present FROM async_operation_state WHERE operation_id=?').get(operationId)) {
        operationId = `${requestedOperationId || 'op'}_g${generation}_${crypto.randomUUID()}`.slice(0, 240);
      }
      if (current && !TERMINAL.has(current.state)) {
        store.db.prepare(`
          UPDATE async_operation_state SET state='SUPERSEDED', superseded_by=?, error_code='SUPERSEDED_BY_NEW_GENERATION',
            error_message='A newer operation generation became authoritative.', finished_at=?, updated_at=?
          WHERE operation_id=? AND state IN ('CREATED','RUNNING')
        `).run(operationId, at, at, current.operationId);
      }
      store.db.prepare(`
        INSERT INTO async_operation_state(
          operation_id,operation_type,scope_key,object_fingerprint,generation,state,progress,result_json,
          error_code,error_message,superseded_by,created_at,started_at,finished_at,updated_at,
          resume_policy,lease_owner,lease_expires_at,challenge_expires_at,adapter_session_id
        ) VALUES(?,?,?,?,?,'CREATED',0,?,'','','',?,'','',?,?,?,?,?,?)
      `).run(operationId, operationType, scopeKey, objectFingerprint, generation, JSON.stringify(safeJson(input.metadata || {})), at, at,
        clean(input.resumePolicy || input.resume_policy, 80) || 'fail_on_restart', clean(input.leaseOwner, 240), clean(input.leaseExpiresAt, 80),
        clean(input.challengeExpiresAt, 80), clean(input.adapterSessionId, 500));
      return { created: true, operation: this.read(operationId, store) };
    });
  }
  start(operationId, input = {}, storeOverride) {
    const store = this.resolveStore(storeOverride);
    const at = nowIso(this.clock);
    return store.transaction(() => {
      const current = this.read(operationId, store);
      if (!current) return { updated: false, reason: 'not-found', operation: null };
      const latest = this.latest(current, store);
      if (latest?.operationId !== current.operationId || latest?.objectFingerprint !== current.objectFingerprint) {
        return { updated: false, reason: 'stale-generation', operation: current };
      }
      const run = store.db.prepare(`
        UPDATE async_operation_state SET state='RUNNING', progress=?, started_at=CASE WHEN started_at='' THEN ? ELSE started_at END,
          error_code='',error_message='',resume_policy=CASE WHEN ?<>'' THEN ? ELSE resume_policy END,
          lease_owner=CASE WHEN ?<>'' THEN ? ELSE lease_owner END,
          lease_expires_at=CASE WHEN ?<>'' THEN ? ELSE lease_expires_at END,
          challenge_expires_at=CASE WHEN ?<>'' THEN ? ELSE challenge_expires_at END,
          adapter_session_id=CASE WHEN ?<>'' THEN ? ELSE adapter_session_id END,updated_at=?
          WHERE operation_id=? AND state='CREATED'
      `).run(Math.max(0, Math.min(99, Number(input.progress || 1))), at,
        clean(input.resumePolicy,80), clean(input.resumePolicy,80), clean(input.leaseOwner,240), clean(input.leaseOwner,240),
        clean(input.leaseExpiresAt,80), clean(input.leaseExpiresAt,80), clean(input.challengeExpiresAt,80), clean(input.challengeExpiresAt,80),
        clean(input.adapterSessionId,500), clean(input.adapterSessionId,500), at, current.operationId);
      return { updated: run.changes > 0, reason: run.changes ? 'started' : 'invalid-state', operation: this.read(current.operationId, store) };
    });
  }
  progress(operationId, value, storeOverride) {
    const store = this.resolveStore(storeOverride);
    const at = nowIso(this.clock);
    const progress = Math.max(1, Math.min(99, Number(value || 1)));
    const run = store.db.prepare(`UPDATE async_operation_state SET progress=?,updated_at=? WHERE operation_id=? AND state='RUNNING'`)
      .run(progress, at, clean(operationId, 240));
    return { updated: run.changes > 0, operation: this.read(operationId, store) };
  }
  settle(operationId, state, input = {}, storeOverride) {
    const target = clean(state, 40).toUpperCase();
    if (![STATES.SUCCEEDED, STATES.FAILED, STATES.CANCELLED].includes(target)) {
      const error = new Error(`Unsupported async operation terminal state: ${target}`);
      error.code = 'ASYNC_OPERATION_TERMINAL_STATE_INVALID';
      throw error;
    }
    const store = this.resolveStore(storeOverride);
    const at = nowIso(this.clock);
    return store.transaction(() => {
      const current = this.read(operationId, store);
      if (!current) return { updated: false, reason: 'not-found', operation: null };
      const latest = this.latest(current, store);
      const expectedFingerprint = clean(input.objectFingerprint || input.fingerprint, 500);
      const expectedGeneration = Number(input.generation || 0);
      if (latest?.operationId !== current.operationId
        || (expectedFingerprint && expectedFingerprint !== current.objectFingerprint)
        || (expectedGeneration && expectedGeneration !== current.generation)) {
        if (!TERMINAL.has(current.state)) {
          store.db.prepare(`UPDATE async_operation_state SET state='SUPERSEDED',error_code='STALE_COMPLETION_REJECTED',
            error_message='Completion did not match the current operation generation.',finished_at=?,updated_at=? WHERE operation_id=?`)
            .run(at, at, current.operationId);
        }
        return { updated: false, reason: 'stale-completion', operation: this.read(current.operationId, store) };
      }
      const errorCode = target === STATES.SUCCEEDED ? '' : clean(input.errorCode || input.code || target, 180).toUpperCase();
      const errorMessage = target === STATES.SUCCEEDED ? '' : clean(input.errorMessage || input.message, 1000);
      const run = store.db.prepare(`
        UPDATE async_operation_state SET state=?,progress=?,result_json=?,error_code=?,error_message=?,lease_owner='',lease_expires_at='',challenge_expires_at='',finished_at=?,updated_at=?
        WHERE operation_id=? AND state IN ('CREATED','RUNNING')
      `).run(target, target === STATES.SUCCEEDED ? 100 : Math.max(0, Math.min(99, Number(input.progress || current.progress || 0))),
        JSON.stringify(safeJson(input.result || {})), errorCode, errorMessage, at, at, current.operationId);
      return { updated: run.changes > 0, reason: run.changes ? 'settled' : 'invalid-state', operation: this.read(current.operationId, store) };
    });
  }
  succeed(operationId, result = {}, options = {}, storeOverride) {
    return this.settle(operationId, STATES.SUCCEEDED, { ...options, result }, storeOverride);
  }
  fail(operationId, error = {}, options = {}, storeOverride) {
    return this.settle(operationId, STATES.FAILED, {
      ...options,
      errorCode: error.code || error.errorCode || options.errorCode,
      errorMessage: error.message || error.errorMessage || String(error || '')
    }, storeOverride);
  }
  cancel(operationId, reason = 'CANCELLED', options = {}, storeOverride) {
    return this.settle(operationId, STATES.CANCELLED, { ...options, errorCode: reason, errorMessage: clean(options.message || reason) }, storeOverride);
  }
  async recoverInterruptedAuthOperations(options = {}, storeOverride) {
    const store = this.resolveStore(storeOverride);
    const rows = store.db.prepare(`SELECT * FROM async_operation_state
      WHERE state='RUNNING' AND operation_type='platform.auth.workflow' ORDER BY updated_at`).all();
    const report = { scanned: rows.length, resumed: 0, failed: 0 };
    for (const raw of rows) {
      const row = normalize(raw);
      const resumable = row.resumePolicy === 'resume_adapter_session' && row.adapterSessionId
        && typeof options.canResume === 'function' && await options.canResume(row.adapterSessionId, row);
      if (resumable) {
        if (typeof options.resume === 'function') await options.resume(row.adapterSessionId, row);
        const at = nowIso(this.clock);
        store.db.prepare(`UPDATE async_operation_state SET lease_owner=?,lease_expires_at=?,updated_at=?
          WHERE operation_id=? AND state='RUNNING' AND generation=?`)
          .run(clean(options.leaseOwner || `restart-${process.pid}`,240), new Date(Number(this.clock()) + Number(options.leaseMs || 120000)).toISOString(), at, row.operationId, row.generation);
        report.resumed += 1;
        continue;
      }
      const settled = this.fail(row.operationId, {
        code: 'PROCESS_RESTARTED_AUTH_CONTEXT_LOST',
        message: '认证 challenge 仅存在于旧进程，无法继续。'
      }, { generation: row.generation, objectFingerprint: row.objectFingerprint }, store);
      if (settled.updated) report.failed += 1;
    }
    return report;
  }

  snapshot(filter = {}, storeOverride) {
    const store = this.resolveStore(storeOverride);
    const baseClauses = [];
    const baseParams = [];
    for (const [column, value] of [['operation_type', filter.operationType], ['scope_key', filter.scopeKey], ['state', filter.state]]) {
      if (clean(value)) { baseClauses.push(`${column}=?`); baseParams.push(clean(value)); }
    }
    const states = Array.isArray(filter.states)
      ? [...new Set(filter.states.map(value => clean(value).toUpperCase()).filter(value => Object.values(STATES).includes(value)))]
      : [];
    if (states.length) {
      baseClauses.push(`state IN (${states.map(() => '?').join(',')})`);
      baseParams.push(...states);
    }
    const baseWhere = baseClauses.length ? ` WHERE ${baseClauses.join(' AND ')}` : '';
    const pageClauses = [...baseClauses];
    const pageParams = [...baseParams];
    const order = clean(filter.order).toLowerCase() === 'oldest' ? 'oldest' : 'newest';
    const cursor = filter.cursor && typeof filter.cursor === 'object' ? filter.cursor : {};
    const cursorAt = clean(cursor.createdAt || cursor.created_at);
    const cursorId = clean(cursor.operationId || cursor.operation_id);
    if (cursorAt && cursorId) {
      pageClauses.push(order === 'oldest'
        ? '(created_at>? OR (created_at=? AND operation_id>?))'
        : '(created_at<? OR (created_at=? AND operation_id<?))');
      pageParams.push(cursorAt, cursorAt, cursorId);
    }
    const pageWhere = pageClauses.length ? ` WHERE ${pageClauses.join(' AND ')}` : '';
    const limit = Math.max(1, Math.min(2000, Number(filter.limit || 200)));
    const direction = order === 'oldest' ? 'ASC' : 'DESC';
    const rows = store.db.prepare(`SELECT * FROM async_operation_state${pageWhere} ORDER BY created_at ${direction},operation_id ${direction} LIMIT ?`).all(...pageParams, limit + 1);
    const hasMore = rows.length > limit;
    const pageRows = rows.slice(0, limit);
    const operations = pageRows.map(normalize);
    const counts = Object.fromEntries(Object.values(STATES).map(state => [state, 0]));
    for (const row of store.db.prepare(`SELECT state,COUNT(*) AS count FROM async_operation_state${baseWhere} GROUP BY state`).all(...baseParams)) counts[row.state] = Number(row.count || 0);
    const total = Object.values(counts).reduce((sum, value) => sum + Number(value || 0), 0);
    const pageRemaining = Number(store.db.prepare(`SELECT COUNT(*) AS count FROM async_operation_state${pageWhere}`).get(...pageParams)?.count || 0);
    const last = pageRows[pageRows.length - 1] || null;
    const oldest = store.db.prepare(`SELECT created_at FROM async_operation_state${baseWhere}${baseWhere ? ' AND' : ' WHERE'} state IN ('CREATED','RUNNING') ORDER BY created_at ASC,operation_id ASC LIMIT 1`).get(...baseParams);
    return {
      operations, counts, active: counts.CREATED + counts.RUNNING, failed: counts.FAILED,
      total,
      hasMore, nextCursor: hasMore && last ? { createdAt: last.created_at, operationId: last.operation_id } : null,
      remaining: Math.max(0, pageRemaining - operations.length),
      oldestPendingAt: clean(oldest?.created_at),
      consistency: { pass: operations.every(row => row.operationId && row.operationType && row.scopeKey && row.objectFingerprint && row.generation > 0), hasMore, order }
    };
  }

}

const authority = new AsyncOperationLifecycleAuthority();
module.exports = { STATES, TERMINAL, AsyncOperationLifecycleAuthority, authority, ensureSchema };
