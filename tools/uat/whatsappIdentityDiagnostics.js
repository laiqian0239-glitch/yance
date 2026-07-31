'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const { discoverExistingDataRoots } = require('../runtime-delivery/source-uat-delivery');

const PRIVATE_JID_DOMAINS = new Set(['s.whatsapp.net', 'lid']);
const GROUP_JID_DOMAIN = 'g.us';
const LEGACY_JID_DOMAIN = 'c.us';
const MEDIA_URL_PATTERN = /^\/api\/r32\/messages\/media\/([^/]+)\/([^/]+)\/([^/?#]+)(?:[?#].*)?$/u;
const WHATSAPP_IDENTITY_CONTRACT_VERSION = 5;
const WHATSAPP_MERGE_INTEGRITY_CONTRACT_VERSION = 3;
const SYNTHETIC_MOBILE_ECHO_ARCHIVE_REASON = 'synthetic-mobile-voice-echo';
const KNOWN_PLATFORM_AVATAR_HASHES = new Map();
const P0_DIAGNOSTICS_BASELINE_COMMIT = '15698421547e6628603f5df3bd663c538f092cb1';
const IDENTITY_KEYS = new Set([
  'jid', 'chatJid', 'remoteJid', 'remoteJidAlt', 'rawJid', 'canonicalJid', 'externalId',
  'lid', 'phoneJid', 'legacyJid', 'participant', 'senderJid', 'recipientJid'
]);

function clean(value, max = 4000) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function nowIso() { return new Date().toISOString(); }
function sha256(value) { return crypto.createHash('sha256').update(String(value || '')).digest('hex'); }
function quoteIdentifier(value) { return `"${String(value || '').replace(/"/g, '""')}"`; }
function parseJson(value, fallback = null) {
  try { return value == null || value === '' ? fallback : JSON.parse(value); }
  catch (error) { return fallback; }
}
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function syntheticMobileEchoArchiveReason(value) { return clean(value).toLowerCase() === SYNTHETIC_MOBILE_ECHO_ARCHIVE_REASON; }
function safePart(value, fallback = 'item') {
  return clean(value, 180).replace(/\.{2,}/g, '_').replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^[._-]+|[._-]+$/g, '') || fallback;
}

function classifyJid(value) {
  const raw = clean(value, 300).toLowerCase();
  if (!raw || !raw.includes('@')) return { raw, normalized: '', valid: false, canonicalEligible: false, kind: 'missing-or-not-jid', reasonCode: 'WHATSAPP_JID_MISSING_OR_NOT_JID' };
  const at = raw.lastIndexOf('@');
  const domainRaw = raw.slice(at + 1);
  const domain = domainRaw === LEGACY_JID_DOMAIN ? 's.whatsapp.net' : domainRaw.replace(/^c\./u, '');
  const local = (domain === GROUP_JID_DOMAIN ? raw.slice(0, at) : raw.slice(0, at).replace(/:\d+$/u, ''));
  if (!local || !domain || raw === 'status@broadcast' || ['broadcast', 'newsletter'].includes(domain)) {
    return { raw, normalized: '', valid: false, canonicalEligible: false, kind: 'unsupported', reasonCode: 'WHATSAPP_JID_UNSUPPORTED' };
  }
  if (domain === GROUP_JID_DOMAIN) {
    const valid = /^(?:\d{5,20}-\d{5,20}|\d{10,30})$/u.test(local);
    return { raw, normalized: valid ? `${local}@${domain}` : '', valid, canonicalEligible: valid, kind: 'group', reasonCode: valid ? '' : 'WHATSAPP_GROUP_JID_INVALID' };
  }
  if (domain === 's.whatsapp.net') {
    const valid = /^\d{1,20}$/u.test(local) && !/^0+$/u.test(local);
    const canonicalEligible = valid && local.length >= 7;
    return {
      raw,
      normalized: valid ? `${local}@s.whatsapp.net` : '',
      valid,
      canonicalEligible,
      kind: domainRaw === LEGACY_JID_DOMAIN ? 'legacy-jid' : 'phone-jid',
      reasonCode: canonicalEligible ? '' : (valid ? 'WHATSAPP_PHONE_JID_TOO_SHORT' : 'WHATSAPP_PHONE_JID_INVALID')
    };
  }
  if (domain === 'lid') {
    const valid = /^\d{1,30}$/u.test(local) && !/^0+$/u.test(local);
    const canonicalEligible = valid && local.length >= 5;
    return { raw, normalized: valid ? `${local}@lid` : '', valid, canonicalEligible, kind: 'lid', reasonCode: canonicalEligible ? '' : (valid ? 'WHATSAPP_LID_TOO_SHORT' : 'WHATSAPP_LID_INVALID') };
  }
  return { raw, normalized: '', valid: false, canonicalEligible: false, kind: 'unsupported-domain', reasonCode: 'WHATSAPP_JID_DOMAIN_UNSUPPORTED' };
}
function normalizeJid(value) { return classifyJid(value).normalized; }
function chooseCanonical(values = []) {
  const rows = unique(values.map(classifyJid).filter(row => row.valid && row.canonicalEligible));
  return rows.find(row => ['phone-jid', 'legacy-jid'].includes(row.kind))?.normalized
    || rows.find(row => row.kind === 'group')?.normalized
    || rows.find(row => row.kind === 'lid')?.normalized
    || '';
}
function phoneFieldJid(value) {
  const token = phoneToken(value);
  return token ? normalizeJid(`${token}@s.whatsapp.net`) : '';
}
function phoneToken(value) {
  const classified = classifyJid(value);
  if (classified.valid && ['phone-jid', 'legacy-jid'].includes(classified.kind)) return classified.normalized.split('@')[0];
  const digits = clean(value, 80).replace(/\D/g, '');
  return /^\d{7,20}$/u.test(digits) && !/^0+$/u.test(digits) ? digits : '';
}

function isWeakDisplayName(value, jid = '') {
  const text = clean(value, 240);
  if (!text) return true;
  if (/@(?:s\.whatsapp\.net|c\.us|lid|g\.us)$/iu.test(text)) return true;
  const compact = text.replace(/[\s()+-]/gu, '');
  if (/^\d{7,20}$/u.test(compact)) return true;
  const phone = phoneToken(jid);
  return Boolean(phone && compact === phone);
}

function extractIdentityValues(value, output = []) {
  if (!value) return output;
  if (typeof value === 'string') {
    const classified = classifyJid(value);
    if (classified.raw.includes('@')) output.push(value);
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value) extractIdentityValues(item, output);
    return output;
  }
  if (typeof value !== 'object') return output;
  for (const [key, item] of Object.entries(value)) {
    if (IDENTITY_KEYS.has(key) || key === 'aliases' || key === 'jidAliases' || key === 'rawMeta' || key === 'liveUser') {
      extractIdentityValues(item, output);
    }
  }
  return output;
}

function tableExists(db, table) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type IN ('table','view') AND name=?").get(table));
}
function tableColumns(db, table) {
  if (!tableExists(db, table)) return [];
  return db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all().map(row => clean(row.name));
}
function selectRows(db, table, where = '', args = []) {
  if (!tableExists(db, table)) return [];
  const sql = `SELECT * FROM ${quoteIdentifier(table)}${where ? ` WHERE ${where}` : ''}`;
  return db.prepare(sql).all(...args);
}
function countRows(db, table, where = '', args = []) {
  if (!tableExists(db, table)) return 0;
  return Number(db.prepare(`SELECT COUNT(*) AS n FROM ${quoteIdentifier(table)}${where ? ` WHERE ${where}` : ''}`).get(...args)?.n || 0);
}

function countValues(db, table, column, values, wherePrefix = '', prefixArgs = []) {
  if (!tableExists(db, table) || !values.length || !tableColumns(db, table).includes(column)) return 0;
  const placeholders = values.map(() => '?').join(',');
  const where = `${wherePrefix ? `${wherePrefix} AND ` : ''}${quoteIdentifier(column)} IN (${placeholders})`;
  return countRows(db, table, where, [...prefixArgs, ...values]);
}

function mergedReferenceIntegrity(db, conversationRows, contacts) {
  const mergedConversationIds = unique(conversationRows.filter(row => clean(row.merged_into) && clean(row.merge_reason) === 'whatsapp-jid-alias').map(row => clean(row.session_key)));
  const mergedContactIds = unique(contacts.filter(row => clean(row.merged_into_id)).map(row => clean(row.id)));
  const leaks = [];
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(row => clean(row.name));
  for (const table of tables) {
    const cols = tableColumns(db, table);
    if (cols.includes('conversation_id')) {
      const count = countValues(db, table, 'conversation_id', mergedConversationIds);
      if (count) leaks.push({ table, column: 'conversation_id', count, kind: 'merged-conversation-reference' });
    }
    if (table !== 'r32_conversations' && cols.includes('session_key')) {
      const count = countValues(db, table, 'session_key', mergedConversationIds);
      if (count) leaks.push({ table, column: 'session_key', count, kind: 'merged-conversation-reference' });
    }
    if (table !== 'contacts' && cols.includes('contact_id')) {
      const count = countValues(db, table, 'contact_id', mergedContactIds);
      if (count) leaks.push({ table, column: 'contact_id', count, kind: 'merged-contact-reference' });
    }
  }
  const settings = countValues(db, 'r32_settings', 'key', mergedConversationIds);
  if (settings) leaks.push({ table: 'r32_settings', column: 'key', count: settings, kind: 'merged-conversation-reference' });
  const checkpoints = countValues(db, 'sync_checkpoints', 'scope_id', mergedConversationIds, "platform='whatsapp'", []);
  if (checkpoints) leaks.push({ table: 'sync_checkpoints', column: 'scope_id', count: checkpoints, kind: 'merged-conversation-reference' });
  const aliases = countValues(db, 'identity_aliases', 'canonical_contact_id', mergedContactIds, "platform='whatsapp'", []);
  if (aliases) leaks.push({ table: 'identity_aliases', column: 'canonical_contact_id', count: aliases, kind: 'merged-contact-reference' });
  for (const table of ['ai_reply_feedback_profiles', 'ai_reply_feedback_profile_versions']) {
    const count = countValues(db, table, 'scope_id', mergedContactIds, "scope_type='contact'", []);
    if (count) leaks.push({ table, column: 'scope_id', count, kind: 'merged-contact-learning-reference' });
  }
  return { mergedConversationIds, mergedContactIds, leaks, staleReferenceCount: leaks.reduce((sum, row) => sum + row.count, 0) };
}

function pendingSendIntegrity(sendQueue, conversationRows) {
  const conversationById = new Map(conversationRows.map(row => [clean(row.session_key), row]));
  const issues = [];
  for (const row of sendQueue) {
    const sessionKey = clean(row.session_key);
    const conversation = conversationById.get(sessionKey) || null;
    const payload = parseJson(row.payload_json, {}) || {};
    const platform = clean(payload.platform).toLowerCase();
    if (platform && platform !== 'whatsapp') continue;
    if (!conversation) {
      issues.push({ queueId: clean(row.id), sessionKey, reasonCode: 'WHATSAPP_QUEUE_CONVERSATION_MISSING' });
      continue;
    }
    if (clean(conversation.merged_into)) issues.push({ queueId: clean(row.id), sessionKey, mergedInto: clean(conversation.merged_into), reasonCode: 'WHATSAPP_QUEUE_BOUND_TO_TOMBSTONE' });
    const accountId = clean(row.account_id);
    const suffix = sessionKey.startsWith(`${accountId}:`) ? sessionKey.slice(accountId.length + 1) : '';
    const canonicalJid = normalizeJid(suffix);
    const payloadJid = normalizeJid(payload.chatJid);
    if (canonicalJid && payloadJid && canonicalJid !== payloadJid) issues.push({ queueId: clean(row.id), sessionKey, canonicalJid, payloadJid, reasonCode: 'WHATSAPP_QUEUE_CHAT_JID_MISMATCH' });
    for (const [key, expected] of [['conversationId', sessionKey], ['sessionKey', sessionKey], ['contactId', clean(conversation.contact_id)], ['accountId', accountId]]) {
      const actual = clean(payload[key]);
      if (actual && expected && actual !== expected) issues.push({ queueId: clean(row.id), sessionKey, field: key, expected, actual, reasonCode: `WHATSAPP_QUEUE_${key.replace(/([A-Z])/g, '_$1').toUpperCase()}_MISMATCH` });
    }
    const quotedJid = normalizeJid(payload.quoted?.key?.remoteJid || payload.quoted?.chatJid);
    if (canonicalJid && quotedJid && canonicalJid !== quotedJid) issues.push({ queueId: clean(row.id), sessionKey, canonicalJid, quotedJid, reasonCode: 'WHATSAPP_QUEUE_QUOTED_JID_MISMATCH' });
  }
  return { issues, issueCount: issues.length };
}

class UnionFind {
  constructor() { this.parent = new Map(); this.rank = new Map(); }
  add(value) {
    if (!value || this.parent.has(value)) return;
    this.parent.set(value, value);
    this.rank.set(value, 0);
  }
  find(value) {
    this.add(value);
    const parent = this.parent.get(value);
    if (parent !== value) this.parent.set(value, this.find(parent));
    return this.parent.get(value);
  }
  union(left, right) {
    if (!left || !right) return;
    let a = this.find(left), b = this.find(right);
    if (a === b) return;
    const rankA = this.rank.get(a) || 0, rankB = this.rank.get(b) || 0;
    if (rankA < rankB) [a, b] = [b, a];
    this.parent.set(b, a);
    if (rankA === rankB) this.rank.set(a, rankA + 1);
  }
  groups() {
    const result = new Map();
    for (const value of this.parent.keys()) {
      const root = this.find(value);
      if (!result.has(root)) result.set(root, []);
      result.get(root).push(value);
    }
    return result;
  }
}


function orphanAccountDiagnostics(db, accounts, ufByAccount) {
  const activeAccountIds = new Set(accounts.filter(row => (
    !['merged', 'tombstoned', 'deleted'].includes(clean(row.lifecycle_state).toLowerCase())
    && !clean(row.merged_into_id)
    && !clean(row.tombstoned_at)
  )).map(row => clean(row.id)).filter(Boolean));
  const canonicalSets = new Map();
  const aliasMaps = new Map();
  for (const [accountId, uf] of ufByAccount.entries()) {
    const canonicalSet = new Set();
    const aliasMap = new Map();
    for (const members of uf.groups().values()) {
      const canonicalJid = chooseCanonical(members);
      const classified = classifyJid(canonicalJid);
      if (!classified.valid || !['phone-jid', 'legacy-jid'].includes(classified.kind)) continue;
      canonicalSet.add(classified.normalized);
      for (const member of members) aliasMap.set(normalizeJid(member), classified.normalized);
    }
    if (canonicalSet.size) canonicalSets.set(accountId, canonicalSet);
    if (aliasMap.size) aliasMaps.set(accountId, aliasMap);
  }

  const messageEvidence = new Map();
  if (tableExists(db, 'r32_messages')) {
    const columns = new Set(tableColumns(db, 'r32_messages'));
    if (columns.has('account_id') && columns.has('session_key')) {
      const payloadExpression = columns.has('payload_json') ? 'payload_json' : "'{}' AS payload_json";
      const rows = db.prepare(`SELECT id,account_id,session_key,${payloadExpression} FROM r32_messages WHERE account_id<>''`).all();
      for (const row of rows) {
        const accountId = clean(row.account_id);
        const payload = parseJson(row.payload_json, {});
        const sessionKey = clean(row.session_key);
        const suffix = sessionKey.includes(':') ? sessionKey.slice(sessionKey.indexOf(':') + 1) : '';
        const values = unique([suffix, ...extractIdentityValues(payload)].map(normalizeJid));
        const aliasMap = aliasMaps.get(accountId) || new Map();
        const canonicalJid = values.map(value => aliasMap.get(value)).find(Boolean) || chooseCanonical(values);
        const classified = classifyJid(canonicalJid);
        if (!classified.valid || !['phone-jid', 'legacy-jid'].includes(classified.kind)) continue;
        const externalMessageId = clean(payload.externalMessageId || payload.messageId, 500);
        if (!externalMessageId) continue;
        if (!messageEvidence.has(accountId)) messageEvidence.set(accountId, new Map());
        const byJid = messageEvidence.get(accountId);
        if (!byJid.has(classified.normalized)) byJid.set(classified.normalized, new Set());
        byJid.get(classified.normalized).add(externalMessageId);
      }
    }
  }

  const orphanAccountIds = [...canonicalSets.keys()].filter(accountId => !activeAccountIds.has(accountId));
  const plans = [];
  for (const sourceAccountId of orphanAccountIds) {
    const sourceJids = [...(canonicalSets.get(sourceAccountId) || [])];
    if (!sourceJids.length) continue;
    const candidates = [...activeAccountIds].map(targetAccountId => {
      const targetJids = canonicalSets.get(targetAccountId) || new Set();
      const sharedCanonicalJids = sourceJids.filter(jid => targetJids.has(jid));
      let sharedExternalMessageIds = 0;
      for (const jid of sharedCanonicalJids) {
        const sourceIds = messageEvidence.get(sourceAccountId)?.get(jid) || new Set();
        const targetIds = messageEvidence.get(targetAccountId)?.get(jid) || new Set();
        for (const externalId of sourceIds) if (targetIds.has(externalId)) sharedExternalMessageIds += 1;
      }
      const sourceCoverage = sourceJids.length ? sharedCanonicalJids.length / sourceJids.length : 0;
      return {
        targetAccountId,
        sourceCanonicalJidCount: sourceJids.length,
        sharedCanonicalJidCount: sharedCanonicalJids.length,
        sharedExternalMessageIds,
        sourceCoverage,
        score: sharedExternalMessageIds * 1000 + sharedCanonicalJids.length * 100 + Math.round(sourceCoverage * 100)
      };
    }).sort((left, right) => right.score - left.score);
    const best = candidates[0] || null;
    const second = candidates[1] || null;
    const eligible = Boolean(best
      && sourceJids.length >= 2
      && best.sharedCanonicalJidCount >= 2
      && best.sharedExternalMessageIds >= 2
      && best.sourceCoverage >= 0.75
      && (!second || second.score === 0 || best.score >= second.score * 2));
    plans.push({
      sourceAccountId,
      sourceCanonicalJidCount: sourceJids.length,
      candidates,
      targetAccountId: eligible ? best.targetAccountId : '',
      eligible,
      reasonCode: eligible ? 'WHATSAPP_ORPHAN_ACCOUNT_HIGH_CONFIDENCE_MATCH' : 'WHATSAPP_ORPHAN_ACCOUNT_AMBIGUOUS'
    });
  }
  return {
    activeAccountIds: [...activeAccountIds],
    orphanAccountIds,
    plans,
    eligiblePlans: plans.filter(row => row.eligible),
    ambiguousPlans: plans.filter(row => !row.eligible)
  };
}

function mediaLocalFile(dataRoot, avatarUrl, expectedPlatform = '') {
  const match = clean(avatarUrl, 3000).match(MEDIA_URL_PATTERN);
  if (!match) return { path: '', exists: false, bytes: 0, hash: '', platformMismatch: false, reasonCode: avatarUrl ? 'AVATAR_URL_NOT_LOCAL_MEDIA' : 'AVATAR_URL_EMPTY' };
  const target = path.join(dataRoot, 'media', safePart(decodeURIComponent(match[1])), safePart(decodeURIComponent(match[2])), safePart(decodeURIComponent(match[3]), ''));
  try {
    const stat = fs.statSync(target);
    if (!stat.isFile() || stat.size <= 0) return { path: target, exists: false, bytes: 0, hash: '', platformMismatch: false, reasonCode: 'AVATAR_LOCAL_FILE_EMPTY' };
    const buffer = fs.readFileSync(target);
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    const known = KNOWN_PLATFORM_AVATAR_HASHES.get(hash) || null;
    const actualPlatform = clean(known?.platform).toLowerCase();
    const expected = clean(expectedPlatform).toLowerCase();
    // A WhatsApp Business contact can legitimately use another brand logo.
    // Image bytes are never platform identity evidence.
    const platformMismatch = false;
    return {
      path: target,
      exists: true,
      bytes: stat.size,
      hash,
      platformMismatch,
      expectedPlatform: expected,
      actualPlatform,
      reasonCode: ''
    };
  } catch (error) {
    return { path: target, exists: false, bytes: 0, hash: '', platformMismatch: false, reasonCode: error.code === 'ENOENT' ? 'AVATAR_LOCAL_FILE_MISSING' : 'AVATAR_LOCAL_FILE_STAT_FAILED' };
  }
}

function whatsappMediaInventory(db, dataRoot) {
  const output = {
    total: 0, ready: 0, pending: 0, queued: 0, recovering: 0, historyRequested: 0,
    failed: 0, unsupported: 0, missingEnvelope: 0, withThumbnail: 0, missingLocalFile: 0,
    byKind: {}
  };
  if (!tableExists(db, 'r32_messages') || !tableExists(db, 'r32_conversations')) return output;
  const columns = new Set(tableColumns(db, 'r32_messages'));
  if (!columns.has('payload_json')) return output;
  const rows = db.prepare(`
    SELECT m.message_type,m.media_url,m.media_path,m.payload_json
    FROM r32_messages m
    JOIN r32_conversations c ON c.session_key=m.session_key
    WHERE LOWER(COALESCE(c.platform,''))='whatsapp'
  `).all();
  const mediaKinds = new Set(['image','video','gif','sticker','voice','audio','document','file']);
  for (const row of rows) {
    const payload = parseJson(row.payload_json, {}) || {};
    const attachment = Array.isArray(payload.attachments) ? payload.attachments[0] || {} : {};
    const kind = clean(attachment.kind || attachment.mediaType || row.message_type).toLowerCase();
    if (!mediaKinds.has(kind) && !attachment.mediaUrl && !attachment.localFile) continue;
    output.total += 1;
    output.byKind[kind || 'unknown'] = Number(output.byKind[kind || 'unknown'] || 0) + 1;
    const status = clean(attachment.downloadStatus || attachment.status || '').toLowerCase();
    const mediaUrl = clean(attachment.mediaUrl || attachment.url || row.media_url, 3000);
    const localFile = clean(attachment.localFile || row.media_path, 3000);
    let localExists = false;
    if (localFile) {
      try { localExists = fs.statSync(localFile).isFile() && fs.statSync(localFile).size > 0; } catch (_) { localExists = false; }
    } else if (mediaUrl) {
      localExists = mediaLocalFile(dataRoot, mediaUrl).exists;
    }
    if (mediaUrl || localFile || status === 'ready') {
      if (localExists || (!mediaUrl.startsWith('/api/r32/messages/media/') && !localFile)) output.ready += 1;
      else output.missingLocalFile += 1;
    } else if (status === 'queued') output.queued += 1;
    else if (status === 'recovering') output.recovering += 1;
    else if (status === 'history-requested') output.historyRequested += 1;
    else if (status === 'failed') output.failed += 1;
    else if (status === 'unsupported') output.unsupported += 1;
    else output.pending += 1;
    if (!attachment?.mediaEnvelope?.message && !mediaUrl && !localFile) output.missingEnvelope += 1;
    if (attachment.thumbnailDataUrl) output.withThumbnail += 1;
  }
  return output;
}

function discoverLogEvidence(dataRoot) {
  const logRoot = path.join(dataRoot, 'logs');
  const files = [];
  const evidence = [];
  const patterns = /(whatsapp|jid|lid-mapping|avatar|identity|conversation-alias|send-source|source conflict|发送来源|客户不存在)/iu;
  try {
    for (const entry of fs.readdirSync(logRoot, { withFileTypes: true })) {
      if (!entry.isFile() || !/\.(?:jsonl|log|txt)$/iu.test(entry.name)) continue;
      const full = path.join(logRoot, entry.name);
      const stat = fs.statSync(full);
      files.push({ file: full, bytes: stat.size, modifiedAt: stat.mtime.toISOString() });
      const maxBytes = 8 * 1024 * 1024;
      const start = Math.max(0, stat.size - maxBytes);
      const fd = fs.openSync(full, 'r');
      try {
        const buffer = Buffer.alloc(stat.size - start);
        fs.readSync(fd, buffer, 0, buffer.length, start);
        const lines = buffer.toString('utf8').split(/\r?\n/u).filter(line => patterns.test(line)).slice(-300);
        for (const line of lines) evidence.push({ file: entry.name, line: line.slice(0, 5000) });
      } finally { fs.closeSync(fd); }
    }
  } catch (error) {
    return { files, evidence, error: { code: error.code || 'LOG_SCAN_FAILED', message: error.message } };
  }
  return { files, evidence };
}

function authInventory(dataRoot) {
  const roots = [path.join(dataRoot, 'whatsapp-auth'), path.join(dataRoot, 'baileys-auth')];
  const rows = [];
  for (const root of roots) {
    try {
      const stack = [{ dir: root, depth: 0 }];
      let files = 0, directories = 0, bytes = 0, latestMtime = 0;
      while (stack.length) {
        const current = stack.pop();
        for (const entry of fs.readdirSync(current.dir, { withFileTypes: true })) {
          const full = path.join(current.dir, entry.name);
          const stat = fs.statSync(full);
          latestMtime = Math.max(latestMtime, stat.mtimeMs);
          if (entry.isDirectory()) {
            directories += 1;
            if (current.depth < 3) stack.push({ dir: full, depth: current.depth + 1 });
          } else {
            files += 1;
            bytes += stat.size;
          }
        }
      }
      rows.push({ root, exists: true, files, directories, bytes, latestModifiedAt: latestMtime ? new Date(latestMtime).toISOString() : '' });
    } catch (error) {
      rows.push({ root, exists: false, files: 0, directories: 0, bytes: 0, errorCode: error.code || 'AUTH_INVENTORY_FAILED' });
    }
  }
  return rows;
}

function dataRootCandidates(options = {}) {
  if (clean(options.dataRoot)) return [{ ...inspectRoot(options.dataRoot), source: 'explicit' }];
  const candidates = discoverExistingDataRoots(process.env).map(row => ({ ...row, source: 'discovery' }));
  return candidates;
}
function inspectRoot(dataRoot) {
  const resolved = path.resolve(clean(dataRoot));
  const databasePath = path.join(resolved, 'store', 'yance-r32.db');
  try {
    const stat = fs.statSync(databasePath);
    return { dataRoot: resolved, databasePath, databaseExists: stat.isFile() && stat.size > 0, databaseSizeBytes: stat.isFile() ? stat.size : 0 };
  } catch (error) {
    return { dataRoot: resolved, databasePath, databaseExists: false, databaseSizeBytes: 0, errorCode: error.code || 'DATABASE_STAT_FAILED' };
  }
}
function resolveRoot(options = {}) {
  const candidates = dataRootCandidates(options);
  const selected = candidates.find(row => row.databaseExists);
  if (!selected) {
    const error = new Error('没有找到包含 store\\yance-r32.db 的言策数据目录');
    error.code = 'WHATSAPP_DIAGNOSTIC_DATA_ROOT_NOT_FOUND';
    error.candidates = candidates;
    throw error;
  }
  return { selected, candidates };
}

function buildDiagnostics(options = {}) {
  const { selected, candidates } = resolveRoot(options);
  const dataRoot = selected.dataRoot;
  const db = new DatabaseSync(selected.databasePath, { readOnly: true });
  try {
    db.exec('PRAGMA query_only=ON; PRAGMA foreign_keys=ON;');
    const schemaTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => row.name);
    const accounts = selectRows(db, 'r32_accounts', "platform='whatsapp'");
    const conversations = selectRows(db, 'r32_conversations', "platform='whatsapp'");
    const contacts = selectRows(db, 'contacts', "platform='whatsapp'");
    const authorityRows = selectRows(db, 'whatsapp_identity_authority');
    const identityAliasRows = selectRows(db, 'identity_aliases', "platform='whatsapp'");
    const mergeAuditRows = selectRows(db, 'identity_merge_audit', "platform='whatsapp'");
    const profiles = selectRows(db, 'customer_profiles');
    const insights = selectRows(db, 'relationship_insights');
    const aiContexts = selectRows(db, 'ai_context_snapshots');
    const sendQueue = selectRows(db, 'r32_send_queue');
    const mergedReferenceCheck = mergedReferenceIntegrity(db, conversations, contacts);
    const pendingSendCheck = pendingSendIntegrity(sendQueue, conversations);
    const foreignKeyViolations = db.prepare('PRAGMA foreign_key_check').all();
    const messageCounts = tableExists(db, 'r32_messages')
      ? db.prepare('SELECT session_key,COUNT(*) AS n,MAX(COALESCE(NULLIF(sent_at,\'\'),created_at)) AS last_at FROM r32_messages GROUP BY session_key').all()
      : [];
    const messageEvidenceColumns = new Set(tableColumns(db, 'r32_messages'));
    const mediaInventory = whatsappMediaInventory(db, dataRoot);
    const mobileUnsupportedEchoes = (() => {
      if (!tableExists(db, 'r32_messages')) return [];
      const columns = new Set(tableColumns(db, 'r32_messages'));
      if (!['account_id', 'session_key', 'direction', 'message_type', 'sent_at', 'payload_json'].every(column => columns.has(column))) return [];
      const textExpr = columns.has('text') ? "COALESCE(text,'')" : "COALESCE(json_extract(payload_json,'$.text'),'')";
      return db.prepare(`
        SELECT account_id,session_key,sent_at,${textExpr} AS message_text,COUNT(*) AS duplicate_count
        FROM r32_messages
        WHERE direction IN ('outbound','outgoing')
          AND message_type='unknown'
          AND ${textExpr} IN ('你发送了一条暂不支持的消息','对方发送了一条暂不支持的消息')
          AND COALESCE(sent_at,'')<>''
        GROUP BY account_id,session_key,sent_at,${textExpr}
        HAVING COUNT(*) > 1
        ORDER BY duplicate_count DESC,sent_at DESC
      `).all().map(row => ({
        accountId: clean(row.account_id),
        sessionKey: clean(row.session_key),
        sentAt: clean(row.sent_at),
        text: clean(row.message_text),
        duplicateCount: Number(row.duplicate_count || 0)
      }));
    })();
    const outboundEvidence = tableExists(db, 'r32_messages') && tableExists(db, 'r32_conversations')
      && ['direction', 'message_type', 'media_url', 'media_path', 'delivery_status'].every(column => messageEvidenceColumns.has(column))
      ? db.prepare(`
          SELECT
            SUM(CASE WHEN LOWER(COALESCE(m.direction,'')) IN ('outbound','outgoing') THEN 1 ELSE 0 END) AS outbound_count,
            SUM(CASE WHEN LOWER(COALESCE(m.direction,'')) IN ('outbound','outgoing')
              AND (LOWER(COALESCE(m.message_type,'')) NOT IN ('','text','conversation','extendedtextmessage')
                OR COALESCE(m.media_url,'')<>'' OR COALESCE(m.media_path,'')<>'') THEN 1 ELSE 0 END) AS outbound_media_count,
            SUM(CASE WHEN LOWER(COALESCE(m.direction,'')) IN ('outbound','outgoing')
              AND LOWER(COALESCE(m.delivery_status,'')) IN ('sent','server_ack','delivered','delivery_ack','read','read_ack','played') THEN 1 ELSE 0 END) AS outbound_acknowledged_count,
            MAX(CASE WHEN LOWER(COALESCE(m.direction,'')) IN ('outbound','outgoing')
              THEN COALESCE(NULLIF(m.sent_at,''),m.created_at) ELSE '' END) AS last_outbound_at
          FROM r32_messages m
          JOIN r32_conversations c ON c.session_key=m.session_key
          WHERE c.platform='whatsapp' AND COALESCE(c.merged_into,'')=''
        `).get()
      : {};
    const messageCountMap = new Map(messageCounts.map(row => [clean(row.session_key), { count: Number(row.n || 0), lastAt: clean(row.last_at) }]));
    const accountById = new Map(accounts.map(row => [clean(row.id), row]));
    const contactById = new Map(contacts.map(row => [clean(row.id), row]));
    const profileIds = new Set(profiles.map(row => clean(row.contact_id)).filter(Boolean));
    const insightByContact = new Map(insights.map(row => [clean(row.contact_id), row]));
    const mergeBySource = new Map(mergeAuditRows.filter(row => clean(row.entity_type) === 'conversation').map(row => [clean(row.source_id), clean(row.target_id)]));
    const selfAliasesByAccount = new Map();

    for (const account of accounts) {
      const values = unique([
        account.adapter_account_id, account.identity_label, account.display_name,
        ...extractIdentityValues(parseJson(account.payload_json, {}))
      ].map(normalizeJid));
      selfAliasesByAccount.set(clean(account.id), new Set(values));
    }

    const ufByAccount = new Map();
    const edgeEvidence = [];
    const invalidIdentities = [];
    const allIdentityValues = new Map();
    const ensureUf = accountId => {
      if (!ufByAccount.has(accountId)) ufByAccount.set(accountId, new UnionFind());
      return ufByAccount.get(accountId);
    };
    const recordValues = (accountId, values, source, sourceId = '') => {
      const normalized = [];
      for (const value of unique(values.map(item => clean(item, 300)))) {
        const classified = classifyJid(value);
        if (classified.valid) normalized.push(classified.normalized);
        else if (classified.raw.includes('@')) invalidIdentities.push({ accountId, value: classified.raw, kind: classified.kind, reasonCode: classified.reasonCode, source, sourceId });
      }
      const rows = unique(normalized);
      const uf = ensureUf(accountId);
      rows.forEach(value => uf.add(value));
      for (let index = 1; index < rows.length; index += 1) uf.union(rows[0], rows[index]);
      if (rows.length > 1) edgeEvidence.push({ accountId, values: rows, source, sourceId });
      const key = `${accountId}\u001f${source}\u001f${sourceId}`;
      allIdentityValues.set(key, rows);
      return rows;
    };

    for (const row of authorityRows) {
      const aliases = parseJson(row.aliases_json, []);
      recordValues(clean(row.account_id), [row.alias_jid, row.canonical_jid, ...(Array.isArray(aliases) ? aliases : [])], 'whatsapp_identity_authority', clean(row.alias_jid));
    }
    const aliasesByCanonicalContact = new Map();
    for (const row of identityAliasRows) {
      const accountId = clean(row.canonical_account_id);
      const contactId = clean(row.canonical_contact_id);
      const key = `${accountId}\u001f${contactId}`;
      if (!aliasesByCanonicalContact.has(key)) aliasesByCanonicalContact.set(key, []);
      aliasesByCanonicalContact.get(key).push(row.alias_value);
    }
    for (const [key, values] of aliasesByCanonicalContact.entries()) {
      const [accountId, contactId] = key.split('\u001f');
      recordValues(accountId, values, 'identity_aliases', contactId);
    }
    for (const row of contacts) {
      if (clean(row.merged_into_id) || clean(row.tombstoned_at) || syntheticMobileEchoArchiveReason(row.archive_reason)) continue;
      const payload = parseJson(row.payload_json, {});
      const aliases = parseJson(row.aliases_json, []);
      recordValues(clean(row.account_id), [row.external_id, phoneFieldJid(row.phone), payload.phoneJid, phoneFieldJid(payload.phone), ...(Array.isArray(aliases) ? aliases : []), ...extractIdentityValues(payload)], 'contacts', clean(row.id));
    }
    for (const row of conversations) {
      if (clean(row.merged_into) || syntheticMobileEchoArchiveReason(row.archive_reason)) continue;
      const payload = parseJson(row.payload_json, {});
      const suffix = clean(row.session_key).startsWith(`${clean(row.account_id)}:`) ? clean(row.session_key).slice(clean(row.account_id).length + 1) : '';
      recordValues(clean(row.account_id), [suffix, payload.phoneJid, phoneFieldJid(payload.phone), ...extractIdentityValues(payload)], 'r32_conversations', clean(row.session_key));
    }

    // Phone-number equality is a strong bridge between legacy @c.us and modern @s.whatsapp.net.
    for (const [accountId, uf] of ufByAccount.entries()) {
      const byPhone = new Map();
      for (const jid of uf.parent.keys()) {
        const token = phoneToken(jid);
        if (!token) continue;
        if (byPhone.has(token)) uf.union(byPhone.get(token), jid);
        else byPhone.set(token, jid);
      }
    }

    const orphanAccountCheck = orphanAccountDiagnostics(db, accounts, ufByAccount);

    const conversationRows = conversations.map(row => {
      const payload = parseJson(row.payload_json, {});
      const accountId = clean(row.account_id);
      const suffix = clean(row.session_key).startsWith(`${accountId}:`) ? clean(row.session_key).slice(accountId.length + 1) : '';
      const identityValues = unique([suffix, payload.phoneJid, phoneFieldJid(payload.phone), ...extractIdentityValues(payload)].map(normalizeJid));
      const classifications = identityValues.map(classifyJid);
      const privateJids = classifications.filter(item => item.valid && PRIVATE_JID_DOMAINS.has(item.normalized.split('@')[1])).map(item => item.normalized);
      const groupJids = classifications.filter(item => item.valid && item.kind === 'group').map(item => item.normalized);
      const uf = ensureUf(accountId);
      const root = privateJids[0] ? uf.find(privateJids[0]) : (groupJids[0] ? `group:${groupJids[0]}` : `orphan:${clean(row.session_key)}`);
      const contact = contactById.get(clean(row.contact_id)) || null;
      const contactPayload = parseJson(contact?.payload_json, {});
      const avatarUrl = clean(row.avatar_url || payload.avatarUrl || contact?.avatar_url || contactPayload.avatarUrl, 3000);
      const localAvatar = mediaLocalFile(dataRoot, avatarUrl, 'whatsapp');
      const counts = messageCountMap.get(clean(row.session_key)) || { count: 0, lastAt: '' };
      const lid = privateJids.find(value => value.endsWith('@lid')) || '';
      const phoneJid = privateJids.find(value => value.endsWith('@s.whatsapp.net')) || '';
      const legacyRaw = unique([suffix, ...extractIdentityValues(payload)]).find(value => /@c\.us$/iu.test(clean(value))) || '';
      const sendSource = clean(payload.sendSource || payload.sourceAccountId || payload.sourceAccount || payload.adapterAccountId || row.route_state, 500);
      const selfAliases = selfAliasesByAccount.get(accountId) || new Set();
      const isSelf = privateJids.some(value => selfAliases.has(value));
      const canonicalSendJid = chooseCanonical(identityValues);
      const boundAccount = accountById.get(accountId) || null;
      const sendRouteReasonCodes = [];
      if (!boundAccount) sendRouteReasonCodes.push('WHATSAPP_SEND_ACCOUNT_MISSING');
      if (!canonicalSendJid && !groupJids.length) sendRouteReasonCodes.push('WHATSAPP_SEND_TARGET_INVALID');
      const runtimeSendEligible = Boolean(Number(boundAccount?.can_send || 0));
      const mergedInto = clean(row.merged_into) || mergeBySource.get(clean(row.session_key)) || '';
      const archivedAt = clean(row.archived_at);
      const archiveReason = clean(row.archive_reason);
      const contactArchivedAt = clean(contact?.archived_at);
      const contactArchiveReason = clean(contact?.archive_reason);
      const hiddenSyntheticArtifact = syntheticMobileEchoArchiveReason(archiveReason)
        || syntheticMobileEchoArchiveReason(contactArchiveReason);
      const isActive = !mergedInto && !archivedAt && !contactArchivedAt && !hiddenSyntheticArtifact;
      const sendRouteReady = isActive && !sendRouteReasonCodes.length;
      return {
        accountId,
        sessionKey: clean(row.session_key),
        remoteJid: privateJids[0] || groupJids[0] || normalizeJid(suffix) || clean(suffix),
        lid,
        phoneJid,
        legacyJid: clean(legacyRaw),
        contactId: clean(row.contact_id),
        customerId: profileIds.has(clean(row.contact_id)) ? clean(row.contact_id) : '',
        conversationId: clean(row.session_key),
        displayName: clean(row.title || payload.title || payload.contactName || contact?.display_name, 240),
        weakDisplayName: isWeakDisplayName(row.title || payload.title || payload.contactName || contact?.display_name, phoneJid || privateJids[0] || suffix),
        avatarUrl,
        localAvatarFile: localAvatar.path,
        localAvatarExists: localAvatar.exists,
        localAvatarBytes: localAvatar.bytes,
        avatarFileReasonCode: localAvatar.reasonCode,
        avatarContentHash: localAvatar.hash,
        avatarPlatformMismatch: localAvatar.platformMismatch,
        avatarActualPlatform: localAvatar.actualPlatform || '',
        avatarStatus: clean(row.avatar_status || contact?.avatar_status || payload.avatarStatus, 120),
        messageCount: counts.count,
        lastMessageAt: clean(row.last_message_at || counts.lastAt),
        sendSource,
        sendRouteReady,
        sendRouteReasonCodes,
        canonicalSendJid,
        boundAccountExists: Boolean(boundAccount),
        boundAccountCanSend: runtimeSendEligible,
        mergedInto,
        mergedAt: clean(row.merged_at),
        mergeReason: clean(row.merge_reason),
        archivedAt,
        archiveReason,
        contactArchivedAt,
        contactArchiveReason,
        hiddenSyntheticArtifact,
        isActive,
        contactMergedInto: clean(contact?.merged_into_id),
        canonicalContactId: clean(contact?.canonical_contact_id),
        hasCustomerProfile: profileIds.has(clean(row.contact_id)),
        hasRelationshipInsight: insightByContact.has(clean(row.contact_id)),
        aiContextCount: aiContexts.filter(item => clean(item.contact_id) === clean(row.contact_id) || clean(item.conversation_id) === clean(row.session_key)).length,
        pendingSendCount: sendQueue.filter(item => clean(item.conversation_id || item.session_key) === clean(row.session_key)).length,
        groupRoot: root,
        identityValues,
        isGroup: groupJids.length > 0,
        isSelf,
        isInvalidIdentity: !chooseCanonical(identityValues) && clean(suffix).includes('@')
      };
    });

    const grouped = new Map();
    for (const row of conversationRows) {
      const key = `${row.accountId}\u001f${row.groupRoot}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(row);
    }
    const duplicateGroups = [];
    const singleGroups = [];
    const groupChats = [];
    const selfIdentities = [];
    const orphanOrInvalid = [];
    const inactiveGroups = [];
    for (const [key, rows] of grouped.entries()) {
      const [accountId] = key.split('\u001f');
      const active = rows.filter(row => row.isActive);
      const aliases = unique(rows.flatMap(row => row.identityValues));
      const group = {
        accountId,
        canonicalJid: chooseCanonical(aliases),
        aliases,
        classification: '',
        reasonCodes: [],
        rows
      };
      if (!active.length) {
        group.classification = rows.some(row => row.hiddenSyntheticArtifact)
          ? 'hidden-synthetic-mobile-echo'
          : (rows.some(row => row.mergeReason === 'whatsapp-invalid-identity') ? 'quarantined-invalid' : 'merged-or-archived');
        inactiveGroups.push(group);
      } else if (rows.some(row => row.isGroup)) {
        group.classification = 'group-chat';
        groupChats.push(group);
      } else if (rows.some(row => row.isSelf)) {
        group.classification = 'self-identity';
        selfIdentities.push(group);
      } else if (!group.canonicalJid || !aliases.length || active.some(row => row.isInvalidIdentity)) {
        group.classification = 'invalid-or-orphan';
        group.reasonCodes.push('WHATSAPP_IDENTITY_NOT_RESOLVED');
        orphanOrInvalid.push(group);
      } else if (active.length > 1) {
        group.classification = 'true-duplicate-contact';
        group.reasonCodes.push('WHATSAPP_DUPLICATE_ACTIVE_CONVERSATIONS');
        if (!authorityRows.some(row => clean(row.account_id) === accountId && aliases.includes(normalizeJid(row.alias_jid)))) group.reasonCodes.push('WHATSAPP_AUTHORITY_BACKFILL_MISSING');
        if (active.some(row => !row.localAvatarExists && row.avatarUrl)) group.reasonCodes.push('WHATSAPP_AVATAR_LOCAL_FILE_MISSING');
        if (unique(active.map(row => row.sendSource).filter(Boolean)).length > 1) group.reasonCodes.push('WHATSAPP_SEND_SOURCE_CONFLICT');
        duplicateGroups.push(group);
      } else {
        group.classification = 'single-contact';
        singleGroups.push(group);
      }
    }

    const byName = new Map();
    for (const group of [...duplicateGroups, ...singleGroups]) {
      const names = unique(group.rows.map(row => clean(row.displayName).toLocaleLowerCase()).filter(name => name && !/^\+?\d+$/u.test(name)));
      for (const name of names) {
        const key = `${group.accountId}\u001f${name}`;
        if (!byName.has(key)) byName.set(key, []);
        byName.get(key).push(group);
      }
    }
    const sameNameDifferentContacts = [];
    for (const [key, groups] of byName.entries()) {
      if (groups.length < 2) continue;
      const [accountId, normalizedName] = key.split('\u001f');
      sameNameDifferentContacts.push({ accountId, normalizedName, groups: groups.map(group => ({ canonicalJid: group.canonicalJid, aliases: group.aliases, conversationIds: group.rows.map(row => row.conversationId) })) });
    }

    const activeSendRouteRows = conversationRows.filter(row => row.isActive && !row.isGroup && !row.isSelf);
    const sendRouteReadiness = {
      activePrivateConversations: activeSendRouteRows.length,
      ready: activeSendRouteRows.filter(row => row.sendRouteReady).length,
      blocked: activeSendRouteRows.filter(row => !row.sendRouteReady).length,
      rows: activeSendRouteRows.map(row => ({
        accountId: row.accountId,
        conversationId: row.conversationId,
        contactId: row.contactId,
        canonicalSendJid: row.canonicalSendJid,
        ready: row.sendRouteReady,
        reasonCodes: row.sendRouteReasonCodes,
        accountExists: row.boundAccountExists,
        accountCanSendAtRest: row.boundAccountCanSend,
        runtimeVerificationRequired: !row.boundAccountCanSend,
        persistedSendSource: row.sendSource
      })),
      note: '该门禁只证明当前账号绑定与 canonical JID 可解析；离线退出后的 can_send=false 不构成数据阻断，仍必须在账号在线时真实发送文本和媒体。'
    };

    const authorityCoverageKeys = new Set(authorityRows.map(row => `${clean(row.account_id)}\u001f${normalizeJid(row.alias_jid)}`).filter(value => !value.endsWith('\u001f')));
    const privateRows = conversationRows.filter(row => !row.isGroup && !row.isSelf && row.isActive);
    const withoutAuthority = privateRows.filter(row => !row.identityValues.some(jid => authorityCoverageKeys.has(`${row.accountId}\u001f${jid}`)));
    const invalidCanonicalRows = authorityRows.map(row => ({
      accountId: clean(row.account_id), aliasJid: clean(row.alias_jid), canonicalJid: clean(row.canonical_jid),
      aliasClassification: classifyJid(row.alias_jid), canonicalClassification: classifyJid(row.canonical_jid)
    })).filter(row => !row.aliasClassification.valid || !row.canonicalClassification.canonicalEligible);

    const report = {
      schemaVersion: 1,
      kind: 'YANCE_WHATSAPP_REAL_IDENTITY_DIAGNOSTICS',
      generatedAt: nowIso(),
      privacy: {
        mode: 'private-local-diagnostic',
        warning: '报告包含账号标识、JID、联系人名称和本地文件路径，仅用于用户自己的真实 Windows UAT，不得公开分享。',
        authSecretsIncluded: false,
        messageBodiesIncluded: false
      },
      source: {
        dataRoot,
        databasePath: selected.databasePath,
        databaseSizeBytes: selected.databaseSizeBytes,
        candidates,
        platform: process.platform,
        node: process.version,
        hostHash: sha256(`${os.hostname()}|${os.userInfo().username}`).slice(0, 16)
      },
      p0Baseline: {
        originalFacebookAvatarBaselineCommit: 'a65bf967b557e8e422d2cf2c3e4b4ce332647821',
        p0DiagnosticsBaselineCommit: P0_DIAGNOSTICS_BASELINE_COMMIT,
        whatsappIdentityContractVersion: WHATSAPP_IDENTITY_CONTRACT_VERSION,
        whatsappMergeIntegrityContractVersion: WHATSAPP_MERGE_INTEGRITY_CONTRACT_VERSION,
        expectedWorkerAvatarContract: 2,
        localSchemaVersion: (() => {
          if (!tableExists(db, 'r32_meta')) return null;
          const row = db.prepare("SELECT value_json FROM r32_meta WHERE key='schema_version'").get();
          return parseJson(row?.value_json, row?.value_json || null);
        })(),
        requiredTables: {
          whatsappIdentityAuthority: tableExists(db, 'whatsapp_identity_authority'),
          identityAliases: tableExists(db, 'identity_aliases'),
          identityMergeAudit: tableExists(db, 'identity_merge_audit'),
          conversations: tableExists(db, 'r32_conversations'),
          contacts: tableExists(db, 'contacts'),
          messages: tableExists(db, 'r32_messages')
        }
      },
      summary: {
        whatsappAccounts: accounts.length,
        whatsappConversations: conversations.length,
        whatsappActiveConversations: conversationRows.filter(row => row.isActive).length,
        whatsappContacts: contacts.length,
        whatsappActiveContacts: contacts.filter(row => !clean(row.merged_into_id) && !clean(row.tombstoned_at) && !clean(row.archived_at) && !syntheticMobileEchoArchiveReason(row.archive_reason)).length,
        whatsappMessages: countRows(db, 'r32_messages', "session_key IN (SELECT session_key FROM r32_conversations WHERE platform='whatsapp')"),
        whatsappOutboundMessages: Number(outboundEvidence.outbound_count || 0),
        whatsappOutboundMediaMessages: Number(outboundEvidence.outbound_media_count || 0),
        whatsappOutboundAcknowledgedMessages: Number(outboundEvidence.outbound_acknowledged_count || 0),
        whatsappLastOutboundAt: clean(outboundEvidence.last_outbound_at),
        authorityRows: authorityRows.length,
        aliasRows: identityAliasRows.length,
        mergeAuditRows: mergeAuditRows.length,
        duplicateGroups: duplicateGroups.length,
        duplicateActiveConversations: duplicateGroups.reduce((sum, group) => sum + group.rows.filter(row => row.isActive).length, 0),
        privateConversationsWithoutAuthority: withoutAuthority.length,
        invalidIdentityRows: invalidIdentities.length,
        quarantinedInvalidIdentityRows: conversationRows.filter(row => row.mergeReason === 'whatsapp-invalid-identity').length,
        invalidCanonicalAuthorityRows: invalidCanonicalRows.length,
        orphanAccountPlans: orphanAccountCheck.plans.length,
        eligibleOrphanAccountPlans: orphanAccountCheck.eligiblePlans.length,
        ambiguousOrphanAccountPlans: orphanAccountCheck.ambiguousPlans.length,
        missingLocalAvatarFiles: conversationRows.filter(row => row.isActive && row.avatarUrl && !row.localAvatarExists).length,
        avatarProvenanceErrors: 0,
        platformMismatchedAvatarFiles: 0, // deprecated: image pixels are not platform identity evidence
        whatsappMediaTotal: mediaInventory.total,
        whatsappMediaReady: mediaInventory.ready,
        whatsappMediaPending: mediaInventory.pending + mediaInventory.queued + mediaInventory.recovering + mediaInventory.historyRequested,
        whatsappMediaFailed: mediaInventory.failed,
        whatsappMediaMissingEnvelope: mediaInventory.missingEnvelope,
        whatsappMediaMissingLocalFiles: mediaInventory.missingLocalFile,
        mobileUnsupportedEchoGroups: mobileUnsupportedEchoes.length,
        mobileUnsupportedEchoRows: mobileUnsupportedEchoes.reduce((sum, row) => sum + row.duplicateCount, 0),
        weakDisplayNameConversations: conversationRows.filter(row => row.isActive && !row.isGroup && !row.isSelf && row.weakDisplayName).length,
        syntheticMobileEchoArtifactsHidden: conversationRows.filter(row => row.hiddenSyntheticArtifact).length,
        staleMergedReferences: mergedReferenceCheck.staleReferenceCount,
        pendingSendPayloadMismatches: pendingSendCheck.issueCount,
        sendRouteReadyConversations: sendRouteReadiness.ready,
        sendRouteBlockedConversations: sendRouteReadiness.blocked,
        foreignKeyViolations: foreignKeyViolations.length,
        telegramNotEvaluated: true,
        themeNotEvaluated: true
      },
      mobileUnsupportedEchoes,
      mergeIntegrity: {
        contractVersion: WHATSAPP_MERGE_INTEGRITY_CONTRACT_VERSION,
        ok: mergedReferenceCheck.staleReferenceCount === 0
          && pendingSendCheck.issueCount === 0
          && sendRouteReadiness.blocked === 0
          && foreignKeyViolations.length === 0
          && orphanAccountCheck.plans.length === 0,
        mergedReferenceCheck,
        pendingSendCheck,
        sendRouteReadiness,
        orphanAccountCheck,
        foreignKeyViolations,
        blockers: [
          ...(mergedReferenceCheck.staleReferenceCount ? ['WHATSAPP_MERGED_REFERENCE_LEAK'] : []),
          ...(pendingSendCheck.issueCount ? ['WHATSAPP_PENDING_SEND_BINDING_MISMATCH'] : []),
          ...(sendRouteReadiness.blocked ? ['WHATSAPP_SEND_ROUTE_NOT_READY'] : []),
          ...(orphanAccountCheck.eligiblePlans.length ? ['WHATSAPP_ORPHAN_ACCOUNT_DUPLICATE_DATA'] : []),
          ...(orphanAccountCheck.ambiguousPlans.length ? ['WHATSAPP_ORPHAN_ACCOUNT_AMBIGUOUS'] : []),
          ...(foreignKeyViolations.length ? ['SQLITE_FOREIGN_KEY_VIOLATION'] : [])
        ]
      },
      reconciliationCoverage: {
        privateConversationCount: privateRows.length,
        authorityCoveredConversationCount: privateRows.length - withoutAuthority.length,
        authorityMissingConversationCount: withoutAuthority.length,
        authorityMissingConversations: withoutAuthority,
        finding: withoutAuthority.length
          ? '发现未进入身份权威的旧会话；本源码版本已加入 contacts/r32_conversations 反向发现，但必须先核对本报告，再在备份后的真实 Windows 数据上执行启动 reconciliation。'
          : '当前私人会话均至少有一条身份权威记录；仍需核对重复组、发送来源与客户/AI 绑定后再验收。'
      },
      orphanAccountCheck,
      sendRouteReadiness,
      mediaInventory,
      realSendEvidence: {
        outboundMessages: Number(outboundEvidence.outbound_count || 0),
        outboundMediaMessages: Number(outboundEvidence.outbound_media_count || 0),
        outboundAcknowledgedMessages: Number(outboundEvidence.outbound_acknowledged_count || 0),
        lastOutboundAt: clean(outboundEvidence.last_outbound_at),
        note: '该证据只统计 SQLite 中已落库的 WhatsApp 出站记录；本轮是否真实发送成功必须结合启动前后增量、平台回执和真实 UI。'
      },
      duplicateGroups,
      sameNameDifferentContacts,
      groupChats,
      selfIdentities,
      orphanOrInvalid,
      inactiveGroups,
      invalidIdentities,
      invalidCanonicalAuthorityRows: invalidCanonicalRows,
      mergedResidue: conversationRows.filter(row => row.mergedInto || row.contactMergedInto),
      allConversationRows: conversationRows,
      identityEdgeEvidence: edgeEvidence,
      authSessionInventory: authInventory(dataRoot),
      logs: discoverLogEvidence(dataRoot),
      schema: {
        tables: schemaTables,
        columns: Object.fromEntries(['r32_accounts','r32_conversations','r32_messages','contacts','customer_profiles','relationship_insights','ai_context_snapshots','r32_send_queue','whatsapp_identity_authority','identity_aliases','identity_merge_audit']
          .map(table => [table, tableColumns(db, table)]))
      },
      reconciliationPlan: duplicateGroups.map(group => ({
        accountId: group.accountId,
        canonicalJid: group.canonicalJid,
        aliases: group.aliases,
        sourceConversationIds: group.rows.filter(row => row.isActive).map(row => row.conversationId),
        sourceContactIds: unique(group.rows.map(row => row.contactId)),
        customerProfileBindings: unique(group.rows.filter(row => row.hasCustomerProfile).map(row => row.contactId)),
        relationshipInsightBindings: unique(group.rows.filter(row => row.hasRelationshipInsight).map(row => row.contactId)),
        aiContextCount: group.rows.reduce((sum, row) => sum + row.aiContextCount, 0),
        pendingSendCount: group.rows.reduce((sum, row) => sum + row.pendingSendCount, 0),
        sendSources: unique(group.rows.map(row => row.sendSource)),
        avatarFilesValid: group.rows.every(row => !row.avatarUrl || row.localAvatarExists),
        status: group.canonicalJid ? 'ready-for-backed-up-reconciliation' : 'blocked-invalid-canonical'
      })),
      nextActions: [
        '先核对 orphanAccountCheck：旧 accountId 与当前账号只有在多联系人、多外部消息证据一致且目标唯一时，才允许自动跨账号合并。',
        '再逐组核对 duplicateGroups 和 reconciliationPlan，确认 LID/手机号 JID 确属同一真实联系人。',
        '运行新源码前先备份 yance-r32.db、-wal、-shm，再保留本次只读 JSON/Markdown 报告。',
        '本版本会从 contacts/r32_conversations 反向发现旧别名，并拒绝 0@s.whatsapp.net、空 JID 和不合理 canonical。',
        '执行后重新运行本诊断，要求 duplicateGroups=0、invalidCanonicalAuthorityRows=0、mergeIntegrity.ok=true，并核对客户档案、关系轨迹、AI context、send queue 与 sendSource。',
        '最后在真实 Windows 检查唯一会话、统一姓名头像、完整 AI 历史、发送来源以及完全退出重启持久化。'
      ]
    };
    return report;
  } finally {
    db.close();
  }
}

function markdownReport(report) {
  const s = report.summary;
  const lines = [
    '# 言策 WhatsApp 真实身份专项诊断',
    '',
    `- 生成时间：${report.generatedAt}`,
    `- 数据目录：\`${report.source.dataRoot}\``,
    `- SQLite：\`${report.source.databasePath}\``,
    `- WhatsApp 账号：${s.whatsappAccounts}`,
    `- 会话 / 联系人 / 消息（总行）：${s.whatsappConversations} / ${s.whatsappContacts} / ${s.whatsappMessages}`,
    `- 活动会话 / 活动联系人：${s.whatsappActiveConversations} / ${s.whatsappActiveContacts}`,
    `- WhatsApp 出站消息：${s.whatsappOutboundMessages}（媒体 ${s.whatsappOutboundMediaMessages}，已有回执 ${s.whatsappOutboundAcknowledgedMessages}）`,
    `- 最近出站时间：${s.whatsappLastOutboundAt || '无'}`,
    `- 同账号内真正重复组：${s.duplicateGroups}`,
    `- 跨账号残留计划：${s.orphanAccountPlans}（高置信 ${s.eligibleOrphanAccountPlans}，歧义 ${s.ambiguousOrphanAccountPlans}）`,
    `- 未进入身份权威的私人会话：${s.privateConversationsWithoutAuthority}`,
    `- 无效身份：${s.invalidIdentityRows}`,
    `- 身份权威中的无效 canonical：${s.invalidCanonicalAuthorityRows}`,
    `- 有头像 URL 但本地文件缺失：${s.missingLocalAvatarFiles}`,
    `- 头像来源合同异常：${s.avatarProvenanceErrors}`,
    `- WhatsApp 媒体：总计 ${s.whatsappMediaTotal}，已恢复 ${s.whatsappMediaReady}，待恢复 ${s.whatsappMediaPending}，失败 ${s.whatsappMediaFailed}`,
    `- 缺少可重建媒体信封：${s.whatsappMediaMissingEnvelope}，本地文件缺失：${s.whatsappMediaMissingLocalFiles}`,
    `- 手机端伴随设备暂不支持重复组：${s.mobileUnsupportedEchoGroups}，重复行：${s.mobileUnsupportedEchoRows}`,
    `- 已隐藏的系统错误语音回声会话：${s.syntheticMobileEchoArtifactsHidden}`,
    `- 仍以号码/JID显示的会话：${s.weakDisplayNameConversations}`,
    `- 墓碑身份残留引用：${s.staleMergedReferences}`,
    `- 待发送队列目标不一致：${s.pendingSendPayloadMismatches}`,
    `- 可推导发送路由：${s.sendRouteReadyConversations}，阻断：${s.sendRouteBlockedConversations}`,
    `- SQLite 外键异常：${s.foreignKeyViolations}`,
    `- 合并完整性：${report.mergeIntegrity.ok ? '通过' : `阻断（${report.mergeIntegrity.blockers.join('、')}）`}`,
    '',
    '## 关键结论',
    '',
    report.reconciliationCoverage.finding,
    '',
    '## 重复组',
    ''
  ];
  if (!report.duplicateGroups.length) lines.push('未发现已被证据连接的多活动会话组。');
  for (const [index, group] of report.duplicateGroups.entries()) {
    lines.push(`### ${index + 1}. ${group.canonicalJid || '未解析身份'}`);
    lines.push('');
    lines.push(`- 原因：${group.reasonCodes.join('、') || '待人工核对'}`);
    lines.push(`- 别名：${group.aliases.join('，')}`);
    for (const row of group.rows) {
      lines.push(`- \`${row.sessionKey}\`｜${row.displayName || '无姓名'}｜消息 ${row.messageCount}｜头像 ${row.localAvatarExists ? '本地有效' : (row.avatarUrl ? 'URL存在但文件无效' : '为空')}｜发送来源 ${row.sendSource || '未记录'}`);
    }
    lines.push('');
  }
  lines.push('## 下一步');
  lines.push('');
  for (const action of report.nextActions) lines.push(`- ${action}`);
  lines.push('', '> 本报告包含私人联系人标识与本地路径，只用于本机 UAT。未导出认证密钥或消息正文。', '');
  return lines.join('\n');
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === '--data-root') options.dataRoot = argv[++index];
    else if (item === '--output') options.output = argv[++index];
    else if (item === '--markdown-output') options.markdownOutput = argv[++index];
    else if (item === '--stdout') options.stdout = true;
  }
  return options;
}

function writeReport(report, options = {}) {
  const stamp = report.generatedAt.replace(/[:.]/g, '-');
  const defaultRoot = path.join(report.source.dataRoot, 'diagnostics');
  const jsonPath = path.resolve(options.output || path.join(defaultRoot, `Yance-WhatsApp-Identity-Diagnostics-${stamp}.json`));
  const markdownPath = path.resolve(options.markdownOutput || jsonPath.replace(/\.json$/iu, '.md'));
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.mkdirSync(path.dirname(markdownPath), { recursive: true });
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(markdownPath, markdownReport(report), 'utf8');
  return { jsonPath, markdownPath };
}

function main() {
  const options = parseArgs();
  const report = buildDiagnostics(options);
  const written = writeReport(report, options);
  const result = { ok: true, ...written, summary: report.summary };
  if (options.stdout) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (report.summary.invalidCanonicalAuthorityRows > 0 || report.summary.duplicateGroups > 0 || !report.mergeIntegrity.ok) process.exitCode = 2;
}

if (require.main === module) {
  try { main(); }
  catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, code: error.code || 'WHATSAPP_IDENTITY_DIAGNOSTIC_FAILED', message: error.message, candidates: error.candidates || [] }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  buildDiagnostics,
  classifyJid,
  normalizeJid,
  phoneToken,
  phoneFieldJid,
  chooseCanonical,
  extractIdentityValues,
  mediaLocalFile,
  markdownReport,
  UnionFind,
  WHATSAPP_IDENTITY_CONTRACT_VERSION,
  P0_DIAGNOSTICS_BASELINE_COMMIT,
  WHATSAPP_MERGE_INTEGRITY_CONTRACT_VERSION,
  mergedReferenceIntegrity,
  pendingSendIntegrity,
  orphanAccountDiagnostics
};
