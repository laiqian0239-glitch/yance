'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const routing = require('../services/modelRoutingIntegrityService');

test('user activation intent remains enabled while an auto route is waiting for a usable model', () => {
  const repaired = routing.validateRoutes({
    quick_reply: {
      primarySelection: 'auto',
      fallbackSelection: 'auto',
      requestedEnabled: true,
      enabled: true,
      allowConditional: true,
      maxTokens: 220
    }
  }, [], { throwOnInvalid: true, autoSelect: true }).repairedRoutes.quick_reply;

  assert.equal(repaired.requestedEnabled, true);
  assert.equal(repaired.enabled, true);
  assert.equal(repaired.operational, false);
  assert.equal(repaired.primary, '');
});
