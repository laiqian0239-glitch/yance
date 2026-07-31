'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AiGateway } = require('../services/aiGateway');
const { JobQueue } = require('../services/jobQueue');
const { FacebookAdapter } = require('../services/facebookAdapter');
const messageStore = require('../services/messageStore');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function patch(object, replacements) {
  const originals = {};
  for (const [key, value] of Object.entries(replacements)) {
    originals[key] = object[key];
    object[key] = value;
  }
  return () => {
    for (const [key, value] of Object.entries(originals)) object[key] = value;
  };
}

test('AI queue timeout releases external abort listeners and controller state even when the task never starts', async () => {
  const gateway = new AiGateway();
  class ForcedShortTimeoutQueue extends JobQueue {
    add(task, meta = {}) { return super.add(task, { ...meta, queueTimeoutMs: 20 }); }
  }
  gateway.queue = new ForcedShortTimeoutQueue({ concurrency: 1, name: 'ai-cleanup-regression' });
  const route = gateway.resolveRoute('quick_reply');
  const providerKey = gateway.providerKeyForModel(route.primary || route.fallback || { id: 'quick_reply' });
  let release;
  const blocker = gateway.queue.add(() => new Promise(resolve => { release = resolve; }), {
    priority: 100,
    providerKey
  });
  await sleep(5);

  const listeners = new Set();
  let added = 0;
  let removed = 0;
  const externalSignal = {
    aborted: false,
    reason: null,
    addEventListener(type, listener) {
      if (type !== 'abort') return;
      added += 1;
      listeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type !== 'abort') return;
      if (listeners.delete(listener)) removed += 1;
    }
  };

  const { jobId } = gateway.submit({
    task: 'quick_reply',
    messages: [{ role: 'user', content: 'hello' }],
    signal: externalSignal
  });
  await sleep(60);

  assert.equal(gateway.getJob(jobId)?.status, 'failed');
  assert.equal(gateway.getJob(jobId)?.error?.code, 'AI_QUEUE_TIMEOUT');
  assert.equal(gateway.controllers.has(jobId), false);
  assert.equal(gateway.queueIds.has(jobId), false);
  assert.equal(added, 1);
  assert.equal(removed, 1);
  assert.equal(listeners.size, 0);

  release();
  await blocker.promise;
});

test('Facebook history profile enrichment is deduplicated and bounded instead of launching one request per conversation', async () => {
  const adapter = new FacebookAdapter();
  adapter.historyContactEnrichmentConcurrency = 3;
  let running = 0;
  let maximumRunning = 0;
  let calls = 0;
  adapter.senderProfile = async (_account, peerId) => {
    calls += 1;
    running += 1;
    maximumRunning = Math.max(maximumRunning, running);
    await sleep(15);
    running -= 1;
    return { name: `Contact ${peerId}`, avatarUrl: '' };
  };
  const updatedConversationIds = [];
  const restoreMessages = patch(messageStore, { updateConversationMetadata: async conversationId => { updatedConversationIds.push(conversationId); return { ok: true }; } });
  try {
    const account = { id: 'facebook-account-a' };
    const tasks = Array.from({ length: 8 }, (_, index) => adapter.scheduleHistoryContactEnrichment(account, `peer-${index}`, `conversation-${index}`, `Fallback ${index}`));
    const duplicate = adapter.scheduleHistoryContactEnrichment(account, 'peer-0', 'conversation-duplicate', 'Duplicate');
    assert.equal(duplicate, tasks[0]);
    await Promise.all([...tasks, duplicate]);
    assert.equal(calls, 8);
    assert.equal(updatedConversationIds.filter(id => id === 'conversation-0').length, 1);
    assert.equal(updatedConversationIds.filter(id => id === 'conversation-duplicate').length, 1);
    assert.equal(new Set(updatedConversationIds).size, 9);
    assert.ok(maximumRunning <= 3, `maximum concurrency was ${maximumRunning}`);
    assert.equal(adapter.historyContactEnrichmentRunning, 0);
    assert.equal(adapter.historyContactEnrichmentQueue.length, 0);
    assert.equal(adapter.historyContactEnrichmentTasks.size, 0);
  } finally {
    restoreMessages();
  }
});

test('Facebook profile fan-out includes duplicate conversations registered while metadata updates are already running', async () => {
  const adapter = new FacebookAdapter();
  adapter.historyContactEnrichmentConcurrency = 1;
  adapter.senderProfile = async () => ({ name: 'Late Contact', avatarUrl: 'https://example.invalid/avatar.jpg' });
  let releaseFirst;
  let firstStarted;
  const firstStartedPromise = new Promise(resolve => { firstStarted = resolve; });
  const updated = [];
  const restoreMessages = patch(messageStore, {
    updateConversationMetadata: async conversationId => {
      updated.push(conversationId);
      if (conversationId === 'conversation-first') {
        firstStarted();
        await new Promise(resolve => { releaseFirst = resolve; });
      }
      return { ok: true };
    }
  });
  try {
    const account = { id: 'facebook-account-late' };
    const first = adapter.scheduleHistoryContactEnrichment(account, 'peer-late', 'conversation-first', 'First');
    await firstStartedPromise;
    const late = adapter.scheduleHistoryContactEnrichment(account, 'peer-late', 'conversation-late', 'Late');
    assert.equal(late, first);
    releaseFirst();
    const result = await first;
    assert.equal(result.ok, true);
    assert.deepEqual(updated, ['conversation-first', 'conversation-late']);
  } finally {
    restoreMessages();
  }
});
