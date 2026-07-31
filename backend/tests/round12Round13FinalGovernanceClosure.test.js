'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { R32SqliteStore } = require('../lib/r32SqliteStore');
const { createPlatformCoreRepository } = require('../repositories/platformCoreRepository');
const { IdentityLinkAuthority } = require('../services/identityLinkAuthority');
const { PersonContextAuthority } = require('../services/personContextAuthority');
const { DomainEventLogService } = require('../services/domainEventLogService');
const { DomainOperationalEventBridge } = require('../services/domainOperationalEventBridge');
const { DomainEventProjectionAuthority } = require('../services/domainEventProjectionAuthority');
const architectureHealth = require('../services/architectureRuntimeHealthService');
const finalMigration = require('../migrations/round12Round13FinalGovernanceClosure');
const finalSevenMigration = require('../migrations/round12Round13FinalSevenClosure');
const batch24Migration = require('../migrations/batch24StateTransactionConsistency');
const batch27Migration = require('../migrations/batch27DeveloperHandoffV2Closure');

function withRepository(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-final-governance-'));
  const store = new R32SqliteStore({ dbPath: path.join(root, 'database', 'yance.db') });
  const repository = createPlatformCoreRepository({ storeProvider: () => store });
  for (const [id, platform] of [['wa-1','whatsapp'],['tg-1','telegram'],['page-1','facebook'],['private-account','whatsapp'],['a-account','whatsapp'],['b-account','telegram']]) {
    store.upsertAccount({ id, accountId:id, adapterAccountId:id, platform, state:'online', canSend:false, canReceive:true });
  }
  try { return callback({ root, store, repository }); }
  finally { try { store.close(); } catch (_) {} fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
}
function at(offset = 0) { return new Date(Date.parse('2026-07-27T00:00:00.000Z') + offset).toISOString(); }

function insertProfile(store, contactId, facts = {}) {
  store.db.prepare(`
    INSERT INTO customer_profiles(contact_id,facts_json,confirmed_facts_json,created_at,updated_at)
    VALUES(?,?,?,?,?)
  `).run(contactId, JSON.stringify(facts), '[]', at(), at());
}
function insertInsight(store, contactId, conversationId) {
  store.db.prepare(`
    INSERT INTO relationship_insights(contact_id,conversation_id,summary,relationship_stage,evidence_json,open_loops_json,dimensions_json,payload_json,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)
  `).run(contactId, conversationId, 'warm', 'building', '[]', '[]', '{}', '{}', at(), at());
}
function insertContext(store, contactId, conversationId) {
  store.db.prepare(`
    INSERT INTO ai_context_snapshots(id,contact_id,conversation_id,state_version,entity_versions_json,context_json,created_at)
    VALUES(?,?,?,?,?,?,?)
  `).run(`ctx-${contactId}`, contactId, conversationId, 1, '{}', JSON.stringify({ memory: contactId }), at());
}

test('current schema preserves durable Person anchors and future writes inherit the active Person automatically', () => {
  withRepository(({ store, repository }) => {
    assert.equal(store.getMeta('schemaVersion', 0), batch27Migration.TARGET_SCHEMA_VERSION);
    const schema13Receipt = store.db.prepare('SELECT target_schema_version FROM r32_schema_migrations WHERE migration_id=?').get(finalMigration.MIGRATION_ID);
    assert.equal(Number(schema13Receipt?.target_schema_version || 0), finalMigration.TARGET_SCHEMA_VERSION);
    for (const trigger of ['trg_person_contact_binding_propagate','trg_person_contact_binding_reactivate','trg_conversation_binding_propagate','trg_conversation_binding_reactivate']) {
      assert.ok(store.db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name=?").get(trigger), trigger);
    }
    store.upsertContact({ id: 'contact-a', platform: 'whatsapp', accountId: 'wa-1', externalId: '491@s.whatsapp.net', displayName: 'A' });
    repository.insertPerson({ personId: 'person-a', workspaceId: 'default', displayName: 'A', profileContactId: 'contact-a', state: 'active', confidence: 1, payload: {}, createdAt: at(), updatedAt: at() });
    repository.upsertPersonContactBinding({ personId: 'person-a', contactId: 'contact-a', workspaceId: 'default', state: 'active', source: 'test', evidenceRefs: ['message:a'], createdAt: at(), updatedAt: at() });
    insertProfile(store, 'contact-a', { age: 65 });
    store.db.prepare("INSERT INTO ai_reply_feedback_profiles(scope_type,scope_id,profile_json,version,updated_at) VALUES('contact',?,?,1,?)").run('contact-a', JSON.stringify({ concise: true }), at());
    store.db.prepare("INSERT INTO learning_signal_ledger(signal_id,idempotency_key,learning_level,scope_type,scope_id,contact_id,conversation_id,candidate_id,outbox_id,signal_type,signal_json,quality_tier,emergency_mode,learning_eligible,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run('signal-a','signal-key-a','L1','contact','contact-a','contact-a','conv-a','','','candidate_used','{}','high',0,1,at());
    store.upsertConversation({ sessionKey: 'conv-a', contactId: 'contact-a', accountId: 'wa-1', platform: 'whatsapp', title: 'A' });
    repository.upsertConversationBinding({ personId: 'person-a', conversationId: 'conv-a', contactId: 'contact-a', platform: 'whatsapp', accountId: 'wa-1', externalId: '491@s.whatsapp.net', state: 'active', source: 'test', evidenceRefs: ['message:a'], createdAt: at(), updatedAt: at() });
    assert.equal(store.db.prepare('SELECT person_id FROM customer_profiles WHERE contact_id=?').get('contact-a').person_id, 'person-a');
    assert.equal(store.db.prepare('SELECT person_id FROM r32_conversations WHERE session_key=?').get('conv-a').person_id, 'person-a');
    assert.equal(store.db.prepare("SELECT person_id FROM ai_reply_feedback_profiles WHERE scope_type='contact' AND scope_id=?").get('contact-a').person_id, 'person-a');
    assert.equal(store.db.prepare('SELECT person_id FROM learning_signal_ledger WHERE signal_id=?').get('signal-a').person_id, 'person-a');
  });
});

test('Person merge moves profile, relationship, memory and conversation anchors and rollback restores all of them', () => {
  withRepository(({ store, repository }) => {
    for (const suffix of ['a','b']) {
      store.upsertContact({ id: `contact-${suffix}`, platform: suffix === 'a' ? 'whatsapp' : 'telegram', accountId: `${suffix}-account`, externalId: `${suffix}-external`, displayName: suffix.toUpperCase() });
      repository.insertPerson({ personId: `person-${suffix}`, workspaceId: 'default', displayName: suffix.toUpperCase(), profileContactId: `contact-${suffix}`, state: 'active', confidence: 1, payload: {}, createdAt: at(), updatedAt: at() });
      repository.upsertPersonContactBinding({ personId: `person-${suffix}`, contactId: `contact-${suffix}`, workspaceId: 'default', state: 'active', source: 'test', evidenceRefs: [`message:${suffix}`], createdAt: at(), updatedAt: at() });
      store.upsertConversation({ sessionKey: `conv-${suffix}`, contactId: `contact-${suffix}`, accountId: `${suffix}-account`, platform: suffix === 'a' ? 'whatsapp' : 'telegram', title: suffix.toUpperCase() });
      repository.upsertConversationBinding({ personId: `person-${suffix}`, conversationId: `conv-${suffix}`, contactId: `contact-${suffix}`, platform: suffix === 'a' ? 'whatsapp' : 'telegram', accountId: `${suffix}-account`, externalId: `${suffix}-external`, state: 'active', source: 'test', evidenceRefs: [`message:${suffix}`], createdAt: at(), updatedAt: at() });
      insertProfile(store, `contact-${suffix}`, { name: suffix }); insertInsight(store, `contact-${suffix}`, `conv-${suffix}`); insertContext(store, `contact-${suffix}`, `conv-${suffix}`);
      store.db.prepare("INSERT INTO ai_reply_feedback_profiles(scope_type,scope_id,profile_json,version,updated_at) VALUES('contact',?,?,1,?)").run(`contact-${suffix}`, JSON.stringify({ suffix }), at());
    }
    repository.insertLearningProfile({ scopeType: 'relationship', scopeId: 'person-b', personId: 'person-b', learningLevel: 'L2', version: 1, preference: { tone: 'target-existing' }, evidenceSignalIds: ['target-evidence'], confidence: 0.8, state: 'active', createdAt: at(1000), activatedAt: at(1000) });
    repository.insertLearningProfile({ scopeType: 'relationship', scopeId: 'person-a', personId: 'person-a', learningLevel: 'L2', version: 1, preference: { tone: 'source-learning' }, evidenceSignalIds: ['source-evidence'], confidence: 0.9, state: 'active', createdAt: at(2000), activatedAt: at(2000) });
    repository.insertLearningSignal({ signalId: 'l2-source-output', idempotencyKey: 'l2-source-output', learningLevel: 'L2', scopeType: 'owner', scopeId: 'owner', contactId: 'contact-a', signalType: 'synthesis_promoted', signal: { targetScopeType: 'relationship', targetScopeId: 'person-a', profileVersion: 1, preference: { tone: 'source-learning' }, evidenceSignalIds: ['source-evidence'] }, qualityTier: 'high', emergencyMode: false, learningEligible: true, createdAt: at(2000) });
    const identity = new IdentityLinkAuthority({ repository });
    identity.observe({ personId: 'person-a', linkExistingPerson: true, workspaceId: 'default', platform: 'whatsapp', sourceAccountId: 'a-account', externalId: 'a-external', profileContactId: 'contact-a', conversationId: 'conv-a', evidenceRefs: ['message:a'], actor: 'test', reason: 'verified inbound' });
    identity.observe({ personId: 'person-b', linkExistingPerson: true, workspaceId: 'default', platform: 'telegram', sourceAccountId: 'b-account', externalId: 'b-external', profileContactId: 'contact-b', conversationId: 'conv-b', evidenceRefs: ['message:b'], actor: 'test', reason: 'verified inbound' });
    const merged = identity.merge({ sourcePersonId: 'person-a', targetPersonId: 'person-b', evidenceRefs: ['review:phone'], actor: 'reviewer', reason: 'same verified person' });
    for (const table of ['customer_profiles','relationship_insights','ai_context_snapshots']) assert.equal(store.db.prepare(`SELECT person_id FROM ${table} WHERE contact_id=?`).get('contact-a').person_id, 'person-b', table);
    assert.equal(store.db.prepare('SELECT person_id FROM r32_conversations WHERE session_key=?').get('conv-a').person_id, 'person-b');
    assert.equal(store.db.prepare("SELECT person_id FROM ai_reply_feedback_profiles WHERE scope_type='contact' AND scope_id=?").get('contact-a').person_id, 'person-b');
    const movedLearning = repository.getLearningProfile({ scopeType: 'relationship', scopeId: 'person-b', learningLevel: 'L2', version: 2 });
    assert.equal(movedLearning.person_id, 'person-b');
    assert.deepEqual(movedLearning.preference, { tone: 'source-learning' });
    const movedSignal = store.db.prepare('SELECT signal_json,person_id FROM learning_signal_ledger WHERE signal_id=?').get('l2-source-output');
    assert.equal(movedSignal.person_id, 'person-b');
    assert.deepEqual(JSON.parse(movedSignal.signal_json), { targetScopeType: 'relationship', targetScopeId: 'person-b', profileVersion: 2, preference: { tone: 'source-learning' }, evidenceSignalIds: ['source-evidence'] });
    const context = new PersonContextAuthority({ repository }).snapshot({ contactId: 'contact-b' });
    assert.deepEqual(new Set(context.contactIds), new Set(['contact-a','contact-b']));
    assert.equal(context.relationship.insights.length, 2);
    assert.equal(context.memory.aiContextSnapshots.length, 2);
    identity.rollbackMerge(merged.auditId, { actor: 'reviewer', reason: 'wrong merge', evidenceRefs: ['review:correction'] });
    for (const table of ['customer_profiles','relationship_insights','ai_context_snapshots']) assert.equal(store.db.prepare(`SELECT person_id FROM ${table} WHERE contact_id=?`).get('contact-a').person_id, 'person-a', table);
    assert.equal(store.db.prepare('SELECT person_id FROM r32_conversations WHERE session_key=?').get('conv-a').person_id, 'person-a');
    assert.equal(store.db.prepare("SELECT person_id FROM ai_reply_feedback_profiles WHERE scope_type='contact' AND scope_id=?").get('contact-a').person_id, 'person-a');
    const restoredLearning = repository.getLearningProfile({ scopeType: 'relationship', scopeId: 'person-a', learningLevel: 'L2', version: 1 });
    assert.equal(restoredLearning.person_id, 'person-a');
    assert.deepEqual(restoredLearning.preference, { tone: 'source-learning' });
    assert.equal(repository.getLearningProfile({ scopeType: 'relationship', scopeId: 'person-b', learningLevel: 'L2', version: 2 }), null);
    const restoredSignal = store.db.prepare('SELECT signal_json,person_id FROM learning_signal_ledger WHERE signal_id=?').get('l2-source-output');
    assert.equal(restoredSignal.person_id, 'person-a');
    assert.deepEqual(JSON.parse(restoredSignal.signal_json), { targetScopeType: 'relationship', targetScopeId: 'person-a', profileVersion: 1, preference: { tone: 'source-learning' }, evidenceSignalIds: ['source-evidence'] });
  });
});

test('detach and verify transitions have executable audited rollback, including detached conversation bindings', () => {
  withRepository(({ store, repository }) => {
    store.upsertContact({ id: 'contact-a', platform: 'facebook', accountId: 'page-1', externalId: 'psid-1', displayName: 'A' });
    const identity = new IdentityLinkAuthority({ repository });
    const observed = identity.observe({ workspaceId: 'default', platform: 'facebook', sourceAccountId: 'page-1', externalId: 'psid-1', profileContactId: 'contact-a', conversationId: 'conv-a', evidenceRefs: ['message:a'], actor: 'ingress', reason: 'first message' });
    const verified = identity.verify(observed.link.identityLinkId, { evidenceRefs: ['manual:id'], verificationMethod: 'manual-id', actor: 'reviewer', reason: 'checked' });
    identity.rollbackAudit(verified.auditId, { actor: 'reviewer', reason: 'verification mistake', evidenceRefs: ['review:undo'] });
    assert.equal(repository.getIdentityLink(observed.link.identityLinkId).link_status, 'observed');
    const detached = identity.detach(observed.link.identityLinkId, { actor: 'reviewer', reason: 'wrong platform identity' });
    assert.equal(repository.listConversationBindings({ personId: observed.person.personId, conversationId: 'conv-a', limit: 10 })[0].state, 'detached');
    identity.rollbackAudit(detached.auditId, { actor: 'reviewer', reason: 'restore after evidence review', evidenceRefs: ['review:restore'] });
    assert.equal(repository.getIdentityLink(observed.link.identityLinkId).link_status, 'observed');
    assert.equal(repository.listConversationBindings({ personId: observed.person.personId, conversationId: 'conv-a', limit: 10 })[0].state, 'active');
  });
});

test('operational event bridge verifies media lifecycle state before recording an applied receipt', () => {
  withRepository(({ store, repository }) => {
    store.upsertContact({ id: 'contact-1', platform: 'facebook', accountId: 'page-1', externalId: 'peer-1', displayName: 'Peer' });
    store.upsertConversation({ sessionKey: 'conv-1', contactId: 'contact-1', accountId: 'page-1', platform: 'facebook', title: 'Peer' });
    store.upsertMessage({ id: 'msg-1', dedupeKey: 'msg-1', externalMessageId: 'external-1', platform: 'facebook', accountId: 'page-1', sourceAccountId: 'page-1', conversationId: 'conv-1', sessionKey: 'conv-1', contactId: 'contact-1', direction: 'inbound', fromMe: false, type: 'image', messageType: 'image', text: '', timestamp: at(), attachments: [{ kind: 'image', mimeType: 'image/jpeg', downloadStatus: 'ready', fileHash: 'abc' }] });
    const eventLog = new DomainEventLogService({ repository });
    const bridge = new DomainOperationalEventBridge({ eventLog, logger: { warn() {} } });
    const result = bridge.capture({ id: 'bus-1', type: 'facebook:media-cached', at: at(), payload: { accountId: 'page-1', conversationId: 'conv-1', messageId: 'msg-1', attachment: { kind: 'image', mimeType: 'image/jpeg', downloadStatus: 'ready', fileHash: 'abc' } } });
    assert.equal(result.created, true);
    const event = repository.getDomainEvent(result.event.eventId);
    assert.equal(event.event_type, 'media.lifecycle.updated');
    const receipt = repository.getProjectionReceipt('operational-projection', 'round13-v2', result.event.eventId);
    assert.equal(receipt.projection_status, 'applied');
  });
});


test('operational events never self-prove: missing state is blocking until an independent audit sees persisted state', () => {
  withRepository(({ store, repository }) => {
    const bus = new EventEmitter();
    bus.publish = function publish(type, payload) { this.emit(type, { type, payload }); return { type, payload }; };
    const eventLog = new DomainEventLogService({ repository, eventBus: bus });
    const bridge = new DomainOperationalEventBridge({ eventLog, eventBus: bus, logger: { warn() {} } });
    const result = bridge.capture({ id: 'bus-missing-1', type: 'facebook:media-cached', at: at(), payload: { platform: 'facebook', accountId: 'page-1', conversationId: 'conv-1', messageId: 'msg-missing', attachment: { kind: 'image', mimeType: 'image/jpeg', downloadStatus: 'ready', fileHash: 'abc' } } });
    assert.equal(result.created, true);
    const initial = repository.getProjectionReceipt('operational-projection', 'round13-v2', result.event.eventId);
    assert.equal(initial.projection_status, 'failed');
    assert.equal(initial.failure_code, 'DOMAIN_OPERATIONAL_TARGET_MISSING');

    store.upsertContact({ id: 'contact-1', platform: 'facebook', accountId: 'page-1', externalId: 'peer-1', displayName: 'Peer' });
    store.upsertConversation({ sessionKey: 'conv-1', contactId: 'contact-1', accountId: 'page-1', platform: 'facebook', title: 'Peer' });
    store.upsertMessage({ id: 'msg-missing', dedupeKey: 'msg-missing', externalMessageId: 'external-1', platform: 'facebook', accountId: 'page-1', sourceAccountId: 'page-1', conversationId: 'conv-1', sessionKey: 'conv-1', contactId: 'contact-1', direction: 'inbound', fromMe: false, type: 'image', messageType: 'image', text: '', timestamp: at(), attachments: [{ kind: 'image', mimeType: 'image/jpeg', downloadStatus: 'ready', fileHash: 'abc' }] });
    const authority = new DomainEventProjectionAuthority({ repository, eventLog, messageStore: {}, eventBus: bus, logger: { warn() {} } });
    const report = authority.auditExisting();
    assert.equal(report.missing, 0);
    assert.equal(report.mismatch, 0);
    const verified = repository.getProjectionReceipt('operational-projection', 'round13-v2', result.event.eventId);
    assert.equal(verified.projection_status, 'applied');
  });
});

test('blocking projection pagination deduplicates events across statuses and keeps offsets stable', () => {
  withRepository(({ repository }) => {
    for (let index = 0; index < 3; index += 1) {
      const id = `event-${index}`;
      repository.insertDomainEvent({ eventId: id, schemaVersion: 1, platform: 'telegram', sourceAccountId: 'tg-1', externalEventId: id, eventType: 'message.received', idempotencyKey: id, correlationId: '', causationId: '', occurredAt: at(index), receivedAt: at(index), redactionVersion: 'test', payload: { projection: { id } }, payloadSha256: `hash-${index}`, retentionUntil: at(86400000), replayState: 'available' });
      repository.upsertProjectionReceipt({ projectorName: 'message-projection', projectorVersion: 'round12-v2', eventId: id, projectionStatus: index === 2 ? 'failed' : 'shadow-mismatch', projectionHash: '', targetRefs: [], failureCode: 'X', failureReason: 'x', attempt: 1, projectedAt: at(index) });
    }
    repository.upsertProjectionReceipt({ projectorName: 'operational-projection', projectorVersion: 'round13-v2', eventId: 'event-0', projectionStatus: 'failed', projectionHash: '', targetRefs: [], failureCode: 'Y', failureReason: 'y', attempt: 1, projectedAt: at(100) });
    assert.equal(repository.countBlockingProjectionEvents({ statuses: ['failed','shadow-mismatch'] }), 3);
    const first = repository.listBlockingProjectionReceipts({ statuses: ['failed','shadow-mismatch'], limit: 2, offset: 0 });
    const second = repository.listBlockingProjectionReceipts({ statuses: ['failed','shadow-mismatch'], limit: 2, offset: 2 });
    assert.equal(first.length, 2); assert.equal(second.length, 1);
    assert.equal(new Set([...first,...second].map(row => row.event_id)).size, 3);
  });
});

test('architecture runtime health degrades safely but blocks release while projection is unaudited or divergent', () => {
  const learning = { snapshot: () => ({ started: true, running: false, pending: false, lastRun: { ok: true } }) };
  const bridge = { snapshot: () => ({ started: true, captured: 4, failed: 0 }) };
  const runtimeEvidence = { integrityStatus: () => ({ checkedActiveQueue: 0, commandFailures: 0, routeFailures: 0, releaseBlocking: 0, complete: true }) };
  const blocked = architectureHealth.snapshot({ domainProjection: { snapshot: () => ({ state: 'not-audited', convergence: { blocking: 0, converged: false } }) }, learningScheduler: learning, operationalBridge: bridge, runtimeEvidence, repository: { listIdentityAudits: () => [] } });
  assert.equal(blocked.releaseBlocked, true);
  assert.equal(blocked.policy.messageTransportMayContinue, true);
  assert.throws(() => architectureHealth.assertReleaseReady({ domainProjection: { snapshot: () => ({ state: 'audited', completedAt: at(), convergence: { blocking: 1, converged: false } }) }, learningScheduler: learning, operationalBridge: bridge, runtimeEvidence, repository: { listIdentityAudits: () => [] } }), error => error.code === 'ARCHITECTURE_RUNTIME_RELEASE_BLOCKED');
  const healthy = architectureHealth.snapshot({ domainProjection: { snapshot: () => ({ state: 'audited', completedAt: at(), scanned: 1, convergence: { blocking: 0, converged: true } }) }, learningScheduler: learning, operationalBridge: bridge, runtimeEvidence, repository: { listIdentityAudits: () => [] } });
  assert.equal(healthy.state, 'healthy'); assert.equal(healthy.releaseBlocked, false);
  const bridgeFailed = architectureHealth.snapshot({ domainProjection: { snapshot: () => ({ state: 'audited', completedAt: at(), scanned: 1, convergence: { blocking: 0, converged: true } }) }, learningScheduler: learning, operationalBridge: { snapshot: () => ({ started: true, captured: 4, failed: 1 }) }, runtimeEvidence, repository: { listIdentityAudits: () => [] } });
  assert.equal(bridgeFailed.releaseBlocked, true);
  assert.ok(bridgeFailed.reasons.some(row => row.code === 'DOMAIN_OPERATIONAL_EVENT_CAPTURE_FAILED'));
  const invalidRuntimeEvidence = architectureHealth.snapshot({
    domainProjection: { snapshot: () => ({ state: 'audited', completedAt: at(), scanned: 1, convergence: { blocking: 0, converged: true } }) },
    learningScheduler: learning,
    operationalBridge: bridge,
    runtimeEvidence: { integrityStatus: () => ({ checkedActiveQueue: 1, commandFailures: 1, routeFailures: 0, releaseBlocking: 1, complete: true }) },
    repository: { listIdentityAudits: () => [] }
  });
  assert.equal(invalidRuntimeEvidence.releaseBlocked, true);
  assert.ok(invalidRuntimeEvidence.reasons.some(row => row.code === 'OUTBOX_OR_AI_ROUTE_RECEIPT_INVALID'));
});

test('formal UI refreshes account-level capabilities and evidence exports release, projection, identity and learning governance', () => {
  const ui = fs.readFileSync(path.join(__dirname, '../../frontend/js/r32-conversation-capabilities.js'), 'utf8');
  const capabilityRuntime = fs.readFileSync(path.join(__dirname, '../../frontend/js/r32-platform-capability-runtime.js'), 'utf8');
  const exporter = fs.readFileSync(path.join(__dirname, '../../tools/uat/exportPlatformProductionEvidence.js'), 'utf8');
  const systemRoutes = fs.readFileSync(path.join(__dirname, '../routes/system.js'), 'utf8');
  assert.match(ui, /refreshActiveCapabilities/u);
  assert.match(ui, /YancePlatformCapabilityRuntime\?\.refreshContact/u);
  assert.match(capabilityRuntime, /platform-capabilities\?platform=/u);
  assert.match(exporter, /architecture\/release-gate/u);
  assert.match(exporter, /collectProjectionGovernance/u);
  assert.match(exporter, /collectIdentityGovernance/u);
  assert.match(exporter, /collectLearningGovernance/u);
  assert.match(systemRoutes, /architecture\/release-gate/u);
});
