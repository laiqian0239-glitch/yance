'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { R32SqliteStore } = require('../../backend/lib/r32SqliteStore');
const { RelationshipKeyNodeRepository } = require('../../backend/store/relationshipKeyNodeRepository');
const authority = require('../../backend/services/relationshipProjectionAuthority');
const workspaceRepository = require('../../backend/repositories/workspaceRepository');

function createStore(prefix = 'yance-relationship-authority-') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const store = new R32SqliteStore({ dbPath: path.join(root, 'store', 'yance-r32.db') });
  return { root, store };
}

function seedIdentity(store, suffix = '1', canonicalContactId = `customer-${suffix}`) {
  const contactId = `contact-${suffix}`;
  const conversationId = `conv-${suffix}`;
  const accountId = `wa-account-${suffix}`;
  store.upsertContact({
    id: contactId,
    platform: 'whatsapp',
    accountId,
    externalId: `49123456${suffix}@s.whatsapp.net`,
    displayName: `Customer ${suffix}`,
    canonicalContactId
  });
  store.upsertConversation({
    sessionKey: conversationId,
    accountId,
    contactId,
    platform: 'whatsapp',
    title: `Customer ${suffix}`
  });
  return { contactId, conversationId, accountId, canonicalContactId };
}

function seedMessage(store, identity, id, sentAt, text = 'Danke für deine Nachricht.') {
  store.upsertMessage({
    id,
    externalMessageId: 'same-platform-message-id',
    sessionKey: identity.conversationId,
    accountId: identity.accountId,
    direction: 'incoming',
    text,
    translatedZh: '谢谢你的消息。',
    translationStatus: 'success',
    translationModel: 'translategemma:4b',
    sentAt
  });
}

function seedSocialProjection(store, identity, messageId, options = {}) {
  const now = options.at || '2026-07-22T03:30:00.000Z';
  store.db.prepare(`
    INSERT INTO customer_social_state(
      contact_id, relationship_json, emotion_json, interaction_json,
      preferences_json, strategy_json, potential_json, version,
      source_message_id, source_message_at, calculated_at, engine_version,
      payload_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, '{}', ?, ?, 3, ?, ?, ?, '2.0.0', '{}', ?, ?)
  `).run(
    identity.contactId,
    JSON.stringify({ stage: 'warming' }),
    JSON.stringify({ trend: 'improving', warmth: 0.7, openness: 0.65, tension: 0.18, trust: 0.6 }),
    JSON.stringify({ initiatesConversationRate: 0.58, averageReplyDelayMinutes: 18 }),
    JSON.stringify({ recommendedTone: 'warm_calm', recommendedLength: 'short', recommendedDepth: 'light_personal' }),
    JSON.stringify({ relationshipStage: 'warming', momentum: 'improving', warmth: 0.7, openness: 0.65, trust: 0.6, initiative: 0.58, tension: 0.18 }),
    messageId, now, now, now, now
  );

  const insertSignal = store.db.prepare(`
    INSERT INTO relationship_state_signals(
      signal_id, idempotency_key, platform, source_account_id, platform_message_id, projection_version,
      contact_id, conversation_id, message_id, signal_type, dimension, direction,
      strength, confidence, observed_at, evidence_json, source, parser_version, status, created_at, updated_at
    ) VALUES (?, ?, 'whatsapp', ?, 'same-platform-message-id', '2.0.0', ?, ?, ?, ?, ?, ?, 0.8, 0.9, ?, '{}', 'social_parser', '2.0.0', 'confirmed', ?, ?)
  `);
  insertSignal.run(`signal-${identity.accountId}-1`, `sig:${identity.accountId}:1`, identity.accountId, identity.contactId, identity.conversationId, messageId, 'warmth_increasing', 'warmth', 'positive', now, now, now);
  insertSignal.run(`signal-${identity.accountId}-2`, `sig:${identity.accountId}:2`, identity.accountId, identity.contactId, identity.conversationId, messageId, 'openness_increasing', 'openness', 'positive', now, now, now);

  const insertEvent = store.db.prepare(`
    INSERT INTO relationship_timeline_events(
      event_id, idempotency_key, platform, source_account_id, platform_message_id, projection_version,
      contact_id, conversation_id, event_type, started_at, confirmed_at,
      before_json, after_json, interpretation, evidence_message_ids_json, source_signal_ids_json,
      confidence, status, engine_version, created_at, updated_at
    ) VALUES (?, ?, 'whatsapp', ?, 'same-platform-message-id', '2.0.0', ?, ?, ?, ?, ?, '{}', '{}', ?, ?, '[]', 0.9, 'confirmed', '2.0.0', ?, ?)
  `);
  insertEvent.run(`event-${identity.accountId}-1`, `evt:${identity.accountId}:1`, identity.accountId, identity.contactId, identity.conversationId, 'warmth_increasing', now, now, '对方回应温暖度提升，关系氛围正在改善。', JSON.stringify([messageId]), now, now);
  insertEvent.run(`event-${identity.accountId}-2`, `evt:${identity.accountId}:2`, identity.accountId, identity.contactId, identity.conversationId, 'openness_increasing', now, now, '对方愿意分享更多内容，开放度正在提升。', JSON.stringify([messageId]), now, now);

  new RelationshipKeyNodeRepository({ db: store.db });
  store.db.prepare("UPDATE relationship_timeline_events SET is_key_node=1, node_kind='fact', marked_by='user', marked_at=? WHERE event_id=?")
    .run(now, `event-${identity.accountId}-1`);
}

test('valid social nodes produce a deterministic Chinese rule projection instead of an empty waiting state', () => {
  const { root, store } = createStore();
  try {
    const identity = seedIdentity(store);
    seedMessage(store, identity, 'message-1', '2026-07-22T03:29:00.000Z');
    seedSocialProjection(store, identity, 'message-1');

    const context = workspaceRepository.getContextByConversation(identity.conversationId, store);
    const projection = context.relationshipProjection;
    const trajectory = projection.trajectory;

    assert.equal(projection.authorityId, 'RelationshipProjectionAuthority');
    assert.equal(projection.state, 'pending_analysis');
    assert.equal(projection.source, 'social_rule_projection');
    assert.equal(projection.socialNodeCount, 2);
    assert.equal(projection.signalCount, 2);
    assert.equal(projection.keyNodeCount, 1);
    assert.equal(trajectory.stage, '关系升温');
    assert.match(trajectory.summary, /2 条真实关系信号/);
    assert.doesNotMatch(trajectory.summary, /暂无可确认内容|等待真实分析/);
    assert.doesNotMatch(trajectory.next, /等待真实分析/);
    assert.equal(trajectory.analysisRequired, true);
    assert.equal(trajectory.analysisStatusLabel, 'AI 分析待执行，已显示规则投影');
    assert.equal(trajectory.bilingualPresentation.summary.displayText, trajectory.summary);
    assert.equal(trajectory.bilingualPresentation.stage.displayText, '关系升温');
    assert.equal(trajectory.bilingualPresentation.truthRules.ruleProjectionIsNotAiAnalysis, true);
    assert.equal(trajectory.events.length, 2);
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('fresh AI insight becomes ready and a newer real message makes the same projection stale without discarding the last insight', () => {
  const { root, store } = createStore();
  try {
    const identity = seedIdentity(store);
    seedMessage(store, identity, 'message-1', '2026-07-22T03:29:00.000Z');
    seedSocialProjection(store, identity, 'message-1');
    workspaceRepository.upsertInsights(identity.contactId, identity.conversationId, {
      summary: '客户愿意继续交流，当前互动正在升温。',
      relationshipStage: '信任建立',
      nextAction: '保持自然承接，并围绕对方主动分享的内容继续。',
      initiativeScore: 62,
      opportunityScore: 70,
      riskScore: 18
    }, {
      sourceMessageCount: 1,
      analyzedThroughMessageId: 'message-1',
      analyzedThroughAt: '2026-07-22T03:30:00.000Z',
      modelId: 'qwen3.5:4b',
      modelName: 'qwen3.5:4b',
      status: 'ready'
    }, store);

    let context = workspaceRepository.getContextByConversation(identity.conversationId, store);
    assert.equal(context.relationshipProjection.state, 'ready');
    assert.equal(context.relationshipProjection.source, 'ai_analysis');
    assert.equal(context.relationshipProjection.trajectory.summary, '客户愿意继续交流，当前互动正在升温。');
    assert.equal(context.relationshipProjection.trajectory.analysisRequired, false);

    seedMessage(store, identity, 'message-2', '2026-07-22T03:40:00.000Z', 'Ich habe noch eine Frage.');
    context = workspaceRepository.getContextByConversation(identity.conversationId, store);
    assert.equal(context.relationshipProjection.state, 'stale');
    assert.equal(context.relationshipProjection.trajectory.analysisRequired, true);
    assert.equal(context.relationshipProjection.trajectory.summary, '客户愿意继续交流，当前互动正在升温。');
    assert.equal(context.relationshipProjection.trajectory.analysisStatusLabel, '已有新消息，关系分析待更新');
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('same platform message id in two account instances remains isolated by contact and conversation', () => {
  const { root, store } = createStore();
  try {
    const first = seedIdentity(store, '1', 'shared-customer');
    const second = seedIdentity(store, '2', 'shared-customer');
    seedMessage(store, first, 'row-first', '2026-07-22T03:20:00.000Z');
    seedMessage(store, second, 'row-second', '2026-07-22T03:21:00.000Z');
    seedSocialProjection(store, first, 'row-first');
    seedSocialProjection(store, second, 'row-second');

    const firstProjection = workspaceRepository.getContextByConversation(first.conversationId, store).relationshipProjection;
    const secondProjection = workspaceRepository.getContextByConversation(second.conversationId, store).relationshipProjection;

    assert.equal(firstProjection.socialNodeCount, 2);
    assert.equal(secondProjection.socialNodeCount, 2);
    assert.equal(firstProjection.sourceScope.sourceAccountId, 'wa-account-1');
    assert.equal(secondProjection.sourceScope.sourceAccountId, 'wa-account-2');
    assert.equal(firstProjection.sourceScope.conversationId, 'conv-1');
    assert.equal(secondProjection.sourceScope.conversationId, 'conv-2');
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('frontend no longer invents relationship summary or stage from StoreManager context', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../frontend/js/r32-ui-runtime.js'), 'utf8');
  const service = fs.readFileSync(path.resolve(__dirname, '../../backend/services/workspaceService.js'), 'utf8');
  const repository = fs.readFileSync(path.resolve(__dirname, '../../backend/repositories/workspaceRepository.js'), 'utf8');

  assert.doesNotMatch(source, /summary:`当前关系势能/);
  assert.doesNotMatch(source, /stage:p\.relationshipStage\|\|trajectoryState/);
  assert.match(source, /socialMetrics:\{initiative:/);
  assert.match(source, /loadCrossModuleContext\(next,\{render:true\}\)/);
  assert.doesNotMatch(source, /profileText\(p\.next,'等待真实分析。'\)/);
  assert.match(source, /effectiveNodeCount=Number\(t\.relationshipProjection\?\.socialNodeCount/);
  assert.match(source, /t\.projectionSource==='ai_analysis'/);
  assert.match(service, /RelationshipProjectionAuthority/);
  assert.match(repository, /relationshipProjectionAuthority\.projectFromStore/);
});
