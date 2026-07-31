'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAccountSummary } = require('../../backend/services/accountSummaryProjection');

test('connected summary excludes accounts without usable credentials', () => {
  const rows = [
    { platform: 'whatsapp', state: 'connected', credentialReady: false, unread: 0 },
    { platform: 'telegram', state: 'connected', credentialReady: true, unread: 0 },
    { platform: 'facebook', state: 'waiting-verification', credentialReady: true, unread: 0 }
  ];
  const summary = buildAccountSummary(rows);
  assert.equal(summary.total, 3);
  assert.equal(summary.connected, 1);
  assert.equal(summary.platforms.find(row => row.platform === 'whatsapp').connected, 0);
});
