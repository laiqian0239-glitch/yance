'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const routingIntegrity = require('../services/modelRoutingIntegrityService');

function routeFacts(route) {
  return {
    requested: route.requested,
    resolved: route.resolved,
    resolutionState: route.resolutionState,
    primary: route.primary,
    fallback: route.fallback,
    primarySelection: route.primarySelection,
    fallbackSelection: route.fallbackSelection
  };
}

test('legacy FIX6F manual-primary and auto-fallback route migrates deterministically to V2', () => {
  const legacy = {
    primary: 'claude-opus-5',
    fallback: 'gpt-5.6-sol',
    requestedPrimary: 'claude-opus-5',
    requestedFallback: 'gpt-5.6-sol',
    primarySelection: 'manual',
    fallbackSelection: 'auto',
    enabled: true,
    allowConditional: true,
    humanReviewRequired: true
  };

  const once = routingIntegrity.normalizeRoute(legacy, 'quick_reply');
  const twice = routingIntegrity.normalizeRoute(once, 'quick_reply');

  assert.deepEqual(routeFacts(twice), routeFacts(once));
  assert.deepEqual(once.requested.primary, { mode: 'manual', modelId: 'claude-opus-5' });
  assert.deepEqual(once.requested.fallback, { mode: 'auto', modelId: '' });
  assert.equal(once.resolved.fallback.modelId, 'gpt-5.6-sol');
  assert.equal(once.fallbackSelection, 'auto');
});
