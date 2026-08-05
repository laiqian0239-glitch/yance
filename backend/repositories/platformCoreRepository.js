'use strict';

const { getStore } = require('./storeProvider');
const { parseJson } = require('../lib/r32SqliteStore');
const { canonicalHash } = require('../services/canonicalSerialization');
const { assertCoordinatorRepositoryCapability } = require('../services/authorityTransactionCoordinator');
const { ensureCanonicalProjectionReceiptSchema } = require('../migrations/projectionReceiptSchemaAuthority');

function clean(value) { return String(value == null ? '' : value).trim(); }
function json(value, fallback = '{}') {
  try { return JSON.stringify(value == null ? JSON.parse(fallback) : value); } catch (_) { return fallback; }
}
function projectionCheckpointOutputHash(input = {}, ledgerSequence) {
  const explicitHash = clean(input.projectionHash).toLowerCase();
  if (/^[a-f0-9]{64}$/u.test(explicitHash)) return explicitHash;
  return canonicalHash({
    contractVersion: 1,
    projectorName: clean(input.projectorName),
    projectorVersion: clean(input.projectorVersion),
    eventId: clean(input.eventId),
    ledgerSequence,
    projectionStatus: clean(input.projectionStatus),
    failureCode: clean(input.failureCode),
    failureReason: clean(input.failureReason),
    targetRefs: input.targetRefs == null ? [] : input.targetRefs,
    attempt: Number(input.attempt || 1)
  });
}
function rowJson(row, fields = []) {
  if (!row) return null;
  const output = { ...row };
  for (const field of fields) output[field.replace(/_json$/, '')] = parseJson(row[field], field.endsWith('refs_json') || field.endsWith('ids_json') ? [] : {});
  return output;
}

const LEARNING_PROFILE_COLUMNS = [
  'scope_type','scope_id','learning_level','version','preference_json','evidence_signal_ids_json',
  'confidence','state','created_at','activated_at','person_id'
];
function rawLearningProfile(row = {}) {
  return Object.fromEntries(LEARNING_PROFILE_COLUMNS.map(column => [column, row[column] == null ? (column === 'version' || column === 'confidence' ? 0 : '') : row[column]]));
}
function sameRawLearningProfile(row, snapshot) {
  if (!row || !snapshot) return false;
  return LEARNING_PROFILE_COLUMNS.every(column => {
    if (column === 'version' || column === 'confidence') return Number(row[column] || 0) === Number(snapshot[column] || 0);
    return String(row[column] == null ? '' : row[column]) === String(snapshot[column] == null ? '' : snapshot[column]);
  });
}

class PlatformCoreRepository {
  constructor(options = {}) {
    this.storeProvider = typeof options.storeProvider === 'function' ? options.storeProvider : getStore;
    this.coordinatorCapability = options.coordinatorCapability || null;
    if (this.coordinatorCapability) assertCoordinatorRepositoryCapability(this.coordinatorCapability, this.store());
  }
  store() { return this.storeProvider(); }
  transaction(callback) { return this.store().transaction(() => callback(this)); }
  assertCoordinatorWrite() {
    if (!this.coordinatorCapability) {
      throw Object.assign(new Error('Platform core ledger mutation requires coordinatorCapability'), { code: 'AUTHORITY_COORDINATOR_CAPABILITY_REQUIRED' });
    }
    return assertCoordinatorRepositoryCapability(this.coordinatorCapability, this.store());
  }

  getPerson(personId) {
    return rowJson(this.store().db.prepare('SELECT * FROM persons WHERE person_id=?').get(clean(personId)), ['payload_json']);
  }

  listPersons(input = {}) {
    const clauses = [];
    const params = [];
    if (input.workspaceId) { clauses.push('workspace_id=?'); params.push(clean(input.workspaceId)); }
    if (input.state) { clauses.push('state=?'); params.push(clean(input.state)); }
    if (input.profileContactId) { clauses.push('profile_contact_id=?'); params.push(clean(input.profileContactId)); }
    const limit = Math.max(1, Math.min(Number(input.limit || 100), 1000));
    const offset = Math.max(0, Number(input.offset || 0));
    const rows = this.store().db.prepare(`
      SELECT * FROM persons${clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''}
      ORDER BY updated_at DESC,person_id LIMIT ? OFFSET ?
    `).all(...params, limit, offset);
    return rows.map(row => rowJson(row, ['payload_json']));
  }
  insertPerson(input = {}) {
    this.store().db.prepare(`
      INSERT INTO persons(person_id,workspace_id,display_name,state,profile_contact_id,confidence,payload_json,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?)
    `).run(
      clean(input.personId), clean(input.workspaceId) || 'default', clean(input.displayName), clean(input.state) || 'active',
      clean(input.profileContactId), Number(input.confidence == null ? 1 : input.confidence), json(input.payload || {}), clean(input.createdAt), clean(input.updatedAt)
    );
    return this.getPerson(input.personId);
  }
  updatePerson(personId, patch = {}) {
    const before = this.getPerson(personId);
    if (!before) return null;
    this.store().db.prepare(`
      UPDATE persons
      SET display_name=?, state=?, profile_contact_id=?, confidence=?, payload_json=?, updated_at=?
      WHERE person_id=?
    `).run(
      patch.displayName == null ? before.display_name : clean(patch.displayName),
      patch.state == null ? before.state : clean(patch.state),
      patch.profileContactId == null ? before.profile_contact_id : clean(patch.profileContactId),
      patch.confidence == null ? Number(before.confidence || 0) : Number(patch.confidence),
      patch.payload == null ? before.payload_json : json(patch.payload || {}),
      clean(patch.updatedAt), clean(personId)
    );
    return this.getPerson(personId);
  }

  getIdentityLink(identityLinkId) {
    return rowJson(this.store().db.prepare('SELECT * FROM identity_links WHERE identity_link_id=?').get(clean(identityLinkId)), ['evidence_refs_json', 'payload_json']);
  }
  getIdentityLinkByScope(input = {}) {
    return rowJson(this.store().db.prepare(`
      SELECT * FROM identity_links
      WHERE workspace_id=? AND platform=? AND source_account_id=? AND external_id=?
    `).get(clean(input.workspaceId) || 'default', clean(input.platform).toLowerCase(), clean(input.sourceAccountId), clean(input.externalId)), ['evidence_refs_json', 'payload_json']);
  }
  listIdentityLinks(personId, options = {}) {
    const includeDetached = options.includeDetached === true;
    const rows = includeDetached
      ? this.store().db.prepare('SELECT * FROM identity_links WHERE person_id=? ORDER BY created_at,identity_link_id').all(clean(personId))
      : this.store().db.prepare("SELECT * FROM identity_links WHERE person_id=? AND link_status<>'detached' ORDER BY created_at,identity_link_id").all(clean(personId));
    return rows.map(row => rowJson(row, ['evidence_refs_json', 'payload_json']));
  }
  insertIdentityLink(input = {}) {
    this.store().db.prepare(`
      INSERT INTO identity_links(
        identity_link_id,workspace_id,person_id,platform,source_account_id,external_id,link_status,confidence,
        verification_method,evidence_refs_json,created_by,superseded_by,payload_json,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      clean(input.identityLinkId), clean(input.workspaceId) || 'default', clean(input.personId), clean(input.platform).toLowerCase(),
      clean(input.sourceAccountId), clean(input.externalId), clean(input.linkStatus) || 'observed', Number(input.confidence || 0),
      clean(input.verificationMethod), json(input.evidenceRefs || [], '[]'), clean(input.createdBy) || 'system', clean(input.supersededBy),
      json(input.payload || {}), clean(input.createdAt), clean(input.updatedAt)
    );
    return this.getIdentityLink(input.identityLinkId);
  }
  updateIdentityLink(identityLinkId, patch = {}) {
    const before = this.getIdentityLink(identityLinkId);
    if (!before) return null;
    this.store().db.prepare(`
      UPDATE identity_links
      SET person_id=?, link_status=?, confidence=?, verification_method=?, evidence_refs_json=?, created_by=?, superseded_by=?, payload_json=?, updated_at=?
      WHERE identity_link_id=?
    `).run(
      patch.personId == null ? before.person_id : clean(patch.personId),
      patch.linkStatus == null ? before.link_status : clean(patch.linkStatus),
      patch.confidence == null ? Number(before.confidence || 0) : Number(patch.confidence),
      patch.verificationMethod == null ? before.verification_method : clean(patch.verificationMethod),
      patch.evidenceRefs == null ? before.evidence_refs_json : json(patch.evidenceRefs || [], '[]'),
      patch.createdBy == null ? before.created_by : clean(patch.createdBy),
      patch.supersededBy == null ? before.superseded_by : clean(patch.supersededBy),
      patch.payload == null ? before.payload_json : json(patch.payload || {}),
      clean(patch.updatedAt), clean(identityLinkId)
    );
    return this.getIdentityLink(identityLinkId);
  }
  insertIdentityAudit(input = {}) {
    this.store().db.prepare(`
      INSERT INTO identity_link_audit(
        audit_id,operation,workspace_id,source_person_id,target_person_id,identity_link_id,before_json,after_json,
        evidence_refs_json,rollback_plan_json,reason,actor,created_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      clean(input.auditId), clean(input.operation), clean(input.workspaceId) || 'default', clean(input.sourcePersonId),
      clean(input.targetPersonId), clean(input.identityLinkId), json(input.before || {}), json(input.after || {}),
      json(input.evidenceRefs || [], '[]'), json(input.rollbackPlan || {}), clean(input.reason), clean(input.actor) || 'system', clean(input.createdAt)
    );
    return this.getIdentityAudit(input.auditId);
  }

  listIdentityAudits(input = {}) {
    const clauses = [];
    const params = [];
    if (input.personId) { clauses.push('(source_person_id=? OR target_person_id=?)'); params.push(clean(input.personId), clean(input.personId)); }
    if (input.identityLinkId) { clauses.push('identity_link_id=?'); params.push(clean(input.identityLinkId)); }
    if (input.operation) { clauses.push('operation=?'); params.push(clean(input.operation)); }
    const limit = Math.max(1, Math.min(Number(input.limit || 100), 1000));
    const offset = Math.max(0, Number(input.offset || 0));
    const rows = this.store().db.prepare(`
      SELECT * FROM identity_link_audit${clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''}
      ORDER BY created_at DESC,audit_id DESC LIMIT ? OFFSET ?
    `).all(...params, limit, offset);
    return rows.map(row => rowJson(row, ['before_json','after_json','evidence_refs_json','rollback_plan_json']));
  }
  getIdentityAudit(auditId) {
    return rowJson(this.store().db.prepare('SELECT * FROM identity_link_audit WHERE audit_id=?').get(clean(auditId)), ['before_json', 'after_json', 'evidence_refs_json', 'rollback_plan_json']);
  }


  upsertPersonContactBinding(input = {}) {
    this.store().db.prepare(`
      INSERT INTO person_contact_bindings(person_id,contact_id,workspace_id,state,source,evidence_refs_json,merge_audit_id,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?)
      ON CONFLICT(person_id,contact_id) DO UPDATE SET
        workspace_id=excluded.workspace_id,state=excluded.state,source=excluded.source,
        evidence_refs_json=excluded.evidence_refs_json,merge_audit_id=excluded.merge_audit_id,updated_at=excluded.updated_at
    `).run(
      clean(input.personId), clean(input.contactId), clean(input.workspaceId) || 'default', clean(input.state) || 'active',
      clean(input.source) || 'identity-authority', json(input.evidenceRefs || [], '[]'), clean(input.mergeAuditId),
      clean(input.createdAt), clean(input.updatedAt)
    );
    return rowJson(this.store().db.prepare('SELECT * FROM person_contact_bindings WHERE person_id=? AND contact_id=?').get(clean(input.personId), clean(input.contactId)), ['evidence_refs_json']);
  }
  listPersonContactBindings(input = {}) {
    const clauses = []; const params = [];
    if (input.personId) { clauses.push('person_id=?'); params.push(clean(input.personId)); }
    if (input.contactId) { clauses.push('contact_id=?'); params.push(clean(input.contactId)); }
    if (input.state) { clauses.push('state=?'); params.push(clean(input.state)); }
    const limit = Math.max(1, Math.min(Number(input.limit || 1000), 10000));
    const offset = Math.max(0, Number(input.offset || 0));
    return this.store().db.prepare(`SELECT * FROM person_contact_bindings${clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''} ORDER BY updated_at DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset).map(row => rowJson(row, ['evidence_refs_json']));
  }
  getActivePersonForContact(contactId) {
    return rowJson(this.store().db.prepare("SELECT * FROM person_contact_bindings WHERE contact_id=? AND state='active' ORDER BY updated_at DESC LIMIT 1").get(clean(contactId)), ['evidence_refs_json']);
  }
  updatePersonContactBinding(personId, contactId, patch = {}) {
    const row = this.store().db.prepare('SELECT * FROM person_contact_bindings WHERE person_id=? AND contact_id=?').get(clean(personId), clean(contactId));
    if (!row) return null;
    this.store().db.prepare(`UPDATE person_contact_bindings SET state=?,source=?,evidence_refs_json=?,merge_audit_id=?,updated_at=? WHERE person_id=? AND contact_id=?`).run(
      patch.state == null ? row.state : clean(patch.state), patch.source == null ? row.source : clean(patch.source),
      patch.evidenceRefs == null ? row.evidence_refs_json : json(patch.evidenceRefs || [], '[]'),
      patch.mergeAuditId == null ? row.merge_audit_id : clean(patch.mergeAuditId), clean(patch.updatedAt), clean(personId), clean(contactId)
    );
    return rowJson(this.store().db.prepare('SELECT * FROM person_contact_bindings WHERE person_id=? AND contact_id=?').get(clean(personId), clean(contactId)), ['evidence_refs_json']);
  }
  upsertConversationBinding(input = {}) {
    this.store().db.prepare(`
      INSERT INTO conversation_bindings(person_id,conversation_id,contact_id,platform,account_id,external_id,state,source,evidence_refs_json,merge_audit_id,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(person_id,conversation_id) DO UPDATE SET
        contact_id=excluded.contact_id,platform=excluded.platform,account_id=excluded.account_id,external_id=excluded.external_id,
        state=excluded.state,source=excluded.source,evidence_refs_json=excluded.evidence_refs_json,
        merge_audit_id=excluded.merge_audit_id,updated_at=excluded.updated_at
    `).run(
      clean(input.personId), clean(input.conversationId), clean(input.contactId), clean(input.platform).toLowerCase(), clean(input.accountId), clean(input.externalId),
      clean(input.state) || 'active', clean(input.source) || 'identity-authority', json(input.evidenceRefs || [], '[]'), clean(input.mergeAuditId),
      clean(input.createdAt), clean(input.updatedAt)
    );
    return rowJson(this.store().db.prepare('SELECT * FROM conversation_bindings WHERE person_id=? AND conversation_id=?').get(clean(input.personId), clean(input.conversationId)), ['evidence_refs_json']);
  }
  listConversationBindings(input = {}) {
    const clauses = []; const params = [];
    if (input.personId) { clauses.push('person_id=?'); params.push(clean(input.personId)); }
    if (input.conversationId) { clauses.push('conversation_id=?'); params.push(clean(input.conversationId)); }
    if (input.contactId) { clauses.push('contact_id=?'); params.push(clean(input.contactId)); }
    if (input.state) { clauses.push('state=?'); params.push(clean(input.state)); }
    const limit = Math.max(1, Math.min(Number(input.limit || 1000), 10000));
    const offset = Math.max(0, Number(input.offset || 0));
    return this.store().db.prepare(`SELECT * FROM conversation_bindings${clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''} ORDER BY updated_at DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset).map(row => rowJson(row, ['evidence_refs_json']));
  }
  updateConversationBinding(personId, conversationId, patch = {}) {
    const row = this.store().db.prepare('SELECT * FROM conversation_bindings WHERE person_id=? AND conversation_id=?').get(clean(personId), clean(conversationId));
    if (!row) return null;
    this.store().db.prepare(`UPDATE conversation_bindings SET state=?,source=?,evidence_refs_json=?,merge_audit_id=?,updated_at=? WHERE person_id=? AND conversation_id=?`).run(
      patch.state == null ? row.state : clean(patch.state), patch.source == null ? row.source : clean(patch.source),
      patch.evidenceRefs == null ? row.evidence_refs_json : json(patch.evidenceRefs || [], '[]'),
      patch.mergeAuditId == null ? row.merge_audit_id : clean(patch.mergeAuditId), clean(patch.updatedAt), clean(personId), clean(conversationId)
    );
    return rowJson(this.store().db.prepare('SELECT * FROM conversation_bindings WHERE person_id=? AND conversation_id=?').get(clean(personId), clean(conversationId)), ['evidence_refs_json']);
  }
  insertIdentityOperationReceipt(input = {}) {
    this.store().db.prepare(`
      INSERT INTO identity_governance_operation_receipts(receipt_id,audit_id,operation,status,before_json,after_json,actor,reason,created_at)
      VALUES(?,?,?,?,?,?,?,?,?)
    `).run(clean(input.receiptId), clean(input.auditId), clean(input.operation), clean(input.status), json(input.before || {}), json(input.after || {}), clean(input.actor) || 'system', clean(input.reason), clean(input.createdAt));
    return rowJson(this.store().db.prepare('SELECT * FROM identity_governance_operation_receipts WHERE receipt_id=?').get(clean(input.receiptId)), ['before_json','after_json']);
  }
  listIdentityOperationReceipts(input = {}) {
    const clauses=[]; const params=[];
    if (input.auditId) { clauses.push('audit_id=?'); params.push(clean(input.auditId)); }
    if (input.status) { clauses.push('status=?'); params.push(clean(input.status)); }
    const limit=Math.max(1,Math.min(Number(input.limit||100),1000)); const offset=Math.max(0,Number(input.offset||0));
    return this.store().db.prepare(`SELECT * FROM identity_governance_operation_receipts${clauses.length?` WHERE ${clauses.join(' AND ')}`:''} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(...params,limit,offset).map(row=>rowJson(row,['before_json','after_json']));
  }
  moveRelationshipLearningProfiles(input = {}) {
    const sourcePersonId = clean(input.sourcePersonId);
    const targetPersonId = clean(input.targetPersonId);
    if (!sourcePersonId || !targetPersonId || sourcePersonId === targetPersonId) return { profiles: [], signals: [] };
    const db = this.store().db;
    const sourceRows = db.prepare(`
      SELECT * FROM learning_preference_profiles
      WHERE scope_type='relationship' AND (scope_id=? OR person_id=?)
      ORDER BY learning_level,version,created_at
    `).all(sourcePersonId, sourcePersonId);
    if (!sourceRows.length) return { profiles: [], signals: [] };
    const profiles = [];
    const signals = [];
    const signalRows = db.prepare(`
      SELECT signal_id,signal_json,person_id FROM learning_signal_ledger
      WHERE learning_level='L2' AND signal_type='synthesis_promoted'
      ORDER BY created_at,signal_id
    `).all();
    const insertProfile = db.prepare(`
      INSERT INTO learning_preference_profiles(
        scope_type,scope_id,learning_level,version,preference_json,evidence_signal_ids_json,
        confidence,state,created_at,activated_at,person_id
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
    `);
    for (const level of [...new Set(sourceRows.map(row => clean(row.learning_level)))]) {
      let nextVersion = Number(db.prepare(`
        SELECT COALESCE(MAX(version),0) AS version FROM learning_preference_profiles
        WHERE scope_type='relationship' AND scope_id=? AND learning_level=?
      `).get(targetPersonId, level)?.version || 0);
      for (const row of sourceRows.filter(item => clean(item.learning_level) === level)) {
        const original = rawLearningProfile(row);
        const targetVersion = ++nextVersion;
        const expected = rawLearningProfile({ ...row, scope_id: targetPersonId, person_id: targetPersonId, version: targetVersion });
        const removed = db.prepare(`DELETE FROM learning_preference_profiles WHERE scope_type=? AND scope_id=? AND learning_level=? AND version=?`)
          .run(original.scope_type, original.scope_id, original.learning_level, Number(original.version));
        if (Number(removed.changes || 0) !== 1) {
          const failure = new Error('Relationship learning profile changed during Person merge.');
          failure.code = 'IDENTITY_RELATIONSHIP_LEARNING_MOVE_CONFLICT';
          failure.profile = original;
          throw failure;
        }
        insertProfile.run(...LEARNING_PROFILE_COLUMNS.map(column => expected[column]));
        const stored = db.prepare(`SELECT * FROM learning_preference_profiles WHERE scope_type='relationship' AND scope_id=? AND learning_level=? AND version=?`)
          .get(targetPersonId, level, targetVersion);
        if (!sameRawLearningProfile(stored, expected)) {
          const failure = new Error('Relationship learning profile relocation could not be verified.');
          failure.code = 'IDENTITY_RELATIONSHIP_LEARNING_MOVE_VERIFY_FAILED';
          failure.expected = expected;
          failure.actual = stored || null;
          throw failure;
        }
        const relocation = { original, relocated: rawLearningProfile(stored) };
        profiles.push(relocation);
        for (const signalRow of signalRows) {
          let signal;
          try { signal = JSON.parse(signalRow.signal_json || '{}'); } catch (_) { signal = {}; }
          if (clean(signal.targetScopeType) !== 'relationship'
            || clean(signal.targetScopeId) !== clean(original.scope_id)
            || Number(signal.profileVersion || 0) !== Number(original.version)) continue;
          const updatedSignal = { ...signal, targetScopeId: targetPersonId, profileVersion: targetVersion };
          const expectedJson = json(updatedSignal);
          const expectedPersonId = targetPersonId;
          const changed = db.prepare(`UPDATE learning_signal_ledger SET signal_json=?,person_id=? WHERE signal_id=? AND signal_json=?`)
            .run(expectedJson, expectedPersonId, clean(signalRow.signal_id), signalRow.signal_json);
          if (Number(changed.changes || 0) !== 1) {
            const failure = new Error('Relationship learning synthesis signal changed during Person merge.');
            failure.code = 'IDENTITY_RELATIONSHIP_LEARNING_SIGNAL_MOVE_CONFLICT';
            failure.signalId = clean(signalRow.signal_id);
            throw failure;
          }
          signals.push({
            signalId: clean(signalRow.signal_id),
            originalSignalJson: signalRow.signal_json,
            originalPersonId: clean(signalRow.person_id),
            relocatedSignalJson: expectedJson,
            relocatedPersonId: expectedPersonId
          });
          signalRow.signal_json = expectedJson;
          signalRow.person_id = expectedPersonId;
        }
      }
    }
    return { profiles, signals };
  }

  rollbackRelationshipLearningProfiles(input = {}) {
    const profiles = Array.isArray(input.profiles) ? input.profiles : [];
    const signals = Array.isArray(input.signals) ? input.signals : [];
    const db = this.store().db;
    for (const relocation of profiles) {
      const original = relocation?.original || {};
      const relocated = relocation?.relocated || {};
      const current = db.prepare(`SELECT * FROM learning_preference_profiles WHERE scope_type=? AND scope_id=? AND learning_level=? AND version=?`)
        .get(clean(relocated.scope_type), clean(relocated.scope_id), clean(relocated.learning_level), Number(relocated.version));
      if (!sameRawLearningProfile(current, relocated)) {
        const failure = new Error('Relationship learning profile changed after Person merge; rollback requires manual conflict resolution.');
        failure.code = 'IDENTITY_RELATIONSHIP_LEARNING_ROLLBACK_CONFLICT';
        failure.expected = relocated;
        failure.actual = current || null;
        throw failure;
      }
      const occupied = db.prepare(`SELECT * FROM learning_preference_profiles WHERE scope_type=? AND scope_id=? AND learning_level=? AND version=?`)
        .get(clean(original.scope_type), clean(original.scope_id), clean(original.learning_level), Number(original.version));
      if (occupied) {
        const failure = new Error('Original relationship learning profile key is occupied; rollback would overwrite later learning.');
        failure.code = 'IDENTITY_RELATIONSHIP_LEARNING_ROLLBACK_KEY_CONFLICT';
        failure.original = original;
        throw failure;
      }
    }
    for (const signal of signals) {
      const current = db.prepare('SELECT signal_json,person_id FROM learning_signal_ledger WHERE signal_id=?').get(clean(signal.signalId));
      if (!current || clean(current.person_id) !== clean(signal.relocatedPersonId) || String(current.signal_json || '') !== String(signal.relocatedSignalJson || '')) {
        const failure = new Error('Relationship learning synthesis signal changed after Person merge; rollback requires manual conflict resolution.');
        failure.code = 'IDENTITY_RELATIONSHIP_LEARNING_SIGNAL_ROLLBACK_CONFLICT';
        failure.signalId = clean(signal.signalId);
        throw failure;
      }
    }
    const insertProfile = db.prepare(`
      INSERT INTO learning_preference_profiles(
        scope_type,scope_id,learning_level,version,preference_json,evidence_signal_ids_json,
        confidence,state,created_at,activated_at,person_id
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
    `);
    for (const relocation of profiles) {
      const relocated = relocation.relocated;
      const original = relocation.original;
      db.prepare(`DELETE FROM learning_preference_profiles WHERE scope_type=? AND scope_id=? AND learning_level=? AND version=?`)
        .run(clean(relocated.scope_type), clean(relocated.scope_id), clean(relocated.learning_level), Number(relocated.version));
      insertProfile.run(...LEARNING_PROFILE_COLUMNS.map(column => original[column]));
      const restored = db.prepare(`SELECT * FROM learning_preference_profiles WHERE scope_type=? AND scope_id=? AND learning_level=? AND version=?`)
        .get(clean(original.scope_type), clean(original.scope_id), clean(original.learning_level), Number(original.version));
      if (!sameRawLearningProfile(restored, original)) {
        const failure = new Error('Relationship learning profile rollback verification failed.');
        failure.code = 'IDENTITY_RELATIONSHIP_LEARNING_ROLLBACK_VERIFY_FAILED';
        throw failure;
      }
    }
    for (const signal of signals) {
      db.prepare('UPDATE learning_signal_ledger SET signal_json=?,person_id=? WHERE signal_id=?')
        .run(String(signal.originalSignalJson || '{}'), clean(signal.originalPersonId), clean(signal.signalId));
    }
    return { profiles: profiles.length, signals: signals.length };
  }

  movePersonAnchors(input = {}) {
    const sourcePersonId=clean(input.sourcePersonId); const targetPersonId=clean(input.targetPersonId); const auditId=clean(input.auditId); const at=clean(input.updatedAt);
    const contactBindings=this.listPersonContactBindings({personId:sourcePersonId,state:'active',limit:10000});
    const conversationBindings=this.listConversationBindings({personId:sourcePersonId,state:'active',limit:10000});
    const contactIds=contactBindings.map(row=>clean(row.contact_id)).filter(Boolean);
    const conversationIds=conversationBindings.map(row=>clean(row.conversation_id)).filter(Boolean);
    const relationshipLearning = this.moveRelationshipLearningProfiles({ sourcePersonId, targetPersonId, auditId, updatedAt: at });
    for(const row of contactBindings){
      this.updatePersonContactBinding(sourcePersonId,row.contact_id,{state:'merged',mergeAuditId:auditId,updatedAt:at});
      this.upsertPersonContactBinding({personId:targetPersonId,contactId:row.contact_id,workspaceId:row.workspace_id,state:'active',source:'identity-merge',evidenceRefs:row.evidence_refs||[],mergeAuditId:auditId,createdAt:row.created_at||at,updatedAt:at});
    }
    for(const row of conversationBindings){
      this.updateConversationBinding(sourcePersonId,row.conversation_id,{state:'merged',mergeAuditId:auditId,updatedAt:at});
      this.upsertConversationBinding({personId:targetPersonId,conversationId:row.conversation_id,contactId:row.contact_id,platform:row.platform,accountId:row.account_id,externalId:row.external_id,state:'active',source:'identity-merge',evidenceRefs:row.evidence_refs||[],mergeAuditId:auditId,createdAt:row.created_at||at,updatedAt:at});
    }
    const db=this.store().db;
    const contactTables=['customer_profiles','relationship_insights','relationship_timeline_events','customer_social_state','customer_interaction_preferences','interaction_policies','ai_context_snapshots','ai_reply_tasks','ai_reply_candidates','ai_reply_outbox','ai_analysis_runs','ai_candidate_generation_plans','ai_director_strategies','ai_reply_feedback_events','learning_signal_ledger','relationship_state_signals','social_inference_corrections'];
    if(contactIds.length){
      const placeholders=contactIds.map(()=>'?').join(',');
      for(const table of contactTables) db.prepare(`UPDATE ${table} SET person_id=? WHERE person_id=? AND contact_id IN (${placeholders})`).run(targetPersonId,sourcePersonId,...contactIds);
      db.prepare(`UPDATE customer_profile_evidence SET person_id=? WHERE person_id=? AND canonical_contact_id IN (${placeholders})`).run(targetPersonId,sourcePersonId,...contactIds);
      for (const table of ['ai_reply_feedback_profiles','ai_reply_feedback_profile_versions','learning_preference_profiles']) db.prepare(`UPDATE ${table} SET person_id=? WHERE person_id=? AND scope_type='contact' AND scope_id IN (${placeholders})`).run(targetPersonId,sourcePersonId,...contactIds);
    }
    if(conversationIds.length){
      const placeholders=conversationIds.map(()=>'?').join(',');
      db.prepare(`UPDATE r32_conversations SET person_id=? WHERE person_id=? AND session_key IN (${placeholders})`).run(targetPersonId,sourcePersonId,...conversationIds);
    }
    return {contactBindings,conversationBindings,contactIds,conversationIds,relationshipLearningProfiles:relationshipLearning.profiles,relationshipLearningSignals:relationshipLearning.signals};
  }
  rollbackPersonAnchors(input = {}) {
    const sourcePersonId=clean(input.sourcePersonId); const targetPersonId=clean(input.targetPersonId); const auditId=clean(input.auditId); const at=clean(input.updatedAt);
    const targetContacts=this.listPersonContactBindings({personId:targetPersonId,limit:10000}).filter(row=>clean(row.merge_audit_id)===auditId&&clean(row.state)==='active');
    const targetConversations=this.listConversationBindings({personId:targetPersonId,limit:10000}).filter(row=>clean(row.merge_audit_id)===auditId&&clean(row.state)==='active');
    const contactIds=targetContacts.map(row=>clean(row.contact_id)).filter(Boolean); const conversationIds=targetConversations.map(row=>clean(row.conversation_id)).filter(Boolean);
    const restoredRelationshipLearning = this.rollbackRelationshipLearningProfiles({ profiles: input.relationshipLearningProfiles, signals: input.relationshipLearningSignals });
    for(const row of targetContacts){this.updatePersonContactBinding(targetPersonId,row.contact_id,{state:'rolled-back',updatedAt:at});this.updatePersonContactBinding(sourcePersonId,row.contact_id,{state:'active',mergeAuditId:'',updatedAt:at});}
    for(const row of targetConversations){this.updateConversationBinding(targetPersonId,row.conversation_id,{state:'rolled-back',updatedAt:at});this.updateConversationBinding(sourcePersonId,row.conversation_id,{state:'active',mergeAuditId:'',updatedAt:at});}
    const db=this.store().db; const contactTables=['customer_profiles','relationship_insights','relationship_timeline_events','customer_social_state','customer_interaction_preferences','interaction_policies','ai_context_snapshots','ai_reply_tasks','ai_reply_candidates','ai_reply_outbox','ai_analysis_runs','ai_candidate_generation_plans','ai_director_strategies','ai_reply_feedback_events','learning_signal_ledger','relationship_state_signals','social_inference_corrections'];
    if(contactIds.length){const placeholders=contactIds.map(()=>'?').join(',');for(const table of contactTables)db.prepare(`UPDATE ${table} SET person_id=? WHERE person_id=? AND contact_id IN (${placeholders})`).run(sourcePersonId,targetPersonId,...contactIds);db.prepare(`UPDATE customer_profile_evidence SET person_id=? WHERE person_id=? AND canonical_contact_id IN (${placeholders})`).run(sourcePersonId,targetPersonId,...contactIds);for(const table of ['ai_reply_feedback_profiles','ai_reply_feedback_profile_versions','learning_preference_profiles'])db.prepare(`UPDATE ${table} SET person_id=? WHERE person_id=? AND scope_type='contact' AND scope_id IN (${placeholders})`).run(sourcePersonId,targetPersonId,...contactIds);}
    if(conversationIds.length){const placeholders=conversationIds.map(()=>'?').join(',');db.prepare(`UPDATE r32_conversations SET person_id=? WHERE person_id=? AND session_key IN (${placeholders})`).run(sourcePersonId,targetPersonId,...conversationIds);}
    return {contactIds,conversationIds,restoredRelationshipLearning};
  }

  getCapabilityObservation(observationId) {
    return rowJson(this.store().db.prepare('SELECT * FROM platform_capability_observations WHERE observation_id=?').get(clean(observationId)), ['constraints_json', 'evidence_json']);
  }
  insertCapabilityObservation(input = {}) {
    this.store().db.prepare(`
      INSERT INTO platform_capability_observations(
        observation_id,authority,scope_type,scope_id,platform,account_id,capability_id,support,availability,
        reason_code,constraints_json,evidence_json,observed_at,expires_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(scope_type,scope_id,capability_id,observed_at) DO NOTHING
    `).run(
      clean(input.observationId), clean(input.authority) || 'PlatformCapabilityAuthority', clean(input.scopeType), clean(input.scopeId),
      clean(input.platform).toLowerCase(), clean(input.accountId), clean(input.capabilityId), clean(input.support), clean(input.availability),
      clean(input.reasonCode), json(input.constraints || [], '[]'), json(input.evidence || {}), clean(input.observedAt), clean(input.expiresAt)
    );
    return rowJson(this.store().db.prepare('SELECT * FROM platform_capability_observations WHERE observation_id=?').get(clean(input.observationId)), ['constraints_json', 'evidence_json']);
  }
  listCapabilityObservations(input = {}) {
    const clauses = [];
    const params = [];
    if (input.scopeType) { clauses.push('scope_type=?'); params.push(clean(input.scopeType)); }
    if (input.scopeId) { clauses.push('scope_id=?'); params.push(clean(input.scopeId)); }
    if (input.platform) { clauses.push('platform=?'); params.push(clean(input.platform).toLowerCase()); }
    if (input.accountId) { clauses.push('account_id=?'); params.push(clean(input.accountId)); }
    if (input.capabilityId) { clauses.push('capability_id=?'); params.push(clean(input.capabilityId)); }
    if (input.authority) { clauses.push('authority=?'); params.push(clean(input.authority)); }
    const limit = Math.max(1, Math.min(Number(input.limit || 100), 1000));
    const offset = Math.max(0, Number(input.offset || 0));
    return this.store().db.prepare(`
      SELECT * FROM platform_capability_observations${clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''}
      ORDER BY observed_at DESC,observation_id DESC LIMIT ? OFFSET ?
    `).all(...params, limit, offset).map(row => rowJson(row, ['constraints_json', 'evidence_json']));
  }
  latestCapabilityObservation(input = {}) {
    return this.listCapabilityObservations({ ...input, limit: 1 })[0] || null;
  }
  insertHealthState(input = {}) {
    this.store().db.prepare(`
      INSERT INTO platform_health_states(
        health_state_id,scope_type,scope_id,platform,account_id,health,reason_code,next_action,
        capability_snapshot_id,evidence_json,observed_at,expires_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(scope_type,scope_id,observed_at) DO NOTHING
    `).run(
      clean(input.healthStateId), clean(input.scopeType), clean(input.scopeId), clean(input.platform).toLowerCase(), clean(input.accountId),
      clean(input.health), clean(input.reasonCode), clean(input.nextAction), clean(input.capabilitySnapshotId), json(input.evidence || {}),
      clean(input.observedAt), clean(input.expiresAt)
    );
    return rowJson(this.store().db.prepare('SELECT * FROM platform_health_states WHERE health_state_id=?').get(clean(input.healthStateId)), ['evidence_json']);
  }

  getDomainEvent(eventId) {
    return rowJson(this.store().db.prepare('SELECT * FROM domain_events WHERE event_id=?').get(clean(eventId)), ['payload_json']);
  }
  getDomainEventByIdempotency(idempotencyKey) {
    return rowJson(this.store().db.prepare('SELECT * FROM domain_events WHERE idempotency_key=?').get(clean(idempotencyKey)), ['payload_json']);
  }
  getDomainEventByExternalIdentity(platform, sourceAccountId, eventType, externalEventId) {
    const externalId = clean(externalEventId);
    if (!externalId) return null;
    return rowJson(this.store().db.prepare(`
      SELECT * FROM domain_events
      WHERE platform=? AND source_account_id=? AND event_type=? AND external_event_id=?
      LIMIT 1
    `).get(clean(platform).toLowerCase(), clean(sourceAccountId), clean(eventType), externalId), ['payload_json']);
  }
  updateDomainReplayState(eventId, replayState) {
    this.assertCoordinatorWrite();
    this.store().db.prepare('UPDATE domain_events SET replay_state=? WHERE event_id=?').run(clean(replayState), clean(eventId));
    return this.getDomainEvent(eventId);
  }
  listDomainEvents(input = {}) {
    const clauses = [];
    const params = [];
    if (input.eventType) { clauses.push('event_type=?'); params.push(clean(input.eventType)); }
    if (input.platform) { clauses.push('platform=?'); params.push(clean(input.platform).toLowerCase()); }
    if (input.sourceAccountId) { clauses.push('source_account_id=?'); params.push(clean(input.sourceAccountId)); }
    if (input.replayState) { clauses.push('replay_state=?'); params.push(clean(input.replayState)); }
    const limit = Math.max(1, Math.min(Number(input.limit || 1000), 100000));
    const offset = Math.max(0, Number(input.offset || 0));
    const rows = this.store().db.prepare(`
      SELECT * FROM domain_events${clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''}
      ORDER BY received_at ASC,event_id ASC LIMIT ? OFFSET ?
    `).all(...params, limit, offset);
    return rows.map(row => rowJson(row, ['payload_json']));
  }
  countDomainEvents(input = {}) {
    const clauses = [];
    const params = [];
    if (input.eventType) { clauses.push('event_type=?'); params.push(clean(input.eventType)); }
    if (input.platform) { clauses.push('platform=?'); params.push(clean(input.platform).toLowerCase()); }
    if (input.sourceAccountId) { clauses.push('source_account_id=?'); params.push(clean(input.sourceAccountId)); }
    if (input.replayState) { clauses.push('replay_state=?'); params.push(clean(input.replayState)); }
    const row = this.store().db.prepare(`SELECT COUNT(*) AS n FROM domain_events${clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''}`).get(...params);
    return Number(row?.n || 0);
  }
  getProjectionReceipt(projectorName, projectorVersion, eventId) {
    return rowJson(this.store().db.prepare(`
      SELECT * FROM domain_projection_receipts
      WHERE projector_name=? AND projector_version=? AND event_id=?
    `).get(clean(projectorName), clean(projectorVersion), clean(eventId)), ['target_refs_json']);
  }
  upsertProjectionReceipt(input = {}) {
    const ledgerSequence = Number(input.ledgerSequence);
    if (!Number.isSafeInteger(ledgerSequence) || ledgerSequence < 1) {
      throw Object.assign(new Error('Projection receipt requires a positive canonical ledgerSequence'), { code: 'CANONICAL_LEDGER_SEQUENCE_REQUIRED' });
    }
    const token = this.assertCoordinatorWrite();
    const store = this.store();
    const db = store.db;
    ensureCanonicalProjectionReceiptSchema(db);
    return store.transaction(() => {
      db.prepare(`
        INSERT INTO domain_projection_receipts(
          projector_name,projector_version,event_id,ledger_sequence,projection_status,projection_hash,target_refs_json,failure_code,failure_reason,attempt,projected_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(projector_name,projector_version,event_id) DO UPDATE SET
          ledger_sequence=excluded.ledger_sequence,projection_status=excluded.projection_status,projection_hash=excluded.projection_hash,
          target_refs_json=excluded.target_refs_json,failure_code=excluded.failure_code,failure_reason=excluded.failure_reason,
          attempt=excluded.attempt,projected_at=excluded.projected_at
        WHERE domain_projection_receipts.ledger_sequence<=excluded.ledger_sequence
      `).run(
        clean(input.projectorName), clean(input.projectorVersion), clean(input.eventId), ledgerSequence, clean(input.projectionStatus),
        clean(input.projectionHash), json(input.targetRefs || [], '[]'), clean(input.failureCode), clean(input.failureReason),
        Number(input.attempt || 1), clean(input.projectedAt)
      );
      db.prepare(`
        INSERT INTO projection_checkpoints_v2(
          projector_id,projector_version,ledger_sequence,lease_owner,generation,fencing_token,output_hash,lag,updated_at
        ) VALUES(?,?,?,?,?,?,?,?,?)
        ON CONFLICT(projector_id) DO UPDATE SET
          projector_version=excluded.projector_version,ledger_sequence=excluded.ledger_sequence,lease_owner=excluded.lease_owner,
          generation=excluded.generation,fencing_token=excluded.fencing_token,output_hash=excluded.output_hash,lag=excluded.lag,updated_at=excluded.updated_at
        WHERE projection_checkpoints_v2.ledger_sequence<=excluded.ledger_sequence
      `).run(
        clean(input.projectorName), clean(input.projectorVersion), ledgerSequence, token.hostId, token.hostGeneration, token.fencingToken,
        projectionCheckpointOutputHash(input, ledgerSequence), 0, clean(input.projectedAt)
      );
      return rowJson(db.prepare(`
        SELECT * FROM domain_projection_receipts WHERE projector_name=? AND projector_version=? AND event_id=?
      `).get(clean(input.projectorName), clean(input.projectorVersion), clean(input.eventId)), ['target_refs_json']);
    });
  }


  countProjectionReceipts(input = {}) {
    const clauses = [];
    const params = [];
    if (input.projectorName) { clauses.push('projector_name=?'); params.push(clean(input.projectorName)); }
    if (input.projectorVersion) { clauses.push('projector_version=?'); params.push(clean(input.projectorVersion)); }
    if (input.projectionStatus) { clauses.push('projection_status=?'); params.push(clean(input.projectionStatus)); }
    if (input.eventId) { clauses.push('event_id=?'); params.push(clean(input.eventId)); }
    const row = this.store().db.prepare(`SELECT COUNT(*) AS n FROM domain_projection_receipts${clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''}`).get(...params);
    return Number(row?.n || 0);
  }
  countBlockingProjectionEvents(input = {}) {
    const statuses = Array.isArray(input.statuses) && input.statuses.length ? input.statuses.map(clean).filter(Boolean) : ['failed','shadow-mismatch'];
    const placeholders = statuses.map(() => '?').join(',');
    const clauses = [`projection_status IN (${placeholders})`];
    const params = [...statuses];
    if (input.projectorName) { clauses.push('projector_name=?'); params.push(clean(input.projectorName)); }
    if (input.projectorVersion) { clauses.push('projector_version=?'); params.push(clean(input.projectorVersion)); }
    const row = this.store().db.prepare(`SELECT COUNT(DISTINCT event_id) AS n FROM domain_projection_receipts WHERE ${clauses.join(' AND ')}`).get(...params);
    return Number(row?.n || 0);
  }
  listBlockingProjectionReceipts(input = {}) {
    const statuses = Array.isArray(input.statuses) && input.statuses.length ? input.statuses.map(clean).filter(Boolean) : ['failed','shadow-mismatch'];
    const placeholders = statuses.map(() => '?').join(',');
    const clauses = [`projection_status IN (${placeholders})`];
    const params = [...statuses];
    if (input.projectorName) { clauses.push('projector_name=?'); params.push(clean(input.projectorName)); }
    if (input.projectorVersion) { clauses.push('projector_version=?'); params.push(clean(input.projectorVersion)); }
    const limit = Math.max(1, Math.min(Number(input.limit || 100), 1000));
    const offset = Math.max(0, Number(input.offset || 0));
    const rows = this.store().db.prepare(`
      SELECT * FROM (
        SELECT r.*,ROW_NUMBER() OVER(PARTITION BY event_id ORDER BY projected_at DESC,projector_name DESC) AS row_rank
        FROM domain_projection_receipts r WHERE ${clauses.join(' AND ')}
      ) WHERE row_rank=1
      ORDER BY projected_at DESC,event_id DESC LIMIT ? OFFSET ?
    `).all(...params, limit, offset);
    return rows.map(row => { const copy = { ...row }; delete copy.row_rank; return rowJson(copy, ['target_refs_json']); });
  }
  listProjectionReceipts(input = {}) {
    const clauses = [];
    const params = [];
    if (input.projectorName) { clauses.push('projector_name=?'); params.push(clean(input.projectorName)); }
    if (input.projectorVersion) { clauses.push('projector_version=?'); params.push(clean(input.projectorVersion)); }
    if (input.projectionStatus) { clauses.push('projection_status=?'); params.push(clean(input.projectionStatus)); }
    if (input.eventId) { clauses.push('event_id=?'); params.push(clean(input.eventId)); }
    const limit = Math.max(1, Math.min(Number(input.limit || 100), 1000));
    const offset = Math.max(0, Number(input.offset || 0));
    const rows = this.store().db.prepare(`
      SELECT * FROM domain_projection_receipts${clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''}
      ORDER BY projected_at DESC,event_id DESC LIMIT ? OFFSET ?
    `).all(...params, limit, offset);
    return rows.map(row => rowJson(row, ['target_refs_json']));
  }
  projectionConvergence(input = {}) {
    const projectorName = clean(input.projectorName);
    const projectorVersion = clean(input.projectorVersion);
    const rows = this.store().db.prepare(`
      SELECT projection_status AS status,COUNT(*) AS n
      FROM domain_projection_receipts
      WHERE projector_name=? AND projector_version=?
      GROUP BY projection_status
    `).all(projectorName, projectorVersion);
    const counts = Object.fromEntries(rows.map(row => [clean(row.status) || 'unknown', Number(row.n || 0)]));
    const total = Object.values(counts).reduce((sum, value) => sum + Number(value || 0), 0);
    const blocking = Number(counts['shadow-mismatch'] || 0) + Number(counts.failed || 0);
    const applied = Number(counts.applied || 0);
    const matched = applied + Number(counts['shadow-match'] || 0);
    return { projectorName, projectorVersion, total, applied, matched, blocking, converged: blocking === 0 && matched === total, counts };
  }

  upsertSendPolicy(input = {}) {
    this.store().db.prepare(`
      INSERT INTO send_policy_versions(policy_version,policy_json,policy_sha256,state,created_by,created_at,activated_at)
      VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(policy_version) DO UPDATE SET
        policy_json=excluded.policy_json,policy_sha256=excluded.policy_sha256,state=excluded.state,
        created_by=excluded.created_by,activated_at=excluded.activated_at
    `).run(clean(input.policyVersion), json(input.policy || {}), clean(input.policySha256), clean(input.state) || 'candidate', clean(input.createdBy) || 'system', clean(input.createdAt), clean(input.activatedAt));
    return rowJson(this.store().db.prepare('SELECT * FROM send_policy_versions WHERE policy_version=?').get(clean(input.policyVersion)), ['policy_json']);
  }
  activateSendPolicy(policyVersion, activatedAt) {
    const db = this.store().db;
    db.prepare("UPDATE send_policy_versions SET state='retired' WHERE state='active' AND policy_version<>?").run(clean(policyVersion));
    db.prepare("UPDATE send_policy_versions SET state='active', activated_at=? WHERE policy_version=?").run(clean(activatedAt), clean(policyVersion));
    return rowJson(db.prepare('SELECT * FROM send_policy_versions WHERE policy_version=?').get(clean(policyVersion)), ['policy_json']);
  }
  getSendPolicyVersion(policyVersion) {
    return rowJson(this.store().db.prepare('SELECT * FROM send_policy_versions WHERE policy_version=?').get(clean(policyVersion)), ['policy_json']);
  }
  getActiveSendPolicy() {
    return rowJson(this.store().db.prepare("SELECT * FROM send_policy_versions WHERE state='active' ORDER BY activated_at DESC LIMIT 1").get(), ['policy_json']);
  }

  insertDirectorStrategy(input = {}) {
    this.store().db.prepare(`
      INSERT INTO ai_director_strategies(
        strategy_id,contact_id,conversation_id,strategy_version,conversation_generation,persona_version_id,memory_snapshot_id,
        learning_profile_version,strategy_json,strategy_sha256,evidence_refs_json,state,expires_on_json,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      clean(input.strategyId), clean(input.contactId), clean(input.conversationId), Number(input.strategyVersion || 1), clean(input.conversationGeneration),
      Number(input.personaVersionId || 0), clean(input.memorySnapshotId), Number(input.learningProfileVersion || 0), json(input.strategy || {}),
      clean(input.strategySha256), json(input.evidenceRefs || [], '[]'), clean(input.state) || 'active', json(input.expiresOn || [], '[]'),
      clean(input.createdAt), clean(input.updatedAt)
    );
    return rowJson(this.store().db.prepare('SELECT * FROM ai_director_strategies WHERE strategy_id=?').get(clean(input.strategyId)), ['strategy_json', 'evidence_refs_json', 'expires_on_json']);
  }
  supersedeDirectorStrategies(conversationId, exceptStrategyId, updatedAt) {
    this.store().db.prepare("UPDATE ai_director_strategies SET state='superseded',updated_at=? WHERE conversation_id=? AND state='active' AND strategy_id<>?")
      .run(clean(updatedAt), clean(conversationId), clean(exceptStrategyId));
  }
  getDirectorStrategy(strategyId) {
    return rowJson(this.store().db.prepare('SELECT * FROM ai_director_strategies WHERE strategy_id=?').get(clean(strategyId)), ['strategy_json', 'evidence_refs_json', 'expires_on_json']);
  }
  getActiveDirectorStrategy(conversationId) {
    return rowJson(this.store().db.prepare(`
      SELECT * FROM ai_director_strategies
      WHERE conversation_id=? AND state='active'
      ORDER BY strategy_version DESC,updated_at DESC LIMIT 1
    `).get(clean(conversationId)), ['strategy_json', 'evidence_refs_json', 'expires_on_json']);
  }
  insertCandidatePlan(input = {}) {
    this.store().db.prepare(`
      INSERT INTO ai_candidate_generation_plans(
        plan_id,strategy_id,contact_id,conversation_id,candidate_count,shared_constraints_json,branches_json,plan_sha256,state,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      clean(input.planId), clean(input.strategyId), clean(input.contactId), clean(input.conversationId), Number(input.candidateCount || 3),
      json(input.sharedConstraints || {}), json(input.branches || [], '[]'), clean(input.planSha256), clean(input.state) || 'active', clean(input.createdAt), clean(input.updatedAt)
    );
    return rowJson(this.store().db.prepare('SELECT * FROM ai_candidate_generation_plans WHERE plan_id=?').get(clean(input.planId)), ['shared_constraints_json', 'branches_json']);
  }
  supersedeCandidatePlans(conversationId, exceptPlanId, updatedAt) {
    this.store().db.prepare("UPDATE ai_candidate_generation_plans SET state='superseded',updated_at=? WHERE conversation_id=? AND state='active' AND plan_id<>?")
      .run(clean(updatedAt), clean(conversationId), clean(exceptPlanId));
  }
  getCandidatePlan(planId) {
    return rowJson(this.store().db.prepare('SELECT * FROM ai_candidate_generation_plans WHERE plan_id=?').get(clean(planId)), ['shared_constraints_json', 'branches_json']);
  }
  getActiveCandidatePlan(conversationId) {
    return rowJson(this.store().db.prepare(`
      SELECT * FROM ai_candidate_generation_plans
      WHERE conversation_id=? AND state='active'
      ORDER BY updated_at DESC LIMIT 1
    `).get(clean(conversationId)), ['shared_constraints_json', 'branches_json']);
  }

  getLearningSignalByIdempotency(idempotencyKey) {
    return rowJson(this.store().db.prepare('SELECT * FROM learning_signal_ledger WHERE idempotency_key=?').get(clean(idempotencyKey)), ['signal_json']);
  }

  insertLearningSignal(input = {}) {
    this.store().db.prepare(`
      INSERT INTO learning_signal_ledger(
        signal_id,idempotency_key,learning_level,scope_type,scope_id,contact_id,conversation_id,candidate_id,outbox_id,
        signal_type,signal_json,quality_tier,emergency_mode,learning_eligible,created_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(idempotency_key) DO NOTHING
    `).run(
      clean(input.signalId), clean(input.idempotencyKey), clean(input.learningLevel), clean(input.scopeType), clean(input.scopeId), clean(input.contactId),
      clean(input.conversationId), clean(input.candidateId), clean(input.outboxId), clean(input.signalType), json(input.signal || {}), clean(input.qualityTier),
      input.emergencyMode ? 1 : 0, input.learningEligible === false ? 0 : 1, clean(input.createdAt)
    );
    return rowJson(this.store().db.prepare('SELECT * FROM learning_signal_ledger WHERE idempotency_key=?').get(clean(input.idempotencyKey)), ['signal_json']);
  }
  listEligibleLearningSignals(input = {}) {
    const rows = this.store().db.prepare(`
      SELECT * FROM learning_signal_ledger
      WHERE scope_type=? AND scope_id=? AND learning_level=? AND learning_eligible=1 AND emergency_mode=0
      ORDER BY created_at ASC
    `).all(clean(input.scopeType), clean(input.scopeId), clean(input.learningLevel));
    return rows.map(row => rowJson(row, ['signal_json']));
  }
  listLearningSignalScopes(input = {}) {
    const level = clean(input.learningLevel);
    const rows = this.store().db.prepare(`
      SELECT scope_type,scope_id,COUNT(*) AS sample_count,MAX(created_at) AS latest_at
      FROM learning_signal_ledger
      WHERE learning_level=? AND learning_eligible=1 AND emergency_mode=0
      GROUP BY scope_type,scope_id
      ORDER BY latest_at ASC
    `).all(level);
    return rows.map(row => ({ scopeType: clean(row.scope_type), scopeId: clean(row.scope_id), sampleCount: Number(row.sample_count || 0), latestAt: clean(row.latest_at) }));
  }
  listCandidateLearningSignals(input = {}) {
    const clauses = ['candidate_id=?'];
    const params = [clean(input.candidateId)];
    if (input.learningEligible === true) clauses.push('learning_eligible=1');
    if (input.learningEligible === false) clauses.push('learning_eligible=0');
    if (input.signalType) { clauses.push('signal_type=?'); params.push(clean(input.signalType)); }
    const rows = this.store().db.prepare(`
      SELECT * FROM learning_signal_ledger WHERE ${clauses.join(' AND ')} ORDER BY created_at ASC
    `).all(...params);
    return rows.map(row => rowJson(row, ['signal_json']));
  }

  listLearningSignals(input = {}) {
    const clauses = ['scope_type=?', 'scope_id=?'];
    const params = [clean(input.scopeType), clean(input.scopeId)];
    if (input.learningLevel) { clauses.push('learning_level=?'); params.push(clean(input.learningLevel)); }
    if (input.learningEligible === true) clauses.push('learning_eligible=1');
    if (input.learningEligible === false) clauses.push('learning_eligible=0');
    const rows = this.store().db.prepare(`
      SELECT * FROM learning_signal_ledger WHERE ${clauses.join(' AND ')} ORDER BY created_at ASC
    `).all(...params);
    return rows.map(row => rowJson(row, ['signal_json']));
  }
  insertLearningProfile(input = {}) {
    this.store().db.prepare(`
      INSERT INTO learning_preference_profiles(
        scope_type,scope_id,learning_level,version,preference_json,evidence_signal_ids_json,confidence,state,created_at,activated_at,person_id
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      clean(input.scopeType), clean(input.scopeId), clean(input.learningLevel), Number(input.version), json(input.preference || {}),
      json(input.evidenceSignalIds || [], '[]'), Number(input.confidence || 0), clean(input.state) || 'candidate', clean(input.createdAt), clean(input.activatedAt), clean(input.personId)
    );
    return rowJson(this.store().db.prepare(`
      SELECT * FROM learning_preference_profiles WHERE scope_type=? AND scope_id=? AND learning_level=? AND version=?
    `).get(clean(input.scopeType), clean(input.scopeId), clean(input.learningLevel), Number(input.version)), ['preference_json', 'evidence_signal_ids_json']);
  }
  getLearningProfile(input = {}) {
    return rowJson(this.store().db.prepare(`
      SELECT * FROM learning_preference_profiles
      WHERE scope_type=? AND scope_id=? AND learning_level=? AND version=?
    `).get(clean(input.scopeType), clean(input.scopeId), clean(input.learningLevel), Number(input.version)), ['preference_json', 'evidence_signal_ids_json']);
  }
  getLatestLearningProfile(input = {}) {
    const stateClause = input.state ? ' AND state=?' : '';
    const params = [clean(input.scopeType), clean(input.scopeId), clean(input.learningLevel)];
    if (input.state) params.push(clean(input.state));
    return rowJson(this.store().db.prepare(`
      SELECT * FROM learning_preference_profiles
      WHERE scope_type=? AND scope_id=? AND learning_level=?${stateClause}
      ORDER BY version DESC LIMIT 1
    `).get(...params), ['preference_json', 'evidence_signal_ids_json']);
  }
  listLearningProfiles(input = {}) {
    const rows = this.store().db.prepare(`
      SELECT * FROM learning_preference_profiles
      WHERE scope_type=? AND scope_id=? AND learning_level=?
      ORDER BY version DESC
    `).all(clean(input.scopeType), clean(input.scopeId), clean(input.learningLevel));
    return rows.map(row => rowJson(row, ['preference_json', 'evidence_signal_ids_json']));
  }
  listLearningProfilesFiltered(input = {}) {
    const clauses = [];
    const params = [];
    if (input.scopeType) { clauses.push('scope_type=?'); params.push(clean(input.scopeType)); }
    if (input.scopeId) { clauses.push('scope_id=?'); params.push(clean(input.scopeId)); }
    if (input.learningLevel) { clauses.push('learning_level=?'); params.push(clean(input.learningLevel)); }
    if (input.state) { clauses.push('state=?'); params.push(clean(input.state)); }
    if (input.personId) { clauses.push('person_id=?'); params.push(clean(input.personId)); }
    const limit = Math.max(1, Math.min(Number(input.limit || 200), 2000));
    const offset = Math.max(0, Number(input.offset || 0));
    const rows = this.store().db.prepare(`
      SELECT * FROM learning_preference_profiles${clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''}
      ORDER BY scope_type,scope_id,learning_level,version DESC LIMIT ? OFFSET ?
    `).all(...params, limit, offset);
    return rows.map(row => rowJson(row, ['preference_json', 'evidence_signal_ids_json']));
  }
  updateLearningProfileState(input = {}) {
    this.store().db.prepare(`
      UPDATE learning_preference_profiles SET state=?,activated_at=?
      WHERE scope_type=? AND scope_id=? AND learning_level=? AND version=?
    `).run(clean(input.state), clean(input.activatedAt), clean(input.scopeType), clean(input.scopeId), clean(input.learningLevel), Number(input.version));
    return rowJson(this.store().db.prepare(`
      SELECT * FROM learning_preference_profiles WHERE scope_type=? AND scope_id=? AND learning_level=? AND version=?
    `).get(clean(input.scopeType), clean(input.scopeId), clean(input.learningLevel), Number(input.version)), ['preference_json', 'evidence_signal_ids_json']);
  }
  activateLearningProfile(input = {}) {
    const db = this.store().db;
    db.prepare(`
      UPDATE learning_preference_profiles SET state='rolled-back'
      WHERE scope_type=? AND scope_id=? AND learning_level=? AND state='active' AND version<>?
    `).run(clean(input.scopeType), clean(input.scopeId), clean(input.learningLevel), Number(input.version));
    db.prepare(`
      UPDATE learning_preference_profiles SET state='active',activated_at=?
      WHERE scope_type=? AND scope_id=? AND learning_level=? AND version=?
    `).run(clean(input.activatedAt), clean(input.scopeType), clean(input.scopeId), clean(input.learningLevel), Number(input.version));
    return this.getLatestLearningProfile({ ...input, state: 'active' });
  }

  listLearningPromotionAudits(input = {}) {
    const clauses = [];
    const params = [];
    if (input.decision) { clauses.push('decision=?'); params.push(clean(input.decision)); }
    if (input.toLevel) { clauses.push('to_level=?'); params.push(clean(input.toLevel)); }
    if (input.targetScopeType) { clauses.push('target_scope_type=?'); params.push(clean(input.targetScopeType)); }
    if (input.targetScopeId) { clauses.push('target_scope_id=?'); params.push(clean(input.targetScopeId)); }
    const limit = Math.max(1, Math.min(Number(input.limit || 100), 1000));
    const offset = Math.max(0, Number(input.offset || 0));
    const rows = this.store().db.prepare(`
      SELECT * FROM learning_promotion_audit${clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''}
      ORDER BY created_at DESC,promotion_id DESC LIMIT ? OFFSET ?
    `).all(...params, limit, offset);
    return rows.map(row => rowJson(row, ['source_versions_json']));
  }
  getLearningPromotionAudit(promotionId) {
    return rowJson(this.store().db.prepare('SELECT * FROM learning_promotion_audit WHERE promotion_id=?').get(clean(promotionId)), ['source_versions_json']);
  }

  insertLearningPromotionAudit(input = {}) {
    this.store().db.prepare(`
      INSERT INTO learning_promotion_audit(
        promotion_id,from_level,to_level,source_scope_type,source_scope_id,target_scope_type,target_scope_id,
        source_versions_json,sample_count,confidence,decision,reason,rollback_version,actor,created_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      clean(input.promotionId), clean(input.fromLevel), clean(input.toLevel), clean(input.sourceScopeType), clean(input.sourceScopeId),
      clean(input.targetScopeType), clean(input.targetScopeId), json(input.sourceVersions || [], '[]'), Number(input.sampleCount || 0),
      Number(input.confidence || 0), clean(input.decision), clean(input.reason), Number(input.rollbackVersion || 0), clean(input.actor) || 'system', clean(input.createdAt)
    );
    return rowJson(this.store().db.prepare('SELECT * FROM learning_promotion_audit WHERE promotion_id=?').get(clean(input.promotionId)), ['source_versions_json']);
  }

  updateLearningPromotionAudit(promotionId, patch = {}) {
    const before = this.getLearningPromotionAudit(promotionId);
    if (!before) return null;
    this.store().db.prepare(`
      UPDATE learning_promotion_audit
      SET decision=?,reason=?,actor=?,created_at=?
      WHERE promotion_id=?
    `).run(
      patch.decision == null ? before.decision : clean(patch.decision),
      patch.reason == null ? before.reason : clean(patch.reason),
      patch.actor == null ? before.actor : clean(patch.actor),
      patch.createdAt == null ? before.created_at : clean(patch.createdAt),
      clean(promotionId)
    );
    return this.getLearningPromotionAudit(promotionId);
  }


  architectureSummary() {
    const db = this.store().db;
    const tableExists = table => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
    const count = (table, where = '', params = []) => {
      if (!tableExists(table)) return 0;
      const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}${where ? ` WHERE ${where}` : ''}`).get(...params);
      return Number(row?.n || 0);
    };
    const grouped = (table, column) => {
      if (!tableExists(table)) return {};
      const rows = db.prepare(`SELECT COALESCE(${column},'') AS key, COUNT(*) AS n FROM ${table} GROUP BY COALESCE(${column},'')`).all();
      return Object.fromEntries(rows.map(row => [String(row.key || 'unknown'), Number(row.n || 0)]));
    };
    const schemaVersion = tableExists('r32_meta')
      ? Number(this.store().getMeta('schemaVersion', this.store().getMeta('schema_version', 0)) || 0)
      : 0;
    const activePolicy = this.getActiveSendPolicy();
    return {
      schemaVersion,
      generatedAt: new Date().toISOString(),
      identity: {
        persons: count('persons'),
        links: count('identity_links'),
        linkStates: grouped('identity_links', 'link_status'),
        audits: count('identity_link_audit')
      },
      ingress: {
        domainEvents: count('domain_events'),
        replayStates: grouped('domain_events', 'replay_state'),
        projectionReceipts: count('domain_projection_receipts'),
        projectionStates: grouped('domain_projection_receipts', 'projection_status')
      },
      capabilityAndHealth: {
        observations: count('platform_capability_observations'),
        observationAvailability: grouped('platform_capability_observations', 'availability'),
        healthStates: count('platform_health_states'),
        healthLevels: grouped('platform_health_states', 'health')
      },
      outbox: {
        activePolicyVersion: clean(activePolicy?.policy_version),
        policyVersions: count('send_policy_versions'),
        queuedWithPolicy: count('r32_send_queue', "COALESCE(send_policy_json,'')<>''"),
        queuedEmergency: count('r32_send_queue', 'emergency_mode=1'),
        aiOutboxWithPolicy: count('ai_reply_outbox', "COALESCE(send_policy_version,'')<>''"),
        aiOutboxEmergency: count('ai_reply_outbox', "COALESCE(json_extract(quality_route_receipt_json,'$.emergencyMode'),0)=1")
      },
      aiQuality: {
        directorStrategies: count('ai_director_strategies'),
        activeDirectorStrategies: count('ai_director_strategies', "state='active'"),
        candidatePlans: count('ai_candidate_generation_plans'),
        activeCandidatePlans: count('ai_candidate_generation_plans', "state='active'"),
        learningSignals: count('learning_signal_ledger'),
        learningEligibleSignals: count('learning_signal_ledger', 'learning_eligible=1 AND emergency_mode=0'),
        emergencySignals: count('learning_signal_ledger', 'emergency_mode=1'),
        preferenceProfiles: count('learning_preference_profiles'),
        activePreferenceProfiles: count('learning_preference_profiles', "state='active'"),
        promotionAudits: count('learning_promotion_audit')
      }
    };
  }
}

function createPlatformCoreRepository(options = {}) { return new PlatformCoreRepository(options); }
const singleton = new PlatformCoreRepository();

module.exports = { PlatformCoreRepository, createPlatformCoreRepository, singleton };
