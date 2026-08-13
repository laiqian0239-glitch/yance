'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { R32SqliteStore } = require('../lib/r32SqliteStore');
const workspaceRepository = require('../repositories/workspaceRepository');
const { SqliteStorePersistenceAdapter } = require('../store/adapters/SqliteStorePersistenceAdapter');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-canonical-ui-'));
  const store = new R32SqliteStore({ dbPath: path.join(root, 'store.db') });
  return {
    root,
    store,
    cleanup() {
      try { store.close(); } catch (_) {}
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  };
}

function seedMergedContact(value) {
  const { store } = value;
  const now = new Date().toISOString();
  const accountId = 'wa-current';
  const canonicalId = 'contact-canonical';
  const oldId = 'contact-old-tombstone';
  const jid = '4915778008463@s.whatsapp.net';
  store.upsertContact({
    id: canonicalId, contactId: canonicalId, platform: 'whatsapp', accountId,
    externalId: jid, displayName: 'Yeeon', phone: '4915778008463', aliases: [jid],
    source: 'test-canonical'
  });
  store.upsertContact({
    id: oldId, contactId: oldId, platform: 'whatsapp', accountId: 'wa-orphan',
    externalId: '58141257502913@lid', displayName: '+4915778008463', aliases: ['58141257502913@lid', jid],
    source: 'test-old'
  });
  store.db.prepare('UPDATE contacts SET merged_into_id=?, tombstoned_at=?, canonical_contact_id=? WHERE id=?')
    .run(canonicalId, now, canonicalId, oldId);
  const canonicalSessionKey = `${accountId}:${jid}`;
  const oldSessionKey = 'wa-orphan:58141257502913@lid';
  store.upsertConversation({
    sessionKey: canonicalSessionKey, accountId, contactId: canonicalId, platform: 'whatsapp',
    chatJid: jid, externalId: jid, title: 'Yeeon', source: 'test-canonical'
  });
  store.upsertConversation({
    sessionKey: oldSessionKey, accountId: 'wa-orphan', contactId: oldId, platform: 'whatsapp',
    chatJid: '58141257502913@lid', externalId: '58141257502913@lid', title: '+4915778008463', source: 'test-old'
  });
  store.db.prepare('UPDATE r32_conversations SET merged_into=?, merged_at=?, merge_reason=? WHERE session_key=?')
    .run(canonicalSessionKey, now, 'test-contact-canonicalization', oldSessionKey);
  store.db.prepare(`INSERT INTO identity_merge_audit(
    id,platform,entity_type,source_id,target_id,confidence,reason,report_json,created_at
  ) VALUES(?,?,?,?,?,?,?,?,?)`).run(
    'audit-old-conversation', 'whatsapp', 'conversation', oldSessionKey, canonicalSessionKey,
    1, 'test-contact-canonicalization', '{}', now
  );
  store.db.prepare(`INSERT INTO customer_profiles(
    contact_id,facts_json,tags_json,traits_json,confirmed_facts_json,inferred_facts_json,
    notes,lifecycle_stage,intimacy_score,openness_score,activity_score,risk_score,next_action,
    source_message_count,analyzed_through_message_id,analyzed_through_at,model_id,model_name,
    review_status,profile_version,payload_json,created_at,updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    canonicalId, '{}', '[]', '{}', '[]', '[]', 'canonical profile', 'active', 0, 0, 0, 0, '',
    0, '', '', '', '', 'manual', 1, '{}', now, now
  );
  store.db.prepare(`INSERT INTO relationship_insights(
    contact_id,conversation_id,summary,relationship_stage,tone,intimacy_score,initiative_score,
    openness_score,response_pressure_score,opportunity_score,risk_score,hidden_need,next_action,
    evidence_json,open_loops_json,dimensions_json,source_message_count,analyzed_through_message_id,
    analyzed_through_at,model_id,model_name,status,payload_json,created_at,updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    canonicalId, `${accountId}:${jid}`, 'canonical insight', 'warm', '', 0, 0, 0, 0, 0, 0, '', '',
    '[]', '[]', '{}', 0, '', '', '', '', 'ready', '{}', now, now
  );
  return { canonicalId, oldId, accountId, jid, canonicalSessionKey, oldSessionKey };
}

test('old merged contact references resolve to the canonical profile, insights and conversation', () => {
  const value = fixture();
  try {
    const ids = seedMergedContact(value);
    assert.equal(workspaceRepository.resolveCanonicalContactId(ids.oldId, value.store), ids.canonicalId);
    assert.equal(workspaceRepository.getContact(ids.oldId, value.store).id, ids.canonicalId);
    assert.equal(workspaceRepository.getProfile(ids.oldId, value.store).contactId, ids.canonicalId);
    assert.equal(workspaceRepository.getInsights(ids.oldId, value.store).contactId, ids.canonicalId);
    const context = workspaceRepository.getContactContext(ids.oldId, value.store);
    assert.equal(context.requestedContactId, ids.oldId);
    assert.equal(context.canonicalContactId, ids.canonicalId);
    assert.equal(context.redirected, true);
    assert.equal(context.contact.id, ids.canonicalId);
    assert.equal(context.profile.note, 'canonical profile');
    assert.equal(context.insights.summary, 'canonical insight');
    assert.equal(context.conversations.length, 1);
    assert.equal(context.conversations[0].accountId, ids.accountId);
    const resolvedOldConversation = workspaceRepository.resolveContactReference(ids.oldSessionKey, value.store);
    assert.equal(resolvedOldConversation.matchedBy, 'merged-conversation-id');
    assert.equal(resolvedOldConversation.requestedConversationId, ids.oldSessionKey);
    assert.equal(resolvedOldConversation.conversation.session_key, ids.canonicalSessionKey);
    assert.equal(resolvedOldConversation.contact.id, ids.canonicalId);
  } finally { value.cleanup(); }
});

test('StoreManager hydration excludes merged/tombstoned contacts from active customer state', async () => {
  const value = fixture();
  try {
    const ids = seedMergedContact(value);
    const snapshot = await new SqliteStorePersistenceAdapter({ store: value.store }).loadSnapshot();
    assert.ok(snapshot.customers.byId[ids.canonicalId]);
    assert.equal(snapshot.customers.byId[ids.oldId], undefined);
    assert.deepEqual(snapshot.customers.activeIds, [ids.canonicalId]);
    assert.deepEqual(snapshot.conversations.byContactId[ids.canonicalId], [`${ids.accountId}:${ids.jid}`]);
  } finally { value.cleanup(); }
});
