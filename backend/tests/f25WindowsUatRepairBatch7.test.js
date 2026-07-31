'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const socialChinese = require('../services/socialChineseUnderstandingService');
const { compilePersonaContext } = require('../personaBrain/compiler');
const { PersonaBrainService } = require('../personaBrain/service');
const { createPersonaValidator, validateAuthoritativeContent } = require('../personaBrain/validator');
const { createHarness } = require('../../tests/persona-brain/helpers');

function productionService(harness) {
  return new PersonaBrainService(harness.repository, {
    validator: createPersonaValidator({ validatorFn: validateAuthoritativeContent })
  });
}

test('Batch 7: Persona Chinese understanding repairs structure with the same model and records an auditable receipt', async () => {
  const calls = [];
  const result = await socialChinese.translateBundle({
    profile: { title: 'Fashion designer', facts: [{ label: 'City', value: 'Berlin' }] },
    fingerprint: 'persona-v1',
    dedupeKey: 'persona-v1'
  }, {
    aiGateway: {
      execute: async payload => {
        calls.push(payload);
        if (calls.length === 1) {
          return { modelId: 'translator-primary', model: 'Primary', structured: { profile: { title: '时装设计师' } }, attempts: [{ modelId: 'translator-primary', role: 'primary', status: 'success' }] };
        }
        return {
          modelId: 'translator-primary', model: 'Primary',
          structured: { profile: { title: '时装设计师', facts: [{ label: '城市', value: 'Berlin' }] }, analysis: {}, insights: {} },
          attempts: [{ modelId: 'translator-primary', role: 'primary', status: 'success' }]
        };
      }
    }
  });
  assert.equal(result.translationStatus, 'success');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].modelId, 'translator-primary');
  assert.equal(calls[1].options.onlyRequestedModel, true);
  assert.equal(result.translationReceipt.schemaRepairUsed, true);
  assert.equal(result.translationReceipt.structureIntegrity.pass, true);
  assert.equal(result.originalPreserved, true);
  assert.ok(result.translationReceipt.receiptSha256);
});

test('Batch 7: Persona Chinese understanding fails safely without replacing authoritative source', async () => {
  const result = await socialChinese.translateBundle({ profile: { title: 'Fashion designer' } }, {
    aiGateway: { execute: async () => { throw Object.assign(new Error('provider unavailable'), { code: 'HTTP_503' }); } }
  });
  assert.equal(result.translationStatus, 'failed');
  assert.deepEqual(result.translated, {});
  assert.equal(result.originalPreserved, true);
  assert.equal(result.safeForDisplayOnly, true);
  assert.equal(result.translationReceipt.status, 'failed');
  assert.equal(result.translationReceipt.reasonCode, 'HTTP_503');
  assert.equal(result.translationReceipt.structureIntegrity.pass, false);
});

test('Batch 7: live fictional Persona exposes style only and produces a truth-firewall receipt', () => {
  const harness = createHarness();
  try {
    const service = productionService(harness);
    const initialized = service.initializeDefault();
    const live = compilePersonaContext(initialized.version, { mode: 'live', socialContext: { relationshipPotential: { relationshipStage: 'deep_trust' } } });
    const packet = live.context.persona.truthSafePacket;
    assert.equal(packet.presentationProfile.name, undefined);
    assert.equal(packet.presentationProfile.age, undefined);
    assert.equal(packet.presentationProfile.city, undefined);
    assert.equal(packet.presentationProfile.occupation, undefined);
    assert.equal(packet.runtimeAuthority.pass, true);
    assert.equal(packet.runtimeAuthority.fictionalFactsIncluded, false);
    assert.ok(packet.runtimeAuthority.receiptSha256);

    const simulation = compilePersonaContext(initialized.version, { mode: 'simulation' });
    assert.equal(simulation.context.persona.truthSafePacket.presentationProfile.name, '金妍熙');
    assert.equal(simulation.context.persona.truthSafePacket.runtimeAuthority.pass, true);
  } finally {
    harness.close();
  }
});

test('Batch 7: Persona replacement requires a current field-level preview receipt and rollback verifies restored sections', () => {
  const harness = createHarness();
  try {
    const service = productionService(harness);
    service.initializeDefault({ createdAt: '2026-07-27T10:00:00.000Z' });
    const current = service.getCurrent('owner');
    const authoritative = JSON.parse(JSON.stringify(current.version.content.authoritative));
    authoritative.coreIdentity.displayName = 'Updated Persona Name';
    const preview = service.previewAuthoritativeReplacement({ profileId: 'owner', authoritative, createdAt: '2026-07-27T10:01:00.000Z' });
    assert.equal(preview.diff.changed, true);
    assert.ok(preview.diff.changedPaths.some(pathValue => pathValue.endsWith('.coreIdentity.displayName')));
    assert.throws(() => service.replaceAuthoritative({
      profileId: 'owner', authoritative, expectedVersion: 1, source: 'user', requirePreviewReceipt: true
    }), error => error.code === 'PERSONA_PREVIEW_RECEIPT_REQUIRED');
    const saved = service.replaceAuthoritative({
      profileId: 'owner', authoritative, expectedVersion: 1, source: 'user', actor: 'user', reason: 'Update display name',
      previewReceipt: preview.previewReceipt, requirePreviewReceipt: true, createdAt: '2026-07-27T10:01:00.000Z'
    });
    assert.equal(saved.changed, true);
    assert.equal(saved.version.metadata.approvalMode, 'explicit-user-save-after-diff-preview');
    const diff = service.diffVersions('owner', 1, 2);
    assert.equal(diff.diff.changed, true);
    const rollback = service.rollback({ profileId: 'owner', targetVersion: 1, expectedVersion: 2, actor: 'user' });
    assert.equal(rollback.rollbackVerification.authoritativeMatch, true);
    assert.equal(rollback.rollbackVerification.learnedMatch, true);
  } finally {
    harness.close();
  }
});

test('Batch 7: production reply candidates carry Persona truth receipts into approval and outbox metadata', () => {
  const root = path.resolve(__dirname, '..', '..');
  const brain = fs.readFileSync(path.join(root, 'backend/services/contextAwareReplyBrain.js'), 'utf8');
  const commands = fs.readFileSync(path.join(root, 'backend/store/commands/registerAiReplyCommands.js'), 'utf8');
  assert.match(brain, /personaTruthReceipt/);
  assert.match(brain, /PERSONA_TRUTH_FIREWALL_BLOCKED/);
  assert.match(commands, /personaTruthReceipt/);
  assert.match(commands, /Persona 真相防火墙未通过，禁止批准该回复候选/);
});


test('Batch 7: degraded Chinese understanding stays a readable business result and Persona save is preview-gated in the API and UI', () => {
  const root = path.resolve(__dirname, '..', '..');
  const storeRoute = fs.readFileSync(path.join(root, 'backend/routes/store.js'), 'utf8');
  const personaRoute = fs.readFileSync(path.join(root, 'backend/routes/personaBrain.js'), 'utf8');
  const personaUi = fs.readFileSync(path.join(root, 'frontend/js/r32-persona-runtime.js'), 'utf8');
  const chineseUi = fs.readFileSync(path.join(root, 'frontend/js/r32-phase1-governance-runtime.js'), 'utf8');
  assert.match(storeRoute, /degraded: result\.translationStatus !== 'success'/);
  assert.match(storeRoute, /status\(200\)/);
  assert.match(personaRoute, /authoritative\/preview/);
  assert.match(personaRoute, /requirePreviewReceipt: true/);
  assert.match(personaRoute, /\/:profileId\/diff/);
  assert.match(personaUi, /previewReceipt: preview\.previewReceipt/);
  assert.match(personaUi, /查看差异/);
  assert.match(chineseUi, /不会覆盖 Persona 原始内容/);
  assert.match(chineseUi, /翻译执行回执/);
});
