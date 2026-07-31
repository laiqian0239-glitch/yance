'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness } = require('./helpers');

function objectWithUnsafeKey() {
  return JSON.parse('{"__proto__":{"polluted":true}}');
}

test('updates cannot write outside authoritative sections', () => {
  const harness = createHarness();
  try {
    harness.service.initialize({ reason: 'init' });
    assert.throws(() => harness.service.updateAuthoritative({
      reason: 'attempt learned overwrite',
      patch: { learned: { observations: ['untrusted'] } }
    }), error => error.code === 'PERSONA_PATCH_SECTION_NOT_ALLOWED');
    assert.equal(harness.service.getCurrent().profile.activeVersion, 1);
  } finally {
    harness.close();
  }
});

test('unsafe prototype keys are rejected before persistence', () => {
  const harness = createHarness();
  try {
    harness.service.initialize({ reason: 'init' });
    assert.throws(() => harness.service.updateAuthoritative({
      reason: 'unsafe patch',
      patch: { coreIdentity: objectWithUnsafeKey() }
    }), error => error.code === 'PERSONA_UNSAFE_KEY');
    assert.equal({}.polluted, undefined);
    assert.equal(harness.service.getCurrent().profile.activeVersion, 1);
  } finally {
    harness.close();
  }
});

test('learned updates cannot overwrite authoritative facts', () => {
  const harness = createHarness();
  try {
    harness.service.initialize({
      reason: 'init',
      document: { authoritative: { coreIdentity: { displayName: 'Authoritative Name' } } }
    });
    const learned = harness.service.updateLearned({
      expectedVersion: 1,
      reason: 'Store low-confidence interaction preference',
      createdAt: '2026-07-07T00:03:00.000Z',
      patch: { preferences: { replyLength: { value: 'short', confidence: 0.55 } } }
    });
    assert.equal(learned.version.operation, 'learn');
    assert.equal(learned.version.content.authoritative.coreIdentity.displayName, 'Authoritative Name');
    assert.equal(learned.version.content.learned.preferences.replyLength.value, 'short');
    assert.throws(() => harness.service.updateLearned({
      expectedVersion: 2,
      reason: 'attempt authority overwrite',
      patch: { authoritative: { coreIdentity: { displayName: 'Wrong' } } }
    }), error => error.code === 'PERSONA_LEARNED_SECTION_NOT_ALLOWED');
    assert.equal(harness.service.getCurrent().version.content.authoritative.coreIdentity.displayName, 'Authoritative Name');
  } finally {
    harness.close();
  }
});

test('section type mismatches are rejected instead of silently normalized', () => {
  const harness = createHarness();
  try {
    harness.service.initialize({ reason: 'init' });
    assert.throws(() => harness.service.updateAuthoritative({
      reason: 'invalid type',
      patch: { coreIdentity: ['not-an-object'] }
    }), error => error.code === 'PERSONA_PATCH_SECTION_TYPE_INVALID');
    assert.throws(() => harness.service.updateAuthoritative({
      reason: 'invalid array type',
      patch: { travelMemories: { city: 'Berlin' } }
    }), error => error.code === 'PERSONA_PATCH_SECTION_TYPE_INVALID');
    assert.equal(harness.service.getCurrent().profile.activeVersion, 1);
  } finally {
    harness.close();
  }
});
