'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  extractDeterministicFacts,
  mergeConfirmedFacts,
  mergeInterestRows,
  isPeerInbound
} = require('../services/contactFactExtractionService');

function inbound(id, text, translatedZh = '') {
  return {
    id,
    platformMessageId: id,
    role: 'contact',
    direction: 'inbound',
    platform: 'facebook',
    sourceAccountId: 'fb-page-yeonhee',
    conversationId: 'facebook:fb-page-yeonhee:kurt',
    text,
    sourceText: text,
    translatedZh,
    sentAt: '2026-07-25T00:00:00.000Z'
  };
}

function outbound(id, text) {
  return {
    id,
    platformMessageId: id,
    role: 'user',
    direction: 'outbound',
    fromMe: true,
    platform: 'facebook',
    sourceAccountId: 'fb-page-yeonhee',
    conversationId: 'facebook:fb-page-yeonhee:kurt',
    text,
    sourceText: text,
    sentAt: '2026-07-25T00:01:00.000Z'
  };
}

const context = {
  platform: 'facebook',
  sourceAccountId: 'fb-page-yeonhee',
  conversationId: 'facebook:fb-page-yeonhee:kurt',
  canonicalContactId: 'contact-kurt'
};

test('Kurt inbound facts are extracted with peer evidence', () => {
  const intro = extractDeterministicFacts(inbound(
    'msg-kurt-1',
    'Bin 65 und ein lustiger mann habe hobbys radfahren schwimmen, lesen musik usw und du',
    '我65岁，是个风趣的男人，爱好骑行、游泳、阅读和音乐。你呢？'
  ), context);
  assert.equal(intro.profileFacts.age, '65');
  assert.deepEqual(intro.facts.find(row => row.key === 'interests').values, ['骑行', '游泳', '阅读', '音乐']);
  assert.deepEqual(intro.recurringInterests.map(row => row.value), ['骑行', '游泳', '阅读', '音乐']);
  assert.equal(intro.facts.every(row => row.direction === 'inbound' && row.speaker === 'peer'), true);
  assert.equal(intro.facts.every(row => row.sourceMessageId === 'msg-kurt-1'), true);
  assert.equal(intro.facts.some(row => row.key === 'job'), false);

  const country = extractDeterministicFacts(inbound('msg-kurt-2', 'Aus Österreich', '奥地利'), context);
  assert.equal(country.profileFacts.country, '奥地利');

  const region = extractDeterministicFacts(inbound('msg-kurt-3', 'In der Nähe von Wien', '在维也纳附近'), context);
  assert.equal(region.profileFacts.region, '维也纳附近');
  assert.equal(region.profileFacts.address, '维也纳附近');
});

test('self outbound profile statements never enter the contact profile', () => {
  const result = extractDeterministicFacts(outbound(
    'msg-self-1',
    'Ich bin 41. Ich lebe in Berlin und arbeite als Modedesignerin. Ich wandere gern, lese viel und höre gern Musik.'
  ), context);
  assert.equal(isPeerInbound(outbound('msg-self-2', 'Ich bin 41.')), false);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'NOT_PEER_INBOUND');
  assert.deepEqual(result.facts, []);
  assert.deepEqual(result.profileFacts, {});
});

test('confirmed facts and interests merge without duplicate evidence', () => {
  const first = extractDeterministicFacts(inbound('msg-kurt-4', 'Ich bin 65 und fahre gern Rad.', '我65岁，喜欢骑行。'), context);
  const repeated = extractDeterministicFacts(inbound('msg-kurt-5', 'Bin 65. Radfahren ist mein Hobby.', '65岁，骑行是我的爱好。'), context);
  const mergedFacts = mergeConfirmedFacts(first.facts, repeated.facts);
  const ages = mergedFacts.filter(row => row.key === 'age' && row.status === 'confirmed');
  assert.equal(ages.length, 1);
  assert.equal(ages[0].value, '65');
  assert.equal(ages[0].evidence.length, 2);
  const interests = mergeInterestRows(first.recurringInterests, repeated.recurringInterests);
  assert.deepEqual(interests.map(row => row.value), ['骑行']);
});

test('source contains persistence and truthful analysis-state gates', () => {
  const root = path.resolve(__dirname, '../..');
  const adapter = fs.readFileSync(path.join(root, 'backend/store/adapters/SqliteStorePersistenceAdapter.js'), 'utf8');
  const repository = fs.readFileSync(path.join(root, 'backend/repositories/workspaceRepository.js'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'frontend/js/r32-ui-runtime.js'), 'utf8');
  assert.match(adapter, /upsertDeterministicCustomerFacts/);
  assert.match(adapter, /customer_profile_evidence/);
  assert.match(repository, /terminalStatus = stale \? 'superseded' : 'failed'/);
  assert.match(repository, /status='completed'/);
  assert.match(repository, /validateModelProfileAgainstMessages/);
  assert.match(repository, /persistDeterministicFactsFromMessages/);
  assert.match(ui, /run\?\.status==='failed'/);
  assert.match(ui, /run\?\.status==='completed'&&run\.current===true/);
});

test('SQLite persistence writes confirmed profile facts and evidence without clearing pending review', async () => {
  const os = require('node:os');
  const { R32SqliteStore } = require('../lib/r32SqliteStore');
  const { SqliteStorePersistenceAdapter } = require('../store/adapters/SqliteStorePersistenceAdapter');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-contact-facts-'));
  const store = new R32SqliteStore({ dbPath: path.join(root, 'facts.db') });
  try {
    store.db.prepare(`
      INSERT INTO contacts(id, platform, account_id, external_id, display_name, canonical_contact_id, created_at, updated_at)
      VALUES (?, 'facebook', 'fb-page-yeonhee', 'kurt-psid', 'Kurt Kerschner', ?, ?, ?)
    `).run('contact-kurt', 'contact-kurt', '2026-07-25T00:00:00.000Z', '2026-07-25T00:00:00.000Z');
    store.db.prepare(`
      INSERT INTO customer_profiles(contact_id, review_status, payload_json, created_at, updated_at)
      VALUES (?, 'ai-pending-review', ?, ?, ?)
    `).run('contact-kurt', JSON.stringify({ pendingReview: { profile: { facts: { city: '错误候选' } } } }), '2026-07-25T00:00:00.000Z', '2026-07-25T00:00:00.000Z');

    const inputs = [
      inbound('msg-db-1', 'Bin 65 und ein lustiger mann habe hobbys radfahren schwimmen, lesen musik usw und du'),
      inbound('msg-db-2', 'Aus Österreich'),
      inbound('msg-db-3', 'In der Nähe von Wien'),
      outbound('msg-db-self', 'Ich bin 41. Ich lebe in Berlin und arbeite als Modedesignerin.')
    ];
    let facts = [];
    let profileFacts = {};
    let interests = [];
    for (const message of inputs) {
      const result = extractDeterministicFacts(message, context);
      facts = mergeConfirmedFacts(facts, result.facts);
      profileFacts = { ...profileFacts, ...result.profileFacts };
      interests = mergeInterestRows(interests, result.recurringInterests);
    }
    const adapter = new SqliteStorePersistenceAdapter({ store });
    await adapter.transaction(transaction => transaction.upsertDeterministicCustomerFacts({
      contactId: 'contact-kurt',
      canonicalContactId: 'contact-kurt',
      platform: 'facebook',
      sourceAccountId: 'fb-page-yeonhee',
      conversationId: 'facebook:fb-page-yeonhee:kurt',
      sourceMessageId: 'msg-db-3',
      sourceMessageAt: '2026-07-25T00:00:00.000Z',
      profileFacts,
      confirmedFacts: facts,
      recurringInterests: interests,
      evidence: facts,
      extractionVersion: 'contact-fact-extraction-v2'
    }));

    const profile = store.db.prepare('SELECT * FROM customer_profiles WHERE contact_id=?').get('contact-kurt');
    const savedFacts = JSON.parse(profile.facts_json);
    const confirmed = JSON.parse(profile.confirmed_facts_json);
    const payload = JSON.parse(profile.payload_json);
    assert.equal(savedFacts.age, '65');
    assert.equal(savedFacts.country, '奥地利');
    assert.equal(savedFacts.region, '维也纳附近');
    assert.equal(savedFacts.address, '奥地利 · 维也纳附近');
    assert.equal(savedFacts.job, undefined);
    assert.equal(String(profile.review_status), 'ai-pending-review');
    assert.equal(payload.pendingReview.profile.facts.city, '错误候选');
    assert.deepEqual(payload.recurringInterests.map(row => row.value), ['骑行', '游泳', '阅读', '音乐']);
    assert.equal(confirmed.some(row => row.key === 'age' && row.value === '65'), true);
    assert.equal(confirmed.some(row => String(row.value).includes('41')), false);
    const evidence = store.db.prepare('SELECT * FROM customer_profile_evidence ORDER BY evidence_type').all();
    assert.equal(evidence.length >= 4, true);
    assert.equal(evidence.every(row => row.conversation_id === 'facebook:fb-page-yeonhee:kurt'), true);
    assert.equal(evidence.every(row => JSON.parse(row.payload_json).speaker === 'peer'), true);
  } finally {
    try { store.close(); } catch (_) {}
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('full conversation analysis keeps peer facts, rejects self/internal facts, and reports truthful run status', async () => {
  const os = require('node:os');
  const { R32SqliteStore } = require('../lib/r32SqliteStore');
  const socialChineseUnderstandingService = require('../services/socialChineseUnderstandingService');
  const workspaceRepository = require('../repositories/workspaceRepository');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-analysis-truth-'));
  const store = new R32SqliteStore({ dbPath: path.join(root, 'analysis.db') });
  const originalTranslateBundle = socialChineseUnderstandingService.translateBundle;
  socialChineseUnderstandingService.translateBundle = async payload => ({
    translated: { analysis: payload.analysis, profile: payload.profile, insights: payload.insights },
    translationStatus: 'success',
    translationModel: 'test-translator',
    translatedAt: '2026-07-25T00:10:00.000Z'
  });
  try {
    const now = '2026-07-25T00:00:00.000Z';
    store.db.prepare(`
      INSERT INTO contacts(id, platform, account_id, external_id, display_name, canonical_contact_id, created_at, updated_at)
      VALUES ('contact-kurt', 'facebook', 'fb-page-yeonhee', 'kurt-psid', 'Kurt Kerschner', 'contact-kurt', ?, ?)
    `).run(now, now);
    store.db.prepare(`
      INSERT INTO r32_conversations(session_key, account_id, contact_id, platform, title, payload_json, created_at, updated_at)
      VALUES ('facebook:fb-page-yeonhee:kurt', 'fb-page-yeonhee', 'contact-kurt', 'facebook', 'Kurt Kerschner', '{}', ?, ?)
    `).run(now, now);
    const insertMessage = store.db.prepare(`
      INSERT INTO r32_messages(
        id, session_key, account_id, sender_id, role, direction, message_type, text,
        payload_json, sent_at, created_at, updated_at
      ) VALUES (?, 'facebook:fb-page-yeonhee:kurt', 'fb-page-yeonhee', ?, ?, ?, 'text', ?, ?, ?, ?, ?)
    `);
    const rows = [
      ['msg-kurt-a', 'kurt-psid', 'contact', 'inbound', 'Bin 65 und ein lustiger mann habe hobbys radfahren schwimmen, lesen musik usw und du', { externalMessageId: 'msg-kurt-a' }, '2026-07-25T00:01:00.000Z'],
      ['msg-self-a', 'fb-page-yeonhee', 'user', 'outbound', 'Ich bin 41. Ich lebe in Berlin und arbeite als Modedesignerin.', { externalMessageId: 'msg-self-a', fromMe: true }, '2026-07-25T00:02:00.000Z'],
      ['msg-kurt-b', 'kurt-psid', 'contact', 'inbound', 'Aus Österreich', { externalMessageId: 'msg-kurt-b' }, '2026-07-25T00:03:00.000Z'],
      ['msg-kurt-c', 'kurt-psid', 'contact', 'inbound', 'In der Nähe von Wien', { externalMessageId: 'msg-kurt-c' }, '2026-07-25T00:04:00.000Z']
    ];
    for (const [id, sender, role, direction, textValue, payload, sentAt] of rows) {
      insertMessage.run(id, sender, role, direction, textValue, JSON.stringify(payload), sentAt, sentAt, sentAt);
    }

    const result = await workspaceRepository.analyzeConversation('facebook:fb-page-yeonhee:kurt', {
      store,
      executor: async () => ({
        modelId: 'test-understanding-model',
        model: 'Test Understanding Model',
        structured: {
          analysis: { summary: '对方明确介绍了年龄、所在地和兴趣。', evidence: [{ messageId: 'msg-kurt-a', quote: rows[0][4], translatedZh: '对方65岁并有多项兴趣。' }] },
          profile: {
            facts: { age: '65', city: 'Berlin', stableIdentity: '28359384636982883' },
            confirmedFacts: [
              { key: 'age', value: '65', messageId: 'msg-kurt-a', text: '年龄：65' },
              { key: 'city', value: 'Berlin', messageId: 'msg-self-a', text: '城市：Berlin' },
              { key: 'stableIdentity', value: '28359384636982883', messageId: 'msg-kurt-a', text: '稳定身份：28359384636982883' }
            ],
            inferredFacts: []
          },
          insights: { summary: '当前处于初步了解阶段。', relationshipStage: '初识', evidence: [{ messageId: 'msg-kurt-a', quote: rows[0][4] }] }
        }
      })
    });
    assert.equal(result.ok, true);
    assert.equal(result.deterministicFacts.facts.length >= 4, true);
    const profile = workspaceRepository.getProfile('contact-kurt', store);
    assert.equal(profile.facts.age, '65');
    assert.equal(profile.facts.country, '奥地利');
    assert.equal(profile.facts.region, '维也纳附近');
    assert.equal(profile.facts.address, '奥地利 · 维也纳附近');
    assert.equal(profile.facts.city, undefined);
    assert.equal(profile.facts.stableIdentity, undefined);
    assert.equal(profile.reviewStatus, 'ai-pending-review');
    assert.equal(profile.pendingReview.profile.confirmedFacts.some(row => row.key === 'city'), false);
    assert.equal(profile.pendingReview.profile.confirmedFacts.some(row => row.key === 'stableidentity' || row.key === 'stableIdentity'), false);
    assert.equal(profile.pendingReview.profile.confirmedFacts.some(row => row.key === 'age' && row.value === '65'), true);
    const context = workspaceRepository.getContextByConversation('facebook:fb-page-yeonhee:kurt', store);
    assert.equal(context.latestRun.status, 'completed');
    assert.equal(context.latestRun.current, true);
    assert.equal(context.analysis.summary, '对方明确介绍了年龄、所在地和兴趣。');

    const failedAt = '2026-07-25T00:05:00.000Z';
    insertMessage.run('msg-kurt-d', 'kurt-psid', 'contact', 'inbound', 'Ich lese jeden Abend.', JSON.stringify({ externalMessageId: 'msg-kurt-d' }), failedAt, failedAt, failedAt);
    await assert.rejects(
      workspaceRepository.analyzeConversation('facebook:fb-page-yeonhee:kurt', {
        store,
        executor: async () => { throw Object.assign(new Error('director route unavailable'), { code: 'NO_QUALIFIED_MODEL' }); }
      }),
      error => error.code === 'NO_QUALIFIED_MODEL'
    );
    const failedContext = workspaceRepository.getContextByConversation('facebook:fb-page-yeonhee:kurt', store);
    assert.equal(failedContext.latestRun.status, 'failed');
    assert.match(failedContext.latestRun.errorText, /NO_QUALIFIED_MODEL/);
    assert.deepEqual(failedContext.analysis, {});
  } finally {
    socialChineseUnderstandingService.translateBundle = originalTranslateBundle;
    try { store.close(); } catch (_) {}
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});
