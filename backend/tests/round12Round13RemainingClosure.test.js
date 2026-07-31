'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { R32SqliteStore } = require('../lib/r32SqliteStore');
const { createPlatformCoreRepository } = require('../repositories/platformCoreRepository');
const { DomainEventLogService } = require('../services/domainEventLogService');
const { DomainEventProjectionAuthority, PROJECTOR_NAME, PROJECTOR_VERSION } = require('../services/domainEventProjectionAuthority');
const { PlatformAdapterRegistryV2 } = require('../services/platformAdapterPorts');
const { RuntimeRecoveryService } = require('../services/runtimeRecoveryService');
const { AiGateway } = require('../services/aiGateway');
const { LearningPreferenceAuthority } = require('../services/learningPreferenceAuthority');
const { LearningSynthesisScheduler } = require('../services/learningSynthesisScheduler');
const aiQuality = require('../services/aiQualityRouteAuthority');
const eventBus = require('../services/eventBus');

function highQualityModel(id = 'quality-model') {
  return {
    id, name: id, provider: 'openrouter', qualification: 'verified', available: true,
    allowedTasks: ['quick_reply', 'deep_reply', 'director', 'learning_synthesis', 'understanding', 'relationship', 'fact_extraction', 'memory_extraction'],
    lastQualificationTest: { scores: { persona: { pass: true }, hallucination: { pass: true }, json: { pass: true } } },
    lastReplyBrainBenchmark: {
      authority: 'YanceReplyBrainBenchmark', pass: true, status: 'REPLY_BRAIN_QUALIFIED', completed: true, score: 92,
      scenarios: [
        { id: 'german_whatsapp', pass: true, score: 19 },
        { id: 'english_whatsapp', pass: true, score: 19 },
        { id: 'persona_boundary', pass: true, score: 24 },
        { id: 'director_schema', pass: true, score: 19 },
        { id: 'latency', pass: true, score: 11 }
      ]
    }
  };
}
function validRouteReceipt(task = 'quick_reply') {
  return aiQuality.routeReceipt({ task, selectedModel: highQualityModel(`${task}-model`), routePlan: { state: 'ready', violations: [] } });
}
function withRepository(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-r12-r13-remaining-'));
  const store = new R32SqliteStore({ dbPath: path.join(root, 'database', 'yance.db') });
  const repository = createPlatformCoreRepository({ storeProvider: () => store });
  const eventLog = new DomainEventLogService({ repository });
  try { return callback({ root, store, repository, eventLog }); }
  finally {
    try { store.close(); } catch (_) {}
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}
async function withRepositoryAsync(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-r12-r13-remaining-async-'));
  const store = new R32SqliteStore({ dbPath: path.join(root, 'database', 'yance.db') });
  const repository = createPlatformCoreRepository({ storeProvider: () => store });
  const eventLog = new DomainEventLogService({ repository });
  try { return await callback({ root, store, repository, eventLog }); }
  finally {
    try { store.close(); } catch (_) {}
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}
function simpleBus() {
  const bus = new EventEmitter();
  bus.publish = function publish(type, payload) { this.emit(type, { type, payload }); return { type, payload }; };
  return bus;
}

test('runtime recovery and account entrypoints use the AuthPort instead of a direct platform connection bypass', async () => {
  const calls = [];
  const service = new RuntimeRecoveryService({
    accountManager: { list: () => ({ accounts: [{ id: 'wa-1', platform: 'whatsapp', state: 'disconnected', credentialReady: true }] }) },
    accountStore: { get: () => ({ id: 'wa-1', platform: 'whatsapp', lifecycleState: 'active', autoReconnect: true }) },
    sendQueue: { status: () => ({ started: true }), resume: reason => calls.push(['queue.resume', reason]), pause() {} },
    eventBus: { publish: (type, payload) => calls.push([type, payload]) },
    platformAdapters: { executeAuth: async input => { calls.push(['auth', input]); return { accountId: input.accountId, connected: true }; } }
  });
  const result = await service.recover('network-online');
  assert.equal(result.lastRecovery[0].ok, true);
  assert.equal(calls.filter(row => row[0] === 'auth').length, 1);
  assert.equal(calls.find(row => row[0] === 'auth')[1].operation, 'connect');
  assert.equal(calls.some(row => row[0] === 'queue.resume'), true);

  const recoverySource = fs.readFileSync(path.join(__dirname, '../services/runtimeRecoveryService.js'), 'utf8');
  assert.equal(/accountManager\.connect\s*\(/u.test(recoverySource), false);
  const accountContextSource = fs.readFileSync(path.join(__dirname, '../core/accountContext.js'), 'utf8');
  for (const command of ['account.connect','account.reconnect','account.pause','account.resume','account.logout','account.sync']) {
    const escaped = command.replace('.', '\\.');
    assert.match(accountContextSource, new RegExp(`case '${escaped}'[\\s\\S]{0,260}executePlatform`, 'u'));
  }
});

test('all three platform facades bind auth and reconcile handlers and execute through the stable four-port contract', async () => {
  const calls = [];
  const registry = new PlatformAdapterRegistryV2();
  for (const platform of ['facebook', 'whatsapp', 'telegram']) {
    registry.bind(platform, {
      authHandler: { execute: async input => { calls.push(['auth', input.platform, input.operation]); return { ok: true, platform: input.platform }; } },
      reconcileHandler: async input => { calls.push(['reconcile', input.platform, input.operation]); return { ok: true, platform: input.platform }; }
    });
  }
  for (const platform of ['facebook', 'whatsapp', 'telegram']) {
    const contract = registry.contracts()[platform];
    assert.deepEqual(contract.bindings, { auth: true, ingress: true, egress: true, reconcile: true });
    assert.equal((await registry.executeAuth({ platform, accountId: `${platform}-1`, operation: 'connect' })).ok, true);
    assert.equal((await registry.reconcile({ platform, accountId: `${platform}-1`, operation: 'sync' })).status, 'ready');
  }
  assert.equal(calls.filter(row => row[0] === 'auth').length, 3);
  assert.equal(calls.filter(row => row[0] === 'reconcile').length, 3);
});

test('domain events are audited as the authoritative message projection and converge with zero shadow differences', () => {
  withRepository(({ repository, eventLog }) => {
    const projection = {
      id: 'message-1', platform: 'telegram', sourceAccountId: 'tg-1', accountId: 'tg-1', conversationId: 'conv-1',
      externalMessageId: 'remote-1', direction: 'inbound', fromMe: false, type: 'text', text: 'Hallo', timestamp: '2026-07-27T00:00:00.000Z'
    };
    const created = eventLog.append({
      platform: 'telegram', sourceAccountId: 'tg-1', externalEventId: 'remote-1', eventType: 'message.received',
      occurredAt: projection.timestamp, payload: { projection }
    });
    const authority = new DomainEventProjectionAuthority({
      repository, eventLog,
      messageStore: { getMessageByDedupeKey: id => id === 'message-1' ? { ...projection } : null },
      eventBus: simpleBus(), logger: { warn() {} }
    });
    const report = authority.auditExisting();
    assert.equal(report.scanned, 1);
    assert.equal(report.applied, 1);
    assert.equal(report.mismatch, 0);
    assert.equal(report.missing, 0);
    assert.equal(report.converged, true);
    const receipt = repository.getProjectionReceipt(PROJECTOR_NAME, PROJECTOR_VERSION, created.event.eventId);
    assert.equal(receipt.projection_status, 'applied');
    assert.equal(repository.getDomainEvent(created.event.eventId).replay_state, 'replayed');
    assert.equal(eventLog.assertConverged({ projectorName: PROJECTOR_NAME, projectorVersion: PROJECTOR_VERSION }).blocking, 0);
  });
});

test('domain projection divergence remains a blocking receipt and cannot be declared converged', () => {
  withRepository(({ repository, eventLog }) => {
    const projection = {
      id: 'message-2', platform: 'facebook', sourceAccountId: 'page-1', accountId: 'page-1', conversationId: 'conv-2',
      externalMessageId: 'remote-2', direction: 'inbound', fromMe: false, type: 'text', text: 'Expected', timestamp: '2026-07-27T00:00:00.000Z'
    };
    eventLog.append({ platform: 'facebook', sourceAccountId: 'page-1', externalEventId: 'remote-2', eventType: 'message.received', occurredAt: projection.timestamp, payload: { projection } });
    const authority = new DomainEventProjectionAuthority({
      repository, eventLog,
      messageStore: { getMessageByDedupeKey: () => ({ ...projection, text: 'Different' }) },
      eventBus: simpleBus(), logger: { warn() {} }
    });
    const report = authority.auditExisting();
    assert.equal(report.mismatch, 1);
    assert.equal(report.converged, false);
    assert.throws(() => eventLog.assertConverged({ projectorName: PROJECTOR_NAME, projectorVersion: PROJECTOR_VERSION }), error => error.code === 'DOMAIN_EVENT_PROJECTION_NOT_CONVERGED');
  });
});

test('AI timeout recovery retries the same high-tier model with reduced context before switching to a same-tier fallback', async () => {
  const primary = highQualityModel('primary-high');
  const fallback = highQualityModel('fallback-high');
  const calls = [];
  const registry = {
    read: () => ({ models: [primary, fallback], routes: {} }),
    recordInvocation: async () => {},
    recordInvocationFailure: async () => {}
  };
  let attempt = 0;
  const gateway = new AiGateway({
    registry,
    executeModel: async (model, messages) => {
      attempt += 1;
      calls.push({ modelId: model.id, chars: messages.reduce((sum, row) => sum + String(row.content || '').length, 0) });
      if (attempt <= 2) throw Object.assign(new Error('deadline exceeded'), { code: 'MODEL_TIMEOUT', status: 408 });
      return { text: 'Recovered by same-tier fallback.' };
    }
  });
  gateway.resolveRoute = () => ({
    task: 'quick_reply', route: {}, primary, fallback, emergency: null,
    qualityPlan: { state: aiQuality.ROUTE_STATE.READY, violations: [] }, conditional: false, humanReviewRequired: false
  });
  const messages = [
    { role: 'system', content: 'S'.repeat(2500) },
    { role: 'user', content: `<conversation_context>${JSON.stringify({ recentMessages: Array.from({ length: 60 }, (_, index) => ({ index, text: 'H'.repeat(180) })), confirmedFacts: [{ id: 'f1', text: 'fact' }] })}</conversation_context>` }
  ];
  const result = await gateway._run({ jobId: 'timeout-recovery-test', task: 'quick_reply', messages, options: { timeoutMs: 1000 }, signal: new AbortController().signal });
  assert.deepEqual(calls.map(row => row.modelId), ['primary-high', 'primary-high', 'fallback-high']);
  assert.equal(calls[1].chars < calls[0].chars, true);
  assert.equal(result.modelId, 'fallback-high');
  assert.equal(result.fallbackUsed, true);
  assert.equal(result.attempts.some(row => row.contextReduced === true && row.recoveryPhase === 'same-model-reduced-context'), true);
  assert.equal(result.qualityRouteReceipt.qualityTier, 'high');
});

test('eligible L1 signals schedule automatic L2 synthesis and cross-contact L2 evidence creates a pending L3 proposal requiring human approval', async () => {
  await withRepositoryAsync(async ({ repository, store }) => {
    const learning = new LearningPreferenceAuthority({ repository });
    const bus = simpleBus();
    const aiGateway = {
      execute: async input => ({
        json: { preference: input.messages[1].content.includes('L3') ? { defaultLength: 'short', questionPreference: 'fewer_questions' } : { defaultLength: 'short' }, confidence: 0.86 },
        qualityRouteReceipt: validRouteReceipt('learning_synthesis'), modelId: 'learning_synthesis-model', attempts: []
      })
    };
    const scheduler = new LearningSynthesisScheduler({ aiGateway, eventBus: bus, learning, repository, logger: { warn() {} }, intervalMs: 60_000 });
    let publishedSignals = 0;
    const listener = () => { publishedSignals += 1; };
    eventBus.on('learning:signal-recorded', listener);
    try {
      for (let contact = 1; contact <= 3; contact += 1) {
        for (let index = 1; index <= 9; index += 1) {
          learning.recordSignal({
            signalType: 'candidate_sent', scopeType: 'contact', scopeId: `contact-${contact}`, contactId: `contact-${contact}`,
            conversationId: `conversation-${contact}`, candidateId: `candidate-${contact}-${index}`,
            idempotencyKey: `signal-${contact}-${index}`, finalText: `Message ${index}`,
            qualityRouteReceipt: validRouteReceipt('quick_reply'), observedAt: new Date(Date.UTC(2026, 6, 27, 0, contact, index)).toISOString()
          });
        }
      }
      assert.equal(publishedSignals, 27);
      const report = await scheduler.run({ reason: 'test' });
      assert.equal(report.ok, true);
      assert.equal(report.l2.length, 3);
      assert.equal(report.l2.every(row => row.result.profile?.learningLevel === 'L2'), true);
      assert.equal(report.l3.proposed, true);
      assert.equal(report.l3.profile.state, 'pending-approval');
      const pending = store.db.prepare("SELECT * FROM learning_promotion_audit WHERE decision='pending-human-approval'").get();
      assert.ok(pending);
      const approved = learning.approveL3Proposal({ promotionId: pending.promotion_id, actor: 'owner', reason: '跨客户稳定偏好人工复核通过。' });
      assert.equal(approved.profile.state, 'active');
      assert.equal(approved.profile.learningLevel, 'L3');
      assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM learning_preference_profiles WHERE learning_level='L2' AND state='active'").get().n, 3);
      assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM learning_preference_profiles WHERE learning_level='L3' AND state='active'").get().n, 1);
    } finally {
      eventBus.removeListener('learning:signal-recorded', listener);
      await scheduler.stop();
    }
  });
});

test('production source has no auth or reconcile bypass outside the four-port implementation boundary', () => {
  const backendRoot = path.join(__dirname, '..');
  const allowed = new Set([
    path.normalize('core/accountContext.js'),
    path.normalize('services/platformAdapterPorts.js')
  ]);
  const patterns = [
    /accountManager\.(?:connect|reconnect|sync|syncAll|reconnectAll)\s*\(/u,
    /accountManager\.(?:startTelegramQr|startTelegramPhone|submitTelegramCode|submitTelegramPassword|cancelTelegramLogin)\s*\(/u,
    /accountManager\.(?:beginFacebookOAuth|pollFacebookOAuth|selectFacebookPage|cancelFacebookOAuth)\s*\(/u,
    /accountManager\.(?:startFacebookBusinessSuiteAvatarImport|getFacebookBusinessSuiteAvatarImportStatus|stopFacebookBusinessSuiteAvatarImport|diagnoseFacebookAvatarClosure)\s*\(/u
  ];
  const bypasses = [];
  const walk = root => {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (entry.name === 'tests' || entry.name === 'node_modules') continue;
      const full = path.join(root, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.js')) {
        const relative = path.normalize(path.relative(backendRoot, full));
        if (allowed.has(relative)) continue;
        const source = fs.readFileSync(full, 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '').replace(/(^|\s)\/\/.*$/gmu, '$1');
        if (patterns.some(pattern => pattern.test(source))) bypasses.push(relative);
      }
    }
  };
  walk(backendRoot);
  assert.deepEqual(bypasses, []);
});

test('architecture authority reports the four requested source cutovers without claiming Windows evidence', () => {
  const source = fs.readFileSync(path.join(__dirname, '../services/round12ArchitectureStatusService.js'), 'utf8');
  assert.match(source, /state: 'authoritative-event-first'/u);
  assert.match(source, /authoritativeProjection: true/u);
  assert.match(source, /allLegacyAuthAndReconcileHandlersMigrated: true/u);
  assert.match(source, /contextReductionBeforeTimeoutFallback: true/u);
  assert.match(source, /automaticL2L3SynthesisScheduled: true/u);
  assert.match(source, /realDataConvergenceVerified: false/u);
  assert.match(source, /realOpenRouterQualityVerified: false/u);
});
