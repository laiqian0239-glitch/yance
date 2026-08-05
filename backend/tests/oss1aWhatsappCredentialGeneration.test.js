'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createSessionGenerationFence,
  createSocketGenerationGuard
} = require('../services/sessionGenerationFence');

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function createLiveGuard() {
  const socketA = Object.freeze({ id: 'socket-a' });
  const row = {
    socket: socketA,
    generation: 7,
    epoch: 3,
    socketToken: 'socket-token-generation-7',
    databaseGeneration: 7
  };
  const fence = createSessionGenerationFence(
    () => row.socket === socketA && row.generation === 7,
    {
      prefix: 'whatsapp:credential-generation-test',
      generation: 7,
      epoch: 3,
      socketToken: row.socketToken
    }
  );
  const guard = createSocketGenerationGuard(fence, () => row.socket === socketA);
  return { row, socketA, fence, guard };
}

test('session generation fence exposes immutable generation epoch and socket-token authority details', () => {
  const { fence } = createLiveGuard();
  assert.deepEqual(fence.details, {
    prefix: 'whatsapp:credential-generation-test',
    generation: 7,
    epoch: 3,
    socketToken: 'socket-token-generation-7'
  });
  assert.equal(Object.isFrozen(fence.details), true);
  assert.equal(Object.isFrozen(fence.snapshot()), true);
  assert.equal(fence.snapshot().quarantinedWrites, 0);
  assert.equal(fence.snapshot().successfulWrites, 0);
});

test('socket A replacement before runWrite causes zero credential writes and preserves socket B authority', async () => {
  const { row, guard } = createLiveGuard();
  const wait = deferred();
  let writes = 0;

  const pending = (async () => {
    await wait.promise;
    return guard.runWrite({
      accountId: 'account-1',
      eventName: 'creds.update',
      authMaterial: 'private-auth-material-must-not-escape'
    }, async () => {
      writes += 1;
      row.databaseGeneration = 7;
      return Object.freeze({ saved: true });
    });
  })();

  row.socket = Object.freeze({ id: 'socket-b' });
  row.generation = 8;
  row.epoch = 4;
  row.socketToken = 'socket-token-generation-8';
  row.databaseGeneration = 8;
  wait.resolve();

  const result = await pending;
  assert.equal(writes, 0);
  assert.equal(row.databaseGeneration, 8);
  assert.equal(result.ok, false);
  assert.equal(result.committed, false);
  assert.equal(result.quarantined, true);
  assert.match(result.reasonCode, /^WHATSAPP_(?:SESSION|SOCKET)_GENERATION_STALE$/u);
  assert.equal(JSON.stringify(result).includes('private-auth-material-must-not-escape'), false);
  assert.equal(guard.snapshot().quarantinedWrites, 1);
  assert.equal(guard.snapshot().successfulWrites, 0);
});

test('current socket runWrite invokes one writer and returns a structured committed result', async () => {
  const { guard } = createLiveGuard();
  let writes = 0;
  const result = await guard.runWrite({
    accountId: 'account-1',
    eventName: 'creds.update'
  }, async () => {
    writes += 1;
    return Object.freeze({ saved: true, revision: 1 });
  });

  assert.equal(writes, 1);
  assert.equal(result.ok, true);
  assert.equal(result.committed, true);
  assert.equal(result.quarantined, false);
  assert.deepEqual(result.value, { saved: true, revision: 1 });
  assert.equal(guard.snapshot().quarantinedWrites, 0);
  assert.equal(guard.snapshot().successfulWrites, 1);
});

test('runWrite propagates non-stale repository failures and never relabels them as quarantine', async () => {
  const { guard } = createLiveGuard();
  const repositoryFailure = Object.assign(new Error('repository write failed'), {
    code: 'WHATSAPP_AUTH_REPOSITORY_WRITE_FAILED'
  });

  await assert.rejects(
    guard.runWrite({ accountId: 'account-1', eventName: 'creds.update' }, async () => {
      throw repositoryFailure;
    }),
    error => {
      assert.equal(error, repositoryFailure);
      assert.equal(error.code, 'WHATSAPP_AUTH_REPOSITORY_WRITE_FAILED');
      return true;
    }
  );
  assert.equal(guard.snapshot().quarantinedWrites, 0);
  assert.equal(guard.snapshot().successfulWrites, 0);
});

require('./batch39WhatsappSessionFence.test');
