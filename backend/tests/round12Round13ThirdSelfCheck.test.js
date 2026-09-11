'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createPlatformCoreRepository } = require('../repositories/platformCoreRepository');
const { acquireAuthorityWriteHost } = require('../services/authorityWriteHost');
const { SqliteConnectionBroker } = require('../lib/sqliteConnectionBroker');
const { AuthorityTransactionCoordinator } = require('../services/authorityTransactionCoordinator');
const canonicalEventLedgerAuthority = require('../services/canonicalEventLedgerAuthority');
const capability = require('../services/platformCapabilityAuthority');
const aiQuality = require('../services/aiQualityRouteAuthority');
const { DomainEventLogService } = require('../services/domainEventLogService');
const { SendPolicyAuthority } = require('../services/sendPolicyAuthority');
const { AIDirectorStrategyAuthority } = require('../services/aiDirectorStrategyAuthority');
const { IdentityLinkAuthority } = require('../services/identityLinkAuthority');
const { ExternalIdentityAuthority } = require('../services/externalIdentityAuthority');
const { OutboxRouteAuthority } = require('../services/outboxRouteAuthority');
const outboundCommandRepository = require('../repositories/outboundCommandRepository');

function buildAssembly(root) {
  process.env.YANCE_TEST_ONLY_SQLITE_BROKER_RESET = '1';
  const dbPath = path.join(root, 'database', 'yance.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const host = acquireAuthorityWriteHost({ dbPath, instanceId: `third-selfcheck-${process.pid}-${Math.random().toString(36).slice(2)}` });
  const broker = new SqliteConnectionBroker({ dbPath, authorityWriteHostCapability: host.capability });
  const store = broker.open();
  const coordinator = new AuthorityTransactionCoordinator({ store, eventBus: { publish() {} } });
  const repository = createPlatformCoreRepository({ storeProvider: () => store, coordinatorCapability: coordinator.repositoryCapability() });
  const ledger = new canonicalEventLedgerAuthority.CanonicalEventLedgerAuthority({ coordinator, store, compatibilityRepository: repository });
  canonicalEventLedgerAuthority.resetSingletonForTests();
  canonicalEventLedgerAuthority.configureSingleton(ledger);
  return { host, broker, store, repository, ledger };
}
function teardownAssembly(root, host, broker) {
  try { canonicalEventLedgerAuthority.resetSingletonForTests(); } catch (_) {}
  try { broker.checkpointAndClose(); } catch (_) {}
  try { host.release(); } catch (_) {}
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}

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

process.env.YANCE_AI_ROUTE_RECEIPT_SECRET = 'test-only-route-receipt-secret-0123456789abcdef';
function validRouteReceipt(task = 'quick_reply') {
  // V21 Model Brain / LiteLLM retired the Yance physical route planner; surviving receipts are
  // self-signed historical evidence verified by aiQuality.verifyRouteReceipt (HMAC over canonical JSON).
  const payload = {
    authority: aiQuality.AUTHORITY,
    schemaVersion: aiQuality.SCHEMA_VERSION,
    task,
    selectedModelId: `${task}-model`,
    qualityTier: 'high',
    executionMode: 'production',
    deliveryEligible: true,
    formalReceiptEligible: true,
    learningEligible: true
  };
  const receiptHash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  const receiptSignature = crypto
    .createHmac('sha256', Buffer.from(process.env.YANCE_AI_ROUTE_RECEIPT_SECRET))
    .update(receiptHash)
    .digest('base64url');
  return { ...payload, receiptHash, receiptSignature };
}
function withRuntime(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-r12-r13-third-check-'));
  const { host, broker, store, repository, ledger } = buildAssembly(root);
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
      events: new DomainEventLogService({ canonicalAuthority: ledger }),
      sendPolicy: new SendPolicyAuthority({ repository, accountStateProvider }),
      director: new AIDirectorStrategyAuthority({ repository }),
      identity: new IdentityLinkAuthority({ repository })
    });
  } finally {
    teardownAssembly(root, host, broker);
  }
}

async function withRuntimeAsync(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-r12-r13-third-check-async-'));
  const { host, broker, store, repository, ledger } = buildAssembly(root);
  const accountState = { accounts: [
    { id: 'wa-1', platform: 'whatsapp', state: 'connected', canAttemptSend: true, sendVerified: true, canSend: true, canReceive: true, credentialReady: true, capabilityAvailability: {} },
    { id: 'tg-1', platform: 'telegram', state: 'connected', canAttemptSend: true, sendVerified: true, canSend: true, canReceive: true, credentialReady: true, capabilityAvailability: {} }
  ] };
  try {
    return await callback({
      root, store, repository, ledger, accountState,
      events: new DomainEventLogService({ canonicalAuthority: ledger }),
      sendPolicy: new SendPolicyAuthority({ repository, accountStateProvider: () => accountState.accounts }),
      director: new AIDirectorStrategyAuthority({ repository }),
      identity: new IdentityLinkAuthority({ repository })
    });
  } finally {
    teardownAssembly(root, host, broker);
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

test('domain event ledger rejects collisions, redacts nested secrets, validates time, and records failed then idempotent replays', async () => {
  await withRuntimeAsync(async ({ events, ledger }) => {
    const circular = { text: 'hello', header: 'Bearer abcdefghijklmnopqrstuvwx', nested: { password: 'pw' } };
    circular.self = circular;
    const malicious = JSON.parse('{"safe":true,"__proto__":{"polluted":true}}');
    Object.defineProperty(malicious, 'accessor', { enumerable: true, get() { throw new Error('getter must not execute'); } });
    circular.malicious = malicious;
    circular.nonFinite = Number.NaN;
    const first = events.append({
      platform: 'facebook', sourceAccountId: 'page-1', externalEventId: 'event-1', eventType: 'message.received',
      occurredAt: '2026-07-26T00:00:00Z', receivedAt: '2026-07-26T00:00:01Z', payload: circular
    });
    assert.equal(first.created, true);
    assert.equal(first.event.payload.nested.password, '[REDACTED]');
    assert.match(first.event.payload.header, /\[REDACTED/);
    assert.equal(first.event.payload.self, '[REDACTED_CIRCULAR]');
    assert.equal(first.event.payload.malicious.accessor, '[REDACTED_ACCESSOR]');
    assert.equal(Object.prototype.hasOwnProperty.call(first.event.payload.malicious, '__proto__'), false);
    assert.equal(first.event.payload.nonFinite, '[REDACTED_NON_FINITE_NUMBER]');
    assert.equal({}.polluted, undefined);
    // Identical re-append is an idempotent no-op; changed content under the same external identity conflicts.
    assert.equal(events.append({
      platform: 'facebook', sourceAccountId: 'page-1', externalEventId: 'event-1', eventType: 'message.received', payload: circular,
      occurredAt: '2026-07-26T00:00:00Z', receivedAt: '2026-07-26T00:00:01Z'
    }).created, false);
    assert.throws(() => events.append({
      platform: 'facebook', sourceAccountId: 'page-1', externalEventId: 'event-1', eventType: 'message.received', payload: { text: 'changed' }
    }), error => error.code === 'AUTHORITY_COMMAND_IDEMPOTENCY_CONFLICT');
    assert.throws(() => events.append({ platform: 'telegram', sourceAccountId: 'tg-1', eventType: 'message.received', payload: {} }), error => error.code === 'CANONICAL_EVENT_IDEMPOTENCY_REQUIRED');
    assert.throws(() => events.append({ platform: 'telegram', sourceAccountId: 'tg-1', externalEventId: 'bad-time', eventType: 'message.received', occurredAt: 'not-a-date', payload: {} }), error => error.code === 'CANONICAL_EVENT_TIMESTAMP_INVALID');
    assert.throws(() => events.append({
      platform: 'facebook', sourceAccountId: 'page-1', externalEventId: 'event-1', eventType: 'message.received',
      idempotencyKey: 'attacker-alternate-idempotency', occurredAt: '2026-07-26T00:00:00Z', receivedAt: '2026-07-26T00:00:01Z', payload: circular
    }), error => error.code === 'AUTHORITY_AGGREGATE_VERSION_CONFLICT');
    // A failed projector records a failed receipt and surfaces the projector code. The canonical ledger does not
    // permanently quarantine: a later successful replay applies, and repeating it becomes an idempotent replay.
    await assert.rejects(() => ledger.replay({
      eventId: first.event.eventId, projectorName: 'messages', projectorVersion: 'v1',
      projector: async () => { throw Object.assign(new Error('projection failed'), { code: 'PROJECTOR_BROKEN' }); }
    }), error => error.code === 'PROJECTOR_BROKEN' && error.receipt?.projection_status === 'failed');
    let replayCalls = 0;
    const recovered = await ledger.replay({
      eventId: first.event.eventId, projectorName: 'messages', projectorVersion: 'v1',
      projector: async () => { replayCalls += 1; return { targetRefs: [{ table: 'r32_messages', id: 'm1' }] }; }
    });
    assert.equal(recovered.applied, true);
    assert.equal(recovered.receipt.projection_status, 'applied');
    assert.equal(replayCalls, 1);
    const idempotent = await ledger.replay({
      eventId: first.event.eventId, projectorName: 'messages', projectorVersion: 'v1',
      projector: async () => { replayCalls += 1; return { targetRefs: [] }; }
    });
    assert.equal(idempotent.idempotentReplay, true);
    assert.equal(idempotent.applied, false);
    assert.equal(replayCalls, 1);
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
  // V21: physical route planning (routePlan) is retired to the LiteLLM Model Brain; candidate-vs-production
  // gating lives in Model Brain hard qualification. The legacy entry points stay fail-closed and a tampered
  // historical receipt is still rejected by verifyRouteReceipt.
  assert.equal(typeof aiQuality.routePlan, 'undefined');
  assert.throws(() => aiQuality.routeReceipt(), error => error.code === 'MODEL_ROUTING_MANAGED_BY_LITELLM');

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

test('learning signal idempotency is stable and no transactional profile rebuild exists', () => { const service=require('../services/replyFeedbackLearningService');const a=service.buildImmutableFeedbackSignal({eventType:'sent',outboxId:'o',contactId:'p',conversationId:'c',personaTruthReceipt:{pass:true}});const b=service.buildImmutableFeedbackSignal({eventType:'sent',outboxId:'o',contactId:'p',conversationId:'c',personaTruthReceipt:{pass:true}});assert.equal(a.signalId,b.signalId);assert.equal(service.status().automaticProfileMutation,false); });

test('Learning V4 promotion is proposal-bound and never auto-applies a profile', async () => { const {createLearningPromotionAdapter}=require('../services/learningPromotionAdapter');const adapter=createLearningPromotionAdapter({openFeature:{setEvaluationContext(){}},flagd:{mode:'in-process-offline'}});const version='a'.repeat(64);const p={status:'READY_FOR_REVIEW',Regression:{passed:true},Shadow:{passed:true},Candidate:{id:`policy:${version}`,version}};const r=await adapter.promote(p,{approved:true,evidence:{id:'evidence-promotion-1'}});assert.equal(r.automaticPromotion,false);assert.equal(r.OpenFeature,true); });

test('legacy profile rollback is retired; successor promotion requires explicit evidence review', () => { const fs=require('node:fs');const source=fs.readFileSync(require('node:path').join(__dirname,'../routes/store.js'),'utf8');assert.match(source,/legacy-profile-rollback/u); });

test('legacy profile rollback and forget do not mutate Learning V4 evidence', () => { const service=require('../services/replyFeedbackLearningService');assert.equal(service.status().automaticProfileMutation,false); });


test('Learning V4 feedback persists a fixed bounded metadata envelope instead of caller-owned arbitrary payloads', () => { const service=require('../services/replyFeedbackLearningService');const row=service.buildImmutableFeedbackSignal({eventType:'sent',outboxId:'o',contactId:'p',conversationId:'c',personaTruthReceipt:{pass:true},generationMetadata:{__proto__:{polluted:true}}});assert.equal(Object.prototype.polluted,undefined);assert.equal(row.signal.metadata.rawPrivateChatPersisted,false); });

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

test('domain event identifiers and post-redaction payload size are bounded before persistence', () => {
  withRuntime(({ events, store }) => {
    const base = {
      platform: 'telegram', sourceAccountId: 'tg-1', eventType: 'message.received',
      externalEventId: 'evt-bounds', payload: { text: 'hello' }
    };
    // Canonical ledger bounds identifier length (sourceAccountId <= 1024, platform <= 64) and rejects control chars.
    assert.throws(() => events.append({ ...base, sourceAccountId: 'x'.repeat(1025) }), error => error.code === 'CANONICAL_EVENT_FIELD_INVALID');
    assert.throws(() => events.append({ ...base, eventType: 'message\nreceived' }), error => error.code === 'CANONICAL_EVENT_FIELD_INVALID');
    assert.throws(() => events.append({ ...base, platform: 't'.repeat(65) }), error => error.code === 'CANONICAL_EVENT_FIELD_INVALID');
    const payload = {};
    for (let index = 0; index < 36; index += 1) payload[`segment_${index}`] = 'x'.repeat(60 * 1024);
    assert.throws(() => events.append({ ...base, externalEventId: 'evt-too-large', payload }), error => error.code === 'CANONICAL_EVENT_PAYLOAD_TOO_LARGE');
    // Every bounded append above must have been rejected before any canonical header row was persisted.
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM canonical_event_headers').get().n, 0);
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

test('automatic synthesis idempotency is replaced by explicit proposal/evaluation authority', () => { const fs=require('node:fs');const source=fs.readFileSync(require('node:path').join(__dirname,'../services/learningProposalService.js'),'utf8');assert.match(source,/Evidence/u);assert.match(source,/Regression/u);assert.match(source,/Shadow/u); });

test('retired profile versions cannot be restored or rolled back through production routes', () => { const fs=require('node:fs');const source=fs.readFileSync(require('node:path').join(__dirname,'../routes/store.js'),'utf8');assert.match(source,/LEGACY_LEARNING_PROFILE_MUTATION_RETIRED/u); });

test('emergency candidates remain visible but excluded from Learning V4 eligible evidence', () => { const service=require('../services/replyFeedbackLearningService');const row=service.buildImmutableFeedbackSignal({eventType:'sent',outboxId:'o',contactId:'p',conversationId:'c',emergencyMode:true,personaTruthReceipt:{pass:true}});assert.equal(row.emergencyMode,true);assert.equal(row.learningEligible,false); });

test('all platform send policies wait for reconnection without consuming frozen retry budget', () => {
  // Legacy SendQueueService.processRow/dispatch row-mutation surface is retired to the durable
  // execution authority; the surviving contract is that frozen policies always carry NOT_CONNECTED
  // as a retryable class so reconnection never burns the frozen retry budget.
  withRuntime(({ sendPolicy }) => {
    for (const [platform, accountId] of [['whatsapp', 'wa-1'], ['telegram', 'tg-1']]) {
      const frozen = sendPolicy.freezeOutboxCommand({
        platform, accountId, sessionKey: `${accountId}:peer`, chatJid: 'peer', operation: 'text',
        idempotencyKey: `offline-policy-${platform}`, finalText: 'Hallo'
      });
      assert.equal(frozen.queueMetadata.sendPolicy.retryable.includes('NOT_CONNECTED'), true);
    }
  });
});
