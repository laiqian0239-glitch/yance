'use strict';

const crypto = require('crypto');
const { getStore } = require('./storeProvider');
const { parseJson } = require('../lib/r32SqliteStore');
const { ACCOUNT_PLATFORMS } = require('../../shared/constants');

const STATE_NAMESPACE = 'accounts-state';
const STATE_DEFAULTS = Object.freeze({
  schemaVersion: 4,
  defaults: { whatsapp: '', telegram: '', facebook: '' },
  bindings: {},
  audit: [],
  updatedAt: ''
});

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function now() { return new Date().toISOString(); }
function idFor(platform) { return `${platform.slice(0, 2)}-${crypto.randomUUID()}`; }
function defaultAccountKind(platform) { return platform === 'facebook' ? 'page' : platform === 'telegram' ? 'personal' : 'personal-multidevice'; }
function defaultDriverId(platform, accountKind) {
  if (platform === 'facebook') return accountKind === 'personal-identity' ? 'facebook-personal-identity-official' : accountKind === 'personal-messenger' ? 'facebook-personal-messenger-mautrix-meta' : 'facebook-page-official';
  if (platform === 'telegram') return 'telegram-personal-mtproto';
  return 'whatsapp-web-multidevice';
}

function readState(store = getStore()) {
  const value = store.getSetting(STATE_NAMESPACE, 'document', STATE_DEFAULTS) || STATE_DEFAULTS;
  return {
    ...clone(STATE_DEFAULTS),
    ...clone(value),
    defaults: { ...STATE_DEFAULTS.defaults, ...(value.defaults || {}) },
    bindings: { ...(value.bindings || {}) },
    audit: Array.isArray(value.audit) ? value.audit : []
  };
}

function writeState(store, value) {
  value.updatedAt = now();
  store.setSetting(STATE_NAMESPACE, 'document', value);
}

function canonicalBindings(store = getStore()) {
  const rows = store.db.prepare(`
    SELECT session_key,account_id,platform,payload_json,updated_at
    FROM r32_conversations
    WHERE COALESCE(account_id,'')<>'' AND COALESCE(merged_into,'')=''
    ORDER BY updated_at DESC,session_key
  `).all();
  return Object.fromEntries(rows.map(row => {
    const payload = parseJson(row.payload_json, {}) || {};
    return [row.session_key, {
      conversationId: row.session_key,
      accountId: row.account_id,
      platform: row.platform,
      externalConversationId: String(payload.externalConversationId || payload.chatJid || payload.externalId || ''),
      updatedAt: row.updated_at,
      authority: 'r32_conversations',
      compatibilityProjection: false
    }];
  }));
}

function rowToAccount(row) {
  const payload = parseJson(row.payload_json, {}) || {};
  return {
    ...payload,
    id: row.id,
    platform: row.platform,
    adapterAccountId: row.adapter_account_id,
    displayName: row.display_name,
    identityLabel: row.identity_label,
    state: row.state || payload.state || '',
    canSend: row.can_send == null ? payload.canSend : Boolean(row.can_send),
    canReceive: row.can_receive == null ? payload.canReceive : Boolean(row.can_receive),
    canonicalAccountId: row.canonical_account_id || payload.canonicalAccountId || row.id,
    lifecycleState: row.lifecycle_state || payload.lifecycleState || 'active',
    mergedIntoId: row.merged_into_id || payload.mergedIntoId || '',
    tombstonedAt: row.tombstoned_at || payload.tombstonedAt || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function listWithStore(store = getStore(), options = {}) {
  const includeAliases = options.includeAliases === true;
  const where = includeAliases ? '' : `WHERE COALESCE(lifecycle_state,'active') NOT IN ('merged','tombstoned','deleted') AND COALESCE(merged_into_id,'')=''`;
  return store.db.prepare(`
    SELECT id, platform, adapter_account_id, display_name, identity_label, state,
           can_send, can_receive, canonical_account_id, lifecycle_state, merged_into_id, tombstoned_at,
           payload_json, created_at, updated_at
    FROM r32_accounts
    ${where}
    ORDER BY created_at ASC, id ASC
  `).all().map(rowToAccount);
}

function sanitizeAccount(input = {}, existing = {}) {
  const platform = String(input.platform || existing.platform || '').toLowerCase();
  if (!ACCOUNT_PLATFORMS.includes(platform)) {
    throw Object.assign(new Error('不支持的平台'), { code: 'UNSUPPORTED_PLATFORM', status: 400 });
  }
  const id = String(input.id || existing.id || idFor(platform));
  const paused = input.paused == null ? Boolean(existing.paused) : Boolean(input.paused);
  const accountKind = String(input.accountKind || input.metadata?.accountKind || existing.accountKind || existing.metadata?.accountKind || defaultAccountKind(platform)).trim().toLowerCase();
  const driverId = String(input.driverId || input.metadata?.driverId || existing.driverId || existing.metadata?.driverId || defaultDriverId(platform, accountKind)).trim();
  const existingLifecycle = String(existing.lifecycleState || 'active');
  const requestedLifecycle = String(input.lifecycleState || '');
  const lifecycle = requestedLifecycle || (['merged','tombstoned','deleted'].includes(existingLifecycle) ? existingLifecycle : (paused ? 'paused' : 'active'));
  return {
    ...existing,
    id,
    platform,
    adapterAccountId: String(input.adapterAccountId || existing.adapterAccountId || id),
    displayName: String(input.displayName || existing.displayName || `${platform} 账号`).slice(0, 120),
    identityLabel: String(input.identityLabel || existing.identityLabel || '尚未验证').slice(0, 180),
    credentialRef: String(input.credentialRef || existing.credentialRef || `account:${id}`),
    isPrimary: input.isPrimary == null ? Boolean(existing.isPrimary) : Boolean(input.isPrimary),
    isDefaultSend: input.isDefaultSend == null ? Boolean(existing.isDefaultSend) : Boolean(input.isDefaultSend),
    notificationsEnabled: input.notificationsEnabled == null ? existing.notificationsEnabled !== false : Boolean(input.notificationsEnabled),
    autoReconnect: input.autoReconnect == null ? existing.autoReconnect !== false : Boolean(input.autoReconnect),
    paused,
    accountKind,
    driverId,
    metadata: { ...(existing.metadata || {}), ...(input.metadata || {}), accountKind, driverId },
    canonicalAccountId: String(input.canonicalAccountId || existing.canonicalAccountId || id),
    lifecycleState: lifecycle,
    mergedIntoId: String(input.mergedIntoId || existing.mergedIntoId || ''),
    tombstonedAt: String(input.tombstonedAt || existing.tombstonedAt || ''),
    source: String(input.source || existing.source || 'user'),
    createdAt: existing.createdAt || String(input.createdAt || now()),
    updatedAt: now()
  };
}

function addAudit(state, action, detail = {}) {
  state.audit.unshift({ id: crypto.randomUUID(), at: now(), action, detail: clone(detail) });
  state.audit = state.audit.slice(0, 500);
}

function persistAccount(store, account) {
  const persisted = {
    ...account,
    state: account.paused ? 'paused' : ''
  };
  if (Object.prototype.hasOwnProperty.call(account, 'canAttemptSend')) persisted.canSend = account.canAttemptSend;
  else if (!Object.prototype.hasOwnProperty.call(account, 'canSend')) delete persisted.canSend;
  if (!Object.prototype.hasOwnProperty.call(account, 'canReceive')) delete persisted.canReceive;
  store.upsertAccount(persisted);
}

function recordWithinTransaction(store, action, detail = {}) {
  const state = readState(store);
  addAudit(state, action, detail);
  writeState(store, state);
  return state;
}

function read() {
  const store = getStore();
  const state = readState(store);
  const accounts = listWithStore(store);
  return { ...state, bindings: canonicalBindings(store), legacyBindings: state.bindings, accounts };
}

function list() { return listWithStore(); }
function listAll() { return listWithStore(getStore(), { includeAliases: true }); }
function getRaw(id) { return listAll().find(row => row.id === id || row.adapterAccountId === id) || null; }
function get(id) {
  const direct = getRaw(id);
  if (!direct) return null;
  const canonicalId = direct.mergedIntoId || direct.canonicalAccountId;
  if (canonicalId && canonicalId !== direct.id) return listAll().find(row => row.id === canonicalId) || direct;
  return direct;
}

async function create(input) {
  const store = getStore();
  let created;
  await store.transactionAsync(() => {
    const state = readState(store);
    created = sanitizeAccount(input);
    if (store.db.prepare('SELECT 1 FROM r32_accounts WHERE id=?').get(created.id)) {
      throw Object.assign(new Error('账号ID已存在'), { code: 'ACCOUNT_EXISTS', status: 409 });
    }
    persistAccount(store, created);
    if (created.lifecycleState !== 'pending-auth' && (created.isPrimary || !state.defaults[created.platform])) state.defaults[created.platform] = created.id;
    addAudit(state, 'account-created', { accountId: created.id, platform: created.platform, displayName: created.displayName });
    writeState(store, state);
  });
  return clone(created);
}

async function update(id, patch) {
  const store = getStore();
  let updated;
  await store.transactionAsync(() => {
    const state = readState(store);
    const before = listWithStore(store).find(row => row.id === id);
    if (!before) throw Object.assign(new Error('账号不存在'), { code: 'ACCOUNT_NOT_FOUND', status: 404 });
    updated = sanitizeAccount({ ...patch, id, platform: before.platform }, before);
    persistAccount(store, updated);
    addAudit(state, 'account-updated', { accountId: id, fields: Object.keys(patch || {}).filter(key => key !== 'credential') });
    writeState(store, state);
  });
  return clone(updated);
}

async function promoteAuthorizationTx(id, patch = {}) {
  const store = getStore();
  let updated;
  await store.transactionAsync(() => {
    const state = readState(store);
    const before = listWithStore(store).find(row => row.id === id);
    if (!before) throw Object.assign(new Error('账号不存在'), { code: 'ACCOUNT_NOT_FOUND', status: 404 });
    updated = sanitizeAccount({
      ...patch,
      id,
      platform: before.platform,
      lifecycleState: 'active',
      paused: false,
      autoReconnect: patch.autoReconnect !== false,
      metadata: { ...(before.metadata || {}), ...(patch.metadata || {}), authorizationPending: false }
    }, before);
    persistAccount(store, updated);
    if (!state.defaults[updated.platform]) state.defaults[updated.platform] = updated.id;
    addAudit(state, 'account-authorization-promoted', {
      accountId: updated.id,
      platform: updated.platform,
      state: String(patch.authorizationResultState || patch.metadata?.authorizationResultState || '')
    });
    writeState(store, state);
  });
  return clone(updated);
}

async function commitConnectedIdentityTx(id, patch = {}, detail = {}) {
  const store = getStore();
  let updated;
  await store.transactionAsync(() => {
    const state = readState(store);
    const before = listWithStore(store, { includeAliases: true }).find(row => row.id === id);
    if (!before) throw Object.assign(new Error('账号不存在'), { code: 'ACCOUNT_NOT_FOUND', status: 404 });
    const authorizationPending = before.lifecycleState === 'pending-auth' || before.metadata?.authorizationPending === true;
    updated = sanitizeAccount({
      ...patch,
      id,
      platform: before.platform,
      ...(authorizationPending ? { lifecycleState: 'active', paused: false, autoReconnect: true } : {}),
      metadata: {
        ...(before.metadata || {}),
        ...(patch.metadata || {}),
        lastConnectOperationId: String(detail.operationId || before.metadata?.lastConnectOperationId || ''),
        lastConnectResultState: String(detail.resultState || ''),
        lastConnectCommittedAt: now(),
        ...(authorizationPending ? {
          authorizationPending: false,
          authorizationCompletedAt: patch.metadata?.authorizationCompletedAt || now(),
          authorizationResultState: String(detail.resultState || patch.metadata?.authorizationResultState || '')
        } : {})
      }
    }, before);
    persistAccount(store, updated);
    if (authorizationPending && !state.defaults[updated.platform]) state.defaults[updated.platform] = updated.id;
    if (authorizationPending) addAudit(state, 'account-authorization-promoted', {
      accountId: updated.id,
      platform: updated.platform,
      state: String(detail.resultState || '')
    });
    addAudit(state, 'account-connect', {
      accountId: updated.id,
      platform: updated.platform,
      resultState: String(detail.resultState || ''),
      attemptId: String(detail.attemptId || ''),
      connectionStartedAt: String(detail.connectionStartedAt || ''),
      recovered: detail.recovered === true
    });
    writeState(store, state);
  });
  return clone(updated);
}

async function commitLifecycleTx(id, patch = {}, audit = {}) {
  const store = getStore();
  let updated;
  await store.transactionAsync(() => {
    const state = readState(store);
    const before = listWithStore(store, { includeAliases: true }).find(row => row.id === id);
    if (!before) throw Object.assign(new Error('账号不存在'), { code: 'ACCOUNT_NOT_FOUND', status: 404 });
    updated = sanitizeAccount({ ...patch, id, platform: before.platform, metadata: { ...(before.metadata || {}), ...(patch.metadata || {}) } }, before);
    persistAccount(store, updated);
    if (audit.action) addAudit(state, String(audit.action), { accountId: id, platform: before.platform, ...(audit.detail || {}) });
    writeState(store, state);
  });
  return clone(updated);
}

async function tombstone(id, detail = {}) {
  const store = getStore();
  let removed;
  await store.transactionAsync(() => {
    const state = readState(store);
    const before = listWithStore(store, { includeAliases: true }).find(row => row.id === id);
    if (!before) throw Object.assign(new Error('账号不存在'), { code: 'ACCOUNT_NOT_FOUND', status: 404 });
    removed = sanitizeAccount({
      id,
      platform: before.platform,
      paused: true,
      lifecycleState: 'tombstoned',
      tombstonedAt: now(),
      autoReconnect: false,
      metadata: { ...(before.metadata || {}), removalReason: String(detail.reason || 'user-remove'), removalPendingCleanup: detail.pendingCleanup === true }
    }, before);
    persistAccount(store, removed);
    for (const platform of Object.keys(state.defaults)) {
      if (state.defaults[platform] === id) state.defaults[platform] = listWithStore(store).find(row => row.platform === platform && row.id !== id && row.lifecycleState !== 'tombstoned')?.id || '';
    }
    addAudit(state, 'account-tombstoned', { accountId: id, platform: before.platform, reason: String(detail.reason || 'user-remove') });
    writeState(store, state);
  });
  return clone(removed);
}

async function remove(id) {
  const store = getStore();
  let removed;
  await store.transactionAsync(() => {
    const state = readState(store);
    removed = listWithStore(store).find(row => row.id === id);
    if (!removed) throw Object.assign(new Error('账号不存在'), { code: 'ACCOUNT_NOT_FOUND', status: 404 });
    store.db.prepare('DELETE FROM r32_accounts WHERE id=?').run(id);
    for (const platform of Object.keys(state.defaults)) {
      if (state.defaults[platform] === id) state.defaults[platform] = listWithStore(store).find(row => row.platform === platform)?.id || '';
    }
    for (const key of Object.keys(state.bindings)) if (state.bindings[key]?.accountId === id) delete state.bindings[key];
    addAudit(state, 'account-removed', { accountId: id, platform: removed.platform, displayName: removed.displayName });
    writeState(store, state);
  });
  return clone(removed);
}

async function setDefault(platform, id) {
  const store = getStore();
  await store.transactionAsync(() => {
    const accounts = listWithStore(store);
    const account = accounts.find(row => row.id === id);
    if (!account || account.platform !== platform) {
      throw Object.assign(new Error('默认账号与平台不匹配'), { code: 'INVALID_DEFAULT_ACCOUNT', status: 400 });
    }
    const state = readState(store);
    state.defaults[platform] = id;
    for (const row of accounts.filter(row => row.platform === platform)) {
      persistAccount(store, { ...row, isDefaultSend: row.id === id, updatedAt: now() });
    }
    addAudit(state, 'default-send-changed', { platform, accountId: id });
    writeState(store, state);
  });
  return get(id);
}

async function bindConversation(conversationId, accountId, platform, externalConversationId = '') {
  const store = getStore();
  let binding;
  await store.transactionAsync(() => {
    const normalizedConversationId = String(conversationId || '').trim();
    const normalizedAccountId = String(accountId || '').trim();
    const normalizedPlatform = String(platform || '').trim().toLowerCase();
    if (!normalizedConversationId || !normalizedAccountId || !normalizedPlatform) {
      throw Object.assign(new Error('会话绑定缺少会话、账号或平台。'), { code: 'CONVERSATION_BINDING_SCOPE_INCOMPLETE', status: 400 });
    }
    const account = listWithStore(store, { includeAliases: true }).find(row => row.id === normalizedAccountId || row.adapterAccountId === normalizedAccountId);
    if (!account) throw Object.assign(new Error('会话绑定账号不存在。'), { code: 'CONVERSATION_BINDING_ACCOUNT_NOT_FOUND', status: 404 });
    if (account.platform !== normalizedPlatform) throw Object.assign(new Error('会话绑定账号与平台不一致。'), { code: 'CONVERSATION_BINDING_PLATFORM_MISMATCH', status: 409 });
    const row = store.db.prepare('SELECT * FROM r32_conversations WHERE session_key=?').get(normalizedConversationId);
    if (!row) {
      throw Object.assign(new Error('禁止为不存在的会话创建仅含路由的空壳。'), {
        code: 'CONVERSATION_BINDING_REQUIRES_PERSISTED_CONVERSATION', status: 409, conversationId: normalizedConversationId
      });
    }
    const existingAccountId = String(row.account_id || '').trim();
    if (existingAccountId && existingAccountId !== account.id && existingAccountId !== account.adapterAccountId) {
      throw Object.assign(new Error('会话已有不同账号绑定，禁止静默切换发送来源。'), {
        code: 'CONVERSATION_ACCOUNT_ROUTE_CONFLICT', status: 409,
        conversationId: normalizedConversationId, existingAccountId, requestedAccountId: account.id
      });
    }
    const payload = parseJson(row.payload_json, {}) || {};
    const updatedAt = now();
    const nextPayload = {
      ...payload,
      accountId: account.id,
      platform: normalizedPlatform,
      externalConversationId: String(externalConversationId || payload.externalConversationId || ''),
      routeBindingAuthority: 'r32_conversations',
      routeBindingUpdatedAt: updatedAt
    };
    store.db.prepare(`UPDATE r32_conversations SET account_id=?,platform=?,payload_json=?,updated_at=? WHERE session_key=?`)
      .run(account.id, normalizedPlatform, JSON.stringify(nextPayload), updatedAt, normalizedConversationId);
    const activeIdentityBinding = store.db.prepare("SELECT * FROM conversation_bindings WHERE conversation_id=? AND state='active'").get(normalizedConversationId);
    if (activeIdentityBinding) {
      if (String(activeIdentityBinding.account_id || '') && String(activeIdentityBinding.account_id) !== account.id) {
        throw Object.assign(new Error('身份会话绑定与账号路由不一致。'), {
          code: 'IDENTITY_CONVERSATION_ACCOUNT_ROUTE_CONFLICT', status: 409,
          conversationId: normalizedConversationId, identityAccountId: activeIdentityBinding.account_id, requestedAccountId: account.id
        });
      }
      store.db.prepare(`UPDATE conversation_bindings SET platform=?,account_id=?,external_id=?,source='account-route-authority',updated_at=? WHERE person_id=? AND conversation_id=?`)
        .run(normalizedPlatform, account.id, String(externalConversationId || activeIdentityBinding.external_id || ''), updatedAt, activeIdentityBinding.person_id, normalizedConversationId);
    }
    const state = readState(store);
    binding = {
      conversationId: normalizedConversationId,
      accountId: account.id,
      platform: normalizedPlatform,
      externalConversationId: String(externalConversationId || nextPayload.externalConversationId || ''),
      updatedAt,
      authority: 'r32_conversations',
      compatibilityProjection: false
    };
    state.bindings[normalizedConversationId] = { ...binding, compatibilityProjection: true, authority: 'legacy-settings-projection' };
    addAudit(state, 'conversation-bound', { conversationId: normalizedConversationId, accountId: account.id, platform: normalizedPlatform, authority: 'r32_conversations' });
    writeState(store, state);
  });
  return clone(binding);
}

async function record(action, detail) {
  const store = getStore();
  await store.transactionAsync(() => {
    const state = readState(store);
    addAudit(state, action, detail);
    writeState(store, state);
  });
  return read();
}

module.exports = { read, list, listAll, get, getRaw, create, update, remove, setDefault, bindConversation, canonicalBindings, record,
  persistAccount, recordWithinTransaction, promoteAuthorizationTx, commitConnectedIdentityTx, commitLifecycleTx, tombstone };
