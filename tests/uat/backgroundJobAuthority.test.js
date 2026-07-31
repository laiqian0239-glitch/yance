'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { R32SqliteStore } = require('../../backend/lib/r32SqliteStore');
const { BackgroundJobAuthority, STATES } = require('../../backend/services/backgroundJobAuthority');
const { WhatsAppHistoryMediaRecoveryQueue } = require('../../backend/services/whatsappHistoryMediaRecovery');
const { AvatarSyncService } = require('../../backend/services/avatarService');

function fixture(prefix = 'yance-background-jobs-') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const store = new R32SqliteStore({ dbPath: path.join(root, 'store', 'yance-r32.db') });
  return { root, store, cleanup() { store.close(); fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } };
}

function avatarInput(overrides = {}) {
  return {
    accountId: 'wa-account-1',
    conversationId: 'conv-1',
    jid: '491111@s.whatsapp.net',
    jidCandidates: ['491111@s.whatsapp.net'],
    socket: { async profilePictureUrl() { throw Object.assign(new Error('temporary'), { code: 'ETIMEDOUT' }); } },
    ...overrides
  };
}

async function waitFor(check, timeout = 2000) {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeout) throw new Error('waitFor timeout');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

test('same durable job is acquired once and remains suppressed after authority restart', () => {
  const f = fixture();
  let now = Date.parse('2026-07-22T12:00:00Z');
  try {
    const firstAuthority = new BackgroundJobAuthority({ store: f.store, clock: () => now });
    const input = { jobType: 'media-materialization', platform: 'whatsapp', sourceAccountId: 'wa-1', conversationId: 'conv-1', entityId: 'm-1', revision: 'media-v1' };
    const first = firstAuthority.begin(input, { maxAttempts: 4 });
    assert.equal(first.acquired, true);
    assert.equal(first.job.state, STATES.RUNNING);
    const duplicate = firstAuthority.begin(input, { maxAttempts: 4 });
    assert.equal(duplicate.acquired, false);
    assert.equal(duplicate.reason, 'already-running');

    const restartedAuthority = new BackgroundJobAuthority({ store: f.store, clock: () => now });
    const afterRestart = restartedAuthority.begin(input, { maxAttempts: 4 });
    assert.equal(afterRestart.acquired, false);
    assert.equal(afterRestart.reason, 'already-running');
  } finally { f.cleanup(); }
});

test('retry wait survives restart, becomes due, and reaches final failure at max attempts', () => {
  const f = fixture();
  let now = Date.parse('2026-07-22T12:00:00Z');
  try {
    let authority = new BackgroundJobAuthority({ store: f.store, clock: () => now });
    const input = { jobType: 'account-avatar-sync', platform: 'whatsapp', sourceAccountId: 'wa-1', conversationId: 'conv-1', entityId: 'conv-1', revision: 'avatar-v1' };
    const first = authority.begin(input, { maxAttempts: 2 });
    const failed = authority.fail(first.lease, { code: 'FETCH_TIMEOUT' }, { retryable: true, maxAttempts: 2, retryDelayMs: 60_000 });
    assert.equal(failed.state, STATES.RETRY_WAIT);
    assert.equal(failed.attempt, 1);

    authority = new BackgroundJobAuthority({ store: f.store, clock: () => now });
    const early = authority.begin(input, { maxAttempts: 2 });
    assert.equal(early.acquired, false);
    assert.equal(early.reason, 'retry-wait');

    now += 60_001;
    const second = authority.begin(input, { maxAttempts: 2 });
    assert.equal(second.acquired, true);
    assert.equal(second.job.attempt, 2);
    const final = authority.fail(second.lease, { code: 'FETCH_TIMEOUT' }, { retryable: true, maxAttempts: 2, retryDelayMs: 60_000 });
    assert.equal(final.state, STATES.FAILED_FINAL);
    assert.equal(final.retryable, false);
    assert.equal(authority.begin(input, { maxAttempts: 2 }).reason, 'failed_final');
  } finally { f.cleanup(); }
});

test('non-retryable failure becomes final immediately and force retry remains explicit', () => {
  const f = fixture();
  try {
    const authority = new BackgroundJobAuthority({ store: f.store });
    const input = { jobType: 'media-materialization', platform: 'whatsapp', sourceAccountId: 'wa-1', conversationId: 'conv-1', entityId: 'm-1', revision: 'invalid-envelope' };
    const lease = authority.begin(input, { maxAttempts: 4 });
    const failed = authority.fail(lease.lease, { code: 'MEDIA_ENVELOPE_MISSING' }, { retryable: false, maxAttempts: 4 });
    assert.equal(failed.state, STATES.FAILED_FINAL);
    assert.equal(authority.begin(input).acquired, false);
    assert.equal(authority.begin({ ...input, force: true }, { maxAttempts: 4, force: true }).acquired, true);
  } finally { f.cleanup(); }
});

test('same entity id is isolated by source account and conversation', () => {
  const f = fixture();
  try {
    const authority = new BackgroundJobAuthority({ store: f.store });
    const first = authority.begin({ jobType: 'media-materialization', platform: 'whatsapp', sourceAccountId: 'wa-1', conversationId: 'conv-1', entityId: 'same-message', revision: 'v1' });
    const second = authority.begin({ jobType: 'media-materialization', platform: 'whatsapp', sourceAccountId: 'wa-2', conversationId: 'conv-2', entityId: 'same-message', revision: 'v1' });
    assert.equal(first.acquired, true);
    assert.equal(second.acquired, true);
    assert.notEqual(first.job.idempotencyKey, second.job.idempotencyKey);
    assert.equal(authority.snapshot({ jobType: 'media-materialization' }).total, 2);
  } finally { f.cleanup(); }
});

test('stale running jobs recover to retry wait after process interruption', () => {
  const f = fixture();
  let now = Date.parse('2026-07-22T12:00:00Z');
  let ownerAlive = true;
  try {
    const shared = {
      store: f.store,
      clock: () => now,
      staleRunningMs: 30_000,
      pidAlive: pid => pid === 111 && ownerAlive,
      capturePidIdentity: pid => pid === 111 ? 'v2:test:interrupted-owner' : 'v2:test:recovery-owner'
    };
    const authority = new BackgroundJobAuthority({ ...shared, processGeneration: 'interrupted-owner', pid: 111, processIdentity: 'v2:test:interrupted-owner' });
    authority.begin({ jobType: 'account-avatar-sync', platform: 'whatsapp', sourceAccountId: 'wa-1', conversationId: 'conv-1', entityId: 'conv-1', revision: 'v1' });
    now += 31_000;
    ownerAlive = false;
    const recoveryAuthority = new BackgroundJobAuthority({ ...shared, processGeneration: 'recovery-owner', pid: 222, processIdentity: 'v2:test:recovery-owner' });
    const recovered = recoveryAuthority.recoverInterrupted({ staleRunningMs: 30_000, retryDelayMs: 5_000 });
    assert.equal(recovered.length, 1);
    assert.equal(recovered[0].state, STATES.RETRY_WAIT);
    assert.equal(recovered[0].lastErrorCode, 'INTERRUPTED_PROCESS_RECOVERY');
  } finally { f.cleanup(); }
});

test('avatar queue persists retry cooldown and does not run the same failed task again after restart', async () => {
  const f = fixture();
  let now = Date.parse('2026-07-22T12:00:00Z');
  const conversations = new Map([['conv-1', { id: 'conv-1', avatarUrl: '', avatarStatus: '' }]]);
  const messageStore = {
    getConversation(id) { return conversations.get(id) || null; },
    async updateConversationMetadata(id, patch) { conversations.set(id, { ...(conversations.get(id) || { id }), ...patch }); }
  };
  try {
    let calls = 0;
    const authority = new BackgroundJobAuthority({ store: f.store, clock: () => now });
    const service = new AvatarSyncService({
      messageStore,
      backgroundJobs: authority,
      avatarJobMaxAttempts: 3,
      avatarRetryDelayMs: 60_000,
      profileUrlTimeoutMs: 1000,
      fetchImpl: async () => { throw new Error('unused'); }
    });
    const input = avatarInput({ socket: { async profilePictureUrl() { calls += 1; throw Object.assign(new Error('temporary'), { code: 'ETIMEDOUT' }); } } });
    const first = await service.enqueueWhatsApp(input);
    assert.equal(first.status, 'failed');
    assert.equal(first.backgroundJobState, STATES.RETRY_WAIT);
    const restarted = new AvatarSyncService({ messageStore, backgroundJobs: new BackgroundJobAuthority({ store: f.store, clock: () => now }), avatarJobMaxAttempts: 3, avatarRetryDelayMs: 60_000 });
    const second = await restarted.enqueueWhatsApp(input);
    assert.equal(second.status, 'deferred');
    assert.equal(second.backgroundJobState, STATES.RETRY_WAIT);
    assert.equal(calls, 2, 'first attempt probes image and preview only; restart must not probe again during cooldown');
  } finally { f.cleanup(); }
});

test('history media queue keeps a durable retry state and suppresses duplicate enqueue after restart', async () => {
  const f = fixture();
  let now = Date.parse('2026-07-22T12:00:00Z');
  const persisted = [];
  try {
    const authority = new BackgroundJobAuthority({ store: f.store, clock: () => now });
    const options = {
      backgroundJobs: authority,
      maxRetries: 3,
      media: { async materializeBaileys({ descriptor }) { return { ...descriptor, downloadStatus: 'failed', downloadError: 'MEDIA_DOWNLOAD_TIMEOUT', retryable: true }; } },
      store: { async upsert(message) { persisted.push(message); return { message }; }, listConversations() { return []; }, listMessages() { return []; } },
      events: { publish() {} }, log: { warn() {} }
    };
    const queue = new WhatsAppHistoryMediaRecoveryQueue(options);
    const job = { accountId: 'wa-1', conversationId: 'conv-1', messageId: 'm-1', info: { key: { id: 'm-1' }, message: { imageMessage: {} } }, socket: {}, descriptor: { kind: 'image', mimeType: 'image/jpeg', downloadStatus: 'pending' }, message: { id: 'm-1' } };
    assert.equal(queue.enqueue(job).queued, true);
    queue.drain();
    await waitFor(() => queue.snapshot().active === 0);
    const state = authority.snapshot({ jobType: 'media-materialization' }).jobs[0];
    assert.equal(state.state, STATES.RETRY_WAIT);

    const restarted = new WhatsAppHistoryMediaRecoveryQueue({ ...options, backgroundJobs: new BackgroundJobAuthority({ store: f.store, clock: () => now }) });
    const duplicate = restarted.enqueue(job);
    assert.equal(duplicate.queued, false);
    assert.equal(duplicate.reason, 'retry-wait');
    assert.equal(duplicate.nextRetryAt, state.nextRetryAt);
  } finally { f.cleanup(); }
});

test('a completed periodic avatar refresh starts a new retry budget instead of accumulating lifetime attempts', () => {
  const f = fixture();
  let now = Date.parse('2026-07-22T12:00:00Z');
  try {
    const authority = new BackgroundJobAuthority({ store: f.store, clock: () => now });
    const input = { jobType: 'account-avatar-sync', platform: 'whatsapp', sourceAccountId: 'wa-1', conversationId: 'conv-1', entityId: 'conv-1', revision: 'avatar-v1' };
    const first = authority.begin(input, { maxAttempts: 2, refreshAfterMs: 1 });
    authority.succeed(first.lease, { status: 'ready' });
    now += 2;
    const refresh = authority.begin(input, { maxAttempts: 2, refreshAfterMs: 1 });
    assert.equal(refresh.acquired, true);
    assert.equal(refresh.job.attempt, 1);
    const failed = authority.fail(refresh.lease, { code: 'FETCH_TIMEOUT' }, { retryable: true, maxAttempts: 2, retryDelayMs: 1000 });
    assert.equal(failed.state, STATES.RETRY_WAIT);
  } finally { f.cleanup(); }
});

test('media recovery reconciles a ready message after a crash between message persistence and job completion', () => {
  const f = fixture();
  try {
    const authority = new BackgroundJobAuthority({ store: f.store });
    const descriptor = { kind: 'image', mimeType: 'image/jpeg', downloadStatus: 'ready', mediaUrl: '/media/m-1.jpg' };
    const input = { jobType: 'media-materialization', platform: 'whatsapp', sourceAccountId: 'wa-1', conversationId: 'conv-1', entityId: 'm-1', revision: require('../../backend/services/whatsappHistoryMediaRecovery').mediaRevision(descriptor) };
    authority.begin(input, { maxAttempts: 3 });
    const message = { id: 'm-1', conversationId: 'conv-1', attachments: [descriptor] };
    const queue = new WhatsAppHistoryMediaRecoveryQueue({
      backgroundJobs: authority,
      store: {
        listConversations() { return []; },
        listMessages(conversationId) { return conversationId === 'conv-1' ? [message] : []; },
        async upsert() {}
      },
      events: { publish() {} }, log: { warn() {} }, media: {}
    });
    const result = queue.reconcileDurableCompletions('wa-1');
    assert.equal(result.reconciled, 1);
    assert.equal(authority.snapshot({ jobType: 'media-materialization' }).jobs[0].state, STATES.SUCCEEDED);
  } finally { f.cleanup(); }
});
