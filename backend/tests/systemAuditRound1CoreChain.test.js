'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const messageSpeakerAuthority = require('../services/messageSpeakerAuthority');
const contactFactExtractionService = require('../services/contactFactExtractionService');
const conversationTurnCoordinator = require('../services/conversationTurnCoordinator');
const aiBrainOrchestrator = require('../services/aiBrainOrchestrator');
const { parseSocialSignals } = require('../store/social/socialSignalParser');
const { R32SqliteStore } = require('../lib/r32SqliteStore');
const workspaceRepository = require('../repositories/workspaceRepository');
const socialChineseUnderstandingService = require('../services/socialChineseUnderstandingService');
const { configureStoreManager, resetStoreManagerForTests } = require('../store/storeManagerSingleton');
const { registerRuntimeStateCommands } = require('../store/commands/registerRuntimeStateCommands');
const { selectCustomerSocialContext } = require('../store/selectors/customerSocialSelectors');
const { buildSocialDecisionPacket, compactSocialDecisionPacket } = require('../services/contextAwareReplyBrain');

function insertBase(store) {
  const now = '2026-07-25T00:00:00.000Z';
  store.db.prepare(`
    INSERT INTO contacts(id, platform, account_id, external_id, display_name, canonical_contact_id, created_at, updated_at)
    VALUES ('contact-kurt', 'facebook', 'fb-page-yeonhee', 'kurt-psid', 'Kurt', 'contact-kurt', ?, ?)
  `).run(now, now);
  store.db.prepare(`
    INSERT INTO r32_conversations(session_key, account_id, contact_id, platform, title, payload_json, created_at, updated_at)
    VALUES ('facebook:fb-page-yeonhee:kurt', 'fb-page-yeonhee', 'contact-kurt', 'facebook', 'Kurt', '{}', ?, ?)
  `).run(now, now);
}

function insertMessage(store, row) {
  store.db.prepare(`
    INSERT INTO r32_messages(
      id, session_key, account_id, sender_id, role, direction, message_type, text,
      payload_json, sent_at, created_at, updated_at
    ) VALUES (?, 'facebook:fb-page-yeonhee:kurt', 'fb-page-yeonhee', ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.id,
    row.senderId || '',
    row.role || '',
    row.direction || '',
    row.type || 'text',
    row.text || '',
    JSON.stringify({
      externalMessageId: row.id,
      platform: 'facebook',
      sourceAccountId: 'fb-page-yeonhee',
      fromMe: row.fromMe === true,
      translationStatus: row.translationStatus || ''
    }),
    row.sentAt,
    row.sentAt,
    row.sentAt
  );
}

function structuredResult() {
  return {
    modelId: 'round1-test-model',
    model: 'Round 1 Test Model',
    structured: {
      analysis: { summary: '对方正在介绍自己。', evidence: [{ messageId: 'peer-1', quote: 'Ich bin 65.' }] },
      profile: { facts: { age: '65' }, confirmedFacts: [{ key: 'age', value: '65', messageId: 'peer-1' }], inferredFacts: [] },
      insights: { summary: '初步了解。', relationshipStage: '初识', evidence: [{ messageId: 'peer-1', quote: 'Ich bin 65.' }] }
    }
  };
}

test('one authority separates peer, self echo, system, forwarded, quoted and draft messages', () => {
  assert.deepEqual(messageSpeakerAuthority.classify({ role: 'contact', direction: 'inbound', fromMe: false }).speaker, 'peer');
  assert.deepEqual(messageSpeakerAuthority.classify({ role: 'user', direction: 'echo', fromMe: true, isEcho: true }).direction, 'echo');
  assert.equal(messageSpeakerAuthority.isPeerInbound({ role: 'system', fromMe: false, type: 'text' }), false);
  assert.equal(messageSpeakerAuthority.isPeerInbound({ direction: 'platform', fromMe: false, type: 'text' }), false);
  assert.equal(messageSpeakerAuthority.isPeerInbound({ role: 'forwarded', fromMe: false, text: 'Ich bin 41.' }), false);
  assert.equal(messageSpeakerAuthority.isPeerInbound({ role: 'quoted', fromMe: false, text: 'Ich bin 41.' }), false);
  assert.equal(messageSpeakerAuthority.isPeerInbound({ role: 'draft', text: 'Ich bin 41.' }), false);
});

test('system/control content cannot trigger facts, turn cancellation, AI automation or social signals', () => {
  const systemMessage = {
    id: 'system-1',
    role: 'system',
    direction: 'system',
    fromMe: false,
    platform: 'facebook',
    conversationId: 'facebook:fb-page-yeonhee:kurt',
    type: 'text',
    text: 'Ich bin 41 und lebe in Berlin.'
  };
  assert.equal(contactFactExtractionService.extractDeterministicFacts(systemMessage).reason, 'NOT_PEER_INBOUND');
  assert.equal(conversationTurnCoordinator.inboundMessage(systemMessage), false);
  assert.equal(aiBrainOrchestrator.shouldScheduleInboundMessage(systemMessage), false);
  assert.deepEqual(parseSocialSignals({
    contactId: 'contact-kurt',
    conversationId: systemMessage.conversationId,
    platform: 'facebook',
    sourceAccountId: 'fb-page-yeonhee',
    message: systemMessage,
    recentMessages: [systemMessage]
  }), []);
});

test('automatic AI treats generation changes as superseded work rather than a model failure', () => {
  assert.equal(aiBrainOrchestrator.isSupersededAnalysisError({ code: 'AI_STALE_RESULT' }), true);
  assert.equal(aiBrainOrchestrator.isSupersededAnalysisError({ code: 'ALL_MODELS_FAILED' }), false);
  const source = fs.readFileSync(path.join(__dirname, '../services/aiBrainOrchestrator.js'), 'utf8');
  assert.match(source, /if \(isSupersededAnalysisError\(error\)\)/u);
  assert.match(source, /lastSkipReason: 'superseded'/u);
  assert.match(source, /retryScheduled: true/u);
  const staleBranch = source.indexOf('if (isSupersededAnalysisError(error))');
  const staleReturn = source.indexOf("reason: 'superseded'", staleBranch);
  const failureIncrement = source.indexOf('failed: Number(current.failed', staleBranch);
  assert.ok(staleBranch >= 0 && staleReturn > staleBranch && failureIncrement > staleReturn, 'superseded branch returns before the real failure counter');
});

test('conversation analysis excludes system messages and binds model execution to platform/account/session generation', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-round1-authority-'));
  const store = new R32SqliteStore({ dbPath: path.join(root, 'authority.db') });
  const originalTranslateBundle = socialChineseUnderstandingService.translateBundle;
  socialChineseUnderstandingService.translateBundle = async payload => ({
    translated: { analysis: payload.analysis, profile: payload.profile, insights: payload.insights },
    translationStatus: 'success',
    translationModel: 'test-translator',
    translatedAt: '2026-07-25T00:10:00.000Z'
  });
  try {
    insertBase(store);
    insertMessage(store, { id: 'peer-1', senderId: 'kurt-psid', role: 'contact', direction: 'inbound', text: 'Ich bin 65.', sentAt: '2026-07-25T00:01:00.000Z' });
    insertMessage(store, { id: 'system-1', senderId: '', role: 'system', direction: 'system', text: 'SYSTEM SECRET SHOULD NOT REACH MODEL', sentAt: '2026-07-25T00:02:00.000Z' });
    insertMessage(store, { id: 'self-1', senderId: 'fb-page-yeonhee', role: 'user', direction: 'outbound', fromMe: true, text: 'Danke.', sentAt: '2026-07-25T00:03:00.000Z' });

    let executionPayload = null;
    const result = await workspaceRepository.analyzeConversation('facebook:fb-page-yeonhee:kurt', {
      store,
      executor: async payload => {
        executionPayload = payload;
        return structuredResult();
      }
    });
    assert.equal(result.ok, true);
    const prompt = executionPayload.messages.map(row => row.content).join('\n');
    assert.doesNotMatch(prompt, /SYSTEM SECRET SHOULD NOT REACH MODEL/);
    assert.match(prompt, /Ich bin 65/);
    assert.equal(executionPayload.context.platform, 'facebook');
    assert.equal(executionPayload.context.sourceAccountId, 'fb-page-yeonhee');
    assert.equal(executionPayload.context.sessionKey, 'facebook:fb-page-yeonhee:kurt');
    assert.match(executionPayload.context.generation, /^[a-f0-9]{64}$/);
  } finally {
    socialChineseUnderstandingService.translateBundle = originalTranslateBundle;
    try { store.close(); } catch (_) {}
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('new message arriving during model execution supersedes the old model analysis before AI profile and insight writeback', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-round1-stale-'));
  const store = new R32SqliteStore({ dbPath: path.join(root, 'stale.db') });
  try {
    insertBase(store);
    insertMessage(store, { id: 'peer-1', senderId: 'kurt-psid', role: 'contact', direction: 'inbound', text: 'Ich bin 65.', sentAt: '2026-07-25T00:01:00.000Z' });

    await assert.rejects(
      workspaceRepository.analyzeConversation('facebook:fb-page-yeonhee:kurt', {
        store,
        executor: async payload => {
          assert.match(payload.context.generation, /^[a-f0-9]{64}$/);
          insertMessage(store, { id: 'peer-2', senderId: 'kurt-psid', role: 'contact', direction: 'inbound', text: 'Ich wohne bei Wien.', sentAt: '2026-07-25T00:02:00.000Z' });
          return structuredResult();
        }
      }),
      error => error.code === 'AI_STALE_RESULT' && error.reason === 'MESSAGE_COUNT_CHANGED'
    );

    const run = store.db.prepare('SELECT status, error_text AS errorText, result_json AS resultJson FROM ai_analysis_runs ORDER BY started_at DESC LIMIT 1').get();
    assert.equal(run.status, 'superseded');
    assert.match(run.errorText, /AI_STALE_RESULT/);
    assert.equal(JSON.parse(run.resultJson).staleReason, 'MESSAGE_COUNT_CHANGED');
    const profile = store.db.prepare('SELECT * FROM customer_profiles WHERE contact_id=?').get('contact-kurt');
    assert.equal(JSON.parse(profile.facts_json).age, '65');
    assert.equal(profile.model_id, '');
    assert.equal(profile.review_status, 'manual');
    const insights = store.db.prepare('SELECT * FROM relationship_insights WHERE contact_id=?').get('contact-kurt');
    assert.equal(insights, undefined);
  } finally {
    try { store.close(); } catch (_) {}
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});


test('completed workspace profile and relationship analysis are projected into the same StoreManager context used by director and candidates', async () => {
  resetStoreManagerForTests();
  const seed = {
    customers: { ready: true, byId: {}, activeIds: [], archivedIds: [], currentId: '' },
    conversations: { ready: true, byId: {}, byContactId: {}, recentMessagesById: {} },
    relationships: { ready: true, byContactId: {} },
    memories: { ready: true, byContactId: {} },
    interactionPolicies: { ready: true, byContactId: {} }
  };
  const storeManager = configureStoreManager({
    replace: true,
    persistence: { loadSnapshot: async () => seed }
  });
  registerRuntimeStateCommands(storeManager);
  try {
    await storeManager.hydrate();
    await storeManager.dispatch({
      type: 'SYNC_CUSTOMER_CONTEXT',
      source: 'round1-test',
      payload: {
        context: {
          contact: { id: 'contact-kurt', displayName: 'Kurt', platform: 'facebook', accountId: 'fb-page-yeonhee' },
          profile: {
            version: 5,
            confirmed: [{ id: 'fact-age', key: 'age', value: '65', status: 'confirmed', factClass: 'explicit', allowInReply: true, evidenceStatus: 'verified' }],
            payload: { recurringInterests: [{ value: '骑行', status: 'confirmed', allowInReply: true }] }
          },
          insights: {
            version: 7,
            summary: '对方愿意继续了解。',
            relationshipStage: '初识升温',
            tone: '轻松',
            hiddenNeed: '希望自然交流',
            nextAction: '围绕兴趣继续聊天',
            opportunityScore: 72,
            riskScore: 18,
            evidence: [{ messageId: 'peer-1', quote: 'Ich fahre gern Rad.' }],
            openLoops: ['骑行路线'],
            status: 'ready',
            modelId: 'understanding-primary',
            analyzedThroughMessageId: 'peer-1',
            analyzedThroughAt: '2026-07-25T00:01:00.000Z',
            updatedAt: '2026-07-25T00:02:00.000Z'
          },
          conversations: [{ sessionKey: 'facebook:fb-page-yeonhee:kurt', accountId: 'fb-page-yeonhee', platform: 'facebook' }]
        }
      }
    });
    const context = storeManager.select(selectCustomerSocialContext('contact-kurt'));
    assert.equal(context.memory.confirmedFacts[0].value, '65');
    assert.equal(context.relationshipAnalysis.summary, '对方愿意继续了解。');
    assert.equal(context.relationshipAnalysis.relationshipStage, '初识升温');
    const packet = buildSocialDecisionPacket(context, { id: 'peer-2', text: 'Hallo', direction: 'inbound' });
    const compact = compactSocialDecisionPacket(packet);
    assert.equal(compact.relationshipAnalysis.nextAction, '围绕兴趣继续聊天');
    assert.equal(compact.relationshipAnalysis.modelId, 'understanding-primary');

    const coordinatorSource = fs.readFileSync(path.join(__dirname, '../core/projections/storeProjectionCoordinator.js'), 'utf8');
    assert.match(coordinatorSource, /workspace\.analysis\.completed/u);
    assert.match(coordinatorSource, /type: 'SYNC_CUSTOMER_CONTEXT'/u);
    assert.match(coordinatorSource, /store:workspace-context-synced/u);
  } finally {
    resetStoreManagerForTests();
  }
});


test('revoking a source message transactionally disables its facts, interests, evidence and relationship analysis', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-round1-revoke-'));
  const store = new R32SqliteStore({ dbPath: path.join(root, 'revoke.db') });
  try {
    insertBase(store);
    insertMessage(store, { id: 'peer-interest', senderId: 'kurt-psid', role: 'contact', direction: 'inbound', text: 'Ich bin 65 und fahre gern Rad.', sentAt: '2026-07-25T00:01:00.000Z' });
    const fact = {
      id: 'fact-age', key: 'age', value: '65', status: 'confirmed', factClass: 'explicit',
      allowInReply: true, evidenceStatus: 'verified', sourceMessageId: 'peer-interest',
      evidence: [{ sourceMessageId: 'peer-interest', platformMessageId: 'peer-interest', sourceText: 'Ich bin 65.', direction: 'inbound', speaker: 'peer' }]
    };
    store.db.prepare(`
      INSERT INTO customer_profiles(contact_id, facts_json, confirmed_facts_json, payload_json, created_at, updated_at)
      VALUES ('contact-kurt', ?, ?, ?, ?, ?)
    `).run(
      JSON.stringify({ age: '65', interests: '骑行' }),
      JSON.stringify([fact]),
      JSON.stringify({ recurringInterests: [{ value: '骑行', sourceMessageId: 'peer-interest', status: 'confirmed', allowInReply: true }] }),
      '2026-07-25T00:02:00.000Z', '2026-07-25T00:02:00.000Z'
    );
    store.db.prepare(`
      INSERT INTO customer_profile_evidence(
        evidence_id,idempotency_key,canonical_contact_id,platform,source_account_id,
        conversation_id,platform_message_id,evidence_type,projection_version,source_text,
        payload_json,created_at,updated_at
      ) VALUES ('evidence-age','evidence-age','contact-kurt','facebook','fb-page-yeonhee',
        'facebook:fb-page-yeonhee:kurt','peer-interest','fact:age','1','Ich bin 65.',?,?,?)
    `).run(JSON.stringify({ platformMessageId: 'peer-interest', status: 'confirmed', allowInReply: true }), '2026-07-25T00:02:00.000Z', '2026-07-25T00:02:00.000Z');
    store.db.prepare(`
      INSERT INTO relationship_insights(contact_id,conversation_id,summary,relationship_stage,status,evidence_json,payload_json,created_at,updated_at)
      VALUES ('contact-kurt','facebook:fb-page-yeonhee:kurt','对方喜欢骑行','初识','ready',?,'{}',?,?)
    `).run(JSON.stringify([{ messageId: 'peer-interest' }]), '2026-07-25T00:02:00.000Z', '2026-07-25T00:02:00.000Z');
    store.db.prepare(`
      INSERT INTO ai_analysis_runs(id,conversation_id,contact_id,status,source_last_message_id,request_json,result_json,started_at,completed_at)
      VALUES ('run-revoke','facebook:fb-page-yeonhee:kurt','contact-kurt','completed','peer-interest','{}','{}',?,?)
    `).run('2026-07-25T00:02:00.000Z', '2026-07-25T00:03:00.000Z');

    const result = workspaceRepository.retractMessageEvidence(
      'facebook:fb-page-yeonhee:kurt',
      ['peer-interest'],
      { store, at: '2026-07-25T00:04:00.000Z', publish: false }
    );
    assert.equal(result.retracted, true);
    assert.equal(result.profileFactsAffected, 1);
    assert.equal(result.recurringInterestsAffected, 1);
    assert.equal(result.evidenceRowsAffected, 1);
    assert.equal(result.insightsInvalidated, true);

    const profile = store.db.prepare('SELECT * FROM customer_profiles WHERE contact_id=?').get('contact-kurt');
    const facts = JSON.parse(profile.facts_json);
    const confirmed = JSON.parse(profile.confirmed_facts_json);
    const interests = JSON.parse(profile.payload_json).recurringInterests;
    assert.equal(facts.age, undefined);
    assert.equal(confirmed[0].status, 'forgotten');
    assert.equal(confirmed[0].allowInReply, false);
    assert.equal(confirmed[0].evidenceStatus, 'revoked');
    assert.equal(interests[0].status, 'forgotten');
    assert.equal(interests[0].allowInReply, false);
    const evidence = store.db.prepare('SELECT payload_json FROM customer_profile_evidence WHERE evidence_id=?').get('evidence-age');
    assert.equal(JSON.parse(evidence.payload_json).evidenceStatus, 'revoked');
    assert.equal(store.db.prepare('SELECT status FROM relationship_insights WHERE contact_id=?').get('contact-kurt').status, 'stale');
    assert.equal(store.db.prepare('SELECT status FROM ai_analysis_runs WHERE id=?').get('run-revoke').status, 'superseded');
  } finally {
    try { store.close(); } catch (_) {}
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('stale relationship analysis is excluded from director and candidate context', async () => {
  resetStoreManagerForTests();
  const storeManager = configureStoreManager({ replace: true, persistence: { loadSnapshot: async () => ({
    customers: { ready: true, byId: {}, activeIds: [], archivedIds: [], currentId: '' },
    conversations: { ready: true, byId: {}, byContactId: {}, recentMessagesById: {} },
    relationships: { ready: true, byContactId: {} }, memories: { ready: true, byContactId: {} },
    interactionPolicies: { ready: true, byContactId: {} }
  }) } });
  registerRuntimeStateCommands(storeManager);
  try {
    await storeManager.hydrate();
    await storeManager.dispatch({ type: 'SYNC_CUSTOMER_CONTEXT', source: 'round1-stale-test', payload: { context: {
      contact: { id: 'contact-kurt', displayName: 'Kurt' },
      profile: {},
      insights: { summary: '已经失效的分析', relationshipStage: '错误阶段', status: 'stale', updatedAt: '2026-07-25T00:04:00.000Z' },
      conversations: []
    } } });
    const context = storeManager.select(selectCustomerSocialContext('contact-kurt'));
    assert.equal(context.relationshipAnalysis.stale, true);
    assert.equal(context.relationshipAnalysis.summary, undefined);
  } finally {
    resetStoreManagerForTests();
  }
});
