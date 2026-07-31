'use strict';

const { getStore } = require('../repositories/storeProvider');
const { parseJson, stableId } = require('../lib/r32SqliteStore');
const merger = require('./whatsappConversationMergeService');
const authority = require('./whatsappIdentityAuthority');
const logger = require('./logger');

function clean(value, max = 4000) { return String(value == null ? '' : value).trim().slice(0, max); }
function parse(value, fallback) { return parseJson(value, fallback); }
function json(value) { return JSON.stringify(value == null ? {} : value); }
function nowIso() { return new Date().toISOString(); }
function tableExists(db, name) { return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name)); }
function columns(db, table) { return db.prepare(`PRAGMA table_info(${JSON.stringify(table)})`).all().map(row => clean(row.name)); }
function uniq(values) { return [...new Set((values || []).map(authority.normalizeJid).filter(Boolean))]; }
function quoteIdentifier(value) { return `\"${String(value).replace(/\"/g, '\"\"')}\"`; }

function activeWhatsappAccounts(db) {
  if (!tableExists(db, 'r32_accounts')) return [];
  return db.prepare(`
    SELECT id,adapter_account_id,display_name,payload_json,lifecycle_state,merged_into_id,tombstoned_at
    FROM r32_accounts
    WHERE platform='whatsapp'
      AND COALESCE(lifecycle_state,'active') NOT IN ('merged','tombstoned','deleted')
      AND COALESCE(merged_into_id,'')=''
      AND COALESCE(tombstoned_at,'')=''
  `).all().map(row => ({ ...row, id: clean(row.id) })).filter(row => row.id);
}

function dataAccountIds(db) {
  const output = new Set();
  for (const [table, where] of [
    ['contacts', "platform='whatsapp'"],
    ['r32_conversations', "platform='whatsapp'"],
    ['r32_messages', "account_id LIKE 'wh-%'"]
  ]) {
    if (!tableExists(db, table) || !columns(db, table).includes('account_id')) continue;
    for (const row of db.prepare(`SELECT DISTINCT account_id FROM ${table} WHERE ${where}`).all()) if (clean(row.account_id)) output.add(clean(row.account_id));
  }
  return [...output];
}

function canonicalForAliases(values) {
  const aliases = uniq(values);
  const canonicalJid = authority.chooseCanonical(aliases);
  const classified = authority.classifyJid(canonicalJid);
  if (!classified.valid || classified.kind !== 'phone-jid') return { aliases, canonicalJid: '' };
  return { aliases, canonicalJid: classified.normalized };
}

function accountIdentityGroups(db, accountId) {
  const groups = new Map();
  const add = (values, source, sourceId) => {
    const resolved = canonicalForAliases(values);
    if (!resolved.canonicalJid) return;
    if (!groups.has(resolved.canonicalJid)) groups.set(resolved.canonicalJid, { canonicalJid: resolved.canonicalJid, aliases: new Set(), evidence: [] });
    const group = groups.get(resolved.canonicalJid);
    resolved.aliases.forEach(alias => group.aliases.add(alias));
    group.evidence.push({ source, sourceId: clean(sourceId) });
  };
  if (tableExists(db, 'contacts')) {
    for (const row of db.prepare("SELECT * FROM contacts WHERE platform='whatsapp' AND account_id=? AND COALESCE(merged_into_id,'')='' AND COALESCE(tombstoned_at,'')=''").all(accountId)) {
      add(merger.contactAliases(row), 'contacts', row.id);
    }
  }
  if (tableExists(db, 'r32_conversations')) {
    const hasMerged = columns(db, 'r32_conversations').includes('merged_into');
    const sql = `SELECT * FROM r32_conversations WHERE platform='whatsapp' AND account_id=?${hasMerged ? " AND COALESCE(merged_into,'')=''" : ''}`;
    for (const row of db.prepare(sql).all(accountId)) add(merger.conversationAliases(row), 'r32_conversations', row.session_key);
  }
  if (tableExists(db, 'whatsapp_identity_authority')) {
    for (const row of db.prepare('SELECT alias_jid,canonical_jid,aliases_json FROM whatsapp_identity_authority WHERE account_id=?').all(accountId)) {
      add([row.alias_jid, row.canonical_jid, ...parse(row.aliases_json, [])], 'whatsapp_identity_authority', row.alias_jid);
    }
  }
  return new Map([...groups.entries()].map(([key, value]) => [key, { ...value, aliases: [...value.aliases] }]));
}

function messageEvidence(db, accountId) {
  const output = new Map();
  if (!tableExists(db, 'r32_messages')) return output;
  for (const row of db.prepare('SELECT id,session_key,payload_json FROM r32_messages WHERE account_id=?').all(accountId)) {
    const payload = parse(row.payload_json, {});
    const suffix = clean(row.session_key).includes(':') ? clean(row.session_key).slice(clean(row.session_key).indexOf(':') + 1) : '';
    const resolved = canonicalForAliases([
      payload.chatJid, payload.canonicalJid, payload.rawJid,
      payload.rawMeta?.canonicalJid, payload.rawMeta?.remoteJid, payload.rawMeta?.rawJid,
      suffix
    ]);
    if (!resolved.canonicalJid) continue;
    const external = clean(payload.externalMessageId || payload.messageId || (clean(row.id).includes(':') ? clean(row.id).split(':').pop() : row.id));
    if (!external) continue;
    if (!output.has(resolved.canonicalJid)) output.set(resolved.canonicalJid, new Set());
    output.get(resolved.canonicalJid).add(external);
  }
  return output;
}

function discoverOrphanAccountAliases(db = getStore().db) {
  const active = activeWhatsappAccounts(db);
  const activeIds = new Set(active.map(row => row.id));
  const orphans = dataAccountIds(db).filter(accountId => !activeIds.has(accountId));
  const activeEvidence = new Map(active.map(row => [row.id, { groups: accountIdentityGroups(db, row.id), messages: messageEvidence(db, row.id) }]));
  const plans = [];
  for (const sourceAccountId of orphans) {
    const sourceGroups = accountIdentityGroups(db, sourceAccountId);
    const sourceMessages = messageEvidence(db, sourceAccountId);
    const sourceJids = [...sourceGroups.keys()];
    const candidates = active.map(account => {
      const target = activeEvidence.get(account.id);
      const sharedCanonicalJids = sourceJids.filter(jid => target.groups.has(jid));
      let sharedExternalMessageIds = 0;
      for (const jid of sharedCanonicalJids) {
        const left = sourceMessages.get(jid) || new Set();
        const right = target.messages.get(jid) || new Set();
        for (const external of left) if (right.has(external)) sharedExternalMessageIds += 1;
      }
      const sourceCoverage = sourceJids.length ? sharedCanonicalJids.length / sourceJids.length : 0;
      return {
        targetAccountId: account.id,
        targetDisplayName: clean(account.display_name),
        sourceCanonicalJids: sourceJids.length,
        sharedCanonicalJids,
        sharedCanonicalJidCount: sharedCanonicalJids.length,
        sharedExternalMessageIds,
        sourceCoverage,
        score: sharedExternalMessageIds * 1000 + sharedCanonicalJids.length * 100 + Math.round(sourceCoverage * 100)
      };
    }).sort((a, b) => b.score - a.score);
    const best = candidates[0] || null;
    const second = candidates[1] || null;
    const eligible = Boolean(best && sourceJids.length >= 2 && best.sharedCanonicalJidCount >= 2 && best.sharedExternalMessageIds >= 2 && best.sourceCoverage >= 0.75 && (!second || second.score === 0 || best.score >= second.score * 2));
    plans.push({
      sourceAccountId,
      sourceCanonicalJids: sourceJids,
      candidates,
      targetAccountId: eligible ? best.targetAccountId : '',
      eligible,
      reasonCode: eligible ? 'WHATSAPP_ORPHAN_ACCOUNT_HIGH_CONFIDENCE_MATCH' : 'WHATSAPP_ORPHAN_ACCOUNT_AMBIGUOUS'
    });
  }
  return { activeAccounts: active, orphanAccountIds: orphans, plans };
}

const ACCOUNT_JSON_KEYS = new Set(['accountId', 'account_id', 'canonicalAccountId', 'canonical_account_id', 'sourceAccountId', 'source_account_id']);
function rewriteAccountValue(value, sourceAccountId, targetAccountId, key = '') {
  if (Array.isArray(value)) return value.map(item => rewriteAccountValue(item, sourceAccountId, targetAccountId, ''));
  if (value && typeof value === 'object') {
    const output = {};
    for (const [childKey, childValue] of Object.entries(value)) output[childKey] = rewriteAccountValue(childValue, sourceAccountId, targetAccountId, childKey);
    return output;
  }
  if (typeof value === 'string' && ACCOUNT_JSON_KEYS.has(key) && clean(value) === sourceAccountId) return targetAccountId;
  return value;
}

function rewriteAccountJsonReferences(db, sourceAccountId, targetAccountId, at) {
  let documents = 0;
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'r32_messages_fts%'").all();
  for (const { name } of rows) {
    const jsonColumns = columns(db, name).filter(column => /_json$/u.test(column) || column === 'payload_json' || column === 'request_json' || column === 'result_json');
    if (!jsonColumns.length) continue;
    for (const column of jsonColumns) {
      let matches;
      try {
        matches = db.prepare(`SELECT rowid AS __rowid,${quoteIdentifier(column)} AS value FROM ${quoteIdentifier(name)} WHERE ${quoteIdentifier(column)} LIKE ?`).all(`%${sourceAccountId}%`);
      } catch (error) {
        logger.warn('whatsapp', 'account-json-reference-scan-skipped', {
          operation: 'rewriteAccountJsonReferences', table: name, column,
          reasonCode: error.code || 'WHATSAPP_ACCOUNT_JSON_SCAN_FAILED'
        });
        continue;
      }
      for (const row of matches) {
        let parsed;
        try { parsed = JSON.parse(String(row.value || '')); }
        catch (error) {
          logger.warn('whatsapp', 'account-json-reference-invalid-json', {
            operation: 'rewriteAccountJsonReferences', table: name, column,
            reasonCode: error.code || 'WHATSAPP_ACCOUNT_JSON_PARSE_FAILED'
          });
          continue;
        }
        const rewritten = JSON.stringify(rewriteAccountValue(parsed, sourceAccountId, targetAccountId));
        if (rewritten === String(row.value || '')) continue;
        const hasUpdated = columns(db, name).includes('updated_at');
        db.prepare(`UPDATE ${quoteIdentifier(name)} SET ${quoteIdentifier(column)}=?${hasUpdated ? `,${quoteIdentifier('updated_at')}=?` : ''} WHERE rowid=?`).run(rewritten, ...(hasUpdated ? [at] : []), row.__rowid);
        documents += 1;
      }
    }
  }
  return documents;
}


function mergeAuthorityAccountRows(db, sourceAccountId, targetAccountId, at) {
  if (!tableExists(db, 'whatsapp_identity_authority')) return { moved: 0, merged: 0 };
  let moved = 0;
  let merged = 0;
  const rows = db.prepare('SELECT * FROM whatsapp_identity_authority WHERE account_id=?').all(sourceAccountId);
  for (const row of rows) {
    const target = db.prepare('SELECT * FROM whatsapp_identity_authority WHERE account_id=? AND alias_jid=?').get(targetAccountId, row.alias_jid);
    if (!target) {
      db.prepare('UPDATE whatsapp_identity_authority SET account_id=?,updated_at=? WHERE account_id=? AND alias_jid=?')
        .run(targetAccountId, at, sourceAccountId, row.alias_jid);
      moved += 1;
      continue;
    }
    const aliases = uniq([
      ...parse(target.aliases_json, []), ...parse(row.aliases_json, []),
      target.alias_jid, target.canonical_jid, row.alias_jid, row.canonical_jid
    ]);
    const canonicalJid = authority.chooseCanonical(aliases, target.canonical_jid || row.canonical_jid);
    const targetNameScore = Number(target.name_score || 0);
    const sourceNameScore = Number(row.name_score || 0);
    const displayName = sourceNameScore > targetNameScore && clean(row.display_name) ? row.display_name : target.display_name;
    const nameScore = Math.max(targetNameScore, sourceNameScore);
    const nameSource = sourceNameScore > targetNameScore && clean(row.name_source) ? row.name_source : target.name_source;
    const avatarUrl = clean(target.avatar_url) || clean(row.avatar_url);
    const avatarSource = clean(target.avatar_url) ? target.avatar_source : row.avatar_source;
    db.prepare(`UPDATE whatsapp_identity_authority SET canonical_jid=?,display_name=?,name_score=?,name_source=?,avatar_url=?,avatar_source=?,aliases_json=?,updated_at=?
      WHERE account_id=? AND alias_jid=?`)
      .run(canonicalJid, displayName, nameScore, nameSource, avatarUrl, avatarSource, json(aliases), at, targetAccountId, row.alias_jid);
    db.prepare('DELETE FROM whatsapp_identity_authority WHERE account_id=? AND alias_jid=?').run(sourceAccountId, row.alias_jid);
    merged += 1;
  }
  return { moved, merged };
}

function rebindIdentityAliases(db, sourceAccountId, targetAccountId, at) {
  if (!tableExists(db, 'identity_aliases')) return 0;
  const rows = db.prepare("SELECT * FROM identity_aliases WHERE platform='whatsapp' AND canonical_account_id=?").all(sourceAccountId);
  let moved = 0;
  for (const row of rows) {
    const payload = rewriteAccountValue(parse(row.payload_json, {}), sourceAccountId, targetAccountId);
    db.prepare('UPDATE identity_aliases SET canonical_account_id=?,payload_json=?,updated_at=? WHERE id=?')
      .run(targetAccountId, json(payload), at, row.id);
    moved += 1;
  }
  return moved;
}


function mergeAccountScopedIdentityRows(db, sourceAccountId, targetAccountId, at) {
  const report = { externalIdentitiesMerged: 0, externalIdentitiesMoved: 0, identityLinksMerged: 0, identityLinksMoved: 0 };
  if (tableExists(db, 'external_identities')) {
    const rows = db.prepare("SELECT * FROM external_identities WHERE platform='whatsapp' AND account_id=?").all(sourceAccountId);
    for (const row of rows) {
      const target = db.prepare("SELECT * FROM external_identities WHERE workspace_id=? AND platform='whatsapp' AND account_id=? AND external_id=?")
        .get(clean(row.workspace_id) || 'default', targetAccountId, row.external_id);
      if (!target) {
        const payload = rewriteAccountValue(parse(row.payload_json, {}), sourceAccountId, targetAccountId);
        db.prepare('UPDATE external_identities SET account_id=?,payload_json=?,updated_at=? WHERE external_identity_id=?')
          .run(targetAccountId, json(payload), at, row.external_identity_id);
        report.externalIdentitiesMoved += 1;
        continue;
      }
      for (const [table, column] of [
        ['identity_links','external_identity_id'], ['conversation_bindings','external_identity_id'], ['r32_messages','external_identity_id'],
        ['outbox_routes','external_identity_id'], ['outbox_route_versions','external_identity_id']
      ]) {
        if (!tableExists(db, table) || !columns(db, table).includes(column)) continue;
        db.prepare(`UPDATE ${quoteIdentifier(table)} SET ${quoteIdentifier(column)}=? WHERE ${quoteIdentifier(column)}=?`)
          .run(target.external_identity_id, row.external_identity_id);
      }
      const mergedPayload = json({
        ...parse(target.payload_json, {}), ...rewriteAccountValue(parse(row.payload_json, {}), sourceAccountId, targetAccountId),
        mergedExternalIdentityId: row.external_identity_id, mergedAt: at
      });
      db.prepare(`UPDATE external_identities SET
        contact_id=CASE WHEN COALESCE(contact_id,'')='' THEN ? ELSE contact_id END,
        person_id=CASE WHEN COALESCE(person_id,'')='' THEN ? ELSE person_id END,
        identity_link_id=CASE WHEN COALESCE(identity_link_id,'')='' THEN ? ELSE identity_link_id END,
        state=CASE WHEN state='verified' OR ?='verified' THEN 'verified' ELSE state END,
        payload_json=?,updated_at=? WHERE external_identity_id=?`)
        .run(row.contact_id || null, row.person_id || null, row.identity_link_id || null, row.state, mergedPayload, at, target.external_identity_id);
      db.prepare('DELETE FROM external_identities WHERE external_identity_id=?').run(row.external_identity_id);
      report.externalIdentitiesMerged += 1;
    }
  }
  if (tableExists(db, 'identity_links')) {
    const rows = db.prepare("SELECT * FROM identity_links WHERE platform='whatsapp' AND source_account_id=? AND link_status<>'merged'").all(sourceAccountId);
    for (const row of rows) {
      const target = db.prepare("SELECT * FROM identity_links WHERE workspace_id=? AND platform='whatsapp' AND source_account_id=? AND external_id=?")
        .get(clean(row.workspace_id) || 'default', targetAccountId, row.external_id);
      if (!target) {
        const payload = rewriteAccountValue(parse(row.payload_json, {}), sourceAccountId, targetAccountId);
        db.prepare('UPDATE identity_links SET source_account_id=?,payload_json=?,updated_at=? WHERE identity_link_id=?')
          .run(targetAccountId, json(payload), at, row.identity_link_id);
        report.identityLinksMoved += 1;
        continue;
      }
      for (const [table, column] of [
        ['external_identities','identity_link_id'], ['conversation_bindings','identity_link_id'],
        ['outbox_routes','identity_link_id'], ['outbox_route_versions','identity_link_id']
      ]) {
        if (!tableExists(db, table) || !columns(db, table).includes(column)) continue;
        db.prepare(`UPDATE ${quoteIdentifier(table)} SET ${quoteIdentifier(column)}=? WHERE ${quoteIdentifier(column)}=?`)
          .run(target.identity_link_id, row.identity_link_id);
      }
      const mergedPayload = json({
        ...parse(target.payload_json, {}), ...rewriteAccountValue(parse(row.payload_json, {}), sourceAccountId, targetAccountId),
        mergedIdentityLinkId: row.identity_link_id, mergedAt: at
      });
      db.prepare(`UPDATE identity_links SET confidence=MAX(confidence,?),verification_method=CASE WHEN verification_method<>'' THEN verification_method ELSE ? END,
        evidence_refs_json=?,payload_json=?,updated_at=? WHERE identity_link_id=?`)
        .run(Number(row.confidence || 0), row.verification_method || '', json([...(parse(target.evidence_refs_json, []) || []), ...(parse(row.evidence_refs_json, []) || [])]), mergedPayload, at, target.identity_link_id);
      db.prepare("UPDATE identity_links SET link_status='merged',superseded_by=?,updated_at=? WHERE identity_link_id=?")
        .run(target.identity_link_id, at, row.identity_link_id);
      report.identityLinksMerged += 1;
    }
  }
  return report;
}

function rebindRemainingAccountColumns(db, sourceAccountId, targetAccountId, at) {
  const excluded = new Set(['r32_accounts', 'contacts', 'r32_conversations', 'r32_messages', 'whatsapp_identity_authority', 'external_identities', 'outbox_routes', 'outbox_route_versions', 'r32_send_queue']);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  const report = [];
  for (const { name } of tables) {
    if (excluded.has(name)) continue;
    const names = columns(db, name);
    if (!names.includes('account_id')) continue;
    const count = Number(db.prepare(`SELECT COUNT(*) AS n FROM ${quoteIdentifier(name)} WHERE account_id=?`).get(sourceAccountId)?.n || 0);
    if (!count) continue;
    try {
      const hasUpdated = names.includes('updated_at');
      db.prepare(`UPDATE ${quoteIdentifier(name)} SET account_id=?${hasUpdated ? `,${quoteIdentifier('updated_at')}=?` : ''} WHERE account_id=?`)
        .run(targetAccountId, ...(hasUpdated ? [at] : []), sourceAccountId);
    } catch (error) {
      const wrapped = new Error(`WhatsApp 跨账号绑定迁移冲突：${name}.account_id`);
      wrapped.code = 'WHATSAPP_ACCOUNT_REBIND_CONFLICT';
      wrapped.table = name;
      wrapped.cause = error;
      throw wrapped;
    }
    report.push({ table: name, moved: count });
  }
  return report;
}

function sourceOperationalAccountReferences(db, sourceAccountId) {
  const excluded = new Set(['r32_accounts', 'contacts', 'r32_conversations']);
  const leaks = [];
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  for (const { name } of tables) {
    if (excluded.has(name)) continue;
    const names = columns(db, name);
    if (!names.includes('account_id')) continue;
    const count = Number(db.prepare(`SELECT COUNT(*) AS n FROM ${quoteIdentifier(name)} WHERE account_id=?`).get(sourceAccountId)?.n || 0);
    if (count) leaks.push({ table: name, count });
  }
  if (tableExists(db, 'identity_aliases')) {
    const count = Number(db.prepare("SELECT COUNT(*) AS n FROM identity_aliases WHERE platform='whatsapp' AND canonical_account_id=?").get(sourceAccountId)?.n || 0);
    if (count) leaks.push({ table: 'identity_aliases', column: 'canonical_account_id', count });
  }
  return leaks;
}

function invalidIdentityRows(db, accountIds) {
  const ids = [...new Set(accountIds.filter(Boolean))];
  if (!ids.length) return { contacts: [], conversations: [] };
  const placeholders = ids.map(() => '?').join(',');
  const contacts = tableExists(db, 'contacts') ? db.prepare(`SELECT * FROM contacts WHERE platform='whatsapp' AND account_id IN (${placeholders}) AND COALESCE(merged_into_id,'')='' AND COALESCE(tombstoned_at,'')=''`).all(...ids)
    .filter(row => !canonicalForAliases(merger.contactAliases(row)).canonicalJid) : [];
  const hasMerged = tableExists(db, 'r32_conversations') && columns(db, 'r32_conversations').includes('merged_into');
  const conversations = tableExists(db, 'r32_conversations') ? db.prepare(`SELECT * FROM r32_conversations WHERE platform='whatsapp' AND account_id IN (${placeholders})${hasMerged ? " AND COALESCE(merged_into,'')=''" : ''}`).all(...ids)
    .filter(row => !canonicalForAliases(merger.conversationAliases(row)).canonicalJid) : [];
  return { contacts, conversations };
}

function quarantineInvalidRows(db, sourceAccountId, targetAccountId, at) {
  const rows = invalidIdentityRows(db, [sourceAccountId, targetAccountId]);
  const quarantineTarget = `quarantine:whatsapp-invalid:${targetAccountId}`;
  for (const row of rows.contacts) {
    const payload = { ...parse(row.payload_json, {}), quarantineReason: 'invalid-whatsapp-identity', quarantineAt: at, sourceAccountId: row.account_id, canonicalAccountId: targetAccountId };
    db.prepare("UPDATE contacts SET tombstoned_at=?,archived_at=?,archive_reason='invalid-whatsapp-identity',archived_by='reconciliation',payload_json=?,updated_at=? WHERE id=?")
      .run(at, at, json(payload), at, row.id);
    db.prepare(`INSERT INTO identity_merge_audit(id,platform,entity_type,source_id,target_id,confidence,reason,report_json,created_at)
      VALUES(?,?,?,?,?,'verified','whatsapp-invalid-identity',?,?) ON CONFLICT(id) DO NOTHING`)
      .run(stableId('identity-merge', ['invalid-contact', row.id]), 'whatsapp', 'contact-quarantine', row.id, quarantineTarget, json({ accountId: row.account_id }), at);
  }
  for (const row of rows.conversations) {
    const payload = { ...parse(row.payload_json, {}), mergedInto: quarantineTarget, mergedAt: at, mergeReason: 'whatsapp-invalid-identity', canonicalAccountId: targetAccountId };
    db.prepare("UPDATE r32_conversations SET merged_into=?,merged_at=?,merge_reason='whatsapp-invalid-identity',unread_count=0,route_state='',payload_json=?,updated_at=? WHERE session_key=?")
      .run(quarantineTarget, at, json(payload), at, row.session_key);
    db.prepare("UPDATE r32_messages SET account_id=? WHERE session_key=?").run(targetAccountId, row.session_key);
    db.prepare(`INSERT INTO identity_merge_audit(id,platform,entity_type,source_id,target_id,confidence,reason,report_json,created_at)
      VALUES(?,?,?,?,?,'verified','whatsapp-invalid-identity',?,?) ON CONFLICT(id) DO NOTHING`)
      .run(stableId('identity-merge', ['invalid-conversation', row.session_key]), 'whatsapp', 'conversation-quarantine', row.session_key, quarantineTarget, json({ accountId: row.account_id }), at);
  }
  if (tableExists(db, 'whatsapp_identity_authority')) {
    const authorityRows = db.prepare('SELECT alias_jid,canonical_jid FROM whatsapp_identity_authority WHERE account_id=?').all(targetAccountId);
    for (const row of authorityRows) {
      const alias = authority.classifyJid(row.alias_jid);
      const canonical = authority.classifyJid(row.canonical_jid);
      if (!alias.valid || !alias.canonicalEligible || !canonical.valid || !canonical.canonicalEligible) db.prepare('DELETE FROM whatsapp_identity_authority WHERE account_id=? AND alias_jid=?').run(targetAccountId, row.alias_jid);
    }
  }
  if (tableExists(db, 'identity_aliases')) {
    const aliasRows = db.prepare("SELECT id,alias_value FROM identity_aliases WHERE platform='whatsapp' AND canonical_account_id=? AND alias_type<>'account-id'").all(targetAccountId);
    for (const row of aliasRows) {
      const classified = authority.classifyJid(row.alias_value);
      if (!classified.valid || !classified.canonicalEligible) db.prepare('DELETE FROM identity_aliases WHERE id=?').run(row.id);
    }
  }
  return { contacts: rows.contacts.map(row => row.id), conversations: rows.conversations.map(row => row.session_key), quarantineTarget };
}

function registerAccountAlias(db, sourceAccountId, targetAccountId, plan, at) {
  const id = stableId('identity-alias', ['whatsapp', 'account-id', sourceAccountId]);
  db.prepare(`INSERT INTO identity_aliases(id,platform,alias_type,alias_value,canonical_account_id,canonical_contact_id,confidence,source,payload_json,created_at,updated_at)
    VALUES(?,'whatsapp','account-id',?,?,'','verified','whatsapp-orphan-account-reconciliation',?,?,?)
    ON CONFLICT(id) DO UPDATE SET canonical_account_id=excluded.canonical_account_id,confidence=excluded.confidence,source=excluded.source,payload_json=excluded.payload_json,updated_at=excluded.updated_at`)
    .run(id, sourceAccountId, targetAccountId, json(plan), at, at);
  db.prepare(`INSERT INTO identity_merge_audit(id,platform,entity_type,source_id,target_id,confidence,reason,report_json,created_at)
    VALUES(?,'whatsapp','account',?,?,'verified','whatsapp-orphan-account-rebind',?,?)
    ON CONFLICT(id) DO UPDATE SET target_id=excluded.target_id,confidence=excluded.confidence,reason=excluded.reason,report_json=excluded.report_json,created_at=excluded.created_at`)
    .run(stableId('identity-merge', ['whatsapp-account', sourceAccountId, targetAccountId]), sourceAccountId, targetAccountId, json(plan), at);
}

function reconcilePlan(plan) {
  if (!plan?.eligible || !clean(plan.targetAccountId) || !clean(plan.sourceAccountId)) return { ...plan, applied: false, reason: 'not-eligible' };
  const store = getStore();
  const db = store.db;
  const sourceAccountId = clean(plan.sourceAccountId);
  const targetAccountId = clean(plan.targetAccountId);
  let result = null;
  store.transaction(() => {
    const sourceGroups = accountIdentityGroups(db, sourceAccountId);
    const targetGroups = accountIdentityGroups(db, targetAccountId);
    const canonicalJids = [...sourceGroups.keys()];
    const mergeReports = [];
    for (const canonicalJid of canonicalJids) {
      const aliases = uniq([...(sourceGroups.get(canonicalJid)?.aliases || []), ...(targetGroups.get(canonicalJid)?.aliases || [])]);
      const report = merger.mergeConversationAliases({ accountId: targetAccountId, sourceAccountIds: [sourceAccountId], canonicalJid, aliases });
      mergeReports.push(report);
    }
    const at = nowIso();
    const authorityAccountRows = mergeAuthorityAccountRows(db, sourceAccountId, targetAccountId, at);
    const identityAliasesMoved = rebindIdentityAliases(db, sourceAccountId, targetAccountId, at);
    const quarantine = quarantineInvalidRows(db, sourceAccountId, targetAccountId, at);
    const accountScopedIdentityMerge = mergeAccountScopedIdentityRows(db, sourceAccountId, targetAccountId, at);
    const accountColumnRebinds = rebindRemainingAccountColumns(db, sourceAccountId, targetAccountId, at);
    const rewrittenAccountJson = rewriteAccountJsonReferences(db, sourceAccountId, targetAccountId, at);
    registerAccountAlias(db, sourceAccountId, targetAccountId, plan, at);

    const sourceActiveContacts = Number(db.prepare("SELECT COUNT(*) AS n FROM contacts WHERE platform='whatsapp' AND account_id=? AND COALESCE(merged_into_id,'')='' AND COALESCE(tombstoned_at,'')=''").get(sourceAccountId)?.n || 0);
    const sourceActiveConversations = Number(db.prepare("SELECT COUNT(*) AS n FROM r32_conversations WHERE platform='whatsapp' AND account_id=? AND COALESCE(merged_into,'')='' ").get(sourceAccountId)?.n || 0);
    const sourceMessages = Number(db.prepare('SELECT COUNT(*) AS n FROM r32_messages WHERE account_id=?').get(sourceAccountId)?.n || 0);
    const sourceOperationalReferences = sourceOperationalAccountReferences(db, sourceAccountId);
    const foreignKeyErrors = db.prepare('PRAGMA foreign_key_check').all();
    const integrity = {
      ok: sourceActiveContacts === 0 && sourceActiveConversations === 0 && sourceMessages === 0 && sourceOperationalReferences.length === 0 && foreignKeyErrors.length === 0,
      sourceActiveContacts,
      sourceActiveConversations,
      sourceMessages,
      sourceOperationalReferences,
      foreignKeyErrors
    };
    if (!integrity.ok) {
      const error = new Error('WhatsApp 跨账号残留 reconciliation 完整性校验失败');
      error.code = 'WHATSAPP_ACCOUNT_RECONCILIATION_INTEGRITY_FAILED';
      error.integrity = integrity;
      throw error;
    }
    result = {
      ...plan,
      applied: true,
      mergeReports,
      authorityAccountRows,
      identityAliasesMoved,
      quarantine,
      accountScopedIdentityMerge,
      accountColumnRebinds,
      rewrittenAccountJson,
      integrity
    };
  });
  return result;
}

function reconcileOrphanAccounts() {
  authority.ensureSchema();
  merger.ensureSchema();
  const discovered = discoverOrphanAccountAliases();
  const reports = [];
  for (const plan of discovered.plans) {
    if (!plan.eligible) { reports.push({ ...plan, applied: false }); continue; }
    try { reports.push(reconcilePlan(plan)); }
    catch (error) {
      logger.error('whatsapp', 'orphan-account-reconciliation-failed', { operation: 'reconcileOrphanAccounts', accountId: plan.targetAccountId, sourceAccountId: plan.sourceAccountId, reasonCode: error.code || 'WHATSAPP_ORPHAN_ACCOUNT_RECONCILIATION_FAILED', error: error.message });
      throw error;
    }
  }
  return { ...discovered, reports, applied: reports.filter(row => row.applied).length };
}

module.exports = { discoverOrphanAccountAliases, reconcileOrphanAccounts, reconcilePlan, accountIdentityGroups, messageEvidence, invalidIdentityRows };
