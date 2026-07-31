'use strict';

// P0-A AC-019 — AccountLifecycleCommands contract test.
// Runs in plain node (no real adapters): the manager is injected via setManager.

const assert = require('assert');

const mockManager = {
  connect: async (id) => ({ id, status: 'connected', platform: 'whatsapp' }),
  reconnect: async (id) => ({ id, status: 'connected', platform: 'whatsapp' }),
  disconnect: async (id, opts) => ({ ok: true, disconnected: !!opts?.logout }),
  getLifecycleState: async (id) => ({ id, status: 'connected', paused: false }),
  assertEligible: async (id, op) => { if (id === 'blocked') throw Object.assign(new Error('blocked'), { code: 'OPERATION_BLOCKED' }); },
};

const { setManager } = require('../services/accountLifecycleCommands');
setManager(mockManager);
const lc = require('../services/accountLifecycleCommands');

let passed = 0, failed = 0;

async function test(name, fn) {
  try { await fn(); passed++; console.log('PASS ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + ': ' + e.message); process.exitCode = 1; }
}

async function throwsAsync(fn, code) {
  try { await fn(); throw new Error('Expected to throw'); }
  catch (e) { if (code && e.code !== code) throw e; }
}

(async () => {
  await test('start -> connect', async () => {
    const r = await lc.start('acc1');
    assert.strictEqual(r.account.id, 'acc1');
    assert.strictEqual(r.account.status, 'connected');
  });

  await test('stop (no logout)', async () => {
    const r = await lc.stop('acc1', { logout: false });
    assert.strictEqual(r.result.disconnected, false);
  });

  await test('assertEligible passes', async () => {
    await lc.assertEligible('acc1', 'send');
  });

  await test('assertEligible blocked throws', async () => {
    await throwsAsync(() => lc.assertEligible('blocked', 'send'), 'OPERATION_BLOCKED');
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
})();
