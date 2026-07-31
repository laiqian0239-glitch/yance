'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { R32SqliteStore } = require('../lib/r32SqliteStore');
const { StoreManager } = require('../store/StoreManager');
const { SqliteStorePersistenceAdapter } = require('../store/adapters/SqliteStorePersistenceAdapter');
const { registerAiReplyCommands } = require('../store/commands/registerAiReplyCommands');
const { ReplyFeedbackRepository } = require('../repositories/replyFeedbackRepository');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-feedback-version-'));
  const store = new R32SqliteStore({ dbPath: path.join(root, 'store.db') });
  store.upsertContact({ id: 'contact-1', platform: 'whatsapp', externalId: 'user-1', displayName: 'Contact' });
  const adapter = new SqliteStorePersistenceAdapter({ store });
  const manager = new StoreManager({ persistence: adapter });
  registerAiReplyCommands(manager);
  return { root, store, adapter, manager };
}

function cleanup(value) {
  try { value.store.close(); } catch (_) {}
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try { fs.rmSync(value.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); return; } catch (_) {}
  }
}

async function record(manager, index) {
  return manager.dispatch({
    type: 'AI_REPLY_FEEDBACK_RECORDED',
    source: 'test',
    payload: {
      evidenceId: `evidence-${index}`,
      eventType: 'sent',
      candidateId: `candidate-${index}`,
      outboxId: `outbox-${index}`,
      contactId: 'contact-1',
      conversationId: 'conversation-1',
      personaProfileId: 'owner',
      personaFeedbackProfile: {},
      originalText: 'This is an unnecessarily long generated answer with a question?',
      finalText: 'Short answer.',
      observedAt: `2026-07-16T00:00:0${index}.000Z`
    }
  });
}

test('reply feedback clear and restore are append-only versioned operations', async () => {
  const value = fixture();
  try {
    await value.manager.hydrate();
    await record(value.manager, 1);
    await record(value.manager, 2);
    await record(value.manager, 3);

    const repository = new ReplyFeedbackRepository(value.store);
    const learned = repository.getProfile('contact', 'contact-1');
    assert.equal(learned.version, 3);
    assert.equal(learned.profile.effective.replyLength.value, 'short');
    assert.deepEqual(repository.listVersions('contact', 'contact-1').map(row => row.version), [3, 2, 1]);

    await value.manager.dispatch({
      type: 'AI_REPLY_FEEDBACK_RESET',
      source: 'test',
      payload: { contactId: 'contact-1', resetBy: 'user' }
    });
    const cleared = repository.getProfile('contact', 'contact-1');
    assert.equal(cleared.version, 4);
    assert.deepEqual(cleared.profile.effective, {});
    assert.equal(repository.getVersion('contact', 'contact-1', 3).profile.effective.replyLength.value, 'short');

    const source = repository.getVersion('contact', 'contact-1', 3);
    await value.manager.dispatch({
      type: 'AI_REPLY_FEEDBACK_RESTORED',
      source: 'test',
      payload: {
        contactId: 'contact-1',
        profile: source.profile,
        sourceVersion: source.version,
        restoredBy: 'user'
      }
    });
    const restored = repository.getProfile('contact', 'contact-1');
    assert.equal(restored.version, 5);
    assert.equal(restored.profile.effective.replyLength.value, 'short');
    assert.match(repository.getVersion('contact', 'contact-1', 5).reason, /^restore:3:user$/);

    const snapshot = await new SqliteStorePersistenceAdapter({ store: value.store }).loadSnapshot();
    assert.equal(snapshot.memories.byContactId['contact-1'].feedbackLearning.version, 5);
    assert.equal(snapshot.memories.byContactId['contact-1'].feedbackLearning.effective.replyLength.value, 'short');
  } finally {
    cleanup(value);
  }
});
