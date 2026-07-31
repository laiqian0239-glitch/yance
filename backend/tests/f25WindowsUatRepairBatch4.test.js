'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { R32SqliteStore } = require('../lib/r32SqliteStore');
const { BackgroundJobAuthority, ensureSchema } = require('../services/backgroundJobAuthority');
const sendQueueModule = require('../services/sendQueueService');
const queueRepository = require('../repositories/sendQueueRepository');
const { RuntimeSafetySupervisor } = require('../services/runtimeSafetySupervisor');

function patch(target, values) {
  const before = {};
  for (const [key, value] of Object.entries(values)) { before[key] = target[key]; target[key] = value; }
  return () => { for (const [key, value] of Object.entries(before)) target[key] = value; };
}

function tempStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-batch4-'));
  const store = new R32SqliteStore({ dbPath: path.join(root, 'store.db') });
  return { store, close() { store.close(); fs.rmSync(root, { recursive: true, force: true }); } };
}

test('background job snapshot uses full-table authoritative aggregates independent of display limit', () => {
  const fixture = tempStore();
  try {
    ensureSchema(fixture.store);
    const insert = fixture.store.db.prepare(`
      INSERT INTO background_job_state(
        job_id,idempotency_key,job_type,platform,source_account_id,conversation_id,entity_id,revision,
        state,attempt,max_attempts,next_retry_at,lock_token,last_error_code,retryable,first_started_at,
        last_started_at,finished_at,payload_json,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);
    const states = ['PENDING','RUNNING','SUCCEEDED','RETRY_WAIT','FAILED_FINAL','CANCELLED','SUPERSEDED'];
    states.forEach((state, index) => insert.run(
      `job-${index}`, `idem-${index}`, index < 4 ? 'account-avatar-sync' : 'media-materialization', 'whatsapp',
      'account-a', '', `entity-${index}`, 'v1', state, 1, 3, '', '', state === 'FAILED_FINAL' ? 'TEST_FINAL' : '',
      state === 'RETRY_WAIT' ? 1 : 0, '', '', '', '{}', `2026-07-27T00:00:0${index}Z`, `2026-07-27T00:00:0${index}Z`
    ));
    const authority = new BackgroundJobAuthority({ store: fixture.store });
    const snapshot = authority.snapshot({ limit: 2 });
    assert.equal(snapshot.jobs.length, 2);
    assert.equal(snapshot.total, 7);
    assert.equal(snapshot.consistency.pass, true);
    assert.equal(Object.values(snapshot.counts).reduce((sum, value) => sum + value, 0), 7);
    assert.equal(snapshot.unresolved, 4);
    assert.equal(snapshot.byType['account-avatar-sync'].total, 4);
    assert.equal(snapshot.byType['media-materialization'].failedFinal, 1);
    assert.equal(snapshot.latestFinalFailures[0].lastErrorCode, 'TEST_FINAL');
  } finally { fixture.close(); }
});

test('durable message.sent evidence reconciles an unknown send without another platform dispatch', async () => {
  const row = {
    id: 'send-evidence-reconcile', idempotency_key: 'idem-evidence', account_id: 'account-a', session_key: 'session-a',
    message_type: 'text', state: 'send_outcome_unknown', payload: { platform: 'whatsapp', chatJid: 'chat-a', operation: 'text' }
  };
  const service = new sendQueueModule.SendQueueService({
    domainEventRepository: {
      getDomainEventByIdempotency(key) {
        assert.equal(key, 'message-sent:whatsapp:account-a:send-evidence-reconcile');
        return {
          event_id: 'event-sent-1', event_type: 'message.sent', external_event_id: 'remote-1',
          idempotency_key: key, occurred_at: '2026-07-27T00:00:00Z', received_at: '2026-07-27T00:00:01Z',
          payload_sha256: 'a'.repeat(64), payload: { platformMessageId: 'remote-1' }
        };
      }
    },
    outcomeAudit: { record() {}, latest() { return null; } }
  });
  const resolutions = [];
  service.resolveOutcomeUnknown = async (id, resolution, options) => {
    resolutions.push({ id, resolution, options });
    return { queue: { id, state: 'sent' }, resolution };
  };
  const restore = patch(queueRepository, { list: options => options?.state === 'send_outcome_unknown' ? [row] : [] });
  try {
    const result = await service.reconcileOutcomeUnknownFromDurableEvidence();
    assert.equal(result.reconciled, 1);
    assert.equal(resolutions.length, 1);
    assert.equal(resolutions[0].resolution, 'confirmed_sent');
    assert.equal(resolutions[0].options.actor, 'system-domain-event-evidence');
    assert.equal(resolutions[0].options.platformMessageId, 'remote-1');
  } finally { restore(); }
});

test('manual unknown-send resolution records actor reason and terminal audit evidence', async () => {
  const row = {
    id: 'send-cancel-audit', idempotency_key: 'idem-cancel', account_id: 'account-a', session_key: 'session-a',
    message_type: 'reaction', state: 'send_outcome_unknown', platform_message_id: '',
    payload: { platform: 'whatsapp', chatJid: 'chat-a', operation: 'reaction', targetId: 'remote-target' }
  };
  const audits = [];
  let resolved = false;
  const service = new sendQueueModule.SendQueueService({
    domainEventRepository: { getDomainEventByIdempotency() { return null; } },
    outcomeAudit: { record(input) { audits.push(input); return { auditId: 'audit-1', ...input }; }, latest() { return null; } }
  });
  const restore = patch(queueRepository, {
    get: () => ({ ...row }),
    list: options => options?.state === 'send_outcome_unknown' && !resolved ? [row] : [],
    resolveOutcomeUnknown: (_id, resolution) => { resolved = true; return { ...row, state: resolution === 'cancelled' ? 'cancelled' : 'retry' }; }
  });
  try {
    service.blockedPlatformAcceptances.set(row.id, { id: row.id, persisted: true });
    service.pausedReason = 'PLATFORM_ACCEPTED_CHECKPOINT_UNCERTAIN';
    const output = await service.resolveOutcomeUnknown(row.id, 'cancelled', {
      actor: 'uat-reviewer', reason: '用户已核对平台并决定取消', evidenceType: 'manual-platform-check', evidenceId: 'screen-1'
    });
    assert.equal(output.audit.auditId, 'audit-1');
    assert.equal(audits[0].actor, 'uat-reviewer');
    assert.equal(audits[0].reason, '用户已核对平台并决定取消');
    assert.equal(audits[0].previousState, 'send_outcome_unknown');
    assert.equal(audits[0].resultingState, 'cancelled');
  } finally { restore(); }
});

test('automatic safety supervisor enters safe mode once for critical blockers and never auto-exits', async () => {
  const transitions = [];
  const runtime = {
    operatingMode: 'normal',
    async enterSafeMode(reason, metadata) { transitions.push({ reason, metadata }); this.operatingMode = 'safeMode'; }
  };
  const supervisor = new RuntimeSafetySupervisor({
    runtime,
    sendQueue: { status: () => ({ resumeBlocked: true, outcomeUnknown: 1, pausedReason: 'PLATFORM_ACCEPTED_CHECKPOINT_UNCERTAIN' }) },
    modelStatus: { read: () => ({ routeIntegrity: { pass: true, invalidPersistedRouteCount: 0, quarantine: [] } }) },
    backgroundJobs: { snapshot: () => ({ counts: { FAILED_FINAL: 0 }, consistency: { pass: true } }) },
    accountManager: { list: () => ({ accounts: [] }) },
    platformReadiness: { evaluate: () => ({ summary: { blockedPlatforms: 0 } }) },
    eventBus: { on() {}, off() {}, publish() {} },
    logger: { error() {} },
    intervalMs: 60_000
  });
  await supervisor.evaluate();
  await supervisor.evaluate();
  assert.equal(transitions.length, 1);
  assert.equal(transitions[0].metadata.code, 'SEND_OUTCOME_UNKNOWN');
  assert.equal(runtime.operatingMode, 'safeMode');
  assert.equal(supervisor.snapshot().manualReviewRequired, true);
});
