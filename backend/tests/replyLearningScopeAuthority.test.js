'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { R32SqliteStore } = require('../lib/r32SqliteStore');
const authority = require('../services/replyLearningScopeAuthority');

function withStore(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-learning-scopes-'));
  const store = new R32SqliteStore({ dbPath: path.join(root, 'r32.db') });
  try { return fn(store); } finally { store.close(); fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
}

function shortFeedback(contactId, platform, index, sourceAccountId = `${platform}-account-1`) {
  return {
    evidenceId: `${platform}:${contactId}:${index}`,
    eventType: 'sent',
    contactId,
    conversationId: `${platform}:${contactId}`,
    platform,
    sourceAccountId,
    originalText: 'This is a deliberately longer reply with a question and more details?',
    finalText: 'Shorter.',
    observedAt: `2026-07-20T00:00:${String(index).padStart(2, '0')}.000Z`
  };
}

test('platform and global learning require cross-contact evidence', () => withStore(store => {
  const whatsappScope = authority.platformScopeId('whatsapp', 'whatsapp-account-1');
  for (let index = 1; index <= 4; index += 1) {
    authority.recordFeedback(shortFeedback('c1', 'whatsapp', index), { store });
  }
  assert.equal(authority.read('platform', whatsappScope, store).profile.effective?.replyLength, undefined);
  assert.equal(authority.read('global', 'owner', store).profile.effective?.replyLength, undefined);

  for (let index = 5; index <= 8; index += 1) {
    authority.recordFeedback(shortFeedback('c2', 'whatsapp', index), { store });
  }
  assert.equal(authority.read('platform', whatsappScope, store).profile.effective.replyLength.value, 'short');
  assert.equal(authority.read('global', 'owner', store).profile.effective?.replyLength, undefined);

  for (let index = 9; index <= 12; index += 1) {
    authority.recordFeedback(shortFeedback('c3', 'telegram', index), { store });
  }
  assert.equal(authority.read('global', 'owner', store).profile.effective.replyLength.value, 'short');
  const beforeDuplicate = authority.read('platform', whatsappScope, store).version;
  authority.recordFeedback(shortFeedback('c2', 'whatsapp', 8), { store });
  assert.equal(authority.read('platform', whatsappScope, store).version, beforeDuplicate);
}));

test('layered preferences use contact over platform over global and never share private examples', () => withStore(store => {
  const global = {
    version: 1,
    effective: { replyLength: { value: 'long', confidence: 0.7 } },
    evidence: []
  };
  const platform = {
    version: 2,
    effective: { replyLength: { value: 'medium', confidence: 0.8 }, emojiLevel: { value: 'low', confidence: 0.75 } },
    evidence: []
  };
  authority.write('global', 'owner', global, { store });
  const platformScope = authority.platformScopeId('whatsapp', 'wa-1');
  authority.write('platform', platformScope, platform, { store });
  const contact = {
    version: 3,
    effective: { replyLength: { value: 'short', confidence: 0.95 } },
    recentExamples: [{ id: 'private', finalText: 'Kontaktbezogenes Beispiel' }]
  };
  const layered = authority.layered({ contactId: 'c1', platform: 'whatsapp', sourceAccountId: 'wa-1', contactProfile: contact }, { store });
  assert.equal(layered.effective.replyLength.value, 'short');
  assert.equal(layered.effective.replyLength.scope, 'contact');
  assert.equal(layered.effective.emojiLevel.scope, 'platform');
  assert.equal(layered.recentExamples.length, 1);
  assert.deepEqual(layered.layers.platform.profile.recentExamples || [], []);
  assert.deepEqual(layered.layers.global.profile.recentExamples || [], []);
}));

test('learning governance can disable, enable, delete and restore scoped preferences', () => withStore(store => {
  const platformScope = authority.platformScopeId('whatsapp', 'wa-1');
  const initial = authority.write('platform', platformScope, {
    effective: {
      replyLength: { value: 'short', confidence: 0.91, evidenceCount: 4, updatedAt: '2026-07-20T00:00:00.000Z' }
    },
    evidence: []
  }, { store, reason: 'seed' });
  assert.equal(initial.version, 1);

  const disabled = authority.mutatePreference('platform', platformScope, 'replyLength', 'disable', { store, actor: 'user' });
  assert.equal(disabled.profile.effective.replyLength.disabled, true);
  assert.equal(authority.layered({ contactId: 'c1', platform: 'whatsapp', sourceAccountId: 'wa-1', contactProfile: {} }, { store }).effective.replyLength, undefined);

  const enabled = authority.mutatePreference('platform', platformScope, 'replyLength', 'enable', { store, actor: 'user' });
  assert.equal(enabled.profile.effective.replyLength.disabled, false);
  assert.equal(authority.layered({ contactId: 'c1', platform: 'whatsapp', sourceAccountId: 'wa-1', contactProfile: {} }, { store }).effective.replyLength.value, 'short');

  const removed = authority.mutatePreference('platform', platformScope, 'replyLength', 'delete', { store, actor: 'user' });
  assert.equal(removed.profile.effective.replyLength, undefined);
  const restored = authority.restoreVersion('platform', platformScope, initial.version, { store, actor: 'user' });
  assert.equal(restored.profile.effective.replyLength.value, 'short');
  assert.ok(authority.listVersions('platform', platformScope, { limit: 10 }, store).length >= 5);
}));

test('same platform different accounts never share platform learning', () => withStore(store => {
  for (let index = 1; index <= 4; index += 1) authority.recordFeedback(shortFeedback('a1-c1', 'whatsapp', index, 'wa-1'), { store });
  for (let index = 5; index <= 8; index += 1) authority.recordFeedback(shortFeedback('a1-c2', 'whatsapp', index, 'wa-1'), { store });
  const accountOne = authority.layered({ contactId: 'a1-c3', platform: 'whatsapp', sourceAccountId: 'wa-1', contactProfile: {} }, { store });
  const accountTwo = authority.layered({ contactId: 'a2-c1', platform: 'whatsapp', sourceAccountId: 'wa-2', contactProfile: {} }, { store });
  assert.equal(accountOne.effective.replyLength.value, 'short');
  assert.equal(accountOne.effective.replyLength.scope, 'platform');
  assert.equal(accountTwo.effective.replyLength, undefined);
  assert.notEqual(accountOne.layers.platform.id, accountTwo.layers.platform.id);
}));
