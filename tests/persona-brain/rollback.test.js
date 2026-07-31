'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness } = require('./helpers');

test('rollback is append-only and records the restored source version', () => {
  const harness = createHarness();
  try {
    harness.service.initialize({
      reason: 'init',
      createdAt: '2026-07-07T00:00:00.000Z',
      document: { authoritative: { coreIdentity: { displayName: 'Version One' } } }
    });
    harness.service.updateAuthoritative({
      expectedVersion: 1,
      reason: 'change name',
      createdAt: '2026-07-07T00:01:00.000Z',
      patch: { coreIdentity: { displayName: 'Version Two' } }
    });
    const rolledBack = harness.service.rollback({
      expectedVersion: 2,
      targetVersion: 1,
      reason: 'Restore accepted owner facts',
      createdAt: '2026-07-07T00:02:00.000Z'
    });
    assert.equal(rolledBack.version.version, 3);
    assert.equal(rolledBack.version.parentVersion, 2);
    assert.equal(rolledBack.version.rollbackOfVersion, 1);
    assert.equal(rolledBack.version.operation, 'rollback');
    assert.equal(rolledBack.version.content.authoritative.coreIdentity.displayName, 'Version One');
    assert.equal(harness.service.getVersion('owner', 2).content.authoritative.coreIdentity.displayName, 'Version Two');
    assert.equal(harness.service.listVersions().length, 3);
    const changes = harness.service.listChanges();
    assert.equal(changes[0].operation, 'rollback');
    assert.equal(changes[0].fromVersion, 2);
    assert.equal(changes[0].toVersion, 3);
  } finally {
    harness.close();
  }
});
