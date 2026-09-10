'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { R32SqliteStore } = require('../lib/r32SqliteStore');
const { createPlatformCoreRepository } = require('../repositories/platformCoreRepository');
const { AuthorityTransactionCoordinator } = require('../services/authorityTransactionCoordinator');
const canonicalEventLedger = require('../services/canonicalEventLedgerAuthority');
const { DomainEventLogService } = require('../services/domainEventLogService');
const { DomainEventProjectionAuthority, PROJECTOR_NAME, PROJECTOR_VERSION } = require('../services/domainEventProjectionAuthority');
const { PlatformAdapterRegistryV2 } = require('../services/platformAdapterPorts');
const { RuntimeRecoveryService } = require('../services/runtimeRecoveryService');
const { AiGateway } = require('../services/aiGateway');
const { DurableInternalOperationAuthority } = require('../services/durableInternalOperationAuthority');
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
function repositoryFixture(root, store) {
  const coordinator = new AuthorityTransactionCoordinator({ store, eventBus: { publish() {} } });
  const repository = createPlatformCoreRepository({
    storeProvider: () => store,
    coordinatorCapability: coordinator.repositoryCapability()
  });
  const ledger = new canonicalEventLedger.CanonicalEventLedgerAuthority({
    coordinator,
    store,
    compatibilityRepository: repository
  });
  let sequence = 0;
  const authority = new DurableInternalOperationAuthority({
    storeProvider: () => store,
    tokenProvider: () => store.authorityWriteHostCapability.tokenSnapshot(),
    idFactory: prefix => `${prefix}-${path.basename(root)}-${++sequence}`
  });
  return {
    repository,
    eventLog: ledger,
    authority
  };
}
function withRepository(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-r12-r13-remaining-'));
  const store = new R32SqliteStore({ dbPath: path.join(root, 'database', 'yance.db') });
  const fixture = repositoryFixture(root, store);
  try { return callback({ root, store, ...fixture }); }
  finally {
    try { store.close(); } catch (_) {}
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}
async function withRepositoryAsync(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-r12-r13-remaining-async-'));
  const store = new R32SqliteStore({ dbPath: path.join(root, 'database', 'yance.db') });
  const fixture = repositoryFixture(root, store);
  try { return await callback({ root, store, ...fixture }); }
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

test('runtime recovery delegates to the durable recovery authority instead of direct platform reconnects', async () => {
  const calls = [];
  const service = new RuntimeRecoveryService({
    sendQueue: { status: () => ({ started: true }), resume: reason => calls.push(['queue.resume', reason]), pause() {} },
    eventBus: { publish: (type, payload) => calls.push([type, payload]) },
    systemPolicy: { read: () => ({ emergencyStop: false }) },
    safeModeService: { isActive: () => false },
    recoverNonterminalExecutions: input => {
      calls.push(['recoverNonterminalExecutions', input]);
      return [{ executionId: 'exec-1', fromState: 'RUNNING', targetState: 'SCHEDULED', decision: 'REQUEUE_SAFE', reasonCode: input.reasonCode, persistedAttemptCount: 1, authorityTimestamp: input.authorityTimestamp }];
    }
  });
  const result = await service.recover('network-online');
  assert.equal(result.lastRecovery[0].decision, 'REQUEUE_SAFE');
  assert.equal(calls.filter(row => row[0] === 'recoverNonterminalExecutions').length, 1);

  const recoverySource = fs.readFileSync(path.join(__dirname, '../services/runtimeRecoveryService.js'), 'utf8');
  assert.equal(/accountManager\.connect\s*\(/u.test(recoverySource), false);
  assert.match(recoverySource, /recoverNonterminalExecutions/u);
  const accountContextSource = fs.readFileSync(path.join(__dirname, '../core/accountContext.js'), 'utf8');
  for (const command of ['account.connect','account.reconnect','account.pause','account.resume','account.logout','account.sync']) {
    const escaped = command.replace('.', '\\.');
    assert.match(accountContextSource, new RegExp(`case '${escaped}'[\\s\\S]{0,260}executePlatform`, 'u'));
  }
});

test('all three platform facades bind auth and reconcile handlers and execute through the stable four-port contract', async () => {
  await withRepositoryAsync(async ({ eventLog, authority }) => {
  const calls = [];
  const registry = new PlatformAdapterRegistryV2(Object.fromEntries(['facebook', 'whatsapp', 'telegram'].map(platform => [platform, {
      eventLog,
      operationLifecycle: authority,
      authHandler: { execute: async input => { calls.push(['auth', input.platform, input.operation]); return { ok: true, platform: input.platform }; } },
      reconcileHandler: async input => { calls.push(['reconcile', input.platform, input.operation]); return { ok: true, platform: input.platform }; }
  }])));
  for (const platform of ['facebook', 'whatsapp', 'telegram']) {
    const contract = registry.contracts()[platform];
    assert.deepEqual(contract.bindings, { auth: true, ingress: true, egress: true, reconcile: true });
    assert.equal((await registry.executeAuth({ platform, accountId: `${platform}-1`, operation: 'connect' })).ok, true);
    assert.equal((await registry.reconcile({ platform, accountId: `${platform}-1`, operation: 'sync' })).status, 'ready');
  }
  assert.equal(calls.filter(row => row[0] === 'auth').length, 3);
  assert.equal(calls.filter(row => row[0] === 'reconcile').length, 3);
  });
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
    assert.equal(eventLog.readEvent(created.event.eventId).eventType, 'message.received');
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
    assert.throws(() => eventLog.assertConverged({ projectorName: PROJECTOR_NAME, projectorVersion: PROJECTOR_VERSION }), error => error.code === 'CANONICAL_EVENT_PROJECTION_NOT_CONVERGED');
  });
});

test('AI physical execution requires and consumes one running durable provider operation', async () => {
  await withRepositoryAsync(async ({ authority }) => {
  const primary = highQualityModel('primary-high');
  const calls = [];
  const registry = {
    read: () => ({ models: [primary], routes: {} }),
    recordInvocation: async () => {},
    recordInvocationFailure: async () => {}
  };
  const created = authority.create({
    operationId: 'ai-runtime-operation',
    operationType: 'ai.provider-execution',
    scopeKey: 'quick-reply:test',
    objectFingerprint: 'ai-runtime-fingerprint'
  }).operation;
  const running = authority.start(created.operationId, { progress: 1 }).operation;
  const gateway = new AiGateway({
    registry,
    runtime: {
      status: () => ({ ok: true }),
      execute: async payload => {
        calls.push(payload);
        return {
          text: 'Model Brain completed.',
          evidence: {
            selectedModel: 'primary-high',
            provider: 'openrouter',
            latencyMs: 10,
            totalTokens: 3,
            fallbackCount: 0
          }
        };
      }
    }
  });
  const messages = [
    { role: 'user', content: 'Hallo' }
  ];
  const result = await gateway._run({ jobId: 'durable-ai-runtime-test', task: 'quick_reply', messages, options: { timeoutMs: 1000 }, signal: new AbortController().signal, persistedOperation: running });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].catalog[0].id, 'primary-high');
  assert.equal(result.modelId, 'primary-high');
  assert.equal(result.fallbackUsed, false);
  });
});

test('eligible evidence enters V4 review without automatic L2/L3 synthesis', async () => { const {createLearningPromotionAdapter}=require('../services/learningPromotionAdapter');const adapter=createLearningPromotionAdapter({openFeature:{setEvaluationContext(){}},flagd:{mode:'in-process-offline'}});await assert.rejects(()=>adapter.promote({status:'READY_FOR_REVIEW',Regression:{passed:true},Shadow:{passed:true},Candidate:{}},{approved:false}),e=>e.reasonCode==='LEARNING_APPROVAL_REQUIRED'); });

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
  assert.match(source, /physicalSelectionAuthority: 'LiteLLM Router'/u);
  assert.match(source, /complexityAuthority: 'LiteLLM ComplexityRouter'/u);
  assert.match(source, /automaticL2L3SynthesisScheduled: true/u);
  assert.match(source, /realDataConvergenceVerified: false/u);
  assert.match(source, /sealedLiteLLMRuntimeVerified: false/u);
});
