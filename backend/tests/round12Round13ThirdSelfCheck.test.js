'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { R32SqliteStore } = require('../lib/r32SqliteStore');
const { createPlatformCoreRepository } = require('../repositories/platformCoreRepository');
const capability = require('../services/platformCapabilityAuthority');
const aiQuality = require('../services/aiQualityRouteAuthority');
const { DomainEventLogService } = require('../services/domainEventLogService');
const { SendPolicyAuthority } = require('../services/sendPolicyAuthority');
const { AIDirectorStrategyAuthority } = require('../services/aiDirectorStrategyAuthority');
const { IdentityLinkAuthority } = require('../services/identityLinkAuthority');
const { LearningPreferenceAuthority, sanitizeLearningObject } = require('../services/learningPreferenceAuthority');
const { retryDecision, retryClassForCode } = require('../services/sendQueueService');
const { ExternalIdentityAuthority } = require('../services/externalIdentityAuthority');
const { OutboxRouteAuthority } = require('../services/outboxRouteAuthority');
const outboundCommandRepository = require('../repositories/outboundCommandRepository');

function enqueueVersioned(store, input = {}) {
  const conversation = store.db.prepare('SELECT platform,payload_json FROM r32_conversations WHERE session_key=?').get(input.sessionKey);
  let payload = {};
  try { payload = JSON.parse(String(conversation?.payload_json || '{}')); } catch (_) {}
  const routeAuthority = new OutboxRouteAuthority({
    storeProvider: () => store,
    externalIdentityAuthority: new ExternalIdentityAuthority({ storeProvider: () => store })
  });
  return outboundCommandRepository.createAtomic({
    store, outboxRouteAuthority: routeAuthority,
    route: {
      conversationId: input.sessionKey, accountId: input.accountId,
      platform: String(conversation?.platform || input.payload?.platform || 'whatsapp'),
      routeTarget: String(payload.chatJid || payload.chat_jid || payload.externalId || payload.external_id || 'peer'),
      capabilitySnapshotId: input.capabilitySnapshotId || ''
    },
    queue: input
  }).queue;
}

function highQualityModel(id = 'quality-model') {
  return {
    id, name: id, provider: 'openrouter', qualification: 'verified', available: true,
    allowedTasks: ['quick_reply', 'deep_reply', 'director', 'learning_synthesis', 'understanding', 'relationship'],
    lastQualificationTest: { scores: { persona: { pass: true }, hallucination: { pass: true }, json: { pass: true } } },
    lastReplyBrainBenchmark: {
      authority: 'YanceReplyBrainBenchmark', pass: true, status: 'REPLY_BRAIN_QUALIFIED', completed: true, score: 92,
      scenarios: [
        { id: 'german_whatsapp', pass: true, score: 19 },
        { id: 'english_whatsapp', pass: true, score: 19 },
        { id: 'persona_boundary', pass: true, score: 24 },
        { id: 'director_schema', pass: true, score: 19 },
        { id: 'latency', pass: true, score: 11 }
      ]
    }
  };
}
function validRouteReceipt(task = 'quick_reply') {
  return aiQuality.routeReceipt({ task, selectedModel: highQualityModel(`${task}-model`), routePlan: { state: 'ready', violations: [] } });
}
function withRuntime(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-r12-r13-third-check-'));
  const store = new R32SqliteStore({ dbPath: path.join(root, 'database', 'yance.db') });
  const repository = createPlatformCoreRepository({ storeProvider: () => store });
  const accountState = {
    accounts: [
      { id: 'wa-1', platform: 'whatsapp', state: 'connected', canAttemptSend: true, sendVerified: true, canSend: true, canReceive: true, credentialReady: true, capabilityAvailability: {} },
      { id: 'tg-1', platform: 'telegram', state: 'connected', canAttemptSend: true, sendVerified: true, canSend: true, canReceive: true, credentialReady: true, capabilityAvailability: {} }
    ]
  };
  const accountStateProvider = () => accountState.accounts;
  for (const account of accountState.accounts) {
    store.upsertAccount({ ...account, accountId: account.id, adapterAccountId: account.id });
    store.upsertConversation({
      sessionKey: `${account.id}:peer`, accountId: account.id, platform: account.platform,
      title: 'peer', routeState: 'bound', chatJid: 'peer', externalId: 'peer'
    });
  }
  try {
    return callback({
      root, store, repository, accountState,
      events: new DomainEventLogService({ repository }),
      sendPolicy: new SendPolicyAuthority({ repository, accountStateProvider }),
      director: new AIDirectorStrategyAuthority({ repository }),
      identity: new IdentityLinkAuthority({ repository }),
      learning: new LearningPreferenceAuthority({ repository })
    });
  } finally {
    try { store.close(); } catch (_) {}
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}

async function withRuntimeAsync(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-r12-r13-third-check-async-'));
  const store = new R32SqliteStore({ dbPath: path.join(root, 'database', 'yance.db') });
  const repository = createPlatformCoreRepository({ storeProvider: () => store });
  const accountState = { accounts: [
    { id: 'wa-1', platform: 'whatsapp', state: 'connected', canAttemptSend: true, sendVerified: true, canSend: true, canReceive: true, credentialReady: true, capabilityAvailability: {} },
    { id: 'tg-1', platform: 'telegram', state: 'connected', canAttemptSend: true, sendVerified: true, canSend: true, canReceive: true, credentialReady: true, capabilityAvailability: {} }
  ] };
  try {
    return await callback({
      root, store, repository, accountState,
      events: new DomainEventLogService({ repository }),
      sendPolicy: new SendPolicyAuthority({ repository, accountStateProvider: () => accountState.accounts }),
      director: new AIDirectorStrategyAuthority({ repository }),
      identity: new IdentityLinkAuthority({ repository }),
      learning: new LearningPreferenceAuthority({ repository })
    });
  } finally {
    try { store.close(); } catch (_) {}
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}

function capabilityAccount(id, platform, state, extra = {}) {
  return { id, platform, state, canAttemptSend: state === 'connected', sendVerified: state === 'connected', canSend: state === 'connected', canReceive: state === 'connected', credentialReady: state === 'connected', capabilityAvailability: {}, ...extra };
}

test('capability aggregation degrades mixed scopes and keeps authentication actions available during onboarding', () => {
  assert.equal(capability.aggregateAvailability([{ availability: 'ready' }, { availability: 'blocked' }]), 'degraded');
  assert.equal(capability.aggregateAvailability([{ availability: 'blocked' }, { availability: 'blocked' }]), 'blocked');
  const state = { accounts: [
    capabilityAccount('tg-ready', 'telegram', 'connected'),
    capabilityAccount('tg-login', 'telegram', 'logged-out', { qrReady: false })
  ] };
  const projection = capability.evaluate(state, { platform: 'telegram' });
  assert.equal(projection.platforms.telegram.availability, 'degraded');
  const qr = capability.decision(state, { platform: 'telegram', accountId: 'tg-login', capabilityId: 'auth.qr' });
  const send = capability.decision(state, { platform: 'telegram', accountId: 'tg-login', capabilityId: 'message.text.send' });
  assert.equal(qr.availability, 'degraded');
  assert.equal(qr.enabled, true);
  assert.equal(qr.reasonCode, 'AUTHENTICATION_ACTION_AVAILABLE');
  assert.equal(send.availability, 'onboarding');
  assert.equal(send.enabled, false);
  assert.equal(send.reasonCode, 'ACCOUNT_LOGGED_OUT');
});

test('domain event ledger rejects collisions, redacts nested secrets, validates time, and quarantines failed replays', async () => {
  await withRuntimeAsync(async ({ events, repository }) => {
    const circular = { text: 'hello', header: 'Bearer abc.def.ghi', nested: { password: 'pw' } };
    circular.self = circular;
    const malicious = JSON.parse('{"safe":true,"__proto__":{"polluted":true}}');
    Object.defineProperty(malicious, 'accessor', { enumerable: true, get() { throw new Error('getter must not execute'); } });
    circular.malicious = malicious;
    circular.nonFinite = Number.NaN;
    const first = events.append({
      platform: 'facebook', sourceAccountId: 'page-1', externalEventId: 'event-1', eventType: 'message.received',
      eventId: 'explicit-event', occurredAt: '2026-07-26T00:00:00Z', receivedAt: '2026-07-26T00:00:01Z', payload: circular
    });
    assert.equal(first.event.payload.nested.password, '[REDACTED]');
    assert.match(first.event.payload.header, /\[REDACTED/);
    assert.equal(first.event.payload.self, '[REDACTED_CIRCULAR]');
    assert.equal(first.event.payload.malicious.accessor, '[REDACTED_ACCESSOR]');
    assert.equal(Object.prototype.hasOwnProperty.call(first.event.payload.malicious, '__proto__'), false);
    assert.equal(first.event.payload.nonFinite, '[REDACTED_NON_FINITE_NUMBER]');
    assert.equal({}.polluted, undefined);
    assert.equal(events.append({
      platform: 'facebook', sourceAccountId: 'page-1', externalEventId: 'event-1', eventType: 'message.received', payload: circular,
      occurredAt: '2026-07-26T00:00:00Z', receivedAt: '2026-07-26T00:00:01Z'
    }).created, false);
    assert.throws(() => events.append({
      platform: 'facebook', sourceAccountId: 'page-1', externalEventId: 'event-1', eventType: 'message.received', payload: { text: 'changed' }
    }), error => error.code === 'DOMAIN_EVENT_IDEMPOTENCY_CONFLICT');
    assert.throws(() => events.append({
      platform: 'facebook', sourceAccountId: 'page-1', externalEventId: 'event-2', eventId: 'explicit-event', eventType: 'message.received', payload: {}
    }), error => error.code === 'DOMAIN_EVENT_ID_CONFLICT');
    assert.throws(() => events.append({ platform: 'telegram', sourceAccountId: 'tg-1', eventType: 'message.received', payload: {} }), error => error.code === 'DOMAIN_EVENT_EXTERNAL_ID_OR_IDEMPOTENCY_REQUIRED');
    assert.throws(() => events.append({ platform: 'telegram', sourceAccountId: 'tg-1', externalEventId: 'bad-time', eventType: 'message.received', occurredAt: 'not-a-date', payload: {} }), error => error.code === 'DOMAIN_EVENT_TIMESTAMP_INVALID');
    assert.throws(() => events.append({ platform: 'telegram', sourceAccountId: 'tg-1', externalEventId: 'bad-schema', eventType: 'message.received', schemaVersion: 2, payload: {} }), error => error.code === 'DOMAIN_EVENT_SCHEMA_VERSION_UNSUPPORTED');
    assert.throws(() => events.append({ platform: 'telegram', sourceAccountId: 'tg-1', externalEventId: 'bad-retention-days', eventType: 'message.received', retentionDays: 1.5, payload: {} }), error => error.code === 'DOMAIN_EVENT_RETENTION_INVALID');
    assert.throws(() => events.append({ platform: 'telegram', sourceAccountId: 'tg-1', externalEventId: 'bad-retention-window', eventType: 'message.received', receivedAt: '2026-07-26T00:00:00Z', retentionUntil: '2026-07-25T00:00:00Z', payload: {} }), error => error.code === 'DOMAIN_EVENT_RETENTION_WINDOW_INVALID');
    assert.throws(() => events.append({
      platform: 'facebook', sourceAccountId: 'page-1', externalEventId: 'event-1', eventType: 'message.received',
      idempotencyKey: 'attacker-alternate-idempotency', occurredAt: '2026-07-26T00:00:00Z', receivedAt: '2026-07-26T00:00:01Z', payload: circular
    }), error => error.code === 'DOMAIN_EVENT_EXTERNAL_ID_CONFLICT');
    await assert.rejects(() => events.replay({
      eventId: first.event.eventId, projectorName: 'messages', projectorVersion: 'v1',
      projector: async () => { throw Object.assign(new Error('projection failed'), { code: 'PROJECTOR_BROKEN' }); }
    }), error => error.code === 'PROJECTOR_BROKEN' && error.receipt?.projection_status === 'failed');
    assert.equal(repository.getDomainEvent(first.event.eventId).replay_state, 'quarantined');
    let replayCalls = 0;
    await assert.rejects(() => events.replay({
      eventId: first.event.eventId, projectorName: 'messages', projectorVersion: 'v1',
      projector: async () => { replayCalls += 1; return { targetRefs: [] }; }
    }), error => error.code === 'DOMAIN_EVENT_QUARANTINED');
    assert.equal(replayCalls, 0);
    await assert.rejects(() => events.replay({
      eventId: first.event.eventId, projectorName: 'messages', projectorVersion: 'v1', allowQuarantined: true,
      projector: async () => ({ targetRefs: [] })
    }), error => error.code === 'DOMAIN_EVENT_REPLAY_OVERRIDE_AUDIT_REQUIRED');
    const recovered = await events.replay({
      eventId: first.event.eventId, projectorName: 'messages', projectorVersion: 'v1', allowQuarantined: true,
      actor: 'owner', reason: 'fixed projector', projector: async () => { replayCalls += 1; return { targetRefs: [{ table: 'r32_messages', id: 'm1' }] }; }
    });
    assert.equal(recovered.applied, true);
    assert.equal(recovered.receipt.attempt, 2);
    const idempotent = await events.replay({
      eventId: first.event.eventId, projectorName: 'messages', projectorVersion: 'v1',
      projector: async () => { replayCalls += 1; return { targetRefs: [] }; }
    });
    assert.equal(idempotent.idempotentReplay, true);
    assert.equal(replayCalls, 1);
    await assert.rejects(() => events.replay({
      eventId: first.event.eventId, projectorName: 'messages', projectorVersion: 'v1', forceReapply: true,
      projector: async () => ({ targetRefs: [] })
    }), error => error.code === 'DOMAIN_EVENT_REPLAY_OVERRIDE_AUDIT_REQUIRED');
    const expired = events.append({ platform: 'telegram', sourceAccountId: 'tg-1', externalEventId: 'expired-1', eventType: 'message.received', payload: {} });
    repository.store().db.prepare('UPDATE domain_events SET retention_until=? WHERE event_id=?').run('2020-01-01T00:00:00.000Z', expired.event.eventId);
    await assert.rejects(() => events.replay({ eventId: expired.event.eventId, projector: async () => ({}) }), error => error.code === 'DOMAIN_EVENT_EXPIRED');
    assert.equal(repository.getDomainEvent(expired.event.eventId).replay_state, 'expired');
  });
});

test('send policy binds an auditable outbox id, verifies AI receipts, policy integrity, capability snapshot and live account state', () => {
  withRuntime(({ sendPolicy, store, accountState }) => {
    const receipt = validRouteReceipt('quick_reply');
    const frozen = sendPolicy.freezeOutboxCommand({
      platform: 'whatsapp', accountId: 'wa-1', sessionKey: 'wa-1:peer', chatJid: 'peer', operation: 'text',
      commandId: 'queue-1', idempotencyKey: 'idem-1', finalText: 'Bis morgen!', targetLanguage: 'de', qualityRouteReceipt: receipt
    });
    assert.equal(frozen.command.outboxId, 'queue-1');
    assert.equal(frozen.command.qualityTier, 'high');
    assert.equal(sendPolicy.authorizeExecution(frozen.command).authorized, true);

    const tamperedReceipt = { ...receipt, selectedModelId: 'attacker' };
    assert.throws(() => sendPolicy.freezeOutboxCommand({
      platform: 'whatsapp', accountId: 'wa-1', sessionKey: 'wa-1:peer', chatJid: 'peer', operation: 'text',
      idempotencyKey: 'idem-invalid-receipt', finalText: 'Hallo', qualityRouteReceipt: tamperedReceipt
    }), error => error.code === 'AI_QUALITY_ROUTE_RECEIPT_INVALID');
    assert.throws(() => sendPolicy.freezeOutboxCommand({
      platform: 'whatsapp', accountId: 'wa-1', sessionKey: 'wa-1:peer', chatJid: 'peer', operation: 'text',
      idempotencyKey: 'idem-invalid-receipt-force', finalText: 'Hallo', qualityRouteReceipt: tamperedReceipt,
      allowUnverifiedRouteReceipt: true
    }), error => error.code === 'AI_QUALITY_ROUTE_RECEIPT_INVALID');
    const manual = sendPolicy.freezeOutboxCommand({
      platform: 'whatsapp', accountId: 'wa-1', sessionKey: 'wa-1:peer', chatJid: 'peer', operation: 'text',
      idempotencyKey: 'idem-manual', finalText: 'Manuell', qualityTier: 'high', learningEligible: true
    });
    assert.equal(manual.command.qualityTier, 'manual');
    assert.equal(manual.command.learningEligible, false);
    assert.throws(() => sendPolicy.freezeOutboxCommand({
      platform: 'whatsapp', accountId: 'wa-1', sessionKey: 'wa-1:peer', chatJid: 'peer', operation: 'reaction',
      idempotencyKey: 'idem-bad-reaction', actionPayload: { targetId: 'm1' }
    }), error => error.code === 'OUTBOX_COMMAND_REACTION_INVALID');
    assert.throws(() => sendPolicy.freezeOutboxCommand({
      platform: 'whatsapp', accountId: 'wa-1', sessionKey: 'wa-1:peer', chatJid: 'peer', operation: 'text',
      idempotencyKey: 'idem-bad-retry', finalText: 'Hallo', retryBudget: 1.5
    }), error => error.code === 'SEND_POLICY_RETRY_BUDGET_INVALID');

    accountState.accounts[0] = { ...accountState.accounts[0], state: 'logged-out', canAttemptSend: false, sendVerified: false, canSend: false, credentialReady: false };
    assert.throws(() => sendPolicy.authorizeExecution(frozen.command), error => error.code === 'ACCOUNT_LOGGED_OUT');
    accountState.accounts[0] = capabilityAccount('wa-1', 'whatsapp', 'connected');

    store.db.prepare("UPDATE platform_capability_observations SET expires_at=? WHERE observation_id=?").run('2020-01-01T00:00:00.000Z', frozen.command.capabilitySnapshotId);
    const refreshedExecution = sendPolicy.authorizeExecution(frozen.command);
    assert.equal(refreshedExecution.authorized, true);
    assert.equal(refreshedExecution.capabilitySnapshotExpired, true);
    assert.notEqual(refreshedExecution.executionCapabilitySnapshotId, frozen.command.capabilitySnapshotId);

    store.db.prepare("UPDATE send_policy_versions SET policy_json='{}' WHERE policy_version=?").run(frozen.command.sendPolicyVersion);
    assert.throws(() => sendPolicy.authorizeExecution(frozen.command), error => error.code === 'SEND_POLICY_VERSION_TAMPERED');
  });
});

test('send policy ignores caller-supplied account projections and legacy evidence bypasses', () => {
  withRuntime(({ sendPolicy }) => {
    assert.throws(() => sendPolicy.freezeOutboxCommand({
      platform: 'whatsapp', accountId: 'attacker-account', sessionKey: 'attacker-account:peer', chatJid: 'peer',
      operation: 'text', idempotencyKey: 'attacker-account-bypass', finalText: 'Hallo',
      account: { id: 'attacker-account', platform: 'whatsapp', state: 'connected', canSend: true, credentialReady: true },
      legacyRuntimeEvidence: { observed: true, state: 'connected', canSend: true, credentialReady: true }
    }), error => error.code === 'ACCOUNT_NOT_CONFIGURED');
  });
});

test('send execution rejects capability snapshot scope forgery even when the command envelope is rehashed', () => {
  withRuntime(({ sendPolicy, store }) => {
    const frozen = sendPolicy.freezeOutboxCommand({
      platform: 'telegram', accountId: 'tg-1', sessionKey: 'tg-1:peer', chatJid: 'peer', operation: 'text',
      commandId: 'queue-2', idempotencyKey: 'idem-2', finalText: 'Hallo'
    });
    store.db.prepare('UPDATE platform_capability_observations SET account_id=? WHERE observation_id=?').run('attacker', frozen.command.capabilitySnapshotId);
    assert.throws(() => sendPolicy.authorizeExecution(frozen.command), error => error.code === 'CAPABILITY_SNAPSHOT_SCOPE_MISMATCH');
  });
});


test('send queue idempotency key cannot silently reuse a different frozen payload', () => {
  withRuntime(({ store }) => {
    const base = {
      id: 'queue-idem-1', idempotencyKey: 'queue-idem-key', accountId: 'wa-1', sessionKey: 'wa-1:peer',
      messageType: 'text', payload: { operation: 'text', text: 'Hallo' }, outboxId: 'queue-idem-1',
      sendPolicy: { policyVersion: 'v1' }, capabilitySnapshotId: 'snapshot-1', qualityTier: 'high', emergencyMode: false
    };
    const first = enqueueVersioned(store, base);
    const replay = enqueueVersioned(store, base);
    assert.equal(first.id, replay.id);
    assert.throws(() => enqueueVersioned(store, { ...base, payload: { operation: 'text', text: 'Changed' } }), error => error.code === 'SEND_QUEUE_IDEMPOTENCY_CONFLICT');
    assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM r32_send_queue WHERE idempotency_key='queue-idem-key'").get().n, 1);
  });
});

test('candidate-only translation remains non-deliverable and route receipt tampering is rejected', () => {
  const translationPrimary = { id: 'translation-primary', provider: 'anthropic', modelSlug: 'anthropic/claude-sonnet', qualification: 'verified', available: true, allowedTasks: ['translation'], capabilityTags: ['multilingual_zh_bridge'] };
  const translationFallback = { ...translationPrimary, id: 'translation-fallback', provider: 'openai', modelSlug: 'openai/gpt-mini' };
  const translationPlan = aiQuality.routePlan({ task: 'translation', executionMode: 'candidate-only', route: { primary: translationPrimary.id, fallback: translationFallback.id, allowConditional: true }, models: [
    translationPrimary, translationFallback
  ] });
  assert.equal(translationPlan.state, 'conditional');
  assert.equal(translationPlan.deliveryEligible, false);
  assert.equal(translationPlan.formalReceiptEligible, false);
  assert.equal(translationPlan.humanReviewRequired, true);

  const receipt = validRouteReceipt('quick_reply');
  assert.throws(() => aiQuality.verifyRouteReceipt({ ...receipt, qualityTier: 'conditional' }, { task: 'quick_reply' }), error => error.code === 'AI_QUALITY_ROUTE_RECEIPT_INVALID');
});

test('director plan cannot be adjusted through a missing axis or after supersession', () => {
  withRuntime(({ director }) => {
    const strategy = director.createOrReuse({
      contactId: 'c1', conversationId: 'conv-1', personaVersionId: 1,
      strategy: { candidateBranches: ['natural_hook','playful_attraction','screen_and_advance'] }
    }).strategy;
    const first = director.createCandidatePlan({ strategyId: strategy.strategyId, candidateCount: 3, targetLanguage: 'de' }).plan;
    assert.throws(() => director.adjustCandidatePlan({ planId: first.planId, axisId: 'missing', adjustment: 'shorter' }), error => error.code === 'CANDIDATE_PLAN_AXIS_NOT_FOUND');
    const second = director.createCandidatePlan({ strategyId: strategy.strategyId, candidateCount: 2, branches: ['direct_advance','leave_aftertaste'], targetLanguage: 'de' }).plan;
    assert.notEqual(second.planId, first.planId);
    assert.throws(() => director.adjustCandidatePlan({ planId: first.planId, axisId: 'axis-1', adjustment: 'shorter' }), error => error.code === 'CANDIDATE_PLAN_NOT_ACTIVE');
  });
});

test('identity merge cannot bypass evidence with a force flag', () => {
  withRuntime(({ identity }) => {
    const source = identity.observe({ platform: 'telegram', sourceAccountId: 'tg-1', externalId: 'force-user-1' });
    const target = identity.observe({ platform: 'whatsapp', sourceAccountId: 'wa-1', externalId: 'force-user-2' });
    assert.throws(() => identity.merge({ sourcePersonId: source.person.personId, targetPersonId: target.person.personId, force: true }), error => error.code === 'IDENTITY_MERGE_EVIDENCE_REQUIRED');
  });
});

test('identity rollback refuses to overwrite a link changed after merge', () => {
  withRuntime(({ identity, repository }) => {
    const source = identity.observe({ platform: 'telegram', sourceAccountId: 'tg-1', externalId: 'user-1' });
    const target = identity.observe({ platform: 'whatsapp', sourceAccountId: 'wa-1', externalId: '49123@s.whatsapp.net' });
    const merged = identity.merge({ sourcePersonId: source.person.personId, targetPersonId: target.person.personId, evidenceRefs: ['owner-confirmation'], actor: 'owner', reason: '用户确认同一人' });
    const linkId = merged.movedLinks[0].identityLinkId;
    repository.updateIdentityLink(linkId, { linkStatus: 'disputed', updatedAt: new Date().toISOString() });
    assert.throws(() => identity.rollbackMerge(merged.auditId, { actor: 'owner', reason: '测试回滚冲突' }), error => error.code === 'IDENTITY_ROLLBACK_CONFLICT');
    assert.equal(repository.getIdentityLink(linkId).person_id, target.person.personId);
  });
});

test('learning signal idempotency conflicts are blocked and transactional profile rebuild leaves no partial signal', () => {
  withRuntime(({ learning, repository, store }) => {
    const receipt = validRouteReceipt('quick_reply');
    const base = {
      idempotencyKey: 'learning-idem-1', signalType: 'candidate_used', scopeType: 'conversation', scopeId: 'conv-1',
      conversationId: 'conv-1', contactId: 'c1', candidateId: 'cand-1', finalText: 'Bis morgen.', qualityRouteReceipt: receipt
    };
    assert.equal(learning.recordSignal(base).profileChanged, true);
    assert.throws(() => learning.recordSignal({ ...base, finalText: 'Changed text' }), error => error.code === 'LEARNING_SIGNAL_IDEMPOTENCY_CONFLICT');

    const original = learning.rebuildL1.bind(learning);
    learning.rebuildL1 = () => { throw Object.assign(new Error('forced'), { code: 'FORCED_PROFILE_FAILURE' }); };
    assert.throws(() => learning.recordSignal({ ...base, idempotencyKey: 'learning-idem-rollback', candidateId: 'cand-2' }), error => error.code === 'FORCED_PROFILE_FAILURE');
    learning.rebuildL1 = original;
    assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM learning_signal_ledger WHERE idempotency_key='learning-idem-rollback'").get().n, 0);
    assert.equal(repository.getLatestLearningProfile({ scopeType: 'conversation', scopeId: 'conv-1', learningLevel: 'L1', state: 'active' }).version, 1);
  });
});

test('learning promotion replay returns its original profile version after newer signals and rejects changed requests', () => {
  withRuntime(({ learning, repository, store }) => {
    const quickReceipt = validRouteReceipt('quick_reply');
    const synthesisReceipt = validRouteReceipt('learning_synthesis');
    const signalIds = [];
    for (let i = 0; i < 5; i += 1) {
      const result = learning.recordSignal({
        idempotencyKey: `l1-${i}`, signalType: 'candidate_used', scopeType: 'conversation', scopeId: 'conv-promo',
        conversationId: 'conv-promo', contactId: 'contact-promo', candidateId: `cand-${i}`, finalText: `Text ${i}`,
        qualityRouteReceipt: quickReceipt
      });
      signalIds.push(result.signal.signalId);
    }
    const firstRequest = {
      synthesisId: 'promotion-one', fromLevel: 'L1', toLevel: 'L2', sourceScopeType: 'conversation', sourceScopeId: 'conv-promo',
      targetScopeType: 'contact', targetScopeId: 'contact-promo', evidenceSignalIds: signalIds,
      preference: { defaultLength: 'short' }, confidence: 0.8, qualityRouteReceipt: synthesisReceipt
    };
    const first = learning.applySynthesis(firstRequest);
    assert.equal(first.profile.version, 1);

    const sixth = learning.recordSignal({
      idempotencyKey: 'l1-5', signalType: 'candidate_used', scopeType: 'conversation', scopeId: 'conv-promo',
      conversationId: 'conv-promo', contactId: 'contact-promo', candidateId: 'cand-5', finalText: 'Text 5', qualityRouteReceipt: quickReceipt
    });
    const second = learning.applySynthesis({ ...firstRequest, synthesisId: 'promotion-two', evidenceSignalIds: [...signalIds, sixth.signal.signalId], preference: { defaultLength: 'very-short' } });
    assert.equal(second.profile.version, 2);

    const replay = learning.applySynthesis(firstRequest);
    assert.equal(replay.idempotentReplay, true);
    assert.equal(replay.profile.version, 1);
    assert.deepEqual(replay.profile.preference, { defaultLength: 'short' });
    assert.throws(() => learning.applySynthesis({ ...firstRequest, preference: { defaultLength: 'long' } }), error => error.code === 'LEARNING_PROMOTION_IDEMPOTENCY_CONFLICT');
    assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM learning_promotion_audit WHERE decision='approved'").get().n, 2);
    assert.equal(repository.getLatestLearningProfile({ scopeType: 'contact', scopeId: 'contact-promo', learningLevel: 'L2', state: 'active' }).version, 2);
  });
});

test('learning rollback requires an exact non-forgotten target version', () => {
  withRuntime(({ learning, repository }) => {
    const timestamp = new Date().toISOString();
    repository.insertLearningProfile({ scopeType: 'contact', scopeId: 'rollback-target', learningLevel: 'L2', version: 1, preference: { tone: 'gentle' }, evidenceSignalIds: [], confidence: 0.8, state: 'candidate', createdAt: timestamp, activatedAt: '' });
    repository.activateLearningProfile({ scopeType: 'contact', scopeId: 'rollback-target', learningLevel: 'L2', version: 1, activatedAt: timestamp });
    repository.insertLearningProfile({ scopeType: 'contact', scopeId: 'rollback-target', learningLevel: 'L2', version: 2, preference: { tone: 'direct' }, evidenceSignalIds: [], confidence: 0.9, state: 'candidate', createdAt: timestamp, activatedAt: '' });
    repository.activateLearningProfile({ scopeType: 'contact', scopeId: 'rollback-target', learningLevel: 'L2', version: 2, activatedAt: timestamp });
    assert.throws(() => learning.rollbackProfile({ scopeType: 'contact', scopeId: 'rollback-target', learningLevel: 'L2', actor: 'selfcheck', reason: 'verify target required' }), error => error.code === 'LEARNING_ROLLBACK_TARGET_REQUIRED');
    assert.throws(() => learning.rollbackProfile({ scopeType: 'contact', scopeId: 'rollback-target', learningLevel: 'L2', targetVersion: 999, actor: 'selfcheck', reason: 'verify missing target' }), error => error.code === 'LEARNING_ROLLBACK_TARGET_NOT_FOUND');
    repository.updateLearningProfileState({ scopeType: 'contact', scopeId: 'rollback-target', learningLevel: 'L2', version: 1, state: 'forgotten', activatedAt: '' });
    assert.throws(() => learning.rollbackProfile({ scopeType: 'contact', scopeId: 'rollback-target', learningLevel: 'L2', targetVersion: 1, actor: 'selfcheck', reason: 'verify forgotten target' }), error => error.code === 'LEARNING_ROLLBACK_TARGET_FORGOTTEN');
    assert.equal(repository.getLatestLearningProfile({ scopeType: 'contact', scopeId: 'rollback-target', learningLevel: 'L2', state: 'active' }).version, 2);
  });
});

test('learning rollback and forget are transactional and auditable', () => {
  withRuntime(({ learning, repository, store }) => {
    const at = new Date().toISOString();
    repository.insertLearningProfile({ scopeType: 'contact', scopeId: 'c-audit', learningLevel: 'L2', version: 1, preference: { a: 1 }, evidenceSignalIds: ['s1'], confidence: 0.6, state: 'candidate', createdAt: at, activatedAt: '' });
    repository.activateLearningProfile({ scopeType: 'contact', scopeId: 'c-audit', learningLevel: 'L2', version: 1, activatedAt: at });
    repository.insertLearningProfile({ scopeType: 'contact', scopeId: 'c-audit', learningLevel: 'L2', version: 2, preference: { a: 2 }, evidenceSignalIds: ['s1','s2'], confidence: 0.7, state: 'candidate', createdAt: at, activatedAt: '' });
    repository.activateLearningProfile({ scopeType: 'contact', scopeId: 'c-audit', learningLevel: 'L2', version: 2, activatedAt: at });
    const rollback = learning.rollbackProfile({ scopeType: 'contact', scopeId: 'c-audit', learningLevel: 'L2', targetVersion: 1, actor: 'owner', reason: 'owner correction' });
    assert.equal(rollback.restored.version, 1);
    assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM learning_promotion_audit WHERE decision='rolled-back'").get().n, 1);
    const forgotten = learning.forgetProfile({ scopeType: 'contact', scopeId: 'c-audit', learningLevel: 'L2', actor: 'owner', reason: 'owner forget' });
    assert.equal(forgotten.forgotten, true);
    assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM learning_promotion_audit WHERE decision='forgotten'").get().n, 1);
    assert.equal(repository.getLatestLearningProfile({ scopeType: 'contact', scopeId: 'c-audit', learningLevel: 'L2', state: 'active' }), null);
  });
});


test('learning payloads reject prototype pollution, cycles, non-JSON values and oversized structures before persistence', () => {
  const polluted = JSON.parse('{"safe":1,"__proto__":{"polluted":true}}');
  assert.throws(() => sanitizeLearningObject(polluted, 'preference'), error => error.code === 'LEARNING_OBJECT_KEY_FORBIDDEN');
  const cyclic = {}; cyclic.self = cyclic;
  assert.throws(() => sanitizeLearningObject(cyclic, 'metadata'), error => error.code === 'LEARNING_OBJECT_CYCLE');
  assert.throws(() => sanitizeLearningObject({ value: Number.POSITIVE_INFINITY }, 'metadata'), error => error.code === 'LEARNING_OBJECT_NUMBER_INVALID');
  assert.throws(() => sanitizeLearningObject({ value: () => true }, 'metadata'), error => error.code === 'LEARNING_OBJECT_TYPE_INVALID');
  const accessor = {};
  Object.defineProperty(accessor, 'value', { enumerable: true, get() { throw new Error('getter must not execute'); } });
  assert.throws(() => sanitizeLearningObject(accessor, 'metadata'), error => error.code === 'LEARNING_OBJECT_ACCESSOR_FORBIDDEN');
  assert.throws(() => sanitizeLearningObject({ blob: 'x'.repeat(140 * 1024) }, 'metadata'), error => error.code === 'LEARNING_OBJECT_TOO_LARGE');
  assert.equal({}.polluted, undefined);
  withRuntime(({ learning, store }) => {
    assert.throws(() => learning.recordSignal({
      signalType: 'candidate_used', scopeType: 'conversation', scopeId: 'conv-malicious',
      idempotencyKey: 'learning-malicious', metadata: polluted, qualityRouteReceipt: validRouteReceipt('quick_reply')
    }), error => error.code === 'LEARNING_OBJECT_KEY_FORBIDDEN');
    assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM learning_signal_ledger WHERE idempotency_key='learning-malicious'").get().n, 0);
  });
});

test('identity observation cannot attach a new platform identity to an existing Person without explicit audited evidence', () => {
  withRuntime(({ identity, repository }) => {
    const first = identity.observe({
      workspaceId: 'default', platform: 'whatsapp', sourceAccountId: 'wa-1', externalId: '111', evidenceRefs: ['message-1']
    });
    assert.throws(() => identity.observe({
      workspaceId: 'default', platform: 'telegram', sourceAccountId: 'tg-1', externalId: '222', personId: first.person.personId
    }), error => error.code === 'IDENTITY_EXISTING_PERSON_LINK_AUDIT_REQUIRED');
    const linked = identity.observe({
      workspaceId: 'default', platform: 'telegram', sourceAccountId: 'tg-1', externalId: '222', personId: first.person.personId,
      linkExistingPerson: true, evidenceRefs: ['manual-confirmation-1'], actor: 'owner', reason: '用户确认是同一人'
    });
    assert.equal(linked.person.personId, first.person.personId);
    assert.equal(repository.listIdentityLinks(first.person.personId, { includeDetached: true }).length, 2);
    assert.throws(() => identity.observe({
      workspaceId: 'default', platform: 'facebook', sourceAccountId: 'page-1', externalId: '333', personId: 'missing-person',
      linkExistingPerson: true, evidenceRefs: ['x'], actor: 'owner', reason: 'x'
    }), error => error.code === 'IDENTITY_SUPPLIED_PERSON_NOT_FOUND');
  });
});

test('send retry decisions honor the persisted frozen policy rather than the process-wide retry ceiling', () => {
  const policy = { policyVersion: 'round12-send-policy-v1', retryBudget: 1, retryable: ['429', 'NETWORK', 'TIMEOUT', 'NOT_CONNECTED'] };
  const row = {
    attempts: 1,
    send_policy_json: JSON.stringify(policy),
    payload: { outboxCommand: { sendPolicySha256: require('../services/domainEventLogService').sha256(policy) } }
  };
  assert.equal(retryClassForCode('WHATSAPP_NOT_CONNECTED'), 'NOT_CONNECTED');
  assert.equal(retryClassForCode('ECONNRESET'), 'NETWORK');
  assert.equal(retryDecision(row, 'ECONNRESET', 8).retry, true);
  const exhausted = retryDecision({ ...row, attempts: 2 }, 'ECONNRESET', 8);
  assert.equal(exhausted.retry, false);
  assert.equal(exhausted.reasonCode, 'FROZEN_RETRY_BUDGET_EXHAUSTED');
  const forbidden = retryDecision(row, 'SCHEMA_BROKEN', 8);
  assert.equal(forbidden.retry, false);
  assert.equal(forbidden.reasonCode, 'ERROR_NOT_RETRYABLE_BY_FROZEN_POLICY');
  const malformed = retryDecision({ attempts: 1, send_policy_json: '{}' }, 'TIMEOUT', 8);
  assert.equal(malformed.retry, false);
  assert.equal(malformed.reasonCode, 'SEND_POLICY_PERSISTED_INVALID');
});

test('legacy queue freezing mutates the claimed row so a first-send failure still uses the persisted policy', async () => {
  const queueRepository = require('../repositories/sendQueueRepository');
  const adapterRegistry = require('../services/platformAdapterPorts').singleton;
  const { SendQueueService } = require('../services/sendQueueService');
  const originalPersist = queueRepository.persistOutboxCommand;
  const originalExecute = adapterRegistry.executeEgress;
  const policy = { policyVersion: 'round12-send-policy-v1', retryBudget: 1, retryable: ['NETWORK'] };
  const command = {
    commandType: 'OutboxCommand', commandId: 'legacy-queue-1', outboxId: 'legacy-queue-1', idempotencyKey: 'legacy-idem',
    platform: 'telegram', accountId: 'tg-1', sessionKey: 'tg-1:peer', conversationTarget: 'peer', operation: 'text',
    messageType: 'text', finalText: 'Hallo', finalTextSha256: require('../services/domainEventLogService').sha256('Hallo'),
    sendPolicyVersion: policy.policyVersion, sendPolicySha256: require('../services/domainEventLogService').sha256(policy),
    capabilitySnapshotId: 'snapshot-1', qualityTier: 'manual', emergencyMode: false, learningEligible: false,
    contentFrozen: true, retranslateOnRetry: false
  };
  command.commandSha256 = require('../services/domainEventLogService').sha256(command);
  const fakeAuthority = {
    freezeOutboxCommand: () => ({ command, queueMetadata: { outboxId: command.outboxId, sendPolicy: policy, capabilitySnapshotId: 'snapshot-1', qualityTier: 'manual', emergencyMode: false } }),
    verifyFrozenCommand: () => ({ ok: true })
  };
  const row = {
    id: 'legacy-queue-1', state: 'sending', attempts: 1, idempotency_key: 'legacy-idem', account_id: 'tg-1', session_key: 'tg-1:peer',
    message_type: 'text', payload: { platform: 'telegram', operation: 'text', chatJid: 'peer', text: 'Hallo' }, payload_json: '{}', send_policy_json: '{}'
  };
  try {
    queueRepository.persistOutboxCommand = () => ({ ...row, payload: { ...row.payload, outboxCommand: command }, payload_json: JSON.stringify({ ...row.payload, outboxCommand: command }), send_policy_json: JSON.stringify(policy) });
    adapterRegistry.executeEgress = async () => { throw Object.assign(new Error('network down'), { code: 'NETWORK' }); };
    const service = new SendQueueService({ sendPolicyAuthority: fakeAuthority });
    await assert.rejects(() => service.dispatch(row), error => error.code === 'NETWORK');
    assert.equal(JSON.parse(row.send_policy_json).retryBudget, 1);
    assert.equal(row.payload.outboxCommand.sendPolicySha256, command.sendPolicySha256);
    assert.equal(retryDecision(row, 'NETWORK', 8).retry, true);
  } finally {
    queueRepository.persistOutboxCommand = originalPersist;
    adapterRegistry.executeEgress = originalExecute;
  }
});

test('domain event identifiers and post-redaction payload size are bounded before persistence', () => {
  withRuntime(({ events, store }) => {
    const base = {
      platform: 'telegram', sourceAccountId: 'tg-1', eventType: 'message.received',
      externalEventId: 'evt-bounds', payload: { text: 'hello' }
    };
    assert.throws(() => events.append({ ...base, sourceAccountId: 'x'.repeat(513) }), error => error.code === 'DOMAIN_EVENT_IDENTIFIER_TOO_LONG');
    assert.throws(() => events.append({ ...base, eventType: 'message\nreceived' }), error => error.code === 'DOMAIN_EVENT_IDENTIFIER_INVALID');
    assert.throws(() => events.append({ ...base, platform: 'telegram/../../bad' }), error => error.code === 'DOMAIN_EVENT_IDENTIFIER_INVALID');
    const payload = {};
    for (let index = 0; index < 36; index += 1) payload[`segment_${index}`] = 'x'.repeat(60 * 1024);
    assert.throws(() => events.append({ ...base, externalEventId: 'evt-too-large', payload }), error => error.code === 'DOMAIN_EVENT_PAYLOAD_TOO_LARGE');
    assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM domain_events WHERE external_event_id='evt-too-large'").get().n, 0);
  });
});

test('detached identity links cannot be silently overwritten by a stale merge rollback plan', () => {
  withRuntime(({ identity, repository }) => {
    const source = identity.observe({ workspaceId: 'default', platform: 'whatsapp', sourceAccountId: 'wa-1', externalId: 'detached-source', evidenceRefs: ['m-source'] });
    identity.detach(source.link.identityLinkId, { actor: 'owner', reason: 'temporary detach', evidenceRefs: ['manual-detach'] });
    const target = identity.observe({ workspaceId: 'default', platform: 'telegram', sourceAccountId: 'tg-1', externalId: 'detached-target', evidenceRefs: ['m-target'] });
    const merged = identity.merge({ sourcePersonId: source.person.personId, targetPersonId: target.person.personId, evidenceRefs: ['manual-confirmation'], actor: 'owner', reason: 'confirmed same person' });
    repository.updateIdentityLink(source.link.identityLinkId, { linkStatus: 'observed', updatedAt: new Date().toISOString() });
    assert.throws(() => identity.rollbackMerge(merged.auditId, { actor: 'owner', reason: 'stale rollback attempt' }), error => error.code === 'IDENTITY_ROLLBACK_CONFLICT');
    assert.equal(repository.getIdentityLink(source.link.identityLinkId).link_status, 'observed');
  });
});

test('learning synthesis idempotency binds audit actor, reason, source versions and aggregation scope', () => {
  withRuntime(({ learning }) => {
    const quickReceipt = validRouteReceipt('quick_reply');
    const synthesisReceipt = validRouteReceipt('learning_synthesis');
    const signalIds = [];
    for (let index = 0; index < 5; index += 1) {
      const recorded = learning.recordSignal({
        idempotencyKey: `fingerprint-signal-${index}`, signalType: 'candidate_used', scopeType: 'conversation', scopeId: 'conv-fingerprint',
        conversationId: 'conv-fingerprint', contactId: 'contact-fingerprint', candidateId: `cand-${index}`, finalText: `Text ${index}`, qualityRouteReceipt: quickReceipt
      });
      signalIds.push(recorded.signal.signalId);
    }
    const request = {
      synthesisId: 'fingerprint-promotion', fromLevel: 'L1', toLevel: 'L2', sourceScopeType: 'conversation', sourceScopeId: 'conv-fingerprint',
      targetScopeType: 'contact', targetScopeId: 'contact-fingerprint', evidenceSignalIds: signalIds,
      preference: { defaultLength: 'short' }, confidence: 0.8, qualityRouteReceipt: synthesisReceipt,
      sourceVersions: [{ version: 1 }], actor: 'brain', reason: 'five consistent choices', aggregationScopeId: 'owner-a', contactId: 'contact-fingerprint'
    };
    const first = learning.applySynthesis(request);
    assert.equal(first.profile.version, 1);
    assert.equal(learning.applySynthesis(request).idempotentReplay, true);
    for (const changed of [
      { sourceVersions: [{ version: 2 }] },
      { actor: 'other-brain' },
      { reason: 'different reason' },
      { aggregationScopeId: 'owner-b' },
      { contactId: 'different-contact' }
    ]) {
      assert.throws(() => learning.applySynthesis({ ...request, ...changed }), error => error.code === 'LEARNING_PROMOTION_IDEMPOTENCY_CONFLICT');
    }
  });
});

test('permanent learning forget marks every version forgotten and blocks later rollback', () => {
  withRuntime(({ learning, repository }) => {
    const at = new Date().toISOString();
    for (const version of [1, 2, 3]) {
      repository.insertLearningProfile({ scopeType: 'contact', scopeId: 'forget-all', learningLevel: 'L2', version, preference: { version }, evidenceSignalIds: [], confidence: 0.8, state: 'candidate', createdAt: at, activatedAt: '' });
      repository.activateLearningProfile({ scopeType: 'contact', scopeId: 'forget-all', learningLevel: 'L2', version, activatedAt: at });
    }
    const forgotten = learning.forgetProfile({ scopeType: 'contact', scopeId: 'forget-all', learningLevel: 'L2', actor: 'owner', reason: 'privacy deletion' });
    assert.deepEqual(forgotten.forgottenVersions, [1, 2, 3]);
    const profiles = repository.listLearningProfiles({ scopeType: 'contact', scopeId: 'forget-all', learningLevel: 'L2' });
    assert.equal(profiles.every(profile => profile.state === 'forgotten'), true);
    assert.throws(() => learning.rollbackProfile({ scopeType: 'contact', scopeId: 'forget-all', learningLevel: 'L2', targetVersion: 1, actor: 'owner', reason: 'must stay forgotten' }), error => error.code === 'LEARNING_ROLLBACK_TARGET_NOT_FOUND');
  });
});

test('signed AI route receipts permit visible emergency sending but never long-term learning', () => {
  withRuntime(({ sendPolicy }) => {
    const emergencyReceipt = aiQuality.routeReceipt({
      task: 'quick_reply', selectedModel: highQualityModel('emergency-social-model'), routePlan: { state: 'emergency-only', violations: ['primary-unavailable'] }, emergencyMode: true
    });
    const frozen = sendPolicy.freezeOutboxCommand({
      platform: 'whatsapp', accountId: 'wa-1', sessionKey: 'wa-1:peer', chatJid: 'peer', operation: 'text',
      idempotencyKey: 'emergency-send', finalText: 'Hallo', qualityRouteReceipt: emergencyReceipt
    });
    assert.equal(frozen.command.emergencyMode, true);
    assert.equal(frozen.command.learningEligible, false);
    assert.equal(frozen.command.qualityTier, 'emergency');
    const forged = { ...emergencyReceipt, selectedModelId: 'forged-model' };
    const { receiptHash: _oldHash, receiptSignature: _oldSignature, ...payload } = forged;
    forged.receiptHash = require('node:crypto').createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    assert.throws(() => sendPolicy.freezeOutboxCommand({
      platform: 'whatsapp', accountId: 'wa-1', sessionKey: 'wa-1:peer', chatJid: 'peer', operation: 'text',
      idempotencyKey: 'forged-emergency-send', finalText: 'Hallo', qualityRouteReceipt: forged
    }), error => error.code === 'AI_QUALITY_ROUTE_RECEIPT_SIGNATURE_INVALID');
  });
});

test('all platform send policies wait for reconnection without consuming frozen retry budget', async () => {
  withRuntime(async ({ sendPolicy }) => {
    for (const [platform, accountId] of [['whatsapp', 'wa-1'], ['telegram', 'tg-1']]) {
      const frozen = sendPolicy.freezeOutboxCommand({
        platform, accountId, sessionKey: `${accountId}:peer`, chatJid: 'peer', operation: 'text',
        idempotencyKey: `offline-policy-${platform}`, finalText: 'Hallo'
      });
      assert.equal(frozen.queueMetadata.sendPolicy.retryable.includes('NOT_CONNECTED'), true);
    }
  });
  const queueRepository = require('../repositories/sendQueueRepository');
  const { SendQueueService } = require('../services/sendQueueService');
  const originalDefer = queueRepository.defer;
  const originalMarkResult = queueRepository.markResult;
  let deferred = 0;
  let marked = 0;
  const policy = { policyVersion: 'round12-send-policy-v1', retryBudget: 1, retryable: ['NOT_CONNECTED'] };
  const row = {
    id: 'offline-row', state: 'sending', attempts: 1, idempotency_key: 'offline-idem', account_id: 'tg-1', session_key: 'tg-1:peer', message_type: 'reaction',
    send_policy_json: JSON.stringify(policy), payload: { platform: 'telegram', operation: 'reaction', chatJid: 'peer', outboxCommand: { sendPolicySha256: require('../services/domainEventLogService').sha256(policy) } }
  };
  try {
    queueRepository.defer = (_id, result) => { deferred += 1; return { ...row, state: 'retry', attempts: 0, next_attempt_at: result.nextAttemptAt, last_error: result.error }; };
    queueRepository.markResult = () => { marked += 1; return row; };
    const service = new SendQueueService();
    service.dispatch = async () => { throw Object.assign(new Error('logged out'), { code: 'ACCOUNT_LOGGED_OUT' }); };
    const output = await service.processRow(row);
    assert.equal(output.waitingForConnection, true);
    assert.equal(deferred, 1);
    assert.equal(marked, 0);
    assert.equal(output.queue.attempts, 0);
  } finally {
    queueRepository.defer = originalDefer;
    queueRepository.markResult = originalMarkResult;
  }
});
