'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-b39-ai-recovery-root-'));
process.env.YANCE_DATA_DIR = dataRoot;
process.env.NODE_ENV = 'test';

const { R32SqliteStore } = require('../lib/r32SqliteStore');
const {
  BackgroundJobAuthority,
  STATES
} = require('../services/backgroundJobAuthority');
const aiBrainOrchestrator = require('../services/aiBrainOrchestrator');
const { closeStore } = require('../repositories/storeProvider');

function fixture(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const store = new R32SqliteStore({ dbPath: path.join(root, 'database', 'yance.db') });
  return {
    store,
    close() {
      try { store.close(); } catch (_) {}
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
}

function job(index, overrides = {}) {
  const conversationId = overrides.conversationId || `conversation-${index}`;
  return {
    jobType: overrides.jobType || 'ai-conversation-analysis',
    platform: overrides.platform || 'facebook',
    sourceAccountId: overrides.sourceAccountId || 'account-analysis',
    conversationId,
    entityId: overrides.entityId || `message-${index}`,
    revision: overrides.revision || `message-${index}`,
    payload: { conversationId },
    ...overrides
  };
}

test.after(() => {
  try { closeStore(); } catch (_) {}
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

test('startup recovery is analysis-scoped, due-aware, and cursor-stable while jobs become terminal', () => {
  const f = fixture('yance-b39-ai-recovery-');
  const now = Date.parse('2026-07-30T01:00:00.000Z');
  const authority = new BackgroundJobAuthority({
    store: f.store,
    clock: () => now,
    pid: 991,
    processGeneration: 'batch39-recovery-process',
    processIdentity: 'batch39-recovery-process:991',
    pidAlive: () => false,
    capturePidIdentity: () => 'batch39-recovery-process:991'
  });
  try {
    const pending = Array.from({ length: 5 }, (_, index) => job(index + 1));
    for (const input of pending) authority.enqueue(input, { maxAttempts: 5, now });

    const future = job('future', { conversationId: 'conversation-future' });
    authority.enqueue(future, { maxAttempts: 5, now });
    const futureLease = authority.begin(future, { maxAttempts: 5, now });
    authority.fail(futureLease.lease, { code: 'RETRY_LATER' }, {
      retryable: true,
      maxAttempts: 5,
      retryDelayMs: 60_000,
      now
    });

    const staleAnalysis = job('stale', { conversationId: 'conversation-stale' });
    authority.enqueue(staleAnalysis, { maxAttempts: 5, now });
    authority.begin(staleAnalysis, { maxAttempts: 5, now });

    const unrelated = job('unrelated', {
      jobType: 'telegram-message-enrichment',
      conversationId: 'conversation-unrelated',
      sourceAccountId: 'account-telegram'
    });
    authority.enqueue(unrelated, { maxAttempts: 5, now });
    authority.begin(unrelated, { maxAttempts: 5, now });
    const unrelatedBefore = authority.read(unrelated);

    const scheduled = [];
    assert.equal(typeof aiBrainOrchestrator.recoverStartupAnalyses, 'function');
    const metrics = aiBrainOrchestrator.recoverStartupAnalyses({
      backgroundJobs: authority,
      now: () => now,
      pageSize: 2,
      maxPages: 20,
      timeBudgetMs: 5000,
      listConversations: () => [],
      scheduleAnalysis(conversationId) {
        scheduled.push(conversationId);
        const current = authority.snapshot({
          jobType: 'ai-conversation-analysis',
          conversationId,
          states: [STATES.PENDING, STATES.RUNNING, STATES.RETRY_WAIT],
          dueBefore: new Date(now).toISOString(),
          order: 'oldest',
          limit: 1
        }).jobs[0];
        if (!current) return false;
        const acquired = authority.begin(current, { maxAttempts: 5, now });
        if (!acquired.acquired) return false;
        authority.succeed(acquired.lease, { recovered: true });
        return true;
      }
    });

    assert.deepEqual(new Set(scheduled), new Set(pending.map(row => row.conversationId)));
    assert.equal(scheduled.includes('conversation-future'), false);
    assert.equal(scheduled.includes('conversation-stale'), false);
    assert.equal(metrics.recovered, 5);
    assert.equal(metrics.pages, 3);
    assert.equal(metrics.budgetExhausted, false);
    assert.equal(authority.read(future).state, STATES.RETRY_WAIT);
    assert.equal(authority.read(staleAnalysis).state, STATES.RETRY_WAIT);
    assert.deepEqual(authority.read(unrelated), unrelatedBefore);
  } finally {
    f.close();
  }
});

test('startup recovery passes an explicit due filter and never forces schedule acquisition', () => {
  const now = Date.parse('2026-07-30T01:00:00.000Z');
  const calls = {
    recover: [],
    snapshots: [],
    schedules: []
  };
  const backgroundJobs = {
    recoverInterrupted(options) {
      calls.recover.push(options);
      return [];
    },
    snapshot(options) {
      calls.snapshots.push(options);
      if (calls.snapshots.length === 1) {
        return {
          jobs: [{
            conversationId: 'conversation-due',
            payload: { conversationId: 'conversation-due' }
          }],
          hasMore: false,
          nextCursor: null,
          oldestPendingAt: '2026-07-30T00:00:00.000Z',
          total: 1
        };
      }
      return {
        jobs: [],
        hasMore: false,
        nextCursor: null,
        oldestPendingAt: '',
        total: 0
      };
    }
  };

  assert.equal(typeof aiBrainOrchestrator.recoverStartupAnalyses, 'function');
  aiBrainOrchestrator.recoverStartupAnalyses({
    backgroundJobs,
    now: () => now,
    listConversations: () => [],
    scheduleAnalysis(conversationId, options) {
      calls.schedules.push({ conversationId, options });
      return true;
    }
  });

  assert.equal(calls.recover.length, 1);
  assert.equal(calls.recover[0].jobType, 'ai-conversation-analysis');
  assert.equal(calls.snapshots[0].jobType, 'ai-conversation-analysis');
  assert.equal(calls.snapshots[0].dueBefore, new Date(now).toISOString());
  assert.equal(calls.schedules[0].conversationId, 'conversation-due');
  assert.notEqual(calls.schedules[0].options?.force, true);
});

test('startup recovery exposes remaining work when the explicit page budget is exhausted', () => {
  let snapshots = 0;
  const metrics = aiBrainOrchestrator.recoverStartupAnalyses({
    backgroundJobs: {
      recoverInterrupted() {
        return [];
      },
      snapshot() {
        snapshots += 1;
        if (snapshots === 1) {
          return {
            jobs: [{ conversationId: 'conversation-first' }],
            hasMore: true,
            nextCursor: { createdAt: '2026-07-30T00:00:00.000Z', jobId: 'job-first' },
            oldestPendingAt: '2026-07-30T00:00:00.000Z',
            total: 5
          };
        }
        return {
          jobs: [{ conversationId: 'conversation-next' }],
          hasMore: true,
          nextCursor: null,
          oldestPendingAt: '2026-07-30T00:00:00.000Z',
          total: 4
        };
      }
    },
    now: () => Date.parse('2026-07-30T01:00:00.000Z'),
    maxPages: 1,
    listConversations: () => [],
    scheduleAnalysis: () => true
  });

  assert.equal(metrics.pages, 1);
  assert.equal(metrics.scanned, 1);
  assert.equal(metrics.recovered, 1);
  assert.equal(metrics.remaining, 4);
  assert.equal(metrics.oldestPendingAt, '2026-07-30T00:00:00.000Z');
  assert.equal(metrics.budgetExhausted, true);
});
