'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { R32SqliteStore } = require('../lib/r32SqliteStore');
const { createPlatformCoreRepository } = require('../repositories/platformCoreRepository');
const { IdentityLinkAuthority } = require('../services/identityLinkAuthority');
const { ExternalIdentityAuthority } = require('../services/externalIdentityAuthority');
const { OutboxRouteAuthority } = require('../services/outboxRouteAuthority');
const { IdentityDomainEventOutboxService } = require('../services/identityDomainEventOutboxService');
const { PlatformDeliveryAuthority } = require('../services/platformDeliveryAuthority');
const { normalizeAccountRuntime } = require('../services/accountRuntimeAuthority');
const { AsyncOperationLifecycleAuthority, STATES } = require('../services/asyncOperationLifecycleAuthority');
const { PlatformAuthWorkflowAuthority } = require('../services/platformAuthWorkflowAuthority');
const { PlatformAdapterFacade } = require('../services/platformAdapterPorts');
const syncStability = require('../../frontend/js/r32-sync-stability.js');
const outboundCommandRepository = require('../repositories/outboundCommandRepository');
const { shouldCancelAiForAccountState } = require('../core/projections/storeProjectionCoordinator');

function fixture(prefix = 'yance-b22-') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const store = new R32SqliteStore({ dbPath: path.join(root, 'database', 'yance.db') });
  return { root, store, close() { try { store.close(); } catch (_) {} fs.rmSync(root, { recursive: true, force: true }); } };
}

function seedScope(store) {
  store.upsertAccount({ id: 'page-1', accountId: 'page-1', adapterAccountId: 'page-1', platform: 'facebook', state: 'online', canSend: false, canReceive: true });
  store.upsertContact({ id: 'contact-1', contactId: 'contact-1', platform: 'facebook', accountId: 'page-1', externalId: 'psid-1', displayName: 'Alex' });
  store.upsertConversation({ sessionKey: 'page-1:psid-1', accountId: 'page-1', contactId: 'contact-1', platform: 'facebook', title: 'Alex', routeState: 'bound', chatJid: 'psid-1', externalId: 'psid-1' });
}

test('connected state never becomes sendVerified or canSend without real ACK authority', () => {
  const connected = normalizeAccountRuntime({}, { id: 'page-1', platform: 'facebook', state: 'online' });
  assert.equal(connected.canAttemptSend, false);
  assert.equal(connected.sendVerified, false);
  assert.equal(connected.canSend, false);

  const attemptable = normalizeAccountRuntime(connected, { canAttemptSend: true, sendVerified: false, state: 'online' });
  assert.equal(attemptable.canAttemptSend, true);
  assert.equal(attemptable.sendVerified, false);
  assert.equal(attemptable.canSend, false);

  const acknowledged = normalizeAccountRuntime(attemptable, { sendVerified: true, state: 'online' });
  assert.equal(acknowledged.canAttemptSend, true);
  assert.equal(acknowledged.canSend, true);
});

test('message:inserted is a behavioral SQLite reload trigger', async () => {
  assert.equal(syncStability.requiresConversationReload('message:inserted'), true);
  let observed = null;
  const coordinator = syncStability.createRefreshCoordinator({ delayMs: 250, run: async input => { observed = input; } });
  coordinator.schedule('message:inserted');
  await coordinator.flush();
  assert.deepEqual(observed.eventTypes, ['message:inserted']);
  assert.equal(observed.reloadConversation, true);
});

test('interactive authentication remains RUNNING until later platform state settles the same workflow', async () => {
  const f = fixture('yance-b22-auth-');
  try {
    const lifecycle = new AsyncOperationLifecycleAuthority({ store: f.store });
    const authority = new PlatformAuthWorkflowAuthority({ lifecycle });
    let directStartCalls = 0;
    const facade = new PlatformAdapterFacade('telegram', {
      operationLifecycle: lifecycle,
      authHandler: {
        start: async () => { directStartCalls += 1; return { state: 'connected' }; },
        execute: async input => input.operation === 'cancel'
          ? { schemaVersion: 1, platform: 'telegram', accountId: input.accountId, cancelled: true, state: 'cancelled' }
          : { schemaVersion: 1, platform: 'telegram', accountId: input.accountId, state: 'waiting-verification', qrPresented: true }
      }
    });
    const pending = await facade.auth.start({ accountId: 'tg-1', operation: 'connect' });
    assert.equal(directStartCalls, 0);
    assert.equal(pending.operationState, STATES.RUNNING);
    assert.equal(pending.workflowPending, true);
    const same = lifecycle.read(pending.operationId);
    assert.equal(same.state, STATES.RUNNING);

    const settled = authority.settleFromState(lifecycle, { platform: 'telegram', accountId: 'tg-1', state: 'connected' });
    assert.equal(settled.operation.state, STATES.SUCCEEDED);

    const second = await facade.auth.start({ accountId: 'tg-2', operation: 'connect' });
    const cancelled = await facade.auth.cancel({ accountId: 'tg-2' });
    assert.equal(cancelled.operationId, second.operationId);
    assert.equal(lifecycle.read(second.operationId).state, STATES.CANCELLED);
  } finally { f.close(); }
});

test('PlatformAccount to ExternalIdentity to IdentityLink to ConversationBinding to Message to OutboxRoute is one constrained chain', () => {
  const f = fixture('yance-b22-chain-');
  try {
    seedScope(f.store);
    const repository = createPlatformCoreRepository({ storeProvider: () => f.store });
    const identity = new IdentityLinkAuthority({ repository });
    const external = new ExternalIdentityAuthority({ storeProvider: () => f.store });
    const routeAuthority = new OutboxRouteAuthority({ storeProvider: () => f.store, externalIdentityAuthority: external });
    let observation;
    repository.transaction(repo => {
      observation = identity.observeWithinTransaction({
        platform: 'facebook', sourceAccountId: 'page-1', externalId: 'psid-1', profileContactId: 'contact-1',
        conversationId: 'page-1:psid-1', displayName: 'Alex', evidenceRefs: ['message:msg-1']
      }, repo);
      const ext = external.upsertWithinTransaction({
        platform: 'facebook', accountId: 'page-1', externalId: 'psid-1', contactId: 'contact-1',
        personId: observation.person.personId, identityLinkId: observation.link.identityLinkId,
        conversationId: 'page-1:psid-1', state: 'active'
      }, f.store);
      f.store.upsertMessage({
        id: 'msg-1', dedupeKey: 'msg-1', externalMessageId: 'msg-1', accountId: 'page-1', conversationId: 'page-1:psid-1',
        platform: 'facebook', contactId: 'contact-1', personId: observation.person.personId, externalIdentityId: ext.externalIdentityId,
        direction: 'inbound', fromMe: false, type: 'text', text: 'Hallo', timestamp: '2026-07-28T08:00:00.000Z'
      });
    });
    const route = routeAuthority.ensure({
      conversationId: 'page-1:psid-1', accountId: 'page-1', platform: 'facebook', routeTarget: 'psid-1', capabilitySnapshotId: 'cap-1'
    });
    const ext = f.store.db.prepare('SELECT * FROM external_identities WHERE external_identity_id=?').get(route.externalIdentityId);
    const link = f.store.db.prepare('SELECT * FROM identity_links WHERE identity_link_id=?').get(observation.link.identityLinkId);
    const binding = f.store.db.prepare("SELECT * FROM conversation_bindings WHERE conversation_id=? AND state='active'").get('page-1:psid-1');
    const message = f.store.db.prepare('SELECT * FROM r32_messages WHERE id=?').get('msg-1');
    assert.equal(ext.account_id, 'page-1');
    assert.equal(link.external_identity_id, ext.external_identity_id);
    assert.equal(binding.external_identity_id, ext.external_identity_id);
    assert.equal(binding.account_id, 'page-1');
    assert.equal(message.external_identity_id, ext.external_identity_id);
    assert.equal(route.externalIdentityId, ext.external_identity_id);
    assert.equal(route.identityLinkId, observation.link.identityLinkId);
    assert.equal(route.routeTarget, 'psid-1');
    assert.throws(() => routeAuthority.ensure({ conversationId: 'page-1:psid-1', accountId: 'missing', platform: 'facebook', routeTarget: 'psid-1' }), error => error.code === 'OUTBOX_ROUTE_ACCOUNT_NOT_FOUND');
  } finally { f.close(); }
});

test('emoji-only failure is capability-scoped and does not overwrite account text health', () => {
  const f = fixture('yance-b22-health-');
  try {
    const repository = createPlatformCoreRepository({ storeProvider: () => f.store });
    let clock = new Date('2026-07-28T08:00:00.000Z');
    const authority = new PlatformDeliveryAuthority({ repository, clock: () => clock });
    authority.recordSuccess({ platform: 'facebook', accountId: 'page-1', commandId: 'text-ok', operation: 'text', finalText: 'Hallo' }, { platformMessageId: 'mid-1' });
    clock = new Date(clock.getTime() + 1000);
    authority.recordFailure({ platform: 'facebook', accountId: 'page-1', commandId: 'emoji-fail', operation: 'text', finalText: '🌹' }, { code: 'EMOJI_REJECTED' });
    const account = f.store.db.prepare("SELECT * FROM platform_health_states WHERE scope_type='account' AND account_id='page-1' ORDER BY observed_at DESC LIMIT 1").get();
    const emoji = f.store.db.prepare("SELECT * FROM platform_health_states WHERE scope_type='capability' AND scope_id='facebook:page-1:message.emoji.send' ORDER BY observed_at DESC LIMIT 1").get();
    assert.equal(account.health, 'ready');
    assert.equal(account.reason_code, '');
    assert.equal(emoji.health, 'blocked');
    assert.equal(emoji.reason_code, 'EMOJI_REJECTED');
  } finally { f.close(); }
});

test('identity domain event finalization failure survives restart as a durable outbox row and can be replayed', async () => {
  const f = fixture('yance-b22-identity-outbox-');
  try {
    const service1 = new IdentityDomainEventOutboxService({ storeProvider: () => f.store, intervalMs: 60000 });
    const observation = { auditId: 'audit-1', pendingDomainEvent: { auditId: 'audit-1', eventType: 'identity.link.observed' }, link: { identityLinkId: 'link-1' } };
    const queued = service1.enqueue(observation, new Error('temporary failure'));
    assert.equal(queued.state, 'pending');
    const failed = await service1.drainOnce(async () => { throw new Error('still down'); });
    assert.equal(failed.failed, 1);
    assert.equal(service1.list({ state: 'failed' }).length, 1);

    // A new service instance represents process restart and reads the same SQLite row.
    const service2 = new IdentityDomainEventOutboxService({ storeProvider: () => f.store, intervalMs: 60000 });
    f.store.db.prepare("UPDATE identity_domain_event_outbox SET next_attempt_at='' WHERE audit_id='audit-1'").run();
    let replayed = null;
    const recovered = await service2.drainOnce(async value => { replayed = value; });
    assert.equal(recovered.sent, 1);
    assert.equal(replayed.auditId, 'audit-1');
    assert.equal(service2.list({ state: 'sent' }).length, 1);
  } finally { f.close(); }
});

test('OutboxRoute assertion is fail-closed and never creates a route during Egress authorization', () => {
  const f = fixture('yance-b22-route-assert-');
  try {
    seedScope(f.store);
    const authority = new OutboxRouteAuthority({ storeProvider: () => f.store, externalIdentityAuthority: new ExternalIdentityAuthority({ storeProvider: () => f.store }) });
    const command = { sessionKey: 'page-1:psid-1', accountId: 'page-1', platform: 'facebook', conversationTarget: 'psid-1', capabilitySnapshotId: 'cap-1' };
    assert.throws(() => authority.assertCommand(command), error => error.code === 'EGRESS_OUTBOX_ROUTE_REQUIRED');
    assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM outbox_routes').get().n, 0);
    authority.ensure({ conversationId: command.sessionKey, accountId: command.accountId, platform: command.platform, routeTarget: command.conversationTarget, capabilitySnapshotId: command.capabilitySnapshotId });
    assert.equal(authority.assertCommand(command).state, 'active');
    assert.throws(() => authority.assertCommand({ ...command, conversationTarget: 'different' }), error => error.code === 'EGRESS_OUTBOX_ROUTE_SCOPE_MISMATCH');
  } finally { f.close(); }
});


test('send queue and immutable OutboxRoute version are committed atomically and invalid scope leaves no orphan row', () => {
  const f = fixture('yance-b22-queue-route-');
  try {
    seedScope(f.store);
    const routeAuthority = new OutboxRouteAuthority({ storeProvider: () => f.store, externalIdentityAuthority: new ExternalIdentityAuthority({ storeProvider: () => f.store }) });
    const created = outboundCommandRepository.createAtomic({
      store: f.store,
      outboxRouteAuthority: routeAuthority,
      route: { conversationId: 'page-1:psid-1', accountId: 'page-1', platform: 'facebook', routeTarget: 'psid-1', capabilitySnapshotId: 'cap-1' },
      queue: { id: 'send-ok', idempotencyKey: 'send-ok', accountId: 'page-1', sessionKey: 'page-1:psid-1', messageType: 'text', capabilitySnapshotId: 'cap-1', payload: { operation: 'text', accountId: 'page-1', chatJid: 'psid-1' } },
      message: { id: 'send-ok', dedupeKey: 'send-ok', externalMessageId: 'send-ok', accountId: 'page-1', conversationId: 'page-1:psid-1', sessionKey: 'page-1:psid-1', platform: 'facebook', direction: 'outbound', fromMe: true, type: 'text', text: 'Hallo' }
    });
    assert.equal(created.queue.outbox_route_id, created.route.outboxRouteId);
    assert.equal(created.queue.outbox_route_version_id, created.route.routeVersionId);
    assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM r32_send_queue WHERE id=?').get('send-ok').n, 1);

    const routeCount = f.store.db.prepare('SELECT COUNT(*) AS n FROM outbox_route_versions').get().n;
    assert.throws(() => outboundCommandRepository.createAtomic({
      store: f.store,
      outboxRouteAuthority: routeAuthority,
      route: { conversationId: 'page-1:psid-1', accountId: 'missing-account', platform: 'facebook', routeTarget: 'psid-1', capabilitySnapshotId: 'cap-1' },
      queue: { id: 'send-orphan', idempotencyKey: 'send-orphan', accountId: 'missing-account', sessionKey: 'page-1:psid-1', messageType: 'text', payload: { operation: 'text' } },
      message: { id: 'send-orphan', accountId: 'missing-account', conversationId: 'page-1:psid-1', platform: 'facebook', direction: 'outbound', fromMe: true, type: 'text', text: 'orphan' }
    }), error => ['OUTBOUND_ACCOUNT_NOT_FOUND', 'OUTBOX_ROUTE_ACCOUNT_NOT_FOUND'].includes(error.code));
    assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM r32_send_queue WHERE id=?').get('send-orphan').n, 0);
    assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM outbox_route_versions').get().n, routeCount);
  } finally { f.close(); }
});


test('a completed lifecycle can reuse a business operation hint without primary-key collision', () => {
  const f = fixture('yance-b22-operation-reuse-');
  try {
    const lifecycle = new AsyncOperationLifecycleAuthority({ store: f.store });
    const first = lifecycle.create({ operationId: 'task-stable', operationType: 'ai.reply.candidates', scopeKey: 'conv-1', objectFingerprint: 'rev-1' }).operation;
    lifecycle.start(first.operationId);
    lifecycle.succeed(first.operationId, { ok: true });
    const second = lifecycle.create({ operationId: 'task-stable', operationType: 'ai.reply.candidates', scopeKey: 'conv-1', objectFingerprint: 'rev-2' }).operation;
    assert.notEqual(second.operationId, first.operationId);
    assert.equal(second.generation, first.generation + 1);
    assert.equal(lifecycle.read(first.operationId).state, STATES.SUCCEEDED);
  } finally { f.close(); }
});


test('AI candidates are not cancelled merely because real send ACK is still unverified', () => {
  assert.equal(shouldCancelAiForAccountState({ eventType: 'auth.accountState.updated', payload: { state: 'connected', canAttemptSend: true, sendVerified: false, canSend: false } }), false);
  assert.equal(shouldCancelAiForAccountState({ eventType: 'auth.accountState.updated', payload: { state: 'logged-out', canAttemptSend: false, sendVerified: false, canSend: false } }), true);
  assert.equal(shouldCancelAiForAccountState({ eventType: 'auth.accountState.updated', payload: { state: 'logged-out', canSend: false } }), true);
});
