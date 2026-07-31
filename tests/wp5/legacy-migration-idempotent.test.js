'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { createAuthorityHarness } = require('./helpers');

test('repeated startup keeps one receipt and one authority initialization', async () => {
  const h=await createAuthorityHarness({initialize:false});
  try { const first=h.migration.ensureAuthority(); const second=h.migration.ensureAuthority(); const receipts=h.store.db.prepare('SELECT COUNT(*) AS n FROM runtime_migration_receipt').get(); assert.equal(first.stateVersion,1); assert.equal(second.stateVersion,1); assert.equal(receipts.n,1); }
  finally { await h.close(); }
});
