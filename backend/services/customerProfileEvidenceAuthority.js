'use strict';

const crypto = require('crypto');

const DEFAULT_PROJECTION_VERSION = 'customer-profile-evidence-v1';

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value) {
  return clean(value).normalize('NFKC').replace(/\s+/gu, ' ').toLowerCase();
}

function digest(parts) {
  return crypto.createHash('sha256')
    .update(parts.map(value => clean(value)).join('\u001f'))
    .digest('hex');
}

function stableId(prefix, parts) {
  return `${prefix}_${digest(parts).slice(0, 32)}`;
}

function firstText(...values) {
  for (const value of values) {
    const text = clean(value);
    if (text) return text;
  }
  return '';
}

function messageIdentity(message = {}, scope = {}) {
  const payload = object(message.payload);
  const sourceText = firstText(message.sourceText, payload.sourceText, message.text, payload.text);
  const translatedZh = firstText(
    message.translatedZh,
    message.translationZh,
    message.chineseTranslation,
    payload.translatedZh,
    payload.translationZh,
    message.lastSuccessfulTranslatedZh,
    payload.lastSuccessfulTranslatedZh
  );
  const platformMessageId = firstText(
    message.platformMessageId,
    message.externalMessageId,
    message.messageId,
    message.id,
    payload.platformMessageId,
    payload.externalMessageId,
    payload.messageId,
    payload.id
  );
  return {
    message,
    sourceText,
    translatedZh,
    translationStatus: translatedZh
      ? 'success'
      : firstText(message.translationStatus, payload.translationStatus, 'pending'),
    translationModel: firstText(
      message.translationModel,
      payload.translationModel,
      message.lastSuccessfulTranslationModel,
      payload.lastSuccessfulTranslationModel
    ),
    platform: firstText(message.platform, payload.platform, scope.platform).toLowerCase(),
    sourceAccountId: firstText(message.sourceAccountId, message.accountId, payload.sourceAccountId, payload.accountId, scope.sourceAccountId),
    platformContactIdentity: firstText(
      message.platformContactIdentity,
      message.contactIdentity,
      payload.platformContactIdentity,
      payload.chatJid,
      payload.remoteJid,
      payload.externalId,
      scope.platformContactIdentity
    ),
    conversationId: firstText(message.conversationId, message.sessionKey, payload.conversationId, payload.sessionKey, scope.conversationId),
    canonicalContactId: firstText(message.canonicalContactId, payload.canonicalContactId, scope.canonicalContactId),
    platformMessageId
  };
}

function buildMessageIndex(messages = [], scope = {}) {
  const byId = new Map();
  const byText = new Map();
  for (const raw of array(messages)) {
    const row = messageIdentity(raw, scope);
    const payload = object(raw.payload);
    const ids = new Set([
      row.platformMessageId,
      raw.id,
      raw.dedupeKey,
      raw.externalMessageId,
      raw.platformMessageId,
      raw.messageId,
      payload.id,
      payload.externalMessageId,
      payload.platformMessageId,
      payload.messageId
    ].map(clean).filter(Boolean));
    ids.forEach(id => byId.set(id, row));
    const textKey = normalizeText(row.sourceText);
    if (textKey) {
      const existing = byText.get(textKey) || [];
      existing.push(row);
      byText.set(textKey, existing);
    }
  }
  return { byId, byText, scope: object(scope) };
}

function candidateMessageIds(row = {}) {
  const item = object(row);
  return [
    item.platformMessageId,
    item.messageId,
    item.sourceMessageId,
    item.id,
    object(item.evidence).platformMessageId,
    object(item.evidence).messageId
  ].map(clean).filter(Boolean);
}

function selectMessage(row = {}, index = buildMessageIndex()) {
  for (const id of candidateMessageIds(row)) {
    const match = index.byId.get(id);
    if (match) return match;
  }
  const item = object(row);
  const sourceText = firstText(item.sourceText, item.originalText, item.quote, item.text, item.summary, item.description, item.value, item.fact, item.content);
  const matches = index.byText.get(normalizeText(sourceText)) || [];
  if (matches.length === 1) return matches[0];
  return null;
}

function evidenceType(row = {}, fallback = 'evidence') {
  const item = object(row);
  const base = firstText(item.evidenceType, item.kind, item.type, fallback).toLowerCase();
  const qualifier = normalizeText(firstText(item.key, item.title, item.label, item.claim, item.name));
  return qualifier ? `${base}:${qualifier}` : base;
}

function resolveProjectionRow(row = {}, options = {}) {
  const item = object(row);
  const scope = object(options.scope);
  const index = options.messageIndex || buildMessageIndex(options.messages, scope);
  const matched = selectMessage(item, index);
  const sourceText = firstText(
    item.sourceText,
    item.originalText,
    item.quote,
    item.text,
    item.summary,
    item.description,
    item.value,
    item.fact,
    item.content,
    matched?.sourceText
  );
  const translatedZh = firstText(
    item.translatedZh,
    item.translationZh,
    item.textZh,
    item.chinese,
    item.displayTextZh,
    matched?.translatedZh
  );
  const type = evidenceType(item, options.defaultType || 'evidence');
  const projectionVersion = firstText(item.projectionVersion, options.projectionVersion, DEFAULT_PROJECTION_VERSION);
  const platform = firstText(item.platform, matched?.platform, scope.platform).toLowerCase();
  const sourceAccountId = firstText(item.sourceAccountId, item.accountId, matched?.sourceAccountId, scope.sourceAccountId);
  const platformContactIdentity = firstText(item.platformContactIdentity, matched?.platformContactIdentity, scope.platformContactIdentity);
  const conversationId = firstText(item.conversationId, item.sessionKey, matched?.conversationId, scope.conversationId);
  const canonicalContactId = firstText(item.canonicalContactId, matched?.canonicalContactId, scope.canonicalContactId);
  const platformMessageId = firstText(
    item.platformMessageId,
    item.messageId,
    item.sourceMessageId,
    matched?.platformMessageId,
    sourceText ? `content:${digest([sourceText]).slice(0, 24)}` : ''
  );
  const idempotencyKey = digest([
    canonicalContactId,
    platform,
    sourceAccountId,
    conversationId,
    platformMessageId,
    type,
    projectionVersion
  ]);
  const translationStatus = translatedZh
    ? 'success'
    : firstText(item.translationStatus, matched?.translationStatus, sourceText ? 'pending' : 'empty');
  const displayText = translatedZh || (/\p{Script=Han}/u.test(sourceText) ? sourceText : (sourceText ? '中文理解待生成' : ''));
  return {
    ...item,
    id: options.preserveId && clean(item.id) ? clean(item.id) : stableId('profile_evidence', [idempotencyKey]),
    idempotencyKey,
    evidenceType: type,
    projectionVersion,
    platform,
    sourceAccountId,
    platformContactIdentity,
    conversationId,
    canonicalContactId,
    platformMessageId,
    messageId: platformMessageId,
    sourceText,
    translatedZh,
    displayText,
    translationStatus,
    translationPending: Boolean(sourceText && !translatedZh && !/\p{Script=Han}/u.test(sourceText)),
    translationModel: firstText(item.translationModel, matched?.translationModel),
    displayOriginal: Boolean(sourceText && sourceText !== displayText),
    evidence: array(item.evidence)
  };
}

function mergeRows(current, incoming) {
  if (!current) return incoming;
  const translatedZh = firstText(current.translatedZh, incoming.translatedZh);
  const sourceText = firstText(current.sourceText, incoming.sourceText);
  const displayText = translatedZh || firstText(current.displayText, incoming.displayText);
  const evidence = dedupeRows([...array(current.evidence), ...array(incoming.evidence)], {
    scope: {
      platform: firstText(current.platform, incoming.platform),
      sourceAccountId: firstText(current.sourceAccountId, incoming.sourceAccountId),
      platformContactIdentity: firstText(current.platformContactIdentity, incoming.platformContactIdentity),
      conversationId: firstText(current.conversationId, incoming.conversationId),
      canonicalContactId: firstText(current.canonicalContactId, incoming.canonicalContactId)
    },
    projectionVersion: firstText(current.projectionVersion, incoming.projectionVersion),
    defaultType: 'nested-evidence'
  });
  return {
    ...incoming,
    ...current,
    sourceText,
    translatedZh,
    displayText,
    translationStatus: translatedZh ? 'success' : firstText(current.translationStatus, incoming.translationStatus, 'pending'),
    translationPending: Boolean(sourceText && !translatedZh && !/\p{Script=Han}/u.test(sourceText)),
    translationModel: firstText(current.translationModel, incoming.translationModel),
    displayOriginal: Boolean(sourceText && sourceText !== displayText),
    confidence: Math.max(Number(current.confidence || 0), Number(incoming.confidence || 0)),
    evidence
  };
}

function dedupeRows(rows = [], options = {}) {
  const index = options.messageIndex || buildMessageIndex(options.messages, options.scope);
  const byKey = new Map();
  for (const raw of array(rows)) {
    if (!raw) continue;
    const resolved = resolveProjectionRow(raw, { ...options, messageIndex: index });
    const nested = array(raw.evidence).length
      ? dedupeRows(raw.evidence, { ...options, messageIndex: index, defaultType: 'nested-evidence' })
      : [];
    const normalized = { ...resolved, evidence: nested };
    byKey.set(normalized.idempotencyKey, mergeRows(byKey.get(normalized.idempotencyKey), normalized));
  }
  return [...byKey.values()];
}

function flattenPresentation(presentation = {}, options = {}) {
  const source = object(presentation);
  const rows = [];
  for (const key of ['facts', 'inferences', 'commitments', 'boundaries', 'milestones', 'risks', 'recommendations']) {
    for (const row of array(source[key])) {
      if (clean(row.extractionMethod).toLowerCase() === 'deterministic-rule') continue;
      rows.push({ ...row, evidenceType: evidenceType(row, key) });
      const parentIds = new Set(candidateMessageIds(row));
      for (const nested of array(row.evidence)) {
        const repeatsParentMessage = candidateMessageIds(nested).some(id => parentIds.has(id));
        if (repeatsParentMessage) continue;
        rows.push({ ...nested, evidenceType: evidenceType(nested, `${key}-source`) });
      }
    }
  }
  const relationship = object(source.relationship);
  for (const row of array(relationship.evidence)) rows.push({ ...row, evidenceType: evidenceType(row, 'relationship-evidence') });
  for (const row of array(relationship.events)) rows.push({ ...row, evidenceType: evidenceType(row, 'relationship-event') });
  return dedupeRows(rows, options);
}

function persistProjection(store, presentation = {}, options = {}) {
  if (!store?.db?.prepare) throw new TypeError('SQLite store is required');
  const rows = flattenPresentation(presentation, options);
  const timestamp = clean(options.timestamp) || new Date().toISOString();
  const statement = store.db.prepare(`
    INSERT INTO customer_profile_evidence(
      evidence_id, idempotency_key, canonical_contact_id, platform, source_account_id,
      platform_contact_identity, conversation_id, platform_message_id, evidence_type,
      projection_version, source_text, translated_zh, translation_status, translation_model,
      confidence, payload_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(idempotency_key) DO UPDATE SET
      source_text=excluded.source_text,
      translated_zh=CASE WHEN excluded.translated_zh<>'' THEN excluded.translated_zh ELSE customer_profile_evidence.translated_zh END,
      translation_status=CASE WHEN excluded.translated_zh<>'' THEN 'success' ELSE excluded.translation_status END,
      translation_model=CASE WHEN excluded.translation_model<>'' THEN excluded.translation_model ELSE customer_profile_evidence.translation_model END,
      confidence=MAX(customer_profile_evidence.confidence, excluded.confidence),
      payload_json=excluded.payload_json,
      updated_at=excluded.updated_at
  `);
  for (const row of rows) {
    statement.run(
      row.id,
      row.idempotencyKey,
      row.canonicalContactId,
      row.platform,
      row.sourceAccountId,
      row.platformContactIdentity,
      row.conversationId,
      row.platformMessageId,
      row.evidenceType,
      row.projectionVersion,
      row.sourceText,
      row.translatedZh,
      row.translationStatus,
      row.translationModel,
      Number(row.confidence || 0),
      JSON.stringify(row),
      timestamp,
      timestamp
    );
  }
  return {
    rows: rows.length,
    idempotencyKeys: rows.map(row => row.idempotencyKey),
    status: 'REAL_DB_REPLAY_PASS'
  };
}

module.exports = {
  DEFAULT_PROJECTION_VERSION,
  buildMessageIndex,
  messageIdentity,
  resolveProjectionRow,
  dedupeRows,
  flattenPresentation,
  persistProjection,
  evidenceType,
  normalizeText
};
