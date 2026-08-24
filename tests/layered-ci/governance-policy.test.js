'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  classifyChangedFiles,
  validateLifecyclePolicy,
  validateRiskPolicy,
  validateTransition
} = require('../../tools/layered-ci/governance-policy');

const ROOT = path.resolve(__dirname, '..', '..');
const lifecycle = JSON.parse(fs.readFileSync(path.join(ROOT, 'governance/layered-ci/task-lifecycle.json'), 'utf8'));
const risk = JSON.parse(fs.readFileSync(path.join(ROOT, 'governance/layered-ci/risk-policy.json'), 'utf8'));

test('lifecycle policy is structurally valid and keeps provisional green open', () => {
  assert.equal(validateLifecyclePolicy(lifecycle).pass, true);
  assert.equal(lifecycle.greenProvisionalIsClosed, false);
  assert.equal(lifecycle.independentReviewBeforeClosed, true);
  assert.equal(lifecycle.readyForPromotion, false);
});

test('direct GREEN_PROVISIONAL to CLOSED transition is forbidden', () => {
  const result = validateTransition(lifecycle, 'GREEN_PROVISIONAL', 'CLOSED', {
    independentReviewPassed: true,
    l2EvidencePassed: true,
    candidateShaFrozen: true
  });
  assert.equal(result.pass, false);
  assert.equal(result.reasonCode, 'TASK_TRANSITION_NOT_ALLOWED');
});

test('INDEPENDENT_REVIEW to CLOSED requires frozen candidate, review and L2 evidence', () => {
  const denied = validateTransition(lifecycle, 'INDEPENDENT_REVIEW', 'CLOSED', {
    candidateShaFrozen: true,
    independentReviewPassed: true,
    l2EvidencePassed: false
  });
  assert.equal(denied.pass, false);
  assert.equal(denied.reasonCode, 'TASK_TRANSITION_REQUIREMENT_MISSING');
  assert.deepEqual(denied.missingRequirements, ['l2EvidencePassed']);

  const accepted = validateTransition(lifecycle, 'INDEPENDENT_REVIEW', 'CLOSED', {
    candidateShaFrozen: true,
    independentReviewPassed: true,
    l2EvidencePassed: true
  });
  assert.equal(accepted.pass, true);
  assert.equal(accepted.nextState, 'CLOSED');
});

test('closed task only reopens when original evidence is invalid', () => {
  const denied = validateTransition(lifecycle, 'CLOSED', 'REOPENED_INVALID_EVIDENCE', {
    reopenReasonAuthorized: true,
    reopenReasonCode: 'NEW_ATTACK_SURFACE'
  });
  assert.equal(denied.pass, false);
  assert.equal(denied.reasonCode, 'TASK_REOPEN_REASON_INVALID');

  const accepted = validateTransition(lifecycle, 'CLOSED', 'REOPENED_INVALID_EVIDENCE', {
    reopenReasonAuthorized: true,
    reopenReasonCode: 'VERIFIED_SHA_MISMATCH'
  });
  assert.equal(accepted.pass, true);
});

test('risk policy is strict and rejects wildcard escalation rules', () => {
  assert.equal(validateRiskPolicy(risk).pass, true);
  const invalid = validateRiskPolicy({
    ...risk,
    l2Prefixes: [...risk.l2Prefixes, 'backend/**']
  });
  assert.equal(invalid.pass, false);
  assert.equal(invalid.reasonCode, 'CI_RISK_RULE_INVALID');
});

test('documentation-only changes stay at L0', () => {
  const result = classifyChangedFiles(risk, [
    'docs/architecture/new-governance.md',
    'README.md'
  ]);
  assert.equal(result.pass, true);
  assert.equal(result.requiredLevel, 'L0');
});

test('README-like executable names are not treated as documentation', () => {
  const result = classifyChangedFiles(risk, ['README-run.js']);
  assert.equal(result.pass, false);
  assert.equal(result.reasonCode, 'CI_UNKNOWN_PATH');
});

test('ordinary product or test code uses L1', () => {
  const result = classifyChangedFiles(risk, [
    'frontend/components/ConversationHeader.jsx',
    'tests/uat/conversation-header.test.js'
  ]);
  assert.equal(result.pass, true);
  assert.equal(result.requiredLevel, 'L1');
});

test('runtime, SQLite, workflows, WP0 and package changes escalate to L2', () => {
  for (const file of [
    'backend/runtime/AppRuntime.js',
    'backend/lib/sqliteOwnership.js',
    '.github/workflows/release.yml',
    'tools/wp0/verify-gate.js',
    'shared/release/implementationBranchPolicy.js',
    'package-lock.json',
    'governance/layered-ci/risk-policy.json'
  ]) {
    const result = classifyChangedFiles(risk, [file]);
    assert.equal(result.pass, true, file);
    assert.equal(result.requiredLevel, 'L2', file);
  }
});

test('Electron custody and source-control authority paths escalate to L2', () => {
  for (const file of [
    '.gitattributes',
    '.gitignore',
    'release/electron-distribution-trust.json',
    'release/production-dependency-binding.json',
    'vendor/electron/electron-v39.8.5-win32-x64.zip',
    'vendor/npm/_at_electron-internal__extract-zip-1.0.3.tgz',
    'vendor/npm/_at_electron__get-5.0.0.tgz',
    'vendor/npm/_at_types__node-24.10.13.tgz',
    'vendor/npm/electron-43.4.1.tgz',
    'vendor/npm/env-paths-3.0.0.tgz',
    'vendor/npm/undici-7.25.0.tgz',
    'vendor/npm/undici-types-7.16.0.tgz'
  ]) {
    const result = classifyChangedFiles(risk, [file]);
    assert.equal(result.pass, true, file);
    assert.equal(result.requiredLevel, 'L2', file);
  }
});

test('nested dependency manifests always escalate to L2', () => {
  for (const file of [
    'packages/desktop/package.json',
    'backend/plugins/identity/package-lock.json'
  ]) {
    const result = classifyChangedFiles(risk, [file]);
    assert.equal(result.pass, true, file);
    assert.equal(result.requiredLevel, 'L2', file);
    assert.equal(result.reasons[0].type, 'BASENAME', file);
  }
});

test('L3 is never selected automatically', () => {
  const result = classifyChangedFiles(risk, ['electron/main.js']);
  assert.equal(result.requiredLevel, 'L2');
  assert.equal(result.promotionRequired, false);
});

test('invalid repository paths fail closed', () => {
  const result = classifyChangedFiles(risk, ['../escape.js']);
  assert.equal(result.pass, false);
  assert.equal(result.reasonCode, 'CI_CHANGED_PATH_INVALID');
});

test('syntactically valid but unclassified paths fail closed', () => {
  const result = classifyChangedFiles(risk, ['unclassified/new-gate.js']);
  assert.equal(result.pass, false);
  assert.equal(result.reasonCode, 'CI_UNKNOWN_PATH');
  assert.deepEqual(result.unknownPaths, ['unclassified/new-gate.js']);
});

test('checked-in supply-chain inventories always escalate to L2', () => {
  for (const file of [
    'THIRD_PARTY_NOTICES.md',
    'third_party/github-actions-lock.json',
    'third_party/licenses/actions-checkout-MIT.txt',
    'third_party/provenance.json',
    'third_party/sbom.cdx.json'
  ]) {
    const result = classifyChangedFiles(risk, [file]);
    assert.equal(result.pass, true, file);
    assert.equal(result.requiredLevel, 'L2', file);
  }
});

test('bilingual Product integration paths are classified at exact L2 risk', () => {
  for (const file of [
    'integration/element-module/src/YanceWorkspace.tsx',
    'integration/element-module/src/index.tsx',
    'integration/element-module/src/product-experience/BilingualSearchPanel.tsx',
    'integration/element-module/src/product-experience/ProductExperienceShell.css',
    'integration/element-module/src/product-experience/ProductExperienceShell.tsx',
    'integration/element-module/src/product-experience/experienceProjection.ts',
    'integration/element-module/src/product-experience/experienceTypes.ts'
  ]) {
    const result = classifyChangedFiles(risk, [file]);
    assert.equal(result.pass, true, file);
    assert.equal(result.requiredLevel, 'L2', file);
    assert.equal(result.reasons[0].type, 'EXACT', file);
  }
});

test('Product final Element dependency patch is classified at exact L2 risk', () => {
  const file = 'upstream-patches/element-web/0011-yance-product-experience-dependency-lock.patch';
  const result = classifyChangedFiles(risk, [file]);
  assert.equal(result.pass, true, file);
  assert.equal(result.requiredLevel, 'L2', file);
  assert.equal(result.reasons[0].type, 'EXACT', file);
});

test('adaptive local LLM risk identities use exact L2 without broad-prefix expansion', () => {
  const targetPaths = [
    'config/local-ai/adaptive-local-model-catalog-v1.json',
    'config/upstreams/v21-adaptive-local-llm-runtime-p0-v1.json',
    'runtime/local-ai/airllm/yance_airllm_worker.py'
  ];
  for (const file of targetPaths) {
    const result = classifyChangedFiles(risk, [file]);
    assert.equal(result.pass, true, file);
    assert.equal(result.requiredLevel, 'L2', file);
    assert.equal(result.reasons[0].type, 'EXACT', file);
  }

  assert.deepEqual(risk.l2ExactPaths, [
    '.gitattributes',
    '.gitignore',
    'THIRD_PARTY_NOTICES.md',
    'config/local-ai/adaptive-local-model-catalog-v1.json',
    'config/upstreams/v21-adaptive-local-llm-runtime-p0-v1.json',
    'integration/element-module/src/LearningWorkspace.tsx',
    'integration/element-module/src/MediaWorkspace.tsx',
    'integration/element-module/src/PresenceWorkspace.tsx',
    'integration/element-module/src/VoiceWorkspace.tsx',
    'integration/element-module/src/YanceWorkspace.tsx',
    'integration/element-module/src/index.tsx',
    'integration/element-module/src/product-experience/BilingualSearchPanel.tsx',
    'integration/element-module/src/product-experience/PersonalAccessSurface.tsx',
    'integration/element-module/src/product-experience/ProductExperienceShell.css',
    'integration/element-module/src/product-experience/ProductExperienceShell.tsx',
    'integration/element-module/src/product-experience/ProductSystemSettingsSurface.tsx',
    'integration/element-module/src/product-experience/experienceProjection.ts',
    'integration/element-module/src/product-experience/experienceTypes.ts',
    'package-lock.json',
    'package.json',
    'release/electron-distribution-trust.json',
    'release/production-dependency-binding.json',
    'runtime/local-ai/airllm/yance_airllm_worker.py',
    'upstream-patches/element-web/0011-yance-product-experience-dependency-lock.patch',
    'vendor/electron/electron-v39.8.5-win32-x64.zip',
    'vendor/npm/_at_electron-internal__extract-zip-1.0.3.tgz',
    'vendor/npm/_at_electron__get-5.0.0.tgz',
    'vendor/npm/_at_types__node-24.10.13.tgz',
    'vendor/npm/electron-43.4.1.tgz',
    'vendor/npm/env-paths-3.0.0.tgz',
    'vendor/npm/undici-7.25.0.tgz',
    'vendor/npm/undici-types-7.16.0.tgz'
  ]);
  assert.deepEqual(risk.l2Prefixes, [
    '.github/',
    'backend/lib/sqlite',
    'backend/runtime/',
    'backend/migrations/',
    'backend/services/authority',
    'backend/services/backup',
    'backend/services/recovery',
    'electron/',
    'governance/',
    'shared/release/',
    'third_party/',
    'tools/layered-ci/',
    'tools/wp0/'
  ]);
  assert.equal(risk.unknownPathFailsClosed, true);
  assert.equal(risk.l3Automatic, false);

  for (const file of [
    'config/local-ai/unregistered-adaptive-local.json',
    'config/upstreams/unregistered-adaptive-local.json',
    'runtime/local-ai/unregistered_worker.py'
  ]) {
    const result = classifyChangedFiles(risk, [file]);
    assert.equal(result.pass, false, file);
    assert.equal(result.reasonCode, 'CI_UNKNOWN_PATH', file);
    assert.deepEqual(result.unknownPaths, [file], file);
  }
});

test('WP3 routing prerequisite Product identities use exact L2 without broad-prefix expansion', () => {
  const targetPaths = [
    'integration/element-module/src/LearningWorkspace.tsx',
    'integration/element-module/src/MediaWorkspace.tsx',
    'integration/element-module/src/PresenceWorkspace.tsx',
    'integration/element-module/src/VoiceWorkspace.tsx',
    'integration/element-module/src/product-experience/PersonalAccessSurface.tsx'
  ];

  for (const file of targetPaths) {
    const result = classifyChangedFiles(risk, [file]);
    assert.equal(result.pass, true, `${file}: ${JSON.stringify(result)}`);
    assert.equal(result.requiredLevel, 'L2', file);
    assert.equal(result.reasons[0].type, 'EXACT', file);
  }

  for (const prefix of ['integration/', 'integration/element-module/']) {
    assert.equal(risk.l2Prefixes.includes(prefix), false, prefix);
  }

  for (const file of [
    'integration/element-module/src/UnregisteredWorkspace.tsx',
    'integration/element-module/src/product-experience/UnregisteredSurface.tsx'
  ]) {
    const result = classifyChangedFiles(risk, [file]);
    assert.equal(result.pass, false, `${file}: ${JSON.stringify(result)}`);
    assert.equal(result.reasonCode, 'CI_UNKNOWN_PATH', file);
    assert.deepEqual(result.unknownPaths, [file], file);
  }

  assert.equal(risk.unknownPathFailsClosed, true);
  assert.equal(risk.l3Automatic, false);
});

test('Product system settings routing prerequisite identity uses exact L2 without broad-prefix expansion', () => {
  const targetPaths = [
    'integration/element-module/src/product-experience/ProductSystemSettingsSurface.tsx'
  ];

  for (const file of targetPaths) {
    const result = classifyChangedFiles(risk, [file]);
    assert.equal(result.pass, true, `${file}: ${JSON.stringify(result)}`);
    assert.equal(result.requiredLevel, 'L2', file);
    assert.equal(result.reasons[0].type, 'EXACT', file);
  }

  for (const prefix of ['integration/', 'integration/element-module/']) {
    assert.equal(risk.l2Prefixes.includes(prefix), false, prefix);
  }

  for (const file of [
    'integration/element-module/src/product-experience/ProductSystemSettingsSurface.unapproved.tsx',
    'integration/element-module/src/product-experience/UnregisteredSurface.tsx'
  ]) {
    const result = classifyChangedFiles(risk, [file]);
    assert.equal(result.pass, false, `${file}: ${JSON.stringify(result)}`);
    assert.equal(result.reasonCode, 'CI_UNKNOWN_PATH', file);
    assert.deepEqual(result.unknownPaths, [file], file);
  }

  assert.equal(risk.unknownPathFailsClosed, true);
  assert.equal(risk.l3Automatic, false);
});
