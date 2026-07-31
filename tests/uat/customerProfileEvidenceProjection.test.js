'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { R32SqliteStore } = require('../../backend/lib/r32SqliteStore');
const presentationService = require('../../backend/services/socialAnalysisPresentationService');
const authority = require('../../backend/services/customerProfileEvidenceAuthority');
const workspaceRepository = require('../../backend/repositories/workspaceRepository');

function scope(overrides = {}) {
  return {
    platform: 'whatsapp',
    sourceAccountId: 'wa-account-1',
    platformContactIdentity: '491234567@s.whatsapp.net',
    conversationId: 'conv-wa-1',
    canonicalContactId: 'customer-1',
    ...overrides
  };
}

function translatedMessage(overrides = {}) {
  return {
    id: 'message-row-1',
    externalMessageId: 'wamid-1',
    accountId: 'wa-account-1',
    sessionKey: 'conv-wa-1',
    text: 'Ich arbeite im Design.',
    translatedZh: '我从事设计工作。',
    translationStatus: 'success',
    translationModel: 'translategemma:4b',
    ...overrides
  };
}

test('customer profile evidence reuses successful message translation and removes model-random duplicate cards', () => {
  const output = presentationService.buildSocialAnalysisPresentation({
    profile: {
      confirmed: [
        { id: 'model-random-a', title: '职业', text: 'Ich arbeite im Design.', evidence: [{ id: 'e-random-a', messageId: 'wamid-1', quote: 'Ich arbeite im Design.' }] },
        { id: 'model-random-b', title: '职业', text: 'Ich arbeite im Design.', evidence: [{ id: 'e-random-b', messageId: 'wamid-1', quote: 'Ich arbeite im Design.' }] }
      ]
    },
    insights: {},
    analysis: {},
    messages: [translatedMessage()],
    scope: scope()
  });

  assert.equal(output.schemaVersion, 3);
  assert.equal(output.facts.length, 1);
  assert.equal(output.facts[0].translatedZh, '我从事设计工作。');
  assert.equal(output.facts[0].displayText, '我从事设计工作。');
  assert.equal(output.facts[0].translationPending, false);
  assert.equal(output.facts[0].evidence.length, 1);
  assert.equal(output.facts[0].evidence[0].translatedZh, '我从事设计工作。');
  assert.equal(output.counts.pendingTranslations, 0);
});

test('same platform message id remains isolated by source account and conversation', () => {
  const row = { kind: 'fact', title: '职业', sourceText: 'Ich arbeite im Design.', messageId: 'same-mid' };
  const first = authority.resolveProjectionRow(row, {
    scope: scope({ sourceAccountId: 'wa-account-1', conversationId: 'conv-wa-1' }),
    messages: [translatedMessage({ externalMessageId: 'same-mid', accountId: 'wa-account-1', sessionKey: 'conv-wa-1' })]
  });
  const second = authority.resolveProjectionRow(row, {
    scope: scope({ sourceAccountId: 'wa-account-2', conversationId: 'conv-wa-2' }),
    messages: [translatedMessage({ externalMessageId: 'same-mid', accountId: 'wa-account-2', sessionKey: 'conv-wa-2' })]
  });

  assert.notEqual(first.idempotencyKey, second.idempotencyKey);
  assert.equal(first.sourceAccountId, 'wa-account-1');
  assert.equal(second.sourceAccountId, 'wa-account-2');
});

test('real SQLite projection atomically upserts one evidence row per idempotency key and preserves successful Chinese translation', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-profile-evidence-'));
  const dbPath = path.join(tempRoot, 'store', 'yance-r32.db');
  const store = new R32SqliteStore({ dbPath });
  try {
    const presentation = {
      facts: [
        { kind: 'fact', title: '职业', sourceText: 'Ich arbeite im Design.', messageId: 'wamid-1', confidence: 0.8 },
        { kind: 'fact', title: '职业', sourceText: 'Ich arbeite im Design.', messageId: 'wamid-1', confidence: 0.9 }
      ],
      relationship: { evidence: [], events: [] }
    };
    const options = { scope: scope(), messages: [translatedMessage()] };

    const first = authority.persistProjection(store, presentation, options);
    const second = authority.persistProjection(store, presentation, options);
    const rows = store.db.prepare('SELECT * FROM customer_profile_evidence').all();

    assert.equal(first.status, 'REAL_DB_REPLAY_PASS');
    assert.equal(second.status, 'REAL_DB_REPLAY_PASS');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].translated_zh, '我从事设计工作。');
    assert.equal(rows[0].translation_status, 'success');
    assert.equal(rows[0].source_account_id, 'wa-account-1');
    assert.equal(rows[0].conversation_id, 'conv-wa-1');
    assert.equal(rows[0].platform_message_id, 'wamid-1');
    assert.equal(rows[0].confidence, 0.9);
  } finally {
    store.close();
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});


test('real conversation analysis reuses message translation and remains idempotent across model-random evidence ids', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-profile-analysis-'));
  const dbPath = path.join(tempRoot, 'store', 'yance-r32.db');
  const store = new R32SqliteStore({ dbPath });
  let run = 0;
  try {
    store.upsertContact({
      id: 'contact-1', platform: 'whatsapp', accountId: 'wa-account-1',
      externalId: '491234567@s.whatsapp.net', displayName: 'Anna', canonicalContactId: 'customer-1'
    });
    store.upsertConversation({
      sessionKey: 'conv-wa-1', accountId: 'wa-account-1', contactId: 'contact-1',
      platform: 'whatsapp', title: 'Anna'
    });
    store.upsertMessage({
      id: 'message-row-1', externalMessageId: 'wamid-1', sessionKey: 'conv-wa-1',
      accountId: 'wa-account-1', direction: 'incoming', text: 'Ich arbeite im Design.',
      translatedZh: '我从事设计工作。', translationStatus: 'success', translationModel: 'translategemma:4b'
    });

    const executor = async () => {
      run += 1;
      return {
        modelId: 'qwen3.5:4b',
        model: 'qwen3.5:4b',
        structured: {
          analysis: { summary: '客户明确说明自己的职业。', confidence: 0.95 },
          profile: {
            confirmedFacts: [{
              id: `model-fact-${run}`, title: '职业', text: '从事设计工作',
              evidence: [{ id: `model-evidence-${run}`, messageId: 'wamid-1', quote: 'Ich arbeite im Design.' }]
            }]
          },
          insights: {
            summary: '客户分享了职业信息。', relationshipStage: '持续了解',
            nextAction: '后续可自然询问设计领域。',
            evidence: [{ id: `insight-evidence-${run}`, messageId: 'wamid-1', quote: 'Ich arbeite im Design.' }]
          }
        }
      };
    };

    const first = await workspaceRepository.analyzeConversation('conv-wa-1', { store, executor });
    const second = await workspaceRepository.analyzeConversation('conv-wa-1', { store, executor });
    const rows = store.db.prepare(`
      SELECT * FROM customer_profile_evidence
      WHERE platform_message_id='wamid-1'
      ORDER BY evidence_type
    `).all();

    assert.equal(first.evidenceProjection.status, 'REAL_DB_REPLAY_PASS');
    assert.equal(second.evidenceProjection.status, 'REAL_DB_REPLAY_PASS');
    assert.equal(rows.length, 2, 'fact evidence and relationship evidence remain distinct, but each is idempotent');
    assert.equal(rows.every(row => row.translated_zh === '我从事设计工作。'), true);
    assert.equal(rows.every(row => row.translation_status === 'success'), true);
    assert.equal(rows.every(row => row.source_account_id === 'wa-account-1'), true);
    assert.equal(rows.every(row => row.conversation_id === 'conv-wa-1'), true);
  } finally {
    store.close();
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});
