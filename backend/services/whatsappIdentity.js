'use strict';

function clean(value) { return String(value == null ? '' : value).trim(); }

function normalizeJid(value) {
  const raw = clean(value).toLowerCase();
  if (!raw) return '';
  const at = raw.indexOf('@');
  if (at < 0) return '';
  const local = raw.slice(0, at).replace(/:\d+$/, '').replace(/\D/g, '');
  const domain = raw.slice(at + 1).replace(/^c\./, '');
  if (!local || !domain) return '';
  return `${local}@${domain}`;
}

function normalizePhone(value) {
  const raw = clean(value);
  const jid = normalizeJid(raw);
  const source = jid ? jid.split('@')[0] : raw;
  const digits = source.replace(/\D/g, '');
  return digits.length >= 7 ? digits : '';
}

function looksLikeRawJid(value) {
  const raw = clean(value).toLowerCase();
  return /@(?:s\.whatsapp\.net|lid|g\.us)$/.test(raw) || /^\d+:\d+@/.test(raw);
}

function safeDisplayName(...values) {
  for (const value of values) {
    const text = clean(value);
    if (!text || looksLikeRawJid(text)) continue;
    if (/^\+?\d{7,}$/.test(text.replace(/[\s()-]/g, ''))) continue;
    return text.slice(0, 120);
  }
  return 'WhatsApp 账号';
}

function identityTokens(account = {}) {
  const metadata = account.metadata || {};
  const candidates = [
    metadata.liveUser?.id, metadata.liveUser?.lid, metadata.phone, metadata.jid,
    account.identityLabel, account.displayName, account.adapterAccountId,
    metadata.resolvedAuthAccountKey, metadata.openClawAccountId
  ];
  const tokens = new Set();
  for (const value of candidates) {
    const jid = normalizeJid(value);
    const phone = normalizePhone(value);
    if (jid) tokens.add(`jid:${jid}`);
    if (phone) tokens.add(`phone:${phone}`);
  }
  const credentialDirectory = clean(metadata.credentialDirectory || metadata.authDirectory);
  if (credentialDirectory) tokens.add(`credential:${credentialDirectory.toLowerCase()}`);
  const migrationSource = clean(metadata.migrationSource || metadata.recoveredFrom);
  if (migrationSource) tokens.add(`source:${migrationSource.toLowerCase()}`);
  return [...tokens];
}

module.exports = { clean, normalizeJid, normalizePhone, looksLikeRawJid, safeDisplayName, identityTokens };
