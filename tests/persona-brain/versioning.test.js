'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness } = require('./helpers');

const INITIAL_TIME = '2026-07-07T00:00:00.000Z';
const UPDATE_TIME = '2026-07-07T00:01:00.000Z';

test('initialization creates immutable version 1 and an active profile pointer', () => {
  const harness = createHarness();
  try {
    const result = harness.service.initialize({
      profileId: 'owner',
      reason: 'Create owner persona baseline',
      createdAt: INITIAL_TIME,
      document: {
        authoritative: {
          coreIdentity: { displayName: 'Yeonhee Kim' },
          forbiddenFabrications: ['Do not invent family facts']
        },
        metadata: { title: 'Owner persona', locale: 'de-DE' }
      }
    });
    assert.equal(result.created, true);
    assert.equal(result.profile.activeVersion, 1);
    assert.equal(result.version.version, 1);
    assert.equal(result.version.parentVersion, 0);
    assert.equal(result.version.operation, 'create');
    assert.match(result.version.contentSha256, /^[a-f0-9]{64}$/);
    assert.equal(result.version.content.authoritative.coreIdentity.displayName, 'Yeonhee Kim');
    assert.deepEqual(result.version.content.authoritative.travelMemories, []);
    assert.deepEqual(result.version.content.learned.observations, []);
  } finally {
    harness.close();
  }
});

test('authoritative update appends a version and preserves prior content', () => {
  const harness = createHarness();
  try {
    harness.service.initialize({ reason: 'init', createdAt: INITIAL_TIME });
    const updated = harness.service.updateAuthoritative({
      expectedVersion: 1,
      reason: 'Add verified identity and language facts',
      createdAt: UPDATE_TIME,
      patch: {
        coreIdentity: { displayName: 'Yeonhee Kim', birthDate: '1985-06-25' },
        languageCapabilities: { writtenGerman: 'native' }
      }
    });
    assert.equal(updated.changed, true);
    assert.equal(updated.profile.activeVersion, 2);
    assert.equal(updated.version.parentVersion, 1);
    assert.deepEqual(updated.version.changedPaths, [
      'authoritative.coreIdentity.birthDate',
      'authoritative.coreIdentity.displayName',
      'authoritative.languageCapabilities.writtenGerman'
    ]);
    const previous = harness.service.getVersion('owner', 1);
    assert.equal(previous.content.authoritative.coreIdentity.displayName, undefined);
    assert.equal(updated.version.content.authoritative.coreIdentity.displayName, 'Yeonhee Kim');
    assert.equal(updated.version.content.learned.updatedAt, '');
  } finally {
    harness.close();
  }
});

test('optimistic version conflict rejects stale updates without partial writes', () => {
  const harness = createHarness();
  try {
    harness.service.initialize({ reason: 'init', createdAt: INITIAL_TIME });
    harness.service.updateAuthoritative({
      expectedVersion: 1,
      reason: 'first update',
      patch: { coreIdentity: { displayName: 'Yeonhee' } }
    });
    assert.throws(() => harness.service.updateAuthoritative({
      expectedVersion: 1,
      reason: 'stale update',
      patch: { coreIdentity: { displayName: 'Stale' } }
    }), error => error.code === 'PERSONA_VERSION_CONFLICT');
    assert.equal(harness.service.getCurrent().profile.activeVersion, 2);
    assert.equal(harness.service.listVersions().length, 2);
  } finally {
    harness.close();
  }
});
