'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { createAuthorityHarness } = require('./helpers');

test('runtime_state is the only production SQL operating-mode writer', async () => {
  const h = await createAuthorityHarness();
  try {
    const root = path.resolve(__dirname, '../..');
    const allowed = path.join(root, 'backend/runtime/RuntimeStateStore.js');
    const violations = [];
    function walk(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (['node_modules', '.git', 'tests'].includes(entry.name)) continue;
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(file);
        else if (entry.name.endsWith('.js')) {
          const source = fs.readFileSync(file, 'utf8');
          if (/(?:INSERT INTO|UPDATE|DELETE FROM)\s+runtime_state/i.test(source) && file !== allowed) violations.push(path.relative(root, file));
        }
      }
    }
    walk(path.join(root, 'backend'));
    walk(path.join(root, 'electron'));
    assert.deepEqual(violations, []);
    assert.equal(h.store.snapshot().runtime.operatingMode, 'normal');
    assert.equal(h.store.validateRuntimeAuthority().receipt.status, 'COMMITTED');
  } finally { await h.close(); }
});
