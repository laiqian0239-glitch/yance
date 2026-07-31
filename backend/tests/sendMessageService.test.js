'use strict';

// P0-A AC-018 — SendMessageService contract test.
// Runs in plain node (no adapters): the registry is injected via setRegistry.

const assert = require('assert');
const svc = require('../services/sendMessageService');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('PASS ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + ' -> ' + e.message); }
}

(async () => {
  // inject a fake registry (no real adapters loaded)
  svc.resetRegistry(); // ensure clean slate — nullify any registry set by a prior test
  const calls = [];
  svc.setRegistry({
    text: async (i) => { calls.push(['text', i]); return { ok: true, type: 'text' }; },
    media: async (i) => { calls.push(['media', i]); return { ok: true, type: 'media' }; },
    reaction: async (i) => { calls.push(['reaction', i]); return { ok: true }; },
    revoke: async (i) => { calls.push(['revoke', i]); return { ok: true }; },
    presence: async (i) => { calls.push(['presence', i]); return { ok: true }; },
    read: async (i) => { calls.push(['read', i]); return { ok: true }; },
    _pm: { resolveAccount: () => ({}), externalTarget: (p, v) => v },
  });

  await test('exposes stable surface', () => {
    for (const k of ['send', 'setRegistry', 'resolveAccount', 'externalTarget', 'sendText', 'sendMedia', 'sendReaction', 'revokeMessage', 'sendPresence', 'markRead']) {
      assert.strictEqual(typeof svc[k], 'function', 'missing ' + k);
    }
  });

  await test('send({type:text}) routes to text', async () => {
    const r = await svc.send({ type: 'text', chatJid: 'x', text: 'hi' });
    assert.strictEqual(r.type, 'text');
    assert.strictEqual(calls[calls.length - 1][0], 'text');
  });

  await test('send({operation:media}) routes to media', async () => {
    await svc.send({ operation: 'media', chatJid: 'x' });
    assert.strictEqual(calls[calls.length - 1][0], 'media');
  })

  await test('unknown type throws SEND_TYPE_UNSUPPORTED', async () => {
    let threw = false;
    try { await svc.send({ type: 'carrier-pigeon' }); } catch (e) { threw = true; assert.strictEqual(e.code, 'SEND_TYPE_UNSUPPORTED'); }
    assert.strictEqual(threw, true);
  })

  await test('missing type throws SEND_TYPE_UNSUPPORTED', async () => {
    let threw = false;
    try { await svc.send({}); } catch (e) { threw = true; assert.strictEqual(e.code, 'SEND_TYPE_UNSUPPORTED'); }
    assert.strictEqual(threw, true);
  })

  // NOTE: do NOT call process.exit() — other tests (caller_migration, contactContextAuthority)
  // run in the same process and must execute after this file's IIFE completes.
  // Restore null so the next test file gets a clean slate.
  svc.resetRegistry();

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
})();
