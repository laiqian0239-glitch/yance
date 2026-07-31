'use strict';

const crypto = require('crypto');
const { getStore } = require('../repositories/storeProvider');
const externalIdentityAuthority = require('./externalIdentityAuthority').singleton;

function clean(value) { return String(value == null ? '' : value).trim(); }
function routeId(conversationId) { return `route_${crypto.createHash('sha256').update(clean(conversationId)).digest('hex').slice(0,32)}`; }
function parse(value) { try { return JSON.parse(value || '{}') || {}; } catch (_) { return {}; } }
function hashScope(input = {}) {
  return crypto.createHash('sha256').update([
    clean(input.conversationId), clean(input.accountId), clean(input.platform).toLowerCase(), clean(input.routeTarget),
    clean(input.externalIdentityId), clean(input.capabilitySnapshotId)
  ].join('\u001f')).digest('hex');
}
function publicVersion(row) {
  if (!row) return null;
  return {
    routeVersionId: row.route_version_id,
    outboxRouteId: row.outbox_route_id,
    conversationId: row.conversation_id,
    accountId: row.account_id,
    platform: row.platform,
    externalIdentityId: row.external_identity_id || '',
    identityLinkId: row.identity_link_id || '',
    personId: row.person_id || '',
    routeTarget: row.route_target,
    capabilitySnapshotId: row.capability_snapshot_id,
    scopeHash: row.scope_hash,
    state: row.state,
    payload: parse(row.payload_json),
    createdAt: row.created_at
  };
}
function publicRow(row, version = null) {
  if (!row) return null;
  return {
    outboxRouteId:row.outbox_route_id,conversationId:row.conversation_id,accountId:row.account_id,platform:row.platform,
    externalIdentityId:row.external_identity_id||'',identityLinkId:row.identity_link_id||'',personId:row.person_id||'',
    routeTarget:row.route_target,state:row.state,capabilitySnapshotId:row.capability_snapshot_id,payload:parse(row.payload_json),
    createdAt:row.created_at,updatedAt:row.updated_at,
    routeVersionId: version?.routeVersionId || '', scopeHash: version?.scopeHash || '', routeVersion: version
  };
}
class OutboxRouteAuthority {
  constructor(options = {}) { this.storeProvider = options.storeProvider || getStore; this.externalIdentityAuthority = options.externalIdentityAuthority || externalIdentityAuthority; }
  ensure(input = {}, storeOverride = null) {
    const store = storeOverride || this.storeProvider();
    const conversationId = clean(input.conversationId || input.sessionKey);
    const platform = clean(input.platform).toLowerCase();
    const accountId = clean(input.accountId);
    const routeTarget = clean(input.routeTarget || input.chatJid || input.externalId);
    if (!conversationId || !platform || !accountId || !routeTarget) {
      const error = new Error('OutboxRoute scope is incomplete'); error.code='OUTBOX_ROUTE_SCOPE_INCOMPLETE'; error.status=409; throw error;
    }
    const account = store.db.prepare('SELECT id,platform FROM r32_accounts WHERE id=?').get(accountId);
    if (!account) { const error=new Error('OutboxRoute requires a persisted PlatformAccount'); error.code='OUTBOX_ROUTE_ACCOUNT_NOT_FOUND'; error.status=409; throw error; }
    if (clean(account.platform).toLowerCase() !== platform) { const error=new Error('OutboxRoute platform/account mismatch'); error.code='OUTBOX_ROUTE_ACCOUNT_PLATFORM_MISMATCH'; error.status=409; throw error; }
    let conversation = store.db.prepare('SELECT * FROM r32_conversations WHERE session_key=?').get(conversationId);
    const at = new Date().toISOString();
    if (!conversation) {
      store.upsertConversation({ sessionKey:conversationId,accountId,platform,title:clean(input.title)||routeTarget,routeState:'bound',chatJid:routeTarget,externalId:routeTarget,createdAt:at,updatedAt:at });
      conversation = store.db.prepare('SELECT * FROM r32_conversations WHERE session_key=?').get(conversationId);
    }
    if (clean(conversation.account_id) && clean(conversation.account_id) !== accountId) { const error=new Error('Conversation is bound to another account'); error.code='CONVERSATION_ACCOUNT_ROUTE_CONFLICT'; error.status=409; throw error; }
    if (clean(conversation.platform) && clean(conversation.platform).toLowerCase() !== platform) { const error=new Error('Conversation platform route conflict'); error.code='CONVERSATION_PLATFORM_ROUTE_CONFLICT'; error.status=409; throw error; }
    const binding = store.db.prepare("SELECT * FROM conversation_bindings WHERE conversation_id=? AND state='active' ORDER BY updated_at DESC LIMIT 1").get(conversationId);
    if (binding) {
      if (clean(binding.account_id) && clean(binding.account_id) !== accountId) {
        const error = new Error('ConversationBinding account conflicts with outbound route');
        error.code = 'OUTBOX_ROUTE_CONVERSATION_BINDING_ACCOUNT_MISMATCH'; error.status = 409; throw error;
      }
      store.db.prepare(`UPDATE conversation_bindings
        SET platform=?,account_id=?,external_id=?,source='outbox-route-authority',updated_at=?
        WHERE person_id=? AND conversation_id=? AND state='active'`)
        .run(platform, accountId, routeTarget, at, binding.person_id, conversationId);
    }
    let externalIdentityId = clean(binding?.external_identity_id || input.externalIdentityId);
    let identityLinkId = clean(binding?.identity_link_id || input.identityLinkId);
    let personId = clean(binding?.person_id || conversation.person_id || input.personId);
    if (externalIdentityId) {
      const persistedExternal = store.db.prepare('SELECT identity_link_id,person_id,account_id,platform,external_id FROM external_identities WHERE external_identity_id=?').get(externalIdentityId);
      if (!persistedExternal) { const error=new Error('ConversationBinding references a missing ExternalIdentity'); error.code='OUTBOX_ROUTE_EXTERNAL_IDENTITY_NOT_FOUND'; error.status=409; throw error; }
      if (clean(persistedExternal.account_id) !== accountId || clean(persistedExternal.platform).toLowerCase() !== platform) {
        const error=new Error('ExternalIdentity route scope mismatch'); error.code='OUTBOX_ROUTE_EXTERNAL_IDENTITY_SCOPE_MISMATCH'; error.status=409; throw error;
      }
      identityLinkId ||= clean(persistedExternal.identity_link_id);
      personId ||= clean(persistedExternal.person_id);
      if (clean(persistedExternal.external_id) && clean(persistedExternal.external_id) !== routeTarget) {
        const error=new Error('ExternalIdentity target conflicts with route target'); error.code='OUTBOX_ROUTE_TARGET_CONFLICT'; error.status=409; throw error;
      }
    }
    if (!externalIdentityId) {
      const external = this.externalIdentityAuthority.upsertWithinTransaction({
        workspaceId:'default', platform, accountId, externalId:routeTarget, personId, identityLinkId,
        conversationId, state:'active', payload:{ source:'outbox-route-authority' }
      }, store);
      externalIdentityId = clean(external.externalIdentityId);
      identityLinkId ||= clean(external.identityLinkId);
      personId ||= clean(external.personId);
    }
    const id = routeId(conversationId);
    const capabilitySnapshotId = clean(input.capabilitySnapshotId);
    const scopeHash = hashScope({ conversationId,accountId,platform,routeTarget,externalIdentityId,capabilitySnapshotId });
    const versionId = `routev_${scopeHash.slice(0,32)}`;
    store.db.prepare(`INSERT INTO outbox_routes(outbox_route_id,conversation_id,account_id,platform,external_identity_id,identity_link_id,person_id,route_target,state,capability_snapshot_id,payload_json,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(conversation_id) DO UPDATE SET account_id=excluded.account_id,platform=excluded.platform,
      external_identity_id=excluded.external_identity_id,identity_link_id=excluded.identity_link_id,person_id=excluded.person_id,route_target=excluded.route_target,
      state=excluded.state,capability_snapshot_id=excluded.capability_snapshot_id,payload_json=excluded.payload_json,updated_at=excluded.updated_at`)
      .run(id,conversationId,accountId,platform,externalIdentityId||null,identityLinkId||null,personId||null,routeTarget,'active',capabilitySnapshotId,JSON.stringify({source:clean(input.source)||'outbox-route-authority',scopeHash}),at,at);
    store.db.prepare(`INSERT INTO outbox_route_versions(route_version_id,outbox_route_id,conversation_id,account_id,platform,external_identity_id,identity_link_id,person_id,
      route_target,capability_snapshot_id,scope_hash,state,payload_json,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(scope_hash) DO NOTHING`)
      .run(versionId,id,conversationId,accountId,platform,externalIdentityId||'',identityLinkId||'',personId||'',routeTarget,capabilitySnapshotId,scopeHash,'active',JSON.stringify({source:clean(input.source)||'outbox-route-authority'}),at);
    store.db.prepare('UPDATE r32_conversations SET account_id=?,platform=?,route_state=?,updated_at=? WHERE session_key=?').run(accountId,platform,'bound',at,conversationId);
    const version = publicVersion(store.db.prepare('SELECT * FROM outbox_route_versions WHERE scope_hash=?').get(scopeHash));
    return publicRow(store.db.prepare('SELECT * FROM outbox_routes WHERE outbox_route_id=?').get(id), version);
  }
  getByConversation(conversationId, storeOverride = null) {
    const store = storeOverride || this.storeProvider();
    const row = store.db.prepare('SELECT * FROM outbox_routes WHERE conversation_id=?').get(clean(conversationId));
    if (!row) return null;
    const version = publicVersion(store.db.prepare(`SELECT * FROM outbox_route_versions WHERE outbox_route_id=? ORDER BY created_at DESC LIMIT 1`).get(row.outbox_route_id));
    return publicRow(row, version);
  }
  getVersion(routeVersionId, storeOverride = null) {
    const store = storeOverride || this.storeProvider();
    return publicVersion(store.db.prepare('SELECT * FROM outbox_route_versions WHERE route_version_id=?').get(clean(routeVersionId)));
  }
  assertCommand(command = {}, storeOverride = null, routeVersionId = '') {
    const store = storeOverride || this.storeProvider();
    const version = clean(routeVersionId) ? this.getVersion(routeVersionId, store) : null;
    const route = version ? { ...version, outboxRouteId: version.outboxRouteId, conversationId: version.conversationId } : this.getByConversation(command.sessionKey, store);
    if (!route) { const error=new Error('Persisted OutboxRoute is required'); error.code='EGRESS_OUTBOX_ROUTE_REQUIRED'; error.status=409; throw error; }
    const expectedTarget = clean(command.conversationTarget || command.chatJid);
    const mismatches = [];
    if (clean(route.accountId) !== clean(command.accountId)) mismatches.push('accountId');
    if (clean(route.platform).toLowerCase() !== clean(command.platform).toLowerCase()) mismatches.push('platform');
    if (clean(route.conversationId) !== clean(command.sessionKey)) mismatches.push('conversationId');
    if (clean(route.routeTarget) !== expectedTarget) mismatches.push('routeTarget');
    if (clean(route.capabilitySnapshotId) !== clean(command.capabilitySnapshotId)) mismatches.push('capabilitySnapshotId');
    if (mismatches.length) { const error=new Error('OutboxRoute does not match frozen command'); error.code='EGRESS_OUTBOX_ROUTE_SCOPE_MISMATCH'; error.status=409; error.mismatches=mismatches; throw error; }
    if (route.state !== 'active') { const error=new Error('OutboxRoute is not active'); error.code='OUTBOX_ROUTE_NOT_ACTIVE'; error.status=409; throw error; }
    return route;
  }
}
const singleton = new OutboxRouteAuthority();
module.exports = { OutboxRouteAuthority, singleton, hashScope };
