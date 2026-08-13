'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const directorAuthority = require('../services/aiWorkbenchDirectorRuleAuthority');
const performancePolicy = require('../services/replyPerformancePolicy');
const { CandidateInteractionLearningService } = require('../services/candidateInteractionLearningService');
const { RuntimeRecoveryService } = require('../services/runtimeRecoveryService');
const runtimeErrors = require('../../frontend/js/r32-runtime-errors');

function memoryRepository(initial = null) {
  let value = initial;
  return {
    get(_namespace, _key, fallback) { return value == null ? fallback : JSON.parse(JSON.stringify(value)); },
    set(_namespace, _key, next) { value = JSON.parse(JSON.stringify(next)); return next; },
    read() { return value == null ? null : JSON.parse(JSON.stringify(value)); }
  };
}

test('Batch 10 seeds a default director stack once and preserves intentional deletion', () => {
  const repository = memoryRepository(null);
  const first = directorAuthority.ensureDefaults({ repository, now: '2026-07-27T00:00:00.000Z' });
  assert.equal(first.seeded, true);
  assert.equal(first.state.templates.length, 4);
  assert.ok(first.state.templates.every(row => row.enabled && row.systemSeeded));
  assert.ok(first.state.templates.some(row => row.templateId === 'template-natural-target-language'));
  assert.ok(first.state.templates.every(row => row.templateId !== 'template-natural-german'), 'default director rules must not force German across all conversations');

  const second = directorAuthority.ensureDefaults({ repository, now: '2026-07-27T00:01:00.000Z' });
  assert.equal(second.changed, false);
  assert.equal(second.state.templates.length, 4);

  const intentionallyCleared = { ...repository.read(), templates: [] };
  repository.set('ai-workbench', 'state', intentionallyCleared);
  const third = directorAuthority.ensureDefaults({ repository, now: '2026-07-27T00:02:00.000Z' });
  assert.equal(third.seeded, false);
  assert.equal(third.state.templates.length, 0, 'migration marker must prevent silently recreating user-deleted rules');
});

test('Batch 10 migrates the old system German default without overwriting user-owned rules', () => {
  const catalog = require('../services/aiWorkbenchDefaults').getTemplateCatalog();
  const german = catalog.find(row => row.id === 'template-natural-german');
  const repository = memoryRepository({
    directorDefaults: { migrationVersion: 1, templateCatalogVersion: 1, seeded: true },
    templates: [
      { id: 'default:template-natural-german', templateId: german.id, originTemplateId: german.id, name: german.name, body: german.body, priority: german.priority, enabled: true, systemSeeded: true, source: 'template-catalog-v1' },
      { id: 'user-german', templateId: german.id, name: '我的德语规则', body: '仅当联系人目标语言为德语时使用德语。', priority: 120, enabled: true, systemSeeded: false, source: 'user' }
    ],
    contactRules: {}
  });
  const result = directorAuthority.ensureDefaults({ repository, now: '2026-07-27T00:00:00.000Z' });
  assert.equal(result.languageNeutralMigration, true);
  assert.equal(result.state.directorDefaults.migrationVersion, 2);
  assert.ok(result.state.templates.some(row => row.templateId === 'template-natural-target-language'));
  assert.ok(result.state.templates.some(row => row.id === 'user-german'), 'user-owned language rule must be preserved');
  assert.ok(result.state.templates.every(row => row.id !== 'default:template-natural-german'));
});

test('Batch 10 director stack orders global, contact and temporary instructions and emits a stable receipt', () => {
  const repository = memoryRepository({
    directorDefaults: { migrationVersion: 1, templateCatalogVersion: 1, seeded: true },
    templates: [{ id: 'g1', name: '事实优先', body: '只使用已确认事实', priority: 100, enabled: true }],
    contactRules: { c1: [{ id: 'c1r', name: '关系节奏', body: '保持慢热', priority: 90, enabled: true }] }
  });
  const result = directorAuthority.resolve({ contactId: 'c1', conversationId: 'v1', director: { instruction: '本轮只回复一句' } }, { repository });
  assert.equal(result.receipt.pass, true);
  assert.equal(result.receipt.globalRuleCount, 1);
  assert.equal(result.receipt.contactRuleCount, 1);
  assert.equal(result.receipt.temporaryInstructionApplied, true);
  assert.equal(result.receipt.receiptSha256.length, 64);
  assert.match(result.director.instruction, /全局规则/);
  assert.match(result.director.instruction, /联系人规则/);
  assert.match(result.director.instruction, /临时导演指令·最高优先级/);
});

test('Batch 10 candidate policy always provides 3 to 5 selectable directions', () => {
  assert.equal(performancePolicy.policyFor({ performanceMode: 'rapid' }, {}).candidateCount, 3);
  assert.equal(performancePolicy.policyFor({ performanceMode: 'balanced' }, {}).candidateCount, 3);
  assert.equal(performancePolicy.policyFor({ performanceMode: 'deep' }, {}).candidateCount, 5);
});

test('Batch 10 blocks candidate learning without a passing Persona truth receipt', () => { const {routeLearningEligibility}=require('../services/candidateInteractionLearningService');assert.equal(routeLearningEligibility({personaTruthReceipt:{pass:false}}).eligible,false);assert.equal(routeLearningEligibility({personaTruthReceipt:{pass:false}}).reasonCode,'PERSONA_TRUTH_RECEIPT_NOT_LEARNING_ELIGIBLE'); });

test('Batch 10 runtime recovery blocks in safe mode and applies per-account exponential backoff', async () => {
  let authCalls = 0;
  const rows = [{ id: 'acc1', platform: 'whatsapp', state: 'disconnected', credentialReady: true }];
  const recoveryRepository = memoryRepository(null);
  const base = {
    repository: recoveryRepository,
    accountManager: { list: () => ({ accounts: rows }) },
    accountStore: { get: () => ({ id: 'acc1', platform: 'whatsapp', lifecycleState: 'active', enabled: true, credentialReady: true }) },
    sendQueue: { status: () => ({ writeBlocked: false, resumeBlocked: false, unknownOutcomeCount: 0 }), resume() {}, pause() {} },
    eventBus: { publish() {} },
    systemPolicy: { read: () => ({ emergencyStop: false }) },
    initialBackoffMs: 1000,
    maximumBackoffMs: 8000
  };

  const safe = new RuntimeRecoveryService({ ...base, safeModeService: { isActive: () => true }, platformAdapters: { async executeAuth() { authCalls += 1; } } });
  const safeStatus = await safe.recover('watchdog');
  assert.equal(authCalls, 0);
  assert.equal(safeStatus.lastRecoveryBlocked.code, 'SAFE_MODE_ACTIVE');

  const recovery = new RuntimeRecoveryService({
    ...base,
    safeModeService: { isActive: () => false },
    platformAdapters: { async executeAuth() { authCalls += 1; const error = new Error('temporary'); error.code = 'CONNECT_FAILED'; throw error; } }
  });
  const first = await recovery.recover('watchdog');
  assert.equal(first.lastRecovery[0].code, 'CONNECT_FAILED');
  assert.equal(first.lastRecovery[0].failureCount, 1);
  const callsAfterFirst = authCalls;
  const second = await recovery.recover('watchdog');
  assert.equal(authCalls, callsAfterFirst, 'backoff must prevent immediate duplicate connect attempts');
  assert.equal(second.lastRecovery[0].code, 'ACCOUNT_RECOVERY_BACKOFF');

  const restarted = new RuntimeRecoveryService({
    ...base,
    safeModeService: { isActive: () => false },
    platformAdapters: { async executeAuth() { authCalls += 1; } }
  });
  const afterRestart = await restarted.recover('watchdog');
  assert.equal(authCalls, callsAfterFirst, 'persisted backoff must survive an application restart');
  assert.equal(afterRestart.lastRecovery[0].code, 'ACCOUNT_RECOVERY_BACKOFF');
  assert.equal(afterRestart.attemptStateError, '');
});

test('Batch 10 user-facing runtime errors are localized while technical evidence remains available', () => {
  const whatsapp = runtimeErrors.createError({ error: { message: 'ReferenceError: mapWhatsAppState is not defined' } });
  assert.match(whatsapp.userMessage, /WhatsApp 状态处理失败/);
  assert.match(whatsapp.rawMessage, /mapWhatsAppState/);

  const timeout = runtimeErrors.createError({ error: { code: 'CORE_COMMAND_TIMEOUT', message: 'Core command timeout' } });
  assert.match(timeout.userMessage, /平台连接命令超时/);
  assert.equal(timeout.rawMessage, 'Core command timeout');

  const uuid = runtimeErrors.userMessage('27349886-6646-4304-8abc-123456789abc', { fallback: '操作失败' });
  assert.equal(uuid, '操作失败');
});

test('Batch 10 source contract removes false candidate counts and disables tuning before candidates exist', () => {
  const root = path.resolve(__dirname, '../..');
  const html = fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8');
  const conversation = fs.readFileSync(path.join(root, 'frontend/js/r32-conversation-center-v3.js'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'frontend/js/r32-ui-runtime.js'), 'utf8');
  const brain = fs.readFileSync(path.join(root, 'backend/services/contextAwareReplyBrain.js'), 'utf8');
  assert.match(html, /id="aiDailyCandidateHeading">快捷候选/);
  assert.match(html, /尚未生成候选/);
  assert.match(html, /生成 3–5 条方向不同/);
  assert.match(conversation, /button\.disabled=!rows\.length/);
  assert.match(conversation, /尚未生成候选/);
  assert.doesNotMatch(ui, /极速 1 条/);
  assert.match(brain, /directorRuleStackReceipt/);
  assert.match(brain, /aiWorkbenchDirectorRuleAuthority\.resolve/);
});
