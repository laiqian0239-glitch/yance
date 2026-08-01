'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const { AppRuntimeError } = require('./errors');
const { OPERATING_MODES, assertOperatingMode } = require('./OperatingMode');

function nowIso() { return new Date().toISOString(); }
function json(value) { return JSON.stringify(value ?? null); }
function parseJson(value, fallback = null) { try { return value == null || value === '' ? fallback : JSON.parse(value); } catch (_) { return fallback; } }
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function envelopeHash(envelope) { return crypto.createHash('sha256').update(stable(envelope)).digest('hex'); }
function clean(value) { return String(value == null ? '' : value).trim(); }
function unique(values) { return [...new Set((Array.isArray(values) ? values : []).map(clean).filter(Boolean))]; }
function dateLike(value) { return Number.isFinite(Date.parse(clean(value))); }
function buildOperatingModeMetadata(mode, input = {}, at = nowIso()) {
  const target = assertOperatingMode(mode, { source: 'buildOperatingModeMetadata' });
  const safeMode = target === OPERATING_MODES.SAFE_MODE;
  const reasonCode = clean(input.reasonCode || input.code || input.reason) || (safeMode ? 'SAFE_MODE_REASON_UNSPECIFIED' : '');
  const reasons = unique([reasonCode, ...(Array.isArray(input.reasons) ? input.reasons : []), ...(Array.isArray(input.triggers) ? input.triggers : [])]);
  const trigger = safeMode ? clean(input.trigger || input.source || 'runtime-authority') : '';
  const updatedBy = clean(input.actor || input.updatedBy || input.source || 'runtime-authority');
  const evidence = input.evidence && typeof input.evidence === 'object'
    ? input.evidence
    : safeMode ? { reasonCode, reasons, trigger, updatedBy } : null;
  return {
    schemaVersion: 1,
    reasonCode: safeMode ? reasonCode : '',
    reasons: safeMode ? reasons : [],
    trigger,
    enteredAt: safeMode ? clean(input.enteredAt || at) : '',
    updatedAt: at,
    updatedBy,
    evidenceSha256: evidence ? crypto.createHash('sha256').update(stable(evidence)).digest('hex') : ''
  };
}

class RuntimeStateStore {
  constructor(options = {}) {
    this.dbPath = path.resolve(options.dbPath || path.join(process.cwd(), 'data', 'store', 'yance-r32.db'));
    this.clock = options.clock || nowIso;
    if (!options.db) {
      const error = new Error('RuntimeStateStore requires a broker-owned SQLite connection');
      error.code = 'SQLITE_BROKER_REQUIRED';
      throw error;
    }
    this.ownsDb = false;
    this.db = options.db;
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=8000;');
    this.ensureSchema();
  }

  ensureSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runtime_fencing_counter (
        id INTEGER PRIMARY KEY CHECK(id=1), value INTEGER NOT NULL
      ) STRICT;
      INSERT OR IGNORE INTO runtime_fencing_counter(id,value) VALUES(1,0);

      CREATE TABLE IF NOT EXISTS runtime_lease (
        lease_name TEXT PRIMARY KEY,
        owner_instance_id TEXT NOT NULL,
        owner_pid INTEGER NOT NULL,
        fencing_token INTEGER NOT NULL,
        build_id TEXT NOT NULL,
        acquired_at_utc TEXT NOT NULL,
        heartbeat_at_utc TEXT NOT NULL,
        lease_expires_at_utc TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS runtime_state (
        id INTEGER PRIMARY KEY CHECK(id=1),
        state_version INTEGER NOT NULL,
        operating_mode_revision INTEGER NOT NULL,
        lifecycle_state TEXT NOT NULL,
        operating_mode TEXT NOT NULL,
        operating_mode_metadata_json TEXT NOT NULL DEFAULT '{}',
        local_ready INTEGER NOT NULL,
        owner_instance_id TEXT NOT NULL,
        fencing_token INTEGER NOT NULL,
        capabilities_json TEXT NOT NULL,
        diagnostics_json TEXT NOT NULL,
        updated_at_utc TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS runtime_transition_log (
        transition_id INTEGER PRIMARY KEY AUTOINCREMENT,
        boot_attempt_id TEXT NOT NULL,
        from_state TEXT NOT NULL,
        to_state TEXT NOT NULL,
        reason_code TEXT NOT NULL,
        occurred_at_utc TEXT NOT NULL,
        build_id TEXT NOT NULL,
        owner_instance_id TEXT NOT NULL,
        fencing_token INTEGER NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS boot_attempt (
        boot_attempt_id TEXT PRIMARY KEY,
        build_id TEXT NOT NULL,
        owner_instance_id TEXT NOT NULL,
        owner_pid INTEGER NOT NULL,
        fencing_token INTEGER NOT NULL,
        started_at_utc TEXT NOT NULL,
        completed_at_utc TEXT NOT NULL DEFAULT '',
        failed_phase TEXT NOT NULL DEFAULT '',
        reason_code TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS credential_hydration_state (
        id INTEGER PRIMARY KEY CHECK(id=1),
        vault_epoch TEXT NOT NULL DEFAULT '',
        generation INTEGER NOT NULL DEFAULT 0,
        hydrated INTEGER NOT NULL DEFAULT 0,
        hydrated_at_utc TEXT NOT NULL DEFAULT '',
        owner_instance_id TEXT NOT NULL DEFAULT '',
        fencing_token INTEGER NOT NULL DEFAULT 0
      ) STRICT;
      INSERT OR IGNORE INTO credential_hydration_state(id) VALUES(1);

      CREATE TABLE IF NOT EXISTS outbox_event (
        event_id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL,
        available_at_utc TEXT NOT NULL,
        claim_owner_instance_id TEXT NOT NULL DEFAULT '',
        claim_fencing_token INTEGER NOT NULL DEFAULT 0,
        claimed_at_utc TEXT NOT NULL DEFAULT '',
        acknowledged_at_utc TEXT NOT NULL DEFAULT '',
        attempt_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT NOT NULL DEFAULT '',
        created_at_utc TEXT NOT NULL,
        updated_at_utc TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_outbox_event_claim ON outbox_event(status,available_at_utc,created_at_utc);

      CREATE TABLE IF NOT EXISTS command_idempotency (
        command_id TEXT PRIMARY KEY,
        envelope_sha256 TEXT NOT NULL,
        envelope_json TEXT NOT NULL,
        response_json TEXT NOT NULL,
        created_at_utc TEXT NOT NULL,
        command_type TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'TERMINAL',
        target_mode TEXT NOT NULL DEFAULT '',
        committed_revision INTEGER NOT NULL DEFAULT 0,
        applied_revision INTEGER NOT NULL DEFAULT 0,
        published_at_utc TEXT NOT NULL DEFAULT '',
        terminal_at_utc TEXT NOT NULL DEFAULT '',
        last_error_code TEXT NOT NULL DEFAULT '',
        last_error_message TEXT NOT NULL DEFAULT ''
      ) STRICT;

      CREATE TABLE IF NOT EXISTS runtime_migration_receipt (
        migration_id TEXT PRIMARY KEY,
        migration_version INTEGER NOT NULL,
        source_canonical_path TEXT NOT NULL,
        source_fingerprint TEXT NOT NULL,
        source_file_count INTEGER NOT NULL,
        source_total_bytes INTEGER NOT NULL,
        target_schema_version INTEGER NOT NULL,
        status TEXT NOT NULL,
        selected_operating_mode TEXT NOT NULL,
        candidate_json TEXT NOT NULL,
        verification_json TEXT NOT NULL,
        owner_instance_id TEXT NOT NULL,
        fencing_token INTEGER NOT NULL,
        started_at_utc TEXT NOT NULL,
        completed_at_utc TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS runtime_event (
        event_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        event_type TEXT NOT NULL,
        state_version INTEGER NOT NULL,
        occurred_at_utc TEXT NOT NULL,
        payload_json TEXT NOT NULL
      ) STRICT;
    `);
    const runtimeStateColumns = new Set(this.db.prepare('PRAGMA table_info(runtime_state)').all().map(row => row.name));
    if (!runtimeStateColumns.has('operating_mode_revision')) {
      this.db.exec('ALTER TABLE runtime_state ADD COLUMN operating_mode_revision INTEGER NOT NULL DEFAULT 0');
      const latestModeEvent = this.db.prepare("SELECT state_version FROM runtime_event WHERE event_type IN ('runtime.authority_initialized','runtime.operating_mode_persisted') ORDER BY event_sequence DESC LIMIT 1").get();
      if (latestModeEvent) this.db.prepare('UPDATE runtime_state SET operating_mode_revision=? WHERE id=1 AND operating_mode_revision=0').run(Number(latestModeEvent.state_version));
    }
    if (!runtimeStateColumns.has('operating_mode_metadata_json')) {
      this.db.exec("ALTER TABLE runtime_state ADD COLUMN operating_mode_metadata_json TEXT NOT NULL DEFAULT '{}'");
      const row = this.db.prepare('SELECT operating_mode,updated_at_utc FROM runtime_state WHERE id=1').get();
      if (row) {
        const metadata = buildOperatingModeMetadata(row.operating_mode, {
          reasonCode: row.operating_mode === OPERATING_MODES.SAFE_MODE ? 'MIGRATED_SAFE_MODE' : '',
          reasons: row.operating_mode === OPERATING_MODES.SAFE_MODE ? ['MIGRATED_SAFE_MODE'] : [],
          trigger: 'runtime-state-schema-migration',
          actor: 'runtime-state-schema-migration'
        }, row.updated_at_utc || this.clock());
        this.db.prepare('UPDATE runtime_state SET operating_mode_metadata_json=? WHERE id=1').run(json(metadata));
      }
    }
    const credentialColumns = new Set(this.db.prepare('PRAGMA table_info(credential_hydration_state)').all().map(row => row.name));
    const additions = [
      ['authority_event_id', "TEXT NOT NULL DEFAULT ''"],
      ['authority_head_digest', "TEXT NOT NULL DEFAULT ''"],
      ['reference_count', 'INTEGER NOT NULL DEFAULT 0'],
      ['payload_bytes', 'INTEGER NOT NULL DEFAULT 0']
    ];
    for (const [name, definition] of additions) if (!credentialColumns.has(name)) this.db.exec(`ALTER TABLE credential_hydration_state ADD COLUMN ${name} ${definition}`);
    const commandColumns = new Set(this.db.prepare('PRAGMA table_info(command_idempotency)').all().map(row => row.name));
    const commandAdditions = [
      ['command_type', "TEXT NOT NULL DEFAULT ''"],
      ['status', "TEXT NOT NULL DEFAULT 'TERMINAL'"],
      ['target_mode', "TEXT NOT NULL DEFAULT ''"],
      ['committed_revision', 'INTEGER NOT NULL DEFAULT 0'],
      ['applied_revision', 'INTEGER NOT NULL DEFAULT 0'],
      ['published_at_utc', "TEXT NOT NULL DEFAULT ''"],
      ['terminal_at_utc', "TEXT NOT NULL DEFAULT ''"],
      ['last_error_code', "TEXT NOT NULL DEFAULT ''"],
      ['last_error_message', "TEXT NOT NULL DEFAULT ''"]
    ];
    for (const [name, definition] of commandAdditions) if (!commandColumns.has(name)) this.db.exec(`ALTER TABLE command_idempotency ADD COLUMN ${name} ${definition}`);
  }

  commandEnvelopeHash(envelope) { return envelopeHash(envelope); }

  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { try { this.db.exec('ROLLBACK'); } catch (_) {} throw error; }
  }

  _currentLease(leaseName) {
    return this.db.prepare('SELECT * FROM runtime_lease WHERE lease_name=?').get(leaseName) || null;
  }

  _assertFence(leaseName, ownerInstanceId, fencingToken) {
    const row = this._currentLease(leaseName);
    if (!row || row.owner_instance_id !== ownerInstanceId || Number(row.fencing_token) !== Number(fencingToken)) {
      throw new AppRuntimeError('STALE_FENCING_TOKEN', 'Runtime write rejected because ownership fencing is stale', {
        status: 409,
        details: { leaseName, ownerInstanceId, fencingToken, currentOwnerInstanceId: row?.owner_instance_id || '', currentFencingToken: Number(row?.fencing_token || 0) }
      });
    }
    return row;
  }

  _insertEvent(eventType, stateVersion, payload = {}) {
    const eventId = crypto.randomUUID();
    const occurredAtUtc = this.clock();
    const result = this.db.prepare(`INSERT INTO runtime_event(event_id,event_type,state_version,occurred_at_utc,payload_json) VALUES(?,?,?,?,?)`)
      .run(eventId, eventType, Number(stateVersion), occurredAtUtc, json(payload));
    return { eventSequence: Number(result.lastInsertRowid), eventId, eventType, stateVersion: Number(stateVersion), occurredAtUtc, payload };
  }

  acquireLease({ leaseName, ownerInstanceId, ownerPid, buildId, bootAttemptId, leaseDurationMs = 15000, initializeRuntimeState = true }) {
    return this.transaction(() => {
      const now = this.clock();
      const expires = new Date(Date.parse(now) + leaseDurationMs).toISOString();
      const currentCounter = Number(this.db.prepare('SELECT value FROM runtime_fencing_counter WHERE id=1').get().value || 0);
      const currentLease = this._currentLease(leaseName);
      const fencingToken = Math.max(currentCounter, Number(currentLease?.fencing_token || 0)) + 1;
      this.db.prepare('UPDATE runtime_fencing_counter SET value=? WHERE id=1').run(fencingToken);
      this.db.prepare(`
        INSERT INTO runtime_lease(lease_name,owner_instance_id,owner_pid,fencing_token,build_id,acquired_at_utc,heartbeat_at_utc,lease_expires_at_utc)
        VALUES(?,?,?,?,?,?,?,?)
        ON CONFLICT(lease_name) DO UPDATE SET owner_instance_id=excluded.owner_instance_id,owner_pid=excluded.owner_pid,
          fencing_token=excluded.fencing_token,build_id=excluded.build_id,acquired_at_utc=excluded.acquired_at_utc,
          heartbeat_at_utc=excluded.heartbeat_at_utc,lease_expires_at_utc=excluded.lease_expires_at_utc
      `).run(leaseName, ownerInstanceId, Number(ownerPid), fencingToken, buildId, now, now, expires);
      const previous = this.db.prepare('SELECT * FROM runtime_state WHERE id=1').get();
      let nextVersion = Number(previous?.state_version || 0);
      if (initializeRuntimeState) {
        const previousMode = previous?.operating_mode ? assertOperatingMode(previous.operating_mode, { source: 'acquireLease' }) : OPERATING_MODES.NORMAL;
        nextVersion += 1;
        this.db.prepare(`
          INSERT INTO runtime_state(id,state_version,operating_mode_revision,lifecycle_state,operating_mode,local_ready,owner_instance_id,fencing_token,capabilities_json,diagnostics_json,updated_at_utc)
          VALUES(1,?,?,'created',?,0,?,?,?, ?,?)
          ON CONFLICT(id) DO UPDATE SET state_version=excluded.state_version,lifecycle_state='created',local_ready=0,
            owner_instance_id=excluded.owner_instance_id,fencing_token=excluded.fencing_token,updated_at_utc=excluded.updated_at_utc
        `).run(nextVersion, Number(previous?.operating_mode_revision || nextVersion), previousMode, ownerInstanceId, fencingToken, json(parseJson(previous?.capabilities_json, {})), json({ failedPhase: null, reasonCode: null }), now);
      }
      this.db.prepare(`INSERT INTO boot_attempt(boot_attempt_id,build_id,owner_instance_id,owner_pid,fencing_token,started_at_utc,status) VALUES(?,?,?,?,?,?,'BOOTING')`)
        .run(bootAttemptId, buildId, ownerInstanceId, Number(ownerPid), fencingToken, now);
      const event = this._insertEvent('runtime.owner_acquired', nextVersion, { ownerInstanceId, ownerPid: Number(ownerPid), fencingToken, buildId, runtimeStateInitialized: initializeRuntimeState });
      return { leaseName, ownerInstanceId, ownerPid: Number(ownerPid), fencingToken, buildId, acquiredAtUtc: now, heartbeatAtUtc: now, leaseExpiresAtUtc: expires, bootAttemptId, event };
    });
  }

  heartbeat({ leaseName, ownerInstanceId, fencingToken, leaseDurationMs = 15000 }) {
    return this.transaction(() => {
      this._assertFence(leaseName, ownerInstanceId, fencingToken);
      const now = this.clock();
      const expires = new Date(Date.parse(now) + leaseDurationMs).toISOString();
      const result = this.db.prepare(`UPDATE runtime_lease SET heartbeat_at_utc=?,lease_expires_at_utc=? WHERE lease_name=? AND owner_instance_id=? AND fencing_token=?`)
        .run(now, expires, leaseName, ownerInstanceId, Number(fencingToken));
      if (Number(result.changes) !== 1) throw new AppRuntimeError('STALE_FENCING_TOKEN', 'Runtime lease heartbeat rejected', { status: 409 });
      return { heartbeatAtUtc: now, leaseExpiresAtUtc: expires };
    });
  }

  recordTransition({ leaseName, ownerInstanceId, fencingToken, bootAttemptId, buildId, fromState, toState, reasonCode = '' }) {
    return this.transaction(() => {
      this._assertFence(leaseName, ownerInstanceId, fencingToken);
      const state = this.db.prepare('SELECT * FROM runtime_state WHERE id=1').get();
      const nextVersion = Number(state?.state_version || 0) + 1;
      const occurredAtUtc = this.clock();
      const localReady = toState === 'local_ready' ? 1 : (toState === 'stopping' || toState === 'stopped' || toState === 'failed' ? 0 : Number(state?.local_ready || 0));
      const diagnostics = toState === 'failed' ? { failedPhase: fromState || null, reasonCode: reasonCode || 'APP_RUNTIME_FAILED' } : parseJson(state?.diagnostics_json, { failedPhase: null, reasonCode: null });
      const result = this.db.prepare(`
        UPDATE runtime_state SET state_version=?,lifecycle_state=?,local_ready=?,owner_instance_id=?,fencing_token=?,diagnostics_json=?,updated_at_utc=?
        WHERE id=1 AND EXISTS(SELECT 1 FROM runtime_lease WHERE lease_name=? AND owner_instance_id=? AND fencing_token=?)
      `).run(nextVersion, toState, localReady, ownerInstanceId, Number(fencingToken), json(diagnostics), occurredAtUtc, leaseName, ownerInstanceId, Number(fencingToken));
      if (Number(result.changes) !== 1) throw new AppRuntimeError('STALE_FENCING_TOKEN', 'Runtime transition rejected by fencing guard', { status: 409 });
      this.db.prepare(`INSERT INTO runtime_transition_log(boot_attempt_id,from_state,to_state,reason_code,occurred_at_utc,build_id,owner_instance_id,fencing_token) VALUES(?,?,?,?,?,?,?,?)`)
        .run(bootAttemptId, fromState, toState, reasonCode || '', occurredAtUtc, buildId, ownerInstanceId, Number(fencingToken));
      if (toState === 'local_ready') this.db.prepare(`UPDATE boot_attempt SET completed_at_utc=?,status='READY' WHERE boot_attempt_id=?`).run(occurredAtUtc, bootAttemptId);
      if (toState === 'failed') this.db.prepare(`UPDATE boot_attempt SET completed_at_utc=?,failed_phase=?,reason_code=?,status='FAILED' WHERE boot_attempt_id=?`).run(occurredAtUtc, fromState, reasonCode || 'APP_RUNTIME_FAILED', bootAttemptId);
      const event = this._insertEvent('runtime.state_changed', nextVersion, { fromState, toState, reasonCode: reasonCode || '', ownerInstanceId, fencingToken: Number(fencingToken) });
      return { stateVersion: nextVersion, lifecycleState: toState, event };
    });
  }

  updateRuntimeState({ leaseName, ownerInstanceId, fencingToken, patch = {}, eventType = 'runtime.state_updated', eventPayload = {} }) {
    return this.transaction(() => {
      this._assertFence(leaseName, ownerInstanceId, fencingToken);
      if (Object.prototype.hasOwnProperty.call(patch, 'operatingMode')) {
        throw new AppRuntimeError('OPERATING_MODE_GATEWAY_REQUIRED', 'Operating mode writes must use OperatingModeTransitionGateway', { status: 409 });
      }
      const row = this.db.prepare('SELECT * FROM runtime_state WHERE id=1').get();
      const nextVersion = Number(row.state_version) + 1;
      const next = {
        lifecycleState: patch.lifecycleState ?? row.lifecycle_state,
        localReady: patch.localReady == null ? Number(row.local_ready) : (patch.localReady ? 1 : 0),
        capabilities: patch.capabilities ?? parseJson(row.capabilities_json, {}),
        diagnostics: patch.diagnosticsSummary ?? parseJson(row.diagnostics_json, { failedPhase: null, reasonCode: null })
      };
      const at = this.clock();
      const result = this.db.prepare(`
        UPDATE runtime_state SET state_version=?,lifecycle_state=?,local_ready=?,capabilities_json=?,diagnostics_json=?,updated_at_utc=?
        WHERE id=1 AND owner_instance_id=? AND fencing_token=?
      `).run(nextVersion, next.lifecycleState, next.localReady, json(next.capabilities), json(next.diagnostics), at, ownerInstanceId, Number(fencingToken));
      if (Number(result.changes) !== 1) throw new AppRuntimeError('STALE_FENCING_TOKEN', 'runtime_state write rejected by fencing guard', { status: 409 });
      const event = this._insertEvent(eventType, nextVersion, eventPayload);
      return { stateVersion: nextVersion, event };
    });
  }

  enqueueOutbox({ eventId = crypto.randomUUID(), eventType, payload = {}, availableAtUtc = this.clock(), leaseName, ownerInstanceId, fencingToken }) {
    return this.transaction(() => {
      this._assertFence(leaseName, ownerInstanceId, fencingToken);
      const now = this.clock();
      this.db.prepare(`INSERT INTO outbox_event(event_id,event_type,payload_json,status,available_at_utc,created_at_utc,updated_at_utc) VALUES(?,?,?,'PENDING',?,?,?)`)
        .run(eventId, eventType, json(payload), availableAtUtc, now, now);
      return { eventId, status: 'PENDING' };
    });
  }

  claimOutbox({ leaseName, ownerInstanceId, fencingToken }) {
    return this.transaction(() => {
      this._assertFence(leaseName, ownerInstanceId, fencingToken);
      const now = this.clock();
      const row = this.db.prepare(`SELECT * FROM outbox_event WHERE status IN ('PENDING','RETRY') AND available_at_utc<=? ORDER BY created_at_utc,event_id LIMIT 1`).get(now);
      if (!row) return null;
      const result = this.db.prepare(`
        UPDATE outbox_event SET status='CLAIMED',claim_owner_instance_id=?,claim_fencing_token=?,claimed_at_utc=?,attempt_count=attempt_count+1,updated_at_utc=?
        WHERE event_id=? AND status IN ('PENDING','RETRY')
          AND EXISTS(SELECT 1 FROM runtime_lease WHERE lease_name=? AND owner_instance_id=? AND fencing_token=?)
      `).run(ownerInstanceId, Number(fencingToken), now, now, row.event_id, leaseName, ownerInstanceId, Number(fencingToken));
      if (Number(result.changes) !== 1) throw new AppRuntimeError('STALE_FENCING_TOKEN', 'Outbox claim rejected by fencing guard', { status: 409 });
      return { ...row, payload: parseJson(row.payload_json, {}), status: 'CLAIMED', claim_owner_instance_id: ownerInstanceId, claim_fencing_token: Number(fencingToken) };
    });
  }

  acknowledgeOutbox({ eventId, leaseName, ownerInstanceId, fencingToken }) {
    return this._finishOutbox({ eventId, leaseName, ownerInstanceId, fencingToken, status: 'ACKNOWLEDGED', error: '' });
  }

  retryOutbox({ eventId, leaseName, ownerInstanceId, fencingToken, error = '', availableAtUtc = this.clock() }) {
    return this._finishOutbox({ eventId, leaseName, ownerInstanceId, fencingToken, status: 'RETRY', error, availableAtUtc });
  }

  _finishOutbox({ eventId, leaseName, ownerInstanceId, fencingToken, status, error, availableAtUtc }) {
    return this.transaction(() => {
      this._assertFence(leaseName, ownerInstanceId, fencingToken);
      const now = this.clock();
      const result = this.db.prepare(`
        UPDATE outbox_event SET status=?,acknowledged_at_utc=?,available_at_utc=COALESCE(?,available_at_utc),last_error=?,updated_at_utc=?
        WHERE event_id=? AND status='CLAIMED' AND claim_owner_instance_id=? AND claim_fencing_token=?
          AND EXISTS(SELECT 1 FROM runtime_lease WHERE lease_name=? AND owner_instance_id=? AND fencing_token=?)
      `).run(status, status === 'ACKNOWLEDGED' ? now : '', availableAtUtc || null, error || '', now, eventId, ownerInstanceId, Number(fencingToken), leaseName, ownerInstanceId, Number(fencingToken));
      if (Number(result.changes) !== 1) throw new AppRuntimeError('STALE_FENCING_TOKEN', 'Outbox completion rejected by fencing guard', { status: 409 });
      return { eventId, status };
    });
  }

  executeCommand({ leaseName, ownerInstanceId, fencingToken, envelope, execute }) {
    const digest = envelopeHash(envelope);
    return this.transaction(() => {
      this._assertFence(leaseName, ownerInstanceId, fencingToken);
      const existing = this.db.prepare('SELECT * FROM command_idempotency WHERE command_id=?').get(envelope.commandId);
      if (existing) {
        if (existing.envelope_sha256 !== digest) throw new AppRuntimeError('COMMAND_ID_REUSE_MISMATCH', 'commandId was reused with a different envelope', { status: 409 });
        return { ...parseJson(existing.response_json, {}), duplicate: true };
      }
      const row = this.db.prepare('SELECT * FROM runtime_state WHERE id=1').get();
      if (Number(envelope.expectedStateVersion) !== Number(row.state_version)) {
        throw new AppRuntimeError('STATE_VERSION_CONFLICT', 'expectedStateVersion does not match current runtime state', {
          status: 409, details: { expectedStateVersion: Number(envelope.expectedStateVersion), actualStateVersion: Number(row.state_version) }
        });
      }
      const plan = execute({
        stateVersion: Number(row.state_version),
        lifecycleState: row.lifecycle_state,
        operatingMode: row.operating_mode,
        localReady: Boolean(row.local_ready),
        capabilities: parseJson(row.capabilities_json, {}),
        diagnosticsSummary: parseJson(row.diagnostics_json, {})
      });
      const nextVersion = Number(row.state_version) + 1;
      const patch = plan.patch || {};
      if (Object.prototype.hasOwnProperty.call(patch, 'operatingMode')) {
        throw new AppRuntimeError('OPERATING_MODE_GATEWAY_REQUIRED', 'Operating mode command side effects must use OperatingModeTransitionGateway', { status: 409 });
      }
      const at = this.clock();
      const result = this.db.prepare(`
        UPDATE runtime_state SET state_version=?,lifecycle_state=?,local_ready=?,capabilities_json=?,diagnostics_json=?,updated_at_utc=?
        WHERE id=1 AND owner_instance_id=? AND fencing_token=?
      `).run(nextVersion, patch.lifecycleState ?? row.lifecycle_state,
        patch.localReady == null ? Number(row.local_ready) : (patch.localReady ? 1 : 0),
        json(patch.capabilities ?? parseJson(row.capabilities_json, {})),
        json(patch.diagnosticsSummary ?? parseJson(row.diagnostics_json, {})),
        at, ownerInstanceId, Number(fencingToken));
      if (Number(result.changes) !== 1) throw new AppRuntimeError('STALE_FENCING_TOKEN', 'Command side effect rejected by fencing guard', { status: 409 });
      const event = this._insertEvent(plan.eventType || 'runtime.command_applied', nextVersion, plan.eventPayload || { commandType: envelope.commandType, commandId: envelope.commandId });
      const response = {
        contractVersion: 2,
        commandId: envelope.commandId,
        accepted: true,
        duplicate: false,
        stateVersion: nextVersion,
        resultingEventSequence: event.eventSequence,
        reasonCode: null,
        result: plan.result ?? null
      };
      this.db.prepare(`INSERT INTO command_idempotency(command_id,envelope_sha256,envelope_json,response_json,created_at_utc) VALUES(?,?,?,?,?)`)
        .run(envelope.commandId, digest, stable(envelope), json(response), at);
      return response;
    });
  }

  persistRuntimeControlCommand({ leaseName, ownerInstanceId, fencingToken, envelope }) {
    const supported = new Set(['runtime.setNetwork', 'runtime.suspend', 'runtime.resume']);
    if (!supported.has(String(envelope?.commandType || ''))) {
      throw new AppRuntimeError('COMMAND_TYPE_UNSUPPORTED', `Unsupported runtime control command: ${envelope?.commandType || ''}`, { status: 400 });
    }
    const digest = envelopeHash(envelope);
    return this.transaction(() => {
      this._assertFence(leaseName, ownerInstanceId, fencingToken);
      const existing = this.db.prepare('SELECT * FROM command_idempotency WHERE command_id=?').get(envelope.commandId);
      if (existing) {
        if (existing.envelope_sha256 !== digest) throw new AppRuntimeError('COMMAND_ID_REUSE_MISMATCH', 'commandId was reused with a different envelope', { status: 409 });
        const response = parseJson(existing.response_json, {});
        return {
          duplicate: true,
          terminal: ['PUBLISHED', 'TERMINAL'].includes(existing.status),
          status: existing.status,
          response: { ...response, duplicate: true, recovered: existing.status !== 'PUBLISHED' },
          committedRevision: Number(existing.committed_revision || 0),
          envelope: parseJson(existing.envelope_json, {})
        };
      }
      const pending = this.db.prepare(`
        SELECT command_id,command_type,status FROM command_idempotency
        WHERE command_type IN ('runtime.setNetwork','runtime.suspend','runtime.resume')
          AND status IN ('PERSISTED','APPLY_FAILED','RECOVERY_BLOCKED')
        ORDER BY created_at_utc,command_id LIMIT 1
      `).get();
      if (pending) {
        throw new AppRuntimeError('RUNTIME_CONTROL_RECOVERY_REQUIRED', 'A previous runtime control command must reach a proven terminal state before another command can start', {
          status: 423,
          details: { pendingCommandId: pending.command_id, pendingCommandType: pending.command_type, pendingStatus: pending.status }
        });
      }
      const row = this.db.prepare('SELECT * FROM runtime_state WHERE id=1').get();
      if (!row) throw new AppRuntimeError('RUNTIME_STATE_NOT_INITIALIZED', 'runtime_state has not been initialized', { status: 503 });
      if (Number(envelope.expectedStateVersion) !== Number(row.state_version)) {
        throw new AppRuntimeError('STATE_VERSION_CONFLICT', 'expectedStateVersion does not match current runtime state', {
          status: 409,
          details: { expectedStateVersion: Number(envelope.expectedStateVersion), actualStateVersion: Number(row.state_version) }
        });
      }
      const nextVersion = Number(row.state_version) + 1;
      const at = this.clock();
      const update = this.db.prepare(`
        UPDATE runtime_state SET state_version=?,owner_instance_id=?,fencing_token=?,updated_at_utc=?
        WHERE id=1 AND owner_instance_id=? AND fencing_token=?
      `).run(nextVersion, ownerInstanceId, Number(fencingToken), at, ownerInstanceId, Number(fencingToken));
      if (Number(update.changes) !== 1) throw new AppRuntimeError('STALE_FENCING_TOKEN', 'Runtime control command persistence rejected by fencing guard', { status: 409 });
      const event = this._insertEvent('runtime.command_persisted', nextVersion, {
        commandId: envelope.commandId,
        commandType: envelope.commandType
      });
      const response = {
        contractVersion: 2,
        commandId: envelope.commandId,
        accepted: true,
        duplicate: false,
        stateVersion: nextVersion,
        resultingEventSequence: event.eventSequence,
        reasonCode: null,
        result: { applicationStatus: 'PENDING', commandType: envelope.commandType }
      };
      this.db.prepare(`
        INSERT INTO command_idempotency(
          command_id,envelope_sha256,envelope_json,response_json,created_at_utc,
          command_type,status,committed_revision
        ) VALUES(?,?,?,?,?,?, 'PERSISTED', ?)
      `).run(envelope.commandId, digest, stable(envelope), json(response), at, envelope.commandType, nextVersion);
      return { duplicate: false, terminal: false, status: 'PERSISTED', response, committedRevision: nextVersion, envelope };
    });
  }

  completeRuntimeControlCommand({ leaseName, ownerInstanceId, fencingToken, commandId, patch = {}, eventType, eventPayload = {}, result = {}, recovered = false }) {
    return this.transaction(() => {
      this._assertFence(leaseName, ownerInstanceId, fencingToken);
      const ledger = this.db.prepare('SELECT * FROM command_idempotency WHERE command_id=?').get(commandId);
      if (!ledger || !['runtime.setNetwork', 'runtime.suspend', 'runtime.resume'].includes(ledger.command_type)) {
        throw new AppRuntimeError('RUNTIME_CONTROL_COMMAND_NOT_FOUND', 'Runtime control command ledger row is missing', { status: 503 });
      }
      if (['PUBLISHED', 'TERMINAL'].includes(ledger.status)) return { ...parseJson(ledger.response_json, {}), duplicate: true };
      if (!['PERSISTED', 'APPLY_FAILED'].includes(ledger.status)) {
        throw new AppRuntimeError('RUNTIME_CONTROL_COMMAND_STATE_INVALID', 'Runtime control command is not recoverable', {
          status: 503, details: { commandId, status: ledger.status }
        });
      }
      const row = this.db.prepare('SELECT * FROM runtime_state WHERE id=1').get();
      const nextVersion = Number(row.state_version) + 1;
      const at = this.clock();
      const update = this.db.prepare(`
        UPDATE runtime_state SET state_version=?,lifecycle_state=?,local_ready=?,capabilities_json=?,diagnostics_json=?,updated_at_utc=?
        WHERE id=1 AND owner_instance_id=? AND fencing_token=?
      `).run(
        nextVersion,
        patch.lifecycleState ?? row.lifecycle_state,
        patch.localReady == null ? Number(row.local_ready) : (patch.localReady ? 1 : 0),
        json(patch.capabilities ?? parseJson(row.capabilities_json, {})),
        json(patch.diagnosticsSummary ?? parseJson(row.diagnostics_json, {})),
        at, ownerInstanceId, Number(fencingToken)
      );
      if (Number(update.changes) !== 1) throw new AppRuntimeError('STALE_FENCING_TOKEN', 'Runtime control completion rejected by fencing guard', { status: 409 });
      const event = this._insertEvent(eventType || 'runtime.command_applied', nextVersion, {
        commandId,
        commandType: ledger.command_type,
        recovered: recovered === true,
        ...eventPayload
      });
      const response = {
        contractVersion: 2,
        commandId,
        accepted: true,
        duplicate: recovered === true,
        recovered: recovered === true,
        stateVersion: nextVersion,
        resultingEventSequence: event.eventSequence,
        reasonCode: null,
        result: { applicationStatus: 'APPLIED', publicationStatus: 'PUBLISHED', ...result }
      };
      this.db.prepare(`
        UPDATE command_idempotency
        SET status='PUBLISHED',applied_revision=?,published_at_utc=?,terminal_at_utc=?,response_json=?,last_error_code='',last_error_message=''
        WHERE command_id=?
      `).run(nextVersion, at, at, json(response), commandId);
      return response;
    });
  }

  markRuntimeControlCommandFailed({ leaseName, ownerInstanceId, fencingToken, commandId, cause }) {
    return this.transaction(() => {
      this._assertFence(leaseName, ownerInstanceId, fencingToken);
      const code = String(cause?.reasonCode || cause?.code || 'RUNTIME_CONTROL_APPLY_FAILED');
      const message = String(cause?.message || cause || '').slice(0, 1000);
      const changed = this.db.prepare(`
        UPDATE command_idempotency SET status='APPLY_FAILED',last_error_code=?,last_error_message=?
        WHERE command_id=? AND command_type IN ('runtime.setNetwork','runtime.suspend','runtime.resume')
      `).run(code, message, commandId);
      if (Number(changed.changes) !== 1) throw new AppRuntimeError('RUNTIME_CONTROL_COMMAND_NOT_FOUND', 'Runtime control command ledger row is missing', { status: 503 });
      return { commandId, status: 'APPLY_FAILED', code };
    });
  }

  listRecoverableRuntimeControlCommands() {
    const rows = this.db.prepare(`
      SELECT * FROM command_idempotency
      WHERE command_type IN ('runtime.setNetwork','runtime.suspend','runtime.resume')
        AND status IN ('PERSISTED','APPLY_FAILED')
      ORDER BY created_at_utc,command_id
    `).all();
    return rows.map(row => ({
      commandId: row.command_id,
      commandType: row.command_type,
      status: row.status,
      committedRevision: Number(row.committed_revision || 0),
      envelope: parseJson(row.envelope_json, {})
    }));
  }

  hasRuntimeState() {
    return Boolean(this.db.prepare('SELECT 1 AS present FROM runtime_state WHERE id=1').get());
  }

  getMigrationReceipt() {
    const row = this.db.prepare('SELECT * FROM runtime_migration_receipt ORDER BY completed_at_utc DESC,migration_id DESC LIMIT 1').get();
    if (!row) return null;
    return {
      migrationId: row.migration_id,
      migrationVersion: Number(row.migration_version),
      sourceCanonicalPath: row.source_canonical_path,
      sourceFingerprint: row.source_fingerprint,
      sourceFileCount: Number(row.source_file_count),
      sourceTotalBytes: Number(row.source_total_bytes),
      targetSchemaVersion: Number(row.target_schema_version),
      status: row.status,
      selectedOperatingMode: row.selected_operating_mode,
      candidates: parseJson(row.candidate_json, []),
      verification: parseJson(row.verification_json, {}),
      ownerInstanceId: row.owner_instance_id,
      fencingToken: Number(row.fencing_token),
      startedAtUtc: row.started_at_utc,
      completedAtUtc: row.completed_at_utc
    };
  }

  getOperatingModeAuthority() {
    const row = this.db.prepare('SELECT * FROM runtime_state WHERE id=1').get();
    if (!row) throw new AppRuntimeError('RUNTIME_STATE_NOT_INITIALIZED', 'runtime_state has not been initialized', { status: 503 });
    const operatingMode = assertOperatingMode(row.operating_mode, { source: 'getOperatingModeAuthority' });
    const operatingModeRevision = Number(row.operating_mode_revision);
    if (!Number.isInteger(operatingModeRevision) || operatingModeRevision < 1 || operatingModeRevision > Number(row.state_version)) {
      throw new AppRuntimeError('OPERATING_MODE_REVISION_INVALID', 'Operating mode authority revision is invalid', {
        status: 503,
        details: { operatingModeRevision, stateVersion: Number(row.state_version) }
      });
    }
    const event = this.db.prepare(`
      SELECT * FROM runtime_event
      WHERE event_type IN ('runtime.authority_initialized','runtime.operating_mode_persisted')
        AND state_version=?
      ORDER BY event_sequence DESC LIMIT 1
    `).get(operatingModeRevision);
    if (event) {
      const payload = parseJson(event.payload_json, {});
      const eventMode = event.event_type === 'runtime.authority_initialized' ? payload.operatingMode : payload.to;
      if (assertOperatingMode(eventMode, { source: 'getOperatingModeAuthority.event' }) !== operatingMode) {
        throw new AppRuntimeError('OPERATING_MODE_AUTHORITY_EVENT_MISMATCH', 'Operating mode authority does not match its durable authority event', {
          status: 503,
          details: { operatingMode, eventMode, operatingModeRevision, stateVersion: Number(row.state_version), eventType: event.event_type }
        });
      }
    }
    const metadata = parseJson(row.operating_mode_metadata_json, {}) || {};
    if (operatingMode === OPERATING_MODES.SAFE_MODE) {
      const complete = clean(metadata.reasonCode)
        && unique(metadata.reasons).length > 0
        && clean(metadata.trigger)
        && dateLike(metadata.enteredAt)
        && clean(metadata.updatedBy)
        && /^[a-f0-9]{64}$/u.test(clean(metadata.evidenceSha256));
      if (!complete) {
        throw new AppRuntimeError('SAFE_MODE_METADATA_INCOMPLETE', 'Safe mode authority metadata is incomplete', {
          status: 503,
          details: { operatingModeRevision, reasonCode: clean(metadata.reasonCode), trigger: clean(metadata.trigger), enteredAt: clean(metadata.enteredAt), updatedBy: clean(metadata.updatedBy), evidenceSha256: clean(metadata.evidenceSha256) }
        });
      }
    }
    return {
      operatingMode,
      operatingModeRevision,
      stateVersion: Number(row.state_version),
      eventSequence: Number(event?.event_sequence || 0),
      eventType: event?.event_type || 'runtime.authority_revision',
      reasonCode: clean(metadata.reasonCode),
      reason: clean(metadata.reasonCode),
      reasons: unique(metadata.reasons),
      trigger: clean(metadata.trigger),
      enteredAt: clean(metadata.enteredAt),
      updatedAtUtc: clean(metadata.updatedAt || row.updated_at_utc),
      updatedBy: clean(metadata.updatedBy || 'runtime-authority'),
      evidenceSha256: clean(metadata.evidenceSha256)
    };
  }

  initializeRuntimeAuthority({ leaseName, ownerInstanceId, fencingToken, operatingMode, migration }) {
    return this.transaction(() => {
      this._assertFence(leaseName, ownerInstanceId, fencingToken);
      if (this.db.prepare('SELECT 1 AS present FROM runtime_state WHERE id=1').get()) {
        throw new AppRuntimeError('RUNTIME_STATE_ALREADY_INITIALIZED', 'runtime_state already exists', { status: 409 });
      }
      const mode = assertOperatingMode(operatingMode, { source: 'initializeRuntimeAuthority' });
      const receipt = migration || {};
      const now = this.clock();
      const stateVersion = 1;
      const modeMetadata = buildOperatingModeMetadata(mode, {
        reasonCode: mode === OPERATING_MODES.SAFE_MODE ? 'INITIAL_SAFE_MODE' : '',
        trigger: 'runtime-authority-initialization',
        actor: 'runtime-authority-migration',
        evidence: { migrationId: receipt.migrationId || '', sourceFingerprint: receipt.sourceFingerprint || '' }
      }, now);
      this.db.prepare(`
        INSERT INTO runtime_state(id,state_version,operating_mode_revision,lifecycle_state,operating_mode,operating_mode_metadata_json,local_ready,owner_instance_id,fencing_token,capabilities_json,diagnostics_json,updated_at_utc)
        VALUES(1,?,?,'created',?,?,0,?,?,?, ?,?)
      `).run(stateVersion, stateVersion, mode, json(modeMetadata), ownerInstanceId, Number(fencingToken), json({}), json({ failedPhase: null, reasonCode: null }), now);
      this.db.prepare(`
        INSERT INTO runtime_migration_receipt(
          migration_id,migration_version,source_canonical_path,source_fingerprint,source_file_count,source_total_bytes,
          target_schema_version,status,selected_operating_mode,candidate_json,verification_json,owner_instance_id,fencing_token,started_at_utc,completed_at_utc
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        String(receipt.migrationId || crypto.randomUUID()), Number(receipt.migrationVersion || 1), String(receipt.sourceCanonicalPath || ''),
        String(receipt.sourceFingerprint || ''), Number(receipt.sourceFileCount || 0), Number(receipt.sourceTotalBytes || 0),
        Number(receipt.targetSchemaVersion || 1), String(receipt.status || 'COMMITTED'), mode,
        json(receipt.candidates || []), json(receipt.verification || {}), ownerInstanceId, Number(fencingToken),
        String(receipt.startedAtUtc || now), String(receipt.completedAtUtc || now)
      );
      const event = this._insertEvent('runtime.authority_initialized', stateVersion, { operatingMode: mode, migrationId: receipt.migrationId || '', sourceFingerprint: receipt.sourceFingerprint || '' });
      return { stateVersion, operatingMode: mode, event, receipt: this.getMigrationReceipt() };
    });
  }


  validateRuntimeAuthority() {
    const authority = this.getOperatingModeAuthority();
    const receiptRows = this.db.prepare('SELECT * FROM runtime_migration_receipt ORDER BY completed_at_utc DESC,migration_id DESC').all();
    if (receiptRows.length !== 1) {
      throw new AppRuntimeError('RUNTIME_MIGRATION_RECEIPT_INVALID', 'Exactly one runtime migration receipt is required', { status: 503, details: { receiptCount: receiptRows.length } });
    }
    const receipt = receiptRows[0];
    const initialOperatingMode = assertOperatingMode(receipt.selected_operating_mode, { source: 'validateRuntimeAuthority.receipt' });
    const verification = parseJson(receipt.verification_json, null);
    const candidates = parseJson(receipt.candidate_json, null);
    const sourceExists = verification?.sourceExists;
    const before = Array.isArray(verification?.before) ? verification.before : null;
    const after = Array.isArray(verification?.after) ? verification.after : null;
    const sourcePath = String(receipt.source_canonical_path || '');
    const sourceFingerprint = String(receipt.source_fingerprint || '');
    const sourceFileCount = Number(receipt.source_file_count);
    const sourceTotalBytes = Number(receipt.source_total_bytes);
    let candidateModesValid = Array.isArray(candidates);
    if (candidateModesValid) {
      try { candidateModesValid = candidates.every(row => assertOperatingMode(row?.operatingMode, { source: 'validateRuntimeAuthority.candidate' }) === initialOperatingMode); }
      catch (_) { candidateModesValid = false; }
    }
    const fingerprintMatches = sourceExists === true && before
      ? sourceFingerprint === crypto.createHash('sha256').update(stable({ root: path.resolve(sourcePath), files: before })).digest('hex')
      : sourceExists === false && Boolean(sourceFingerprint);
    const sourceMetadataMatches = sourceExists === true
      ? Boolean(sourcePath) && sourceFileCount === before?.length && sourceTotalBytes === (before || []).reduce((sum, row) => sum + Number(row?.size || 0), 0)
      : sourceExists === false && sourcePath === '' && sourceFileCount === 0 && sourceTotalBytes === 0 && before?.length === 0;
    const verificationComplete = Boolean(
      verification && verification.sourceReadOnly === true && Number(verification.sourceMutationCount) === 0 &&
      before && after && stable(before) === stable(after) && typeof sourceExists === 'boolean' &&
      fingerprintMatches && sourceMetadataMatches && candidateModesValid &&
      Number(receipt.migration_version) >= 1 && Number(receipt.target_schema_version) >= 1
    );
    if (receipt.status !== 'COMMITTED' || !sourceFingerprint || !verificationComplete) {
      throw new AppRuntimeError('RUNTIME_MIGRATION_RECEIPT_MISMATCH', 'Runtime authority and migration receipt are inconsistent', {
        status: 503,
        details: {
          receiptStatus: receipt.status,
          initialOperatingMode,
          operatingMode: authority.operatingMode,
          sourceFingerprintPresent: Boolean(receipt.source_fingerprint),
          fingerprintMatches,
          sourceMetadataMatches,
          candidateModesValid,
          verificationComplete
        }
      });
    }
    return { ...authority, receipt: this.getMigrationReceipt() };
  }

  persistOperatingModeCommand({ leaseName, ownerInstanceId, fencingToken, envelope, targetMode, reason = '', source = '', metadata = {} }) {
    const digest = envelopeHash(envelope);
    return this.transaction(() => {
      this._assertFence(leaseName, ownerInstanceId, fencingToken);
      const existing = this.db.prepare('SELECT * FROM command_idempotency WHERE command_id=?').get(envelope.commandId);
      if (existing) {
        if (existing.envelope_sha256 !== digest) throw new AppRuntimeError('COMMAND_ID_REUSE_MISMATCH', 'commandId was reused with a different envelope', { status: 409 });
        const response = parseJson(existing.response_json, {});
        const terminal = ['PUBLISHED', 'TERMINAL'].includes(existing.status);
        return { duplicate: true, terminal, response: { ...response, duplicate: true }, status: existing.status, stateVersion: Number(existing.committed_revision || response.stateVersion || 0), previousMode: '', targetMode: existing.target_mode };
      }
      const pending = this.db.prepare(`SELECT command_id,status FROM command_idempotency WHERE command_type='runtime.setOperatingMode' AND status IN ('PERSISTED','APPLY_FAILED','APPLIED','PUBLISH_FAILED','RECOVERY_BLOCKED') ORDER BY created_at_utc LIMIT 1`).get();
      if (pending) {
        throw new AppRuntimeError('OPERATING_MODE_RECOVERY_REQUIRED', 'A previous operating mode command must reach a proven terminal state before another command can start', {
          status: 423,
          details: { pendingCommandId: pending.command_id, pendingStatus: pending.status }
        });
      }
      const row = this.db.prepare('SELECT * FROM runtime_state WHERE id=1').get();
      if (!row) throw new AppRuntimeError('RUNTIME_STATE_NOT_INITIALIZED', 'runtime_state has not been initialized', { status: 503 });
      if (Number(envelope.expectedStateVersion) !== Number(row.state_version)) {
        throw new AppRuntimeError('STATE_VERSION_CONFLICT', 'expectedStateVersion does not match current runtime state', { status: 409, details: { expectedStateVersion: Number(envelope.expectedStateVersion), actualStateVersion: Number(row.state_version) } });
      }
      const mode = assertOperatingMode(targetMode, { source: 'persistOperatingModeCommand' });
      const previousMode = assertOperatingMode(row.operating_mode, { source: 'persistOperatingModeCommand.current' });
      const nextVersion = Number(row.state_version) + 1;
      const at = this.clock();
      const commandMetadata = {
        ...metadata,
        ...(envelope.payload?.metadata && typeof envelope.payload.metadata === 'object' ? envelope.payload.metadata : {})
      };
      const evidence = commandMetadata.evidence && typeof commandMetadata.evidence === 'object'
        ? commandMetadata.evidence
        : { commandId: envelope.commandId, expectedStateVersion: Number(envelope.expectedStateVersion), targetMode: mode, reason, source };
      const modeMetadata = buildOperatingModeMetadata(mode, {
        ...commandMetadata,
        reason,
        source,
        evidence
      }, at);
      const update = this.db.prepare(`
        UPDATE runtime_state SET state_version=?,operating_mode_revision=?,operating_mode=?,operating_mode_metadata_json=?,owner_instance_id=?,fencing_token=?,updated_at_utc=?
        WHERE id=1 AND owner_instance_id=? AND fencing_token=?
      `).run(nextVersion, nextVersion, mode, json(modeMetadata), ownerInstanceId, Number(fencingToken), at, ownerInstanceId, Number(fencingToken));
      if (Number(update.changes) !== 1) throw new AppRuntimeError('STALE_FENCING_TOKEN', 'Operating mode write rejected by fencing guard', { status: 409 });
      const event = this._insertEvent('runtime.operating_mode_persisted', nextVersion, { commandId: envelope.commandId, from: previousMode, to: mode, reason, source, metadata: modeMetadata });
      const response = { contractVersion: 2, commandId: envelope.commandId, accepted: true, duplicate: false, stateVersion: nextVersion, resultingEventSequence: event.eventSequence, reasonCode: null, result: { operatingMode: mode, applicationStatus: 'PENDING' } };
      this.db.prepare(`
        INSERT INTO command_idempotency(command_id,envelope_sha256,envelope_json,response_json,created_at_utc,command_type,status,target_mode,committed_revision)
        VALUES(?,?,?,?,?,'runtime.setOperatingMode','PERSISTED',?,?)
      `).run(envelope.commandId, digest, stable(envelope), json(response), at, mode, nextVersion);
      return { duplicate: false, terminal: false, response, status: 'PERSISTED', stateVersion: nextVersion, previousMode, targetMode: mode };
    });
  }

  markOperatingModeApplied({ leaseName, ownerInstanceId, fencingToken, commandId, appliedRevision, recovered = false }) {
    return this.transaction(() => {
      this._assertFence(leaseName, ownerInstanceId, fencingToken);
      const row = this.db.prepare('SELECT * FROM command_idempotency WHERE command_id=?').get(commandId);
      if (!row || row.command_type !== 'runtime.setOperatingMode') throw new AppRuntimeError('OPERATING_MODE_COMMAND_NOT_FOUND', 'Operating mode command ledger row is missing', { status: 503 });
      if (Number(row.committed_revision) !== Number(appliedRevision)) throw new AppRuntimeError('OPERATING_MODE_APPLIED_REVISION_MISMATCH', 'Applied revision does not match committed revision', { status: 503 });
      this.db.prepare(`UPDATE command_idempotency SET status='APPLIED',applied_revision=?,last_error_code='',last_error_message='' WHERE command_id=?`).run(Number(appliedRevision), commandId);
      this._insertEvent('runtime.operating_mode_applied', Number(appliedRevision), { commandId, targetMode: row.target_mode, recovered: recovered === true });
      return true;
    });
  }

  markOperatingModePublished({ leaseName, ownerInstanceId, fencingToken, commandId, publishedAtUtc, recovered = false }) {
    return this.transaction(() => {
      this._assertFence(leaseName, ownerInstanceId, fencingToken);
      const row = this.db.prepare('SELECT * FROM command_idempotency WHERE command_id=?').get(commandId);
      if (!row || row.command_type !== 'runtime.setOperatingMode' || Number(row.applied_revision) !== Number(row.committed_revision)) {
        throw new AppRuntimeError('OPERATING_MODE_PUBLICATION_PRECONDITION_FAILED', 'Operating mode publication requires a matching applied revision', { status: 503 });
      }
      const at = String(publishedAtUtc || this.clock());
      const response = { ...parseJson(row.response_json, {}), duplicate: recovered === true, recovered: recovered === true, stateVersion: Number(row.committed_revision), result: { operatingMode: row.target_mode, applicationStatus: 'APPLIED', publicationStatus: 'PUBLISHED' } };
      this.db.prepare(`UPDATE command_idempotency SET status='PUBLISHED',published_at_utc=?,terminal_at_utc=?,response_json=?,last_error_code='',last_error_message='' WHERE command_id=?`)
        .run(at, at, json(response), commandId);
      this._insertEvent('runtime.operating_mode_published', Number(row.committed_revision), { commandId, targetMode: row.target_mode, recovered: recovered === true });
      return response;
    });
  }

  markOperatingModeCommandFailed({ leaseName, ownerInstanceId, fencingToken, commandId, phase, cause }) {
    return this.transaction(() => {
      this._assertFence(leaseName, ownerInstanceId, fencingToken);
      const status = phase === 'PUBLISH' ? 'PUBLISH_FAILED' : 'APPLY_FAILED';
      const code = String(cause?.reasonCode || cause?.code || `OPERATING_MODE_${phase}_FAILED`);
      const message = String(cause?.message || cause || '').slice(0, 1000);
      this.db.prepare('UPDATE command_idempotency SET status=?,last_error_code=?,last_error_message=? WHERE command_id=?').run(status, code, message, commandId);
      return { commandId, status, code };
    });
  }

  markOperatingModeRecoveryBlocked({ leaseName, ownerInstanceId, fencingToken, commandId, reasonCode }) {
    return this.transaction(() => {
      this._assertFence(leaseName, ownerInstanceId, fencingToken);
      this.db.prepare("UPDATE command_idempotency SET status='RECOVERY_BLOCKED',last_error_code=? WHERE command_id=?").run(String(reasonCode || 'OPERATING_MODE_RECOVERY_BLOCKED'), commandId);
      return true;
    });
  }

  listRecoverableOperatingModeCommands() {
    const rows = this.db.prepare(`SELECT * FROM command_idempotency WHERE command_type='runtime.setOperatingMode' AND status IN ('PERSISTED','APPLY_FAILED','APPLIED','PUBLISH_FAILED') ORDER BY created_at_utc,command_id`).all();
    return rows.map(row => ({ commandId: row.command_id, status: row.status, targetMode: row.target_mode, committedRevision: Number(row.committed_revision), appliedRevision: Number(row.applied_revision), envelope: parseJson(row.envelope_json, {}) }));
  }

  getCredentialHydrationState() {
    const row = this.db.prepare('SELECT * FROM credential_hydration_state WHERE id=1').get();
    return {
      vaultEpoch: row?.vault_epoch || '',
      generation: Number(row?.generation || 0),
      hydrated: Boolean(row?.hydrated),
      hydratedAtUtc: row?.hydrated_at_utc || '',
      ownerInstanceId: row?.owner_instance_id || '',
      fencingToken: Number(row?.fencing_token || 0),
      authorityEventId: row?.authority_event_id || '',
      authorityHeadDigest: row?.authority_head_digest || '',
      referenceCount: Number(row?.reference_count || 0),
      payloadBytes: Number(row?.payload_bytes || 0)
    };
  }

  acceptCredentialHydration({ leaseName, ownerInstanceId, fencingToken, vaultEpoch, generation, authorityEventId, authorityHeadDigest, referenceCount, payloadBytes, resetAuthorization = null }) {
    return this.transaction(() => {
      this._assertFence(leaseName, ownerInstanceId, fencingToken);
      const nextEpoch = String(vaultEpoch || '');
      const nextGeneration = Number(generation);
      if (!nextEpoch || !Number.isInteger(nextGeneration) || nextGeneration < 1) {
        throw new AppRuntimeError('CREDENTIAL_HYDRATION_STATE_INVALID', 'Credential epoch and generation are invalid', { status: 400, failedPhase: 'credential_hydration' });
      }
      if (!String(authorityEventId || '') || !/^[0-9a-f]{64}$/.test(String(authorityHeadDigest || '')) || !Number.isInteger(Number(referenceCount)) || Number(referenceCount) < 0 || !Number.isInteger(Number(payloadBytes)) || Number(payloadBytes) < 0) {
        throw new AppRuntimeError('CREDENTIAL_HYDRATION_STATE_INVALID', 'Credential authority event and reference metadata are invalid', { status: 400, failedPhase: 'credential_hydration' });
      }
      const row = this.db.prepare('SELECT * FROM credential_hydration_state WHERE id=1').get();
      const currentEpoch = row?.vault_epoch || '';
      const currentGeneration = Number(row?.generation || 0);
      if (currentEpoch && currentEpoch === nextEpoch && nextGeneration <= currentGeneration) {
        throw new AppRuntimeError('CREDENTIAL_GENERATION_ROLLBACK_DENIED', 'Credential generation rollback or replay was denied', { status: 409, failedPhase: 'credential_hydration' });
      }
      if (currentEpoch && currentEpoch !== nextEpoch) {
        const authorized = resetAuthorization && resetAuthorization.previousVaultEpoch === currentEpoch && resetAuthorization.nextVaultEpoch === nextEpoch && resetAuthorization.authorizedAtUtc;
        if (!authorized) {
          throw new AppRuntimeError('CREDENTIAL_ILLEGAL_VAULT_EPOCH_CHANGE_DENIED', 'Credential vault epoch change requires the legal reset protocol', { status: 409, failedPhase: 'credential_hydration' });
        }
      }
      const at = this.clock();
      const result = this.db.prepare(`
        UPDATE credential_hydration_state
        SET vault_epoch=?,generation=?,hydrated=1,hydrated_at_utc=?,owner_instance_id=?,fencing_token=?,
            authority_event_id=?,authority_head_digest=?,reference_count=?,payload_bytes=?
        WHERE id=1
          AND EXISTS(SELECT 1 FROM runtime_lease WHERE lease_name=? AND owner_instance_id=? AND fencing_token=?)
      `).run(nextEpoch, nextGeneration, at, ownerInstanceId, Number(fencingToken), String(authorityEventId), String(authorityHeadDigest), Number(referenceCount), Number(payloadBytes), leaseName, ownerInstanceId, Number(fencingToken));
      if (Number(result.changes) !== 1) throw new AppRuntimeError('STALE_FENCING_TOKEN', 'Credential hydration write rejected by fencing guard', { status: 409 });
      return { vaultEpoch: nextEpoch, generation: nextGeneration, hydrated: true, hydratedAtUtc: at, authorityEventId: String(authorityEventId), authorityHeadDigest: String(authorityHeadDigest), referenceCount: Number(referenceCount), payloadBytes: Number(payloadBytes) };
    });
  }

  advanceCredentialGeneration({ leaseName, ownerInstanceId, fencingToken, vaultEpoch, previousGeneration, generation, authorityEventId, authorityHeadDigest, entryCount, payloadBytes }) {
    return this.transaction(() => {
      this._assertFence(leaseName, ownerInstanceId, fencingToken);
      const row = this.db.prepare('SELECT * FROM credential_hydration_state WHERE id=1').get();
      if (!row || row.vault_epoch !== String(vaultEpoch || '') || Number(row.generation) !== Number(previousGeneration) || Number(generation) !== Number(previousGeneration) + 1 ||
          !String(authorityEventId || '') || !/^[0-9a-f]{64}$/.test(String(authorityHeadDigest || '')) || !Number.isInteger(Number(entryCount)) || Number(entryCount) < 0) {
        throw new AppRuntimeError('CREDENTIAL_GENERATION_MISMATCH', 'Credential custody generation does not match runtime authority', { status: 409 });
      }
      const at = this.clock();
      const result = this.db.prepare(`
        UPDATE credential_hydration_state
        SET generation=?,hydrated=1,hydrated_at_utc=?,owner_instance_id=?,fencing_token=?,
            authority_event_id=?,authority_head_digest=?,reference_count=?,payload_bytes=?
        WHERE id=1 AND vault_epoch=? AND generation=?
          AND EXISTS(SELECT 1 FROM runtime_lease WHERE lease_name=? AND owner_instance_id=? AND fencing_token=?)
      `).run(Number(generation), at, ownerInstanceId, Number(fencingToken), String(authorityEventId), String(authorityHeadDigest), Number(entryCount), Number(payloadBytes || 0), String(vaultEpoch), Number(previousGeneration), leaseName, ownerInstanceId, Number(fencingToken));
      if (Number(result.changes) !== 1) throw new AppRuntimeError('CREDENTIAL_GENERATION_MISMATCH', 'Credential custody metadata update was rejected', { status: 409 });
      return { vaultEpoch: String(vaultEpoch), generation: Number(generation), hydrated: true, hydratedAtUtc: at, authorityEventId: String(authorityEventId), authorityHeadDigest: String(authorityHeadDigest), referenceCount: Number(entryCount), payloadBytes: Number(payloadBytes || 0) };
    });
  }

  snapshot() {
    const row = this.db.prepare('SELECT * FROM runtime_state WHERE id=1').get();
    if (!row) throw new AppRuntimeError('RUNTIME_STATE_NOT_INITIALIZED', 'runtime_state has not been initialized', { status: 503 });
    const last = this.db.prepare('SELECT COALESCE(MAX(event_sequence),0) AS value FROM runtime_event').get();
    return {
      stateVersion: Number(row.state_version),
      lastEventSequence: Number(last.value || 0),
      runtime: {
        lifecycleState: row.lifecycle_state,
        operatingMode: row.operating_mode,
        operatingModeRevision: this.getOperatingModeAuthority().operatingModeRevision,
        ownerInstanceId: row.owner_instance_id,
        fencingToken: Number(row.fencing_token),
        localReady: Boolean(row.local_ready),
        updatedAtUtc: row.updated_at_utc
      },
      capabilities: parseJson(row.capabilities_json, {}),
      diagnosticsSummary: parseJson(row.diagnostics_json, { failedPhase: null, reasonCode: null })
    };
  }

  injectWp7ProbeEventGap(afterSequence = 0) {
    const after = Number(afterSequence || 0);
    if (!Number.isInteger(after) || after < 0) {
      throw new AppRuntimeError('EVENT_QUERY_INVALID', 'WP7 event-gap baseline must be a non-negative integer', { status: 400 });
    }
    return this.transaction(() => {
      const state = this.db.prepare('SELECT state_version FROM runtime_state WHERE id=1').get();
      if (!state) throw new AppRuntimeError('RUNTIME_STATE_NOT_INITIALIZED', 'runtime_state has not been initialized', { status: 503 });
      const first = this._insertEvent('wp7.probe_gap_discarded', Number(state.state_version), { afterSequence: after });
      const second = this._insertEvent('wp7.probe_gap_visible', Number(state.state_version), { afterSequence: after, discardedSequence: first.eventSequence });
      this.db.prepare('DELETE FROM runtime_event WHERE event_sequence<=?').run(first.eventSequence);
      const bounds = this.db.prepare('SELECT COALESCE(MIN(event_sequence),0) AS oldest,COALESCE(MAX(event_sequence),0) AS latest FROM runtime_event').get();
      return {
        injectedThroughProductionEventStore: true,
        discardedSequence: first.eventSequence,
        visibleSequence: second.eventSequence,
        oldestAvailableSequence: Number(bounds.oldest || 0),
        lastAvailableSequence: Number(bounds.latest || 0)
      };
    });
  }

  listEvents(afterSequence = 0, limit = 100) {
    const rawAfter = Number(afterSequence == null || afterSequence === '' ? 0 : afterSequence);
    const rawLimit = Number(limit == null || limit === '' ? 100 : limit);
    if (!Number.isInteger(rawAfter) || rawAfter < 0 || !Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 500) {
      throw new AppRuntimeError('EVENT_QUERY_INVALID', 'afterSequence must be >= 0 and limit must be between 1 and 500', { status: 400 });
    }
    const after = rawAfter;
    const capped = rawLimit;
    const bounds = this.db.prepare('SELECT COALESCE(MIN(event_sequence),0) AS oldest,COALESCE(MAX(event_sequence),0) AS latest FROM runtime_event').get();
    if (after > 0 && Number(bounds.oldest) > after + 1) {
      throw new AppRuntimeError('EVENT_SEQUENCE_GAP', 'Requested event baseline is no longer available; refetch snapshot', {
        status: 409, details: { afterSequence: after, oldestAvailableSequence: Number(bounds.oldest), lastAvailableSequence: Number(bounds.latest) }
      });
    }
    const rows = this.db.prepare(`SELECT * FROM runtime_event WHERE event_sequence>? ORDER BY event_sequence LIMIT ?`).all(after, capped);
    return {
      fromSequenceExclusive: after,
      lastAvailableSequence: Number(bounds.latest),
      events: rows.map(row => ({
        eventSequence: Number(row.event_sequence), eventId: row.event_id, eventType: row.event_type,
        stateVersion: Number(row.state_version), occurredAtUtc: row.occurred_at_utc, payload: parseJson(row.payload_json, {})
      }))
    };
  }

  markBootFailed(bootAttemptId, failedPhase, reasonCode) {
    const at = this.clock();
    this.db.prepare(`UPDATE boot_attempt SET completed_at_utc=?,failed_phase=?,reason_code=?,status='FAILED' WHERE boot_attempt_id=?`)
      .run(at, failedPhase || '', reasonCode || 'APP_RUNTIME_BOOT_FAILED', bootAttemptId);
  }

  releaseLease({ leaseName, ownerInstanceId, fencingToken }) {
    return this.transaction(() => {
      this._assertFence(leaseName, ownerInstanceId, fencingToken);
      const now = this.clock();
      this.db.prepare(`UPDATE runtime_lease SET owner_instance_id='',owner_pid=0,heartbeat_at_utc=?,lease_expires_at_utc=? WHERE lease_name=? AND owner_instance_id=? AND fencing_token=?`)
        .run(now, now, leaseName, ownerInstanceId, Number(fencingToken));
      return true;
    });
  }

  close() { if (!this.ownsDb) return; try { this.db.close(); } catch (_) {} }
}

module.exports = { RuntimeStateStore, envelopeHash, stable, buildOperatingModeMetadata };
