'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { R32SqliteStore } = require('../lib/r32SqliteStore');
const { ArchitectureShadowGate } = require('../services/architectureShadowGate');
const { Fix6MArchitectureDiagnostics, mergeDiagnosticTruth } = require('../services/fix6mArchitectureDiagnostics');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-fix6m-diag-'));
  const store = new R32SqliteStore({ dbPath: path.join(root, 'database', 'yance.db') });
  let id = 0; const idFactory = prefix => `${prefix}-${++id}`;
  const gate = new ArchitectureShadowGate({ storeProvider: () => store, idFactory, clock: () => '2026-08-01T10:00:00.000Z' });
  const diagnostics = new Fix6MArchitectureDiagnostics({ storeProvider: () => store, shadowGate: gate, clock: () => new Date('2026-08-01T10:00:00.000Z') });
  return { root, store, gate, diagnostics, close() { try { store.close(); } catch (_) {} fs.rmSync(root, { recursive: true, force: true }); } };
}

test('authority warning/failure cannot be overwritten by a local UI all-green result', () => {
  assert.deepEqual(mergeDiagnosticTruth({ status: 'pass', pass: true, detail: '9通过 0警告 0失败' }, { status: 'fail', pass: false, reasonCode: 'SYNC_GAP_OPEN' }), {
    status: 'fail', pass: false, detail: '9通过 0警告 0失败', reasonCode: 'SYNC_GAP_OPEN'
  });
  assert.equal(mergeDiagnosticTruth({ status: 'pass', pass: true }, { status: 'warning', pass: false }).status, 'warning');
});

test('shadow mismatch blocks read-path cutover until the acceptance window is clean', () => {
  const f = fixture();
  try {
    f.gate.recordComparison({ authority: 'communication', scopeId: 'tg-a:message-1', legacyHash: 'a', authorityHash: 'b' });
    let result = f.gate.evaluate({ authorities: ['communication'], minSamples: 1, windowSize: 10 });
    assert.equal(result.pass, false);
    assert.equal(result.mismatches, 1);
    f.gate.recordComparison({ authority: 'communication', scopeId: 'tg-a:message-2', legacyHash: 'c', authorityHash: 'c' });
    result = f.gate.evaluate({ authorities: ['communication'], minSamples: 2, windowSize: 2 });
    assert.equal(result.pass, false);
    f.gate.recordComparison({ authority: 'communication', scopeId: 'tg-a:message-3', legacyHash: 'd', authorityHash: 'd' });
    result = f.gate.evaluate({ authorities: ['communication'], minSamples: 2, windowSize: 2 });
    assert.equal(result.pass, true);
  } finally { f.close(); }
});

test('FIX6M diagnostics exposes stalled execution, media failure, uncertain delivery and shadow mismatch', () => {
  const f = fixture();
  try {
    f.store.db.prepare(`INSERT INTO durable_executions(execution_id,trace_id,operation_kind,idempotency_key,state,generation,owner_id,lease_sequence,last_heartbeat_at,cancellation_requested_at,cancellation_actor,retry_count,max_attempts,next_attempt_at,failure_code,metadata_json,created_at,updated_at,completed_at)
      VALUES('exec-stalled','trace-1','media-fetch','media-1','RUNNING',1,'worker-a',0,'2026-08-01T08:00:00.000Z','','',0,3,'','','{}','2026-08-01T08:00:00.000Z','2026-08-01T08:00:00.000Z','')`).run();
    f.store.db.prepare(`INSERT INTO communication_media_assets(media_id,trace_id,platform,source_account_id,external_reference,media_kind,mime_type,animated,state,version,local_path,thumbnail_path,sha256,failure_code,next_retry_at,metadata_json,created_at,updated_at)
      VALUES('media-failed','','telegram','tg-a','ref-1','avatar','image/jpeg',0,'FAILED_RETRYABLE',2,'','','','AUTH_EXPIRED','2026-08-01T10:05:00.000Z','{}','2026-08-01T09:00:00.000Z','2026-08-01T09:00:00.000Z')`).run();
    f.store.db.prepare(`INSERT INTO r32_accounts(id,platform,adapter_account_id,display_name,identity_label,state,can_send,can_receive,payload_json,created_at,updated_at)
      VALUES('tg-a','telegram','tg-a','TG','TG','connected',1,1,'{}','2026-08-01T08:00:00.000Z','2026-08-01T08:00:00.000Z')`).run();
    f.store.db.prepare(`INSERT INTO communication_canonical_messages(message_id,trace_id,platform,source_account_id,external_conversation_id,external_message_id,direction,sender_external_id,occurred_at,content_kind,raw_event_ref_json,normalized_content_json,render_projection_json,idempotency_key,created_at,updated_at)
      VALUES('message-unknown','','telegram','tg-a','chat-1','local-1','outbound','self','','text','{}','{}','{}','diag-message','2026-08-01T08:00:00.000Z','2026-08-01T08:00:00.000Z')`).run();
    f.store.db.prepare(`INSERT INTO communication_delivery_attempts(attempt_id,trace_id,message_id,platform,source_account_id,idempotency_key,state,platform_message_id,provider_request_id,failure_code,created_at,updated_at)
      VALUES('attempt-unknown','','message-unknown','telegram','tg-a','send-1','UNKNOWN','','','','2026-08-01T08:00:00.000Z','2026-08-01T08:00:00.000Z')`).run();
    f.gate.recordComparison({ authority: 'communication', scopeId: 'scope-1', legacyHash: 'a', authorityHash: 'b' });
    const result = f.diagnostics.snapshot({ shadowAuthorities: ['communication'], shadowMinSamples: 1, shadowWindowSize: 10 });
    assert.equal(result.status, 'fail');
    assert.equal(result.counts.stalledExecutions, 1);
    assert.equal(result.counts.retryableMediaFailures, 1);
    assert.equal(result.counts.uncertainDeliveries, 1);
    assert.equal(result.shadowGate.pass, false);
  } finally { f.close(); }
});
