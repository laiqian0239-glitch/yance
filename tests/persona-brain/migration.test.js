'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness } = require('./helpers');

test('legacy migration maps known sections and is idempotent by source fingerprint', () => {
  const harness = createHarness();
  try {
    const legacyDocument = {
      title: 'Legacy persona',
      locale: 'de-DE',
      identity: { displayName: 'Yeonhee Kim' },
      family: { father: { status: 'deceased' } },
      languages: { german: 'native' },
      chatStyles: { whatsappGerman: { maxSentences: 2 } },
      prohibitedClaims: ['Do not invent children']
    };
    const first = harness.service.migrateLegacy({
      profileId: 'owner',
      sourceKind: 'legacy-json',
      sourceId: 'persona.json',
      legacyDocument,
      reason: 'Import legacy persona source',
      createdAt: '2026-07-07T00:00:00.000Z'
    });
    assert.equal(first.migrated, true);
    assert.equal(first.version.version, 1);
    assert.equal(first.version.content.authoritative.coreIdentity.displayName, 'Yeonhee Kim');
    assert.equal(first.version.content.authoritative.languageCapabilities.german, 'native');
    assert.equal(first.version.content.authoritative.localizedChatStyles.whatsappGerman.maxSentences, 2);
    assert.deepEqual(first.version.content.authoritative.forbiddenFabrications, ['Do not invent children']);

    const second = harness.service.migrateLegacy({
      profileId: 'owner',
      sourceKind: 'legacy-json',
      sourceId: 'persona.json',
      legacyDocument,
      reason: 'Retry same import'
    });
    assert.equal(second.migrated, false);
    assert.equal(second.idempotent, true);
    assert.equal(harness.service.listVersions().length, 1);
  } finally {
    harness.close();
  }
});

test('failed legacy migration is recorded without creating a persona version', () => {
  const harness = createHarness();
  try {
    assert.throws(() => harness.service.migrateLegacy({
      sourceKind: 'legacy-json',
      sourceId: 'invalid.json',
      legacyDocument: ['not-an-object'],
      reason: 'invalid import'
    }), error => error.code === 'PERSONA_MIGRATION_SOURCE_INVALID');
    assert.equal(harness.service.getCurrent(), null);
    const run = harness.store.db.prepare('SELECT status, report_json FROM persona_brain_migration_runs').get();
    assert.equal(run.status, 'failed');
    assert.match(run.report_json, /PERSONA_MIGRATION_SOURCE_INVALID/);
  } finally {
    harness.close();
  }
});
