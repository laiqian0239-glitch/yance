'use strict';

const identityAuthority = require('./identityLinkAuthority').singleton;
const { singleton: repository } = require('../repositories/platformCoreRepository');

const AUTHORITY = 'IdentityGovernanceProductAuthority';

function clean(value) { return String(value == null ? '' : value).trim(); }
function publicPerson(row) {
  return row ? {
    personId: row.person_id, workspaceId: row.workspace_id, displayName: row.display_name, state: row.state,
    profileContactId: row.profile_contact_id, confidence: Number(row.confidence || 0), payload: row.payload || {},
    createdAt: row.created_at, updatedAt: row.updated_at
  } : null;
}
function publicLink(row) {
  return row ? {
    identityLinkId: row.identity_link_id, workspaceId: row.workspace_id, personId: row.person_id,
    platform: row.platform, sourceAccountId: row.source_account_id, externalId: row.external_id,
    linkStatus: row.link_status, confidence: Number(row.confidence || 0), verificationMethod: row.verification_method,
    evidenceRefs: row.evidence_refs || [], createdBy: row.created_by, supersededBy: row.superseded_by,
    payload: row.payload || {}, createdAt: row.created_at, updatedAt: row.updated_at
  } : null;
}
function rollbackSummary(plan = {}) {
  const source = plan && typeof plan === 'object' && !Array.isArray(plan) ? plan : {};
  return {
    operation: clean(source.operation),
    rollbackAvailable: Boolean(clean(source.operation)),
    contactCount: Array.isArray(source.contactIds) ? source.contactIds.length : 0,
    conversationCount: Array.isArray(source.conversationIds) ? source.conversationIds.length : 0,
    relationshipLearningProfileCount: Array.isArray(source.relationshipLearningProfiles) ? source.relationshipLearningProfiles.length : 0,
    relationshipLearningSignalCount: Array.isArray(source.relationshipLearningSignals) ? source.relationshipLearningSignals.length : 0
  };
}
function publicAudit(row) {
  return row ? {
    auditId: row.audit_id, operation: row.operation, workspaceId: row.workspace_id,
    sourcePersonId: row.source_person_id, targetPersonId: row.target_person_id, identityLinkId: row.identity_link_id,
    before: row.before || {}, after: row.after || {}, evidenceRefs: row.evidence_refs || [], rollbackPlan: rollbackSummary(row.rollback_plan || {}),
    reason: row.reason, actor: row.actor, createdAt: row.created_at
  } : null;
}
function normalizePhone(value) {
  const text = clean(value);
  if (!text) return '';
  const direct = text.match(/^\+?([1-9]\d{6,14})$/u);
  if (direct) return `phone:+${direct[1]}`;
  const jid = text.match(/^([1-9]\d{6,14})@s\.whatsapp\.net$/iu);
  return jid ? `phone:+${jid[1]}` : '';
}
function verifiedKeys(link = {}) {
  const payload = link.payload || {};
  const output = [];
  const phone = normalizePhone(payload.phoneE164 || payload.verifiedPhone || (link.platform === 'whatsapp' ? link.externalId : ''));
  if (phone) output.push({ key: phone, method: 'verified-phone' });
  const email = clean(payload.verifiedEmail).toLowerCase();
  if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) output.push({ key: `email:${email}`, method: 'verified-email' });
  return output;
}

class IdentityGovernanceService {
  constructor(options = {}) { this.repository = options.repository || repository; this.identity = options.identity || identityAuthority; }

  suggestions(input = {}) {
    const persons = this.repository.listPersons({ workspaceId: clean(input.workspaceId) || 'default', state: 'active', limit: 1000 });
    const groups = new Map();
    for (const person of persons) {
      for (const row of this.repository.listIdentityLinks(person.person_id, { includeDetached: false })) {
        const link = publicLink(row);
        if (['detached','disputed'].includes(link.linkStatus)) continue;
        for (const identity of verifiedKeys(link)) {
          const list = groups.get(identity.key) || [];
          list.push({ person: publicPerson(person), link, method: identity.method });
          groups.set(identity.key, list);
        }
      }
    }
    const rows = [];
    for (const [evidenceKey, items] of groups) {
      const personIds = [...new Set(items.map(item => item.person.personId))];
      const platforms = [...new Set(items.map(item => item.link.platform))];
      if (personIds.length < 2 || platforms.length < 2) continue;
      for (let i = 0; i < items.length; i += 1) for (let j = i + 1; j < items.length; j += 1) {
        const left = items[i]; const right = items[j];
        if (left.person.personId === right.person.personId || left.link.platform === right.link.platform) continue;
        rows.push({
          suggestionId: [evidenceKey, left.person.personId, right.person.personId].sort().join(':'),
          evidenceType: left.method, evidenceKey, confidence: 0.95,
          sourcePerson: left.person, targetPerson: right.person,
          sourceLink: left.link, targetLink: right.link,
          evidenceRefs: [...new Set([...(left.link.evidenceRefs || []), ...(right.link.evidenceRefs || [])])],
          automaticMergeAllowed: false, requiresHumanConfirmation: true
        });
      }
    }
    return rows;
  }

  overview(input = {}) {
    const workspaceId = clean(input.workspaceId) || 'default';
    let persons = [];
    if (input.personId) {
      const row = this.repository.getPerson(clean(input.personId));
      if (row) persons = [row];
    } else if (input.contactId) {
      persons = this.repository.listPersons({ workspaceId, profileContactId: clean(input.contactId), limit: 100 });
    } else persons = this.repository.listPersons({ workspaceId, limit: Number(input.limit || 200), offset: Number(input.offset || 0) });
    const limit = Math.max(1, Math.min(Number(input.limit || 200), 1000));
    const offset = Math.max(0, Number(input.offset || 0));
    const items = persons.map(row => {
      const person = publicPerson(row);
      const links = this.repository.listIdentityLinks(person.personId, { includeDetached: true }).map(publicLink);
      const audits = this.repository.listIdentityAudits({ personId: person.personId, limit: 200 }).map(publicAudit);
      const contactBindings = this.repository.listPersonContactBindings({ personId: person.personId, limit: 1000 });
      const conversationBindings = this.repository.listConversationBindings({ personId: person.personId, limit: 1000 });
      const operationReceipts = audits.flatMap(audit => this.repository.listIdentityOperationReceipts({ auditId: audit.auditId, limit: 20 }));
      return { person, links, audits, contactBindings, conversationBindings, operationReceipts };
    });
    return {
      authority: AUTHORITY, workspaceId, items, pagination: { limit, offset, hasMore: !input.personId && !input.contactId && persons.length === limit },
      suggestions: this.suggestions({ workspaceId }),
      rules: { displayNameAutoMergeForbidden: true, humanConfirmationRequired: true, reversibleMergeRequired: true }
    };
  }

  transition(input = {}) {
    const action = clean(input.action);
    const allowed = new Set(['suggest','verify','dispute','detach']);
    if (!allowed.has(action)) throw Object.assign(new Error('不支持的身份治理动作。'), { code: 'IDENTITY_GOVERNANCE_ACTION_INVALID', status: 400 });
    return this.identity[action](clean(input.identityLinkId), {
      confidence: input.confidence, verificationMethod: input.verificationMethod,
      evidenceRefs: input.evidenceRefs, actor: input.actor, reason: input.reason, payload: input.payload
    });
  }
  merge(input = {}) { return this.identity.merge(input); }
  rollback(input = {}) { return this.identity.rollbackAudit(clean(input.auditId), input); }
}

const singleton = new IdentityGovernanceService();
module.exports = { AUTHORITY, IdentityGovernanceService, singleton, normalizePhone, verifiedKeys, rollbackSummary };
