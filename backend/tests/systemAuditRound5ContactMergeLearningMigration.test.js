'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { R32SqliteStore } = require('../lib/r32SqliteStore');
const { ContactMergeRepository } = require('../store/contactMergeRepository');
const { createContactMergeService } = require('../services/contactMergeService');
const learningScopes = require('../services/replyLearningScopeAuthority');

function containsIdentity(profileJson, contactId) {
  const profile = JSON.parse(profileJson || '{}');
  return (profile.evidence || []).some(row => row.contactId === contactId || row.canonicalContactId === contactId);
}

test('Round 5 general contact merge migrates all reply-learning identities and undo restores them exactly', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-round5-contact-merge-'));
  const store = new R32SqliteStore({ dbPath: path.join(root, 'r32.db') });
  try {
    learningScopes.ensureSchema(store);
    const survivor = store.upsertContact({
      id: 'contact-survivor-r5', platform: 'whatsapp', accountId: 'wa-r5',
      externalId: '491111@s.whatsapp.net', displayName: 'Survivor'
    });
    const merged = store.upsertContact({
      id: 'contact-merged-r5', platform: 'whatsapp', accountId: 'wa-r5',
      externalId: '491111@lid', displayName: 'Merged Alias'
    });
    const now = '2026-07-25T01:00:00.000Z';

    store.db.prepare(`INSERT INTO ai_reply_feedback_events(
      id,event_type,candidate_id,outbox_id,contact_id,conversation_id,persona_profile_id,
      original_text,final_text,rejection_reason,signals_json,platform,source_account_id,
      platform_contact_identity,canonical_contact_id,learning_mode,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'sent:r5','sent','candidate-r5','outbox-r5',merged,'conversation-r5','owner',
      'Long answer','Short answer','',JSON.stringify([{ key:'replyLength', value:'short' }]),
      'whatsapp','wa-r5','491111@lid',merged,'send_and_learn',now
    );

    const survivorProfile = {
      version: 1, counts: {}, effective: {},
      evidence: [{ id:'survivor-evidence', contactId:survivor, canonicalContactId:survivor, signals:[] }]
    };
    const mergedProfile = {
      version: 2, counts: {}, effective: {},
      evidence: [{ id:'merged-evidence', contactId:merged, canonicalContactId:merged, signals:[] }]
    };
    store.db.prepare("INSERT INTO ai_reply_feedback_profiles(scope_type,scope_id,profile_json,version,updated_at) VALUES('contact',?,?,?,?)")
      .run(survivor, JSON.stringify(survivorProfile), 1, now);
    store.db.prepare("INSERT INTO ai_reply_feedback_profiles(scope_type,scope_id,profile_json,version,updated_at) VALUES('contact',?,?,?,?)")
      .run(merged, JSON.stringify(mergedProfile), 2, now);
    store.db.prepare("INSERT INTO ai_reply_feedback_profile_versions(scope_type,scope_id,version,profile_json,reason,created_at) VALUES('contact',?,?,?,?,?)")
      .run(survivor, 1, JSON.stringify(survivorProfile), 'survivor-history', now);
    for (const version of [1, 2]) {
      store.db.prepare("INSERT INTO ai_reply_feedback_profile_versions(scope_type,scope_id,version,profile_json,reason,created_at) VALUES('contact',?,?,?,?,?)")
        .run(merged, version, JSON.stringify({ ...mergedProfile, version }), `merged-history-${version}`, now);
    }

    const platformProfile = {
      version: 2, effective: {},
      evidence: [
        { id:'platform-survivor', contactId:survivor, canonicalContactId:survivor, signals:[] },
        { id:'platform-merged', contactId:merged, canonicalContactId:merged, signals:[] }
      ]
    };
    store.db.prepare("INSERT INTO ai_reply_learning_scopes(scope_type,scope_id,profile_json,version,updated_at) VALUES('platform','whatsapp:wa-r5',?,?,?)")
      .run(JSON.stringify(platformProfile), 2, now);
    store.db.prepare("INSERT INTO ai_reply_learning_scope_versions(scope_type,scope_id,version,profile_json,reason,created_at) VALUES('platform','whatsapp:wa-r5',1,?,'history',?)")
      .run(JSON.stringify(platformProfile), now);

    const repository = new ContactMergeRepository({ db: store.db, now: () => '2026-07-25T01:01:00.000Z' });
    const service = createContactMergeService({
      store: repository,
      now: () => Date.parse('2026-07-25T01:01:00.000Z'),
      uuid: () => 'journal-round5'
    });
    const result = service.mergeContacts({ survivorId: survivor, mergedId: merged, by: 'round5-test' });

    const event = store.db.prepare('SELECT contact_id,canonical_contact_id FROM ai_reply_feedback_events WHERE id=?').get('sent:r5');
    assert.equal(event.contact_id, survivor);
    assert.equal(event.canonical_contact_id, survivor);
    assert.equal(store.db.prepare("SELECT COUNT(*) AS count FROM ai_reply_feedback_profiles WHERE scope_type='contact' AND scope_id=?").get(merged).count, 0);
    assert.equal(store.db.prepare("SELECT COUNT(*) AS count FROM ai_reply_feedback_profile_versions WHERE scope_type='contact' AND scope_id=?").get(merged).count, 0);
    const survivorVersions = store.db.prepare("SELECT profile_json AS profileJson FROM ai_reply_feedback_profile_versions WHERE scope_type='contact' AND scope_id=? ORDER BY version").all(survivor);
    assert.equal(survivorVersions.length, 3);
    assert.ok(survivorVersions.every(row => !containsIdentity(row.profileJson, merged)));
    assert.ok(survivorVersions.some(row => containsIdentity(row.profileJson, survivor)));
    const scopeCurrent = store.db.prepare("SELECT profile_json AS profileJson FROM ai_reply_learning_scopes WHERE scope_type='platform' AND scope_id='whatsapp:wa-r5'").get();
    const scopeHistory = store.db.prepare("SELECT profile_json AS profileJson FROM ai_reply_learning_scope_versions WHERE scope_type='platform' AND scope_id='whatsapp:wa-r5'").all();
    assert.equal(containsIdentity(scopeCurrent.profileJson, merged), false);
    assert.ok(containsIdentity(scopeCurrent.profileJson, survivor));
    assert.ok(scopeHistory.every(row => !containsIdentity(row.profileJson, merged)));

    service.undoMerge({ journalId: result.journalId, by: 'round5-test' });
    const restoredEvent = store.db.prepare('SELECT contact_id,canonical_contact_id FROM ai_reply_feedback_events WHERE id=?').get('sent:r5');
    assert.equal(restoredEvent.contact_id, merged);
    assert.equal(restoredEvent.canonical_contact_id, merged);
    assert.equal(store.db.prepare("SELECT COUNT(*) AS count FROM ai_reply_feedback_profile_versions WHERE scope_type='contact' AND scope_id=?").get(survivor).count, 1);
    assert.equal(store.db.prepare("SELECT COUNT(*) AS count FROM ai_reply_feedback_profile_versions WHERE scope_type='contact' AND scope_id=?").get(merged).count, 2);
    const restoredMergedVersions = store.db.prepare("SELECT profile_json AS profileJson FROM ai_reply_feedback_profile_versions WHERE scope_type='contact' AND scope_id=?").all(merged);
    assert.ok(restoredMergedVersions.every(row => containsIdentity(row.profileJson, merged)));
    const restoredScope = store.db.prepare("SELECT profile_json AS profileJson FROM ai_reply_learning_scopes WHERE scope_type='platform' AND scope_id='whatsapp:wa-r5'").get();
    const restoredScopeHistory = store.db.prepare("SELECT profile_json AS profileJson FROM ai_reply_learning_scope_versions WHERE scope_type='platform' AND scope_id='whatsapp:wa-r5'").all();
    assert.ok(containsIdentity(restoredScope.profileJson, merged));
    assert.ok(restoredScopeHistory.every(row => containsIdentity(row.profileJson, merged)));
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});
