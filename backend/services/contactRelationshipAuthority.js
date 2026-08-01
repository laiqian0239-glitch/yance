'use strict';

const crypto = require('node:crypto');
const { getStore } = require('../repositories/storeProvider');
const channelAdapterContract = require('./channelAdapterContract');

const AUTHORITY = 'ContactRelationshipAuthority';
const SCHEMA_VERSION = 1;
const ACTION_STATE = Object.freeze({ created: 'pending', approve: 'approved', reject: 'rejected', revoke: 'revoked' });

function clean(value) { return String(value == null ? '' : value).trim(); }
function defaultClock() { return new Date().toISOString(); }
function defaultIdFactory(prefix) { return `${prefix}-${crypto.randomUUID()}`; }
function parse(value, fallback) { try { return value ? JSON.parse(value) : fallback; } catch (_) { return fallback; } }
function clamp01(value) { const n = Number(value); return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0; }
function contactRow(row) { return row ? { authority: AUTHORITY, schemaVersion: SCHEMA_VERSION, contactId: clean(row.contact_id), displayName: clean(row.display_name), state: clean(row.state), version: Number(row.version || 0), createdAt: clean(row.created_at), updatedAt: clean(row.updated_at) } : null; }
function identityRow(row) { return row ? { identityId: clean(row.identity_id), contactId: clean(row.contact_id), platform: clean(row.platform), sourceAccountId: clean(row.source_account_id), externalId: clean(row.external_id), displayName: clean(row.display_name), avatarMediaId: clean(row.avatar_media_id), evidenceType: clean(row.evidence_type), createdAt: clean(row.created_at), updatedAt: clean(row.updated_at) } : null; }
function eventRow(row) { return row ? { eventId: clean(row.event_id), assertionId: clean(row.assertion_id), sequence: Number(row.sequence || 0), action: clean(row.action), actor: clean(row.actor), reasonCode: clean(row.reason_code), createdAt: clean(row.created_at) } : null; }
function assertionState(events = []) { return events.length ? ACTION_STATE[events.at(-1).action] || 'pending' : 'pending'; }

class ContactRelationshipAuthority {
  constructor({ storeProvider = getStore, idFactory = defaultIdFactory, clock = defaultClock } = {}) { this.storeProvider = storeProvider; this.idFactory = idFactory; this.clock = clock; }
  store() { return this.storeProvider(); }
  assertContact(contactId, store = this.store()) {
    const row = store.db.prepare('SELECT * FROM contact_aggregates WHERE contact_id=?').get(clean(contactId));
    if (!row) throw Object.assign(new Error('Contact aggregate not found'), { code: 'CONTACT_AGGREGATE_NOT_FOUND', status: 404, contactId: clean(contactId) });
    return row;
  }
  assertAccount(platform, sourceAccountId, store = this.store()) {
    const row = store.db.prepare('SELECT id,platform FROM r32_accounts WHERE id=?').get(clean(sourceAccountId));
    if (!row) throw Object.assign(new Error('Channel account not found'), { code: 'CONTACT_ACCOUNT_NOT_FOUND', status: 404 });
    if (clean(row.platform) !== clean(platform).toLowerCase()) throw Object.assign(new Error('Contact identity account scope mismatch'), { code: 'CONTACT_ACCOUNT_SCOPE_MISMATCH', status: 409 });
    return row;
  }

  observeIdentity(input = {}) {
    const platform = clean(input.platform).toLowerCase(); const sourceAccountId = clean(input.sourceAccountId); const externalId = clean(input.externalId);
    if (!platform || !sourceAccountId || !externalId) throw Object.assign(new Error('External identity scope is incomplete'), { code: 'CONTACT_IDENTITY_SCOPE_INCOMPLETE', status: 400 });
    const store = this.store(); this.assertAccount(platform, sourceAccountId, store);
    return store.transaction(() => {
      const existing = store.db.prepare('SELECT * FROM contact_external_identities WHERE platform=? AND source_account_id=? AND external_id=?').get(platform, sourceAccountId, externalId);
      const at = this.clock();
      if (existing) {
        store.db.prepare('UPDATE contact_external_identities SET display_name=?,avatar_media_id=?,updated_at=? WHERE identity_id=?')
          .run(clean(input.displayName || existing.display_name), clean(input.avatarMediaId || existing.avatar_media_id), at, existing.identity_id);
        const identity = identityRow(store.db.prepare('SELECT * FROM contact_external_identities WHERE identity_id=?').get(existing.identity_id));
        return { contactId: identity.contactId, contact: contactRow(this.assertContact(identity.contactId, store)), identity, created: false };
      }
      const contactId = clean(input.contactId) || this.idFactory('contact-aggregate');
      const identityId = clean(input.identityId) || this.idFactory('external-identity');
      if (input.contactId) this.assertContact(contactId, store);
      else store.db.prepare(`INSERT INTO contact_aggregates(contact_id,display_name,state,version,created_at,updated_at) VALUES(?,?,'active',1,?,?)`)
        .run(contactId, clean(input.displayName), at, at);
      store.db.prepare(`INSERT INTO contact_external_identities(identity_id,contact_id,platform,source_account_id,external_id,display_name,avatar_media_id,evidence_type,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?)`).run(identityId, contactId, platform, sourceAccountId, externalId, clean(input.displayName), clean(input.avatarMediaId), clean(input.evidenceType || 'platform-observed'), at, at);
      return { contactId, contact: contactRow(this.assertContact(contactId, store)), identity: identityRow(store.db.prepare('SELECT * FROM contact_external_identities WHERE identity_id=?').get(identityId)), created: true };
    });
  }

  linkIdentity(input = {}) {
    if (input.humanConfirmed !== true) throw Object.assign(new Error('Cross-platform contact linking requires human confirmation'), { code: 'CONTACT_LINK_HUMAN_CONFIRMATION_REQUIRED', status: 409 });
    const store = this.store();
    return store.transaction(() => {
      const identity = store.db.prepare('SELECT * FROM contact_external_identities WHERE identity_id=?').get(clean(input.identityId));
      if (!identity) throw Object.assign(new Error('External identity not found'), { code: 'CONTACT_IDENTITY_NOT_FOUND', status: 404 });
      const target = this.assertContact(input.targetContactId, store); const previousContactId = clean(identity.contact_id); const at = this.clock();
      if (previousContactId !== clean(target.contact_id)) {
        store.db.prepare('UPDATE contact_external_identities SET contact_id=?,evidence_type=?,updated_at=? WHERE identity_id=?')
          .run(clean(target.contact_id), clean(input.evidenceType || 'user-confirmed'), at, clean(input.identityId));
        store.db.prepare(`INSERT INTO contact_identity_link_events(event_id,identity_id,previous_contact_id,target_contact_id,evidence_type,actor,created_at) VALUES(?,?,?,?,?,?,?)`)
          .run(this.idFactory('identity-link-event'), clean(input.identityId), previousContactId, clean(target.contact_id), clean(input.evidenceType || 'user-confirmed'), clean(input.actor), at);
      }
      return { identityId: clean(input.identityId), contactId: clean(target.contact_id), previousContactId, evidenceType: clean(input.evidenceType || 'user-confirmed'), linkedAt: at };
    });
  }

  bindMessage(input = {}) {
    const store = this.store();
    return store.transaction(() => {
      const message = store.db.prepare('SELECT message_id FROM communication_canonical_messages WHERE message_id=?').get(clean(input.messageId));
      if (!message) throw Object.assign(new Error('Canonical message not found'), { code: 'CONTACT_MESSAGE_NOT_FOUND', status: 404 });
      this.assertContact(input.contactId, store);
      if (clean(input.identityId)) {
        const identity = store.db.prepare('SELECT contact_id FROM contact_external_identities WHERE identity_id=?').get(clean(input.identityId));
        if (!identity || clean(identity.contact_id) !== clean(input.contactId)) throw Object.assign(new Error('Message identity does not belong to contact'), { code: 'CONTACT_MESSAGE_IDENTITY_MISMATCH', status: 409 });
      }
      const existing = store.db.prepare('SELECT * FROM contact_message_bindings WHERE message_id=?').get(clean(input.messageId));
      if (existing) {
        if (clean(existing.contact_id) !== clean(input.contactId)) throw Object.assign(new Error('Canonical message already belongs to another contact'), { code: 'CONTACT_MESSAGE_BINDING_CONFLICT', status: 409 });
        return { messageId: clean(existing.message_id), contactId: clean(existing.contact_id), identityId: clean(existing.identity_id), sourceType: clean(existing.source_type), boundAt: clean(existing.bound_at) };
      }
      const at = this.clock();
      store.db.prepare('INSERT INTO contact_message_bindings(message_id,contact_id,identity_id,source_type,bound_at) VALUES(?,?,?,?,?)')
        .run(clean(input.messageId), clean(input.contactId), clean(input.identityId), clean(input.sourceType || 'canonical-ingress'), at);
      return { messageId: clean(input.messageId), contactId: clean(input.contactId), identityId: clean(input.identityId), sourceType: clean(input.sourceType || 'canonical-ingress'), boundAt: at };
    });
  }

  assertRelationship(input = {}) {
    channelAdapterContract.assertPlainData(input.value || {});
    const contactId = clean(input.contactId); const sourceMessageIds = [...new Set((Array.isArray(input.sourceMessageIds) ? input.sourceMessageIds : []).map(clean).filter(Boolean))];
    if (!sourceMessageIds.length) throw Object.assign(new Error('Relationship assertion requires canonical message evidence'), { code: 'RELATIONSHIP_EVIDENCE_REQUIRED', status: 409 });
    const store = this.store(); this.assertContact(contactId, store);
    const placeholders = sourceMessageIds.map(() => '?').join(',');
    const bindings = store.db.prepare(`SELECT message_id,contact_id FROM contact_message_bindings WHERE message_id IN (${placeholders})`).all(...sourceMessageIds);
    if (bindings.length !== sourceMessageIds.length) throw Object.assign(new Error('Relationship evidence is not fully bound'), { code: 'RELATIONSHIP_EVIDENCE_BINDING_MISSING', status: 409 });
    if (bindings.some(row => clean(row.contact_id) !== contactId)) throw Object.assign(new Error('Relationship evidence belongs to another contact'), { code: 'RELATIONSHIP_EVIDENCE_CONTACT_MISMATCH', status: 409 });
    const assertionId = clean(input.assertionId) || this.idFactory('relationship-assertion'); const at = this.clock();
    store.transaction(() => {
      store.db.prepare(`INSERT INTO relationship_assertions_v2(assertion_id,contact_id,trace_id,assertion_type,value_json,confidence,projection_version,source_message_ids_json,created_at)
        VALUES(?,?,?,?,?,?,?,?,?)`).run(assertionId, contactId, clean(input.traceId), clean(input.assertionType), JSON.stringify(input.value || {}), clamp01(input.confidence), clean(input.projectionVersion || 'fix6m-v1'), JSON.stringify(sourceMessageIds), at);
      store.db.prepare(`INSERT INTO relationship_assertion_events(event_id,assertion_id,sequence,action,actor,reason_code,created_at) VALUES(?,?,1,'created','','',?)`)
        .run(this.idFactory('relationship-assertion-event'), assertionId, at);
    });
    return this.getAssertion(assertionId);
  }

  getAssertion(assertionId) {
    const store = this.store(); const row = store.db.prepare('SELECT * FROM relationship_assertions_v2 WHERE assertion_id=?').get(clean(assertionId));
    if (!row) return null;
    const events = store.db.prepare('SELECT * FROM relationship_assertion_events WHERE assertion_id=? ORDER BY sequence').all(clean(assertionId)).map(eventRow);
    return { authority: AUTHORITY, schemaVersion: SCHEMA_VERSION, assertionId: clean(row.assertion_id), contactId: clean(row.contact_id), traceId: clean(row.trace_id), assertionType: clean(row.assertion_type), value: parse(row.value_json, {}), confidence: Number(row.confidence || 0), projectionVersion: clean(row.projection_version), sourceMessageIds: parse(row.source_message_ids_json, []), createdAt: clean(row.created_at), reviewState: assertionState(events), events };
  }

  transitionAssertion(input = {}) {
    const action = clean(input.action).toLowerCase();
    if (!['approve','reject','revoke'].includes(action)) throw Object.assign(new Error('Unsupported relationship assertion transition'), { code: 'RELATIONSHIP_ASSERTION_ACTION_INVALID', status: 400 });
    const current = this.getAssertion(input.assertionId);
    if (!current) throw Object.assign(new Error('Relationship assertion not found'), { code: 'RELATIONSHIP_ASSERTION_NOT_FOUND', status: 404 });
    const allowed = current.reviewState === 'pending' ? ['approve','reject'] : current.reviewState === 'approved' ? ['revoke'] : [];
    if (!allowed.includes(action)) throw Object.assign(new Error(`Invalid relationship assertion transition ${current.reviewState} -> ${action}`), { code: 'RELATIONSHIP_ASSERTION_TRANSITION_INVALID', status: 409 });
    const store = this.store(); const sequence = current.events.length + 1; const at = this.clock();
    store.db.prepare(`INSERT INTO relationship_assertion_events(event_id,assertion_id,sequence,action,actor,reason_code,created_at) VALUES(?,?,?,?,?,?,?)`)
      .run(this.idFactory('relationship-assertion-event'), current.assertionId, sequence, action, clean(input.actor), clean(input.reasonCode), at);
    return this.getAssertion(current.assertionId);
  }

  buildSnapshot(input = {}) {
    const contactId = clean(input.contactId); const store = this.store(); const contact = contactRow(this.assertContact(contactId, store));
    const identities = store.db.prepare('SELECT * FROM contact_external_identities WHERE contact_id=? ORDER BY platform,source_account_id,external_id').all(contactId).map(identityRow);
    const assertionRows = store.db.prepare('SELECT assertion_id FROM relationship_assertions_v2 WHERE contact_id=? ORDER BY created_at,assertion_id').all(contactId);
    const assertions = assertionRows.map(row => this.getAssertion(row.assertion_id)).filter(row => row.reviewState === 'approved');
    const version = Number(store.db.prepare('SELECT COALESCE(MAX(version),0)+1 AS next FROM contact_context_snapshots WHERE contact_id=?').get(contactId)?.next || 1);
    const context = {
      contact: { contactId: contact.contactId, displayName: contact.displayName, state: contact.state },
      identities: identities.map(row => ({ identityId: row.identityId, platform: row.platform, sourceAccountId: row.sourceAccountId, externalId: row.externalId, displayName: row.displayName, avatarMediaId: row.avatarMediaId })),
      relationshipAssertions: assertions.map(row => ({ assertionId: row.assertionId, assertionType: row.assertionType, value: row.value, confidence: row.confidence, sourceMessageIds: row.sourceMessageIds, projectionVersion: row.projectionVersion }))
    };
    const snapshotId = this.idFactory('contact-context-snapshot'); const at = this.clock();
    store.db.prepare(`INSERT INTO contact_context_snapshots(snapshot_id,contact_id,trace_id,version,context_json,source_assertion_ids_json,created_at) VALUES(?,?,?,?,?,?,?)`)
      .run(snapshotId, contactId, clean(input.traceId), version, JSON.stringify(context), JSON.stringify(assertions.map(row => row.assertionId)), at);
    return { authority: AUTHORITY, schemaVersion: SCHEMA_VERSION, snapshotId, contactId, traceId: clean(input.traceId), version, context, sourceAssertionIds: assertions.map(row => row.assertionId), createdAt: at };
  }
}

const singleton = new ContactRelationshipAuthority();
module.exports = singleton;
module.exports.ContactRelationshipAuthority = ContactRelationshipAuthority;
module.exports.AUTHORITY = AUTHORITY;
module.exports.SCHEMA_VERSION = SCHEMA_VERSION;
