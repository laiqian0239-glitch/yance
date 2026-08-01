'use strict';

const crypto = require('node:crypto');
const { getStore } = require('../repositories/storeProvider');
const { ensureObjects } = require('../migrations/batch42Fix6OScopedSafetyAndOmnichannelRuntime');

const AUTHORITY = 'ScopedSafetyAuthority';
const SCHEMA_VERSION = 1;
const GLOBAL_REASON_CODES = new Set([
  'SQLITE_QUICK_CHECK_FAILED',
  'SQLITE_OWNERSHIP_CONFLICT',
  'DATABASE_INTEGRITY_FAILED',
  'DATABASE_MIGRATION_FAILED',
  'OPERATING_MODE_LEDGER_AUTHORITY_MISMATCH',
  'BACKGROUND_JOB_COUNT_MISMATCH',
  'CREDENTIAL_VAULT_UNAVAILABLE',
  'CREDENTIAL_STORE_CORRUPTED',
  'ARTIFACT_INTEGRITY_FAILED',
  'RELEASE_MANIFEST_INTEGRITY_FAILED',
  'RESTORE_STAGED',
  'BOOT_FAILURE_LOOP'
]);

function clean(value) { return String(value == null ? '' : value).trim(); }
function nowIso() { return new Date().toISOString(); }
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function json(value) { return JSON.stringify(value == null ? {} : value); }
function parse(value, fallback = {}) { try { return value ? JSON.parse(value) : fallback; } catch (_) { return fallback; } }
function unique(values) { return [...new Set((values || []).map(clean).filter(Boolean))]; }
function hash(value) { return crypto.createHash('sha256').update(String(value || '')).digest('hex'); }

function isGlobalReason(code) { return GLOBAL_REASON_CODES.has(clean(code)); }
function normalizeScopeType(trigger = {}) {
  const code = clean(trigger.code);
  if (isGlobalReason(code)) return 'system';
  const explicit = clean(trigger.scopeType).toLowerCase();
  if (['system','platform','account','capability'].includes(explicit)) return explicit === 'system' ? 'capability' : explicit;
  if (clean(trigger.accountId)) return 'account';
  if (clean(trigger.platform)) return 'platform';
  if (clean(trigger.capability) || clean(trigger.scope)) return 'capability';
  if (clean(trigger.domain) === 'ai' || /^MODEL_|^AI_/.test(code)) return 'capability';
  if (code === 'SEND_OUTCOME_UNKNOWN' || code === 'SEND_QUEUE_STATUS_UNAVAILABLE') return 'capability';
  if (/^PLATFORM_/.test(code)) return 'platform';
  if (/^BACKGROUND_JOB_/.test(code)) return 'capability';
  return 'capability';
}
function normalizedCapability(trigger = {}) {
  const code = clean(trigger.code);
  if (clean(trigger.capability)) return clean(trigger.capability).toLowerCase();
  if (clean(trigger.scope) === 'ai-automation' || clean(trigger.domain) === 'ai' || /^MODEL_|^AI_/.test(code)) return 'ai-automation';
  if (code === 'SEND_OUTCOME_UNKNOWN' || code === 'SEND_QUEUE_STATUS_UNAVAILABLE') return 'send';
  if (/^BACKGROUND_JOB_/.test(code)) return 'background-jobs';
  if (/AUTH|REAUTH|CREDENTIAL|SESSION/.test(code)) return 'authenticate';
  return clean(trigger.scope || 'runtime').toLowerCase();
}
function accountState(trigger = {}) {
  const code = clean(trigger.code).toUpperCase();
  if (/REAUTH|AUTH_REQUIRED|CREDENTIAL|SESSION_EXPIRED|LOGGED_OUT/.test(code)) return 'reauth-required';
  return 'quarantined';
}
function blockedCapabilities(trigger = {}) {
  const scopeType = normalizeScopeType(trigger);
  const capability = normalizedCapability(trigger);
  if (scopeType === 'account' && accountState(trigger) === 'reauth-required') return ['authenticate','sync','send'];
  if (scopeType === 'account') return unique([capability || 'sync','send']);
  if (scopeType === 'platform') return unique([capability || 'sync']);
  if (scopeType === 'capability') return unique([capability]);
  return ['all'];
}
function normalizeTrigger(trigger = {}) {
  const code = clean(trigger.code || 'SCOPED_SAFETY_TRIGGER');
  const scopeType = normalizeScopeType({ ...trigger, code });
  const platform = clean(trigger.platform).toLowerCase();
  const accountId = clean(trigger.accountId);
  const capability = normalizedCapability({ ...trigger, code });
  const scopeId = scopeType === 'system' ? 'system'
    : scopeType === 'account' ? accountId
      : scopeType === 'platform' ? platform
        : capability;
  const state = scopeType === 'system' ? 'safe-mode'
    : scopeType === 'account' ? accountState({ ...trigger, code })
      : scopeType === 'platform' ? 'degraded'
        : 'paused';
  return {
    ...clone(trigger),
    code,
    severity: clean(trigger.severity || 'high').toLowerCase(),
    scopeType,
    scopeId,
    platform,
    accountId,
    capability,
    state,
    globalEscalation: scopeType === 'system' && isGlobalReason(code),
    blockedCapabilities: blockedCapabilities({ ...trigger, code, scopeType, capability }),
    detail: clean(trigger.detail),
    evidence: clone(trigger.evidence || null)
  };
}
function fingerprint(trigger) {
  return hash([trigger.scopeType, trigger.scopeId, trigger.platform, trigger.accountId, trigger.capability, trigger.code].join('\u001f'));
}
function issueRow(row) {
  if (!row) return null;
  return {
    issueId: row.issue_id,
    fingerprint: row.fingerprint,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    platform: row.platform,
    accountId: row.account_id,
    capability: row.capability,
    severity: row.severity,
    reasonCode: row.reason_code,
    state: row.state,
    detail: parse(row.detail_json, {}),
    resolutionReceipt: parse(row.resolution_receipt_json, {}),
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    resolvedAt: row.resolved_at,
    clearObservationCount: Number(row.clear_observation_count || 0),
    lastClearObservationAt: row.last_clear_observation_at || ''
  };
}

class ScopedSafetyAuthority {
  constructor(options = {}) {
    this.storeProvider = options.storeProvider || getStore;
    this.clock = options.clock || nowIso;
  }
  store() { const store = this.storeProvider(); ensureObjects(store.db); return store; }
  appendEvent(db, issueId, eventType, detail = {}) {
    const sequence = Number(db.prepare('SELECT COALESCE(MAX(sequence),0)+1 AS next FROM scoped_safety_events WHERE issue_id=?').get(issueId)?.next || 1);
    const eventId = `safety-event-${crypto.randomUUID()}`;
    db.prepare(`INSERT INTO scoped_safety_events(event_id,issue_id,sequence,event_type,actor,reason_code,detail_json,occurred_at) VALUES(?,?,?,?,?,?,?,?)`)
      .run(eventId,issueId,sequence,eventType,clean(detail.actor || 'runtime-safety-supervisor'),clean(detail.reasonCode),json(detail),this.clock());
    return eventId;
  }
  reconcile(triggers = []) {
    const store = this.store();
    const normalized = (Array.isArray(triggers) ? triggers : []).map(normalizeTrigger);
    const observedFingerprints = new Set(normalized.map(fingerprint));
    store.transaction(() => {
      for (const trigger of normalized) {
        const fp = fingerprint(trigger);
        const existing = store.db.prepare('SELECT * FROM scoped_safety_issues WHERE fingerprint=?').get(fp);
        const detail = { detail: trigger.detail, evidence: trigger.evidence, blockedCapabilities: trigger.blockedCapabilities, state: trigger.state, globalEscalation: trigger.globalEscalation };
        if (!existing) {
          const issueId = `safety-${fp.slice(0,32)}`;
          store.db.prepare(`INSERT INTO scoped_safety_issues(issue_id,fingerprint,scope_type,scope_id,platform,account_id,capability,severity,reason_code,state,detail_json,resolution_receipt_json,first_seen_at,last_seen_at,resolved_at,clear_observation_count,last_clear_observation_at)
            VALUES(?,?,?,?,?,?,?,?,?,'active',?,'{}',?,?,'',0,'')`)
            .run(issueId,fp,trigger.scopeType,trigger.scopeId,trigger.platform,trigger.accountId,trigger.capability,trigger.severity,trigger.code,json(detail),this.clock(),this.clock());
          this.appendEvent(store.db, issueId, 'opened', { reasonCode: trigger.code, trigger: detail });
        } else if (existing.state === 'resolved') {
          store.db.prepare(`UPDATE scoped_safety_issues SET state='active',severity=?,detail_json=?,resolution_receipt_json='{}',last_seen_at=?,resolved_at='',clear_observation_count=0,last_clear_observation_at='' WHERE issue_id=?`)
            .run(trigger.severity,json(detail),this.clock(),existing.issue_id);
          this.appendEvent(store.db, existing.issue_id, 'reopened', { reasonCode: trigger.code, trigger: detail });
        } else {
          store.db.prepare(`UPDATE scoped_safety_issues SET severity=?,detail_json=?,last_seen_at=?,clear_observation_count=0,last_clear_observation_at='' WHERE issue_id=?`)
            .run(trigger.severity,json(detail),this.clock(),existing.issue_id);
          this.appendEvent(store.db, existing.issue_id, 'observed', { reasonCode: trigger.code, trigger: detail });
        }
      }
      const activeRows = store.db.prepare("SELECT * FROM scoped_safety_issues WHERE state='active'").all();
      for (const active of activeRows) {
        if (observedFingerprints.has(active.fingerprint)) continue;
        const nextCount = Number(active.clear_observation_count || 0) + 1;
        const at = this.clock();
        if (nextCount < 2) {
          store.db.prepare('UPDATE scoped_safety_issues SET clear_observation_count=?,last_clear_observation_at=? WHERE issue_id=?').run(nextCount,at,active.issue_id);
          this.appendEvent(store.db,active.issue_id,'clear-observed',{ reasonCode:'SCOPED_TRIGGER_ABSENT',clearObservationCount:nextCount });
          continue;
        }
        const receipt = {
          actor: 'runtime-safety-supervisor', reason: '连续两次健康评估未再观察到触发条件',
          healthProbe: { pass: true, reasonCode: 'SCOPED_TRIGGER_CLEARED_TWO_CONSECUTIVE_EVALUATIONS', observations: nextCount },
          resolvedAt: at
        };
        receipt.receiptSha256 = hash(json({ issueId: active.issue_id, receipt }));
        store.db.prepare("UPDATE scoped_safety_issues SET state='resolved',resolution_receipt_json=?,resolved_at=?,last_seen_at=?,clear_observation_count=?,last_clear_observation_at=? WHERE issue_id=?")
          .run(json(receipt),at,at,nextCount,at,active.issue_id);
        this.appendEvent(store.db,active.issue_id,'auto-resolved',{ actor:receipt.actor,reasonCode:receipt.healthProbe.reasonCode,receipt });
      }
    });
    return this.snapshot();
  }
  resolve(issueId, input = {}) {
    const store = this.store();
    const healthProbe = input.healthProbe && typeof input.healthProbe === 'object' ? input.healthProbe : {};
    if (healthProbe.pass !== true) {
      const error = new Error('Scoped safety issue can only be resolved after a passing health probe');
      error.code = 'SCOPED_SAFETY_HEALTH_PROBE_REQUIRED'; error.status = 409; throw error;
    }
    const row = store.db.prepare('SELECT * FROM scoped_safety_issues WHERE issue_id=?').get(clean(issueId));
    if (!row) { const error = new Error('Scoped safety issue not found'); error.code = 'SCOPED_SAFETY_ISSUE_NOT_FOUND'; error.status = 404; throw error; }
    if (row.state === 'resolved') return issueRow(row);
    const receipt = {
      actor: clean(input.actor || 'user'), reason: clean(input.reason), healthProbe: clone(healthProbe), resolvedAt: this.clock(),
      receiptSha256: hash(json({ issueId: row.issue_id, actor: clean(input.actor || 'user'), reason: clean(input.reason), healthProbe }))
    };
    store.transaction(() => {
      store.db.prepare(`UPDATE scoped_safety_issues SET state='resolved',resolution_receipt_json=?,resolved_at=?,last_seen_at=? WHERE issue_id=?`)
        .run(json(receipt),receipt.resolvedAt,receipt.resolvedAt,row.issue_id);
      this.appendEvent(store.db,row.issue_id,'resolved',{ actor:receipt.actor,reasonCode:clean(healthProbe.reasonCode || 'HEALTH_PROBE_PASSED'),receipt });
    });
    return issueRow(store.db.prepare('SELECT * FROM scoped_safety_issues WHERE issue_id=?').get(row.issue_id));
  }
  snapshot() {
    const store = this.store();
    const active = store.db.prepare("SELECT * FROM scoped_safety_issues WHERE state='active' ORDER BY severity DESC,last_seen_at DESC,issue_id").all().map(issueRow);
    const recent = store.db.prepare('SELECT * FROM scoped_safety_issues ORDER BY last_seen_at DESC,issue_id LIMIT 100').all().map(issueRow);
    const normalized = active.map(row => normalizeTrigger({ code: row.reasonCode, severity: row.severity, scopeType: row.scopeType, scopeId: row.scopeId, platform: row.platform, accountId: row.accountId, capability: row.capability, detail: row.detail?.detail, evidence: row.detail?.evidence }));
    return {
      schemaVersion: SCHEMA_VERSION,
      authority: AUTHORITY,
      active,
      recent,
      globalBlockers: active.filter(row => row.scopeType === 'system' && isGlobalReason(row.reasonCode)),
      accounts: Object.fromEntries(normalized.filter(row => row.scopeType === 'account').map(row => [row.accountId, row])),
      platforms: Object.fromEntries(normalized.filter(row => row.scopeType === 'platform').map(row => [row.platform, row])),
      capabilities: Object.fromEntries(normalized.filter(row => row.scopeType === 'capability').map(row => [row.capability, row]))
    };
  }
}

let singleton = null;
function getScopedSafetyAuthority() { if (!singleton) singleton = new ScopedSafetyAuthority(); return singleton; }

module.exports = { AUTHORITY, SCHEMA_VERSION, GLOBAL_REASON_CODES, isGlobalReason, normalizeTrigger, ScopedSafetyAuthority, getScopedSafetyAuthority };
