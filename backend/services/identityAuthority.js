'use strict';

const crypto = require('crypto');
const { stableId } = require('../lib/r32SqliteStore');
const { singleton: defaultRepository } = require('../repositories/platformCoreRepository');
const legacyCanonicalIdentity = require('../repositories/canonicalIdentityRepository');
const domainEventLog = require('./domainEventLogService').singleton;
const operationalProjectionReceipts = require('./operationalProjectionReceiptAuthority');

const AUTHORITY = 'CrossPlatformIdentityAuthority';
const SCHEMA_VERSION = 1;
const LINK_STATUS = Object.freeze({
  OBSERVED: 'observed', SUGGESTED: 'suggested', VERIFIED: 'verified', MERGED: 'merged',
  DISPUTED: 'disputed', DETACHED: 'detached'
});

function clean(value) { return String(value == null ? '' : value).trim(); }
function now() { return new Date().toISOString(); }
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function unique(values = []) { return [...new Set(values.map(clean).filter(Boolean))]; }
function error(code, message, status = 400, detail = {}) { return Object.assign(new Error(message), { code, status, ...detail }); }

const IDENTITY_MAX_DEPTH = 8;
const IDENTITY_MAX_NODES = 1000;
const IDENTITY_MAX_BYTES = 128 * 1024;
const FORBIDDEN_IDENTITY_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const IDENTITY_MAX_IDENTIFIER = 1024;
const IDENTITY_MAX_EVIDENCE_REFS = 100;
const SENSITIVE_IDENTITY_KEY = /(token|secret|password|cookie|authorization|credential|qrcode|privatekey)/i;
const STRONG_CANONICAL_IDENTITY_TOKEN = /^(?:jid|credential|source):/;

function normalizeIdentityInput(input = {}, label = 'identityInput') {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw error('IDENTITY_INPUT_OBJECT_INVALID', `${label} 必须是纯对象。`);
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    throw error('IDENTITY_INPUT_OBJECT_INVALID', `${label} 必须是纯对象。`);
  }
  if (Object.getOwnPropertySymbols(input).length) {
    throw error('IDENTITY_INPUT_SYMBOL_KEY_FORBIDDEN', `${label} 不得包含 Symbol 键。`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const output = {};
  for (const key of Object.getOwnPropertyNames(input)) {
    if (FORBIDDEN_IDENTITY_KEYS.has(key)) {
      throw error('IDENTITY_INPUT_KEY_FORBIDDEN', `${label} 包含危险对象键。`, 400, { key });
    }
    const descriptor = descriptors[key];
    if (typeof descriptor?.get === 'function' || typeof descriptor?.set === 'function') {
      throw error('IDENTITY_INPUT_ACCESSOR_FORBIDDEN', `${label} 不得包含 getter/setter。`, 400, { key });
    }
    output[key] = descriptor?.value;
  }
  return Object.freeze(output);
}

function sanitizeIdentityObject(value, label = 'identityPayload') {
  const seen = new WeakSet();
  const state = { nodes: 0 };
  const walk = (input, depth, path) => {
    state.nodes += 1;
    if (state.nodes > IDENTITY_MAX_NODES) throw error('IDENTITY_PAYLOAD_TOO_COMPLEX', `${label} 超过最大节点数。`, 400, { path });
    if (depth > IDENTITY_MAX_DEPTH) throw error('IDENTITY_PAYLOAD_TOO_DEEP', `${label} 超过最大嵌套深度。`, 400, { path });
    if (input == null || typeof input === 'string' || typeof input === 'boolean') return input;
    if (typeof input === 'number') {
      if (!Number.isFinite(input)) throw error('IDENTITY_PAYLOAD_NUMBER_INVALID', `${label} 包含非有限数字。`, 400, { path });
      return input;
    }
    if (typeof input !== 'object' || Buffer.isBuffer(input) || input instanceof Uint8Array || input instanceof Date) {
      throw error('IDENTITY_PAYLOAD_TYPE_INVALID', `${label} 只能包含纯 JSON 数据。`, 400, { path });
    }
    if (seen.has(input)) throw error('IDENTITY_PAYLOAD_CYCLE', `${label} 包含循环引用。`, 400, { path });
    seen.add(input);
    try {
      if (Array.isArray(input)) return input.map((item, index) => walk(item, depth + 1, `${path}[${index}]`));
      const proto = Object.getPrototypeOf(input);
      if (proto !== Object.prototype && proto !== null) throw error('IDENTITY_PAYLOAD_PROTOTYPE_INVALID', `${label} 包含非纯对象。`, 400, { path });
      const output = {};
      for (const key of Object.getOwnPropertyNames(input)) {
        if (FORBIDDEN_IDENTITY_KEYS.has(key)) throw error('IDENTITY_PAYLOAD_KEY_FORBIDDEN', `${label} 包含危险对象键。`, 400, { path: `${path}.${key}`, key });
        if (SENSITIVE_IDENTITY_KEY.test(key)) throw error('IDENTITY_PAYLOAD_SECRET_FORBIDDEN', `${label} 不得持久化凭证或秘密。`, 400, { path: `${path}.${key}`, key });
        const descriptor = Object.getOwnPropertyDescriptor(input, key);
        if (descriptor?.get || descriptor?.set) throw error('IDENTITY_PAYLOAD_ACCESSOR_FORBIDDEN', `${label} 不得包含 getter/setter。`, 400, { path: `${path}.${key}` });
        output[key] = walk(descriptor?.value, depth + 1, `${path}.${key}`);
      }
      return output;
    } finally { seen.delete(input); }
  };
  const sanitized = walk(value == null ? {} : value, 0, label);
  const bytes = Buffer.byteLength(JSON.stringify(sanitized), 'utf8');
  if (bytes > IDENTITY_MAX_BYTES) throw error('IDENTITY_PAYLOAD_TOO_LARGE', `${label} 超过最大持久化大小。`, 413, { bytes, maximum: IDENTITY_MAX_BYTES });
  return sanitized;
}

function boundedText(value, label, maximum = IDENTITY_MAX_IDENTIFIER, pattern = null) {
  const result = clean(value);
  if (result.length > maximum) throw error('IDENTITY_IDENTIFIER_TOO_LONG', `${label} 超过最大长度。`, 413, { label, length: result.length, maximum });
  if (/[\u0000-\u001f\u007f]/u.test(result) || (pattern && result && !pattern.test(result))) {
    throw error('IDENTITY_IDENTIFIER_INVALID', `${label} 格式无效。`, 400, { label });
  }
  return result;
}
function evidenceRefs(values = []) {
  const rows = unique(Array.isArray(values) ? values : [values]);
  if (rows.length > IDENTITY_MAX_EVIDENCE_REFS) throw error('IDENTITY_EVIDENCE_TOO_MANY', '身份操作证据数量超过上限。', 413, { count: rows.length, maximum: IDENTITY_MAX_EVIDENCE_REFS });
  return rows.map((value, index) => boundedText(value, `evidenceRefs[${index}]`, 1024));
}
function confidence(value, fallback = 0) {
  const parsed = value == null ? fallback : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) throw error('IDENTITY_CONFIDENCE_INVALID', '身份置信度必须位于 0 到 1。', 400, { value });
  return parsed;
}
function timestamp(value, fallback = now()) {
  const result = clean(value) || fallback;
  if (!Number.isFinite(Date.parse(result))) throw error('IDENTITY_TIMESTAMP_INVALID', '身份操作时间无效。', 400, { value });
  return new Date(result).toISOString();
}
function validateScope(input = {}) {
  const safeInput = normalizeIdentityInput(input, 'identityScope');
  const workspaceId = boundedText(safeInput.workspaceId, 'workspaceId', 256) || 'default';
  const platform = boundedText(safeInput.platform, 'platform', 32, /^[a-z0-9_-]+$/i).toLowerCase();
  const sourceAccountId = boundedText(safeInput.sourceAccountId, 'sourceAccountId', 512);
  const externalId = boundedText(safeInput.externalId, 'externalId', 1024);
  if (!platform || !sourceAccountId || !externalId) {
    throw error('IDENTITY_SCOPE_INCOMPLETE', '身份链接必须包含平台、来源账号和外部身份。', 400, { workspaceId, platform, sourceAccountId, externalId });
  }
  return { workspaceId, platform, sourceAccountId, externalId };
}
function canonicalExternalIdentityScope(input = {}) { return Object.freeze(validateScope(input)); }
function canonicalPersonId(input = {}) {
  const scope = canonicalExternalIdentityScope(input);
  return stableId('person', [scope.workspaceId, scope.platform, scope.sourceAccountId, scope.externalId]);
}
function canonicalIdentityLinkId(input = {}) {
  const scope = canonicalExternalIdentityScope(input);
  return stableId('identity-link', [scope.workspaceId, scope.platform, scope.sourceAccountId, scope.externalId]);
}

function publicLink(row) {
  if (!row) return null;
  return {
    identityLinkId: row.identity_link_id,
    workspaceId: row.workspace_id,
    personId: row.person_id,
    platform: row.platform,
    sourceAccountId: row.source_account_id,
    externalId: row.external_id,
    linkStatus: row.link_status,
    confidence: Number(row.confidence || 0),
    verificationMethod: row.verification_method,
    evidenceRefs: clone(row.evidence_refs || []),
    createdBy: row.created_by,
    supersededBy: row.superseded_by,
    payload: clone(row.payload || {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
function publicPerson(row) {
  if (!row) return null;
  return {
    personId: row.person_id,
    workspaceId: row.workspace_id,
    displayName: row.display_name,
    state: row.state,
    profileContactId: row.profile_contact_id,
    confidence: Number(row.confidence || 0),
    payload: clone(row.payload || {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
function recordIdentityDomainEvent({ repository, eventType, auditId, workspaceId = 'default', platform = 'identity', sourceAccountId = '', projection = {}, targetRefs = [] }) {
  const account = clean(sourceAccountId) || clean(workspaceId) || 'default';
  const created = domainEventLog.append({
    platform: clean(platform).toLowerCase() || 'identity', sourceAccountId: account,
    externalEventId: clean(auditId), eventType,
    idempotencyKey: ['identity', eventType, clean(auditId)].join(':'),
    occurredAt: now(), payload: { projection }, retentionDays: 90
  });
  operationalProjectionReceipts.verifyAndRecord({ created, eventLog: domainEventLog, repository, store: repository?.store?.(), targetRefs });
  return created;
}

class IdentityAuthority {
  constructor(options = {}) {
    this.repository = options.repository || defaultRepository;
    this.eventRecorder = typeof options.eventRecorder === 'function' ? options.eventRecorder : recordIdentityDomainEvent;
    this.legacyCanonicalIdentity = options.legacyCanonicalIdentity || legacyCanonicalIdentity;
  }

  recordIdentityDomainEvent(input = {}) {
    return this.eventRecorder({ repository: this.repository, ...input });
  }

  finalizeOperation(result = {}) {
    const pending = result?.pendingDomainEvent || null;
    const output = { ...result };
    delete output.pendingDomainEvent;
    if (pending) this.recordIdentityDomainEvent({ ...pending, projection: output });
    return output;
  }

  canonicalizeWhatsAppAccounts(options = {}) {
    const safeOptions = normalizeIdentityInput(options, 'identityCanonicalizationOptions');
    if (safeOptions.dryRun === true) {
      return this.legacyCanonicalIdentity.canonicalizeWhatsAppAccounts({ ...safeOptions, dryRun: true });
    }
    const preview = this.legacyCanonicalIdentity.canonicalizeWhatsAppAccounts({ ...safeOptions, dryRun: true });
    const groups = Array.isArray(preview?.groups) ? preview.groups : [];
    const weakGroups = groups.filter(group => {
      const tokens = Array.isArray(group?.sharedTokens) ? group.sharedTokens.map(clean).filter(Boolean) : [];
      return !tokens.some(token => STRONG_CANONICAL_IDENTITY_TOKEN.test(token));
    });
    if (weakGroups.length) {
      throw error(
        'IDENTITY_CANONICALIZATION_WEAK_SIGNAL_FORBIDDEN',
        '身份合并组缺少 JID、凭证或受管来源等强身份证据。',
        409,
        {
          groups: weakGroups.map(group => ({
            canonicalId: clean(group?.canonicalId),
            aliasIds: Array.isArray(group?.aliasIds) ? group.aliasIds.map(clean).filter(Boolean) : []
          }))
        }
      );
    }
    return this.legacyCanonicalIdentity.canonicalizeWhatsAppAccounts(safeOptions);
  }
  resolveCanonicalAccountId(...args) { return this.legacyCanonicalIdentity.resolveCanonicalAccountId(...args); }
  accountIdentityAliases(...args) { return this.legacyCanonicalIdentity.accountIdentityAliases(...args); }
  buildGroups(...args) { return this.legacyCanonicalIdentity.buildGroups(...args); }
  canonicalScore(...args) { return this.legacyCanonicalIdentity.canonicalScore(...args); }

  observeWithinTransaction(input = {}, repo = this.repository) {
    input = normalizeIdentityInput(input, 'identityObservation');
    const scope = canonicalExternalIdentityScope(input);
    const existing = repo.getIdentityLinkByScope(scope);
    const operationAt = timestamp(input.observedAt);
    const suppliedEvidenceRefs = evidenceRefs(input.evidenceRefs);
    if (existing) {
      if (clean(existing.link_status) === LINK_STATUS.DETACHED) {
        throw error('IDENTITY_DETACHED_LINK_REOBSERVATION_FORBIDDEN', '已解除的身份链接不能通过 observe 静默重新激活；必须使用可审计的显式恢复流程。', 409, {
          identityLinkId: clean(existing.identity_link_id), personId: clean(existing.person_id)
        });
      }
      if (clean(input.personId) && clean(input.personId) !== clean(existing.person_id)) {
        throw error('IDENTITY_OBSERVATION_PERSON_CONFLICT', '同一平台身份已经绑定到另一个 Person，不能静默复用。', 409, {
          identityLinkId: clean(existing.identity_link_id), existingPersonId: clean(existing.person_id), requestedPersonId: clean(input.personId)
        });
      }
      const person = repo.getPerson(existing.person_id);
      const contactId = boundedText(input.profileContactId || person?.profile_contact_id, 'profileContactId', 1024);
      if (contactId) repo.upsertPersonContactBinding({
        personId: existing.person_id, contactId, workspaceId: scope.workspaceId, state: 'active',
        source: 'identity-observation-refresh', evidenceRefs: suppliedEvidenceRefs, mergeAuditId: '', createdAt: operationAt, updatedAt: operationAt
      });
      const conversationId = boundedText(input.conversationId, 'conversationId', 1024);
      if (conversationId) repo.upsertConversationBinding({
        personId: existing.person_id, conversationId, contactId, platform: scope.platform, accountId: scope.sourceAccountId,
        externalId: scope.externalId, state: 'active', source: 'identity-observation-refresh', evidenceRefs: suppliedEvidenceRefs,
        mergeAuditId: '', createdAt: operationAt, updatedAt: operationAt
      });
      return { authority: AUTHORITY, created: false, person: publicPerson(person), link: publicLink(existing), contactId, conversationId };
    }

    const suppliedPersonId = boundedText(input.personId, 'personId', 1024);
    const personId = suppliedPersonId || canonicalPersonId(scope);
    const suppliedPerson = suppliedPersonId ? repo.getPerson(suppliedPersonId) : null;
    if (suppliedPerson) {
      if (clean(suppliedPerson.workspace_id) !== scope.workspaceId) {
        throw error('IDENTITY_EXISTING_PERSON_WORKSPACE_MISMATCH', '不能把平台身份直接链接到其他工作区的 Person。', 409, { personId: suppliedPersonId });
      }
      if (input.linkExistingPerson !== true || !suppliedEvidenceRefs.length || !clean(input.actor) || !clean(input.reason)) {
        throw error('IDENTITY_EXISTING_PERSON_LINK_AUDIT_REQUIRED', '链接到既有 Person 必须显式确认，并提供证据、操作者和原因。', 409, { personId: suppliedPersonId });
      }
    }
    if (suppliedPersonId && !suppliedPerson) {
      throw error('IDENTITY_SUPPLIED_PERSON_NOT_FOUND', '调用方指定的 Person 不存在；禁止通过观察接口静默创建指定身份锚点。', 404, { personId: suppliedPersonId });
    }

    const identityLinkId = canonicalIdentityLinkId(scope);
    let person = repo.getPerson(personId);
    if (!person) person = repo.insertPerson({
      personId, workspaceId: scope.workspaceId, displayName: boundedText(input.displayName, 'displayName', 512), state: 'active',
      profileContactId: boundedText(input.profileContactId, 'profileContactId', 1024), confidence: confidence(input.personConfidence, 1),
      payload: { ...sanitizeIdentityObject(input.personPayload || {}, 'personPayload'), source: 'identity-observation' },
      createdAt: operationAt, updatedAt: operationAt
    });
    const link = repo.insertIdentityLink({
      identityLinkId, ...scope, personId, linkStatus: LINK_STATUS.OBSERVED,
      confidence: confidence(input.confidence, 0), verificationMethod: '', evidenceRefs: suppliedEvidenceRefs,
      createdBy: boundedText(input.actor, 'actor', 256) || 'system', payload: sanitizeIdentityObject(input.payload || {}, 'identityLinkPayload'),
      createdAt: operationAt, updatedAt: operationAt
    });
    const contactId = boundedText(input.profileContactId || person.profile_contact_id, 'profileContactId', 1024);
    if (contactId) repo.upsertPersonContactBinding({
      personId, contactId, workspaceId: scope.workspaceId, state: 'active', source: 'identity-observation',
      evidenceRefs: suppliedEvidenceRefs, mergeAuditId: '', createdAt: operationAt, updatedAt: operationAt
    });
    const conversationId = boundedText(input.conversationId, 'conversationId', 1024);
    if (conversationId) repo.upsertConversationBinding({
      personId, conversationId, contactId, platform: scope.platform, accountId: scope.sourceAccountId, externalId: scope.externalId,
      state: 'active', source: 'identity-observation', evidenceRefs: suppliedEvidenceRefs, mergeAuditId: '', createdAt: operationAt, updatedAt: operationAt
    });
    const auditId = `identity-audit-${crypto.randomUUID()}`;
    const audit = repo.insertIdentityAudit({
      auditId, operation: 'observe', workspaceId: scope.workspaceId, targetPersonId: personId, identityLinkId,
      before: {}, after: publicLink(link), evidenceRefs: suppliedEvidenceRefs, rollbackPlan: { operation: 'detach', identityLinkId },
      reason: boundedText(input.reason, 'reason', 2000) || '首次观察到平台身份。', actor: boundedText(input.actor, 'actor', 256) || 'system', createdAt: operationAt
    });
    repo.insertIdentityOperationReceipt({
      receiptId: `identity-receipt-${crypto.randomUUID()}`, auditId, operation: 'observe', status: 'applied', before: {},
      after: { link: publicLink(link), contactId, conversationId }, actor: audit.actor, reason: audit.reason, createdAt: operationAt
    });
    return {
      authority: AUTHORITY, created: true, auditId, person: publicPerson(person), link: publicLink(link), contactId, conversationId,
      pendingDomainEvent: {
        eventType: 'identity.link.observed', auditId, workspaceId: scope.workspaceId, platform: scope.platform,
        sourceAccountId: scope.sourceAccountId,
        targetRefs: [{ table: 'identity_links', id: identityLinkId }, { table: 'identity_link_audit', id: auditId }]
      }
    };
  }

  observe(input = {}) {
    const safeInput = normalizeIdentityInput(input, 'identityObservation');
    const result = this.repository.transaction(repo => this.observeWithinTransaction(safeInput, repo));
    return this.finalizeOperation(result);
  }

  transition(identityLinkId, nextStatus, input = {}) {
    input = normalizeIdentityInput(input, 'identityTransition');
    identityLinkId = boundedText(identityLinkId, 'identityLinkId', 1024);
    const operationAt = timestamp(input.at);
    const link = this.repository.getIdentityLink(identityLinkId);
    if (!link) throw error('IDENTITY_LINK_NOT_FOUND', '身份链接不存在。', 404, { identityLinkId });
    const allowed = {
      suggested: [LINK_STATUS.OBSERVED, LINK_STATUS.DISPUTED],
      verified: [LINK_STATUS.OBSERVED, LINK_STATUS.SUGGESTED, LINK_STATUS.DISPUTED],
      disputed: [LINK_STATUS.OBSERVED, LINK_STATUS.SUGGESTED, LINK_STATUS.VERIFIED, LINK_STATUS.MERGED],
      detached: [LINK_STATUS.OBSERVED, LINK_STATUS.SUGGESTED, LINK_STATUS.VERIFIED, LINK_STATUS.DISPUTED, LINK_STATUS.MERGED]
    };
    if (!allowed[nextStatus]?.includes(link.link_status)) throw error('IDENTITY_LINK_TRANSITION_INVALID', `身份链接不能从 ${link.link_status} 变为 ${nextStatus}。`, 409);
    const transitionEvidence = evidenceRefs(input.evidenceRefs);
    const actor = boundedText(input.actor, 'actor', 256);
    const reason = boundedText(input.reason, 'reason', 2000);
    if (!actor || !reason) throw error('IDENTITY_TRANSITION_AUDIT_REQUIRED', '身份状态变更必须记录操作者和原因。', 409, { identityLinkId, nextStatus });
    if (nextStatus === LINK_STATUS.VERIFIED && (!transitionEvidence.length || !boundedText(input.verificationMethod, 'verificationMethod', 256))) {
      throw error('IDENTITY_VERIFICATION_EVIDENCE_REQUIRED', '身份验证必须提供证据和明确验证方法。', 409, { identityLinkId });
    }
    const operation = nextStatus === LINK_STATUS.SUGGESTED ? 'suggest' : nextStatus === LINK_STATUS.VERIFIED ? 'verify' : nextStatus === LINK_STATUS.DISPUTED ? 'dispute' : 'detach';
    const result = this.repository.transaction(repo => {
      const before = publicLink(link);
      const detachedConversationBindings = nextStatus === LINK_STATUS.DETACHED
        ? repo.listConversationBindings({ personId: link.person_id, state: 'active', limit: 10000 }).filter(row => clean(row.platform) === clean(link.platform) && clean(row.account_id) === clean(link.source_account_id) && clean(row.external_id) === clean(link.external_id))
        : [];
      const remainingUsableIdentityLinks = nextStatus === LINK_STATUS.DETACHED
        ? repo.listIdentityLinks(link.person_id, { includeDetached: true }).filter(row =>
          clean(row.identity_link_id) !== identityLinkId
          && ![LINK_STATUS.DETACHED, LINK_STATUS.DISPUTED].includes(clean(row.link_status))
        )
        : [];
      const detachedPersonContactBindings = nextStatus === LINK_STATUS.DETACHED && !remainingUsableIdentityLinks.length
        ? repo.listPersonContactBindings({ personId: link.person_id, state: 'active', limit: 10000 })
        : [];
      const updated = repo.updateIdentityLink(identityLinkId, {
        linkStatus: nextStatus,
        confidence: confidence(input.confidence, Number(link.confidence || 0)),
        verificationMethod: nextStatus === LINK_STATUS.VERIFIED ? (boundedText(input.verificationMethod, 'verificationMethod', 256) || 'manual-confirmation') : link.verification_method,
        evidenceRefs: evidenceRefs([...(link.evidence_refs || []), ...transitionEvidence]),
        createdBy: actor,
        payload: { ...sanitizeIdentityObject(link.payload || {}, 'storedIdentityLinkPayload'), ...sanitizeIdentityObject(input.payload || {}, 'identityTransitionPayload') },
        updatedAt: operationAt
      });
      for (const binding of detachedConversationBindings) repo.updateConversationBinding(link.person_id, binding.conversation_id, { state: 'detached', source: 'identity-link-detach', updatedAt: operationAt });
      for (const binding of detachedPersonContactBindings) repo.updatePersonContactBinding(link.person_id, binding.contact_id, { state: 'detached', source: 'identity-link-detach', updatedAt: operationAt });
      const auditId = `identity-audit-${crypto.randomUUID()}`;
      repo.insertIdentityAudit({
        auditId, operation, workspaceId: link.workspace_id, sourcePersonId: link.person_id, targetPersonId: link.person_id,
        identityLinkId, before, after: publicLink(updated), evidenceRefs: transitionEvidence,
        rollbackPlan: {
          operation: 'restore-link', identityLinkId, beforeLink: before, expectedAfterLink: publicLink(updated),
          personContactBindings: detachedPersonContactBindings, conversationBindings: detachedConversationBindings
        },
        reason, actor, createdAt: operationAt
      });
      repo.insertIdentityOperationReceipt({ receiptId: `identity-receipt-${crypto.randomUUID()}`, auditId, operation, status: 'applied', before: { link: before }, after: { link: publicLink(updated) }, actor, reason, createdAt: operationAt });
      return {
        authority: AUTHORITY, auditId, operation, link: publicLink(updated), rollbackAvailable: true,
        pendingDomainEvent: {
          eventType: 'identity.link.transitioned', auditId, workspaceId: link.workspace_id,
          platform: link.platform, sourceAccountId: link.source_account_id,
          targetRefs: [{ table: 'identity_links', id: identityLinkId }, { table: 'identity_link_audit', id: auditId }]
        }
      };
    });
    return this.finalizeOperation(result);
  }

  suggest(identityLinkId, input = {}) { return this.transition(identityLinkId, LINK_STATUS.SUGGESTED, input); }
  verify(identityLinkId, input = {}) { return this.transition(identityLinkId, LINK_STATUS.VERIFIED, input); }
  dispute(identityLinkId, input = {}) { return this.transition(identityLinkId, LINK_STATUS.DISPUTED, input); }
  detach(identityLinkId, input = {}) { return this.transition(identityLinkId, LINK_STATUS.DETACHED, input); }

  merge(input = {}) {
    input = normalizeIdentityInput(input, 'identityMerge');
    const sourcePersonId = boundedText(input.sourcePersonId, 'sourcePersonId', 1024);
    const targetPersonId = boundedText(input.targetPersonId, 'targetPersonId', 1024);
    if (!sourcePersonId || !targetPersonId || sourcePersonId === targetPersonId) throw error('IDENTITY_MERGE_INVALID', '身份合并必须指定两个不同的 Person。', 400);
    const source = this.repository.getPerson(sourcePersonId);
    const target = this.repository.getPerson(targetPersonId);
    if (!source || !target) throw error('IDENTITY_PERSON_NOT_FOUND', '待合并的 Person 不存在。', 404);
    if (clean(source.state) !== 'active' || clean(target.state) !== 'active') throw error('IDENTITY_PERSON_NOT_ACTIVE', '只能合并当前有效且未被合并的 Person。', 409, { sourceState: clean(source.state), targetState: clean(target.state) });
    if (source.workspace_id !== target.workspace_id) throw error('IDENTITY_WORKSPACE_MISMATCH', '不能跨工作区合并客户身份。', 409);
    const mergeEvidenceRefs = evidenceRefs(input.evidenceRefs);
    if (!mergeEvidenceRefs.length) throw error('IDENTITY_MERGE_EVIDENCE_REQUIRED', '身份合并必须提供可审计证据；任何内部或强制路径都不得绕过。', 409);
    const actor = boundedText(input.actor, 'actor', 256);
    const reason = boundedText(input.reason, 'reason', 2000);
    if (!actor || !reason) throw error('IDENTITY_MERGE_AUDIT_REQUIRED', '身份合并必须记录操作者和原因。', 409);
    const links = this.repository.listIdentityLinks(sourcePersonId, { includeDetached: true });
    const operationAt = timestamp(input.at);
    const auditId = `identity-audit-${crypto.randomUUID()}`;
    const before = { sourcePerson: publicPerson(source), targetPerson: publicPerson(target), links: links.map(publicLink) };
    const result = this.repository.transaction(repo => {
      for (const link of links) repo.updateIdentityLink(link.identity_link_id, {
        personId: targetPersonId,
        linkStatus: link.link_status === LINK_STATUS.DETACHED ? LINK_STATUS.DETACHED : LINK_STATUS.MERGED,
        evidenceRefs: evidenceRefs([...(link.evidence_refs || []), ...mergeEvidenceRefs]),
        supersededBy: targetPersonId,
        updatedAt: operationAt
      });
      const movedAnchors = repo.movePersonAnchors({ sourcePersonId, targetPersonId, auditId, updatedAt: operationAt });
      repo.updatePerson(sourcePersonId, { state: 'merged', payload: { ...sanitizeIdentityObject(source.payload || {}, 'storedPersonPayload'), mergedIntoPersonId: targetPersonId, mergeAuditId: auditId }, updatedAt: operationAt });
      const afterLinks = repo.listIdentityLinks(targetPersonId, { includeDetached: true }).filter(row => links.some(item => item.identity_link_id === row.identity_link_id));
      const rollbackPlan = {
        operation: 'split-merge', auditId, sourcePersonId, targetPersonId,
        sourcePersonState: source.state,
        sourcePersonPayload: sanitizeIdentityObject(source.payload || {}, 'rollbackSourcePersonPayload'),
        links: links.map(link => ({ identityLinkId: link.identity_link_id, personId: sourcePersonId, linkStatus: link.link_status, supersededBy: link.superseded_by })),
        contactIds: movedAnchors.contactIds,
        conversationIds: movedAnchors.conversationIds,
        relationshipLearningProfiles: movedAnchors.relationshipLearningProfiles || [],
        relationshipLearningSignals: movedAnchors.relationshipLearningSignals || []
      };
      const mergeAfter = { sourcePerson: publicPerson(repo.getPerson(sourcePersonId)), targetPerson: publicPerson(repo.getPerson(targetPersonId)), links: afterLinks.map(publicLink), contactIds: movedAnchors.contactIds, conversationIds: movedAnchors.conversationIds };
      repo.insertIdentityAudit({
        auditId, operation: 'merge', workspaceId: source.workspace_id, sourcePersonId, targetPersonId,
        before, after: mergeAfter, evidenceRefs: mergeEvidenceRefs, rollbackPlan, reason, actor, createdAt: operationAt
      });
      repo.insertIdentityOperationReceipt({ receiptId: `identity-receipt-${crypto.randomUUID()}`, auditId, operation: 'merge', status: 'applied', before, after: mergeAfter, actor, reason, createdAt: operationAt });
      return {
        authority: AUTHORITY, auditId, sourcePerson: publicPerson(repo.getPerson(sourcePersonId)),
        targetPerson: publicPerson(repo.getPerson(targetPersonId)), movedLinks: afterLinks.map(publicLink), movedAnchors, rollbackAvailable: true,
        pendingDomainEvent: {
          eventType: 'identity.person.merged', auditId, workspaceId: source.workspace_id,
          platform: links[0]?.platform || 'identity', sourceAccountId: links[0]?.source_account_id || source.workspace_id,
          targetRefs: [{ table: 'persons', id: sourcePersonId }, { table: 'persons', id: targetPersonId }, { table: 'identity_link_audit', id: auditId }]
        }
      };
    });
    return this.finalizeOperation(result);
  }

  rollbackMerge(auditId, input = {}) {
    input = normalizeIdentityInput(input, 'identityMergeRollback');
    auditId = boundedText(auditId, 'auditId', 1024);
    const audit = this.repository.getIdentityAudit(auditId);
    if (!audit || audit.operation !== 'merge') throw error('IDENTITY_MERGE_AUDIT_NOT_FOUND', '找不到可回滚的身份合并审计。', 404);
    const plan = audit.rollback_plan || {};
    if (plan.operation !== 'split-merge' || !Array.isArray(plan.links)) throw error('IDENTITY_ROLLBACK_PLAN_INVALID', '身份合并没有有效的拆分计划。', 409);
    const actor = boundedText(input.actor, 'actor', 256);
    const reason = boundedText(input.reason, 'reason', 2000);
    if (!actor || !reason) throw error('IDENTITY_ROLLBACK_AUDIT_REQUIRED', '身份合并回滚必须记录操作者和原因。', 409);
    const operationAt = timestamp(input.at);
    const rollbackAuditId = `identity-audit-${crypto.randomUUID()}`;
    const result = this.repository.transaction(repo => {
      const currentRows = plan.links.map(item => ({ plan: item, row: repo.getIdentityLink(item.identityLinkId) }));
      const missing = currentRows.filter(item => !item.row).map(item => item.plan.identityLinkId);
      if (missing.length) throw error('IDENTITY_ROLLBACK_CONFLICT', '身份合并后有链接已被删除，不能静默覆盖后续变更。', 409, { missing });
      const conflicts = currentRows.filter(item => {
        const row = item.row;
        const expectedStatus = clean(item.plan.linkStatus) === LINK_STATUS.DETACHED ? LINK_STATUS.DETACHED : LINK_STATUS.MERGED;
        return clean(row.person_id) !== clean(plan.targetPersonId)
          || clean(row.link_status) !== expectedStatus
          || clean(row.superseded_by) !== clean(plan.targetPersonId);
      }).map(item => ({
        identityLinkId: item.plan.identityLinkId,
        personId: clean(item.row.person_id),
        linkStatus: clean(item.row.link_status),
        supersededBy: clean(item.row.superseded_by)
      }));
      if (conflicts.length) throw error('IDENTITY_ROLLBACK_CONFLICT', '身份合并后链接已经发生新的变更，必须先人工处理冲突。', 409, { conflicts });
      const sourceNow = repo.getPerson(plan.sourcePersonId);
      if (!sourceNow || clean(sourceNow.state) !== 'merged' || clean(sourceNow.payload?.mergeAuditId) !== clean(auditId)) {
        throw error('IDENTITY_ROLLBACK_CONFLICT', '源 Person 的合并状态已经变化，不能应用过期回滚计划。', 409, { sourcePersonId: plan.sourcePersonId });
      }
      const beforeLinks = currentRows.map(item => publicLink(item.row));
      for (const item of plan.links) repo.updateIdentityLink(item.identityLinkId, {
        personId: item.personId, linkStatus: item.linkStatus, supersededBy: item.supersededBy || '', updatedAt: operationAt
      });
      const restoredAnchors = repo.rollbackPersonAnchors({
        sourcePersonId: plan.sourcePersonId, targetPersonId: plan.targetPersonId, auditId, updatedAt: operationAt,
        relationshipLearningProfiles: plan.relationshipLearningProfiles || [],
        relationshipLearningSignals: plan.relationshipLearningSignals || []
      });
      repo.updatePerson(plan.sourcePersonId, { state: plan.sourcePersonState || 'active', payload: sanitizeIdentityObject(plan.sourcePersonPayload || {}, 'rollbackSourcePersonPayload'), updatedAt: operationAt });
      const afterLinks = plan.links.map(item => repo.getIdentityLink(item.identityLinkId)).filter(Boolean).map(publicLink);
      const rollbackAfter = { links: afterLinks, sourcePerson: publicPerson(repo.getPerson(plan.sourcePersonId)), restoredAnchors };
      repo.insertIdentityAudit({
        auditId: rollbackAuditId, operation: 'rollback', workspaceId: audit.workspace_id,
        sourcePersonId: plan.sourcePersonId, targetPersonId: plan.targetPersonId,
        before: { mergeAuditId: auditId, links: beforeLinks }, after: rollbackAfter,
        evidenceRefs: evidenceRefs(input.evidenceRefs), rollbackPlan: { operation: 'reapply-merge', mergeAuditId: auditId },
        reason, actor, createdAt: operationAt
      });
      repo.insertIdentityOperationReceipt({ receiptId: `identity-receipt-${crypto.randomUUID()}`, auditId, operation: 'merge', status: 'rolled-back', before: { links: beforeLinks }, after: rollbackAfter, actor, reason, createdAt: operationAt });
      return {
        authority: AUTHORITY, rollbackAuditId, mergeAuditId: auditId, restoredLinks: afterLinks, restoredAnchors,
        sourcePerson: publicPerson(repo.getPerson(plan.sourcePersonId)),
        pendingDomainEvent: {
          eventType: 'identity.operation.rolled_back', auditId: rollbackAuditId, workspaceId: audit.workspace_id,
          platform: afterLinks[0]?.platform || 'identity', sourceAccountId: afterLinks[0]?.sourceAccountId || audit.workspace_id,
          targetRefs: [{ table: 'identity_link_audit', id: rollbackAuditId }]
        }
      };
    });
    return this.finalizeOperation(result);
  }

  rollbackAudit(auditId, input = {}) {
    input = normalizeIdentityInput(input, 'identityOperationRollback');
    auditId = boundedText(auditId, 'auditId', 1024);
    const audit = this.repository.getIdentityAudit(auditId);
    if (!audit) throw error('IDENTITY_AUDIT_NOT_FOUND', '身份审计不存在。', 404, { auditId });
    if (audit.operation === 'merge') return this.rollbackMerge(auditId, input);
    if (!['suggest','verify','dispute','detach'].includes(clean(audit.operation))) throw error('IDENTITY_AUDIT_NOT_ROLLBACKABLE', '该身份审计不支持通用回滚。', 409, { operation: audit.operation });
    if (this.repository.listIdentityOperationReceipts({ auditId, status: 'rolled-back', limit: 1 }).length) throw error('IDENTITY_AUDIT_ALREADY_ROLLED_BACK', '该身份操作已经回滚。', 409, { auditId });
    const plan = audit.rollback_plan || {};
    const before = plan.beforeLink || audit.before;
    const expectedAfter = plan.expectedAfterLink || audit.after;
    const identityLinkId = boundedText(plan.identityLinkId || audit.identity_link_id, 'identityLinkId', 1024);
    const current = this.repository.getIdentityLink(identityLinkId);
    if (!current) throw error('IDENTITY_ROLLBACK_CONFLICT', '身份链接已不存在，不能静默回滚。', 409, { identityLinkId });
    const currentPublic = publicLink(current);
    const comparisonKeys = ['personId','linkStatus','confidence','verificationMethod','supersededBy'];
    const conflicts = comparisonKeys.filter(key => JSON.stringify(currentPublic?.[key] ?? '') !== JSON.stringify(expectedAfter?.[key] ?? ''));
    if (conflicts.length) throw error('IDENTITY_ROLLBACK_CONFLICT', '身份状态在原操作后已发生变化，不能覆盖后续操作。', 409, { identityLinkId, conflicts });
    const actor = boundedText(input.actor, 'actor', 256);
    const reason = boundedText(input.reason, 'reason', 2000);
    if (!actor || !reason) throw error('IDENTITY_ROLLBACK_AUDIT_REQUIRED', '身份回滚必须记录操作者和原因。', 409);
    const operationAt = timestamp(input.at);
    const rollbackAuditId = `identity-audit-${crypto.randomUUID()}`;
    const result = this.repository.transaction(repo => {
      const restored = repo.updateIdentityLink(identityLinkId, {
        personId: before.personId, linkStatus: before.linkStatus, confidence: before.confidence,
        verificationMethod: before.verificationMethod, evidenceRefs: before.evidenceRefs || [], createdBy: before.createdBy,
        supersededBy: before.supersededBy || '', payload: before.payload || {}, updatedAt: operationAt
      });
      const restoredContactBindings = [];
      for (const binding of Array.isArray(plan.personContactBindings) ? plan.personContactBindings : []) {
        const currentBinding = repo.listPersonContactBindings({ personId: clean(before.personId), contactId: clean(binding.contact_id), limit: 10 }).find(row => clean(row.contact_id) === clean(binding.contact_id));
        if (!currentBinding || clean(currentBinding.state) !== 'detached') throw error('IDENTITY_ROLLBACK_CONFLICT', '身份解除后的联系人绑定已发生变化，不能静默覆盖。', 409, { contactId: clean(binding.contact_id) });
        restoredContactBindings.push(repo.updatePersonContactBinding(clean(before.personId), clean(binding.contact_id), { state: clean(binding.state) || 'active', source: 'identity-rollback', updatedAt: operationAt }));
      }
      const restoredBindings = [];
      for (const binding of Array.isArray(plan.conversationBindings) ? plan.conversationBindings : []) {
        const currentBinding = repo.listConversationBindings({ personId: clean(before.personId), conversationId: clean(binding.conversation_id), limit: 10 }).find(row => clean(row.conversation_id) === clean(binding.conversation_id));
        if (!currentBinding || clean(currentBinding.state) !== 'detached') throw error('IDENTITY_ROLLBACK_CONFLICT', '身份解除后的会话绑定已发生变化，不能静默覆盖。', 409, { conversationId: clean(binding.conversation_id) });
        restoredBindings.push(repo.updateConversationBinding(clean(before.personId), clean(binding.conversation_id), { state: clean(binding.state) || 'active', source: 'identity-rollback', updatedAt: operationAt }));
      }
      const after = publicLink(restored);
      repo.insertIdentityAudit({
        auditId: rollbackAuditId, operation: 'rollback', workspaceId: audit.workspace_id,
        sourcePersonId: clean(before.personId), targetPersonId: clean(before.personId), identityLinkId,
        before: { originalAuditId: auditId, link: currentPublic }, after: { link: after, personContactBindings: restoredContactBindings, conversationBindings: restoredBindings },
        evidenceRefs: evidenceRefs(input.evidenceRefs), rollbackPlan: { operation: 'reapply-transition', originalAuditId: auditId },
        reason, actor, createdAt: operationAt
      });
      repo.insertIdentityOperationReceipt({ receiptId: `identity-receipt-${crypto.randomUUID()}`, auditId, operation: audit.operation, status: 'rolled-back', before: { link: currentPublic }, after: { link: after }, actor, reason, createdAt: operationAt });
      return {
        authority: AUTHORITY, auditId, rollbackAuditId, operation: audit.operation, link: after,
        pendingDomainEvent: {
          eventType: 'identity.operation.rolled_back', auditId: rollbackAuditId, workspaceId: audit.workspace_id,
          platform: after.platform || 'identity', sourceAccountId: after.sourceAccountId || audit.workspace_id,
          targetRefs: [{ table: 'identity_links', id: identityLinkId }, { table: 'identity_link_audit', id: rollbackAuditId }]
        }
      };
    });
    return this.finalizeOperation(result);
  }

  resolve(scope = {}) {
    const safeScope = canonicalExternalIdentityScope(scope);
    const link = this.repository.getIdentityLinkByScope(safeScope);
    return link ? { authority: AUTHORITY, person: publicPerson(this.repository.getPerson(link.person_id)), link: publicLink(link) } : null;
  }
}

const singleton = new IdentityAuthority();
module.exports = {
  AUTHORITY,
  SCHEMA_VERSION,
  LINK_STATUS,
  IdentityAuthority,
  IdentityLinkAuthority: IdentityAuthority,
  singleton,
  normalizeIdentityInput,
  validateScope,
  canonicalExternalIdentityScope,
  canonicalPersonId,
  canonicalIdentityLinkId,
  sanitizeIdentityObject
};
