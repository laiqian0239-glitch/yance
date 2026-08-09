'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { acquireAuthorityWriteHost } = require('../services/authorityWriteHost');
const { SqliteConnectionBroker } = require('../lib/sqliteConnectionBroker');
const { AuthorityTransactionCoordinator } = require('../services/authorityTransactionCoordinator');
const canonicalEventLedger = require('../services/canonicalEventLedgerAuthority');
const { createPlatformCoreRepository } = require('../repositories/platformCoreRepository');
const { IdentityLinkAuthority } = require('../services/identityLinkAuthority');
const { DomainEventLogService } = require('../services/domainEventLogService');
const { SendPolicyAuthority } = require('../services/sendPolicyAuthority');

function validModelBrainExecutionEvidence(overrides = {}) {
  return {
    requestId: 'round12-model-brain-request',
    logicalModel: 'yance.reply.quick',
    selectedModel: 'round12-quality-model',
    provider: 'openrouter',
    latencyMs: 123,
    inputTokens: 21,
    outputTokens: 9,
    totalTokens: 30,
    costUsd: 0.0012,
    retryCount: 0,
    fallbackCount: 0,
    status: 'ok',
    ...overrides
  };
}

function withAuthorities(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-r12-authority-'));
  const dbPath = path.join(root, 'database', 'yance.db');
  const previousReset = process.env.YANCE_TEST_ONLY_RUNTIME_RESET;
  process.env.YANCE_TEST_ONLY_RUNTIME_RESET = '1';
  canonicalEventLedger.resetSingletonForTests();
  const host = acquireAuthorityWriteHost({ dbPath, instanceId: 'round12-platform-core-test-host' });
  const broker = new SqliteConnectionBroker({ dbPath, authorityWriteHostCapability: host.capability });
  const store = broker.open();
  const coordinator = new AuthorityTransactionCoordinator({ store, eventBus: { publish() {} } });
  const coordinatorCapability = coordinator.repositoryCapability();
  const repository = createPlatformCoreRepository({ storeProvider: () => store, coordinatorCapability });
  const ledger = new canonicalEventLedger.CanonicalEventLedgerAuthority({ coordinator, store, compatibilityRepository: repository });
  canonicalEventLedger.configureSingleton(ledger);
  const accountStateProvider = () => [
    { id: 'wa-1', platform: 'whatsapp', state: 'connected', canSend: true, canReceive: true, credentialReady: true, capabilityAvailability: {} },
    { id: 'tg-1', platform: 'telegram', state: 'connected', canSend: true, canReceive: true, credentialReady: true, capabilityAvailability: {} }
  ];
  try {
    return callback({
      host, broker, store, coordinator, coordinatorCapability, repository, ledger,
      identity: new IdentityLinkAuthority({ repository }),
      events: new DomainEventLogService({ canonicalAuthority: ledger }),
      sendPolicy: new SendPolicyAuthority({ repository, accountStateProvider })
    });
  } finally {
    try { canonicalEventLedger.resetSingletonForTests(); } catch (_) {}
    try { broker.checkpointAndClose(); } catch (_) {}
    try { host.release(); } catch (_) {}
    if (previousReset == null) delete process.env.YANCE_TEST_ONLY_RUNTIME_RESET;
    else process.env.YANCE_TEST_ONLY_RUNTIME_RESET = previousReset;
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}

test('identity observations are account-scoped and never merge by display name', () => {
  withAuthorities(({ identity, store }) => {
    const first = identity.observe({ platform: 'facebook', sourceAccountId: 'page-1', externalId: 'psid-1', displayName: 'Alex' });
    const second = identity.observe({ platform: 'facebook', sourceAccountId: 'page-2', externalId: 'psid-1', displayName: 'Alex' });
    assert.notEqual(first.person.personId, second.person.personId);
    assert.equal(first.link.sourceAccountId, 'page-1');
    assert.equal(second.link.sourceAccountId, 'page-2');
    assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM persons').get().count, 2);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM identity_links').get().count, 2);
  });
});

test('identity merge requires evidence and can be completely rolled back', () => {
  withAuthorities(({ identity }) => {
    const a = identity.observe({ platform: 'whatsapp', sourceAccountId: 'wa-1', externalId: '49170@s.whatsapp.net', displayName: 'Alex' });
    const b = identity.observe({ platform: 'telegram', sourceAccountId: 'tg-1', externalId: '9911', displayName: 'Alex' });
    identity.verify(a.link.identityLinkId, { evidenceRefs: ['wa-proof'], verificationMethod: 'phone-confirmed', actor: 'owner', reason: '电话号码人工确认' });
    identity.verify(b.link.identityLinkId, { evidenceRefs: ['tg-proof'], verificationMethod: 'manual-confirmation', actor: 'owner', reason: '用户人工确认' });
    assert.throws(() => identity.merge({ sourcePersonId: b.person.personId, targetPersonId: a.person.personId }), error => error.code === 'IDENTITY_MERGE_EVIDENCE_REQUIRED');
    const merged = identity.merge({ sourcePersonId: b.person.personId, targetPersonId: a.person.personId, evidenceRefs: ['cross-platform-proof'], reason: 'User confirmed same person', actor: 'owner' });
    assert.equal(merged.movedLinks.length, 1);
    assert.equal(identity.resolve({ platform: 'telegram', sourceAccountId: 'tg-1', externalId: '9911' }).person.personId, a.person.personId);
    const rolledBack = identity.rollbackMerge(merged.auditId, { reason: 'Correction', actor: 'owner' });
    assert.equal(rolledBack.restoredLinks.length, 1);
    assert.equal(identity.resolve({ platform: 'telegram', sourceAccountId: 'tg-1', externalId: '9911' }).person.personId, b.person.personId);
  });
});

test('domain events are idempotent and redact credentials, QR and binary payloads', () => {
  withAuthorities(({ events, store }) => {
    const input = {
      platform: 'facebook', sourceAccountId: 'page-1', externalEventId: 'evt-1', eventType: 'message.received',
      payload: { message: 'Hallo', accessToken: 'secret', nested: { password: 'pw', qrCode: 'qr' }, mediaBuffer: Buffer.from('binary') }
    };
    const first = events.append(input);
    const second = events.append(input);
    assert.equal(second.event.occurredAt, first.event.occurredAt);
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(first.event.eventId, second.event.eventId);
    assert.equal(first.event.payload.accessToken, '[REDACTED]');
    assert.equal(first.event.payload.nested.password, '[REDACTED]');
    assert.equal(first.event.payload.mediaBuffer.redacted, true);
    const raw = store.db.prepare('SELECT canonical_json FROM authority_payload_store WHERE payload_id=?').get(first.event.payloadId).canonical_json;
    assert.equal(raw.includes('secret'), false);
    assert.equal(raw.includes('"pw"'), false);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM canonical_event_headers').get().count, 1);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM domain_events').get().count, 0);
  });
});

test('shadow projection records match and mismatch without replacing production projection', () => {
  withAuthorities(({ events }) => {
    const created = events.append({ platform: 'telegram', sourceAccountId: 'tg-1', externalEventId: 'u1', eventType: 'message.received', payload: { text: 'Hallo' } });
    const match = events.recordShadowProjection({ eventId: created.event.eventId, projectorName: 'messages', projectorVersion: 'v1', expectedProjection: { text: 'Hallo' }, actualProjection: { text: 'Hallo' } });
    assert.equal(match.matches, true);
    const mismatch = events.recordShadowProjection({ eventId: created.event.eventId, projectorName: 'messages', projectorVersion: 'v2', expectedProjection: { text: 'Hallo' }, actualProjection: { text: 'Hello' } });
    assert.equal(mismatch.matches, false);
    assert.equal(mismatch.receipt.projection_status, 'shadow-mismatch');
  });
});

test('send policy binds current Model Brain execution evidence without minting a route receipt', () => {
  withAuthorities(({ sendPolicy, store }) => {
    const evidence = validModelBrainExecutionEvidence();
    const frozen = sendPolicy.freezeOutboxCommand({
      platform: 'whatsapp', accountId: 'wa-1', sessionKey: 'wa-1:peer', chatJid: 'peer', operation: 'text',
      messageType: 'text', finalText: 'Bis morgen!', targetLanguage: 'de', idempotencyKey: 'send-1', outboxId: 'outbox-1',
      replySource: 'local_model', replyTask: 'quick_reply', modelId: 'round12-quality-model',
      modelBrainExecutionEvidence: evidence, emergencyMode: false, learningEligible: true
    });
    assert.equal(frozen.command.contentFrozen, true);
    assert.equal(frozen.command.retranslateOnRetry, false);
    assert.equal(frozen.command.learningEligible, true);
    assert.equal(frozen.command.qualityTier, 'model-brain');
    assert.equal(frozen.command.modelBrainEvidenceValid, true);
    assert.match(frozen.command.modelBrainEvidenceSha256, /^[a-f0-9]{64}$/u);
    assert.deepEqual(frozen.command.modelBrainExecutionEvidence, evidence);
    assert.deepEqual(frozen.command.qualityRouteReceipt, {});
    assert.equal(frozen.queueMetadata.modelBrainEvidenceValid, true);
    assert.deepEqual(frozen.queueMetadata.modelBrainExecutionEvidence, evidence);
    assert.equal(frozen.queueMetadata.sendPolicy.policyVersion, 'round12-send-policy-v1');
    assert.doesNotThrow(() => sendPolicy.verifyFrozenCommand(frozen.command));
    assert.throws(() => sendPolicy.verifyFrozenCommand({ ...frozen.command, finalText: 'Mutated' }), error => error.code === 'OUTBOX_COMMAND_CONTENT_MUTATED');
    assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM platform_capability_observations').get().count, 1);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM platform_health_states').get().count, 1);
  });
});

test('model-generated learning fails closed when Model Brain evidence is missing or mismatched', () => {
  withAuthorities(({ sendPolicy }) => {
    const missing = sendPolicy.freezeOutboxCommand({
      platform: 'whatsapp', accountId: 'wa-1', sessionKey: 'wa-1:peer', chatJid: 'peer', operation: 'text',
      finalText: 'Hallo', idempotencyKey: 'missing-model-evidence', replySource: 'local_model', replyTask: 'quick_reply',
      modelId: 'round12-quality-model', learningEligible: true
    });
    assert.equal(missing.command.learningEligible, false);
    assert.equal(missing.command.modelBrainEvidenceValid, false);
    assert.equal(missing.command.modelBrainEvidenceReasonCode, 'MODEL_BRAIN_EXECUTION_EVIDENCE_REQUIRED');
    const mismatch = sendPolicy.freezeOutboxCommand({
      platform: 'whatsapp', accountId: 'wa-1', sessionKey: 'wa-1:peer', chatJid: 'peer', operation: 'text',
      finalText: 'Hallo', idempotencyKey: 'mismatch-model-evidence', replySource: 'local_model', replyTask: 'quick_reply',
      modelId: 'round12-quality-model', modelBrainExecutionEvidence: validModelBrainExecutionEvidence({ selectedModel: 'other-model' }), learningEligible: true
    });
    assert.equal(mismatch.command.learningEligible, false);
    assert.equal(mismatch.command.modelBrainEvidenceValid, false);
    assert.equal(mismatch.command.modelBrainEvidenceReasonCode, 'MODEL_BRAIN_EXECUTION_EVIDENCE_MODEL_MISMATCH');
  });
});

test('manual send remains sendable without fabricated Model Brain evidence', () => {
  withAuthorities(({ sendPolicy }) => {
    const frozen = sendPolicy.freezeOutboxCommand({
      platform: 'telegram', accountId: 'tg-1', sessionKey: 'tg-1:peer', chatJid: 'peer', operation: 'text',
      messageType: 'text', finalText: 'Hallo', targetLanguage: 'de', idempotencyKey: 'manual-1',
      replySource: 'manual', learningEligible: true
    });
    assert.equal(frozen.command.learningEligible, false);
    assert.equal(frozen.command.modelBrainEvidenceValid, false);
    assert.equal(frozen.command.modelBrainEvidenceReasonCode, 'MODEL_BRAIN_EVIDENCE_NOT_REQUIRED');
    assert.deepEqual(frozen.command.modelBrainExecutionEvidence, {});
  });
});

test('emergency send commands are excluded from long-term learning', () => {
  withAuthorities(({ sendPolicy }) => {
    const frozen = sendPolicy.freezeOutboxCommand({
      platform: 'telegram', accountId: 'tg-1', sessionKey: 'tg-1:peer', chatJid: 'peer', operation: 'text',
      messageType: 'text', finalText: 'Hallo', targetLanguage: 'de', idempotencyKey: 'emergency-1',
      replySource: 'local_model', replyTask: 'quick_reply', modelId: 'round12-quality-model',
      modelBrainExecutionEvidence: validModelBrainExecutionEvidence(), emergencyMode: true, learningEligible: true
    });
    assert.equal(frozen.command.emergencyMode, true);
    assert.equal(frozen.command.learningEligible, false);
  });
});

test('send policy rejects an unconfigured account before a doomed command enters the queue', () => {
  withAuthorities(({ sendPolicy, store }) => {
    assert.throws(() => sendPolicy.freezeOutboxCommand({
      platform: 'facebook', accountId: 'missing-page', sessionKey: 'missing-page:peer', chatJid: 'facebook:peer',
      operation: 'text', finalText: 'Hello', idempotencyKey: 'missing-account-send'
    }), error => error.code === 'ACCOUNT_NOT_CONFIGURED');
    assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM platform_capability_observations').get().count, 0);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM platform_health_states').get().count, 0);
  });
});

test('default send policy reads the live AccountManager projection rather than stale account rows', t => {
  withAuthorities(({ repository }) => {
    const accountManager = require('../services/accountManager');
    t.mock.method(accountManager, 'list', () => ({
      accounts: [{
        id: 'fb-live', platform: 'facebook', state: 'connected', canAttemptSend: true, sendVerified: false, canSend: false, canReceive: true,
        credentialReady: true, subscriptionReady: true, relayState: 'connected', historySyncAvailable: true,
        reconciliationActive: true, reconciliationLastAt: '2026-07-26T13:00:00.000Z', capabilityAvailability: {}
      }]
    }));
    const sendPolicy = new SendPolicyAuthority({ repository });
    const frozen = sendPolicy.freezeOutboxCommand({
      platform: 'facebook', accountId: 'fb-live', sessionKey: 'fb-live:peer', chatJid: 'facebook:peer',
      operation: 'text', finalText: 'Hello', idempotencyKey: 'live-account-send', replySource: 'manual'
    });
    assert.equal(frozen.capabilitySnapshot.observation.availability, 'degraded');
    assert.equal(frozen.capabilitySnapshot.observation.enabled, true);
    assert.equal(frozen.capabilitySnapshot.observation.reasonCode, 'REAL_PLATFORM_ACK_REQUIRED');
    assert.equal(frozen.capabilitySnapshot.observation.evidence.compatibilityProjection, false);
  });
});
