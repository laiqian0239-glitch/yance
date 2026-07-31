'use strict';

const crypto = require('crypto');
const { getStore } = require('../repositories/storeProvider');

function clean(value) { return String(value == null ? '' : value).trim(); }
function idFor(parts) { return `extid_${crypto.createHash('sha256').update(parts.map(clean).join('\u001f')).digest('hex').slice(0,32)}`; }
function resolveAccountId(store, platform, sourceAccountId) {
  const source = clean(sourceAccountId);
  const row = store.db.prepare(`SELECT id FROM r32_accounts WHERE id=? OR (platform=? AND adapter_account_id=?) ORDER BY CASE WHEN id=? THEN 0 ELSE 1 END LIMIT 1`)
    .get(source, clean(platform).toLowerCase(), source, source);
  if (!row?.id) {
    const error = new Error('ExternalIdentity requires a persisted PlatformAccount');
    error.code = 'EXTERNAL_IDENTITY_ACCOUNT_NOT_FOUND';
    error.status = 409;
    throw error;
  }
  return clean(row.id);
}
function publicRow(row) {
  if (!row) return null;
  let payload = {}; try { payload = JSON.parse(row.payload_json || '{}') || {}; } catch (_) {}
  return {
    externalIdentityId: row.external_identity_id,
    workspaceId: row.workspace_id,
    platform: row.platform,
    accountId: row.account_id,
    externalId: row.external_id,
    contactId: row.contact_id || '',
    personId: row.person_id || '',
    identityLinkId: row.identity_link_id || '',
    state: row.state,
    payload,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
class ExternalIdentityAuthority {
  constructor(options = {}) { this.storeProvider = options.storeProvider || getStore; }
  upsertWithinTransaction(input = {}, storeOverride = null) {
    const store = storeOverride || this.storeProvider();
    const workspaceId = clean(input.workspaceId) || 'default';
    const platform = clean(input.platform).toLowerCase();
    const accountId = resolveAccountId(store, platform, input.accountId || input.sourceAccountId);
    const externalId = clean(input.externalId);
    if (!platform || !externalId) {
      const error = new Error('ExternalIdentity scope is incomplete');
      error.code = 'EXTERNAL_IDENTITY_SCOPE_INCOMPLETE';
      throw error;
    }
    const at = clean(input.updatedAt || input.createdAt) || new Date().toISOString();
    const externalIdentityId = clean(input.externalIdentityId) || idFor([workspaceId, platform, accountId, externalId]);
    const contactId = clean(input.contactId) || null;
    const personId = clean(input.personId) || null;
    const identityLinkId = clean(input.identityLinkId) || null;
    store.db.prepare(`INSERT INTO external_identities(
      external_identity_id,workspace_id,platform,account_id,external_id,contact_id,person_id,identity_link_id,state,payload_json,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(workspace_id,platform,account_id,external_id) DO UPDATE SET
      contact_id=COALESCE(excluded.contact_id,external_identities.contact_id),person_id=COALESCE(excluded.person_id,external_identities.person_id),
      identity_link_id=COALESCE(excluded.identity_link_id,external_identities.identity_link_id),state=excluded.state,payload_json=excluded.payload_json,updated_at=excluded.updated_at`)
      .run(externalIdentityId,workspaceId,platform,accountId,externalId,contactId,personId,identityLinkId,clean(input.state)||'active',JSON.stringify(input.payload||{}),clean(input.createdAt)||at,at);
    if (identityLinkId) store.db.prepare('UPDATE identity_links SET external_identity_id=? WHERE identity_link_id=?').run(externalIdentityId, identityLinkId);
    if (input.conversationId && personId) store.db.prepare('UPDATE conversation_bindings SET external_identity_id=?,account_id=? WHERE person_id=? AND conversation_id=?')
      .run(externalIdentityId, accountId, personId, clean(input.conversationId));
    return publicRow(store.db.prepare('SELECT * FROM external_identities WHERE external_identity_id=?').get(externalIdentityId));
  }
  getByScope(input = {}, storeOverride = null) {
    const store = storeOverride || this.storeProvider();
    const accountId = resolveAccountId(store, input.platform, input.accountId || input.sourceAccountId);
    return publicRow(store.db.prepare('SELECT * FROM external_identities WHERE workspace_id=? AND platform=? AND account_id=? AND external_id=?')
      .get(clean(input.workspaceId)||'default',clean(input.platform).toLowerCase(),accountId,clean(input.externalId)));
  }
}
const singleton = new ExternalIdentityAuthority();
module.exports = { ExternalIdentityAuthority, singleton, resolveAccountId };
