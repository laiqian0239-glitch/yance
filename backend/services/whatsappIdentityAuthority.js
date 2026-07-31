'use strict';

const { getStore } = require('../repositories/storeProvider');
const { normalizePhone, looksLikeRawJid } = require('./whatsappIdentity');

function clean(value, max = 500) { return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max); }
function classifyJid(value) {
  const raw = clean(value, 300).toLowerCase();
  if (!raw || !raw.includes('@')) return { raw, normalized: '', valid: false, canonicalEligible: false, kind: 'missing', reasonCode: 'WHATSAPP_JID_MISSING' };
  if (raw === 'status@broadcast') return { raw, normalized: '', valid: false, canonicalEligible: false, kind: 'broadcast', reasonCode: 'WHATSAPP_JID_BROADCAST_UNSUPPORTED' };
  const [localRaw, domainRaw = ''] = raw.split('@');
  const domain = domainRaw === 'c.us' ? 's.whatsapp.net' : domainRaw.replace(/^c\./, '');
  const local = domain === 'g.us' ? localRaw : localRaw.replace(/:\d+$/, '');
  if (!local || !domain || ['broadcast', 'newsletter'].includes(domain)) return { raw, normalized: '', valid: false, canonicalEligible: false, kind: 'unsupported', reasonCode: 'WHATSAPP_JID_UNSUPPORTED' };
  if (domain === 's.whatsapp.net') {
    const aliasValid = /^\d{1,20}$/.test(local) && !/^0+$/.test(local);
    const canonicalEligible = aliasValid && local.length >= 7;
    return {
      raw,
      normalized: aliasValid ? `${local}@s.whatsapp.net` : '',
      valid: aliasValid,
      canonicalEligible,
      kind: 'phone-jid',
      reasonCode: canonicalEligible ? '' : (aliasValid ? 'WHATSAPP_PHONE_JID_TOO_SHORT' : 'WHATSAPP_PHONE_JID_INVALID')
    };
  }
  if (domain === 'lid') {
    const aliasValid = /^\d{1,30}$/.test(local) && !/^0+$/.test(local);
    const canonicalEligible = aliasValid && local.length >= 5;
    return {
      raw,
      normalized: aliasValid ? `${local}@lid` : '',
      valid: aliasValid,
      canonicalEligible,
      kind: 'lid-jid',
      reasonCode: canonicalEligible ? '' : (aliasValid ? 'WHATSAPP_LID_TOO_SHORT' : 'WHATSAPP_LID_INVALID')
    };
  }
  if (domain === 'g.us') {
    const valid = /^(?:\d{5,20}-\d{5,20}|\d{10,30})$/.test(local);
    return { raw, normalized: valid ? `${local}@g.us` : '', valid, canonicalEligible: valid, kind: 'group-jid', reasonCode: valid ? '' : 'WHATSAPP_GROUP_JID_INVALID' };
  }
  return { raw, normalized: '', valid: false, canonicalEligible: false, kind: 'unsupported-domain', reasonCode: 'WHATSAPP_JID_DOMAIN_UNSUPPORTED' };
}
function normalizeJid(value) { return classifyJid(value).normalized; }
function weakName(value, jid = '') {
  const text = clean(value, 180);
  if (!text) return true;
  if (looksLikeRawJid(text) || /^(?:whatsapp(?: 联系人| 群聊| 账号)?|未知联系人|联系人|me|myself|self|我|自己|本账号|当前账号)$/i.test(text)) return true;
  const compact = text.replace(/[\s()+-]/g, '');
  if (/^\d{7,}$/.test(compact)) return true;
  const phone = normalizePhone(jid);
  return Boolean(phone && compact === phone);
}
function scoreName(value, source = '', jid = '') {
  if (weakName(value, jid)) return 0;
  const sourceText = clean(source, 80).toLowerCase();
  if (/pushname|live-message|verified/.test(sourceText)) return 100;
  if (/directory|contact|history-set/.test(sourceText)) return 82;
  if (/historical-message|message-history/.test(sourceText)) return 72;
  if (/manual|profile/.test(sourceText)) return 110;
  if (/stored|conversation/.test(sourceText)) return 55;
  return 65;
}
function ensureSchema() {
  getStore().db.exec(`
    CREATE TABLE IF NOT EXISTS whatsapp_identity_authority (
      account_id TEXT NOT NULL,
      alias_jid TEXT NOT NULL,
      canonical_jid TEXT NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      name_score INTEGER NOT NULL DEFAULT 0,
      name_source TEXT NOT NULL DEFAULT '',
      avatar_url TEXT NOT NULL DEFAULT '',
      avatar_source TEXT NOT NULL DEFAULT '',
      aliases_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL,
      PRIMARY KEY(account_id, alias_jid)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_whatsapp_identity_authority_canonical
      ON whatsapp_identity_authority(account_id, canonical_jid);
  `);
}
function parseAliases(value) { try { const rows = JSON.parse(value || '[]'); return Array.isArray(rows) ? rows : []; } catch (_) { return []; } }
function chooseCanonical(aliases = [], preferred = '') {
  const classified = [...new Set([preferred, ...aliases].map(value => clean(value, 300)).filter(Boolean))]
    .map(classifyJid)
    .filter(row => row.valid);
  const pool = classified.filter(row => row.canonicalEligible);
  const preferredNormalized = classifyJid(preferred).normalized;
  const preferredRow = pool.find(row => row.normalized === preferredNormalized);
  if (preferredRow?.kind === 'phone-jid') return preferredRow.normalized;
  return pool.find(row => row.kind === 'phone-jid')?.normalized
    || pool.find(row => row.kind === 'group-jid')?.normalized
    || pool.find(row => row.kind === 'lid-jid')?.normalized
    || preferredRow?.normalized
    || pool[0]?.normalized
    || '';
}
function resolve(accountId, aliases = []) {
  ensureSchema();
  const normalized = [...new Set((Array.isArray(aliases) ? aliases : [aliases]).map(normalizeJid).filter(Boolean))];
  if (!normalized.length) return null;
  const placeholders = normalized.map(() => '?').join(',');
  const rows = getStore().db.prepare(`
    SELECT * FROM whatsapp_identity_authority
    WHERE account_id=? AND alias_jid IN (${placeholders})
    ORDER BY name_score DESC, CASE WHEN avatar_url<>'' THEN 1 ELSE 0 END DESC, updated_at DESC
  `).all(clean(accountId, 160), ...normalized);
  if (!rows.length) return null;
  const aliasesMerged = [...new Set([...normalized, ...rows.flatMap(row => parseAliases(row.aliases_json)), ...rows.map(row => row.alias_jid), ...rows.map(row => row.canonical_jid)].map(normalizeJid).filter(Boolean))];
  const canonicalJid = chooseCanonical(aliasesMerged, rows.find(row => row.canonical_jid.endsWith('@s.whatsapp.net'))?.canonical_jid || rows[0].canonical_jid);
  if (!canonicalJid) return null;
  const nameRow = rows.find(row => row.name_score > 0 && !weakName(row.display_name, canonicalJid));
  const avatarRow = rows.find(row => clean(row.avatar_url));
  return {
    canonicalJid,
    aliases: aliasesMerged,
    displayName: nameRow?.display_name || '',
    nameScore: Number(nameRow?.name_score || 0),
    nameSource: nameRow?.name_source || '',
    avatarUrl: avatarRow?.avatar_url || '',
    avatarSource: avatarRow?.avatar_source || ''
  };
}
function record(input = {}) {
  ensureSchema();
  const accountId = clean(input.accountId, 160);
  const aliases = [...new Set([...(Array.isArray(input.aliases) ? input.aliases : []), input.aliasJid, input.canonicalJid].map(normalizeJid).filter(Boolean))];
  if (!accountId || !aliases.length) return null;
  const current = resolve(accountId, aliases) || {};
  const canonicalJid = chooseCanonical([...aliases, ...(current.aliases || [])], input.canonicalJid || current.canonicalJid);
  if (!canonicalJid) return null;
  const proposedName = clean(input.displayName, 180);
  const proposedScore = Number(input.nameScore ?? scoreName(proposedName, input.nameSource || input.source, canonicalJid));
  const useProposedName = proposedScore > Number(current.nameScore || 0) && !weakName(proposedName, canonicalJid);
  const displayName = useProposedName ? proposedName : (current.displayName || '');
  const nameScore = useProposedName ? proposedScore : Number(current.nameScore || 0);
  const nameSource = useProposedName ? clean(input.nameSource || input.source, 80) : (current.nameSource || '');
  const avatarUrl = clean(input.avatarUrl, 2000) || current.avatarUrl || '';
  const avatarSource = clean(input.avatarUrl, 2000) ? clean(input.avatarSource || input.source, 80) : (current.avatarSource || '');
  const mergedAliases = [...new Set([...aliases, ...(current.aliases || [])])];
  const updatedAt = new Date().toISOString();
  const statement = getStore().db.prepare(`
    INSERT INTO whatsapp_identity_authority(
      account_id,alias_jid,canonical_jid,display_name,name_score,name_source,
      avatar_url,avatar_source,aliases_json,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(account_id,alias_jid) DO UPDATE SET
      canonical_jid=excluded.canonical_jid,
      display_name=CASE WHEN excluded.name_score>whatsapp_identity_authority.name_score THEN excluded.display_name ELSE whatsapp_identity_authority.display_name END,
      name_score=MAX(whatsapp_identity_authority.name_score,excluded.name_score),
      name_source=CASE WHEN excluded.name_score>whatsapp_identity_authority.name_score THEN excluded.name_source ELSE whatsapp_identity_authority.name_source END,
      avatar_url=CASE WHEN excluded.avatar_url<>'' THEN excluded.avatar_url ELSE whatsapp_identity_authority.avatar_url END,
      avatar_source=CASE WHEN excluded.avatar_url<>'' THEN excluded.avatar_source ELSE whatsapp_identity_authority.avatar_source END,
      aliases_json=excluded.aliases_json,
      updated_at=excluded.updated_at
  `);
  const aliasesJson = JSON.stringify(mergedAliases);
  getStore().transaction(() => {
    for (const alias of mergedAliases) statement.run(accountId, alias, canonicalJid, displayName, nameScore, nameSource, avatarUrl, avatarSource, aliasesJson, updatedAt);
  });
  return resolve(accountId, mergedAliases);
}
function recordAvatar(input = {}) { return record({ ...input, displayName: '', nameScore: 0, avatarSource: input.avatarSource || input.source || 'avatar-sync' }); }

module.exports = { classifyJid, normalizeJid, weakName, scoreName, chooseCanonical, resolve, record, recordAvatar, ensureSchema };
