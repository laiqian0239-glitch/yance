'use strict';

const workspaceRepository = require('../repositories/workspaceRepository');
const personContextAuthority = require('./personContextAuthority').singleton;

const AUTHORITY = 'PersonLearningEvidenceScope';
function clean(value) { return String(value == null ? '' : value).trim(); }
function stableJson(value) {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stableJson(value[key])).join(',') + '}';
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
module.exports = { AUTHORITY, stableJson, personScopeForContact };
