'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { R32SqliteStore } = require('../lib/r32SqliteStore');
const { createPlatformCoreRepository } = require('../repositories/platformCoreRepository');
const { IdentityLinkAuthority } = require('../services/identityLinkAuthority');
const { mergeFacts, canonicalFactKey } = require('../services/personContextAuthority');
const relationshipProjectionAuthority = require('../services/relationshipProjectionAuthority');
const workspace = require('../repositories/workspaceRepository');
const presentation = require('../../frontend/js/r32-business-presentation-authority');

function runtime() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-f25-b6-'));
  const store = new R32SqliteStore({ dbPath: path.join(root, 'database', 'yance.db') });
  const repository = createPlatformCoreRepository({ storeProvider: () => store });
  const identity = new IdentityLinkAuthority({ repository });
  return { root, store, repository, identity };
}
function cleanup(value) {
  try { value.store.close(); } catch (_) {}
  fs.rmSync(value.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 });
}

function evidenceFact(key, value, messageId = 'm-1') {
  return {
    key, value, text: `${key}：${value}`, status: 'confirmed', confidence: 1,
    direction: 'inbound', speaker: 'peer', evidence: [{ messageId, platformMessageId: messageId, sourceText: String(value) }]
  };
}

test('Person fact authority canonicalizes aliases, aggregates evidence, and removes duplicate location scalars', () => {
  const merged = mergeFacts([{
    contactId: 'fb-contact', updatedAt: '2026-07-27T00:00:00.000Z',
    facts: { occupation: 'Designer', country: 'Germany', address: 'Germany', age: '47' },
    confirmedFacts: [
      evidenceFact('occupation', 'Designer'),
      evidenceFact('country', 'Germany'),
      evidenceFact('address', 'Germany'),
      evidenceFact('age', '47')
    ]
  }]);
  assert.equal(canonicalFactKey('职业'), 'job');
  assert.equal(canonicalFactKey('occupation'), 'job');
  assert.deepEqual(merged.facts, { job: 'Designer', country: 'Germany', age: '47' });
  assert.equal(merged.confirmedFacts.some(row => row.key === 'address'), false);
  assert.equal(merged.factCount, 3);
  assert.equal(merged.evidenceCount, 1, 'same source message is one auditable evidence item, not four');
  assert.equal(merged.droppedAliases[0].reason, 'duplicate-location-scalar');
  assert.match(merged.snapshotId, /^[a-f0-9]{64}$/);
});

test('Facebook numeric platform identity is never rendered as a telephone number', () => {
  const platformIdentity = presentation.businessIdentity('27349886664633044', { platform: 'facebook', kind: 'platform' });
  assert.match(platformIdentity, /^Facebook 公共主页 · 标识尾号 /);
  assert.doesNotMatch(platformIdentity, /联系电话/);
  const verifiedPhone = presentation.businessIdentity('+491701234567', { platform: 'facebook', kind: 'phone' });
  assert.match(verifiedPhone, /^联系电话 · /);
});

test('relationship projection cannot label stored rule or stale insight as current AI analysis', () => {
  const projection = relationshipProjectionAuthority.project({
    insight: {
      summary: '旧页面缓存结论', relationshipStage: 'deep_trust', intimacyScore: 100,
      status: 'ready', modelId: 'old-model', analyzedThroughMessageId: 'old-message'
    },
    messages: [{ id: 'new-message', direction: 'inbound', sourceText: 'Hallo', sentAt: '2026-07-27T01:00:00.000Z' }],
    social: { potential: { warmth: 1, openness: 1, trust: 1, relationshipStage: 'warming' } },
    analysisCurrent: false,
    analysisRunId: 'old-run'
  });
  assert.equal(projection.source, 'social_rule_projection');
  assert.equal(projection.analysisCurrent, false);
  assert.notEqual(projection.state, 'ready');
  assert.equal(projection.trajectory.analysisCommitted, false);
  assert.equal(projection.trajectory.analysisRunId, '');
  assert.notEqual(projection.trajectory.summary, '旧页面缓存结论');
});

test('conversation context exposes one Person/Profile/Relationship snapshot across pages', () => {
  const value = runtime();
  try {
    const now = '2026-07-27T02:00:00.000Z';
    value.store.upsertAccount({
      id: 'page-1', platform: 'facebook', adapterAccountId: 'page-1',
      displayName: 'Facebook Page 1', state: 'ready', canAttemptSend: true,
      sendVerified: true, canSend: true, canReceive: true, updatedAt: now
    });
    value.store.upsertContact({
      id: 'fb-contact', platform: 'facebook', accountId: 'page-1',
      externalId: '27349886664633044', displayName: 'Patric', phone: '27349886664633044',
      payload: { platformContactIdentity: '27349886664633044' }
    });
    value.store.upsertConversation({
      sessionKey: 'fb-conv', contactId: 'fb-contact', accountId: 'page-1',
      platform: 'facebook', title: 'Patric', lastMessageAt: now
    });
    value.store.upsertMessage({
      id: 'm-1', dedupeKey: 'm-1', externalMessageId: 'm-1', platform: 'facebook',
      accountId: 'page-1', sourceAccountId: 'page-1', conversationId: 'fb-conv', sessionKey: 'fb-conv',
      contactId: 'fb-contact', direction: 'inbound', fromMe: false, type: 'text', messageType: 'text',
      text: 'I am 47 and live in Germany.', timestamp: now
    });
    value.identity.observe({
      workspaceId: 'default', platform: 'facebook', sourceAccountId: 'page-1', externalId: '27349886664633044',
      profileContactId: 'fb-contact', conversationId: 'fb-conv', displayName: 'Patric',
      evidenceRefs: ['message:m-1'], actor: 'test', reason: 'real inbound identity'
    });
    workspace.upsertProfile('fb-contact', {
      facts: { age: '47', country: 'Germany', address: 'Germany', occupation: 'Designer' },
      confirmedFacts: [
        evidenceFact('age', '47'), evidenceFact('country', 'Germany'),
        evidenceFact('address', 'Germany'), evidenceFact('occupation', 'Designer')
      ]
    }, { reviewStatus: 'manual' }, value.store);
    workspace.upsertInsights('fb-contact', 'fb-conv', {
      summary: '旧的完整 AI 结论', relationshipStage: 'deep_trust', intimacyScore: 100,
      opportunityScore: 100, evidence: [{ quote: 'old', source: 'old-cache' }]
    }, { status: 'ready', modelId: 'old-model', modelName: 'old-model' }, value.store);
    value.store.db.prepare(`
      INSERT INTO customer_social_state(
        contact_id,relationship_json,emotion_json,interaction_json,preferences_json,strategy_json,potential_json,
        version,source_message_id,source_message_at,calculated_at,engine_version,payload_json,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      'fb-contact', '{}', JSON.stringify({ warmth: 1, openness: 1, trust: 1 }), '{}', '{}', '{}',
      JSON.stringify({ warmth: 1, openness: 1, trust: 1, relationshipStage: 'warming', momentum: 'improving' }),
      1, 'm-1', now, now, 'test', '{}', now, now
    );

    const context = workspace.getContextByConversation('fb-conv', value.store);
    assert.equal(context.contact.phone, '', 'Facebook PSID stored in a legacy phone field must not surface as phone');
    assert.equal(context.contact.platformIdentity, '27349886664633044');
    assert.equal(context.identitySummary.status, 'observed');
    assert.equal(context.profile.exists, true);
    assert.deepEqual(context.profile.facts, { age: '47', country: 'Germany', job: 'Designer' });
    assert.equal(context.profile.confirmed.length, 3);
    assert.equal(context.profile.factCount, 3);
    assert.equal(context.profile.evidenceCount, 1);
    assert.ok(context.profile.health > 0, 'confirmed facts and observed identity must yield a non-zero auditable profile health');

    const temperature = context.relationshipProjection.trajectory.temperature;
    assert.equal(temperature, 100);
    assert.equal(context.profile.temperature, temperature);
    assert.equal(context.insights.intimacyScore, temperature);
    assert.equal(context.authoritySnapshot.relationship.temperature, temperature);
    assert.equal(context.insights.sourceType, 'social_rule_projection');
    assert.equal(context.insights.analysisCommitted, false);
    assert.equal(context.insights.analysisRunId, '');
    assert.notEqual(context.insights.summary, '旧的完整 AI 结论');
    assert.equal(context.insights.factCount, context.profile.factCount);
    assert.equal(context.insights.evidenceCount, context.profile.evidenceCount);
    assert.equal(context.profile.authoritySnapshotId, context.authoritySnapshot.snapshotId);
  } finally { cleanup(value); }
});

test('frontend identity state is based on authority status/profile existence instead of contactId truthiness', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../frontend/js/r32-ui-runtime.js'), 'utf8');
  assert.match(source, /bound:Boolean\(contact\.profileExists\)/);
  assert.doesNotMatch(source, /bound:Boolean\(contact\.contactId\)/);
  assert.match(source, /kind:r\.phone\?'phone':'platform'/);
});
