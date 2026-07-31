'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createHarness } = require('./helpers');
const { PersonaBrainService } = require('../../backend/personaBrain/service');
const { createPersonaValidator, validateAuthoritativeContent } = require('../../backend/personaBrain/validator');
const { compilePersonaContext } = require('../../backend/personaBrain/compiler');
const {
  normalizeLocationToken,
  parseLocationText,
  inferContactLocation,
  findTravelMatches
} = require('../../backend/personaBrain/truthFirewall');
const { selectCustomerSocialContext } = require('../../backend/store/selectors/customerSocialSelectors');

function productionService(harness) {
  return new PersonaBrainService(harness.repository, {
    validator: createPersonaValidator({ validatorFn: validateAuthoritativeContent })
  });
}

test('default Yeonhee baseline is versioned, valid, and isolated from live replies', () => {
  const harness = createHarness();
  try {
    const service = productionService(harness);
    const initialized = service.initializeDefault({ createdAt: '2026-07-13T10:00:00.000Z' });
    assert.equal(initialized.created, true);
    assert.equal(initialized.version.version, 1);
    assert.equal(initialized.version.content.metadata.title, '金妍熙 · Yeonhee Kim');
    assert.equal(service.validate({ profileId: 'owner' }).valid, true);

    const socialContext = {
      customer: {
        city: 'Wien',
        country: 'Österreich',
        preferredLanguage: 'de-DE',
        relationshipStage: 'deep_trust'
      },
      relationshipPotential: { relationshipStage: 'deep_trust' }
    };
    const live = compilePersonaContext(initialized.version, { socialContext, mode: 'live' });
    assert.equal(live.safeFallback, false);
    assert.equal(live.context.persona.authoritative, undefined);
    assert.equal(live.context.persona.title, '');
    assert.deepEqual(live.context.persona.truthSafePacket.relevantTravel, []);
    assert.equal(live.context.persona.truthSafePacket.publicFacts.names, undefined);
    assert.equal(live.context.persona.truthSafePacket.publicFacts.languages, undefined);
    assert.equal(live.context.persona.truthSafePacket.truthFirewall.fictionalFactsIncluded, false);

    const simulation = compilePersonaContext(initialized.version, { socialContext, mode: 'simulation' });
    assert.equal(simulation.context.persona.truthSafePacket.publicFacts.names.en, 'Yeonhee Kim');
    assert.equal(simulation.context.persona.truthSafePacket.relevantTravel.some(row => row.country === 'Austria'), true);
    assert.equal(simulation.context.persona.truthSafePacket.truthFirewall.fictionalFactsIncluded, true);
  } finally {
    harness.close();
  }
});


test('invalid initial persona documents are rejected before version one is persisted', () => {
  const harness = createHarness();
  try {
    const service = new PersonaBrainService(harness.repository, {
      validator: createPersonaValidator({
        validatorFn: () => ({ valid: false, errors: [{ rule: 'BLOCK_INITIALIZE', message: 'blocked' }], warnings: [], checks: [] })
      })
    });
    assert.throws(
      () => service.initialize({ validateAuthoritative: true, document: { profileId: 'owner', authoritative: { coreIdentity: { mode: 'verified_real' } } } }),
      error => error.code === 'PERSONA_VALIDATION_FAILED'
    );
    assert.equal(service.getCurrent('owner'), null);
  } finally {
    harness.close();
  }
});

test('default preset is rejected before persistence when production validation fails', () => {
  const harness = createHarness();
  try {
    const service = new PersonaBrainService(harness.repository, {
      validator: createPersonaValidator({
        validatorFn: () => ({ valid: false, errors: [{ rule: 'BLOCK', message: 'blocked' }], warnings: [], checks: [] })
      })
    });
    assert.throws(() => service.initializeDefault(), error => error.code === 'PERSONA_VALIDATION_FAILED');
    assert.equal(harness.repository.getCurrent('owner'), null);
  } finally {
    harness.close();
  }
});

test('AI persona changes stay pending until a user approves or rejects them', () => {
  const harness = createHarness();
  try {
    const service = productionService(harness);
    service.initializeDefault();
    const suggestion = service.proposeChange({
      patch: { coreIdentity: { occupation: 'Updated occupation after user verification' } },
      evidence: [{ type: 'user-confirmation', id: 'evidence-1' }],
      reason: 'AI extracted a possible occupation update'
    });
    assert.equal(suggestion.state, 'pending');
    assert.equal(service.getCurrent().version.content.authoritative.coreIdentity.occupation.includes('Updated occupation'), false);

    const approved = service.decideChange({
      changeId: suggestion.changeId,
      decision: 'approved',
      decidedBy: 'user',
      reason: 'User confirmed the occupation'
    });
    assert.equal(approved.changed, true);
    assert.equal(approved.version.version, 2);
    assert.equal(approved.pendingChange.state, 'approved');
    assert.equal(approved.pendingChange.appliedVersion, 2);
    assert.equal(service.getCurrent().version.content.authoritative.coreIdentity.occupation, 'Updated occupation after user verification');

    const rejectedSuggestion = service.proposeChange({
      patch: { coreIdentity: { occupation: 'Unverified replacement' } },
      reason: 'Unverified AI suggestion'
    });
    const rejected = service.decideChange({ changeId: rejectedSuggestion.changeId, decision: 'rejected', reason: 'Not true' });
    assert.equal(rejected.changed, false);
    assert.equal(rejected.pendingChange.state, 'rejected');
    assert.equal(service.getCurrent().profile.activeVersion, 2);
  } finally {
    harness.close();
  }
});

test('AI and learning engines cannot bypass the pending approval workflow', () => {
  const harness = createHarness();
  try {
    const service = productionService(harness);
    service.initializeDefault();
    assert.throws(
      () => service.updateAuthoritative({
        source: 'ai-suggestion',
        patch: { coreIdentity: { occupation: 'Direct AI overwrite' } },
        reason: 'AI direct update'
      }),
      error => error.code === 'PERSONA_AI_AUTHORITATIVE_WRITE_REQUIRES_APPROVAL'
    );
    assert.equal(service.getCurrent().profile.activeVersion, 1);
    assert.equal(service.getCurrent().version.content.authoritative.coreIdentity.occupation.includes('Direct AI overwrite'), false);
  } finally {
    harness.close();
  }
});

test('pending approval and new persona version commit atomically', () => {
  const harness = createHarness();
  try {
    const service = productionService(harness);
    service.initializeDefault();
    const suggestion = service.proposeChange({
      patch: { coreIdentity: { occupation: 'Atomic update' } },
      reason: 'Atomic test'
    });
    harness.store.db.exec(`
      CREATE TRIGGER fail_persona_pending_approval
      BEFORE UPDATE ON persona_brain_pending_changes
      WHEN NEW.change_id='${suggestion.changeId}' AND NEW.state='approved'
      BEGIN SELECT RAISE(ABORT, 'forced approval failure'); END;
    `);
    assert.throws(() => service.decideChange({ changeId: suggestion.changeId, decision: 'approved' }));
    assert.equal(service.getCurrent().profile.activeVersion, 1);
    assert.equal(service.listVersions().length, 1);
    assert.equal(service.listPendingChanges()[0].state, 'pending');
  } finally {
    harness.close();
  }
});

test('stale AI suggestions cannot overwrite a newer user-authored persona version', () => {
  const harness = createHarness();
  try {
    const service = productionService(harness);
    service.initializeDefault();
    const suggestion = service.proposeChange({
      patch: { coreIdentity: { occupation: 'Stale AI occupation' } },
      reason: 'Possible update'
    });
    service.updateAuthoritative({
      expectedVersion: 1,
      patch: { coreIdentity: { occupation: 'Newer user-authored occupation' } },
      reason: 'User updated directly'
    });
    assert.throws(
      () => service.decideChange({ changeId: suggestion.changeId, decision: 'approved' }),
      error => error.code === 'PERSONA_PENDING_CHANGE_STALE'
    );
    assert.equal(service.getCurrent().version.content.authoritative.coreIdentity.occupation, 'Newer user-authored occupation');
    assert.equal(service.listPendingChanges()[0].state, 'pending');
  } finally {
    harness.close();
  }
});

test('invalid imports are rejected before any persona versions are written', () => {
  const harness = createHarness();
  try {
    const service = productionService(harness);
    assert.throws(
      () => service.importPersona({ exportedPayload: { profileId: 'owner', versions: [] } }),
      error => error.code === 'PERSONA_IMPORT_INVALID'
    );
    assert.equal(service.getCurrent(), null);

    assert.throws(
      () => service.importPersona({ exportedPayload: { versions: [{ content: null }] } }),
      error => error.code === 'PERSONA_IMPORT_INVALID'
    );
    assert.equal(service.getCurrent(), null);
  } finally {
    harness.close();
  }
});

test('confirmed contact location and language are exposed for grounded regional wording', () => {
  assert.equal(normalizeLocationToken('Deutschland'), 'germany');
  assert.equal(normalizeLocationToken('维也纳'), 'vienna');
  assert.deepEqual(parseLocationText('Ich wohne in Wien, Österreich.'), { city: 'Wien', country: 'Österreich', region: '' });

  const location = inferContactLocation({
    customer: { preferredLanguage: 'de-DE' },
    memory: { confirmedFacts: [{ key: 'city', value: 'Wien' }, { key: 'country', value: 'Österreich' }] }
  });
  assert.equal(location.city, 'Wien');
  assert.equal(location.country, 'Österreich');
  assert.equal(location.source, 'confirmed_memory');
  assert.equal(findTravelMatches([{ country: 'Austria', cities: ['Vienna'], truthStatus: 'user_verified_real' }], location, { liveVerifiedOnly: true }).length, 1);

  const selector = selectCustomerSocialContext('c1');
  const selected = selector({
    meta: { stateVersion: 1, domainVersions: { routing: 1 } },
    customers: {
      ready: true,
      byId: { c1: { id: 'c1', country: 'Austria', city: 'Vienna', region: 'Vienna', timezone: 'Europe/Vienna', preferredLanguage: 'de-DE', languages: 'de,en', version: 1 } }
    },
    relationships: { ready: true, byContactId: { c1: { version: 1 } }, timeline: [] },
    interactionPolicies: { ready: true, byContactId: { c1: { version: 1 } } },
    memories: { ready: true, byContactId: { c1: { version: 1 } } },
    conversations: { byContactId: { c1: [] }, byId: {}, recentMessagesById: {} },
    auth: { accountsById: {} }
  });
  assert.deepEqual({
    country: selected.customer.country,
    city: selected.customer.city,
    region: selected.customer.region,
    timezone: selected.customer.timezone,
    preferredLanguage: selected.customer.preferredLanguage,
    languages: selected.customer.languages
  }, {
    country: 'Austria', city: 'Vienna', region: 'Vienna', timezone: 'Europe/Vienna', preferredLanguage: 'de-DE', languages: 'de,en'
  });
});

test('Persona workbench assets and controls are wired into the active AI workbench', () => {
  const root = path.resolve(__dirname, '../..');
  const html = fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8');
  const workbench = fs.readFileSync(path.join(root, 'frontend/js/r32-ai-workbench-runtime.js'), 'utf8');
  const personaRuntime = fs.readFileSync(path.join(root, 'frontend/js/r32-persona-runtime.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'frontend/r32-persona.css'), 'utf8');
  assert.match(html, /data-aiw-tab="persona"/);
  assert.match(html, /id="aiwPersonaPanel"/);
  assert.match(html, /r32-persona\.css/);
  assert.match(html, /r32-persona-runtime\.js/);
  assert.match(workbench, /aiwPersonaValidate/);
  assert.match(workbench, /aiwPersonaExport/);
  assert.match(workbench, /aiwPersonaImport/);
  assert.match(workbench, /aiwPersonaSave/);
  assert.match(personaRuntime, /initialize-default/);
  assert.match(personaRuntime, /pending-changes/);
  assert.match(personaRuntime, /批准并生成新版本/);
  assert.match(css, /\.persona-grid/);
});

test('live compiled packet exposes only style-safe presentation fields and blocks fictional identity, wealth, relationship and travel facts', () => {
  const harness = createHarness();
  try {
    const service = productionService(harness);
    const initialized = service.initializeDefault();
    const compiled = compilePersonaContext(initialized.version, {
      mode: 'live',
      socialContext: {
        customer: { city: 'Vienna', country: 'Austria', preferredLanguage: 'de-DE' },
        relationshipPotential: { relationshipStage: 'deep_trust' }
      }
    });
    const serialized = JSON.stringify(compiled.context.persona);
    assert.equal(compiled.context.persona.truthSafePacket.presentationProfile.name, undefined);
    assert.equal(compiled.context.persona.truthSafePacket.presentationProfile.age, undefined);
    assert.ok(Array.isArray(compiled.context.persona.truthSafePacket.presentationProfile.expressionHabits));
    assert.equal(compiled.context.persona.truthSafePacket.runtimeAuthority.pass, true);
    for (const forbidden of ['Enzo Moretti', 'liquidAssets', 'tradingCapital', 'propertyValue']) {
      assert.equal(serialized.includes(forbidden), false, `live packet leaked ${forbidden}`);
    }
    assert.equal(compiled.context.persona.authoritative, undefined);
    assert.deepEqual(compiled.context.persona.truthSafePacket.relevantTravel, []);
  } finally {
    harness.close();
  }
});

test('verified real facts respect relationship-stage disclosure and confirmed travel matching', () => {
  const versionRecord = {
    version: 1,
    contentSha256: 'a'.repeat(64),
    content: {
      profileId: 'owner',
      schemaVersion: 1,
      authoritative: {
        coreIdentity: {
          mode: 'verified_real',
          names: { en: 'Verified User' },
          residence: { city: 'Berlin', country: 'Germany' },
          occupation: 'Designer',
          truthPolicy: { liveReplyMode: 'verified_only' }
        },
        familyAndUpbringing: {
          truthStatus: 'user_verified_real',
          disclosure: 'trust_building',
          summary: 'Verified family fact'
        },
        relationshipHistory: {
          truthStatus: 'user_verified_real',
          disclosure: 'deep_trust',
          summary: 'Verified relationship fact'
        },
        travelMemories: [
          { country: 'Austria', cities: ['Vienna'], truthStatus: 'user_verified_real', disclosure: 'familiar' },
          { country: 'France', cities: ['Paris'], truthStatus: 'unverified', disclosure: 'familiar' }
        ],
        expressionMatrix: { voice: { tone: 'warm' }, personality: { publicSide: ['calm'], privateSide: ['reflective'], boundaries: [] } },
        disclosureRules: {},
        forbiddenFabrications: []
      },
      learned: {},
      metadata: { title: 'Verified User', locale: 'de-DE' }
    }
  };

  const familiar = compilePersonaContext(versionRecord, {
    mode: 'live',
    socialContext: {
      customer: { city: 'Vienna', country: 'Austria', preferredLanguage: 'de-DE' },
      relationshipPotential: { relationshipStage: 'familiar' }
    }
  }).context.persona.truthSafePacket;
  assert.equal(familiar.sensitiveFactsAllowedNow.family, undefined);
  assert.equal(familiar.sensitiveFactsAllowedNow.relationshipHistory, undefined);
  assert.equal(familiar.relevantTravel.length, 1);
  assert.equal(familiar.relevantTravel[0].country, 'Austria');

  const trustBuilding = compilePersonaContext(versionRecord, {
    mode: 'live',
    socialContext: {
      customer: { city: 'Vienna', country: 'Austria' },
      relationshipPotential: { relationshipStage: 'trust_building' }
    }
  }).context.persona.truthSafePacket;
  assert.equal(trustBuilding.sensitiveFactsAllowedNow.family.summary, 'Verified family fact');
  assert.equal(trustBuilding.sensitiveFactsAllowedNow.relationshipHistory, undefined);

  const deepTrust = compilePersonaContext(versionRecord, {
    mode: 'live',
    socialContext: {
      customer: { city: 'Vienna', country: 'Austria' },
      relationshipPotential: { relationshipStage: 'deep_trust' }
    }
  }).context.persona.truthSafePacket;
  assert.equal(deepTrust.sensitiveFactsAllowedNow.relationshipHistory.summary, 'Verified relationship fact');
});

test('Persona workbench binds each pending-change button to exactly one decision request', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../frontend/js/r32-persona-runtime.js'), 'utf8');
  const handlers = source.match(/if \(button\.dataset\.personaChange\) decideChange/g) || [];
  assert.equal(handlers.length, 1);
});


test('Persona workbench preserves unsaved JSON across validation and tab rerenders', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../frontend/js/r32-persona-runtime.js'), 'utf8');
  assert.match(source, /draftText: ''/);
  assert.match(source, /state\.draftText = editor\.value/);
  assert.match(source, /state\.draftText \|\| prettyAuthoritative\(\)/);
  assert.equal(/async function validate[\s\S]*?state\.validation = payload\.validation;[\s\S]*?render\(\)/.test(source), true);
});

test('Persona version history import is idempotent and keeps source ordering', () => {
  const sourceHarness = createHarness();
  const targetHarness = createHarness();
  try {
    const sourceService = productionService(sourceHarness);
    sourceService.initializeDefault();
    sourceService.updateAuthoritative({
      expectedVersion: 1,
      patch: { coreIdentity: { occupation: 'Exported verified update' } },
      reason: 'Prepare second source version',
      source: 'user'
    });
    const exportedPayload = sourceService.exportPersona('owner');

    const targetService = productionService(targetHarness);
    const first = targetService.importPersona({ profileId: 'imported-owner', exportedPayload });
    assert.equal(first.imported, true);
    assert.equal(first.importedCount, 2);
    assert.equal(targetService.listVersions('imported-owner').length, 2);
    assert.equal(targetService.getCurrent('imported-owner').version.content.authoritative.coreIdentity.occupation, 'Exported verified update');

    const second = targetService.importPersona({ profileId: 'imported-owner', exportedPayload });
    assert.equal(second.imported, false);
    assert.equal(second.idempotent, true);
    assert.equal(targetService.listVersions('imported-owner').length, 2);
  } finally {
    sourceHarness.close();
    targetHarness.close();
  }
});

test('Persona multi-version import rolls back every version when a later database write fails', () => {
  const sourceHarness = createHarness();
  const targetHarness = createHarness();
  try {
    const sourceService = productionService(sourceHarness);
    sourceService.initializeDefault();
    sourceService.updateAuthoritative({
      expectedVersion: 1,
      patch: { coreIdentity: { occupation: 'Second imported version' } },
      reason: 'Create an import sequence',
      source: 'user'
    });
    const exportedPayload = sourceService.exportPersona('owner');

    targetHarness.store.db.exec(`
      CREATE TRIGGER fail_second_persona_import
      BEFORE INSERT ON persona_brain_versions
      WHEN NEW.profile_id='atomic-target' AND NEW.version=2 AND NEW.change_source='import'
      BEGIN SELECT RAISE(ABORT, 'forced second import failure'); END;
    `);
    const targetService = productionService(targetHarness);
    assert.throws(() => targetService.importPersona({ profileId: 'atomic-target', exportedPayload }));
    assert.equal(targetService.getCurrent('atomic-target'), null);
    assert.equal(targetService.listVersions('atomic-target').length, 0);
    assert.equal(targetHarness.repository.listChanges('atomic-target').length, 0);
  } finally {
    sourceHarness.close();
    targetHarness.close();
  }
});
