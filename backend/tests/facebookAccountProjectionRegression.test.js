'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Facebook account API preserves Business Suite reconciliation authority fields', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../services/accountManager.js'), 'utf8');
  for (const field of [
    'missingOptionalPermissions',
    'newMessagingReady',
    'historySyncAvailable',
    'historySyncReason',
    'reconciliationActive',
    'reconciliationRunning',
    'reconciliationLastAt',
    'reconciliationLastError',
    'reconciliationIntervalMs'
  ]) {
    assert.match(source, new RegExp(field + ':'));
  }
  assert.match(source, /FACEBOOK_HISTORY_PERMISSION_MISSING/u);
  assert.match(source, /pages_read_engagement 尚未授权，无法读取 Meta Business Suite 最近会话/u);
});
