'use strict';

const workspaceRepository = require('../repositories/workspaceRepository');
const personContextAuthority = require('./personContextAuthority').singleton;
const { ReplyFeedbackRepository } = require('../repositories/replyFeedbackRepository');

const AUTHORITY = 'PersonFeedbackMutationAuthority';
function clean(value) { return String(value == null ? '' : value).trim(); }
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value ?? null);
}
function personScopeForContact(reference, options = {}) {
  const workspace = options.workspaceRepository || workspaceRepository;
  const authority = options.personContextAuthority || personContextAuthority;
  const requested = clean(reference);
  const resolved = workspace.resolveContactReference(requested);
  const contactId = clean(resolved?.contact?.id || requested);
  const person = authority.snapshot({ contactId });
  return {
    authority: AUTHORITY,
    contactId,
    personId: person.found ? clean(person.personId) : '',
    contactIds: person.found ? [...new Set(person.contactIds.map(clean).filter(Boolean))] : [contactId]
  };
}
function selectPersonFeedbackVersion(scope, sourceVersion, requestedSourceContactId = '', repository = new ReplyFeedbackRepository()) {
  const requested = clean(requestedSourceContactId);
  if (requested && !scope.contactIds.includes(requested)) {
    const error = new Error('指定的学习版本来源联系人不属于当前 Person');
    error.code = 'PERSON_REPLY_FEEDBACK_SOURCE_CONTACT_INVALID';
    error.status = 409;
    throw error;
  }
  const candidates = (requested ? [requested] : scope.contactIds)
    .map(contactId => ({ contactId, version: repository.getVersion('contact', contactId, sourceVersion) }))
    .filter(row => row.version);
  if (!candidates.length) {
    const error = new Error('指定的回复学习版本不存在');
    error.code = 'REPLY_FEEDBACK_VERSION_NOT_FOUND';
    error.status = 404;
    throw error;
  }
  if (!requested && new Set(candidates.map(row => stableJson(row.version.profile))).size > 1) {
    const error = new Error('同一 Person 的多个平台身份存在同号但内容不同的学习版本，必须指定 sourceContactId');
    error.code = 'PERSON_REPLY_FEEDBACK_VERSION_AMBIGUOUS';
    error.status = 409;
    error.candidates = candidates.map(row => ({ contactId: row.contactId, version: row.version.version, createdAt: row.version.createdAt }));
    throw error;
  }
  return candidates[0];
}
async function restorePersonFeedbackScope(scope, selected, actor, storeManager) {
  const results = [];
  for (const contactId of scope.contactIds) {
    const dispatched = await storeManager.dispatch({
      type: 'AI_REPLY_FEEDBACK_RESTORED',
      source: 'person-feedback-restore-api',
      payload: { contactId, profile: selected.version.profile, sourceVersion: selected.version.version, restoredBy: clean(actor) || 'user' }
    });
    results.push({ contactId, result: dispatched.result });
  }
  return results;
}
module.exports = { AUTHORITY, stableJson, personScopeForContact, selectPersonFeedbackVersion, restorePersonFeedbackScope };
