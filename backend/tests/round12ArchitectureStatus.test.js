'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { R32SqliteStore } = require('../lib/r32SqliteStore');
const { createPlatformCoreRepository } = require('../repositories/platformCoreRepository');
const { IdentityLinkAuthority } = require('../services/identityLinkAuthority');
const { DomainEventLogService } = require('../services/domainEventLogService');
const { snapshot } = require('../services/round12ArchitectureStatusService');

function qualifiedModel(id, provider = 'openrouter') {
  return {
    id,
    name: id,
    provider,
    available: true,
    enabled: true,
    qualification: 'verified',
    allowedTasks: ['director', 'quick_reply', 'deep_reply', 'learning_synthesis', 'translation', 'fact_extraction', 'memory_extraction', 'understanding', 'relationship'],
    lastQualificationTest: { scores: { json: { pass: true }, persona: { pass: true }, hallucination: { pass: true } } },
    lastReplyBrainBenchmark: {
      authority: 'YanceReplyBrainBenchmark',
      status: 'REPLY_BRAIN_QUALIFIED',
      completed: true,
      pass: true,
      score: 92,
      scenarios: [
        { id: 'german_whatsapp', pass: true, weight: 20, score: 19, issues: [] },
        { id: 'english_whatsapp', pass: true, weight: 20, score: 19, issues: [] },
        { id: 'persona_boundary', pass: true, weight: 25, score: 24, issues: [] },
        { id: 'director_schema', pass: true, weight: 20, score: 19, issues: [] },
        { id: 'latency', pass: true, weight: 15, score: 11, issues: [] }
      ]
    },
    capabilityTags: [
      'social_dialogue_high', 'relationship_reasoning', 'persona_consistency_long_context',
      'style_axis_control', 'candidate_diversity', 'json_schema_strict',
      'evidence_grounded_extraction', 'multilingual_zh_bridge', 'fast_high_quality_generation'
    ]
  };
}

test('round12 status exposes one non-sensitive authority snapshot for platform core and AI quality', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-r12-status-'));
  const store = new R32SqliteStore({ dbPath: path.join(root, 'database', 'yance.db') });
  const repository = createPlatformCoreRepository({ storeProvider: () => store });
  try {
    const identity = new IdentityLinkAuthority({ repository });
    identity.observe({ platform: 'facebook', sourceAccountId: 'page-secret', externalId: 'psid-secret', displayName: 'Alex' });
    const events = new DomainEventLogService({ repository });
    events.append({ platform: 'facebook', sourceAccountId: 'page-secret', externalEventId: 'event-secret', eventType: 'message.received', payload: { text: 'Hallo' } });

    const modelState = {
      models: [qualifiedModel('primary'), qualifiedModel('fallback', 'another-provider')],
      routes: {
        director: { primary: 'primary', fallback: 'fallback' },
        quick_reply: { primary: 'primary', fallback: 'fallback' },
        deep_reply: { primary: 'primary', fallback: 'fallback' },
        learning_synthesis: { primary: 'primary', fallback: 'fallback' },
        translation: { primary: 'primary', fallback: 'fallback' },
        fact_extraction: { primary: 'primary', fallback: 'fallback' },
        memory_extraction: { primary: 'primary', fallback: 'fallback' }
      }
    };
    const accountState = {
      accounts: [{ id: 'fb-account', platform: 'facebook', state: 'ready', credentialReady: true, runtime: { status: 'ready' } }]
    };
    const status = snapshot({ repository, modelState, accountState });
    assert.equal(status.authority, 'Round12ArchitectureStatusAuthority');
    assert.equal(status.completionSemantics.windowsVerified, false);
    assert.equal(status.platformCore.persistence.identity.persons, 1);
    assert.equal(status.platformCore.persistence.ingress.domainEvents, 1);
    assert.deepEqual(status.platformCore.adapterContracts.facebook.ports, ['auth', 'ingress', 'egress', 'reconcile']);
    assert.equal(status.platformCore.cutover.egressOutbox.state, 'production-wired');
    assert.deepEqual(status.platformCore.cutover.egressOutbox.coveredOperations, ['text', 'media', 'native_expression', 'reaction', 'revoke']);
    assert.deepEqual(status.platformCore.cutover.egressOutbox.remainingOperations, []);
    assert.equal(status.platformCore.invariants.allMessageEgressConsumesFrozenOutbox, true);
    assert.equal(status.platformCore.invariants.sendRetriesHonorFrozenPolicyBudget, true);
    assert.equal(status.platformCore.cutover.ingressEventModel.authoritativeProjection, true);
    assert.equal(status.platformCore.cutover.adapterPorts.allLegacyAuthAndReconcileHandlersMigrated, true);
    assert.equal(status.platformCore.cutover.adapterPorts.runtimeRecoveryUsesAuthPort, true);
    assert.equal(status.aiQuality.invariants.emergencyModeVisibleAndLearningIsolated, true);
    assert.equal(status.aiQuality.cutover.failureRecovery.sameModelSchemaCorrectionRetry, true);
    assert.equal(status.aiQuality.cutover.learning.l1ProductionSignalsActive, true);
    assert.equal(status.aiQuality.cutover.learning.automaticL2L3SynthesisScheduled, true);
    assert.equal(status.aiQuality.cutover.learning.l3HumanApprovalRequired, true);
    assert.equal(status.aiQuality.cutover.failureRecovery.contextReductionBeforeTimeoutFallback, true);
    assert.equal(status.aiQuality.cutover.failureRecovery.sameModelReducedContextRetry, true);
    assert.equal(status.aiQuality.tasks.quick_reply.highCapabilityPathReady, true);
    const serialized = JSON.stringify(status);
    assert.equal(serialized.includes('page-secret'), false);
    assert.equal(serialized.includes('psid-secret'), false);
    assert.equal(serialized.includes('event-secret'), false);
  } finally {
    try { store.close(); } catch (_) {}
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('production routes expose explicit architecture and quality diagnostics endpoints', () => {
  const systemRoute = fs.readFileSync(path.join(__dirname, '..', 'routes', 'system.js'), 'utf8');
  const modelRoute = fs.readFileSync(path.join(__dirname, '..', 'routes', 'models.js'), 'utf8');
  assert.match(systemRoute, /router\.get\('\/architecture\/round12'/);
  assert.match(systemRoute, /round12ArchitectureStatus\.snapshot\(\)/);
  assert.match(modelRoute, /router\.get\('\/quality-routing'/);
  assert.match(modelRoute, /aiQualityRouteAuthority\.routePlan/);
});


test('all durable message egress is forced through SendQueueService and PlatformAdapter egress', () => {
  const backendRoot = path.join(__dirname, '..');
  const productionFiles = [];
  const walk = root => {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (entry.name === 'tests' || entry.name === 'node_modules') continue;
      const full = path.join(root, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.js')) productionFiles.push(full);
    }
  };
  walk(backendRoot);
  const executableSource = file => fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
  const directEgressPattern = /sendMessageService\.(?:sendText|sendMedia|sendReaction|revokeMessage|sendNativeExpression)\s*\(/;
  const portableRelative = file => path.relative(backendRoot, file).split(path.sep).join('/');
  const directCallers = productionFiles
    .filter(file => directEgressPattern.test(executableSource(file)))
    .map(portableRelative);
  assert.deepEqual(directCallers, ['services/platformAdapterPorts.js']);
  const queueSource = fs.readFileSync(path.join(backendRoot, 'services', 'sendQueueService.js'), 'utf8');
  const atomicRepositorySource = fs.readFileSync(path.join(backendRoot, 'repositories', 'outboundCommandRepository.js'), 'utf8');
  assert.match(queueSource, /outboundCommandRepository\.createAtomic\s*\(/, 'durable queue creation must use the atomic outbound application transaction');
  assert.doesNotMatch(queueSource, /queueRepository\.(?:enqueue|enqueueWithOutboxRoute)\s*\(/, 'service-layer durable queue writes must remain forbidden');
  assert.match(atomicRepositorySource, /store\.transaction\s*\(/);
  assert.match(atomicRepositorySource, /store\.enqueueSend\s*\(/);
  assert.match(atomicRepositorySource, /store\.upsertMessage\s*\(/);
  for (const operation of ['text', 'media', 'reaction', 'revoke', 'native_expression']) {
    assert.match(queueSource, new RegExp(`operation(?:\\s*===|:)\\s*['\"]${operation}['\"]`));
  }
});
