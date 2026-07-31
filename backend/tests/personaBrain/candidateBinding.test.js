'use strict';

// AC-036 收尾验收：candidate/outbox 必须绑定 personaVersionId + policyHash，
// 且 compile-context 运行时 API 通过 HTTP 暴露。沿用 P0 标准（node:sqlite + node --test）。

const test = require('node:test');
const assert = require('node:assert');
const { DatabaseSync } = require('node:sqlite');
const { SqliteStorePersistenceAdapter } = require('../../store/adapters/SqliteStorePersistenceAdapter');
const { createPersonaBrain } = require('../../personaBrain');
const { createContextAwareReplyBrain } = require('../../services/contextAwareReplyBrain');
const contactContextAuthority = require('../../services/contactContextAuthority');
const { compilePersonaContext } = require('../../routes/personaBrain');

// 与 P0-A/B 同款最小 store shim（:memory: + transaction）
function makeStore() {
  const db = new DatabaseSync(':memory:');
  return {
    db,
    transaction(fn) {
      db.exec('BEGIN');
      try {
        const result = fn();
        db.exec('COMMIT');
        return result;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    }
  };
}

function stubSocialContext(contactId) {
  const entityVersions = { customer: 1, relationship: 1, memory: 1, interactionPolicy: 1, routing: 1 };
  return {
    found: true, ready: true, contactId, contextVersion: 1, entityVersions,
    guards: { canGenerateReply: true },
    relationshipPotential: { relationshipStage: 'familiar' },
    emotion: { trend: 'stable', current: 'neutral' },
    interaction: {}, preferences: {}, interactionPolicy: { policy: 'p' },
    replyStrategy: { maxQuestions: 1 },
    memory: {
      confirmedFacts: [], userNotes: [], importantEvents: [], openLoops: [],
      promises: [], boundaries: [], sensitiveTopics: [], recurringInterests: []
    },
    timeline: [], recentSignals: [], recentMessages: []
  };
}

function makeFakeStoreManager(onCandidateReady) {
  return {
    select: () => stubSocialContext('c1'),
    dispatch: async (command) => {
      if (command.type === 'AI_REPLY_TASK_STARTED') return { result: { taskId: 't1' } };
      if (command.type === 'AI_REPLY_CANDIDATE_READY') {
        if (onCandidateReady) onCandidateReady(command.payload);
        return { result: { candidateId: 'cid1' } };
      }
      return { result: {} };
    }
  };
}

const CANDIDATE_DDL = `
  CREATE TABLE ai_reply_candidates (
    candidate_id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    contact_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    text TEXT NOT NULL,
    original_text TEXT NOT NULL DEFAULT '',
    model_id TEXT NOT NULL DEFAULT '',
    model_name TEXT NOT NULL DEFAULT '',
    context_version INTEGER NOT NULL DEFAULT 0,
    entity_versions_json TEXT NOT NULL DEFAULT '{}',
    reply_strategy_json TEXT NOT NULL DEFAULT '{}',
    relationship_potential_json TEXT NOT NULL DEFAULT '{}',
    state TEXT NOT NULL DEFAULT 'generated',
    persona_version_id INTEGER NOT NULL DEFAULT 0,
    persona_policy_hash TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;

test('AC-036: upsertAiReplyCandidate 持久化 persona_version_id + persona_policy_hash', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE contacts (id TEXT PRIMARY KEY);');
  db.exec("INSERT INTO contacts(id) VALUES ('c1');");
  db.exec(CANDIDATE_DDL);
  const adapter = new SqliteStorePersistenceAdapter({ store: { db } });
  const tx = adapter._createTransaction();
  tx.upsertAiReplyCandidate({
    candidateId: 'c1', taskId: 't1', contactId: 'c1', conversationId: 'conv1',
    text: 'hi', modelId: 'm1', model: 'Model',
    contextVersion: 1, entityVersions: { customer: 1 }, replyStrategy: {}, relationshipPotential: {},
    state: 'generated', personaVersionId: 3, personaPolicyHash: 'hash-abc'
  });
  const row = db.prepare(
    'SELECT persona_version_id, persona_policy_hash FROM ai_reply_candidates WHERE candidate_id=?'
  ).get('c1');
  assert.strictEqual(row.persona_version_id, 3);
  assert.strictEqual(row.persona_policy_hash, 'hash-abc');
});

test('AC-036: generateCandidate 将候选绑定到活跃 persona（personaVersionId/policyHash）', async () => {
  const personaStore = makeStore();
  const personaBrain = createPersonaBrain({ store: personaStore });
  personaBrain.service.initialize({});
  const profile = personaBrain.service.getCurrent('owner');
  const expectedVersion = profile.version.version;
  const expectedHash = personaBrain.service.resolveEffective({
    contactId: 'c1', conversationId: 'conv1'
  }, {
    candidateAdjustment: {},
    socialContext: stubSocialContext('c1')
  }).effectivePolicyHash;

  const originalGet = contactContextAuthority.getSocialContext;
  contactContextAuthority.getSocialContext = () => stubSocialContext('c1');

  let captured = null;
  const storeManager = makeFakeStoreManager((payload) => { captured = payload; });
  const aiGateway = {
    execute: async (input) => input.task === 'director'
      ? ({
          text: JSON.stringify({
            strategy: 'natural continuation', reasonZh: '自然承接对方最新消息', goal: 'continue',
            tone: 'warm', pace: 'light', instruction: 'reply naturally', avoid: 'invented facts',
            // This test has no verified contact language. The production director contract must not guess one.
            targetLanguage: 'unknown', maxQuestions: 1
          }),
          modelId: 'director-1', model: 'Director'
        })
      : ({ text: 'hi', modelId: 'm1', model: 'Model' })
  };

  try {
    const brain = createContextAwareReplyBrain({ storeManager, aiGateway, personaBrain });
    const result = await brain.generateCandidate({
      contactId: 'c1', conversationId: 'conv1',
      incomingMessage: { id: 'm1', text: 'hello' },
      director: { persona: 'warm' }
    });

    assert.strictEqual(result.requiresUserApproval, true);
    assert.ok(captured, 'AI_REPLY_CANDIDATE_READY payload 未被捕获');
    assert.strictEqual(captured.personaVersionId, expectedVersion);
    assert.strictEqual(captured.personaPolicyHash, expectedHash);
    assert.strictEqual(captured.targetLanguageCode, 'unknown');
  } finally {
    contactContextAuthority.getSocialContext = originalGet;
  }
});

test('AC-036: compile-context 运行时契约可在无 Express 环境独立校验', () => {
  const store = makeStore();
  const brain = createPersonaBrain({ store });
  brain.service.initialize({});
  const body = compilePersonaContext(brain, 'owner', {});
  assert.strictEqual(body.ok, true);
  assert.strictEqual(typeof body.personaVersionId, 'number');
  assert.strictEqual(typeof body.policyHash, 'string');
  assert.strictEqual(body.safeFallback, false);
});
