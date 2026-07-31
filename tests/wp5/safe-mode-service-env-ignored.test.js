'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const safeModeService = require('../../backend/services/safeModeService');

test('safeModeService ignores YANCE_SAFE_MODE and reflects only bound runtime authority', () => {
  const old = process.env.YANCE_SAFE_MODE;
  process.env.YANCE_SAFE_MODE = '1';
  try {
    safeModeService.bindAuthority(() => ({ operatingMode: 'normal', updatedAtUtc: '2026-07-05T00:00:00.000Z' }));
    assert.equal(safeModeService.read().operatingMode, 'normal');
    assert.equal(safeModeService.isActive(), false);
  } finally {
    if (old === undefined) delete process.env.YANCE_SAFE_MODE;
    else process.env.YANCE_SAFE_MODE = old;
  }
});
