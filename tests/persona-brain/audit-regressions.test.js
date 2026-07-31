'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness } = require('./helpers');
const { PersonaBrainService } = require('../../backend/personaBrain/service');
const { createPersonaValidator, validateAuthoritativeContent } = require('../../backend/personaBrain/validator');
const { compilePersonaContext } = require('../../backend/personaBrain/compiler');
const { inferContactLocation } = require('../../backend/personaBrain/truthFirewall');
const { createPersonaCandidateCoordinator } = require('../../backend/personaBrain/candidateCoordinator');

function productionValidator() {
  return createPersonaValidator({ validatorFn: validateAuthoritativeContent });
}

test('persona write and stale-candidate invalidation commit atomically', () => {
  const harness = createHarness();
  try {
    const service = new PersonaBrainService(harness.repository, {
      validator: productionValidator(),
      candidateCoordinator: {
        invalidateForPersonaVersion() {
          throw Object.assign(new Error('fault injection'), { code: 'INVALIDATION_FAULT' });
        },
        countReverifyRequired() { return { candidates: 0, outbox: 0, total: 0 }; }
      }
    });
    service.initializeDefault({ createdAt: '2026-07-13T10:00:00.000Z' });

    assert.throws(() => service.updateAuthoritative({
      expectedVersion: 1,
      patch: { coreIdentity: { occupation: 'Must roll back with invalidation failure' } },
      reason: 'fault injection write',
      source: 'user',
      createdAt: '2026-07-13T10:01:00.000Z'
    }), error => error.code === 'INVALIDATION_FAULT');

    const current = service.getCurrent('owner');
    assert.equal(current.profile.activeVersion, 1);
    assert.notEqual(current.version.content.authoritative.coreIdentity.occupation, 'Must roll back with invalidation failure');
  } finally {
    harness.close();
  }
});

test('non-owner persona changes invalidate only candidates bound to that profile', () => {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE ai_reply_candidates (
    candidate_id TEXT PRIMARY KEY, contact_id TEXT, conversation_id TEXT,
    persona_profile_id TEXT, persona_version_id INTEGER, state TEXT, updated_at TEXT
  ); CREATE TABLE ai_reply_outbox (
    id TEXT PRIMARY KEY, contact_id TEXT, conversation_id TEXT,
    persona_profile_id TEXT, persona_version_id INTEGER, state TEXT, updated_at TEXT
  );`);
  db.prepare(`INSERT INTO ai_reply_candidates VALUES (?,?,?,?,?,?,?)`).run('owner-c', 'c1', 'conv1', 'owner', 1, 'generated', '');
  db.prepare(`INSERT INTO ai_reply_candidates VALUES (?,?,?,?,?,?,?)`).run('secondary-c', 'c1', 'conv1', 'secondary-profile', 1, 'generated', '');
  db.prepare(`INSERT INTO ai_reply_outbox VALUES (?,?,?,?,?,?,?)`).run('owner-o', 'c1', 'conv1', 'owner', 1, 'draft', '');
  db.prepare(`INSERT INTO ai_reply_outbox VALUES (?,?,?,?,?,?,?)`).run('secondary-o', 'c1', 'conv1', 'secondary-profile', 1, 'draft', '');
  const coordinator = createPersonaCandidateCoordinator({ store: { db } });

  const result = coordinator.invalidateForPersonaVersion('secondary-profile', 2);
  assert.equal(result.invalidatedCandidates, 1);
  assert.equal(result.invalidatedOutbox, 1);
  assert.equal(db.prepare(`SELECT state FROM ai_reply_candidates WHERE candidate_id='owner-c'`).get().state, 'generated');
  assert.equal(db.prepare(`SELECT state FROM ai_reply_candidates WHERE candidate_id='secondary-c'`).get().state, 'reverify_required');
  assert.equal(db.prepare(`SELECT state FROM ai_reply_outbox WHERE id='owner-o'`).get().state, 'draft');
  assert.equal(db.prepare(`SELECT state FROM ai_reply_outbox WHERE id='secondary-o'`).get().state, 'reverify_required');
  assert.deepEqual(coordinator.countReverifyRequired('secondary-profile'), { candidates: 1, outbox: 1, total: 2 });
  db.close();
});

test('travel memories respect relationship-stage disclosure before entering live context', () => {
  const compiled = compilePersonaContext({
    version: 1,
    contentSha256: 'a'.repeat(64),
    content: {
      profileId: 'owner',
      schemaVersion: 1,
      authoritative: {
        coreIdentity: { mode: 'verified_real', truthPolicy: { liveReplyMode: 'verified_only' } },
        travelMemories: [
          { country: 'Austria', cities: ['Vienna'], truthStatus: 'user_verified_real', disclosure: 'deep_trust', privateNote: 'sensitive' }
        ],
        expressionMatrix: {},
        disclosureRules: {},
        forbiddenFabrications: []
      },
      learned: {},
      metadata: {}
    }
  }, {
    mode: 'live',
    socialContext: {
      customer: { city: 'Vienna', country: 'Austria' },
      relationshipPotential: { relationshipStage: 'new' }
    }
  });

  assert.deepEqual(compiled.context.persona.truthSafePacket.relevantTravel, []);
});

test('free-form user notes are not promoted to confirmed contact location', () => {
  const inferred = inferContactLocation({
    memory: {
      confirmedFacts: [],
      userNotes: [{ text: 'I live in Vienna for now, maybe moving soon', source: 'manual_note', confidence: 0.2 }]
    }
  });
  assert.equal(inferred.city, '');
  assert.equal(inferred.country, '');
  assert.equal(inferred.source, '');
});

test('runtime learned projection excludes identity, finance, travel and medical claims', () => {
  const compiled = compilePersonaContext({
    version: 1,
    contentSha256: 'b'.repeat(64),
    content: {
      profileId: 'owner',
      schemaVersion: 1,
      authoritative: {
        coreIdentity: { mode: 'verified_real', truthPolicy: { liveReplyMode: 'verified_only' } },
        expressionMatrix: {},
        disclosureRules: {},
        forbiddenFabrications: []
      },
      learned: {
        preferences: {
          tone: 'warm',
          replyLength: { value: 'short', confidence: 0.8 },
          identity: { claim: 'I am a billionaire' },
          travelHistory: ['Vienna'],
          medicalState: 'diagnosed'
        },
        interactionPatterns: {
          questionFrequency: 'low',
          bankAccount: 'DE00-SECRET'
        }
      },
      metadata: {}
    }
  }, { mode: 'live' });

  assert.equal(compiled.context.persona.learned.preferences.tone, 'warm');
  assert.equal(compiled.context.persona.learned.preferences.replyLength.value, 'short');
  assert.equal(compiled.context.persona.learned.preferences.identity, undefined);
  assert.equal(compiled.context.persona.learned.preferences.travelHistory, undefined);
  assert.equal(compiled.context.persona.learned.preferences.medicalState, undefined);
  assert.equal(compiled.context.persona.learned.interactionPatterns.questionFrequency, 'low');
  assert.equal(compiled.context.persona.learned.interactionPatterns.bankAccount, undefined);
});

test('approved AI change and stale-candidate invalidation commit atomically', () => {
  const harness = createHarness();
  try {
    const service = new PersonaBrainService(harness.repository, {
      validator: productionValidator(),
      candidateCoordinator: {
        invalidateForPersonaVersion() {
          throw Object.assign(new Error('fault injection'), { code: 'INVALIDATION_FAULT' });
        },
        countReverifyRequired() { return { candidates: 0, outbox: 0, total: 0 }; }
      }
    });
    service.initializeDefault({ createdAt: '2026-07-13T11:00:00.000Z' });
    const pending = service.proposeChange({
      patch: { coreIdentity: { occupation: 'Atomic approval test' } },
      reason: 'approval fault injection',
      createdAt: '2026-07-13T11:01:00.000Z'
    });

    assert.throws(() => service.decideChange({
      changeId: pending.changeId,
      decision: 'approved',
      reason: 'approve atomically',
      decidedBy: 'user',
      decidedAt: '2026-07-13T11:02:00.000Z'
    }), error => error.code === 'INVALIDATION_FAULT');

    assert.equal(service.getCurrent('owner').profile.activeVersion, 1);
    assert.equal(service.listPendingChanges('owner')[0].state, 'pending');
  } finally {
    harness.close();
  }
});

test('multi-version import and stale-candidate invalidation commit atomically', () => {
  const harness = createHarness();
  try {
    const service = new PersonaBrainService(harness.repository, {
      validator: productionValidator(),
      candidateCoordinator: {
        invalidateForPersonaVersion() {
          throw Object.assign(new Error('fault injection'), { code: 'INVALIDATION_FAULT' });
        },
        countReverifyRequired() { return { candidates: 0, outbox: 0, total: 0 }; }
      }
    });
    service.initializeDefault({ createdAt: '2026-07-13T12:00:00.000Z' });
    const payload = service.serialize('owner');

    assert.throws(() => service.deserialize({
      profileId: 'import-target',
      exportedPayload: payload,
      createdAt: '2026-07-13T12:01:00.000Z'
    }), error => error.code === 'INVALIDATION_FAULT');

    assert.equal(service.getCurrent('import-target'), null);
    assert.deepEqual(service.listVersions('import-target'), []);
  } finally {
    harness.close();
  }
});
