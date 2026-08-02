'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { R32SqliteStore } = require('../lib/r32SqliteStore');
const { CommunicationAuthority } = require('../services/communicationAuthority');
const { ContactRelationshipAuthority } = require('../services/contactRelationshipAuthority');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-fix6m-contact-relationship-'));
  const store = new R32SqliteStore({ dbPath: path.join(root, 'database', 'yance.db') });
  let id = 0; let tick = 0;
  const idFactory = prefix => `${prefix}-${++id}`;
  const clock = () => new Date(Date.UTC(2026, 7, 1, 15, 0, tick++)).toISOString();
  const authority = new ContactRelationshipAuthority({ storeProvider: () => store, idFactory, clock });
  const communication = new CommunicationAuthority({ storeProvider: () => store, idFactory, clock });
  for (const [accountId, platform] of [['tg-a', 'telegram'], ['wa-a', 'whatsapp']]) {
    const at = clock();
    store.db.prepare(`INSERT INTO r32_accounts(id,platform,adapter_account_id,display_name,identity_label,state,can_send,can_receive,payload_json,created_at,updated_at)
      VALUES(?,?,?,?,?,'connected',1,1,'{}',?,?)`).run(accountId, platform, accountId, accountId, accountId, at, at);
  }
  return { root, store, authority, communication, close() { try { store.close(); } catch (_) {} fs.rmSync(root, { recursive: true, force: true }); } };
}

test('same display name never auto-merges identities across platforms', () => {
  const f = fixture();
  try {
    const telegram = f.authority.observeIdentity({ platform: 'telegram', sourceAccountId: 'tg-a', externalId: '42', displayName: 'Anna' });
    const whatsapp = f.authority.observeIdentity({ platform: 'whatsapp', sourceAccountId: 'wa-a', externalId: '491234', displayName: 'Anna' });
    assert.notEqual(telegram.contactId, whatsapp.contactId);
    assert.equal(telegram.identity.displayName, 'Anna');
    assert.equal(whatsapp.identity.displayName, 'Anna');
    assert.throws(
      () => f.authority.linkIdentity({ identityId: whatsapp.identity.identityId, targetContactId: telegram.contactId, evidenceType: 'display-name', humanConfirmed: false }),
      error => error?.code === 'CONTACT_LINK_HUMAN_CONFIRMATION_REQUIRED'
    );
    const linked = f.authority.linkIdentity({ identityId: whatsapp.identity.identityId, targetContactId: telegram.contactId, evidenceType: 'user-confirmed-same-person', humanConfirmed: true, actor: 'owner' });
    assert.equal(linked.contactId, telegram.contactId);
    assert.equal(linked.previousContactId, whatsapp.contactId);
  } finally { f.close(); }
});

test('relationship assertions require canonical message evidence bound to the same contact', () => {
  const f = fixture();
  try {
    const contact = f.authority.observeIdentity({ platform: 'telegram', sourceAccountId: 'tg-a', externalId: '42', displayName: 'Anna' });
    const other = f.authority.observeIdentity({ platform: 'whatsapp', sourceAccountId: 'wa-a', externalId: '99', displayName: 'Ben' });
    const message = f.communication.ingestMessage({ platform: 'telegram', sourceAccountId: 'tg-a', externalConversationId: 'chat-1', externalMessageId: '100', direction: 'inbound', senderExternalId: '42', content: { kind: 'text', text: 'Danke' } });
    f.authority.bindMessage({ messageId: message.messageId, contactId: contact.contactId, identityId: contact.identity.identityId, sourceType: 'canonical-ingress' });
    assert.throws(
      () => f.authority.assertRelationship({ contactId: other.contactId, assertionType: 'relationship-stage', value: { stage: 'warming' }, confidence: 0.8, sourceMessageIds: [message.messageId] }),
      error => error?.code === 'RELATIONSHIP_EVIDENCE_CONTACT_MISMATCH'
    );
    const assertion = f.authority.assertRelationship({ contactId: contact.contactId, assertionType: 'relationship-stage', value: { stage: 'warming' }, confidence: 0.8, sourceMessageIds: [message.messageId], traceId: 'trace-rel-1' });
    assert.equal(assertion.reviewState, 'pending');
    const approved = f.authority.transitionAssertion({ assertionId: assertion.assertionId, action: 'approve', actor: 'owner' });
    assert.equal(approved.reviewState, 'approved');
    const snapshot = f.authority.buildSnapshot({ contactId: contact.contactId, traceId: 'trace-rel-1' });
    assert.equal(snapshot.version, 1);
    assert.equal(snapshot.context.relationshipAssertions.length, 1);
    assert.deepEqual(snapshot.context.relationshipAssertions[0].sourceMessageIds, [message.messageId]);
    assert.equal(JSON.stringify(snapshot).includes('Danke'), false);
  } finally { f.close(); }
});

test('relationship assertion revocation creates a new snapshot without deleting evidence history', () => {
  const f = fixture();
  try {
    const contact = f.authority.observeIdentity({ platform: 'telegram', sourceAccountId: 'tg-a', externalId: '42', displayName: 'Anna' });
    const message = f.communication.ingestMessage({ platform: 'telegram', sourceAccountId: 'tg-a', externalConversationId: 'chat-1', externalMessageId: '101', direction: 'inbound', senderExternalId: '42', content: { kind: 'text', text: 'Bis später' } });
    f.authority.bindMessage({ messageId: message.messageId, contactId: contact.contactId, identityId: contact.identity.identityId, sourceType: 'canonical-ingress' });
    const assertion = f.authority.assertRelationship({ contactId: contact.contactId, assertionType: 'tone', value: { tone: 'warm' }, confidence: 0.7, sourceMessageIds: [message.messageId] });
    f.authority.transitionAssertion({ assertionId: assertion.assertionId, action: 'approve', actor: 'owner' });
    const before = f.authority.buildSnapshot({ contactId: contact.contactId });
    f.authority.transitionAssertion({ assertionId: assertion.assertionId, action: 'revoke', actor: 'owner', reasonCode: 'USER_CORRECTION' });
    const after = f.authority.buildSnapshot({ contactId: contact.contactId });
    assert.equal(before.context.relationshipAssertions.length, 1);
    assert.equal(after.version, 2);
    assert.equal(after.context.relationshipAssertions.length, 0);
    assert.equal(f.authority.getAssertion(assertion.assertionId).events.length, 3);
  } finally { f.close(); }
});
