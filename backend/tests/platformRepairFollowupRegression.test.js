'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { FacebookAdapter } = require('../services/facebookAdapter');

test('Facebook history profile enrichment delegates to durable execution authority with exact conversation identity', async () => {
  const adapter = new FacebookAdapter();
  const account = { id: 'facebook-account-a' };
  const tasks = Array.from({ length: 8 }, (_, index) => adapter.scheduleHistoryContactEnrichment(account, `peer-${index}`, `conversation-${index}`, `Fallback ${index}`));
  const duplicate = adapter.scheduleHistoryContactEnrichment(account, 'peer-0', 'conversation-duplicate', 'Duplicate');
  const results = await Promise.all([...tasks, duplicate]);
  assert.equal(results.length, 9);
  for (const result of results) {
    assert.equal(result.ok, false);
    assert.equal(result.delegated, true);
    assert.equal(result.authority, 'DurableExecutionAuthorityV2');
    assert.equal(result.operationKind, 'HISTORY_SYNCHRONIZATION');
    assert.equal(result.code, 'FACEBOOK_HISTORY_PROFILE_ENRICHMENT_DELEGATED');
    assert.equal(result.accountId, 'facebook-account-a');
  }
  assert.equal(results[0].peerId, 'peer-0');
  assert.equal(results[0].conversationId, 'conversation-0');
  assert.equal(results[0].fallbackName, 'Fallback 0');
  assert.equal(results[8].peerId, 'peer-0');
  assert.equal(results[8].conversationId, 'conversation-duplicate');
  assert.equal(results[8].fallbackName, 'Duplicate');
});

test('Facebook profile fan-out delegate preserves late-registered conversation identity', async () => {
  const adapter = new FacebookAdapter();
  const account = { id: 'facebook-account-late' };
  const first = adapter.scheduleHistoryContactEnrichment(account, 'peer-late', 'conversation-first', 'First');
  const late = adapter.scheduleHistoryContactEnrichment(account, 'peer-late', 'conversation-late', 'Late');
  const [firstResult, lateResult] = await Promise.all([first, late]);
  assert.equal(firstResult.delegated, true);
  assert.equal(firstResult.code, 'FACEBOOK_HISTORY_PROFILE_ENRICHMENT_DELEGATED');
  assert.equal(firstResult.conversationId, 'conversation-first');
  assert.equal(firstResult.fallbackName, 'First');
  assert.equal(lateResult.delegated, true);
  assert.equal(lateResult.code, 'FACEBOOK_HISTORY_PROFILE_ENRICHMENT_DELEGATED');
  assert.equal(lateResult.conversationId, 'conversation-late');
  assert.equal(lateResult.fallbackName, 'Late');
});
