'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const learning = require('../services/replyFeedbackLearningService');
const { ReplyLearningProjectionRepository } = require('../repositories/replyLearningProjectionRepository');
const { getStore, closeStore } = require('../repositories/storeProvider');

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

test.after(() => {
  learning.stop();
  try { closeStore(); } catch (_) {}
});

test('learning enqueue carries its deadline and rejects a late external result before commit', async () => {
  let received = null;
  let committed = false;
  const task = learning.enqueue(async executionContext => {
    received = executionContext;
    await delay(30);
    executionContext.assertCurrent();
    committed = true;
  }, {
    logicalTaskId: 'learning-task-1',
    generation: 'learning-generation-1',
    timeoutMs: 10
  });

  await assert.rejects(task, error => error.code === 'LEARNING_DEADLINE_EXCEEDED');
  await delay(40);
  assert.equal(committed, false);
  assert.equal(received.logicalTaskId, 'learning-task-1');
  assert.equal(received.generation, 'learning-generation-1');
  assert.equal(received.signal.aborted, true);
  assert.ok(Number.isFinite(received.deadlineAt));
  assert.equal(typeof received.assertCurrent, 'function');
});

test('learning execution deadline starts when its scope lane begins, not while queued', async () => {
  let releaseBlocker;
  const blocker = new Promise(resolve => { releaseBlocker = resolve; });
  const first = learning.enqueue(() => blocker, {
    scopeKey: 'queued-deadline-scope',
    timeoutMs: 1_000
  });

  let received = null;
  const queuedAt = Date.now();
  const second = learning.enqueue(executionContext => {
    received = executionContext;
    executionContext.assertCurrent();
    return 'completed';
  }, {
    scopeKey: 'queued-deadline-scope',
    logicalTaskId: 'queued-learning-task',
    generation: 'queued-learning-generation',
    timeoutMs: 20
  });

  await delay(40);
  releaseBlocker();

  assert.equal(await first, undefined);
  assert.equal(await second, 'completed');
  assert.equal(received.logicalTaskId, 'queued-learning-task');
  assert.equal(received.generation, 'queued-learning-generation');
  assert.ok(received.deadlineAt >= queuedAt + 40);
});

test('learning tasks queued before service stop cannot start after the service controller is cleared', async () => {
  learning.stop();
  const storeManager = {
    onEvent() { return () => {}; },
    dispatch() {}
  };
  const repository = {
    store: null,
    listPendingSuccessfulSendCandidates() { return []; },
    listPendingRejectedCandidates() { return []; },
    countPendingLearningSources() { return { successful: 0, rejected: 0, total: 0 }; }
  };
  learning.start({ storeManager, repository, personaBrain: {} });

  let releaseBlocker;
  const blocker = new Promise(resolve => { releaseBlocker = resolve; });
  const first = learning.enqueue(() => blocker, {
    scopeKey: 'stop-fence-scope',
    timeoutMs: 1_000
  });
  let secondStarted = false;
  const second = learning.enqueue(() => {
    secondStarted = true;
    return 'must-not-run';
  }, {
    scopeKey: 'stop-fence-scope',
    timeoutMs: 1_000
  });
  const firstOutcome = first.then(
    value => ({ status: 'fulfilled', value }),
    error => ({ status: 'rejected', error })
  );
  const secondOutcome = second.then(
    value => ({ status: 'fulfilled', value }),
    error => ({ status: 'rejected', error })
  );

  await delay(10);
  learning.stop();
  releaseBlocker();

  assert.equal((await firstOutcome).error.code, 'LEARNING_SERVICE_STOPPED');
  const queuedResult = await secondOutcome;
  assert.equal(queuedResult.status, 'rejected');
  assert.equal(queuedResult.error.code, 'LEARNING_SERVICE_STOPPED');
  assert.equal(secondStarted, false);
});

test('future retry remains unresolved while a new claim receives a new durable generation', () => {
  const store = getStore();
  const repository = new ReplyLearningProjectionRepository({ store });
  const id = `b40-learning-${Date.now()}`;
  const at = new Date().toISOString();
  store.db.exec('PRAGMA foreign_keys=OFF');
  store.db.prepare(`INSERT INTO reply_learning_projection_jobs(
    job_id,evidence_id,contact_id,conversation_id,state,scope_state,l1_state,attempts,
    claim_token,lease_generation,lease_expires_at,last_heartbeat_at,next_attempt_at,
    last_error,final_failure_code,dlq_at,payload_json,created_at,updated_at,completed_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, id, '', '', 'retry', 'pending', 'pending', 1,
    '', 4, '', '', new Date(Date.now() + 60_000).toISOString(),
    'RETRY_WAIT', '', '', '{}', at, at, ''
  );
  store.db.exec('PRAGMA foreign_keys=ON');

  const deferred = repository.ledger();
  assert.equal(deferred.retryDeferred >= 1, true);
  assert.equal(deferred.unresolved >= 1, true);
  assert.equal(repository.countUnresolved(), deferred.unresolved);

  store.db.prepare('UPDATE reply_learning_projection_jobs SET next_attempt_at=? WHERE job_id=?')
    .run(new Date(Date.now() - 1000).toISOString(), id);
  const claimed = repository.claimNext();
  assert.equal(claimed.jobId, id);
  assert.equal(claimed.leaseGeneration, 5);
});
