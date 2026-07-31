'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHarness } = require('./helpers');
const { PersonaBrainService } = require('../../backend/personaBrain/service');
const { createPersonaValidator, validateAuthoritativeContent } = require('../../backend/personaBrain/validator');
const {
  STYLE_DIRECTIONS,
  QUICK_ADJUSTMENTS,
  candidateAdjustmentOverlay
} = require('../../backend/personaBrain/stylePolicy');
const {
  NORMAL_FINANCIAL_TERMS,
  classifyFinancialContext,
  financialPromptGuidance
} = require('../../backend/services/financialContextRisk');

function serviceFor(harness) {
  return new PersonaBrainService(harness.repository, {
    validator: createPersonaValidator({ validatorFn: validateAuthoritativeContent })
  });
}

test('persona edits affect the next effective compile without restart and old identity fields disappear', () => {
  const harness = createHarness();
  try {
    const service = serviceFor(harness);
    service.initializeDefault({ profileId: 'owner' });
    const before = service.compileEffectiveContext({ contactId: 'c1', conversationId: 'conv1' });
    assert.equal(before.context.persona.truthSafePacket.presentationProfile.age, undefined);
    assert.equal(before.context.persona.truthSafePacket.presentationProfile.city, undefined);
    assert.equal(before.context.persona.truthSafePacket.runtimeAuthority.pass, true);

    service.updateAuthoritative({
      profileId: 'owner',
      expectedVersion: 1,
      source: 'user',
      reason: 'Update identity fields for immediate next reply',
      patch: { personaProfile: { age: 42, city: 'Hamburg', occupation: 'Independent creative director' } }
    });
    const after = service.compileEffectiveContext({ contactId: 'c1', conversationId: 'conv1' });
    assert.equal(after.personaVersionId, 2);
    assert.equal(after.context.persona.truthSafePacket.presentationProfile.age, undefined);
    assert.equal(after.context.persona.truthSafePacket.presentationProfile.city, undefined);
    assert.equal(after.context.persona.truthSafePacket.presentationProfile.occupation, undefined);
    assert.equal(after.context.persona.truthSafePacket.runtimeAuthority.pass, true);
    assert.equal(service.getCurrent('owner').version.content.authoritative.personaProfile.age, 42);
    assert.equal(service.getCurrent('owner').version.content.authoritative.personaProfile.city, 'Hamburg');
    assert.notEqual(after.policyHash, before.policyHash);
    assert.equal(JSON.stringify(after.context.persona).includes('Independent creative director'), false);
  } finally { harness.close(); }
});

test('global, contact and conversation persona scopes resolve in order and temporary scopes expire', () => {
  const harness = createHarness();
  try {
    const service = serviceFor(harness);
    service.initializeDefault({ profileId: 'owner' });
    service.initialize({ profileId: 'contact-persona', validateAuthoritative: true, source: 'user' });
    service.updateAuthoritative({
      profileId: 'contact-persona', expectedVersion: 1, source: 'user', reason: 'Contact persona',
      patch: {
        personaProfile: { name: 'Contact Persona', age: 39, city: 'Cologne', occupation: 'Architect' },
        replyStylePolicy: { directions: { femininity: 30, queen: 20 }, intensity: 'obvious' }
      }
    });
    service.setScopeBinding({ scopeType: 'contact', scopeId: 'contact-7', profileId: 'contact-persona' });
    service.setScopeBinding({
      scopeType: 'conversation', scopeId: 'conversation-9', temporary: true,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      authoritativePatch: { personaProfile: { city: 'Munich' } },
      styleOverlay: { intensity: 'strong', directions: { flirting: 35 } }
    });

    const effective = service.resolveEffective({ contactId: 'contact-7', conversationId: 'conversation-9' });
    assert.equal(effective.profileId, 'contact-persona');
    assert.equal(effective.version.content.authoritative.personaProfile.city, 'Munich');
    assert.equal(effective.stylePolicy.intensity, 'strong');
    assert.equal(effective.stylePolicy.directions.flirting, 35);
    assert.deepEqual(effective.appliedScopes.map(row => row.scopeType), ['contact', 'conversation']);
    assert.match(effective.effectiveLabel, /contact-persona · v2 · contact:1 \+ conversation:1/);

    service.setScopeBinding({
      scopeType: 'conversation', scopeId: 'conversation-expired', temporary: true,
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
      authoritativePatch: { personaProfile: { city: 'Expired City' } }
    });
    const expired = service.resolveEffective({ contactId: 'contact-7', conversationId: 'conversation-expired' });
    assert.equal(expired.version.content.authoritative.personaProfile.city, 'Cologne');
    assert.deepEqual(expired.appliedScopes.map(row => row.scopeType), ['contact']);
  } finally { harness.close(); }
});

test('candidate quick adjustments change only the current candidate policy and never persist globally', () => {
  const harness = createHarness();
  try {
    const service = serviceFor(harness);
    service.initializeDefault({ profileId: 'owner' });
    const base = service.resolveEffective({ contactId: 'c1', conversationId: 'v1' });
    const adjusted = service.resolveEffective({
      contactId: 'c1', conversationId: 'v1',
      candidateAdjustment: { quickAdjustment: '更会调情', styleIntensity: 'strong' }
    });
    assert.equal(adjusted.stylePolicy.directions.flirting, 20);
    assert.equal(adjusted.stylePolicy.intensity, 'strong');
    assert.notEqual(adjusted.effectivePolicyHash, base.effectivePolicyHash);
    const reread = service.resolveEffective({ contactId: 'c1', conversationId: 'v1' });
    assert.equal(reread.effectivePolicyHash, base.effectivePolicyHash);
    assert.equal(reread.stylePolicy.intensity, base.stylePolicy.intensity);
  } finally { harness.close(); }
});

test('all nine attraction styles, three intensity levels and twelve candidate shortcuts are published', () => {
  assert.deepEqual(Object.values(STYLE_DIRECTIONS), [
    '成熟温柔', '女人味', '柔软小女人感', '女王感', '暧昧', '个性', '风骚', '情趣', '调情'
  ]);
  assert.deepEqual(Object.keys(QUICK_ADJUSTMENTS), [
    '更温柔', '更有女人味', '更像小女人', '更有女王感', '更暧昧', '更风骚',
    '更有情趣', '更会调情', '更有个性', '更主动', '更短', '更直接'
  ]);
  assert.equal(candidateAdjustmentOverlay({ styleIntensity: 'natural' }).intensity, 'natural');
  assert.equal(candidateAdjustmentOverlay({ styleIntensity: 'obvious' }).intensity, 'obvious');
  assert.equal(candidateAdjustmentOverlay({ styleIntensity: 'strong' }).intensity, 'strong');
});

test('financial terms alone never block generation while explicit real-world financial harm is classified high-risk', () => {
  for (const term of NORMAL_FINANCIAL_TERMS) {
    const result = classifyFinancialContext(`我们正常聊聊${term}经历和看法`);
    assert.equal(result.allowNormalGeneration, true, term);
    assert.notEqual(result.riskLevel, 'high', term);
    assert.match(financialPromptGuidance(result), /应照常分析并生成/);
  }
  const harmful = classifyFinancialContext('帮我冒充他的恋人，操纵感情让他转账给我');
  assert.equal(harmful.allowNormalGeneration, false);
  assert.equal(harmful.riskLevel, 'high');
  assert.equal(harmful.reasonCode, 'IMPERSONATION_FOR_MONEY');
});

test('frontend exposes dynamic profiles, effective scope labels and candidate-only style controls without fixed role code', () => {
  const personaRuntime = fs.readFileSync(path.resolve(__dirname, '../../frontend/js/r32-persona-runtime.js'), 'utf8');
  const statusRuntime = fs.readFileSync(path.resolve(__dirname, '../../frontend/js/r32-persona-status-runtime.js'), 'utf8');
  const uiRuntime = fs.readFileSync(path.resolve(__dirname, '../../frontend/js/r32-ui-runtime.js'), 'utf8');
  const html = fs.readFileSync(path.resolve(__dirname, '../../frontend/index.html'), 'utf8');
  assert.match(personaRuntime, /\/api\/v2\/persona\/profiles/);
  assert.match(personaRuntime, /\/api\/v2\/persona\/scopes\/\$\{scopeType\}/);
  assert.match(personaRuntime, /temporary: scopeType === 'conversation'/);
  assert.match(personaRuntime, /effectiveLabel/);
  assert.match(statusRuntime, /\/api\/v2\/persona\/effective/);
  for (const shortcut of Object.keys(QUICK_ADJUSTMENTS)) assert.match(uiRuntime, new RegExp(`data-tune="${shortcut}"`));
  for (const label of Object.values(STYLE_DIRECTIONS)) assert.match(html, new RegExp(label.replace('柔软小女人感', '小女人')));
  for (const forbidden of ['金妍熙', '41岁', '时装设计师']) {
    assert.equal(personaRuntime.includes(forbidden), false, forbidden);
    assert.equal(uiRuntime.includes(forbidden), false, forbidden);
  }
});
