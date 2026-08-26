'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');
const { EventEmitter } = require('node:events');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const {
  applyBatch41Fix6MArchitectureReferenceClosure
} = require('../../backend/migrations/batch41Fix6MArchitectureReferenceClosure');
const {
  applyArchitectureClosureV2WpA
} = require('../../backend/migrations/architectureClosureV2WpA');
const {
  applyArchitectureClosureV2WpB
} = require('../../backend/migrations/architectureClosureV2WpB');
const {
  DurableInternalOperationAuthority
} = require('../../backend/services/durableInternalOperationAuthority');
const {
  AiGateway,
  assertExecutionCommitAllowed,
  resolveQueueTimeoutMs
} = require('../../backend/services/aiGateway');
const { normalizeTimeoutMs } = require('../../backend/services/modelTaskRuntimePolicy');
const runtimeRegistry = require('../../backend/services/aiTaskRuntimeRegistry');
const contactContextAuthority = require('../../backend/services/contactContextAuthority');
const contactLanguageAuthority = require('../../backend/services/contactLanguageAuthority');
const aiWorkbenchDirectorRuleAuthority = require('../../backend/services/aiWorkbenchDirectorRuleAuthority');
const { singleton: aiDirectorStrategyAuthority } = require('../../backend/services/aiDirectorStrategyAuthority');
const typingStateService = require('../../backend/services/typingStateService');
const conversationTurnCoordinator = require('../../backend/services/conversationTurnCoordinator');
const {
  createContextAwareReplyBrain
} = require('../../backend/services/contextAwareReplyBrain');
const { ConversationTurnCoordinator } = conversationTurnCoordinator;

function createCoverageStore(db, dbPath) {
  let transactionDepth = 0;
  return {
    db,
    dbPath,
    transaction(callback) {
      if (typeof callback !== 'function') throw new TypeError('transaction callback required');
      if (transactionDepth > 0) return callback();
      db.exec('BEGIN IMMEDIATE');
      transactionDepth += 1;
      try {
        const result = callback();
        if (result && typeof result.then === 'function') {
          throw Object.assign(new Error('async transaction forbidden'), {
            code: 'AUTHORITY_TRANSACTION_ASYNC_CALLBACK_FORBIDDEN'
          });
        }
        db.exec('COMMIT');
        return result;
      } catch (error) {
        try { db.exec('ROLLBACK'); } catch (_) {}
        throw error;
      } finally {
        transactionDepth -= 1;
      }
    }
  };
}

function installCoverageSchema23(db) {
  db.exec(`CREATE TABLE r32_meta(
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;`);
  applyBatch41Fix6MArchitectureReferenceClosure(db);
  const wpA = applyArchitectureClosureV2WpA(db);
  assert.equal(wpA.targetSchemaVersion, 22);
  applyArchitectureClosureV2WpB(db, { at: '2026-08-03T03:41:00.000Z' });
}

function installCoverageHostLease(db) {
  const token = Object.freeze({
    instanceId: 'ai-coverage-write-host',
    hostGeneration: 11,
    fencingToken: 31
  });
  const at = '2026-08-03T03:41:30.000Z';
  db.prepare(`INSERT INTO authority_write_host_lease(
    singleton_id,owner_instance_id,owner_pid,owner_process_identity,startup_nonce,
    host_generation,fencing_token,state,acquired_at_ms,heartbeat_at_ms,
    acquired_at,heartbeat_at,updated_at
  ) VALUES(1,?,?,?,?,?,?,'ACTIVE',?,?,?,?,?)
  ON CONFLICT(singleton_id) DO UPDATE SET
    owner_instance_id=excluded.owner_instance_id,
    owner_pid=excluded.owner_pid,
    owner_process_identity=excluded.owner_process_identity,
    startup_nonce=excluded.startup_nonce,
    host_generation=excluded.host_generation,
    fencing_token=excluded.fencing_token,
    state='ACTIVE',
    acquired_at_ms=excluded.acquired_at_ms,
    heartbeat_at_ms=excluded.heartbeat_at_ms,
    acquired_at=excluded.acquired_at,
    heartbeat_at=excluded.heartbeat_at,
    updated_at=excluded.updated_at`).run(
    token.instanceId,
    4321,
    'ai-coverage-process',
    'ai-coverage-startup-nonce',
    token.hostGeneration,
    token.fencingToken,
    Date.parse(at),
    Date.parse(at),
    at,
    at,
    at
  );
  return token;
}

function withAiDurableAuthority(work) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-v21-ai-coverage-'));
  const dbPath = path.join(root, 'coverage.db');
  const db = new DatabaseSync(dbPath);
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    try { db.close(); } catch (_) {}
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  };
  try {
    db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1000;');
    installCoverageSchema23(db);
    const token = installCoverageHostLease(db);
    const store = createCoverageStore(db, dbPath);
    let sequence = 0;
    const authority = new DurableInternalOperationAuthority({
      storeProvider: () => store,
      tokenProvider: () => token,
      clock: () => '2026-08-03T03:42:00.000Z',
      idFactory: prefix => `${prefix}-ai-coverage-${++sequence}`,
      leaseMs: 60000
    });
    const result = work({ db, token, authority });
    if (result && typeof result.then === 'function') {
      return Promise.resolve(result).finally(cleanup);
    }
    cleanup();
    return result;
  } catch (error) {
    cleanup();
    throw error;
  }
}

function startCanonicalAiOperation(authority, operationId) {
  const objectFingerprint = `${operationId}-fingerprint`;
  const created = authority.create({
    operationId,
    operationType: 'ai.canonical-analysis',
    scopeKey: `${operationId}-scope`,
    objectFingerprint,
    maxAttempts: 1
  });
  assert.equal(created.operation.state, 'SCHEDULED');
  const started = authority.start(operationId).operation;
  assert.equal(started.state, 'RUNNING');
  return { objectFingerprint, started };
}

function coverageSocialContext() {
  return {
    found: true,
    ready: true,
    contactId: 'contact-coverage',
    contextVersion: 12,
    entityVersions: { customer: 1, relationship: 2, memory: 3, interactionPolicy: 4, routing: 5 },
    guards: { canGenerateReply: true },
    customer: {
      id: 'contact-coverage',
      platform: 'whatsapp',
      accountId: 'account-coverage',
      preferredLanguage: 'Deutsch'
    },
    relationshipPotential: { relationshipStage: 'familiar', warmth: 0.5, openness: 0.4 },
    relationshipAnalysis: {},
    emotion: { trend: 'stable', current: 'neutral' },
    interaction: {},
    preferences: { preferredLength: 'short' },
    interactionPolicy: { policy: 'reply_normally', allowReplies: true },
    replyStrategy: { maxQuestions: 1, recommendedLength: 'short', recommendedDepth: 'light_personal' },
    memory: {
      confirmedFacts: [], userNotes: [], importantEvents: [], openLoops: [],
      promises: [], boundaries: [], sensitiveTopics: [], recurringInterests: []
    },
    timeline: [],
    recentSignals: [],
    recentMessages: []
  };
}

function coveragePersonaStub() {
  return {
    compileEffectiveContext() {
      return {
        profileId: 'owner',
        personaVersionId: 7,
        policyHash: 'policy-hash-coverage',
        effectiveLabel: 'Coverage',
        appliedScopes: [],
        context: {
          persona: {
            available: true,
            truthSafePacket: {
              preferredLanguage: 'Deutsch',
              truthFirewall: { liveVerifiedOnly: true },
              runtimeAuthority: {
                authority: 'YancePersonaRuntimeTruthAuthority',
                pass: true,
                receiptSha256: 'coverage-truth-receipt'
              }
            }
          }
        }
      };
    }
  };
}

function coverageStoreManager(_context, captured) {
  const state = {
    conversations: {
      byId: {
        'conversation-coverage': { id: 'conversation-coverage', version: 0 }
      }
    }
  };
  return {
    select(selector) {
      return typeof selector === 'function' ? selector(state) : state;
    },
    async dispatch(command) {
      captured.push(command);
      if (command.type === 'AI_REPLY_TASK_STARTED') return { result: { taskId: 'coverage-task-1' } };
      if (command.type === 'AI_REPLY_CANDIDATE_READY') return { result: { candidateId: 'coverage-candidate-1' } };
      return { result: {} };
    }
  };
}

function coverageDirectorJson() {
  return JSON.stringify({
    strategy: 'natural_hook',
    reasonZh: '自然回应并保留轻松推进空间',
    goal: 'maintain_and_advance_gently',
    tone: 'warm_natural',
    pace: 'steady',
    instruction: '先自然回应，再留一个轻量话题钩子',
    avoid: '连续提问和模板式客套',
    targetLanguage: 'de',
    maxQuestions: 1
  });
}

function coverageDirectorStrategy() {
  return {
    authority: 'DirectorStrategyV2Authority',
    created: true,
    reused: false,
    strategy: {
      strategyId: 'coverage-strategy',
      contactId: 'contact-coverage',
      conversationId: 'conversation-coverage',
      strategyVersion: 1,
      conversationGeneration: '0:12',
      personaVersionId: 7,
      memorySnapshotId: 'coverage-memory',
      learningProfileVersion: 0,
      strategy: {
        mustUseMemory: [],
        evidenceRefs: [],
        candidateBranches: ['natural_hook', 'playful_attraction', 'direct_advance']
      },
      strategySha256: 'coverage-strategy-sha',
      evidenceRefs: [],
      state: 'active',
      expiresOn: [],
      createdAt: '2026-08-03T03:42:00.000Z',
      updatedAt: '2026-08-03T03:42:00.000Z'
    }
  };
}

function coverageCandidatePlan() {
  return {
    authority: 'CandidateGenerationPlanAuthority',
    created: true,
    reused: false,
    plan: {
      planId: 'coverage-plan',
      strategyId: 'coverage-strategy',
      contactId: 'contact-coverage',
      conversationId: 'conversation-coverage',
      candidateCount: 3,
      sharedConstraints: {},
      branches: [
        { axisId: 'axis-1', strategy: 'natural_hook', warmth: 0.65, flirtation: 0.25, directness: 0.35, question: 'light' },
        { axisId: 'axis-2', strategy: 'playful_attraction', warmth: 0.55, flirtation: 0.55, directness: 0.35, question: 'none' },
        { axisId: 'axis-3', strategy: 'direct_advance', warmth: 0.45, flirtation: 0.6, directness: 0.7, question: 'optional' }
      ],
      planSha256: 'coverage-plan-sha',
      state: 'active',
      createdAt: '2026-08-03T03:42:00.000Z',
      updatedAt: '2026-08-03T03:42:00.000Z'
    }
  };
}

function queueAdmissionFailureFixture() {
  const calls = [];
  let operation = null;
  const authority = {
    create(input) {
      calls.push(['create', input.operationId]);
      operation = {
        operationId: input.operationId,
        executionId: input.operationId,
        state: 'SCHEDULED',
        generation: 0,
        objectFingerprint: input.objectFingerprint
      };
      return { created: true, operation: { ...operation } };
    },
    read(operationId) {
      assert.equal(operationId, operation.operationId);
      return { ...operation };
    },
    start(operationId) {
      calls.push(['start', operationId]);
      assert.equal(operation.state, 'SCHEDULED');
      operation = { ...operation, state: 'RUNNING', generation: 1 };
      return { updated: true, operation: { ...operation } };
    },
    cancel(operationId, _receipt, options = {}) {
      calls.push(['cancel', operationId]);
      assert.equal(operation.state, 'RUNNING');
      assert.equal(options.generation, operation.generation);
      assert.equal(options.objectFingerprint, operation.objectFingerprint);
      operation = { ...operation, state: 'CANCELLED' };
      return { updated: true, operation: { ...operation } };
    },
    succeed() { throw new Error('queue-admission failure must not succeed'); },
    fail() { throw new Error('queue-admission failure must not fail after physical start'); }
  };
  const queue = {
    add() {
      const error = Object.assign(new Error('queue admission rejected'), {
        code: 'QUEUE_ADMISSION_FAILED'
      });
      return Object.freeze({ id: 'queue-rejected-1', promise: Promise.reject(error) });
    },
    cancel() { return false; },
    status() { return { pending: [], running: [], completed: [] }; }
  };
  return { authority, queue, calls, readOperation: () => ({ ...operation }) };
}

test('KF-P0-29 queue-admission failure terminalizes the already-persisted SCHEDULED AI operation', async () => {
  const fixture = queueAdmissionFailureFixture();
  const gateway = new AiGateway({
    queue: fixture.queue,
    internalOperationAuthorityProvider: () => fixture.authority
  });
  const { jobId } = gateway.submit({
    task: 'deep_reply',
    messages: [{ role: 'user', content: 'hello' }],
    context: { scopeKey: 'coverage:queue', generation: '1' }
  });

  await assert.rejects(
    () => gateway.waitForJob(jobId),
    error => error?.code === 'QUEUE_ADMISSION_FAILED'
  );
  assert.equal(fixture.readOperation().state, 'CANCELLED');
  assert.deepEqual(fixture.calls.map(row => row[0]), ['create', 'start', 'cancel']);
});

test('KF-P0-30/KF-P0-31 generation and fingerprint fences reject stale terminal/commit observations', () => {
  assert.throws(
    () => assertExecutionCommitAllowed({
      executionId: 'ai-execution-stale-1',
      expectedGeneration: 'generation-1',
      currentGeneration: 'generation-2'
    }),
    error => error?.code === 'AI_STALE_EXECUTION_RESULT'
      && error?.reason === 'GENERATION_SUPERSEDED'
  );
});

test('KF-P0-30 competing cancel and succeed terminal observations cannot both win under the canonical durable AI identity', () => withAiDurableAuthority(({ token, authority }) => {
  const terminalEvents = operation => operation.history.filter(row => [
    'internal-operation-succeeded',
    'internal-operation-cancelled'
  ].includes(row.eventType));

  const cancelFirst = startCanonicalAiOperation(authority, 'ai-race-cancel-first');
  assert.equal(cancelFirst.started.hostGeneration, token.hostGeneration);
  assert.equal(cancelFirst.started.fencingToken, token.fencingToken);
  const cancelOptions = {
    generation: cancelFirst.started.generation,
    objectFingerprint: cancelFirst.objectFingerprint,
    reasonCode: 'AI_CANCEL_WON'
  };
  const cancelled = authority.cancel(
    'ai-race-cancel-first',
    { reasonCode: 'AI_CANCEL_WON' },
    cancelOptions
  ).operation;
  assert.equal(cancelled.state, 'CANCELLED');
  assert.throws(
    () => authority.succeed(
      'ai-race-cancel-first',
      { status: 'late-success' },
      cancelOptions
    ),
    error => error?.code === 'WP_B_INTERNAL_OPERATION_TERMINAL_STATE_INVALID'
      && error?.state === 'CANCELLED'
  );
  const cancelFinal = authority.read('ai-race-cancel-first');
  assert.equal(cancelFinal.state, 'CANCELLED');
  assert.equal(terminalEvents(cancelFinal).length, 1);

  const succeedFirst = startCanonicalAiOperation(authority, 'ai-race-succeed-first');
  assert.equal(succeedFirst.started.hostGeneration, token.hostGeneration);
  assert.equal(succeedFirst.started.fencingToken, token.fencingToken);
  const succeedOptions = {
    generation: succeedFirst.started.generation,
    objectFingerprint: succeedFirst.objectFingerprint,
    reasonCode: 'AI_SUCCEED_WON'
  };
  const succeeded = authority.succeed(
    'ai-race-succeed-first',
    { status: 'ok' },
    succeedOptions
  ).operation;
  assert.equal(succeeded.state, 'SUCCEEDED');
  assert.throws(
    () => authority.cancel(
      'ai-race-succeed-first',
      { reasonCode: 'LATE_CANCEL' },
      succeedOptions
    ),
    error => error?.code === 'WP_B_INTERNAL_OPERATION_TERMINAL_STATE_INVALID'
      && error?.state === 'SUCCEEDED'
  );
  const succeedFinal = authority.read('ai-race-succeed-first');
  assert.equal(succeedFinal.state, 'SUCCEEDED');
  assert.equal(terminalEvents(succeedFinal).length, 1);
}));

test('KF-P0-31 a newer inbound turn invalidates the captured turn and cancels the stale runtime generation', () => {
  const taskId = 'v21-coverage-stale-turn-task';
  const conversationId = 'v21-coverage-conversation';
  runtimeRegistry.finish(taskId);
  const runtime = runtimeRegistry.start(taskId, {
    conversationId,
    objectFingerprint: 'turn-fingerprint-1'
  });
  const bus = new EventEmitter();
  const coordinator = new ConversationTurnCoordinator({ eventBus: bus, clock: () => 1000 });
  coordinator.start();
  try {
    const captured = coordinator.capture(conversationId, 7);
    bus.emit('message:inserted', {
      payload: {
        message: {
          id: 'incoming-2',
          conversationId,
          direction: 'inbound',
          fromMe: false,
          type: 'text',
          text: 'newer turn'
        }
      }
    });

    assert.equal(coordinator.isCurrent(captured, 7), false);
    assert.throws(
      () => runtimeRegistry.assertCurrent(taskId, {
        generation: runtime.generation,
        objectFingerprint: runtime.objectFingerprint
      }),
      error => error?.code === 'NEW_INCOMING_MESSAGE'
    );
  } finally {
    coordinator.stop();
    runtimeRegistry.finish(taskId);
  }
});

test('KF-P1-07 deep reply timeout policy remains finite and bounded', () => {
  const queueBudget = resolveQueueTimeoutMs('deep_reply', {
    options: { timeoutMs: 300000 },
    background: false
  });
  assert.equal(Number.isFinite(queueBudget), true);
  assert.ok(queueBudget >= 300000);

  const runtimeBudget = normalizeTimeoutMs('deep_reply', Number.POSITIVE_INFINITY);
  assert.equal(Number.isFinite(runtimeBudget), true);
  assert.ok(runtimeBudget >= 240000);
  assert.ok(runtimeBudget <= 1200000);
});

test('KF-P1-07 candidate repair executes with the same finite bounded deep-reply runtime timeout as the original reply attempt', async t => {
  const context = coverageSocialContext();
  const commands = [];
  const calls = [];
  const receipt = Object.freeze({
    schemaVersion: 1,
    authority: 'AiWorkbenchDirectorRuleAuthority',
    pass: true,
    contactId: 'contact-coverage',
    conversationId: 'conversation-coverage',
    migrationVersion: 2,
    templateCatalogVersion: 1,
    defaultSeeded: true,
    globalRuleCount: 1,
    contactRuleCount: 0,
    temporaryInstructionApplied: false,
    ruleIds: ['coverage-rule'],
    ruleSha256: 'coverage-rule-sha',
    receiptSha256: 'coverage-receipt'
  });

  t.mock.method(contactContextAuthority, 'getSocialContext', () => context);
  t.mock.method(contactLanguageAuthority, 'read', () => ({
    currentLanguage: 'de',
    primaryLanguage: 'de',
    userOverride: 'de',
    confidence: 1,
    source: 'coverage-test'
  }));
  t.mock.method(aiWorkbenchDirectorRuleAuthority, 'resolve', input => ({
    authority: 'AiWorkbenchDirectorRuleAuthority',
    director: {
      ...(input.director || {}),
      instruction: String(input.director?.instruction || 'Use the current contact evidence only.'),
      ruleStackReceipt: receipt,
      appliedGlobalRules: [{ id: 'coverage-rule', name: 'coverage rule', priority: 100 }],
      appliedContactRules: []
    },
    receipt,
    globalRules: [],
    contactRules: []
  }));
  t.mock.method(aiDirectorStrategyAuthority, 'createOrReuse', () => coverageDirectorStrategy());
  t.mock.method(aiDirectorStrategyAuthority, 'createCandidatePlan', () => coverageCandidatePlan());
  t.mock.method(conversationTurnCoordinator, 'waitForQuiet', async () => ({ waitedMs: 0 }));
  t.mock.method(conversationTurnCoordinator, 'capture', (_conversationId, persistedRevision) => ({
    conversationId: 'conversation-coverage',
    runtimeRevision: 0,
    persistedRevision
  }));
  t.mock.method(conversationTurnCoordinator, 'isCurrent', () => true);
  t.mock.method(conversationTurnCoordinator, 'settle', () => {});
  t.mock.method(typingStateService, 'beginAiGeneration', async () => ({}));
  t.mock.method(typingStateService, 'endAiGeneration', async () => ({}));
  t.mock.method(runtimeRegistry, 'replace', async () => ({
    signal: new AbortController().signal,
    generation: 1,
    objectFingerprint: 'runtime-fingerprint-coverage'
  }));
  t.mock.method(runtimeRegistry, 'assertCurrent', () => true);
  t.mock.method(runtimeRegistry, 'succeed', () => ({}));
  t.mock.method(runtimeRegistry, 'fail', () => ({}));
  t.mock.method(runtimeRegistry, 'finish', () => ({}));

  const aiGateway = {
    async execute(payload) {
      calls.push(payload);
      if (payload.task === 'director') {
        return {
          text: coverageDirectorJson(),
          modelId: 'director-model',
          model: 'Director Model',
          attempts: [{ modelId: 'director-model', status: 'success' }]
        };
      }
      if (payload.task === 'translation') {
        return {
          text: '听起来这是漫长的一天。先好好休息一下。',
          modelId: 'translation-model',
          model: 'Translation Model'
        };
      }
      const deepReplyCallCount = calls.filter(call => call.task === 'deep_reply').length;
      if (deepReplyCallCount === 1) {
        return {
          text: 'Antwort 1: Wie war dein Tag? Was machst du später?',
          modelId: 'model-1',
          model: 'Model 1',
          attempts: [{ modelId: 'model-1', status: 'success' }]
        };
      }
      return {
        text: 'Das klingt nach einem langen Tag. Ruh dich erst einmal aus.',
        modelId: 'model-1',
        model: 'Model 1',
        attempts: [{ modelId: 'model-1', status: 'success' }]
      };
    }
  };

  const learningPolicyRuntimeAdapter = {
    async selectLearnedPolicyAction(input) {
      return Object.freeze({
        authority: 'LearningPolicyRuntimeAdapter',
        candidateStrategyBranch: input.baselineAction || input.allowedActions[0],
        policyVersion: 'coverage-baseline-v1',
        policyArtifactId: 'baseline',
        actionProbability: 1,
        exploration: false,
        degradation: null
      });
    }
  };
  const learningPolicyDecisionContract = {
    createDecisionRecord() {
      return { decisionId: 'coverage-decision' };
    }
  };

  const brain = createContextAwareReplyBrain({
    storeManager: coverageStoreManager(context, commands),
    aiGateway,
    personaBrain: coveragePersonaStub(),
    learningPolicyRuntimeAdapter,
    learningPolicyDecisionContract
  });
  const result = await brain.generateCandidate({
    contactId: 'contact-coverage',
    conversationId: 'conversation-coverage',
    incomingMessage: { id: 'message-coverage', text: 'Heute war wirklich viel los.' },
    skipQuietWindow: true,
    replyTask: 'deep_reply'
  });

  const replyCalls = calls.filter(call => call.task === 'deep_reply');
  assert.equal(replyCalls.length, 2);
  assert.match(replyCalls[0].dedupeKey, /^social-reply:/u);
  assert.match(replyCalls[1].dedupeKey, /^social-reply-repair:/u);
  assert.equal(Number.isFinite(replyCalls[0].options?.timeoutMs), true);
  assert.equal(Number.isFinite(replyCalls[1].options?.timeoutMs), true);
  assert.ok(replyCalls[0].options.timeoutMs > 0);
  assert.ok(replyCalls[0].options.timeoutMs <= 1200000);
  assert.equal(replyCalls[1].options.timeoutMs, replyCalls[0].options.timeoutMs);
  assert.equal(result.replyTask, 'deep_reply');
  assert.equal(result.quality.repaired, true);
});

test('KF-P0-30/KF-P0-31/KF-P1-07 existing AI_AUTO race, stale-turn and deterministic retry contracts execute successfully', () => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  for (const relativePath of [
    'backend/tests/v21ProductAiAutoConversationP0.test.js',
    'backend/tests/v21ProductAiAutoRetryStorm.test.js'
  ]) {
    const absolutePath = path.join(repoRoot, relativePath);
    const child = spawnSync(process.execPath, [
      '--test',
      '--test-concurrency=1',
      absolutePath
    ], {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: 180000,
      env: { ...process.env, NODE_ENV: 'test' }
    });
    assert.equal(
      child.status,
      0,
      `${relativePath} failed\n${child.stdout || ''}\n${child.stderr || ''}`
    );
  }
});
