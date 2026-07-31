'use strict';

const { getStore } = require('../repositories/storeProvider');
const { parseJson } = require('../lib/r32SqliteStore');
const { inferLanguage } = require('./bilingualUnderstandingService');
const eventBus = require('./eventBus');

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeLanguage(value) {
  const raw = clean(value).toLowerCase().replace('_', '-');
  const aliases = {
    german: 'de', deutsch: 'de', deu: 'de',
    english: 'en', eng: 'en',
    chinese: 'zh', mandarin: 'zh', zho: 'zh',
    french: 'fr', fra: 'fr',
    spanish: 'es', spa: 'es',
    italian: 'it', ita: 'it',
    portuguese: 'pt', por: 'pt',
    russian: 'ru', rus: 'ru',
    arabic: 'ar', ara: 'ar',
    turkish: 'tr', tur: 'tr'
  };
  const candidate = aliases[raw] || raw.split('-')[0];
  return /^[a-z]{2,3}$/.test(candidate) ? candidate : 'unknown';
}

function emptyProfile() {
  return {
    primaryLanguage: 'unknown',
    currentLanguage: 'unknown',
    confidence: 0,
    source: 'message-observation',
    userOverride: '',
    counts: {},
    history: [],
    lastObservedAt: '',
    updatedAt: ''
  };
}

function asInput(input) {
  if (input && typeof input === 'object' && !Array.isArray(input)) return { ...input };
  return { contactId: clean(input) };
}

function storeAndOptions(optionsOrStore) {
  if (optionsOrStore?.db && !optionsOrStore.store) return { store: optionsOrStore, options: {} };
  const options = optionsOrStore && typeof optionsOrStore === 'object' ? optionsOrStore : {};
  return { store: options.store || getStore(), options };
}

function readConversation(conversationId, store) {
  const id = clean(conversationId);
  if (!id) return null;
  return store.db.prepare(`
    SELECT session_key, account_id, contact_id, platform, payload_json
    FROM r32_conversations WHERE session_key=?
  `).get(id) || null;
}

function readContact(contactId, store) {
  const id = clean(contactId);
  if (!id) return null;
  return store.db.prepare(`
    SELECT id, platform, account_id, external_id, canonical_contact_id, payload_json
    FROM contacts WHERE id=?
  `).get(id) || null;
}

function first(...values) {
  for (const value of values) {
    const text = clean(value);
    if (text) return text;
  }
  return '';
}

function scopeKeyOf(scope = {}) {
  const parts = [
    ['platform', scope.platform],
    ['sourceAccountId', scope.sourceAccountId],
    ['platformContactIdentity', scope.platformContactIdentity],
    ['conversationId', scope.conversationId],
    ['canonicalContactId', scope.canonicalContactId]
  ];
  return `v2|${parts.map(([key, value]) => `${key}=${encodeURIComponent(clean(value))}`).join('|')}`;
}

function resolveScope(input = {}, store = getStore()) {
  const reference = asInput(input);
  const requestedConversationId = first(reference.conversationId, reference.sessionKey);
  const conversation = readConversation(requestedConversationId, store);
  const conversationPayload = parseJson(conversation?.payload_json, {}) || {};
  const contactId = first(conversation?.contact_id, reference.contactId);
  const contact = readContact(contactId, store);
  const contactPayload = parseJson(contact?.payload_json, {}) || {};
  const canonicalContactId = first(
    reference.canonicalContactId,
    contact?.canonical_contact_id,
    contact?.id,
    contactId
  );
  const scope = {
    contactId: first(contact?.id, contactId),
    platform: first(reference.platform, conversation?.platform, contact?.platform, conversationPayload.platform, contactPayload.platform).toLowerCase(),
    sourceAccountId: first(reference.sourceAccountId, reference.accountId, conversation?.account_id, contact?.account_id, conversationPayload.sourceAccountId, conversationPayload.accountId, contactPayload.sourceAccountId, contactPayload.accountId),
    platformContactIdentity: first(
      reference.platformContactIdentity,
      reference.externalId,
      conversationPayload.platformContactIdentity,
      conversationPayload.chatJid,
      conversationPayload.remoteJid,
      conversationPayload.externalId,
      contact?.external_id,
      contactPayload.platformContactIdentity,
      contactPayload.chatJid,
      contactPayload.jid,
      contactPayload.externalId,
      contactPayload.phone
    ),
    conversationId: first(conversation?.session_key, requestedConversationId),
    canonicalContactId
  };
  return { ...scope, scopeKey: scopeKeyOf(scope) };
}

function resolveContactId(input = {}, store = getStore()) {
  return resolveScope(input, store).contactId;
}

function profileHasData(profile) {
  if (!profile || typeof profile !== 'object') return false;
  return Boolean(
    clean(profile.userOverride)
    || normalizeLanguage(profile.currentLanguage) !== 'unknown'
    || normalizeLanguage(profile.primaryLanguage) !== 'unknown'
    || Object.keys(profile.counts || {}).length
    || (Array.isArray(profile.history) && profile.history.length)
  );
}

function profileRecord(profile = {}) {
  const userOverride = normalizeLanguage(profile.userOverride);
  return {
    ...emptyProfile(),
    primaryLanguage: normalizeLanguage(profile.primaryLanguage),
    currentLanguage: normalizeLanguage(profile.currentLanguage),
    confidence: Math.max(0, Math.min(1, Number(profile.confidence || 0))),
    source: clean(profile.source) || 'message-observation',
    userOverride: userOverride === 'unknown' ? '' : userOverride,
    counts: profile.counts && typeof profile.counts === 'object' && !Array.isArray(profile.counts) ? { ...profile.counts } : {},
    history: Array.isArray(profile.history) ? profile.history.slice(-60) : [],
    lastObservedAt: clean(profile.lastObservedAt),
    updatedAt: clean(profile.updatedAt)
  };
}

function read(input, optionsOrStore = getStore()) {
  const { store, options } = storeAndOptions(optionsOrStore);
  const scope = resolveScope({ ...asInput(input), ...options }, store);
  if (!scope.contactId) return { ...scope, ...emptyProfile(), inheritedFromLegacy: false };
  const row = readContact(scope.contactId, store);
  if (!row) return { ...scope, ...emptyProfile(), inheritedFromLegacy: false };
  const payload = parseJson(row.payload_json, {}) || {};
  const scopedProfiles = payload.languageProfilesByScope && typeof payload.languageProfilesByScope === 'object'
    ? payload.languageProfilesByScope
    : {};
  const scoped = scopedProfiles[scope.scopeKey];
  const legacy = payload.languageProfile && typeof payload.languageProfile === 'object' ? payload.languageProfile : {};
  const hasScopedProfiles = Object.keys(scopedProfiles).length > 0;
  const inheritedFromLegacy = !hasScopedProfiles && !profileHasData(scoped) && profileHasData(legacy);
  const selected = profileRecord(inheritedFromLegacy ? legacy : scoped || {});
  return {
    ...selected,
    ...scope,
    inheritedFromLegacy
  };
}

function strongestLanguage(counts = {}) {
  const rows = Object.entries(counts)
    .filter(([language, count]) => language !== 'unknown' && Number(count) > 0)
    .sort((left, right) => Number(right[1]) - Number(left[1]) || left[0].localeCompare(right[0]));
  if (!rows.length) return { language: 'unknown', confidence: 0 };
  const total = rows.reduce((sum, row) => sum + Number(row[1] || 0), 0);
  return {
    language: rows[0][0],
    confidence: total > 0 ? Math.max(0, Math.min(1, Number(rows[0][1] || 0) / total)) : 0
  };
}

function write(input, profile, optionsOrStore = getStore()) {
  const { store, options } = storeAndOptions(optionsOrStore);
  const scope = resolveScope({ ...asInput(input), ...options }, store);
  if (!scope.contactId) return { ...scope, ...emptyProfile() };
  const row = readContact(scope.contactId, store);
  if (!row) return { ...scope, ...emptyProfile() };
  const payload = parseJson(row.payload_json, {}) || {};
  const nextProfile = {
    ...profileRecord(profile),
    scope: {
      platform: scope.platform,
      sourceAccountId: scope.sourceAccountId,
      platformContactIdentity: scope.platformContactIdentity,
      conversationId: scope.conversationId,
      canonicalContactId: scope.canonicalContactId
    },
    updatedAt: nowIso()
  };
  const profiles = payload.languageProfilesByScope && typeof payload.languageProfilesByScope === 'object'
    ? { ...payload.languageProfilesByScope }
    : {};
  profiles[scope.scopeKey] = nextProfile;
  const retained = Object.entries(profiles)
    .sort((left, right) => clean(right[1]?.updatedAt).localeCompare(clean(left[1]?.updatedAt)))
    .slice(0, 64);
  payload.languageProfilesByScope = Object.fromEntries(retained);
  if (!profileHasData(payload.languageProfile) || retained.length === 1) payload.languageProfile = nextProfile;
  store.db.prepare('UPDATE contacts SET payload_json=?, updated_at=? WHERE id=?')
    .run(JSON.stringify(payload), nextProfile.updatedAt, scope.contactId);
  eventBus.publish('contact:language-updated', {
    contactId: scope.contactId,
    canonicalContactId: scope.canonicalContactId,
    conversationId: scope.conversationId,
    platform: scope.platform,
    sourceAccountId: scope.sourceAccountId,
    platformContactIdentity: scope.platformContactIdentity,
    scopeKey: scope.scopeKey,
    languageProfile: nextProfile
  });
  return { ...nextProfile, ...scope, inheritedFromLegacy: false };
}

function observeMessage(input = {}, options = {}) {
  const store = options.store || getStore();
  const scope = resolveScope(input, store);
  if (!scope.contactId) return { ...scope, ...emptyProfile(), observed: false };
  const direction = clean(input.direction).toLowerCase();
  const fromMe = input.fromMe === true || direction === 'outbound' || direction === 'outgoing';
  const text = clean(input.text || input.transcript || input.caption);
  const language = normalizeLanguage(input.sourceLanguage || input.language || inferLanguage(text));
  if (!text || language === 'unknown') return { ...read(scope, { store }), observed: false };

  const current = read(scope, { store });
  const messageId = clean(input.id || input.messageId || input.externalMessageId);
  const history = Array.isArray(current.history) ? current.history : [];
  if (messageId && history.some(row => clean(row?.messageId) === messageId)) {
    return { ...current, observed: false, duplicateObservation: true };
  }

  const counts = { ...(current.counts || {}) };
  counts[language] = Number(counts[language] || 0) + (fromMe ? 0.35 : 1);
  const strongest = strongestLanguage(counts);
  const userOverride = normalizeLanguage(current.userOverride);
  const currentLanguage = fromMe
    ? normalizeLanguage(current.currentLanguage)
    : language;
  const primaryLanguage = userOverride !== 'unknown' ? userOverride : strongest.language;
  const nextHistory = [
    ...history,
    {
      language,
      direction: fromMe ? 'outbound' : 'inbound',
      messageId,
      platform: scope.platform,
      sourceAccountId: scope.sourceAccountId,
      platformContactIdentity: scope.platformContactIdentity,
      conversationId: scope.conversationId,
      observedAt: clean(input.sentAt || input.timestamp) || nowIso()
    }
  ].slice(-60);
  return {
    ...write(scope, {
      ...current,
      primaryLanguage,
      currentLanguage: userOverride !== 'unknown' ? userOverride : currentLanguage,
      confidence: userOverride !== 'unknown' ? 1 : strongest.confidence,
      source: userOverride !== 'unknown' ? 'user-override' : 'message-observation',
      counts,
      history: nextHistory,
      lastObservedAt: nextHistory.at(-1)?.observedAt || nowIso()
    }, { store }),
    observed: true
  };
}

function setUserOverride(input, language, options = {}) {
  const store = options.store || getStore();
  const scope = resolveScope({ ...asInput(input), ...options }, store);
  const normalized = normalizeLanguage(language);
  const current = read(scope, { store });
  const userOverride = normalized === 'unknown' ? '' : normalized;
  const strongest = strongestLanguage(current.counts || {});
  return write(scope, {
    ...current,
    userOverride,
    primaryLanguage: userOverride || strongest.language,
    currentLanguage: userOverride || current.currentLanguage || strongest.language,
    confidence: userOverride ? 1 : strongest.confidence,
    source: userOverride ? 'user-override' : 'message-observation'
  }, { store });
}

function targetLanguage(input, options = {}) {
  const profile = read(input, options);
  const language = normalizeLanguage(profile.userOverride || profile.currentLanguage || profile.primaryLanguage);
  return language === 'unknown' ? '' : language;
}

module.exports = {
  normalizeLanguage,
  emptyProfile,
  resolveScope,
  resolveContactId,
  scopeKeyOf,
  strongestLanguage,
  read,
  observeMessage,
  setUserOverride,
  targetLanguage
};
