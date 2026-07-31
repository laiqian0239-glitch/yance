'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { R32SqliteStore } = require('../lib/r32SqliteStore');
const { SqliteStorePersistenceAdapter } = require('../store/adapters/SqliteStorePersistenceAdapter');
const { personaContactScope } = require('../services/contextAwareReplyBrain');
const workspace = require('../repositories/workspaceRepository');

function makeStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-customer-association-'));
  const store = new R32SqliteStore({ dbPath: path.join(root, 'association.db') });
  const contacts = [
    { id: 'wa-a-contact', platform: 'whatsapp', accountId: 'wa-a', externalId: '491111@s.whatsapp.net', displayName: 'Alex', avatarUrl: 'https://example.test/same.png' },
    { id: 'tg-a-contact', platform: 'telegram', accountId: 'tg-a', externalId: 'telegram-77', displayName: 'Alex', avatarUrl: 'https://example.test/same.png' },
    { id: 'wa-b-contact', platform: 'whatsapp', accountId: 'wa-b', externalId: '491111@s.whatsapp.net', displayName: 'Alex', avatarUrl: 'https://example.test/same.png' }
  ];
  for (const row of contacts) store.upsertContact(row);
  store.upsertConversation({ sessionKey: 'wa-a-conv', contactId: 'wa-a-contact', accountId: 'wa-a', platform: 'whatsapp', title: 'Alex WA A' });
  store.upsertConversation({ sessionKey: 'tg-a-conv', contactId: 'tg-a-contact', accountId: 'tg-a', platform: 'telegram', title: 'Alex TG A' });
  store.upsertConversation({ sessionKey: 'wa-b-conv', contactId: 'wa-b-contact', accountId: 'wa-b', platform: 'whatsapp', title: 'Alex WA B' });
  return { root, store };
}

function cleanup(value) {
  try { value.store.close(); } catch (_) {}
  fs.rmSync(value.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}

test('same name and avatar never associate customer identities automatically', () => {
  const value = makeStore();
  try {
    assert.equal(workspace.resolveCustomerProfileId('wa-a-contact', value.store), 'wa-a-contact');
    assert.equal(workspace.resolveCustomerProfileId('tg-a-contact', value.store), 'tg-a-contact');
    assert.equal(workspace.resolveCustomerProfileId('wa-b-contact', value.store), 'wa-b-contact');
    assert.deepEqual(workspace.listLinkedIdentities('wa-a-contact', value.store).map(row => row.id), ['wa-a-contact']);
  } finally { cleanup(value); }
});

test('explicit customer-profile association shares profile and Persona scope without merging routes', async () => {
  const value = makeStore();
  try {
    workspace.upsertProfile('wa-a-contact', {
      facts: { city: 'Berlin', languages: 'Deutsch' },
      confirmedFacts: [{ key: 'city', value: 'Berlin', text: '城市：Berlin' }],
      note: '跨平台客户档案'
    }, { reviewStatus: 'manual' }, value.store);

    const result = workspace.associateCustomerProfiles('wa-a-contact', 'tg-a-contact', { by: 'user', note: '用户明确确认是同一客户' }, value.store);
    assert.equal(result.changed, true);
    assert.equal(result.customerProfileId, 'tg-a-contact');
    assert.equal(result.routingPreserved, true);
    assert.deepEqual(result.linkedIdentities.map(row => row.id).sort(), ['tg-a-contact', 'wa-a-contact']);

    assert.equal(workspace.getProfile('wa-a-contact', value.store).facts.city, 'Berlin');
    assert.equal(workspace.getProfile('tg-a-contact', value.store).facts.city, 'Berlin');
    assert.deepEqual(workspace.getProfile('wa-b-contact', value.store).facts, {});

    const context = workspace.getContactContext('wa-a-contact', value.store);
    assert.equal(context.contact.id, 'wa-a-contact', '当前平台身份必须保持物理联系人');
    assert.equal(context.customerProfileId, 'tg-a-contact');
    assert.equal(context.associated, true);
    assert.deepEqual(context.linkedIdentities.map(row => row.id).sort(), ['tg-a-contact', 'wa-a-contact']);
    assert.deepEqual(context.conversations.map(row => row.sessionKey).sort(), ['tg-a-conv', 'wa-a-conv']);
    for (const row of context.conversations) {
      assert.equal(row.routeScope.canonicalContactId, 'tg-a-contact');
      assert.ok(row.routeScope.platform);
      assert.ok(row.routeScope.sourceAccountId);
      assert.ok(row.routeScope.platformContactIdentity);
      assert.ok(row.routeScope.conversationId);
    }

    const rows = value.store.db.prepare('SELECT session_key, contact_id, account_id, platform FROM r32_conversations ORDER BY session_key').all().map(row => ({ ...row }));
    assert.deepEqual(rows, [
      { session_key: 'tg-a-conv', contact_id: 'tg-a-contact', account_id: 'tg-a', platform: 'telegram' },
      { session_key: 'wa-a-conv', contact_id: 'wa-a-contact', account_id: 'wa-a', platform: 'whatsapp' },
      { session_key: 'wa-b-conv', contact_id: 'wa-b-contact', account_id: 'wa-b', platform: 'whatsapp' }
    ]);

    const snapshot = await new SqliteStorePersistenceAdapter({ store: value.store }).loadSnapshot();
    assert.equal(snapshot.customers.byId['wa-a-contact'].canonicalContactId, 'tg-a-contact');
    assert.equal(snapshot.customers.byId['tg-a-contact'].canonicalContactId, 'tg-a-contact');
    assert.equal(personaContactScope('wa-a-contact', { customer: snapshot.customers.byId['wa-a-contact'] }), 'tg-a-contact');
    assert.equal(personaContactScope('wa-b-contact', { customer: snapshot.customers.byId['wa-b-contact'] }), 'wa-b-contact');
  } finally { cleanup(value); }
});

test('relationship insight preserves full platform/account/conversation source scope', () => {
  const value = makeStore();
  try {
    workspace.associateCustomerProfiles('wa-a-contact', 'tg-a-contact', { by: 'user' }, value.store);
    const insight = workspace.upsertInsights('wa-a-contact', 'wa-a-conv', {
      summary: '客户愿意继续沟通', relationshipStage: '稳定联系', evidence: [['原句', '中文说明', '真实消息', 98]]
    }, { status: 'ready' }, value.store);
    assert.deepEqual(insight.sourceScope, {
      platform: 'whatsapp',
      sourceAccountId: 'wa-a',
      platformContactIdentity: '491111@s.whatsapp.net',
      conversationId: 'wa-a-conv',
      canonicalContactId: 'tg-a-contact'
    });
    assert.deepEqual(workspace.getInsights('tg-a-contact', value.store).evidence, [], '关系洞察仍保持平台联系人隔离');
  } finally { cleanup(value); }
});

test('ambiguous phone or JID across accounts is blocked instead of selecting first route', () => {
  const value = makeStore();
  try {
    assert.throws(
      () => workspace.resolveContactReference('491111@s.whatsapp.net', value.store),
      error => error?.code === 'CONTACT_REFERENCE_AMBIGUOUS' && error?.status === 409 && error?.details?.matches?.length === 2
    );
    const exact = workspace.resolveContactReference('wa-a-conv', value.store);
    assert.equal(exact.contact.id, 'wa-a-contact');
    assert.equal(exact.conversation.session_key, 'wa-a-conv');
  } finally { cleanup(value); }
});

test('unsafe name/avatar association evidence and conflicting profiles are rejected', () => {
  const value = makeStore();
  try {
    assert.throws(
      () => workspace.associateCustomerProfiles('wa-a-contact', 'tg-a-contact', { by: 'system', matchBy: 'avatar' }, value.store),
      error => error?.code === 'UNSAFE_CUSTOMER_ASSOCIATION_EVIDENCE'
    );
    workspace.upsertProfile('wa-a-contact', { facts: { city: 'Berlin' } }, {}, value.store);
    workspace.upsertProfile('tg-a-contact', { facts: { city: 'Paris' } }, {}, value.store);
    assert.throws(
      () => workspace.associateCustomerProfiles('wa-a-contact', 'tg-a-contact', { by: 'user' }, value.store),
      error => error?.code === 'CUSTOMER_PROFILE_ASSOCIATION_CONFLICT'
    );
  } finally { cleanup(value); }
});

test('separating an associated identity copies the shared profile but preserves routes', () => {
  const value = makeStore();
  try {
    workspace.upsertProfile('tg-a-contact', { facts: { city: 'Berlin' }, note: 'shared' }, {}, value.store);
    workspace.associateCustomerProfiles('wa-a-contact', 'tg-a-contact', { by: 'user' }, value.store);
    const separated = workspace.separateCustomerProfile('wa-a-contact', { by: 'user', copyProfile: true }, value.store);
    assert.equal(separated.changed, true);
    assert.equal(workspace.resolveCustomerProfileId('wa-a-contact', value.store), 'wa-a-contact');
    assert.equal(workspace.getProfile('wa-a-contact', value.store).facts.city, 'Berlin');
    assert.equal(workspace.getProfile('tg-a-contact', value.store).facts.city, 'Berlin');
    assert.equal(value.store.db.prepare("SELECT contact_id FROM r32_conversations WHERE session_key='wa-a-conv'").get().contact_id, 'wa-a-contact');
  } finally { cleanup(value); }
});
