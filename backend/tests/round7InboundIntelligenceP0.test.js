'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function insertKurtFixture(store) {
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
  for (const [id, sender, role, direction, text, payload, sentAt] of rows) {
    insertMessage.run(id, sender, role, direction, text, JSON.stringify(payload), sentAt, sentAt, sentAt);
  }
}

test('explicit inbound facts persist and publish a profile refresh without requiring a model', async () => {
  const { R32SqliteStore } = require('../lib/r32SqliteStore');
  const eventBus = require('../services/eventBus');
  const workspaceRepository = require('../repositories/workspaceRepository');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-round7-inbound-'));
  const store = new R32SqliteStore({ dbPath: path.join(root, 'facts.db') });
  const events = [];
  const listener = event => events.push(event);
  eventBus.on('workspace.profile.updated', listener);
  try {
    insertKurtFixture(store);
    const result = await workspaceRepository.persistDeterministicFactsForConversation('facebook:fb-page-yeonhee:kurt', {
      store,
      maxMessages: 20,
      source: 'round7-test'
    });
    assert.equal(result.persisted, true);
    assert.deepEqual(new Set(result.facts.map(row => row.key)), new Set(['age', 'country', 'region', 'interests', 'self_description']));

    const profile = store.db.prepare('SELECT * FROM customer_profiles WHERE contact_id=?').get('contact-kurt');
    const facts = JSON.parse(profile.facts_json);
    const confirmed = JSON.parse(profile.confirmed_facts_json);
    assert.equal(facts.age, '65');
    assert.equal(facts.country, '奥地利');
    assert.equal(facts.region, '维也纳附近');
    assert.equal(facts.address, '奥地利 · 维也纳附近');
    assert.equal(facts.interests, '骑行、游泳、阅读、音乐');
    assert.equal(facts.job, undefined);
    assert.equal(confirmed.some(row => String(row.value).includes('41') || String(row.value).includes('Berlin') || String(row.value).includes('Modedesignerin')), false);
    assert.equal(confirmed.every(row => row.speaker === 'peer' && row.direction === 'inbound'), true);

    const evidence = store.db.prepare('SELECT * FROM customer_profile_evidence ORDER BY evidence_type').all();
    assert.equal(evidence.length >= 5, true);
    assert.equal(evidence.every(row => row.conversation_id === 'facebook:fb-page-yeonhee:kurt'), true);
    assert.equal(events.length, 1);
    assert.equal(events[0].payload?.contactId, 'contact-kurt');
    assert.equal(events[0].payload?.factCount >= 5, true);
  } finally {
    eventBus.off('workspace.profile.updated', listener);
    try { store.close(); } catch (_) {}
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('automatic inbound processing extracts explicit facts before checking model availability', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-round7-orchestrator-'));
  const priorDataDir = process.env.YANCE_DATA_DIR;
  process.env.YANCE_DATA_DIR = root;
  const modulePath = require.resolve('../services/aiBrainOrchestrator');
  delete require.cache[modulePath];
  const orchestrator = require('../services/aiBrainOrchestrator');
  const workspaceData = require('../services/workspaceDataService');
  const modelRegistry = require('../services/modelRegistry');
  const messageStore = require('../services/messageStore');
  const originals = {
    persist: workspaceData.persistDeterministicFactsForConversation,
    analyze: workspaceData.analyzeConversation,
    registryRead: modelRegistry.read,
    listMessages: messageStore.listMessages,
    getConversation: messageStore.getConversation
  };
  let persisted = 0;
  let analyzed = 0;
  try {
    workspaceData.persistDeterministicFactsForConversation = async () => {
      persisted += 1;
      return { persisted: true, facts: [{ key: 'age', value: '65' }], profileFacts: { age: '65' } };
    };
    workspaceData.analyzeConversation = async () => { analyzed += 1; return {}; };
    modelRegistry.read = () => ({ models: [], routes: {} });
    messageStore.listMessages = () => [{
      id: 'msg-kurt-a', conversationId: 'facebook:fb-page-yeonhee:kurt', sessionKey: 'facebook:fb-page-yeonhee:kurt',
      platform: 'facebook', direction: 'inbound', role: 'contact', speaker: 'peer', type: 'text',
      text: 'Bin 65', sourceText: 'Bin 65', translationStatus: 'success', sentAt: '2026-07-25T00:01:00.000Z'
    }];
    messageStore.getConversation = () => ({ id: 'facebook:fb-page-yeonhee:kurt', platform: 'facebook', title: 'Kurt Kerschner' });
    await orchestrator.updateConfig({ enabled: true, analyzeInbound: true, extractFactCandidates: true });
    const result = await orchestrator.processConversation('facebook:fb-page-yeonhee:kurt');
    assert.equal(persisted, 1);
    assert.equal(analyzed, 0);
    assert.equal(result.processed, false);
    assert.equal(result.reason, 'no-qualified-model');
    assert.equal(orchestrator.status().lastFactCount, 1);
  } finally {
    orchestrator.stop();
    workspaceData.persistDeterministicFactsForConversation = originals.persist;
    workspaceData.analyzeConversation = originals.analyze;
    modelRegistry.read = originals.registryRead;
    messageStore.listMessages = originals.listMessages;
    messageStore.getConversation = originals.getConversation;
    if (priorDataDir === undefined) delete process.env.YANCE_DATA_DIR;
    else process.env.YANCE_DATA_DIR = priorDataDir;
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('production UI refreshes profile projection when explicit facts arrive', () => {
  const root = path.resolve(__dirname, '../..');
  const ui = fs.readFileSync(path.join(root, 'frontend/js/r32-ui-runtime.js'), 'utf8');
  const orchestrator = fs.readFileSync(path.join(root, 'backend/services/aiBrainOrchestrator.js'), 'utf8');
  assert.match(ui, /customer\.facts\.updated/);
  assert.match(ui, /scheduleStoreSocialContextRefresh\(activeId,event\?\.eventType==='customer\.facts\.updated'\?120:500\)/);
  assert.match(orchestrator, /persistDeterministicFactsForConversation\(conversationId/);
  const factIndex = orchestrator.indexOf('persistDeterministicFactsForConversation(conversationId');
  const modelIndex = orchestrator.indexOf("eligibleModel('understanding', config)");
  assert.equal(factIndex >= 0 && modelIndex >= 0 && factIndex < modelIndex, true);
});

test('social ingestion updates relationship and memory, and reply brain receives the confirmed facts', async () => {
  const { StoreManager, createInitialState } = require('../store/StoreManager');
  const { registerSocialIntelligenceCommands } = require('../store/commands/registerSocialIntelligenceCommands');
  const { selectCustomerSocialContext } = require('../store/selectors/customerSocialSelectors');
  const { buildSocialDecisionPacket } = require('../services/contextAwareReplyBrain');
  const seed = createInitialState({
    auth: { ready: true, accountsById: { 'fb-page-yeonhee': { id: 'fb-page-yeonhee', canSend: true } } },
    customers: {
      ready: true,
      byId: {
        'contact-kurt': {
          id: 'contact-kurt', contactId: 'contact-kurt', canonicalContactId: 'contact-kurt',
          displayName: 'Kurt Kerschner', accountId: 'fb-page-yeonhee', platform: 'facebook', version: 1
        }
      }
    },
    conversations: {
      ready: true,
      byId: {
        'facebook:fb-page-yeonhee:kurt': {
          id: 'facebook:fb-page-yeonhee:kurt', contactId: 'contact-kurt', accountId: 'fb-page-yeonhee', platform: 'facebook', version: 1
        }
      },
      byContactId: { 'contact-kurt': ['facebook:fb-page-yeonhee:kurt'] },
      recentMessagesById: { 'facebook:fb-page-yeonhee:kurt': [] }
    },
    relationships: { ready: true, byContactId: {} },
    memories: { ready: true, byContactId: {} },
    interactionPolicies: { ready: true, byContactId: {} },
    routing: { ready: true, byTask: {} }
  });
  const persistence = {
    async loadSnapshot() { return seed; },
    async transaction(run) {
      return run({
        upsertSocialSignals() {}, upsertTimelineEvents() {}, upsertCustomerSocialState() {},
        upsertInteractionPreferences() {}, upsertInteractionPolicy() {}, upsertDeterministicCustomerFacts() {},
        appendStoreEvents() {}, persistStoreMeta() {}
      });
    }
  };
  const manager = new StoreManager({ persistence });
  registerSocialIntelligenceCommands(manager);
  await manager.hydrate();
  const messages = [
    { id: 'msg-kurt-a', platformMessageId: 'msg-kurt-a', conversationId: 'facebook:fb-page-yeonhee:kurt', sessionKey: 'facebook:fb-page-yeonhee:kurt', platform: 'facebook', sourceAccountId: 'fb-page-yeonhee', direction: 'inbound', role: 'contact', speaker: 'peer', type: 'text', text: 'Bin 65 und ein lustiger mann habe hobbys radfahren schwimmen, lesen musik usw und du', sentAt: '2026-07-25T00:01:00.000Z' },
    { id: 'msg-self-a', platformMessageId: 'msg-self-a', conversationId: 'facebook:fb-page-yeonhee:kurt', sessionKey: 'facebook:fb-page-yeonhee:kurt', platform: 'facebook', sourceAccountId: 'fb-page-yeonhee', direction: 'outbound', role: 'user', speaker: 'self', fromMe: true, type: 'text', text: 'Ich bin 41. Ich lebe in Berlin und arbeite als Modedesignerin.', sentAt: '2026-07-25T00:02:00.000Z' },
    { id: 'msg-kurt-b', platformMessageId: 'msg-kurt-b', conversationId: 'facebook:fb-page-yeonhee:kurt', sessionKey: 'facebook:fb-page-yeonhee:kurt', platform: 'facebook', sourceAccountId: 'fb-page-yeonhee', direction: 'inbound', role: 'contact', speaker: 'peer', type: 'text', text: 'Aus Österreich', sentAt: '2026-07-25T00:03:00.000Z' },
    { id: 'msg-kurt-c', platformMessageId: 'msg-kurt-c', conversationId: 'facebook:fb-page-yeonhee:kurt', sessionKey: 'facebook:fb-page-yeonhee:kurt', platform: 'facebook', sourceAccountId: 'fb-page-yeonhee', direction: 'inbound', role: 'contact', speaker: 'peer', type: 'text', text: 'In der Nähe von Wien', sentAt: '2026-07-25T00:04:00.000Z' }
  ];
  for (const message of messages) {
    await manager.dispatch({
      type: 'INGEST_SOCIAL_MESSAGE',
      source: 'round7-test',
      payload: { contactId: 'contact-kurt', conversationId: 'facebook:fb-page-yeonhee:kurt', message }
    });
  }
  const state = manager.snapshot();
  const customer = state.customers.byId['contact-kurt'];
  const memory = state.memories.byContactId['contact-kurt'];
  const relationship = state.relationships.byContactId['contact-kurt'];
  assert.equal(customer.age, '65');
  assert.equal(customer.country, '奥地利');
  assert.equal(customer.region, '维也纳附近');
  assert.equal(customer.interests, '骑行、游泳、阅读、音乐');
  assert.equal(customer.job, undefined);
  assert.equal(memory.confirmedFacts.some(row => String(row.value).includes('41') || String(row.value).includes('Berlin')), false);
  assert.equal(memory.confirmedFacts.every(row => row.speaker === 'peer' && row.direction === 'inbound'), true);
  assert.equal(Number(relationship.version || 0) >= 4, true);

  const context = manager.select(selectCustomerSocialContext('contact-kurt'));
  const packet = buildSocialDecisionPacket(context, messages.at(-1), {});
  assert.equal(packet.relevantMemories.confirmedFacts.some(row => row.key === 'age' && row.value === '65'), true);
  assert.deepEqual(packet.relevantMemories.recurringInterests.map(row => row.value), ['骑行', '游泳', '阅读', '音乐']);
});

test('legacy social event bridge listens to authoritative store events instead of recursively republishing itself', () => {
  const root = path.resolve(__dirname, '../..');
  const source = fs.readFileSync(path.join(root, 'backend/store/commands/registerSocialIntelligenceCommands.js'), 'utf8');
  assert.match(source, /bind\(`store:\$\{type\}`/);
  assert.doesNotMatch(source, /bind\('socialSignals\.detected',\s*event\s*=>\s*eventBus\.publish\('socialSignals\.detected'/);
  assert.match(source, /'customer\.facts\.updated'/);
});
