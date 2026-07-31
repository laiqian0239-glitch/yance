'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { JobQueue } = require('../services/jobQueue');
const { AiGateway } = require('../services/aiGateway');

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function waitFor(predicate, timeoutMs = 500) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt >= timeoutMs) throw new Error('condition not met');
    await delay(5);
  }
}

test('a zombie in one provider lane does not consume another provider lane', async () => {
  const queue = new JobQueue({
    concurrency: 2,
    providerConcurrency: { 'provider-b': 1 },
    maxPhysicalZombiesPerProvider: 1,
    providerCircuitCooldownMs: 10_000
  });
  const first = queue.add(() => new Promise(() => {}), {
    providerKey: 'provider-a',
    executionTimeoutMs: 20
  });
  await assert.rejects(first.promise, error => error.code === 'AI_EXECUTION_TIMEOUT');

  let secondStarted = false;
  const second = queue.add(async () => {
    secondStarted = true;
    return 'provider-b-result';
  }, {
    providerKey: 'provider-b',
    executionTimeoutMs: 100
  });
  await waitFor(() => secondStarted);
  assert.equal(await second.promise, 'provider-b-result');
  assert.equal(queue.status().providerDecisions['provider-a'].allowed, false);
  assert.equal(queue.status().providerDecisions['provider-b'].allowed, true);
});

test('one provider decision authority describes cooldown, zombie, capacity, and available states', () => {
  const queue = new JobQueue({
    concurrency: 2,
    providerConcurrency: {
      cooldown: 3,
      zombie: 3,
      capacity: 1,
      available: 2
    },
    maxPhysicalZombiesPerProvider: 2,
    providerCircuitCooldownMs: 10_000
  });
  const now = Date.now();
  queue.providerCircuits.set('cooldown', {
    zombies: 0,
    openedAt: new Date(now).toISOString(),
    openUntil: now + 5_000,
    lastErrorCode: 'COOLDOWN'
  });
  queue.providerCircuits.set('zombie', {
    zombies: 2,
    openedAt: new Date(now).toISOString(),
    openUntil: 0,
    lastErrorCode: 'ZOMBIE_THRESHOLD'
  });
  queue.physicalInFlight.set('capacity-running', {
    id: 'capacity-running',
    providerKey: 'capacity',
    physicalZombie: false
  });

  const expected = {
    cooldown: ['reject', 'PROVIDER_COOLDOWN_OPEN'],
    zombie: ['reject', 'PROVIDER_ZOMBIE_THRESHOLD'],
    capacity: ['wait', 'PROVIDER_CAPACITY_REACHED'],
    available: ['run', 'PROVIDER_CAPACITY_AVAILABLE']
  };
  const status = queue.status();
  for (const [providerKey, [action, reason]] of Object.entries(expected)) {
    const decision = queue.providerExecutionDecision(providerKey, now);
    assert.equal(decision.action, action);
    assert.equal(decision.reason, reason);
    assert.deepEqual(status.providerDecisions[providerKey], decision);
  }
});

test('AI gateway passes provider capacity overrides to its queue authority', () => {
  const gateway = new AiGateway({
    concurrency: 4,
    providerConcurrency: {
      'provider-a': 1,
      'provider-b': 3
    }
  });
  assert.equal(gateway.queue.providerLimit('provider-a'), 1);
  assert.equal(gateway.queue.providerLimit('provider-b'), 3);
  assert.equal(gateway.queue.providerLimit('unconfigured'), 4);
});

test('global physical concurrency remains authoritative across provider lanes', async () => {
  const queue = new JobQueue({
    concurrency: 2,
    providerConcurrency: {
      'provider-a': 2,
      'provider-b': 2,
      'provider-c': 2
    },
    physicalPersistence: {
      write() {},
      async probe() { return { ok: true }; },
      async listUnresolved() { return []; },
      async reconcile() { return []; }
    }
  });
  let active = 0;
  let maximum = 0;
  const jobs = ['provider-a', 'provider-b', 'provider-c'].flatMap(providerKey =>
    [1, 2].map(() => queue.add(async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await delay(20);
      active -= 1;
    }, { providerKey }))
  );
  await Promise.all(jobs.map(job => job.promise));
  assert.equal(maximum, 2);
});

test('provider transfer cannot exceed the target provider lease', async () => {
  const queue = new JobQueue({
    concurrency: 2,
    providerConcurrency: {
      'provider-a': 1,
      'provider-b': 1,
      'provider-c': 1
    },
    physicalPersistence: {
      write() {},
      async probe() { return { ok: true }; },
      async listUnresolved() { return []; },
      async reconcile() { return []; }
    }
  });
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  const first = queue.add(async ({ updateProvider }) => {
    updateProvider('provider-b');
    await blocked;
  }, { providerKey: 'provider-a' });
  await waitFor(() => queue.status().physicalInFlight.some(row => row.providerKey === 'provider-b'));

  const second = queue.add(async ({ updateProvider }) => {
    updateProvider('provider-b');
  }, { providerKey: 'provider-c' });
  await assert.rejects(second.promise, error =>
    error.code === 'AI_PROVIDER_CAPACITY_REACHED'
  );
  assert.equal(queue.status().physicalInFlight.filter(row => row.providerKey === 'provider-b').length, 1);
  release();
  await first.promise;
});
