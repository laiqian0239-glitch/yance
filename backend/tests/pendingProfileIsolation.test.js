'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { R32SqliteStore } = require('../lib/r32SqliteStore');
const { SqliteStorePersistenceAdapter } = require('../store/adapters/SqliteStorePersistenceAdapter');
const {
  upsertProfile,
  getProfile,
  reviewPendingProfile
} = require('../repositories/workspaceRepository');

function makeStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-profile-review-'));
  const store = new R32SqliteStore({ dbPath: path.join(root, 'profile.db') });
  store.db.prepare(`
    INSERT INTO contacts(id, display_name, created_at, updated_at)
    VALUES ('contact-1', 'Contact', '2026-07-16T00:00:00.000Z', '2026-07-16T00:00:00.000Z')
  `).run();
  return { root, store };
}

function cleanup(value) {
  try { value.store.close(); } catch (_) {}
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try { fs.rmSync(value.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); return; } catch (_) {}
  }
}

test('ai-pending-review profile remains isolated until explicit approval', async () => {
  const value = makeStore();
  try {
    upsertProfile('contact-1', {
      facts: { city: 'Berlin', job: 'Designer' },
      confirmedFacts: [{ key: 'city', value: 'Berlin', text: '城市：Berlin' }]
    }, { reviewStatus: 'manual' }, value.store);

    upsertProfile('contact-1', {
      facts: { city: 'Paris', age: '41' },
      confirmedFacts: [{ key: 'city', value: 'Paris', text: '城市：Paris' }],
      inferredFacts: [{ key: 'age', value: '41', text: '年龄：41' }]
    }, {
      reviewStatus: 'ai-pending-review',
      modelId: 'local-model',
      sourceMessageCount: 20
    }, value.store);

    const pending = getProfile('contact-1', value.store);
    assert.equal(pending.facts.city, 'Berlin');
    assert.equal(pending.facts.age, undefined);
    assert.equal(pending.pendingReview.profile.facts.city, 'Paris');
    assert.equal(pending.reviewStatus, 'ai-pending-review');

    const adapter = new SqliteStorePersistenceAdapter({ store: value.store });
    const snapshot = await adapter.loadSnapshot();
    assert.equal(snapshot.memories.byContactId['contact-1'].confirmedFacts[0].text, '城市：Berlin');
    assert.equal(snapshot.memories.byContactId['contact-1'].inferredFacts.length, 0);

    const approved = reviewPendingProfile('contact-1', { decision: 'approved', decidedBy: 'user' }, value.store);
    assert.equal(approved.profile.facts.city, 'Paris');
    assert.equal(approved.profile.facts.age, '41');
    assert.deepEqual(approved.profile.pendingReview, {});
    assert.equal(approved.profile.reviewStatus, 'approved');
  } finally {
    cleanup(value);
  }
});

test('rejecting a pending profile restores previous effective profile', () => {
  const value = makeStore();
  try {
    upsertProfile('contact-1', { facts: { city: 'Berlin' } }, { reviewStatus: 'manual', sourceMessageCount: 7, modelId: 'manual-source' }, value.store);
    upsertProfile('contact-1', { facts: { city: 'Paris' } }, { reviewStatus: 'ai-pending-review' }, value.store);
    const rejected = reviewPendingProfile('contact-1', {
      decision: 'rejected',
      decidedBy: 'user',
      reason: 'No evidence'
    }, value.store);
    assert.equal(rejected.profile.facts.city, 'Berlin');
    assert.deepEqual(rejected.profile.pendingReview, {});
    assert.equal(rejected.profile.reviewStatus, 'manual');
    assert.equal(rejected.profile.sourceMessageCount, 7);
    assert.equal(rejected.profile.modelId, 'manual-source');
  } finally {
    cleanup(value);
  }
});
