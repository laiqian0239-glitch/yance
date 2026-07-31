'use strict';

/**
 * Integration tests for migrated call paths.
 * Verifies that callers now route through the stable facade contracts:
 *   - sendMessageService (AC-018)
 *   - accountLifecycleCommands (AC-019)
 *   - contactContextAuthority (AC-031/032)
 *
 * Run: node --test backend/tests/caller_migration.test.js
 */

const assert = require('assert');

// ── Mock platformMessagingService (internal dep of sendMessageService) ──
const sentLog = [];
const mockPlatform = {
  sendText: async (p) => { sentLog.push(['text', p]); return { id: 'pm_text_ok' }; },
  sendMedia: async (p) => { sentLog.push(['media', p]); return { id: 'pm_media_ok' }; },
  sendReaction: async (p) => { sentLog.push(['reaction', p]); return { ok: true }; },
  revokeMessage: async (p) => { sentLog.push(['revoke', p]); return { ok: true }; },
  sendPresence: async (p) => { sentLog.push(['presence', p]); return { ok: true }; },
  markRead: async (p) => { sentLog.push(['markRead', p]); return { ok: true }; },
  resolveAccount: (accountId, platform, chatJid) => ({ platform: platform || 'whatsapp' }),
};

// ── Mock accountManager (used by accountLifecycleCommands) ──
const mockAccountManager = {
  connect: async (id) => { sentLog.push(['lifecycle', 'connect', id]); return { id, status: 'connected' }; },
  reconnect: async (id) => { sentLog.push(['lifecycle', 'reconnect', id]); return { id, status: 'connected' }; },
  disconnect: async (id, opts) => { sentLog.push(['lifecycle', 'disconnect', id, opts]); return { ok: true, disconnected: opts?.logout || false }; },
  getLifecycleState: async (id) => ({ id, status: 'connected', paused: false }),
  assertEligible: async (id, op) => { if (id === 'blocked') throw Object.assign(new Error('blocked'), { code: 'OPERATION_BLOCKED' }); },
};

// ── Mock customerSocialSelectors ──
const mockSelector = {
  selectCustomerSocialContext: (contactId, opts) => {
    sentLog.push(['selector', contactId, opts]);
    if (contactId === 'ghost') return { found: false };
    return { found: true, contactId, warmth: 0.7, stage: 'warm', timeline: [] };
  },
};

// ── Bootstrap services with mocks ──
const sendMessageService = require('../services/sendMessageService');
const accountLifecycleCommands = require('../services/accountLifecycleCommands');
const contactContextAuthority = require('../services/contactContextAuthority');

sendMessageService.resetRegistry();
sendMessageService.setRegistry(mockPlatform);
accountLifecycleCommands.setManager(mockAccountManager);
contactContextAuthority.setSelector(mockSelector);
contactContextAuthority.setIngest(async () => ({ ok: true, wired: true }));

// ── Test helpers ──
let passed = 0, failed = 0;

async function test(name, fn) {
  sentLog.length = 0;
  try {
    await fn();
    passed++;
    console.log('PASS ' + name);
  } catch (e) {
    failed++;
    console.log('FAIL ' + name + ': ' + e.message);
    process.exitCode = 1;
  }
}

function assertLog(op, idx, value) {
  if (!sentLog[idx] || sentLog[idx][0] !== op) {
    throw new Error('Expected [' + op + '] at index ' + idx + ', got: ' + JSON.stringify(sentLog[idx]));
  }
  if (value !== undefined && sentLog[idx][1] !== value) {
    throw new Error('Expected value [' + value + '] at [' + op + '], got: ' + JSON.stringify(sentLog[idx][1]));
  }
}

// ── Tests (sequential via async IIFE) ──
(async () => {
  // ── sendMessageService send path ──

  await test('sendText routes to platform.sendText', async () => {
    await sendMessageService.sendText({ accountId: 'a1', chatJid: 'c@test', text: 'hi' });
    assertLog('text', 0);
    assert.strictEqual(sentLog[0][1].accountId, 'a1');
    if (!sentLog[0][1].text?.includes('hi')) throw new Error('text not forwarded');
  });

  await test('sendMedia routes to platform.sendMedia', async () => {
    await sendMessageService.sendMedia({ accountId: 'a1', chatJid: 'c@test', kind: 'image', filePath: '/tmp/x.jpg' });
    assertLog('media', 0);
    assert.strictEqual(sentLog[0][1].accountId, 'a1');
  });

  await test('sendReaction routes to platform.sendReaction', async () => {
    await sendMessageService.sendReaction({ accountId: 'a1', chatJid: 'c@test', targetId: 'msg1', emoji: '👍' });
    assertLog('reaction', 0);
    assert.strictEqual(sentLog[0][1].accountId, 'a1');
  });

  await test('revokeMessage routes to platform.revokeMessage', async () => {
    await sendMessageService.revokeMessage({ accountId: 'a1', chatJid: 'c@test', key: { id: 'msg1' } });
    assertLog('revoke', 0);
    assert.strictEqual(sentLog[0][1].accountId, 'a1');
  });

  await test('sendPresence routes to platform.sendPresence', async () => {
    await sendMessageService.sendPresence({ accountId: 'a1', chatJid: 'c@test', state: 'composing' });
    assertLog('presence', 0);
    assert.strictEqual(sentLog[0][1].accountId, 'a1');
  });

  await test('markRead routes to platform.markRead', async () => {
    await sendMessageService.markRead({ accountId: 'a1', chatJid: 'c@test' });
    assertLog('markRead', 0);
    assert.strictEqual(sentLog[0][1].accountId, 'a1');
  });

  await test('resolveAccount routes to platform.resolveAccount', async () => {
    const r = sendMessageService.resolveAccount('a1', 'telegram', null);
    assert.strictEqual(r.platform, 'telegram');
    // resolveAccount is a read-only delegation; no send operations should be logged
    assert.strictEqual(sentLog.length, 0, 'resolveAccount should not trigger a send');
  });

  // ── accountLifecycleCommands path ──

  await test('lifecycle.start routes to accountManager.connect', async () => {
    const r = await accountLifecycleCommands.start('acc1');
    assert.strictEqual(r.account.id, 'acc1');
    assertLog('lifecycle', 0, 'connect');
  });

  await test('lifecycle.restart routes to accountManager.reconnect', async () => {
    await accountLifecycleCommands.restart('acc2');
    assertLog('lifecycle', 0, 'reconnect');
  });

  await test('lifecycle.stop (no logout) routes to accountManager.disconnect(logout:false)', async () => {
    await accountLifecycleCommands.stop('acc3', { logout: false });
    assertLog('lifecycle', 0, 'disconnect');
    assert.strictEqual(sentLog[0][3]?.logout, false, 'logout:false not passed');
  });

  await test('lifecycle.stop (logout) routes to accountManager.disconnect(logout:true)', async () => {
    await accountLifecycleCommands.stop('acc3', { logout: true });
    assertLog('lifecycle', 0, 'disconnect');
    assert.strictEqual(sentLog[0][3]?.logout, true, 'logout:true not passed');
  });

  // ── contactContextAuthority read path ──

  await test('authority.getSocialContext routes to customerSocialSelectors', async () => {
    const ctx = contactContextAuthority.getSocialContext('alice', { timelineLimit: 24 });
    assert.strictEqual(ctx.found, true);
    assert.strictEqual(ctx.warmth, 0.7);
    assertLog('selector', 0, 'alice');
    assert.strictEqual(sentLog[0][2]?.timelineLimit, 24, 'opts not passed through');
  });

  await test('authority.getSocialContext returns not-found for unknown', async () => {
    const ctx = contactContextAuthority.getSocialContext('ghost');
    assert.strictEqual(ctx.found, false);
    assertLog('selector', 0, 'ghost');
  });

  // ── contactContextAuthority write path ──

  await test('authority.recordSocialSignal delegates to setIngest', async () => {
    const r = await contactContextAuthority.recordSocialSignal('alice', {
      kind: 'message',
      message: { id: 'msg1', text: 'hello' },
      conversationId: 'c1',
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.wired, true);
  });

  await test('authority.assertLocalAuthority is a no-op invariant-assertion', async () => {
    const result = contactContextAuthority.assertLocalAuthority();
    assert.strictEqual(result.localAuthority, true);
    assert.strictEqual(result.backendProjection, true);
    assert.strictEqual(result.directBackendWrite, false);
  });

  await test('authority.assertLocalAuthority does not throw', async () => {
    let threw = false;
    try {
      contactContextAuthority.assertLocalAuthority();
    } catch (e) {
      threw = true;
    }
    if (threw) throw new Error('assertLocalAuthority should not throw');
  });

  // Clean up so subsequent test files get a clean slate
  sendMessageService.resetRegistry();

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
})();
