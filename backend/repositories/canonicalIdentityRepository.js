'use strict';

const crypto = require('crypto');
const { getStore } = require('./storeProvider');
const { parseJson } = require('../lib/r32SqliteStore');
const backupService = require('../services/backupService');
const logger = require('../services/logger');
const { identityTokens, normalizeJid, normalizePhone, safeDisplayName } = require('../services/whatsappIdentity');
const { lifecycleState, isMigrationTemporary } = require('../services/accountLifecycle');

function now() { return new Date().toISOString(); }
function id(prefix, ...parts) { return `${prefix}-${crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 24)}`; }
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }

function accountRows(store) {
  return store.db.prepare(`
    SELECT id, platform, adapter_account_id, display_name, identity_label, state,
           canonical_account_id, lifecycle_state, merged_into_id, tombstoned_at,
           payload_json, created_at, updated_at
    FROM r32_accounts
    ORDER BY created_at ASC, id ASC
  `).all().map(row => ({
    ...parseJson(row.payload_json, {}),
    id: row.id,
    platform: row.platform,
    adapterAccountId: row.adapter_account_id,
    displayName: row.display_name,
    identityLabel: row.identity_label,
    state: row.state,
    canonicalAccountId: row.canonical_account_id || row.id,
    lifecycleState: row.lifecycle_state || 'active',
    mergedIntoId: row.merged_into_id || '',
    tombstonedAt: row.tombstoned_at || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

function connectedHint(account) {
  const state = String(account.state || '').toLowerCase();
  const validation = String(account.metadata?.validationState || '').toLowerCase();
  return ['connected', 'online', 'limited'].includes(state) || validation === 'live-validated';
}

function canonicalScore(account, defaults = {}) {
  let score = 0;
  if (defaults[account.platform] === account.id) score += 100;
  if (connectedHint(account)) score += 80;
  if (!account.paused) score += 30;
  if (account.autoReconnect !== false) score += 10;
  if (String(account.metadata?.validationState || '') === 'live-validated') score += 50;
  if (!/^legacy-acct:/.test(account.id)) score += 10;
  if (!isMigrationTemporary(account)) score += 10;
  score += Math.min(10, Math.max(0, Date.parse(account.updatedAt || 0) / 1e15));
  return score;
}

function buildGroups(accounts) {
  const tokenMap = new Map();
  for (const account of accounts) {
    for (const token of identityTokens(account)) {
      if (!tokenMap.has(token)) tokenMap.set(token, []);
      tokenMap.get(token).push(account.id);
    }
  }
  const adjacency = new Map(accounts.map(account => [account.id, new Set()]));
  for (const ids of tokenMap.values()) {
    if (ids.length < 2) continue;
    for (const left of ids) for (const right of ids) if (left !== right) adjacency.get(left).add(right);
  }
  const byId = new Map(accounts.map(account => [account.id, account]));
  const visited = new Set();
  const groups = [];
  for (const account of accounts) {
    if (visited.has(account.id)) continue;
    const stack = [account.id];
    const group = [];
    while (stack.length) {
      const current = stack.pop();
      if (visited.has(current)) continue;
      visited.add(current);
      group.push(byId.get(current));
      for (const next of adjacency.get(current) || []) stack.push(next);
    }
    groups.push(group.filter(Boolean));
  }
  return groups;
}

function upsertAlias(store, { platform, type, value, canonicalAccountId = '', canonicalContactId = '', confidence = 'high', source = '', payload = {} }) {
  const normalized = String(value || '').trim();
  if (!normalized) return;
  store.db.prepare(`
    INSERT INTO identity_aliases(id, platform, alias_type, alias_value, canonical_account_id, canonical_contact_id, confidence, source, payload_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(platform, alias_type, alias_value) DO UPDATE SET
      canonical_account_id=excluded.canonical_account_id,
      canonical_contact_id=excluded.canonical_contact_id,
      confidence=excluded.confidence,
      source=excluded.source,
      payload_json=excluded.payload_json,
      updated_at=excluded.updated_at
  `).run(id('alias', platform, type, normalized), platform, type, normalized, canonicalAccountId, canonicalContactId, confidence, source, JSON.stringify(payload), now(), now());
}

function rewriteAccountState(store, aliases) {
  const row = store.db.prepare(`SELECT value_json FROM r32_settings WHERE namespace='accounts-state' AND key='document'`).get();
  if (!row) return;
  const state = parseJson(row.value_json, {}) || {};
  state.defaults = { ...(state.defaults || {}) };
  for (const [platform, accountId] of Object.entries(state.defaults)) state.defaults[platform] = aliases.get(accountId) || accountId;
  state.bindings = { ...(state.bindings || {}) };
  for (const binding of Object.values(state.bindings)) {
    if (binding?.accountId && aliases.has(binding.accountId)) binding.accountId = aliases.get(binding.accountId);
  }
  state.updatedAt = now();
  store.setSetting('accounts-state', 'document', state);
}

function rewriteAccountReferences(store, sourceId, targetId) {
  const statements = [
    ['r32_conversations', 'account_id'],
    ['r32_messages', 'account_id'],
    ['ai_reply_outbox', 'account_id'],
    ['r32_send_queue', 'account_id']
  ];
  const counts = {};
  for (const [table, column] of statements) {
    try { counts[table] = store.db.prepare(`UPDATE ${table} SET ${column}=? WHERE ${column}=?`).run(targetId, sourceId).changes; }
    catch (_) { counts[table] = 0; }
  }
  try {
    const rows = store.db.prepare('SELECT * FROM sync_checkpoints WHERE account_id=?').all(sourceId);
    for (const row of rows) {
      store.db.prepare(`
        INSERT INTO sync_checkpoints(platform,account_id,scope_id,cursor,remote_message_id,remote_timestamp,batch_id,phase,payload_json,committed_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(platform,account_id,scope_id) DO UPDATE SET
          cursor=CASE WHEN excluded.updated_at>sync_checkpoints.updated_at THEN excluded.cursor ELSE sync_checkpoints.cursor END,
          remote_message_id=CASE WHEN excluded.updated_at>sync_checkpoints.updated_at THEN excluded.remote_message_id ELSE sync_checkpoints.remote_message_id END,
          remote_timestamp=CASE WHEN excluded.updated_at>sync_checkpoints.updated_at THEN excluded.remote_timestamp ELSE sync_checkpoints.remote_timestamp END,
          batch_id=CASE WHEN excluded.updated_at>sync_checkpoints.updated_at THEN excluded.batch_id ELSE sync_checkpoints.batch_id END,
          phase=CASE WHEN excluded.updated_at>sync_checkpoints.updated_at THEN excluded.phase ELSE sync_checkpoints.phase END,
          payload_json=CASE WHEN excluded.updated_at>sync_checkpoints.updated_at THEN excluded.payload_json ELSE sync_checkpoints.payload_json END,
          committed_at=CASE WHEN excluded.updated_at>sync_checkpoints.updated_at THEN excluded.committed_at ELSE sync_checkpoints.committed_at END,
          updated_at=MAX(sync_checkpoints.updated_at,excluded.updated_at)
      `).run(row.platform,targetId,row.scope_id,row.cursor,row.remote_message_id,row.remote_timestamp,row.batch_id,row.phase,row.payload_json,row.committed_at,row.updated_at);
    }
    counts.sync_checkpoints = rows.length;
    store.db.prepare('DELETE FROM sync_checkpoints WHERE account_id=?').run(sourceId);
  } catch (_) { counts.sync_checkpoints = 0; }
  try {
    const rows = store.db.prepare('SELECT * FROM sync_message_receipts WHERE account_id=?').all(sourceId);
    for (const row of rows) store.db.prepare(`
      INSERT INTO sync_message_receipts(platform,account_id,remote_message_id,conversation_id,message_id,first_seen_at,updated_at)
      VALUES(?,?,?,?,?,?,?) ON CONFLICT(platform,account_id,remote_message_id) DO NOTHING
    `).run(row.platform,targetId,row.remote_message_id,row.conversation_id,row.message_id,row.first_seen_at,row.updated_at);
    counts.sync_message_receipts = rows.length;
    store.db.prepare('DELETE FROM sync_message_receipts WHERE account_id=?').run(sourceId);
  } catch (_) { counts.sync_message_receipts = 0; }
  try { counts.contacts = store.db.prepare('UPDATE contacts SET account_id=?, updated_at=? WHERE account_id=?').run(targetId, now(), sourceId).changes; } catch (_) { counts.contacts = 0; }
  return counts;
}

const SINGLE_CONTACT_TABLES = ['customer_profiles', 'relationship_insights', 'customer_social_state', 'customer_interaction_preferences', 'interaction_policies'];
const MANY_CONTACT_TABLES = ['ai_analysis_runs', 'relationship_state_signals', 'relationship_timeline_events', 'ai_context_snapshots', 'social_inference_corrections', 'ai_reply_tasks', 'ai_reply_candidates', 'ai_reply_outbox'];

function mergeContactRows(store, sourceId, targetId) {
  const counts = {};
  for (const table of SINGLE_CONTACT_TABLES) {
    try {
      const targetExists = store.db.prepare(`SELECT 1 FROM ${table} WHERE contact_id=?`).get(targetId);
      if (targetExists) {
        counts[table] = store.db.prepare(`DELETE FROM ${table} WHERE contact_id=?`).run(sourceId).changes;
      } else {
        counts[table] = store.db.prepare(`UPDATE ${table} SET contact_id=? WHERE contact_id=?`).run(targetId, sourceId).changes;
      }
    } catch (_) { counts[table] = 0; }
  }
  for (const table of MANY_CONTACT_TABLES) {
    try { counts[table] = store.db.prepare(`UPDATE ${table} SET contact_id=? WHERE contact_id=?`).run(targetId, sourceId).changes; }
    catch (_) { counts[table] = 0; }
  }
  try { counts.conversations = store.db.prepare('UPDATE r32_conversations SET contact_id=?, updated_at=? WHERE contact_id=?').run(targetId, now(), sourceId).changes; } catch (_) { counts.conversations = 0; }
  return counts;
}

function contactIdentity(contact) {
  const payload = parseJson(contact.payload_json, {}) || {};
  const jid = normalizeJid(contact.external_id || payload.chatJid || payload.externalId);
  const phone = normalizePhone(contact.phone || contact.external_id || payload.phone);
  return jid ? `jid:${jid}` : phone ? `phone:${phone}` : '';
}

function mergeDuplicateContacts(store, canonicalAccountId, sourceAccountIds) {
  const allIds = [canonicalAccountId, ...sourceAccountIds];
  const placeholders = allIds.map(() => '?').join(',');
  const contacts = store.db.prepare(`SELECT * FROM contacts WHERE platform='whatsapp' AND account_id IN (${placeholders}) ORDER BY created_at ASC, id ASC`).all(...allIds);
  const grouped = new Map();
  for (const contact of contacts) {
    const key = contactIdentity(contact);
    if (!key) continue;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(contact);
  }
  const merges = [];
  for (const [key, rows] of grouped) {
    if (rows.length < 2) continue;
    rows.sort((a, b) => {
      const aCanon = a.account_id === canonicalAccountId ? 1 : 0;
      const bCanon = b.account_id === canonicalAccountId ? 1 : 0;
      return bCanon - aCanon || String(a.created_at).localeCompare(String(b.created_at));
    });
    const target = rows[0];
    store.db.prepare(`UPDATE contacts SET account_id=?, canonical_contact_id=?, updated_at=? WHERE id=?`).run(canonicalAccountId, target.id, now(), target.id);
    for (const source of rows.slice(1)) {
      const refs = mergeContactRows(store, source.id, target.id);
      const aliases = [...new Set([
        ...(parseJson(target.aliases_json, []) || []),
        ...(parseJson(source.aliases_json, []) || []),
        source.display_name, source.external_id, source.phone
      ].filter(Boolean))];
      store.db.prepare(`UPDATE contacts SET aliases_json=?, updated_at=? WHERE id=?`).run(JSON.stringify(aliases), now(), target.id);
      store.db.prepare(`
        UPDATE contacts SET canonical_contact_id=?, merged_into_id=?, tombstoned_at=?, archived_at=?, archive_reason='canonical-identity-merge', archived_by='migration', updated_at=? WHERE id=?
      `).run(target.id, target.id, now(), now(), now(), source.id);
      upsertAlias(store, { platform: 'whatsapp', type: 'contact-id', value: source.id, canonicalAccountId, canonicalContactId: target.id, source: 'stage6.3.4-contact-merge' });
      store.db.prepare(`INSERT INTO identity_merge_audit(id,platform,entity_type,source_id,target_id,confidence,reason,report_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)`)
        .run(id('merge', 'contact', source.id, target.id), 'whatsapp', 'contact', source.id, target.id, 'high', key, JSON.stringify(refs), now());
      merges.push({ sourceId: source.id, targetId: target.id, key, refs });
    }
  }
  return merges;
}

function archiveEmptyDuplicateConversations(store, canonicalAccountId, sourceIds) {
  if (!sourceIds.length) return [];
  const placeholders = sourceIds.map(() => '?').join(',');
  const rows = store.db.prepare(`
    SELECT c.session_key, c.account_id, c.contact_id, c.title,
           (SELECT COUNT(*) FROM r32_messages m WHERE m.session_key=c.session_key) AS message_count
    FROM r32_conversations c
    WHERE c.account_id IN (${placeholders})
  `).all(...sourceIds);
  const archived = [];
  for (const row of rows) {
    if (Number(row.message_count || 0) > 0) continue;
    store.db.prepare(`UPDATE r32_conversations SET account_id=?, archived_at=?, archive_reason='empty-duplicate-identity', archived_by='migration', updated_at=? WHERE session_key=?`)
      .run(canonicalAccountId, now(), now(), row.session_key);
    archived.push(row.session_key);
  }
  return archived;
}

function canonicalizeWhatsAppAccounts(options = {}) {
  const store = options.store || getStore();
  const dryRun = options.dryRun === true;
  const accounts = accountRows(store).filter(account => account.platform === 'whatsapp' && lifecycleState(account) !== 'tombstoned');
  const accountState = store.getSetting('accounts-state', 'document', {}) || {};
  const defaults = accountState.defaults || {};
  const groups = buildGroups(accounts).filter(group => group.length > 1);
  const plan = [];
  for (const group of groups) {
    const sorted = [...group].sort((a, b) => canonicalScore(b, defaults) - canonicalScore(a, defaults));
    const canonical = sorted[0];
    const aliases = sorted.slice(1).filter(account => account.id !== canonical.id && lifecycleState(account) !== 'merged');
    if (!aliases.length) continue;
    plan.push({ canonical, aliases, sharedTokens: identityTokens(canonical).filter(token => aliases.some(alias => identityTokens(alias).includes(token))) });
  }
  if (dryRun || !plan.length) return { ok: true, dryRun, executed: false, groups: plan.map(row => ({ canonicalId: row.canonical.id, aliasIds: row.aliases.map(a => a.id), sharedTokens: row.sharedTokens })) };

  const restorePoint = options.skipBackup ? null : backupService.createBackup('before-stage6-3-4-canonical-identity');
  const report = { ok: true, executed: true, restorePoint: restorePoint?.dir || '', accountMerges: [], contactMerges: [], archivedConversations: [], at: now() };
  store.transaction(() => {
    const aliasMap = new Map();
    for (const item of plan) {
      const canonical = item.canonical;
      const canonicalName = safeDisplayName(canonical.displayName, canonical.metadata?.liveUser?.name, canonical.identityLabel);
      store.db.prepare(`UPDATE r32_accounts SET canonical_account_id=id, lifecycle_state=CASE WHEN state='paused' THEN 'paused' ELSE 'active' END, merged_into_id='', tombstoned_at='', display_name=?, updated_at=? WHERE id=?`)
        .run(canonicalName, now(), canonical.id);
      for (const token of identityTokens(canonical)) upsertAlias(store, { platform: 'whatsapp', type: token.split(':')[0], value: token.slice(token.indexOf(':') + 1), canonicalAccountId: canonical.id, source: 'stage6.3.4-canonical' });
      const sourceIds = [];
      for (const source of item.aliases) {
        sourceIds.push(source.id);
        aliasMap.set(source.id, canonical.id);
        aliasMap.set(source.adapterAccountId, canonical.id);
        const refs = rewriteAccountReferences(store, source.id, canonical.id);
        if (source.adapterAccountId && source.adapterAccountId !== source.id) {
          const adapterRefs = rewriteAccountReferences(store, source.adapterAccountId, canonical.id);
          for (const [key, value] of Object.entries(adapterRefs)) refs[key] = Number(refs[key] || 0) + Number(value || 0);
        }
        const payload = { ...source, paused: true, autoReconnect: false, metadata: { ...(source.metadata || {}), authAliasOf: canonical.id, mergedAt: now(), mergeReason: item.sharedTokens } };
        store.db.prepare(`
          UPDATE r32_accounts SET canonical_account_id=?, lifecycle_state='merged', merged_into_id=?, state='paused', can_send=0, can_receive=0, payload_json=?, updated_at=? WHERE id=?
        `).run(canonical.id, canonical.id, JSON.stringify(payload), now(), source.id);
        upsertAlias(store, { platform: 'whatsapp', type: 'account-id', value: source.id, canonicalAccountId: canonical.id, source: 'stage6.3.4-account-merge', payload: { adapterAccountId: source.adapterAccountId } });
        if (source.adapterAccountId) upsertAlias(store, { platform: 'whatsapp', type: 'adapter-account-id', value: source.adapterAccountId, canonicalAccountId: canonical.id, source: 'stage6.3.4-account-merge' });
        store.db.prepare(`INSERT INTO identity_merge_audit(id,platform,entity_type,source_id,target_id,confidence,reason,report_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)`)
          .run(id('merge', 'account', source.id, canonical.id), 'whatsapp', 'account', source.id, canonical.id, 'high', item.sharedTokens.join(','), JSON.stringify(refs), now());
        report.accountMerges.push({ sourceId: source.id, targetId: canonical.id, refs, sharedTokens: item.sharedTokens });
      }
      report.contactMerges.push(...mergeDuplicateContacts(store, canonical.id, sourceIds));
      report.archivedConversations.push(...archiveEmptyDuplicateConversations(store, canonical.id, sourceIds));
    }
    rewriteAccountState(store, aliasMap);
    store.setSetting('identity-governance', 'last-canonicalization', report);
  });
  logger.warn('identity', 'canonicalization-completed', {
    accountMerges: report.accountMerges.length,
    contactMerges: report.contactMerges.length,
    archivedConversations: report.archivedConversations.length,
    restorePoint: report.restorePoint
  });
  return clone(report);
}

function scalarAlias(value) {
  const text = String(value == null ? '' : value).trim();
  return text && text.length <= 512 ? text : '';
}

function accountIdentityAliases(account = {}) {
  const values = new Set();
  const add = value => {
    if (Array.isArray(value)) return value.forEach(add);
    const text = scalarAlias(value);
    if (text) values.add(text);
  };
  add(account.id);
  add(account.canonicalAccountId);
  add(account.adapterAccountId);
  add(account.authAccountKey);
  add(account.externalId);
  add(account.pageId);
  add(account.page?.id);
  add(account.user?.id);
  add(account.metadata?.pageId);
  add(account.metadata?.authAccountKey);
  add(account.metadata?.accountKey);
  add(account.metadata?.openClawAccountId);
  add(account.metadata?.whatsappAccountId);
  add(account.metadata?.resolvedAuthAccountKey);
  add(account.metadata?.livePage?.id);
  add(account.metadata?.page?.id);
  add(account.metadata?.liveUser?.id);
  add(account.metadata?.user?.id);
  add(account.metadata?.sourceAccountId);
  add(account.metadata?.sourceAccountIds);
  add(account.metadata?.aliases);
  add(account.routeAliases);
  add(account.aliases);
  return [...values];
}

function resolveCanonicalAccountId(accountId, store = getStore(), platform = '') {
  const value = scalarAlias(accountId);
  if (!value) return '';
  const direct = store.db.prepare(`SELECT id, canonical_account_id, merged_into_id FROM r32_accounts WHERE id=? OR adapter_account_id=? ORDER BY CASE WHEN id=? THEN 0 ELSE 1 END LIMIT 1`).get(value, value, value);
  if (direct) return direct.merged_into_id || direct.canonical_account_id || direct.id || value;
  const platformValue = scalarAlias(platform).toLowerCase();
  const alias = platformValue
    ? store.db.prepare(`SELECT canonical_account_id FROM identity_aliases WHERE platform=? AND alias_value=? ORDER BY updated_at DESC LIMIT 1`).get(platformValue, value)
    : store.db.prepare(`SELECT canonical_account_id FROM identity_aliases WHERE alias_value=? ORDER BY updated_at DESC LIMIT 1`).get(value);
  if (alias?.canonical_account_id) return alias.canonical_account_id;
  const candidates = accountRows(store).filter(account => !platformValue || String(account.platform || '').toLowerCase() === platformValue);
  const matched = candidates.filter(account => accountIdentityAliases(account).includes(value));
  if (matched.length !== 1) return value;
  const account = matched[0];
  return account.mergedIntoId || account.canonicalAccountId || account.id || value;
}

module.exports = { canonicalizeWhatsAppAccounts, resolveCanonicalAccountId, accountIdentityAliases, buildGroups, canonicalScore };
