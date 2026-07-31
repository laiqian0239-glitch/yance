'use strict';

const crypto = require('crypto');
const { getStore } = require('../repositories/storeProvider');
const { parseJson, stableId } = require('../lib/r32SqliteStore');
const eventBus = require('./eventBus');
const logger = require('./logger');
const authority = require('./whatsappIdentityAuthority');
const outboxRouteAuthority = require('./outboxRouteAuthority').singleton;
const { normalizePhone } = require('./whatsappIdentity');

function clean(value, max = 4000) { return String(value == null ? '' : value).trim().slice(0, max); }
function nowIso() { return new Date().toISOString(); }
function uniq(values) { return [...new Set(values.map(authority.normalizeJid).filter(Boolean))]; }
function phoneFieldJid(value) {
  const phone = normalizePhone(value);
  return phone ? authority.normalizeJid(`${phone}@s.whatsapp.net`) : '';
}
function parse(value, fallback) { return parseJson(value, fallback); }
function json(value) { return JSON.stringify(value == null ? {} : value); }
function isJsonColumn(name) { return /_json$/.test(name) || name === 'payload_json'; }
function isTimestampColumn(name) { return /(?:_at|^at$|calculated_at|updated_at|created_at)$/.test(name); }
function isCountColumn(name) { return /(?:count|budget|used_this_week|version)$/.test(name); }
function isScoreColumn(name) { return /(?:score|confidence)$/.test(name); }
function tableExists(db, name) { return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type IN ('table','view') AND name=?").get(name)); }
function columns(db, table) { return db.prepare(`PRAGMA table_info(${JSON.stringify(table)})`).all().map(row => row.name); }
function tableInfo(db, table) { return db.prepare(`PRAGMA table_info(${JSON.stringify(table)})`).all(); }
function primaryKeyColumns(db, table) { return tableInfo(db, table).filter(row => row.pk).sort((a, b) => a.pk - b.pk).map(row => row.name); }
function quoteIdentifier(value) { return `\"${String(value).replace(/\"/g, '\"\"')}\"`; }

function deepMerge(left, right) {
  if (Array.isArray(left) || Array.isArray(right)) {
    const rows = [...(Array.isArray(left) ? left : []), ...(Array.isArray(right) ? right : [])];
    const seen = new Set();
    return rows.filter(row => {
      const key = typeof row === 'object' ? JSON.stringify(row) : String(row);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  if (left && typeof left === 'object' && right && typeof right === 'object') {
    const output = { ...left };
    for (const [key, value] of Object.entries(right)) output[key] = key in output ? deepMerge(output[key], value) : value;
    return output;
  }
  if (right !== undefined && right !== null && right !== '') return right;
  return left;
}

function mergeScalar(column, survivor, source) {
  if (isJsonColumn(column)) return json(deepMerge(parse(survivor, {}), parse(source, {})));
  if (isTimestampColumn(column)) return String(source || '') > String(survivor || '') ? source : survivor;
  if (isCountColumn(column)) {
    if (column === 'version' || column === 'profile_version') return Math.max(Number(survivor || 0), Number(source || 0)) + 1;
    return Number(survivor || 0) + Number(source || 0);
  }
  if (isScoreColumn(column)) return Math.max(Number(survivor || 0), Number(source || 0));
  if (typeof survivor === 'number' || typeof source === 'number') return Number(survivor || source || 0);
  const a = clean(survivor, 20000), b = clean(source, 20000);
  return b.length > a.length ? source : survivor;
}


const IDENTITY_JSON_KEYS = new Set([
  'conversationId', 'conversation_id', 'sessionKey', 'session_key',
  'contactId', 'contact_id', 'canonicalContactId', 'canonical_contact_id',
  'chatJid', 'chat_jid', 'remoteJid', 'remote_jid', 'remoteJidAlt', 'remote_jid_alt',
  'canonicalJid', 'canonical_jid', 'rawJid', 'raw_jid', 'externalId', 'external_id',
  'accountId', 'account_id', 'canonicalAccountId', 'canonical_account_id',
  'sourceAccountId', 'source_account_id'
]);

function identityReplacements(input = {}) {
  const exact = new Map();
  for (const value of input.sourceConversationIds || []) if (clean(value)) exact.set(clean(value), clean(input.targetConversationId));
  for (const value of input.sourceContactIds || []) if (clean(value)) exact.set(clean(value), clean(input.targetContactId));
  for (const value of input.sourceAccountIds || []) if (clean(value) && clean(input.targetAccountId)) exact.set(clean(value), clean(input.targetAccountId));
  for (const value of input.aliases || []) {
    const alias = authority.normalizeJid(value);
    if (alias && alias !== input.canonicalJid) exact.set(alias, clean(input.canonicalJid));
  }
  return {
    exact,
    canonicalJid: clean(input.canonicalJid),
    targetConversationId: clean(input.targetConversationId),
    targetContactId: clean(input.targetContactId),
    sourceAccountIds: (input.sourceAccountIds || []).map(value => clean(value)).filter(Boolean),
    targetAccountId: clean(input.targetAccountId)
  };
}

function rewriteIdentityValue(value, replacements, key = '') {
  if (Array.isArray(value)) return value.map(item => rewriteIdentityValue(item, replacements, ''));
  if (value && typeof value === 'object') {
    const output = {};
    for (const [childKey, childValue] of Object.entries(value)) output[childKey] = rewriteIdentityValue(childValue, replacements, childKey);
    return output;
  }
  if (typeof value !== 'string') return value;
  const normalized = clean(value, 20000);
  if (!normalized) return value;
  if (replacements.exact.has(normalized) && IDENTITY_JSON_KEYS.has(key)) return replacements.exact.get(normalized);
  return value;
}

function rewriteIdentityJson(raw, replacements) {
  if (!clean(raw, 20000)) return { value: raw, changed: false };
  let parsed;
  try { parsed = JSON.parse(String(raw)); } catch (_) { return { value: raw, changed: false }; }
  const rewritten = rewriteIdentityValue(parsed, replacements);
  const value = JSON.stringify(rewritten);
  return { value, changed: value !== String(raw) };
}

function rowLocator(db, table, row) {
  const pk = primaryKeyColumns(db, table);
  if (pk.length) return { clause: pk.map(name => `${quoteIdentifier(name)}=?`).join(' AND '), values: pk.map(name => row[name]) };
  if (Object.prototype.hasOwnProperty.call(row, '__rowid')) return { clause: 'rowid=?', values: [row.__rowid] };
  throw Object.assign(new Error(`无法定位 ${table} 中的引用行`), { code: 'WHATSAPP_MERGE_ROW_LOCATOR_MISSING', table });
}

function repointRowsByColumn(db, table, column, sourceValue, targetValue, replacements, at) {
  const info = tableInfo(db, table);
  const names = info.map(row => row.name);
  const pk = primaryKeyColumns(db, table);
  const selectPrefix = pk.length ? '*' : 'rowid AS __rowid,*';
  const rows = db.prepare(`SELECT ${selectPrefix} FROM ${quoteIdentifier(table)} WHERE ${quoteIdentifier(column)}=?`).all(sourceValue);
  let rewrittenJson = 0;
  for (const row of rows) {
    const updates = { [column]: targetValue };
    if (names.includes('account_id') && replacements.targetAccountId && replacements.sourceAccountIds.includes(clean(row.account_id))) {
      updates.account_id = replacements.targetAccountId;
    }
    for (const name of names.filter(isJsonColumn)) {
      const rewritten = rewriteIdentityJson(row[name], replacements);
      if (rewritten.changed) { updates[name] = rewritten.value; rewrittenJson += 1; }
    }
    if (names.includes('updated_at')) updates.updated_at = at;
    const locator = rowLocator(db, table, row);
    const updateNames = Object.keys(updates);
    try {
      db.prepare(`UPDATE ${quoteIdentifier(table)} SET ${updateNames.map(name => `${quoteIdentifier(name)}=?`).join(',')} WHERE ${locator.clause}`)
        .run(...updateNames.map(name => updates[name]), ...locator.values);
    } catch (error) {
      const wrapped = new Error(`WhatsApp 合并引用迁移冲突：${table}.${column}`);
      wrapped.code = 'WHATSAPP_MERGE_REFERENCE_CONFLICT';
      wrapped.table = table;
      wrapped.column = column;
      wrapped.sourceValue = sourceValue;
      wrapped.targetValue = targetValue;
      wrapped.cause = error;
      throw wrapped;
    }
  }
  return { moved: rows.length, rewrittenJson };
}

function rowScore(row = {}, canonicalJid = '', targetAccountId = '') {
  const name = clean(row.display_name || row.title || '');
  const weak = authority.weakName(name, canonicalJid);
  const accountPreference = targetAccountId && clean(row.account_id) === clean(targetAccountId) ? 1000 : 0;
  return accountPreference + (weak ? 0 : 300) + (clean(row.avatar_url) ? 120 : 0) + (clean(row.external_id) === canonicalJid ? 80 : 0) + (clean(row.updated_at).length ? 10 : 0);
}

function payloadAliases(payload = {}) {
  const values = [payload.chatJid, payload.jid, payload.externalId, payload.remoteJid, payload.remoteJidAlt, payload.canonicalJid, payload.rawJid, payload.phoneJid, phoneFieldJid(payload.phone)];
  if (Array.isArray(payload.aliases)) values.push(...payload.aliases);
  if (payload.rawMeta && typeof payload.rawMeta === 'object') values.push(payload.rawMeta.remoteJid, payload.rawMeta.remoteJidAlt, payload.rawMeta.canonicalJid, payload.rawMeta.rawJid);
  return uniq(values);
}

function conversationAliases(row = {}) {
  const suffix = clean(row.session_key).startsWith(`${clean(row.account_id)}:`) ? clean(row.session_key).slice(clean(row.account_id).length + 1) : '';
  return uniq([suffix, ...payloadAliases(parse(row.payload_json, {}))]);
}

function contactAliases(row = {}) {
  const payload = parse(row.payload_json, {});
  const aliases = parse(row.aliases_json, []);
  return uniq([row.external_id, phoneFieldJid(row.phone), ...(Array.isArray(aliases) ? aliases : []), ...payloadAliases(payload)]);
}


function strongestDisplayName(rows = [], canonicalJid = '', authorityRow = null) {
  const candidates = [];
  if (authorityRow?.displayName) candidates.push({ value: clean(authorityRow.displayName, 180), score: Number(authorityRow.nameScore || 0) + 5 });
  for (const row of rows) {
    const value = clean(row.display_name || row.title, 180);
    if (!value) continue;
    let score = 85 + Math.min(30, value.length);
    if (/[^\x00-\x7F]/.test(value)) score += 25;
    if (clean(row.avatar_url)) score += 5;
    candidates.push({ value, score });
  }
  return candidates.filter(row => !authority.weakName(row.value, canonicalJid)).sort((a, b) => b.score - a.score || b.value.length - a.value.length)[0]?.value || `+${normalizePhone(canonicalJid)}`;
}

function chooseSurvivorContact(rows, canonicalJid, authorityRow, targetAccountId = '') {
  const exact = rows.find(row => clean(row.account_id) === clean(targetAccountId) && clean(row.external_id) === canonicalJid && !clean(row.merged_into_id));
  if (exact) return exact;
  return [...rows].sort((a, b) => rowScore(b, canonicalJid, targetAccountId) - rowScore(a, canonicalJid, targetAccountId) || clean(b.updated_at).localeCompare(clean(a.updated_at)))[0] || null;
}

function mergePkContactRow(db, table, sourceId, targetId, at) {
  if (!tableExists(db, table)) return;
  const cols = columns(db, table);
  if (!cols.includes('contact_id')) return;
  const source = db.prepare(`SELECT * FROM ${table} WHERE contact_id=?`).get(sourceId);
  if (!source) return;
  const target = db.prepare(`SELECT * FROM ${table} WHERE contact_id=?`).get(targetId);
  if (!target) {
    db.prepare(`UPDATE ${table} SET contact_id=? WHERE contact_id=?`).run(targetId, sourceId);
    return;
  }
  const updates = {};
  for (const col of cols) {
    if (col === 'contact_id' || col === 'created_at') continue;
    updates[col] = col === 'updated_at' ? at : mergeScalar(col, target[col], source[col]);
  }
  const names = Object.keys(updates);
  if (names.length) db.prepare(`UPDATE ${table} SET ${names.map(name => `${name}=?`).join(',')} WHERE contact_id=?`).run(...names.map(name => updates[name]), targetId);
  db.prepare(`DELETE FROM ${table} WHERE contact_id=?`).run(sourceId);
}

function mergeInteractionPreferences(db, sourceId, targetId, at) {
  if (!tableExists(db, 'customer_interaction_preferences')) return;
  const rows = db.prepare('SELECT * FROM customer_interaction_preferences WHERE contact_id=?').all(sourceId);
  for (const source of rows) {
    const target = db.prepare('SELECT * FROM customer_interaction_preferences WHERE contact_id=? AND preference_key=?').get(targetId, source.preference_key);
    if (!target) {
      db.prepare('UPDATE customer_interaction_preferences SET contact_id=?,updated_at=? WHERE contact_id=? AND preference_key=?')
        .run(targetId, at, sourceId, source.preference_key);
      continue;
    }
    const valueJson = json(deepMerge(parse(target.value_json, {}), parse(source.value_json, {})));
    const evidence = json(deepMerge(parse(target.evidence_message_ids_json, []), parse(source.evidence_message_ids_json, [])));
    db.prepare(`UPDATE customer_interaction_preferences SET value_json=?,confidence=MAX(confidence,?),
      evidence_count=evidence_count+?,evidence_message_ids_json=?,last_confirmed_at=MAX(last_confirmed_at,?),updated_at=?
      WHERE contact_id=? AND preference_key=?`)
      .run(valueJson, Number(source.confidence || 0), Number(source.evidence_count || 0), evidence, source.last_confirmed_at || '', at, targetId, source.preference_key);
    db.prepare('DELETE FROM customer_interaction_preferences WHERE contact_id=? AND preference_key=?').run(sourceId, source.preference_key);
  }
}

function mergeContactFeedbackHistory(db, sourceId, targetId, at) {
  if (!tableExists(db, 'ai_reply_feedback_profiles')) return { currentMerged: 0, versionsMoved: 0 };
  const source = db.prepare("SELECT * FROM ai_reply_feedback_profiles WHERE scope_type='contact' AND scope_id=?").get(sourceId);
  const target = db.prepare("SELECT * FROM ai_reply_feedback_profiles WHERE scope_type='contact' AND scope_id=?").get(targetId);
  let currentMerged = 0;
  let mergedProfile = target ? parse(target.profile_json, {}) : {};
  let nextVersion = Number(target?.version || 0);
  if (source) {
    mergedProfile = deepMerge(mergedProfile, parse(source.profile_json, {}));
    nextVersion = Math.max(nextVersion, Number(source.version || 0));
    currentMerged = 1;
  }
  let versionsMoved = 0;
  if (tableExists(db, 'ai_reply_feedback_profile_versions')) {
    const sourceVersions = db.prepare("SELECT * FROM ai_reply_feedback_profile_versions WHERE scope_type='contact' AND scope_id=? ORDER BY version,created_at").all(sourceId);
    const maxTarget = db.prepare("SELECT MAX(version) AS version FROM ai_reply_feedback_profile_versions WHERE scope_type='contact' AND scope_id=?").get(targetId);
    nextVersion = Math.max(nextVersion, Number(maxTarget?.version || 0));
    for (const row of sourceVersions) {
      nextVersion += 1;
      db.prepare(`INSERT INTO ai_reply_feedback_profile_versions(scope_type,scope_id,version,profile_json,reason,created_at)
        VALUES('contact',?,?,?,?,?)`).run(targetId, nextVersion, row.profile_json, `whatsapp-contact-merge:${clean(row.reason) || 'source-version'}:${row.version}`, clean(row.created_at) || at);
      versionsMoved += 1;
    }
    if (sourceVersions.length) db.prepare("DELETE FROM ai_reply_feedback_profile_versions WHERE scope_type='contact' AND scope_id=?").run(sourceId);
  }
  if (source || target) {
    nextVersion += 1;
    const profileJson = json({ ...mergedProfile, version: nextVersion, updatedAt: at });
    db.prepare(`INSERT INTO ai_reply_feedback_profiles(scope_type,scope_id,profile_json,version,updated_at)
      VALUES('contact',?,?,?,?) ON CONFLICT(scope_type,scope_id) DO UPDATE SET
      profile_json=excluded.profile_json,version=excluded.version,updated_at=excluded.updated_at`)
      .run(targetId, profileJson, nextVersion, at);
    if (tableExists(db, 'ai_reply_feedback_profile_versions')) {
      db.prepare(`INSERT INTO ai_reply_feedback_profile_versions(scope_type,scope_id,version,profile_json,reason,created_at)
        VALUES('contact',?,?,?,'whatsapp-contact-merge',?)`).run(targetId, nextVersion, profileJson, at);
    }
  }
  if (source) db.prepare("DELETE FROM ai_reply_feedback_profiles WHERE scope_type='contact' AND scope_id=?").run(sourceId);
  return { currentMerged, versionsMoved };
}

function repointContactReferences(db, sourceId, targetId, at) {
  const pkTables = ['customer_profiles', 'relationship_insights', 'customer_social_state', 'interaction_policies'];
  const stats = { contactRowsMoved: 0, jsonDocumentsRewritten: 0, feedbackCurrentMerged: 0, feedbackVersionsMoved: 0, identityAliasesMoved: 0 };
  mergeInteractionPreferences(db, sourceId, targetId, at);
  for (const table of pkTables) mergePkContactRow(db, table, sourceId, targetId, at);
  const replacements = identityReplacements({ sourceContactIds: [sourceId], targetContactId: targetId });
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  for (const { name } of rows) {
    if (['contacts', ...pkTables, 'customer_interaction_preferences', 'ai_reply_feedback_profiles', 'ai_reply_feedback_profile_versions'].includes(name)) continue;
    const cols = columns(db, name);
    if (!cols.includes('contact_id')) continue;
    const moved = repointRowsByColumn(db, name, 'contact_id', sourceId, targetId, replacements, at);
    stats.contactRowsMoved += moved.moved;
    stats.jsonDocumentsRewritten += moved.rewrittenJson;
  }
  if (tableExists(db, 'identity_aliases') && columns(db, 'identity_aliases').includes('canonical_contact_id')) {
    const moved = repointRowsByColumn(db, 'identity_aliases', 'canonical_contact_id', sourceId, targetId, replacements, at);
    stats.identityAliasesMoved += moved.moved;
    stats.jsonDocumentsRewritten += moved.rewrittenJson;
  }
  const feedback = mergeContactFeedbackHistory(db, sourceId, targetId, at);
  stats.feedbackCurrentMerged += feedback.currentMerged;
  stats.feedbackVersionsMoved += feedback.versionsMoved;
  return stats;
}
function mergeContacts(db, rows, canonicalJid, aliases, authorityRow, at, targetAccountId = '') {
  if (!rows.length) return '';
  const survivor = chooseSurvivorContact(rows, canonicalJid, authorityRow, targetAccountId);
  const survivorId = survivor.id;
  const allAliases = uniq([...aliases, ...rows.flatMap(contactAliases)]);
  const strongestName = strongestDisplayName(rows, canonicalJid, authorityRow);
  const avatar = authorityRow?.avatarUrl || [...rows].sort((a, b) => clean(b.avatar_updated_at).localeCompare(clean(a.avatar_updated_at))).map(row => clean(row.avatar_url)).find(Boolean) || '';
  const mergedPayload = rows.reduce((value, row) => deepMerge(value, parse(row.payload_json, {})), {});
  Object.assign(mergedPayload, { canonicalJid, aliases: allAliases, contactId: survivorId, displayName: strongestName, avatarUrl: avatar || mergedPayload.avatarUrl || '' });
  const archivedRow = [...rows].filter(row => clean(row.archived_at)).sort((a, b) => clean(b.archived_at).localeCompare(clean(a.archived_at)))[0] || null;
  const archivedAt = clean(archivedRow?.archived_at);
  const archiveReason = clean(archivedRow?.archive_reason);
  const archivedBy = clean(archivedRow?.archived_by);
  for (const row of rows) if (row.id !== survivorId) db.prepare("UPDATE contacts SET external_id='' WHERE id=?").run(row.id);
  db.prepare(`UPDATE contacts SET account_id=?, external_id=?, display_name=?, phone=?, avatar_url=CASE WHEN ?<>'' THEN ? ELSE avatar_url END,
      avatar_status=CASE WHEN ?<>'' THEN 'ready' ELSE avatar_status END, aliases_json=?, payload_json=?, canonical_contact_id=?, merged_into_id='', tombstoned_at='',
      archived_at=?,archive_reason=?,archived_by=?,updated_at=? WHERE id=?`)
    .run(targetAccountId || survivor.account_id, canonicalJid, strongestName, normalizePhone(canonicalJid), avatar, avatar, avatar, json(allAliases), json(mergedPayload), survivorId, archivedAt, archiveReason, archivedBy, at, survivorId);
  for (const row of rows) {
    if (row.id === survivorId) continue;
    repointContactReferences(db, row.id, survivorId, at);
    db.prepare("UPDATE contacts SET merged_into_id=?, canonical_contact_id=?, tombstoned_at=?, updated_at=? WHERE id=?").run(survivorId, survivorId, at, at, row.id);
  }
  return survivorId;
}

function rewriteMessagePayload(payload, canonicalSessionKey, canonicalJid, contactId, displayName, avatarUrl, accountId = '') {
  const output = { ...(payload || {}) };
  output.conversationId = canonicalSessionKey;
  output.sessionKey = canonicalSessionKey;
  output.chatJid = canonicalJid;
  if (accountId) output.accountId = accountId;
  output.contactId = contactId || output.contactId || '';
  if (displayName) {
    output.contactName = displayName;
    if (output.direction !== 'outbound' && output.fromMe !== true) {
      output.sender = displayName;
      output.senderName = displayName;
    }
  }
  if (avatarUrl) output.avatarUrl = avatarUrl;
  const external = clean(output.externalMessageId || output.messageId || output.id);
  if (accountId && external) output.dedupeKey = `${accountId}:${canonicalJid}:${external}`;
  output.rawMeta = { ...(output.rawMeta || {}), canonicalJid };
  return output;
}

function mergeSyncCheckpoint(db, targetAccountId, sourceAccountId, sourceKey, targetKey, replacements, at) {
  if (!tableExists(db, 'sync_checkpoints')) return { moved: 0, merged: 0 };
  const sourceAccount = clean(sourceAccountId) || clean(targetAccountId);
  const targetAccount = clean(targetAccountId);
  const source = db.prepare("SELECT * FROM sync_checkpoints WHERE platform='whatsapp' AND account_id=? AND scope_id=?").get(sourceAccount, sourceKey);
  if (!source) return { moved: 0, merged: 0 };
  const target = db.prepare("SELECT * FROM sync_checkpoints WHERE platform='whatsapp' AND account_id=? AND scope_id=?").get(targetAccount, targetKey);
  if (!target) {
    const rewritten = rewriteIdentityJson(source.payload_json, replacements);
    db.prepare("UPDATE sync_checkpoints SET account_id=?,scope_id=?,payload_json=?,updated_at=? WHERE platform='whatsapp' AND account_id=? AND scope_id=?")
      .run(targetAccount, targetKey, rewritten.value, at, sourceAccount, sourceKey);
    return { moved: 1, merged: 0 };
  }
  const newest = clean(source.updated_at) > clean(target.updated_at) ? source : target;
  const payload = rewriteIdentityValue(deepMerge(parse(target.payload_json, {}), parse(source.payload_json, {})), replacements);
  db.prepare(`UPDATE sync_checkpoints SET cursor=?,remote_message_id=?,remote_timestamp=?,batch_id=?,phase=?,payload_json=?,
    committed_at=?,updated_at=? WHERE platform='whatsapp' AND account_id=? AND scope_id=?`)
    .run(newest.cursor, newest.remote_message_id, newest.remote_timestamp, newest.batch_id, newest.phase, json(payload),
      clean(source.committed_at) > clean(target.committed_at) ? source.committed_at : target.committed_at, at, targetAccount, targetKey);
  db.prepare("DELETE FROM sync_checkpoints WHERE platform='whatsapp' AND account_id=? AND scope_id=?").run(sourceAccount, sourceKey);
  return { moved: 0, merged: 1 };
}


function repointOutboundCommandReferences(store, sourceKey, targetKey, context = {}) {
  const db = store.db;
  const at = clean(context.at) || nowIso();
  const accountId = clean(context.targetAccountId || context.accountId);
  const platform = 'whatsapp';
  const canonicalJid = authority.normalizeJid(context.canonicalJid);
  if (!accountId || !canonicalJid) {
    const error = new Error('WhatsApp outbound route migration requires canonical scope');
    error.code = 'WHATSAPP_MERGE_OUTBOX_SCOPE_INCOMPLETE';
    throw error;
  }
  const replacements = identityReplacements({
    sourceConversationIds: context.sourceConversationIds || [sourceKey],
    targetConversationId: targetKey,
    sourceContactIds: context.sourceContactIds || [],
    targetContactId: context.targetContactId || '',
    sourceAccountIds: [context.sourceAccountId || context.accountId].filter(Boolean),
    targetAccountId: accountId,
    aliases: context.aliases || [],
    canonicalJid
  });
  const sourceRoute = tableExists(db, 'outbox_routes')
    ? db.prepare('SELECT * FROM outbox_routes WHERE conversation_id=?').get(sourceKey)
    : null;
  const queueRows = tableExists(db, 'r32_send_queue')
    ? db.prepare('SELECT * FROM r32_send_queue WHERE session_key=? ORDER BY created_at,id').all(sourceKey)
    : [];
  let queuesMoved = 0;
  let jsonDocumentsRewritten = 0;
  for (const row of queueRows) {
    const oldVersion = clean(row.outbox_route_version_id) && tableExists(db, 'outbox_route_versions')
      ? db.prepare('SELECT * FROM outbox_route_versions WHERE route_version_id=?').get(row.outbox_route_version_id)
      : null;
    const capabilitySnapshotId = clean(oldVersion?.capability_snapshot_id || row.capability_snapshot_id || sourceRoute?.capability_snapshot_id);
    const route = outboxRouteAuthority.ensure({
      conversationId: targetKey,
      accountId,
      platform,
      routeTarget: canonicalJid,
      capabilitySnapshotId,
      personId: clean(context.personId),
      source: 'whatsapp-conversation-merge'
    }, store);
    const rewritten = rewriteIdentityJson(row.payload_json, replacements);
    db.prepare(`UPDATE r32_send_queue SET session_key=?,account_id=?,outbox_route_id=?,outbox_route_version_id=?,payload_json=?,updated_at=? WHERE id=?`)
      .run(targetKey, accountId, route.outboxRouteId, route.routeVersionId, rewritten.value, at, row.id);
    queuesMoved += 1;
    if (rewritten.changed) jsonDocumentsRewritten += 1;
  }
  if (sourceRoute && !queueRows.length) {
    outboxRouteAuthority.ensure({
      conversationId: targetKey,
      accountId,
      platform,
      routeTarget: canonicalJid,
      capabilitySnapshotId: clean(sourceRoute.capability_snapshot_id),
      personId: clean(context.personId),
      source: 'whatsapp-conversation-merge'
    }, store);
  }
  if (sourceRoute) {
    const remaining = db.prepare(`SELECT COUNT(*) AS count FROM r32_send_queue
      WHERE outbox_route_id=? OR outbox_route_version_id IN (SELECT route_version_id FROM outbox_route_versions WHERE outbox_route_id=?)`)
      .get(sourceRoute.outbox_route_id, sourceRoute.outbox_route_id);
    if (Number(remaining?.count || 0) > 0) {
      const error = new Error('WhatsApp merge left outbound commands on the source route');
      error.code = 'WHATSAPP_MERGE_OUTBOX_REFERENCE_CONFLICT';
      error.sourceConversationId = sourceKey;
      throw error;
    }
    db.prepare('DELETE FROM outbox_route_versions WHERE outbox_route_id=?').run(sourceRoute.outbox_route_id);
    db.prepare('DELETE FROM outbox_routes WHERE outbox_route_id=?').run(sourceRoute.outbox_route_id);
  }
  return { queuesMoved, jsonDocumentsRewritten };
}

function repointConversationReferences(db, sourceKey, targetKey, context = {}) {
  const at = clean(context.at) || nowIso();
  const replacements = identityReplacements({
    sourceConversationIds: context.sourceConversationIds || [sourceKey],
    targetConversationId: targetKey,
    sourceContactIds: context.sourceContactIds || [],
    targetContactId: context.targetContactId || '',
    sourceAccountIds: [context.sourceAccountId || context.accountId].filter(Boolean),
    targetAccountId: context.targetAccountId || context.accountId || '',
    aliases: context.aliases || [],
    canonicalJid: context.canonicalJid || ''
  });
  const stats = { conversationRowsMoved: 0, jsonDocumentsRewritten: 0, settingsMoved: 0, settingsMerged: 0, checkpointsMoved: 0, checkpointsMerged: 0, outboundQueuesMoved: 0 };
  if (context.store) {
    const outbound = repointOutboundCommandReferences(context.store, sourceKey, targetKey, context);
    stats.outboundQueuesMoved += Number(outbound.queuesMoved || 0);
    stats.jsonDocumentsRewritten += Number(outbound.jsonDocumentsRewritten || 0);
  }
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  for (const { name } of rows) {
    if (['r32_conversations', 'r32_messages', 'r32_messages_fts', 'r32_settings', 'sync_checkpoints', 'r32_send_queue', 'outbox_routes', 'outbox_route_versions'].includes(name)) continue;
    const cols = columns(db, name);
    for (const col of ['conversation_id', 'session_key']) {
      if (!cols.includes(col)) continue;
      const moved = repointRowsByColumn(db, name, col, sourceKey, targetKey, replacements, at);
      stats.conversationRowsMoved += moved.moved;
      stats.jsonDocumentsRewritten += moved.rewrittenJson;
    }
  }
  if (tableExists(db, 'r32_settings')) {
    const settings = db.prepare('SELECT namespace,key,value_json,updated_at FROM r32_settings WHERE key=?').all(sourceKey);
    for (const row of settings) {
      const target = db.prepare('SELECT value_json,updated_at FROM r32_settings WHERE namespace=? AND key=?').get(row.namespace, targetKey);
      if (!target) {
        const rewritten = rewriteIdentityJson(row.value_json, replacements);
        db.prepare('UPDATE r32_settings SET key=?,value_json=?,updated_at=? WHERE namespace=? AND key=?').run(targetKey, rewritten.value, at, row.namespace, sourceKey);
        stats.settingsMoved += 1;
        if (rewritten.changed) stats.jsonDocumentsRewritten += 1;
      } else {
        const merged = rewriteIdentityValue(deepMerge(parse(target.value_json, {}), parse(row.value_json, {})), replacements);
        db.prepare('UPDATE r32_settings SET value_json=?, updated_at=? WHERE namespace=? AND key=?').run(json(merged), at, row.namespace, targetKey);
        db.prepare('DELETE FROM r32_settings WHERE namespace=? AND key=?').run(row.namespace, sourceKey);
        stats.settingsMerged += 1;
        stats.jsonDocumentsRewritten += 1;
      }
    }
  }
  const checkpoint = mergeSyncCheckpoint(db, clean(context.targetAccountId || context.accountId), clean(context.sourceAccountId || context.accountId), sourceKey, targetKey, replacements, at);
  stats.checkpointsMoved += checkpoint.moved;
  stats.checkpointsMerged += checkpoint.merged;
  return stats;
}
function collectIdentityLeaks(value, replacements, path = '', key = '') {
  const leaks = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => leaks.push(...collectIdentityLeaks(item, replacements, `${path}[${index}]`, '')));
    return leaks;
  }
  if (value && typeof value === 'object') {
    for (const [childKey, childValue] of Object.entries(value)) leaks.push(...collectIdentityLeaks(childValue, replacements, path ? `${path}.${childKey}` : childKey, childKey));
    return leaks;
  }
  if (typeof value === 'string' && IDENTITY_JSON_KEYS.has(key) && replacements.exact.has(clean(value, 20000))) leaks.push({ path, value });
  return leaks;
}

function jsonReferenceLeaks(db, table, replacements) {
  if (!tableExists(db, table)) return [];
  const jsonColumns = columns(db, table).filter(isJsonColumn);
  if (!jsonColumns.length) return [];
  const needles = [...replacements.exact.keys()].filter(Boolean);
  if (!needles.length) return [];
  const output = [];
  for (const column of jsonColumns) {
    const clauses = needles.map(() => `${quoteIdentifier(column)} LIKE ?`).join(' OR ');
    const rows = db.prepare(`SELECT ${quoteIdentifier(column)} AS value FROM ${quoteIdentifier(table)} WHERE ${clauses}`).all(...needles.map(value => `%${value}%`));
    for (const row of rows) {
      let parsed;
      try { parsed = JSON.parse(String(row.value || '')); } catch (_) { continue; }
      for (const leak of collectIdentityLeaks(parsed, replacements)) output.push({ table, column, ...leak });
    }
  }
  return output;
}

function directReferenceLeaks(db, input = {}) {
  const sourceConversationIds = (input.sourceConversationIds || []).filter(Boolean);
  const sourceContactIds = (input.sourceContactIds || []).filter(Boolean);
  const leaks = [];
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  const count = (table, column, values) => {
    if (!values.length) return;
    const placeholders = values.map(() => '?').join(',');
    const row = db.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)} WHERE ${quoteIdentifier(column)} IN (${placeholders})`).get(...values);
    if (Number(row?.count || 0)) leaks.push({ table, column, count: Number(row.count) });
  };
  for (const { name } of tables) {
    const cols = columns(db, name);
    if (cols.includes('conversation_id')) count(name, 'conversation_id', sourceConversationIds);
    if (name !== 'r32_conversations' && cols.includes('session_key')) count(name, 'session_key', sourceConversationIds);
    if (name !== 'contacts' && cols.includes('contact_id')) count(name, 'contact_id', sourceContactIds);
  }
  if (tableExists(db, 'r32_settings')) count('r32_settings', 'key', sourceConversationIds);
  if (tableExists(db, 'sync_checkpoints')) count('sync_checkpoints', 'scope_id', sourceConversationIds);
  if (tableExists(db, 'identity_aliases')) count('identity_aliases', 'canonical_contact_id', sourceContactIds);
  for (const table of ['ai_reply_feedback_profiles', 'ai_reply_feedback_profile_versions']) {
    if (!tableExists(db, table)) continue;
    const placeholders = sourceContactIds.map(() => '?').join(',');
    if (!placeholders) continue;
    const row = db.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)} WHERE scope_type='contact' AND scope_id IN (${placeholders})`).get(...sourceContactIds);
    if (Number(row?.count || 0)) leaks.push({ table, column: 'scope_id', count: Number(row.count) });
  }
  return leaks;
}

function assertMergeIntegrity(db, input = {}) {
  const sourceConversationIds = (input.sourceConversationIds || []).filter(Boolean);
  const sourceContactIds = (input.sourceContactIds || []).filter(Boolean);
  const replacements = identityReplacements(input);
  const directLeaks = directReferenceLeaks(db, { sourceConversationIds, sourceContactIds });
  const jsonTables = [
    'r32_send_queue', 'r32_settings', 'sync_checkpoints', 'ai_context_snapshots', 'ai_reply_tasks',
    'ai_reply_candidates', 'ai_reply_outbox', 'ai_reply_feedback_events', 'relationship_insights',
    'relationship_state_signals', 'relationship_timeline_events', 'customer_profiles', 'customer_social_state',
    'interaction_policies'
  ];
  const jsonLeaks = jsonTables.flatMap(table => jsonReferenceLeaks(db, table, replacements));
  const badTombstones = sourceConversationIds.filter(sourceKey => {
    const row = db.prepare('SELECT merged_into,merged_at,merge_reason FROM r32_conversations WHERE session_key=?').get(sourceKey);
    return !row || clean(row.merged_into) !== clean(input.targetConversationId) || !clean(row.merged_at) || clean(row.merge_reason) !== 'whatsapp-jid-alias';
  });
  const active = db.prepare("SELECT COUNT(*) AS count FROM r32_conversations WHERE account_id=? AND platform='whatsapp' AND COALESCE(merged_into,'')='' AND session_key=?")
    .get(clean(input.accountId), clean(input.targetConversationId));
  const activeOk = !sourceConversationIds.length || Number(active?.count || 0) === 1;
  const foreignKeyLeaks = db.prepare('PRAGMA foreign_key_check').all();
  const integrity = {
    ok: !directLeaks.length && !jsonLeaks.length && !badTombstones.length && activeOk && !foreignKeyLeaks.length,
    directLeaks,
    jsonLeaks,
    badTombstones,
    activeCanonicalConversationCount: Number(active?.count || 0),
    foreignKeyLeaks
  };
  if (!integrity.ok) {
    const error = new Error('WhatsApp 会话合并完整性校验失败，事务已回滚');
    error.code = 'WHATSAPP_MERGE_INTEGRITY_FAILED';
    error.integrity = integrity;
    throw error;
  }
  return integrity;
}

function mergeConversations(store, rows, accountId, canonicalJid, aliases, contactId, sourceContactIds, authorityRow, at) {
  const db = store.db;
  const targetKey = `${accountId}:${canonicalJid}`;
  let target = rows.find(row => row.session_key === targetKey) || null;
  const best = [...rows].sort((a, b) => rowScore(b, canonicalJid) - rowScore(a, canonicalJid) || clean(b.last_message_at).localeCompare(clean(a.last_message_at)))[0] || {};
  const displayName = strongestDisplayName(rows, canonicalJid, authorityRow);
  const avatar = authorityRow?.avatarUrl || rows.map(row => clean(row.avatar_url)).find(Boolean) || '';
  const mergedPayload = rows.reduce((value, row) => deepMerge(value, parse(row.payload_json, {})), {});
  Object.assign(mergedPayload, { accountId, contactId, platform: 'whatsapp', chatJid: canonicalJid, externalId: canonicalJid, canonicalJid, aliases, title: displayName, contactName: displayName, avatarUrl: avatar || mergedPayload.avatarUrl || '' });
  if (!target) {
    db.prepare(`INSERT INTO r32_conversations(session_key,account_id,contact_id,platform,title,avatar_url,avatar_updated_at,avatar_status,last_message,last_message_at,unread_count,route_state,archived_at,archive_reason,archived_by,payload_json,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(targetKey, accountId, contactId, 'whatsapp', displayName, avatar, clean(best.avatar_updated_at), avatar ? 'ready' : clean(best.avatar_status), '', '', 0, clean(best.route_state), '', '', '', json(mergedPayload), clean(best.created_at) || at, at);
    target = db.prepare('SELECT * FROM r32_conversations WHERE session_key=?').get(targetKey);
  }
  const sourceKeys = rows.map(row => row.session_key).filter(key => key !== targetKey);
  const referenceStats = { conversationRowsMoved: 0, jsonDocumentsRewritten: 0, settingsMoved: 0, settingsMerged: 0, checkpointsMoved: 0, checkpointsMerged: 0, outboundQueuesMoved: 0 };
  for (const sourceKey of sourceKeys) {
    const sourceRow = rows.find(row => row.session_key === sourceKey) || {};
    const moved = repointConversationReferences(db, sourceKey, targetKey, {
      accountId,
      targetAccountId: accountId,
      sourceAccountId: clean(sourceRow.account_id) || accountId,
      sourceConversationIds: sourceKeys,
      sourceContactIds,
      targetContactId: contactId,
      aliases,
      canonicalJid,
      personId: clean(target.person_id),
      store,
      at
    });
    for (const key of Object.keys(referenceStats)) referenceStats[key] += Number(moved[key] || 0);
  }

  const allKeys = [...new Set([targetKey, ...sourceKeys])];
  const placeholders = allKeys.map(() => '?').join(',');
  const messageRows = db.prepare(`SELECT * FROM r32_messages WHERE session_key IN (${placeholders}) ORDER BY COALESCE(NULLIF(sent_at,''),created_at),id`).all(...allKeys);
  const seenExternal = new Map();
  for (const row of messageRows) {
    const payload = parse(row.payload_json, {});
    const external = clean(payload.externalMessageId || payload.messageId || payload.id);
    const key = external ? `${accountId}:${external}` : row.id;
    if (seenExternal.has(key)) {
      const keep = seenExternal.get(key);
      const richer = clean(row.media_path).length + clean(row.media_url).length + clean(row.text).length > clean(keep.media_path).length + clean(keep.media_url).length + clean(keep.text).length ? row : keep;
      const drop = richer.id === row.id ? keep : row;
      if (richer.id === row.id) seenExternal.set(key, row);
      db.prepare('DELETE FROM r32_messages WHERE id=?').run(drop.id);
      continue;
    }
    seenExternal.set(key, row);
  }
  const remaining = db.prepare(`SELECT * FROM r32_messages WHERE session_key IN (${placeholders})`).all(...allKeys);
  for (const row of remaining) {
    const payload = rewriteMessagePayload(parse(row.payload_json, {}), targetKey, canonicalJid, contactId, displayName, avatar, accountId);
    db.prepare('UPDATE r32_messages SET session_key=?, account_id=?, payload_json=?, updated_at=? WHERE id=?').run(targetKey, accountId, json(payload), at, row.id);
  }
  const latest = db.prepare("SELECT text,sent_at,created_at FROM r32_messages WHERE session_key=? ORDER BY COALESCE(NULLIF(sent_at,''),created_at) DESC,id DESC LIMIT 1").get(targetKey) || {};
  const unread = rows.reduce((sum, row) => sum + Number(row.unread_count || 0), 0);
  const route = [...rows].sort((a, b) => clean(b.updated_at).localeCompare(clean(a.updated_at))).map(row => clean(row.route_state)).find(Boolean) || '';
  const created = rows.map(row => clean(row.created_at)).filter(Boolean).sort()[0] || at;
  const archivedRow = [...rows].filter(row => clean(row.archived_at)).sort((a, b) => clean(b.archived_at).localeCompare(clean(a.archived_at)))[0] || null;
  const archivedAt = clean(archivedRow?.archived_at);
  const archiveReason = clean(archivedRow?.archive_reason);
  const archivedBy = clean(archivedRow?.archived_by);
  db.prepare(`UPDATE r32_conversations SET account_id=?,contact_id=?,platform='whatsapp',title=?,avatar_url=CASE WHEN ?<>'' THEN ? ELSE avatar_url END,
      avatar_status=CASE WHEN ?<>'' THEN 'ready' ELSE avatar_status END,last_message=?,last_message_at=?,unread_count=?,route_state=?,archived_at=?,archive_reason=?,archived_by=?,
      merged_into='',merged_at='',merge_reason='',payload_json=?,created_at=?,updated_at=? WHERE session_key=?`)
    .run(accountId, contactId, displayName, avatar, avatar, avatar, clean(latest.text), clean(latest.sent_at || latest.created_at), unread, route, archivedAt, archiveReason, archivedBy, json(mergedPayload), created, at, targetKey);
  for (const sourceKey of sourceKeys) {
    const source = rows.find(row => row.session_key === sourceKey) || {};
    const tombstonePayload = deepMerge(parse(source.payload_json, {}), {
      mergedInto: targetKey,
      mergedAt: at,
      mergeReason: 'whatsapp-jid-alias',
      canonicalJid,
      canonicalContactId: contactId,
      aliases
    });
    db.prepare(`UPDATE r32_conversations SET merged_into=?,merged_at=?,merge_reason='whatsapp-jid-alias',unread_count=0,route_state='',payload_json=?,updated_at=? WHERE session_key=?`)
      .run(targetKey, at, json(tombstonePayload), at, sourceKey);
  }
  if (tableExists(db, 'r32_messages_fts')) {
    db.prepare(`DELETE FROM r32_messages_fts WHERE session_key IN (${placeholders})`).run(...allKeys);
    db.prepare("INSERT INTO r32_messages_fts(message_id,session_key,text) SELECT id,session_key,text FROM r32_messages WHERE session_key=?").run(targetKey);
  }
  return { targetKey, sourceKeys, displayName, avatar, referenceStats };
}

function findRowsForAliases(db, accountId, aliases, sourceAccountIds = []) {
  const aliasSet = new Set(aliases);
  const accountIds = [...new Set([accountId, ...(sourceAccountIds || [])].map(value => clean(value, 180)).filter(Boolean))];
  const placeholders = accountIds.map(() => '?').join(',');
  const conversations = db.prepare(`SELECT * FROM r32_conversations WHERE account_id IN (${placeholders}) AND platform='whatsapp' AND COALESCE(merged_into,'')=''`).all(...accountIds)
    .filter(row => conversationAliases(row).some(alias => aliasSet.has(alias)));
  const contactIds = new Set(conversations.map(row => clean(row.contact_id)).filter(Boolean));
  const contacts = db.prepare(`SELECT * FROM contacts WHERE account_id IN (${placeholders}) AND platform='whatsapp' AND merged_into_id=''`).all(...accountIds)
    .filter(row => contactIds.has(row.id) || contactAliases(row).some(alias => aliasSet.has(alias)));
  return { conversations, contacts, accountIds };
}

function ensureAliasSchema(db) {
  const conversationColumns = new Set(columns(db, 'r32_conversations'));
  for (const [name, definition] of [
    ['merged_into', "TEXT NOT NULL DEFAULT ''"],
    ['merged_at', "TEXT NOT NULL DEFAULT ''"],
    ['merge_reason', "TEXT NOT NULL DEFAULT ''"]
  ]) {
    if (!conversationColumns.has(name)) db.exec(`ALTER TABLE r32_conversations ADD COLUMN ${name} ${definition}`);
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_r32_conversations_merged ON r32_conversations(merged_into, merged_at)');
  db.exec(`
    CREATE TABLE IF NOT EXISTS identity_aliases (
      id TEXT PRIMARY KEY, platform TEXT NOT NULL, alias_type TEXT NOT NULL, alias_value TEXT NOT NULL,
      canonical_account_id TEXT NOT NULL DEFAULT '', canonical_contact_id TEXT NOT NULL DEFAULT '', confidence TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT '', payload_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS identity_merge_audit (
      id TEXT PRIMARY KEY, platform TEXT NOT NULL, entity_type TEXT NOT NULL, source_id TEXT NOT NULL, target_id TEXT NOT NULL,
      confidence TEXT NOT NULL DEFAULT '', reason TEXT NOT NULL DEFAULT '', report_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
    ) STRICT;
  `);
}

function mergeConversationAliases(input = {}) {
  const store = getStore();
  const db = store.db;
  const accountId = clean(input.accountId, 180);
  const resolved = authority.resolve(accountId, uniq([...(input.aliases || []), input.canonicalJid])) || null;
  const aliases = uniq([...(input.aliases || []), input.canonicalJid, ...(resolved?.aliases || [])]);
  const canonicalJid = authority.chooseCanonical(aliases, input.canonicalJid || resolved?.canonicalJid || '');
  if (!accountId || !canonicalJid || !aliases.length) return { merged: false, reason: 'missing-identity' };
  const sourceAccountIds = [...new Set((input.sourceAccountIds || []).map(value => clean(value, 180)).filter(value => value && value !== accountId))];
  const at = nowIso();
  let report = null;
  store.transaction(() => {
    ensureAliasSchema(db);
    const found = findRowsForAliases(db, accountId, aliases, sourceAccountIds);
    if (!found.conversations.length && !found.contacts.length) {
      report = { merged: false, accountId, canonicalJid, aliases, reason: 'no-persisted-rows' };
      return;
    }
    const contactId = mergeContacts(db, found.contacts, canonicalJid, aliases, resolved, at, accountId) || clean(found.conversations[0]?.contact_id) || stableId('contact', ['whatsapp', accountId, canonicalJid]);
    const sourceContactIds = [...new Set(found.contacts.map(row => clean(row.id)).filter(id => id && id !== contactId))];
    if (!found.contacts.length) {
      db.prepare(`INSERT OR IGNORE INTO contacts(id,platform,account_id,external_id,display_name,phone,avatar_url,avatar_updated_at,avatar_status,tags_json,aliases_json,source,last_seen_at,archived_at,archive_reason,archived_by,payload_json,created_at,updated_at,canonical_contact_id,merged_into_id,tombstoned_at)
        VALUES(?,?,?,?,?,?,?,?,?,'[]',?,'whatsapp-conversation-merge','','','','',?,?,?,?,'','')`)
        .run(contactId, 'whatsapp', accountId, canonicalJid, resolved?.displayName || `+${normalizePhone(canonicalJid)}`, normalizePhone(canonicalJid), resolved?.avatarUrl || '', '', resolved?.avatarUrl ? 'ready' : '', json(aliases), json({ canonicalJid, aliases }), at, at, contactId);
    }
    const conv = found.conversations.length ? mergeConversations(store, found.conversations, accountId, canonicalJid, aliases, contactId, sourceContactIds, resolved, at) : { targetKey: `${accountId}:${canonicalJid}`, sourceKeys: [], displayName: resolved?.displayName || '', avatar: resolved?.avatarUrl || '' };
    if (conv.displayName || conv.avatar) {
      const contact = db.prepare('SELECT payload_json FROM contacts WHERE id=?').get(contactId);
      const contactPayload = deepMerge(parse(contact?.payload_json, {}), {
        canonicalJid, aliases, displayName: conv.displayName, contactName: conv.displayName,
        ...(conv.avatar ? { avatarUrl: conv.avatar } : {})
      });
      db.prepare(`UPDATE contacts SET display_name=CASE WHEN ?<>'' THEN ? ELSE display_name END,
        avatar_url=CASE WHEN ?<>'' THEN ? ELSE avatar_url END,
        avatar_status=CASE WHEN ?<>'' THEN 'ready' ELSE avatar_status END,
        aliases_json=?,payload_json=?,updated_at=? WHERE id=?`)
        .run(conv.displayName, conv.displayName, conv.avatar, conv.avatar, conv.avatar, json(aliases), json(contactPayload), at, contactId);
    }
    for (const alias of aliases) {
      const id = stableId('identity-alias', ['whatsapp', accountId, alias]);
      db.prepare(`INSERT INTO identity_aliases(id,platform,alias_type,alias_value,canonical_account_id,canonical_contact_id,confidence,source,payload_json,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,'whatsapp-authority',?,?,?) ON CONFLICT(id) DO UPDATE SET canonical_contact_id=excluded.canonical_contact_id,payload_json=excluded.payload_json,updated_at=excluded.updated_at`)
        .run(id, 'whatsapp', authority.classifyJid(alias).kind, alias, accountId, contactId, 'verified', json({ canonicalJid, conversationId: conv.targetKey, aliases }), at, at);
    }
    for (const sourceKey of conv.sourceKeys) {
      db.prepare(`INSERT INTO identity_merge_audit(id,platform,entity_type,source_id,target_id,confidence,reason,report_json,created_at)
        VALUES(?,?,?,?,?,'verified','whatsapp-jid-alias',?,?)
        ON CONFLICT(id) DO UPDATE SET target_id=excluded.target_id,confidence=excluded.confidence,reason=excluded.reason,report_json=excluded.report_json,created_at=excluded.created_at`)
        .run(stableId('identity-merge', [sourceKey, conv.targetKey]), 'whatsapp', 'conversation', sourceKey, conv.targetKey, json({ accountId, canonicalJid, aliases, contactId }), at);
    }
    const integrity = assertMergeIntegrity(db, { accountId, canonicalJid, aliases, targetConversationId: conv.targetKey, sourceConversationIds: conv.sourceKeys, targetContactId: contactId, sourceContactIds });
    report = { merged: conv.sourceKeys.length > 0 || sourceContactIds.length > 0, accountId, sourceAccountIds, canonicalJid, aliases, contactId, sourceContactIds, conversationId: conv.targetKey, sourceConversationIds: conv.sourceKeys, displayName: conv.displayName, avatarUrl: conv.avatar, referenceStats: conv.referenceStats || {}, integrity };
  });
  if (report?.contactId && report?.canonicalJid) {
    try {
      authority.record({
        accountId: report.accountId,
        aliases: report.aliases,
        canonicalJid: report.canonicalJid,
        displayName: report.displayName,
        nameScore: 106,
        nameSource: 'conversation-database-merge',
        avatarUrl: report.avatarUrl,
        avatarSource: report.avatarUrl ? 'conversation-database-merge' : ''
      });
    } catch (error) {
      logger.warn('whatsapp', 'conversation-authority-refresh-failed', { accountId: report.accountId, canonicalJid: report.canonicalJid, error: error.message });
    }
  }
  if (report?.merged) eventBus.publish('conversation:merged', report);
  return report;
}

function canonicalizeMessage(message = {}) {
  if (!message || clean(message.platform || 'whatsapp').toLowerCase() !== 'whatsapp') return message;
  const accountId = clean(message.accountId, 180);
  const aliases = uniq([message.chatJid, message.rawMeta?.rawJid, message.rawMeta?.remoteJid, message.rawMeta?.remoteJidAlt, message.rawMeta?.canonicalJid]);
  const resolved = authority.resolve(accountId, aliases);
  const canonicalJid = authority.chooseCanonical([...(resolved?.aliases || []), ...aliases], resolved?.canonicalJid || message.chatJid);
  if (!accountId || !canonicalJid) return message;
  const report = mergeConversationAliases({ accountId, aliases: [...aliases, ...(resolved?.aliases || [])], canonicalJid });
  const conversationId = report?.conversationId || `${accountId}:${canonicalJid}`;
  const external = clean(message.externalMessageId || message.id);
  return {
    ...message,
    conversationId,
    sessionKey: conversationId,
    chatJid: canonicalJid,
    contactId: report?.contactId || message.contactId || '',
    contactName: report?.displayName || resolved?.displayName || message.contactName || message.senderName || '',
    avatarUrl: report?.avatarUrl || resolved?.avatarUrl || message.avatarUrl || '',
    dedupeKey: external ? `${accountId}:${canonicalJid}:${external}` : message.dedupeKey,
    rawMeta: { ...(message.rawMeta || {}), canonicalJid, aliases: [...new Set([...(message.rawMeta?.aliases || []), ...aliases])] }
  };
}

class IdentityUnionFind {
  constructor() { this.parent = new Map(); }
  add(value) { if (value && !this.parent.has(value)) this.parent.set(value, value); }
  find(value) {
    this.add(value);
    const parent = this.parent.get(value);
    if (parent !== value) this.parent.set(value, this.find(parent));
    return this.parent.get(value);
  }
  union(left, right) {
    if (!left || !right) return;
    const a = this.find(left), b = this.find(right);
    if (a !== b) this.parent.set(b, a);
  }
  groups() {
    const output = new Map();
    for (const value of this.parent.keys()) {
      const root = this.find(value);
      if (!output.has(root)) output.set(root, []);
      output.get(root).push(value);
    }
    return [...output.values()].map(values => [...new Set(values)]);
  }
}

function persistedIdentityGroups(db, accountId) {
  const normalizedAccountId = clean(accountId, 180);
  const uf = new IdentityUnionFind();
  const evidence = [];
  const add = (values, source, sourceId = '') => {
    const aliases = uniq(values || []);
    aliases.forEach(alias => uf.add(alias));
    for (let index = 1; index < aliases.length; index += 1) uf.union(aliases[0], aliases[index]);
    if (aliases.length) evidence.push({ aliases, source, sourceId: clean(sourceId, 500) });
  };
  if (tableExists(db, 'whatsapp_identity_authority')) {
    const rows = db.prepare('SELECT alias_jid,canonical_jid,aliases_json FROM whatsapp_identity_authority WHERE account_id=?').all(normalizedAccountId);
    for (const row of rows) add([row.alias_jid, row.canonical_jid, ...parse(row.aliases_json, [])], 'whatsapp_identity_authority', row.alias_jid);
  }
  if (tableExists(db, 'contacts')) {
    const rows = db.prepare("SELECT * FROM contacts WHERE account_id=? AND platform='whatsapp' AND COALESCE(merged_into_id,'')='' ").all(normalizedAccountId);
    for (const row of rows) add(contactAliases(row), 'contacts', row.id);
  }
  if (tableExists(db, 'r32_conversations')) {
    const rows = db.prepare("SELECT * FROM r32_conversations WHERE account_id=? AND platform='whatsapp' AND COALESCE(merged_into,'')='' ").all(normalizedAccountId);
    for (const row of rows) add(conversationAliases(row), 'r32_conversations', row.session_key);
  }
  const byPhone = new Map();
  for (const alias of uf.parent.keys()) {
    const classified = authority.classifyJid(alias);
    if (!classified.valid || classified.kind !== 'phone-jid') continue;
    const phone = normalizePhone(classified.normalized);
    if (!phone) continue;
    if (byPhone.has(phone)) uf.union(byPhone.get(phone), alias);
    else byPhone.set(phone, alias);
  }
  return {
    groups: uf.groups().map(aliases => ({ aliases, canonicalJid: authority.chooseCanonical(aliases), evidence: evidence.filter(row => row.aliases.some(alias => aliases.includes(alias))) }))
      .filter(group => group.canonicalJid && group.aliases.length),
    evidence
  };
}


function ensureSchema() {
  const store = getStore();
  store.transaction(() => ensureAliasSchema(store.db));
  return { ready: true, conversationMergeColumns: ['merged_into', 'merged_at', 'merge_reason'] };
}

function reconcileAccount(accountId) {
  authority.ensureSchema();
  const db = getStore().db;
  const normalizedAccountId = clean(accountId, 180);
  const discovered = persistedIdentityGroups(db, normalizedAccountId);
  const reports = [];
  for (const group of discovered.groups) {
    try {
      const resolved = authority.record({
        accountId: normalizedAccountId,
        aliases: group.aliases,
        canonicalJid: group.canonicalJid,
        source: 'startup-persisted-reconciliation'
      }) || { aliases: group.aliases, canonicalJid: group.canonicalJid };
      const report = mergeConversationAliases({ accountId: normalizedAccountId, aliases: resolved.aliases || group.aliases, canonicalJid: resolved.canonicalJid || group.canonicalJid });
      reports.push({ ...report, discoveredFromPersistedRows: true, evidenceSources: [...new Set(group.evidence.map(row => row.source))] });
    } catch (error) {
      logger.warn('whatsapp', 'conversation-alias-merge-failed', {
        operation: 'reconcileAccount',
        accountId: normalizedAccountId,
        canonicalJid: group.canonicalJid,
        reasonCode: error.code || 'WHATSAPP_CONVERSATION_ALIAS_MERGE_FAILED',
        httpStatus: Number(error.status || 0),
        attempt: Number(error.attempt || 1),
        nextRetryAt: error.nextRetryAt || ''
      });
    }
  }
  return reports;
}

module.exports = { ensureSchema, mergeConversationAliases, canonicalizeMessage, reconcileAccount, persistedIdentityGroups, conversationAliases, contactAliases, rewriteMessagePayload };
