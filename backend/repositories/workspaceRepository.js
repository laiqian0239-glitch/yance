'use strict';

const crypto = require('node:crypto');
const { getStore } = require('./storeProvider');
const { stableId, parseJson } = require('../lib/r32SqliteStore');
const aiAnalysisResultAuthority = require('../services/aiAnalysisResultAuthority');
const eventBus = require('../services/eventBus');
const socialChineseUnderstandingService = require('../services/socialChineseUnderstandingService');
const modelTaskRuntimePolicy = require('../services/modelTaskRuntimePolicy');
const customerProfileEvidenceAuthority = require('../services/customerProfileEvidenceAuthority');
const relationshipProjectionAuthority = require('../services/relationshipProjectionAuthority');
const { buildSocialAnalysisPresentation } = require('../services/socialAnalysisPresentationService');
const contactFactExtractionService = require('../services/contactFactExtractionService');
const messageSpeakerAuthority = require('../services/messageSpeakerAuthority');
const socialConversationBootstrapAuthority = require('../services/socialConversationBootstrapAuthority');
const { SqliteStorePersistenceAdapter } = require('../store/adapters/SqliteStorePersistenceAdapter');
const { PersonContextAuthority, singleton: personContextAuthority } = require('../services/personContextAuthority');
const { createPlatformCoreRepository } = require('./platformCoreRepository');

function nowIso() { return new Date().toISOString(); }
function clean(value, fallback = '') { return value == null ? fallback : String(value).trim(); }
function json(value) { return JSON.stringify(value ?? null); }
function number(value, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function clamp(value, min = 0, max = 100, fallback = 0) { return Math.max(min, Math.min(max, number(value, fallback))); }
function array(value) { return Array.isArray(value) ? value : []; }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function first(...values) { return values.find(value => value !== undefined && value !== null && clean(value)) ?? ''; }

function personSnapshot(input = {}, store = getStore()) {
  try {
    if (store === getStore()) return personContextAuthority.snapshot(input);
    const repository = createPlatformCoreRepository({ storeProvider: () => store });
    return new PersonContextAuthority({ repository }).snapshot(input);
  } catch (_) {
    return null;
  }
}

function personProfileView(personContext, physicalProfile = {}) {
  if (!personContext?.found) return physicalProfile;
  const projection = object(personContext.profile);
  const confirmed = array(projection.confirmedFacts);
  const inferences = array(projection.inferredFacts);
  return {
    ...physicalProfile,
    exists: projection.exists === true || physicalProfile.exists === true,
    authority: 'PersonContextAuthority',
    authoritySnapshotId: clean(projection.snapshotId),
    personId: personContext.personId,
    sourceContactIds: personContext.contactIds,
    facts: object(projection.facts),
    confirmed,
    confirmedFacts: confirmed,
    inferences,
    inferredFacts: inferences,
    factConflicts: array(projection.conflicts),
    droppedFactAliases: array(projection.droppedAliases),
    factCount: Number(projection.factCount || confirmed.length),
    evidenceCount: Number(projection.evidenceCount || 0),
    evidenceMessageIds: array(projection.evidenceMessageIds),
    health: Number(projection.health ?? physicalProfile.health ?? 0),
    profileHealth: Number(projection.health ?? physicalProfile.health ?? 0),
    healthBreakdown: object(projection.healthBreakdown),
    tags: array(projection.tags).length ? array(projection.tags) : array(physicalProfile.tags),
    traits: Object.keys(object(projection.traits)).length ? object(projection.traits) : object(physicalProfile.traits),
    note: clean(projection.notes || physicalProfile.note),
    notes: clean(projection.notes || physicalProfile.notes),
    stage: clean(projection.lifecycleStage || physicalProfile.stage),
    lifecycleStage: clean(projection.lifecycleStage || physicalProfile.lifecycleStage),
    next: clean(projection.nextAction || physicalProfile.next),
    nextAction: clean(projection.nextAction || physicalProfile.nextAction),
    reviewStatus: clean(projection.reviewStatus || physicalProfile.reviewStatus),
    version: Number(projection.profileVersion || physicalProfile.version || 1),
    updated: clean(projection.updatedAt || physicalProfile.updated),
    updatedAt: clean(projection.updatedAt || physicalProfile.updatedAt),
    linkedContactProfiles: array(projection.profiles)
  };
}

function personInsightsView(personContext, physicalInsights = {}) {
  if (!personContext?.found) return physicalInsights;
  const current = object(personContext.relationship?.current || physicalInsights);
  return {
    ...physicalInsights,
    ...current,
    authority: 'PersonContextAuthority',
    personId: personContext.personId,
    sourceContactIds: personContext.contactIds,
    items: array(personContext.relationship?.insights),
    relationshipSignalCount: array(personContext.relationship?.signals).length,
    relationshipTimelineCount: array(personContext.timeline).length
  };
}

const INVALID_PROFILE_TEXT = new Set(['undefined', 'null', 'nan', 'none', '[object object]', '-', '--']);
const INTERNAL_PROFILE_FACT_KEYS = new Set([
  'profilecompleteness', 'profile_completeness', 'whatsappaccountid', 'whatsapp_account_id',
  'accountid', 'account_id', 'chatjid', 'chat_jid', 'jid', 'lid', 'contactid', 'contact_id',
  'externalid', 'external_id', 'sessionkey', 'session_key', 'conversationid', 'conversation_id',
  'name', 'displayname', 'display_name', 'stableidentity', 'stable_identity', 'platformidentity',
  'platform_identity', 'psid', 'page_scoped_user_id', 'internalid', 'internal_id'
]);
const PROFILE_FACT_LABELS = Object.freeze({
  age: '年龄', birthday: '生日', address: '地址', city: '城市', region: '地区', country: '国家/地区',
  job: '职业', occupation: '职业', languages: '语言', family: '家庭情况', stage: '关系阶段',
  interests: '兴趣', note: '长期备注', company: '公司', timezone: '时区'
});
const PROFILE_FACT_LABEL_KEYS = Object.freeze({
  年龄: 'age', 生日: 'birthday', 地址: 'address', 城市: 'city', 地区: 'region', 国家: 'country', 国家地区: 'country',
  职业: 'job', 工作: 'job', 语言: 'languages', 家庭情况: 'family', 关系阶段: 'stage', 兴趣: 'interests', 爱好: 'interests',
  长期备注: 'note', 备注: 'note', 公司: 'company', 时区: 'timezone'
});
function normalizeProfileFactKey(value) {
  return clean(value).toLowerCase().replace(/[\s.-]+/g, '_').replace(/[^a-z0-9_\u4e00-\u9fff]/g, '');
}
function profileScalar(value) {
  if (Array.isArray(value)) {
    const rows = value.map(profileScalar).filter(Boolean);
    return rows.join('、');
  }
  if (value == null || typeof value === 'object') return '';
  const text = clean(value);
  if (!text || INVALID_PROFILE_TEXT.has(text.toLowerCase())) return '';
  return text;
}
function publicProfileFactKey(value) {
  const key = normalizeProfileFactKey(value);
  return key && !INTERNAL_PROFILE_FACT_KEYS.has(key) ? key : '';
}
function internalProfileText(value) {
  const text = profileScalar(value);
  if (!text) return true;
  const match = text.match(/^([^:：=]+)[:：=]/);
  return Boolean(match && INTERNAL_PROFILE_FACT_KEYS.has(normalizeProfileFactKey(match[1])));
}
function profileFactLabel(key, fallback = '') {
  const normalized = normalizeProfileFactKey(key);
  return PROFILE_FACT_LABELS[normalized] || profileScalar(fallback) || normalized.replace(/_/g, ' ');
}
function sanitizeProfileFacts(value) {
  const result = {};
  for (const [rawKey, rawValue] of Object.entries(object(value))) {
    const key = publicProfileFactKey(rawKey);
    const factValue = profileScalar(rawValue);
    if (key && factValue) result[key] = factValue;
  }
  return result;
}
function sanitizeFactList(value, fallbackStatus = 'confirmed') {
  const rows = [];
  for (const raw of array(value)) {
    if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
      const text = profileScalar(raw);
      if (text && !internalProfileText(text)) rows.push({ key: '', title: '已确认事实', text, source: '客户档案', status: fallbackStatus });
      continue;
    }
    if (!raw || typeof raw !== 'object') continue;
    const rawKey = raw.key ?? raw.factKey ?? raw.fact_key ?? raw.field ?? raw.fieldKey ?? raw.field_key;
    const labelKey = PROFILE_FACT_LABEL_KEYS[normalizeProfileFactKey(raw.title ?? raw.label)] || '';
    const key = publicProfileFactKey(rawKey || labelKey);
    if (rawKey && !key) continue;
    const valueText = profileScalar(raw.value ?? raw.factValue ?? raw.fact_value ?? raw.fieldValue ?? raw.field_value);
    let text = profileScalar(raw.text ?? raw.fact ?? raw.content ?? raw.summary);
    if (text && internalProfileText(text)) continue;
    if (!text && key && valueText) text = `${profileFactLabel(key, raw.label ?? raw.title)}：${valueText}`;
    if (!text) continue;
    const title = profileFactLabel(key, raw.title ?? raw.label) || '客户事实';
    rows.push({
      ...raw,
      key,
      title,
      label: title,
      text,
      value: valueText || text,
      source: profileScalar(raw.source) || '客户档案',
      status: profileScalar(raw.status) || fallbackStatus,
      confidence: clamp(raw.confidence, 0, 100, fallbackStatus === 'confirmed' ? 100 : 0)
    });
  }
  return rows;
}

function parseRowJson(row, key, fallback) {
  return parseJson(row?.[key], fallback) ?? fallback;
}

function normalizedIdentityDigits(value) {
  return clean(value).replace(/\D/gu, '');
}

function publicContactPhone(row = {}, payload = {}) {
  const platform = clean(row.platform || payload.platform).toLowerCase();
  const candidate = clean(row.phone || payload.verifiedPhone || payload.phoneNumber || payload.phone);
  if (!candidate) return '';
  const externalId = clean(row.external_id || payload.externalId || payload.platformContactIdentity);
  const sameAsPlatformIdentity = Boolean(
    normalizedIdentityDigits(candidate) && normalizedIdentityDigits(externalId) &&
    normalizedIdentityDigits(candidate) === normalizedIdentityDigits(externalId)
  );
  if (platform === 'whatsapp') return candidate;
  if (sameAsPlatformIdentity) return '';
  if (payload.phoneVerified === true || payload.verifiedPhone || clean(payload.phoneSource)) return candidate;
  return /^\+[0-9][0-9 ()-]{5,}$/u.test(candidate) ? candidate : '';
}

function resolveMergedConversationKey(sessionKey, store = getStore()) {
  const key = clean(sessionKey);
  if (!key) return '';
  const hasAudit = store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='identity_merge_audit'").get();
  if (!hasAudit) return key;
  const row = store.db.prepare(`
    SELECT target_id FROM identity_merge_audit
    WHERE platform='whatsapp' AND entity_type='conversation' AND source_id=?
    ORDER BY created_at DESC LIMIT 1
  `).get(key);
  return clean(row?.target_id) || key;
}

function getConversationRow(sessionKey, store = getStore()) {
  const resolvedKey = resolveMergedConversationKey(sessionKey, store);
  return store.db.prepare(`
    SELECT conv.*, c.display_name AS contact_display_name, c.external_id AS contact_external_id,
           c.phone AS contact_phone, c.avatar_url AS contact_avatar_url, c.avatar_updated_at AS contact_avatar_updated_at,
           c.avatar_status AS contact_avatar_status, c.payload_json AS contact_payload_json
    FROM r32_conversations conv
    LEFT JOIN contacts c ON c.id = conv.contact_id
    WHERE conv.session_key=?
  `).get(resolvedKey) || null;
}

function contactView(row) {
  if (!row) return null;
  const payload = parseRowJson(row, 'payload_json', {});
  const avatarUrl = clean(first(row.avatar_url, payload.avatarUrl, payload.avatar_url, payload.avatar, payload.photo_url));
  const phone = publicContactPhone(row, payload);
  return {
    id: row.id,
    contactId: row.id,
    platform: row.platform,
    accountId: row.account_id,
    externalId: row.external_id,
    displayName: row.display_name,
    name: row.display_name,
    phone,
    platformIdentity: clean(row.external_id),
    rawPhoneStored: clean(row.phone),
    avatarUrl,
    avatar_url: avatarUrl,
    avatar: avatarUrl,
    photo_url: avatarUrl,
    avatarUpdatedAt: row.avatar_updated_at || payload.avatarUpdatedAt || payload.avatar_updated_at || '',
    avatar_updated_at: row.avatar_updated_at || payload.avatar_updated_at || payload.avatarUpdatedAt || '',
    avatarStatus: row.avatar_status || payload.avatarStatus || payload.avatar_status || '',
    avatar_status: row.avatar_status || payload.avatar_status || payload.avatarStatus || '',
    tags: parseRowJson(row, 'tags_json', []),
    aliases: parseRowJson(row, 'aliases_json', []),
    source: row.source,
    lastSeenAt: row.last_seen_at,
    archived: Boolean(row.archived_at),
    archivedAt: row.archived_at || '',
    archiveReason: row.archive_reason || '',
    archivedBy: row.archived_by || '',
    payload,
    createdAt: row.created_at,
    canonicalContactId: row.canonical_contact_id || row.id,
    mergedIntoId: row.merged_into_id || '',
    tombstonedAt: row.tombstoned_at || '',
    updatedAt: row.updated_at
  };
}

function profileView(row) {
  if (!row) {
    return {
      exists: false, contactId: '', facts: {}, tags: [], traits: {}, confirmed: [], inferences: [],
      commitments: [], boundaries: [], milestones: [], note: '', health: 0,
      temperature: 0, openness: 0, risk: 0, activity: 0,
      next: '等待真实互动与人工确认后生成建议。', stage: '', updated: ''
    };
  }
  const facts = sanitizeProfileFacts(parseRowJson(row, 'facts_json', {}));
  const traits = parseRowJson(row, 'traits_json', {});
  const confirmed = sanitizeFactList(parseRowJson(row, 'confirmed_facts_json', []), 'confirmed');
  const inferences = sanitizeFactList(parseRowJson(row, 'inferred_facts_json', []), 'pending');
  const tags = parseRowJson(row, 'tags_json', []);
  const payload = parseRowJson(row, 'payload_json', {});
  return {
    exists: true,
    contactId: row.contact_id,
    facts,
    tags,
    traits,
    confirmed,
    inferences,
    commitments: array(payload.commitments),
    boundaries: array(payload.boundaries),
    milestones: array(payload.milestones),
    note: row.notes,
    notes: row.notes,
    stage: row.lifecycle_stage,
    lifecycleStage: row.lifecycle_stage,
    health: clamp(payload.health ?? row.activity_score),
    temperature: clamp(row.intimacy_score),
    intimacyScore: clamp(row.intimacy_score),
    openness: clamp(row.openness_score),
    risk: clamp(row.risk_score),
    activity: clamp(row.activity_score),
    next: row.next_action || '等待真实互动与人工确认后生成建议。',
    nextAction: row.next_action,
    sourceMessageCount: Number(row.source_message_count || 0),
    analyzedThroughMessageId: row.analyzed_through_message_id,
    analyzedThroughAt: row.analyzed_through_at,
    modelId: row.model_id,
    model: row.model_name,
    reviewStatus: row.review_status,
    pendingReview: object(payload.pendingReview),
    chineseUnderstanding: object(payload.chineseUnderstanding),
    translationStatus: clean(payload.translationStatus),
    translationModel: clean(payload.translationModel),
    translatedAt: clean(payload.translatedAt),
    version: Number(row.profile_version || 1),
    updated: row.updated_at,
    updatedAt: row.updated_at,
    payload
  };
}

function insightView(row) {
  if (!row) {
    return {
      contactId: '', summary: '', stage: '待分析', relationshipStage: '待分析', tone: '',
      intimacy: 0, intimacyScore: 0, initiative: 0, openness: 0, responsePressure: 0,
      opportunity: 0, risk: 0, hiddenNeed: '', next: '等待真实分析。', nextAction: '',
      evidence: [], openLoops: [], dimensions: {}, updated: '', updatedAt: ''
    };
  }
  const evidence = parseRowJson(row, 'evidence_json', []);
  const openLoops = parseRowJson(row, 'open_loops_json', []);
  const dimensions = parseRowJson(row, 'dimensions_json', {});
  const payload = parseRowJson(row, 'payload_json', {});
  return {
    contactId: row.contact_id,
    conversationId: row.conversation_id,
    summary: row.summary,
    stage: row.relationship_stage || '待分析',
    relationshipStage: row.relationship_stage || '待分析',
    tone: row.tone,
    intimacy: clamp(row.intimacy_score),
    intimacyScore: clamp(row.intimacy_score),
    initiative: clamp(row.initiative_score),
    initiativeScore: clamp(row.initiative_score),
    openness: clamp(row.openness_score),
    responsePressure: clamp(row.response_pressure_score),
    opportunity: clamp(row.opportunity_score),
    opportunityScore: clamp(row.opportunity_score),
    risk: clamp(row.risk_score),
    riskScore: clamp(row.risk_score),
    hiddenNeed: row.hidden_need,
    next: row.next_action || '等待真实分析。',
    nextAction: row.next_action,
    evidence,
    openLoops,
    dimensions,
    sourceMessageCount: Number(row.source_message_count || 0),
    analyzedThroughMessageId: row.analyzed_through_message_id,
    analyzedThroughAt: row.analyzed_through_at,
    modelId: row.model_id,
    model: row.model_name,
    status: row.status,
    events: array(payload.events),
    points: array(payload.points),
    topics: array(payload.topics),
    reply: clean(payload.reply),
    momentum: clean(payload.momentum),
    depth: clamp(payload.depth),
    opportunityText: clean(payload.opportunityText),
    riskText: clean(payload.riskText),
    chineseUnderstanding: object(payload.chineseUnderstanding),
    sourceScope: object(payload.sourceScope),
    translationStatus: clean(payload.translationStatus),
    translationModel: clean(payload.translationModel),
    translatedAt: clean(payload.translatedAt),
    updated: row.updated_at,
    updatedAt: row.updated_at,
    payload
  };
}

function resolveCanonicalContactId(contactId, store = getStore()) {
  const requestedId = clean(contactId);
  if (!requestedId) return '';
  let row = store.db.prepare('SELECT id, merged_into_id, tombstoned_at FROM contacts WHERE id=?').get(requestedId);
  const visited = new Set();
  while (row?.merged_into_id && !visited.has(row.id)) {
    visited.add(row.id);
    row = store.db.prepare('SELECT id, merged_into_id, tombstoned_at FROM contacts WHERE id=?').get(clean(row.merged_into_id));
  }
  if (!row || (row.tombstoned_at && !row.merged_into_id)) return '';
  return clean(row.id);
}

// Physical contact identity and customer-profile identity are deliberately separate.
// Physical merges follow merged_into_id. When an active Person exists, its
// profile_contact_id is the single cross-platform profile and relationship anchor.
function resolvePersonProfileContext(contactId, store = getStore()) {
  const physicalId = resolveCanonicalContactId(contactId, store);
  if (!physicalId) return { physicalId: '', personId: '', profileContactId: '', contactIds: [] };
  const binding = store.db.prepare(`
    SELECT pcb.person_id, p.profile_contact_id
    FROM person_contact_bindings pcb
    JOIN persons p ON p.person_id=pcb.person_id
    WHERE pcb.contact_id=? AND pcb.state='active' AND p.state='active'
    ORDER BY pcb.updated_at DESC
    LIMIT 1
  `).get(physicalId);
  if (!binding) return { physicalId, personId: '', profileContactId: '', contactIds: [physicalId] };
  const contactIds = store.db.prepare("SELECT contact_id FROM person_contact_bindings WHERE person_id=? AND state='active' ORDER BY updated_at DESC")
    .all(clean(binding.person_id)).map(row => clean(row.contact_id)).filter(Boolean);
  const requestedAnchor = clean(binding.profile_contact_id) || contactIds[0] || physicalId;
  const profileContactId = resolveCanonicalContactId(requestedAnchor, store) || physicalId;
  return { physicalId, personId: clean(binding.person_id), profileContactId, contactIds: [...new Set([profileContactId, ...contactIds, physicalId])] };
}

function resolveCustomerProfileId(contactId, store = getStore()) {
  const person = resolvePersonProfileContext(contactId, store);
  if (person.profileContactId) return person.profileContactId;
  const physicalId = person.physicalId;
  if (!physicalId) return '';
  const row = store.db.prepare(`
    SELECT id, canonical_contact_id FROM contacts
    WHERE id=? AND COALESCE(NULLIF(merged_into_id,''), NULLIF(tombstoned_at,'')) IS NULL
  `).get(physicalId);
  if (!row) return '';
  const requestedAnchor = clean(row.canonical_contact_id) || clean(row.id);
  return resolveCanonicalContactId(requestedAnchor, store) || clean(row.id);
}

function getContact(contactId, store = getStore()) {
  const canonicalId = resolveCanonicalContactId(contactId, store);
  if (!canonicalId) return null;
  return contactView(store.db.prepare('SELECT * FROM contacts WHERE id=?').get(canonicalId));
}

function listLinkedIdentities(contactId, store = getStore()) {
  const person = resolvePersonProfileContext(contactId, store);
  if (person.personId && person.contactIds.length) {
    const marks = person.contactIds.map(() => '?').join(',');
    return store.db.prepare(`
      SELECT * FROM contacts
      WHERE COALESCE(NULLIF(merged_into_id,''), NULLIF(tombstoned_at,'')) IS NULL
        AND id IN (${marks})
      ORDER BY platform, account_id, external_id, id
    `).all(...person.contactIds).map(contactView);
  }
  const customerProfileId = resolveCustomerProfileId(contactId, store);
  if (!customerProfileId) return [];
  return store.db.prepare(`
    SELECT * FROM contacts
    WHERE COALESCE(NULLIF(merged_into_id,''), NULLIF(tombstoned_at,'')) IS NULL
      AND (id=? OR canonical_contact_id=?)
    ORDER BY platform, account_id, external_id, id
  `).all(customerProfileId, customerProfileId).map(contactView);
}

function findPersonScopedRow(table, person, anchorId, store = getStore()) {
  let row = store.db.prepare(`SELECT * FROM ${table} WHERE contact_id=?`).get(clean(anchorId));
  if (!row && person.personId) {
    row = store.db.prepare(`
      SELECT * FROM ${table}
      WHERE person_id=? OR contact_id IN (SELECT contact_id FROM person_contact_bindings WHERE person_id=? AND state='active')
      ORDER BY CASE WHEN contact_id=? THEN 0 ELSE 1 END, updated_at DESC
      LIMIT 1
    `).get(person.personId, person.personId, clean(anchorId));
  }
  return row || null;
}

function materializePersonAnchorRow(table, person, anchorId, row, store = getStore()) {
  if (!row || !person.personId || clean(row.contact_id) === clean(anchorId)) return row;
  const columns = store.db.prepare(`PRAGMA table_info(${table})`).all().map(item => item.name);
  const values = columns.map(column => {
    if (column === 'contact_id') return clean(anchorId);
    if (column === 'person_id') return clean(person.personId);
    return row[column];
  });
  store.db.prepare(`INSERT OR IGNORE INTO ${table}(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`).run(...values);
  return store.db.prepare(`SELECT * FROM ${table} WHERE contact_id=?`).get(clean(anchorId)) || row;
}

function getProfile(contactId, store = getStore()) {
  const person = resolvePersonProfileContext(contactId, store);
  const customerProfileId = resolveCustomerProfileId(contactId, store) || clean(contactId);
  return profileView(findPersonScopedRow('customer_profiles', person, customerProfileId, store));
}

function getInsights(contactId, store = getStore()) {
  const person = resolvePersonProfileContext(contactId, store);
  const customerProfileId = person.personId
    ? (person.profileContactId || person.physicalId)
    : (person.physicalId || clean(contactId));
  return insightView(findPersonScopedRow('relationship_insights', person, customerProfileId, store));
}

function listContacts(options = {}, store = getStore()) {
  const limit = Math.min(2000, Math.max(1, Number(options.limit) || 500));
  const search = clean(options.search).toLowerCase();
  const rows = search
    ? store.db.prepare(`
        SELECT * FROM contacts
        WHERE COALESCE(NULLIF(merged_into_id, ''), NULLIF(tombstoned_at, '')) IS NULL
          AND COALESCE(archive_reason, '') <> 'synthetic-mobile-voice-echo'
          AND (lower(display_name) LIKE ? OR lower(phone) LIKE ? OR lower(external_id) LIKE ?)
        ORDER BY COALESCE(NULLIF(last_seen_at, ''), updated_at) DESC
        LIMIT ?
      `).all(`%${search}%`, `%${search}%`, `%${search}%`, limit)
    : store.db.prepare(`
        SELECT * FROM contacts
        WHERE COALESCE(NULLIF(merged_into_id, ''), NULLIF(tombstoned_at, '')) IS NULL
          AND COALESCE(archive_reason, '') <> 'synthetic-mobile-voice-echo'
        ORDER BY COALESCE(NULLIF(last_seen_at, ''), updated_at) DESC
        LIMIT ?
      `).all(limit);
  return rows.map(contactView);
}

function getContactContext(contactId, store = getStore()) {
  const requestedContactId = clean(contactId);
  const contact = resolveContactReference(requestedContactId, store)?.contact || null;
  if (!contact) throw Object.assign(new Error('联系人不存在'), { code: 'CONTACT_NOT_FOUND', status: 404 });
  const physicalContactId = clean(contact.id);
  const customerProfileId = resolveCustomerProfileId(physicalContactId, store) || physicalContactId;
  const personContext = personSnapshot({ contactId: physicalContactId }, store);
  const linkedIdentityMap = new Map(listLinkedIdentities(physicalContactId, store).map(row => [clean(row.id), row]));
  for (const personContactId of array(personContext?.contactIds)) {
    const row = getContact(personContactId, store);
    if (row) linkedIdentityMap.set(clean(row.id), row);
  }
  const linkedIdentities = [...linkedIdentityMap.values()];
  const linkedIds = [...new Set(linkedIdentities.map(row => clean(row.id)).filter(Boolean))];
  const placeholders = linkedIds.map(() => '?').join(',');
  const conversations = linkedIds.length ? store.db.prepare(`
    SELECT conv.session_key AS sessionKey, conv.contact_id AS contactId,
           conv.account_id AS accountId, conv.account_id AS sourceAccountId,
           conv.platform, conv.title, c.external_id AS platformContactIdentity,
           conv.avatar_url AS avatarUrl, conv.avatar_updated_at AS avatarUpdatedAt,
           conv.avatar_status AS avatarStatus, conv.last_message AS lastMessage,
           conv.last_message_at AS lastMessageAt, conv.unread_count AS unreadCount,
           conv.route_state AS routeState, conv.updated_at AS updatedAt
    FROM r32_conversations conv
    LEFT JOIN contacts c ON c.id=conv.contact_id
    WHERE conv.contact_id IN (${placeholders}) AND COALESCE(conv.merged_into,'')=''
    ORDER BY COALESCE(NULLIF(conv.last_message_at, ''), conv.updated_at) DESC
  `).all(...linkedIds).map(row => ({
    ...row,
    conversationId: row.sessionKey,
    canonicalContactId: customerProfileId,
    routeScope: {
      platform: clean(row.platform),
      sourceAccountId: clean(row.sourceAccountId),
      platformContactIdentity: clean(row.platformContactIdentity),
      conversationId: clean(row.sessionKey),
      canonicalContactId: customerProfileId
    }
  })) : [];
  const physicalProfile = getProfile(physicalContactId, store);
  const physicalInsights = getInsights(physicalContactId, store);
  return {
    ok: true,
    generatedAt: nowIso(),
    requestedContactId,
    physicalContactId,
    canonicalContactId: customerProfileId,
    customerProfileId,
    redirected: Boolean(requestedContactId && requestedContactId !== physicalContactId),
    associated: linkedIdentities.length > 1,
    contact,
    linkedIdentities,
    person: personContext?.found ? { personId: personContext.personId, contactIds: personContext.contactIds, conversationIds: personContext.conversationIds, identityLinks: personContext.identityLinks } : null,
    personContext,
    profile: personProfileView(personContext, physicalProfile),
    insights: personInsightsView(personContext, physicalInsights),
    conversations,
    source: { persons: 'persons/person_contact_bindings/conversation_bindings', contacts: 'contacts', profiles: 'customer_profiles', insights: 'relationship_insights' }
  };
}

function resolveContactReference(reference, store = getStore()) {
  const key = clean(reference);
  if (!key) return null;

  const direct = getContact(key, store);
  if (direct) return { contact: direct, conversation: null, matchedBy: 'contact-id' };

  const mergedConversation = getConversationRow(key, store);
  if (mergedConversation?.session_key && mergedConversation.contact_id) {
    const mergedContact = getContact(mergedConversation.contact_id, store);
    if (mergedContact) {
      return {
        conversation: mergedConversation,
        contact: mergedContact,
        matchedBy: mergedConversation.session_key === key ? 'conversation-id' : 'merged-conversation-id',
        requestedConversationId: key
      };
    }
  }

  const contactRows = store.db.prepare(`
    SELECT id, platform, account_id, external_id FROM contacts
    WHERE COALESCE(NULLIF(merged_into_id, ''), NULLIF(tombstoned_at, '')) IS NULL
      AND (external_id=? OR phone=? OR json_extract(payload_json, '$.externalId')=?
        OR json_extract(payload_json, '$.chatJid')=? OR json_extract(payload_json, '$.jid')=?)
    ORDER BY COALESCE(NULLIF(last_seen_at, ''), updated_at) DESC
    LIMIT 20
  `).all(key, key, key, key, key);
  if (contactRows.length > 1) {
    throw Object.assign(new Error('该号码或平台身份匹配多个账号，请从具体会话进入，不能自动选择发送路由'), {
      code: 'CONTACT_REFERENCE_AMBIGUOUS',
      status: 409,
      details: { reference: key, matches: contactRows.map(row => ({ id: row.id, platform: row.platform, accountId: row.account_id, externalId: row.external_id })) }
    });
  }
  if (contactRows[0]?.id) {
    const contact = getContact(contactRows[0].id, store);
    if (contact) return { contact, conversation: null, matchedBy: 'contact-alias' };
  }

  const conversationRows = store.db.prepare(`
    SELECT session_key, contact_id, account_id, platform FROM r32_conversations
    WHERE COALESCE(merged_into,'')='' AND (session_key=? OR contact_id=?
      OR json_extract(payload_json, '$.conversationId')=?
      OR json_extract(payload_json, '$.sessionKey')=?
      OR json_extract(payload_json, '$.chatJid')=?
      OR json_extract(payload_json, '$.externalId')=?)
    ORDER BY COALESCE(NULLIF(last_message_at, ''), updated_at) DESC
    LIMIT 20
  `).all(key, key, key, key, key, key);
  if (conversationRows.length > 1) {
    throw Object.assign(new Error('该会话引用匹配多个平台或账号，请选择明确会话'), {
      code: 'CONVERSATION_REFERENCE_AMBIGUOUS',
      status: 409,
      details: { reference: key, matches: conversationRows.map(row => ({ conversationId: row.session_key, contactId: row.contact_id, platform: row.platform, accountId: row.account_id })) }
    });
  }
  if (!conversationRows[0]?.session_key) return null;
  try {
    return { ...resolveContactForConversation(conversationRows[0].session_key, store), matchedBy: 'conversation-reference' };
  } catch (_) {
    return null;
  }
}

function resolveContactForConversation(sessionKey, store = getStore()) {
  const conversation = getConversationRow(sessionKey, store);
  if (!conversation) throw Object.assign(new Error('会话不存在'), { code: 'CONVERSATION_NOT_FOUND', status: 404 });
  if (conversation.contact_id) {
    const current = getContact(conversation.contact_id, store);
    if (current) return { conversation, contact: current };
  }
  const payload = parseRowJson(conversation, 'payload_json', {});
  const platform = clean(conversation.platform || payload.platform, 'unknown').toLowerCase();
  const accountId = clean(conversation.account_id || payload.accountId);
  const externalId = clean(first(payload.externalId, payload.chatJid, payload.remoteJid, payload.phone, sessionKey));
  const displayName = clean(first(conversation.title, payload.contactName, payload.displayName, payload.name, externalId), '未命名联系人');
  const requestedContactId = stableId('contact', [platform, accountId, externalId || sessionKey]);
  const contactId = store.upsertContact({
    ...payload,
    id: requestedContactId,
    contactId: requestedContactId,
    platform,
    accountId,
    externalId,
    displayName,
    phone: clean(payload.phone),
    avatarUrl: clean(first(conversation.avatar_url, payload.avatarUrl, payload.avatar_url, payload.avatar, payload.photo_url)),
    source: 'conversation-resolution',
    lastSeenAt: clean(conversation.last_message_at || conversation.updated_at)
  });
  store.db.prepare('UPDATE r32_conversations SET contact_id=?, updated_at=? WHERE session_key=?')
    .run(contactId, nowIso(), clean(sessionKey));
  return { conversation: getConversationRow(sessionKey, store), contact: getContact(contactId, store) };
}

function tableExists(store, table) {
  return Boolean(store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(clean(table)));
}

function associateCustomerProfiles(sourceContactId, targetContactId, input = {}, store = getStore()) {
  if (input.matchBy && ['name', 'avatar', 'displayname', 'photo'].includes(clean(input.matchBy).toLowerCase())) {
    throw Object.assign(new Error('禁止使用姓名或头像作为客户身份关联依据'), { code: 'UNSAFE_CUSTOMER_ASSOCIATION_EVIDENCE', status: 400 });
  }
  const source = resolveContactReference(sourceContactId, store)?.contact || null;
  const target = resolveContactReference(targetContactId, store)?.contact || null;
  if (!source || !target) throw Object.assign(new Error('待关联联系人不存在'), { code: 'CONTACT_NOT_FOUND', status: 404 });
  const sourceAnchor = resolveCustomerProfileId(source.id, store) || source.id;
  const targetAnchor = resolveCustomerProfileId(target.id, store) || target.id;
  if (sourceAnchor === targetAnchor) {
    return { ok: true, changed: false, idempotent: true, sourceContactId: source.id, targetContactId: target.id, customerProfileId: targetAnchor, linkedIdentities: listLinkedIdentities(targetAnchor, store) };
  }
  const sourceProfile = store.db.prepare('SELECT contact_id FROM customer_profiles WHERE contact_id=?').get(sourceAnchor);
  const targetProfile = store.db.prepare('SELECT contact_id FROM customer_profiles WHERE contact_id=?').get(targetAnchor);
  if (sourceProfile && targetProfile) {
    throw Object.assign(new Error('两个客户档案都包含独立资料，请先人工决定保留哪一份，系统不会自动覆盖'), {
      code: 'CUSTOMER_PROFILE_ASSOCIATION_CONFLICT', status: 409,
      details: { sourceCustomerProfileId: sourceAnchor, targetCustomerProfileId: targetAnchor }
    });
  }
  if (tableExists(store, 'persona_brain_scope_bindings')) {
    const sourcePersona = store.db.prepare("SELECT profile_id FROM persona_brain_scope_bindings WHERE scope_type='contact' AND scope_id=? AND state='active'").get(sourceAnchor);
    const targetPersona = store.db.prepare("SELECT profile_id FROM persona_brain_scope_bindings WHERE scope_type='contact' AND scope_id=? AND state='active'").get(targetAnchor);
    if (sourcePersona && targetPersona && clean(sourcePersona.profile_id) !== clean(targetPersona.profile_id)) {
      throw Object.assign(new Error('两个客户身份绑定了不同 Persona，请先人工处理 Persona 冲突'), {
        code: 'CUSTOMER_PERSONA_ASSOCIATION_CONFLICT', status: 409,
        details: { sourceProfileId: sourcePersona.profile_id, targetProfileId: targetPersona.profile_id }
      });
    }
  }
  const timestamp = nowIso();
  let movedIdentities = 0;
  store.transaction(() => {
    if (sourceProfile && !targetProfile) {
      store.db.prepare('UPDATE customer_profiles SET contact_id=?, updated_at=? WHERE contact_id=?').run(targetAnchor, timestamp, sourceAnchor);
    }
    if (tableExists(store, 'persona_brain_scope_bindings')) {
      const sourcePersona = store.db.prepare("SELECT * FROM persona_brain_scope_bindings WHERE scope_type='contact' AND scope_id=?").get(sourceAnchor);
      const targetPersona = store.db.prepare("SELECT * FROM persona_brain_scope_bindings WHERE scope_type='contact' AND scope_id=?").get(targetAnchor);
      if (sourcePersona && !targetPersona) {
        store.db.prepare("UPDATE persona_brain_scope_bindings SET scope_id=?, updated_at=? WHERE scope_type='contact' AND scope_id=?").run(targetAnchor, timestamp, sourceAnchor);
      } else if (sourcePersona && targetPersona) {
        store.db.prepare("DELETE FROM persona_brain_scope_bindings WHERE scope_type='contact' AND scope_id=?").run(sourceAnchor);
      }
    }
    const result = store.db.prepare(`
      UPDATE contacts SET canonical_contact_id=?, updated_at=?
      WHERE COALESCE(NULLIF(merged_into_id,''), NULLIF(tombstoned_at,'')) IS NULL
        AND (id=? OR canonical_contact_id=?)
    `).run(targetAnchor, timestamp, sourceAnchor, sourceAnchor);
    movedIdentities = Number(result.changes || 0);
  });
  const result = {
    ok: true,
    changed: true,
    sourceContactId: source.id,
    targetContactId: target.id,
    previousCustomerProfileId: sourceAnchor,
    customerProfileId: targetAnchor,
    movedIdentities,
    linkedIdentities: listLinkedIdentities(targetAnchor, store),
    routingPreserved: true,
    associatedBy: clean(input.by) || 'user',
    note: clean(input.note),
    updatedAt: timestamp
  };
  eventBus.publish('workspace:customer-profile-associated', result);
  return result;
}

function separateCustomerProfile(contactId, input = {}, store = getStore()) {
  const contact = resolveContactReference(contactId, store)?.contact || null;
  if (!contact) throw Object.assign(new Error('联系人不存在'), { code: 'CONTACT_NOT_FOUND', status: 404 });
  const currentAnchor = resolveCustomerProfileId(contact.id, store) || contact.id;
  if (currentAnchor === contact.id) return { ok: true, changed: false, idempotent: true, contactId: contact.id, customerProfileId: contact.id };
  const timestamp = nowIso();
  store.transaction(() => {
    const existing = store.db.prepare('SELECT contact_id FROM customer_profiles WHERE contact_id=?').get(contact.id);
    const shared = store.db.prepare('SELECT * FROM customer_profiles WHERE contact_id=?').get(currentAnchor);
    if (!existing && shared && input.copyProfile !== false) {
      const columns = store.db.prepare('PRAGMA table_info(customer_profiles)').all().map(row => row.name);
      const values = columns.map(column => column === 'contact_id' ? contact.id : column === 'created_at' || column === 'updated_at' ? timestamp : shared[column]);
      store.db.prepare(`INSERT INTO customer_profiles(${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...values);
    }
    if (tableExists(store, 'persona_brain_scope_bindings')) {
      const currentBinding = store.db.prepare("SELECT 1 FROM persona_brain_scope_bindings WHERE scope_type='contact' AND scope_id=?").get(contact.id);
      const sharedBinding = store.db.prepare("SELECT * FROM persona_brain_scope_bindings WHERE scope_type='contact' AND scope_id=?").get(currentAnchor);
      if (!currentBinding && sharedBinding) {
        store.db.prepare(`
          INSERT INTO persona_brain_scope_bindings(
            scope_type, scope_id, profile_id, binding_version, authoritative_patch_json,
            style_overlay_json, state, temporary, expires_at, created_at, updated_at
          ) VALUES ('contact', ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
        `).run(contact.id, sharedBinding.profile_id, sharedBinding.authoritative_patch_json, sharedBinding.style_overlay_json,
          sharedBinding.state, sharedBinding.temporary, sharedBinding.expires_at, timestamp, timestamp);
      }
    }
    store.db.prepare('UPDATE contacts SET canonical_contact_id=?, updated_at=? WHERE id=?').run(contact.id, timestamp, contact.id);
  });
  const result = { ok: true, changed: true, contactId: contact.id, previousCustomerProfileId: currentAnchor, customerProfileId: contact.id, routingPreserved: true, separatedBy: clean(input.by) || 'user', updatedAt: timestamp };
  eventBus.publish('workspace:customer-profile-separated', result);
  return result;
}

function setConversationArchived(sessionKey, input = {}, store = getStore()) {
  const archived = input.archived !== false;
  const reason = archived ? clean(input.reason || input.archiveReason, '不符合当前客户标准') : '';
  const archivedBy = archived ? clean(input.archivedBy || input.by, 'user') : '';
  const archivedAt = archived ? nowIso() : '';
  let result = null;
  store.transaction(() => {
    const resolved = resolveContactForConversation(sessionKey, store);
    const contactId = resolved.contact?.id || clean(resolved.conversation?.contact_id);
    const updatedAt = nowIso();
    if (contactId) {
      store.db.prepare(`
        UPDATE contacts
        SET archived_at=?, archive_reason=?, archived_by=?, updated_at=?
        WHERE id=?
      `).run(archivedAt, reason, archivedBy, updatedAt, contactId);
      store.db.prepare(`
        UPDATE r32_conversations
        SET archived_at=?, archive_reason=?, archived_by=?, updated_at=?
        WHERE contact_id=? OR session_key=?
      `).run(archivedAt, reason, archivedBy, updatedAt, contactId, clean(sessionKey));
    } else {
      store.db.prepare(`
        UPDATE r32_conversations
        SET archived_at=?, archive_reason=?, archived_by=?, updated_at=?
        WHERE session_key=?
      `).run(archivedAt, reason, archivedBy, updatedAt, clean(sessionKey));
    }
    const conversation = getConversationRow(sessionKey, store);
    result = {
      ok: true,
      sessionKey: clean(sessionKey),
      contactId,
      archived,
      archivedAt,
      archiveReason: reason,
      archivedBy,
      conversation: conversation ? {
        sessionKey: conversation.session_key,
        contactId: conversation.contact_id,
        archived: Boolean(conversation.archived_at),
        archivedAt: conversation.archived_at || '',
        archiveReason: conversation.archive_reason || ''
      } : null
    };
  });
  eventBus.publish(archived ? 'workspace:customer-archived' : 'workspace:customer-restored', result);
  return result;
}


function setConversationPinned(sessionKey, input = {}, store = getStore()) {
  const key = clean(sessionKey);
  const pinned = input.pinned !== false;
  const pinnedAt = pinned ? nowIso() : '';
  const pinnedBy = pinned ? clean(input.pinnedBy || input.by, 'user') : '';
  const row = getConversationRow(key, store);
  if (!row) throw Object.assign(new Error('会话不存在'), { code: 'CONVERSATION_NOT_FOUND', status: 404 });
  const payload = parseRowJson(row, 'payload_json', {}) || {};
  const nextPayload = { ...payload, pinned, pinnedAt, pinnedBy };
  const updatedAt = nowIso();
  store.db.prepare(`
    UPDATE r32_conversations
    SET payload_json=?, updated_at=?
    WHERE session_key=?
  `).run(JSON.stringify(nextPayload), updatedAt, key);
  const result = {
    ok: true,
    sessionKey: key,
    accountId: clean(row.account_id),
    contactId: clean(row.contact_id),
    pinned,
    pinnedAt,
    pinnedBy,
    updatedAt
  };
  eventBus.publish(pinned ? 'workspace:conversation-pinned' : 'workspace:conversation-unpinned', result);
  return result;
}

function latestMessages(sessionKey, limit = 200, store = getStore()) {
  const rows = store.db.prepare(`
    SELECT * FROM (
      SELECT id, session_key, account_id, sender_id, role, direction, message_type,
             text, media_url, media_path, quoted_message_id, delivery_status,
             sent_at, payload_json, created_at, updated_at
      FROM r32_messages
      WHERE session_key=?
      ORDER BY COALESCE(NULLIF(sent_at, ''), created_at) DESC
      LIMIT ?
    ) recent
    ORDER BY COALESCE(NULLIF(sent_at, ''), created_at) ASC
  `).all(clean(sessionKey), Math.min(1000, Math.max(1, Number(limit) || 200)));
  return rows.map(row => {
    const payload = parseRowJson(row, 'payload_json', {});
    const sourceText = clean(row.text || payload.sourceText || payload.transcript || payload.translation || (row.message_type ? `[${row.message_type}]` : ''));
    const translatedZh = clean(payload.translatedZh || payload.translationZh || payload.chineseTranslation || payload.lastSuccessfulTranslatedZh);
    const identity = messageSpeakerAuthority.classify({
      ...payload,
      role: row.role || payload.role,
      direction: row.direction || payload.direction,
      type: row.message_type || payload.type,
      messageType: row.message_type || payload.messageType
    });
    return {
      id: row.id,
      platformMessageId: clean(payload.platformMessageId || payload.externalMessageId || payload.messageId || row.id),
      accountId: row.account_id,
      sourceAccountId: clean(payload.sourceAccountId || payload.accountId || row.account_id),
      platform: clean(payload.platform),
      sessionKey: row.session_key,
      conversationId: row.session_key,
      role: identity.role,
      speaker: identity.speaker,
      direction: identity.direction,
      fromMe: identity.speaker === 'self',
      type: row.message_type,
      text: sourceText,
      sourceText,
      translatedZh,
      translationStatus: translatedZh ? 'success' : clean(payload.translationStatus),
      translationModel: clean(payload.translationModel || payload.lastSuccessfulTranslationModel),
      sentAt: row.sent_at || row.created_at,
      senderId: row.sender_id,
      deliveryStatus: row.delivery_status,
      revoked: payload.revoked === true || identity.type === 'revoke',
      payload
    };
  });
}

function buildPendingProfileProposal(input = {}) {
  const profile = object(input.profile);
  return {
    facts: sanitizeProfileFacts({ ...object(input.facts), ...object(profile.facts) }),
    tags: array(input.tags).length ? array(input.tags) : array(profile.tags),
    traits: { ...object(input.traits), ...object(profile.traits) },
    confirmedFacts: sanitizeFactList(array(input.confirmedFacts).length ? input.confirmedFacts : array(input.confirmed).length ? input.confirmed : array(profile.confirmed), 'confirmed'),
    inferredFacts: sanitizeFactList(array(input.inferredFacts).length ? input.inferredFacts : array(input.inferences).length ? input.inferences : array(profile.inferences), 'pending'),
    note: clean(input.note ?? input.notes ?? profile.note),
    lifecycleStage: clean(input.lifecycleStage ?? input.stage ?? profile.lifecycleStage ?? profile.stage),
    intimacyScore: clamp(input.intimacyScore ?? input.temperature ?? profile.intimacyScore ?? profile.temperature),
    opennessScore: clamp(input.opennessScore ?? input.openness ?? profile.opennessScore ?? profile.openness),
    activityScore: clamp(input.activityScore ?? input.activity ?? profile.activityScore ?? profile.activity),
    riskScore: clamp(input.riskScore ?? input.risk ?? profile.riskScore ?? profile.risk),
    nextAction: clean(input.nextAction ?? input.next ?? profile.nextAction ?? profile.next),
    payload: object(input.payload)
  };
}

function upsertProfile(contactId, input = {}, metadata = {}, store = getStore()) {
  const sourceContactId = resolveCanonicalContactId(contactId, store) || clean(contactId);
  const person = resolvePersonProfileContext(sourceContactId, store);
  contactId = resolveCustomerProfileId(sourceContactId, store) || sourceContactId;
  let currentRow = findPersonScopedRow('customer_profiles', person, contactId, store);
  currentRow = materializePersonAnchorRow('customer_profiles', person, contactId, currentRow, store);
  const current = profileView(currentRow);
  const requestedReviewStatus = clean(metadata.reviewStatus ?? input.reviewStatus ?? current.reviewStatus ?? 'manual');
  if (requestedReviewStatus === 'ai-pending-review') {
    const timestamp = nowIso();
    const previousPending = object(current.pendingReview);
    const previousReviewStatus = clean(
      current.reviewStatus && current.reviewStatus !== 'ai-pending-review'
        ? current.reviewStatus
        : previousPending.previousReviewStatus
    ) || 'manual';
    const previousMetadata = current.reviewStatus === 'ai-pending-review' && object(previousPending.previousMetadata)
      ? object(previousPending.previousMetadata)
      : {
          sourceMessageCount: Number(current.sourceMessageCount || 0),
          analyzedThroughMessageId: clean(current.analyzedThroughMessageId),
          analyzedThroughAt: clean(current.analyzedThroughAt),
          modelId: clean(current.modelId),
          modelName: clean(current.model)
        };
    const pendingReview = {
      profile: buildPendingProfileProposal(input),
      previousReviewStatus,
      previousMetadata,
      sourceMessageCount: Number(metadata.sourceMessageCount ?? input.sourceMessageCount ?? 0),
      analyzedThroughMessageId: clean(metadata.analyzedThroughMessageId ?? input.analyzedThroughMessageId),
      analyzedThroughAt: clean(metadata.analyzedThroughAt ?? input.analyzedThroughAt),
      modelId: clean(metadata.modelId ?? input.modelId),
      modelName: clean(metadata.modelName ?? input.model),
      previousChineseUnderstanding: object(current.payload?.chineseUnderstanding),
      previousTranslationStatus: clean(current.payload?.translationStatus),
      previousTranslationModel: clean(current.payload?.translationModel),
      previousTranslatedAt: clean(current.payload?.translatedAt),
      createdAt: timestamp
    };
    const proposalPayload = object(pendingReview.profile?.payload);
    const payload = {
      ...object(current.payload),
      pendingReview,
      chineseUnderstanding: object(proposalPayload.chineseUnderstanding),
      translationStatus: clean(proposalPayload.translationStatus),
      translationModel: clean(proposalPayload.translationModel),
      translatedAt: clean(proposalPayload.translatedAt)
    };
    const version = Math.max(1, Number(currentRow?.profile_version || 0) + 1);
    if (currentRow) {
      store.db.prepare(`
        UPDATE customer_profiles SET
          source_message_count=?, analyzed_through_message_id=?, analyzed_through_at=?,
          model_id=?, model_name=?, review_status='ai-pending-review',
          profile_version=?, payload_json=?, updated_at=?
        WHERE contact_id=?
      `).run(
        pendingReview.sourceMessageCount, pendingReview.analyzedThroughMessageId, pendingReview.analyzedThroughAt,
        pendingReview.modelId, pendingReview.modelName, version, json(payload), timestamp, clean(contactId)
      );
    } else {
      store.db.prepare(`
        INSERT INTO customer_profiles(
          contact_id, source_message_count, analyzed_through_message_id, analyzed_through_at,
          model_id, model_name, review_status, profile_version, payload_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'ai-pending-review', ?, ?, ?, ?)
      `).run(
        clean(contactId), pendingReview.sourceMessageCount, pendingReview.analyzedThroughMessageId,
        pendingReview.analyzedThroughAt, pendingReview.modelId, pendingReview.modelName,
        version, json(payload), timestamp, timestamp
      );
    }
    return getProfile(contactId, store);
  }
  const profile = object(input.profile);
  const facts = sanitizeProfileFacts({ ...object(current.facts), ...object(input.facts), ...object(profile.facts) });
  const tags = array(input.tags).length ? array(input.tags) : array(profile.tags).length ? array(profile.tags) : array(current.tags);
  const traits = { ...object(current.traits), ...object(input.traits), ...object(profile.traits) };
  const confirmed = sanitizeFactList(array(input.confirmedFacts).length ? input.confirmedFacts : array(input.confirmed).length ? input.confirmed : array(profile.confirmed).length ? profile.confirmed : current.confirmed, 'confirmed');
  const inferences = sanitizeFactList(array(input.inferredFacts).length ? input.inferredFacts : array(input.inferences).length ? input.inferences : array(profile.inferences).length ? profile.inferences : current.inferences, 'pending');
  const payload = {
    ...object(current.payload),
    ...object(input.payload),
    commitments: array(input.commitments).length ? input.commitments : array(profile.commitments).length ? profile.commitments : current.commitments,
    boundaries: array(input.boundaries).length ? input.boundaries : array(profile.boundaries).length ? profile.boundaries : current.boundaries,
    milestones: array(input.milestones).length ? input.milestones : array(profile.milestones).length ? profile.milestones : current.milestones,
    health: clamp(input.health ?? profile.health ?? current.health)
  };
  if (metadata.clearPendingReview === true) delete payload.pendingReview;
  const timestamp = nowIso();
  const version = Math.max(1, Number(currentRow?.profile_version || 0) + 1);
  store.db.prepare(`
    INSERT INTO customer_profiles(
      contact_id, facts_json, tags_json, traits_json, confirmed_facts_json, inferred_facts_json,
      notes, lifecycle_stage, intimacy_score, openness_score, activity_score, risk_score,
      next_action, source_message_count, analyzed_through_message_id, analyzed_through_at,
      model_id, model_name, review_status, profile_version, payload_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(contact_id) DO UPDATE SET
      facts_json=excluded.facts_json, tags_json=excluded.tags_json, traits_json=excluded.traits_json,
      confirmed_facts_json=excluded.confirmed_facts_json, inferred_facts_json=excluded.inferred_facts_json,
      notes=excluded.notes, lifecycle_stage=excluded.lifecycle_stage,
      intimacy_score=excluded.intimacy_score, openness_score=excluded.openness_score,
      activity_score=excluded.activity_score, risk_score=excluded.risk_score,
      next_action=excluded.next_action, source_message_count=excluded.source_message_count,
      analyzed_through_message_id=excluded.analyzed_through_message_id,
      analyzed_through_at=excluded.analyzed_through_at, model_id=excluded.model_id,
      model_name=excluded.model_name, review_status=excluded.review_status,
      profile_version=excluded.profile_version, payload_json=excluded.payload_json, updated_at=excluded.updated_at
  `).run(
    clean(contactId), json(facts), json(tags), json(traits), json(confirmed), json(inferences),
    clean(input.note ?? input.notes ?? profile.note ?? current.note),
    clean(input.lifecycleStage ?? input.stage ?? profile.lifecycleStage ?? profile.stage ?? current.lifecycleStage),
    clamp(input.intimacyScore ?? input.temperature ?? profile.intimacyScore ?? profile.temperature ?? current.intimacyScore),
    clamp(input.opennessScore ?? input.openness ?? profile.opennessScore ?? profile.openness ?? current.openness),
    clamp(input.activityScore ?? input.activity ?? profile.activityScore ?? profile.activity ?? current.activity),
    clamp(input.riskScore ?? input.risk ?? profile.riskScore ?? profile.risk ?? current.risk),
    clean(input.nextAction ?? input.next ?? profile.nextAction ?? profile.next ?? current.nextAction),
    Number(metadata.sourceMessageCount ?? input.sourceMessageCount ?? current.sourceMessageCount ?? 0),
    clean(metadata.analyzedThroughMessageId ?? input.analyzedThroughMessageId ?? current.analyzedThroughMessageId),
    clean(metadata.analyzedThroughAt ?? input.analyzedThroughAt ?? current.analyzedThroughAt),
    clean(metadata.modelId ?? input.modelId ?? current.modelId),
    clean(metadata.modelName ?? input.model ?? current.model),
    clean(metadata.reviewStatus ?? input.reviewStatus ?? current.reviewStatus ?? 'manual'),
    version, json(payload), currentRow?.created_at || timestamp, timestamp
  );
  return getProfile(contactId, store);
}

function reviewPendingProfile(contactId, input = {}, store = getStore()) {
  const id = resolveCustomerProfileId(contactId, store) || clean(contactId);
  const currentRow = store.db.prepare('SELECT * FROM customer_profiles WHERE contact_id=?').get(id);
  if (!currentRow) throw Object.assign(new Error('没有待审核的AI画像'), { code: 'PROFILE_PENDING_REVIEW_NOT_FOUND', status: 404 });
  const current = profileView(currentRow);
  const pending = object(current.pendingReview);
  if (!Object.keys(pending).length || !object(pending.profile) || current.reviewStatus !== 'ai-pending-review') {
    throw Object.assign(new Error('没有待审核的AI画像'), { code: 'PROFILE_PENDING_REVIEW_NOT_FOUND', status: 404 });
  }
  const decision = clean(input.decision).toLowerCase();
  if (!['approved', 'rejected'].includes(decision)) {
    throw Object.assign(new Error('画像审核决定必须是 approved 或 rejected'), { code: 'PROFILE_REVIEW_DECISION_INVALID', status: 400 });
  }
  const decidedAt = nowIso();
  const decidedBy = clean(input.decidedBy) || 'user';
  const reviewEntry = {
    decision,
    decidedAt,
    decidedBy,
    reason: clean(input.reason),
    modelId: clean(pending.modelId),
    analyzedThroughMessageId: clean(pending.analyzedThroughMessageId)
  };
  const reviewHistory = [...array(current.payload?.profileReviewHistory), reviewEntry].slice(-100);
  if (decision === 'approved') {
    const proposal = { ...object(pending.profile), payload: { ...object(pending.profile?.payload), profileReviewHistory: reviewHistory } };
    const profile = upsertProfile(id, proposal, {
      reviewStatus: 'approved',
      clearPendingReview: true,
      sourceMessageCount: pending.sourceMessageCount,
      analyzedThroughMessageId: pending.analyzedThroughMessageId,
      analyzedThroughAt: pending.analyzedThroughAt,
      modelId: pending.modelId,
      modelName: pending.modelName
    }, store);
    return { changed: true, decision, decidedAt, decidedBy, profile };
  }
  const payload = { ...object(current.payload), profileReviewHistory: reviewHistory };
  delete payload.pendingReview;
  if (Object.keys(object(pending.previousChineseUnderstanding)).length) payload.chineseUnderstanding = object(pending.previousChineseUnderstanding);
  else delete payload.chineseUnderstanding;
  if (clean(pending.previousTranslationStatus)) payload.translationStatus = clean(pending.previousTranslationStatus);
  else delete payload.translationStatus;
  if (clean(pending.previousTranslationModel)) payload.translationModel = clean(pending.previousTranslationModel);
  else delete payload.translationModel;
  if (clean(pending.previousTranslatedAt)) payload.translatedAt = clean(pending.previousTranslatedAt);
  else delete payload.translatedAt;
  const restoredReviewStatus = clean(pending.previousReviewStatus) || 'manual';
  const previousMetadata = object(pending.previousMetadata);
  store.db.prepare(`
    UPDATE customer_profiles SET review_status=?, profile_version=profile_version+1,
      source_message_count=?, analyzed_through_message_id=?, analyzed_through_at=?,
      model_id=?, model_name=?, payload_json=?, updated_at=? WHERE contact_id=?
  `).run(
    restoredReviewStatus,
    Number(previousMetadata.sourceMessageCount || 0),
    clean(previousMetadata.analyzedThroughMessageId),
    clean(previousMetadata.analyzedThroughAt),
    clean(previousMetadata.modelId),
    clean(previousMetadata.modelName),
    json(payload), decidedAt, id
  );
  return {
    changed: false,
    decision,
    decidedAt,
    decidedBy,
    reason: clean(input.reason),
    profile: getProfile(id, store)
  };
}

function relationshipSourceScope(contactId, conversationId, store = getStore()) {
  const physicalContactId = resolveCanonicalContactId(contactId, store) || clean(contactId);
  const contact = getContact(physicalContactId, store);
  const conversation = clean(conversationId) ? getConversationRow(conversationId, store) : null;
  return {
    platform: clean(conversation?.platform || contact?.platform),
    sourceAccountId: clean(conversation?.account_id || contact?.accountId),
    platformContactIdentity: clean(contact?.externalId),
    conversationId: clean(conversation?.session_key || conversationId),
    canonicalContactId: resolveCustomerProfileId(physicalContactId, store) || physicalContactId
  };
}

function upsertInsights(contactId, conversationId, input = {}, metadata = {}, store = getStore()) {
  const sourceContactId = resolveCanonicalContactId(contactId, store) || clean(contactId);
  const person = resolvePersonProfileContext(sourceContactId, store);
  contactId = person.personId ? (person.profileContactId || sourceContactId) : sourceContactId;
  let currentRow = findPersonScopedRow('relationship_insights', person, contactId, store);
  currentRow = materializePersonAnchorRow('relationship_insights', person, contactId, currentRow, store);
  const current = insightView(currentRow);
  const risk = object(input.risk);
  const opportunity = object(input.opportunity);
  const dimensions = { ...object(current.dimensions), ...object(input.dimensions) };
  const timestamp = nowIso();
  store.db.prepare(`
    INSERT INTO relationship_insights(
      contact_id, conversation_id, summary, relationship_stage, tone, intimacy_score,
      initiative_score, openness_score, response_pressure_score, opportunity_score, risk_score,
      hidden_need, next_action, evidence_json, open_loops_json, dimensions_json,
      source_message_count, analyzed_through_message_id, analyzed_through_at,
      model_id, model_name, status, payload_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(contact_id) DO UPDATE SET
      conversation_id=excluded.conversation_id, summary=excluded.summary,
      relationship_stage=excluded.relationship_stage, tone=excluded.tone,
      intimacy_score=excluded.intimacy_score, initiative_score=excluded.initiative_score,
      openness_score=excluded.openness_score, response_pressure_score=excluded.response_pressure_score,
      opportunity_score=excluded.opportunity_score, risk_score=excluded.risk_score,
      hidden_need=excluded.hidden_need, next_action=excluded.next_action,
      evidence_json=excluded.evidence_json, open_loops_json=excluded.open_loops_json,
      dimensions_json=excluded.dimensions_json, source_message_count=excluded.source_message_count,
      analyzed_through_message_id=excluded.analyzed_through_message_id,
      analyzed_through_at=excluded.analyzed_through_at, model_id=excluded.model_id,
      model_name=excluded.model_name, status=excluded.status, payload_json=excluded.payload_json,
      updated_at=excluded.updated_at
  `).run(
    clean(contactId), clean(conversationId), clean(input.summary ?? current.summary),
    clean(input.relationshipStage ?? input.stage ?? current.relationshipStage, '待分析'),
    clean(input.tone ?? current.tone),
    clamp(input.intimacyScore ?? input.intimacy ?? input.temperature ?? current.intimacyScore),
    clamp(input.initiativeScore ?? input.initiative ?? dimensions.initiative ?? current.initiativeScore),
    clamp(input.opennessScore ?? input.openness ?? dimensions.openness ?? current.openness),
    clamp(input.responsePressureScore ?? input.responsePressure ?? dimensions.pressure ?? current.responsePressure),
    clamp(input.opportunityScore ?? opportunity.score ?? input.opportunity ?? current.opportunityScore),
    clamp(input.riskScore ?? risk.score ?? input.risk ?? current.riskScore),
    clean(input.hiddenNeed ?? current.hiddenNeed),
    clean(input.nextAction ?? input.next ?? input.suggestedFocus ?? current.nextAction),
    json(array(input.evidence).length ? input.evidence : current.evidence),
    json(array(input.openLoops).length ? input.openLoops : array(input.mustRespond).length ? input.mustRespond : current.openLoops),
    json(dimensions),
    Number(metadata.sourceMessageCount ?? input.sourceMessageCount ?? current.sourceMessageCount ?? 0),
    clean(metadata.analyzedThroughMessageId ?? input.analyzedThroughMessageId ?? current.analyzedThroughMessageId),
    clean(metadata.analyzedThroughAt ?? input.analyzedThroughAt ?? current.analyzedThroughAt),
    clean(metadata.modelId ?? input.modelId ?? current.modelId),
    clean(metadata.modelName ?? input.model ?? current.model),
    clean(metadata.status ?? input.status ?? 'ready'),
    json({
      ...object(current.payload),
      ...object(input.payload),
      events: array(input.events).length ? input.events : array(current.events),
      points: array(input.points).length ? input.points : array(current.points),
      topics: array(input.topics).length ? input.topics : array(current.topics),
      reply: clean(input.reply ?? current.reply),
      momentum: clean(input.momentum ?? current.momentum),
      depth: clamp(input.depth ?? current.depth),
      opportunityText: clean(input.opportunityText ?? current.opportunityText),
      riskText: clean(input.riskText ?? current.riskText),
      rawAnalysis: object(input.rawAnalysis),
      sourceScope: relationshipSourceScope(sourceContactId, conversationId, store)
    }),
    currentRow?.created_at || timestamp, timestamp
  );
  return getInsights(contactId, store);
}

function buildAnalysisPrompt(contact, conversation, messages) {
  return [
    '你是言策跨模块客户理解引擎。只允许使用输入中的真实SQLite消息，不得编造。',
    '输出严格JSON，不要Markdown。',
    '结构必须为：',
    '{',
    '  "analysis": {"summary":"","confidence":0,"intent":"","intentLabel":"","intentConfidence":0,"hiddenNeed":"","needConfidence":0,"dimensions":{"emotion":0,"initiative":0,"openness":0,"pressure":0,"flirtation":0},"memories":[],"evidence":[],"mustRespond":[],"ignore":[],"risk":{"score":0,"level":"","text":""},"opportunity":{"score":0,"level":"","text":""},"personaConsistency":0,"constraints":[],"strategy":{},"simulation":{}},',
    '  "profile": {"tags":[],"facts":{},"traits":{},"confirmedFacts":[],"inferredFacts":[],"lifecycleStage":"","intimacyScore":0,"opennessScore":0,"activityScore":0,"riskScore":0,"nextAction":""},',
    '  "insights": {"summary":"","relationshipStage":"","tone":"","intimacyScore":0,"initiativeScore":0,"opennessScore":0,"responsePressureScore":0,"opportunityScore":0,"riskScore":0,"hiddenNeed":"","nextAction":"","evidence":[],"openLoops":[],"dimensions":{}}',
    '}',
    'confirmedFacts只能放消息中有直接证据的事实；inferredFacts必须带confidence和evidence。',
    '重要：你好、Hallo、Hi、表情或一句轻量问候也属于有效社交输入，绝不能因为信息少而返回空分析。',
    '对于低信息开场：明确标记为问候/轻量试探；hiddenNeed必须写成保守假设并说明“没有足够证据支持更深层需求”；不得虚构年龄、职业、城市、婚姻或兴趣；仍要给出基于真实消息的 evidence、低风险判断和可执行回复策略。',
    '所有面向用户的分析说明、摘要、意图、隐含需求、机会、风险、策略、下一步、关系阶段和事实标题必须使用简体中文。',
    'evidence中的quote保留消息原文，并额外提供translatedZh；客户姓名、昵称、城市、品牌、金额、日期、URL和Emoji不得翻译。',
    `联系人：${json(contact)}`,
    `会话：${json({ sessionKey: conversation.session_key, platform: conversation.platform, accountId: conversation.account_id, title: conversation.title })}`,
    '真实消息中的 translatedZh 若存在，必须直接复用为该消息证据的中文理解，不得再次生成不同译文。',
    '所有 evidence 项必须返回 messageId、quote/sourceText、translatedZh；messageId 必须来自输入真实消息。',
    `真实消息：${json(messages.map(message => ({
      id: message.id,
      messageId: message.platformMessageId || message.id,
      role: message.role,
      type: message.type,
      sourceText: message.sourceText || message.text,
      translatedZh: message.translatedZh || '',
      translationStatus: message.translationStatus || '',
      sentAt: message.sentAt
    })))}`
  ].join('\n');
}

function normalizeAnalysisResult(result) {
  return aiAnalysisResultAuthority.normalize(result);
}

function factEvidenceMessageIds(row = {}) {
  const values = [
    row.platformMessageId, row.messageId, row.sourceMessageId,
    object(row.evidence).platformMessageId, object(row.evidence).messageId, object(row.evidence).sourceMessageId
  ];
  for (const evidence of array(row.evidence)) {
    values.push(evidence.platformMessageId, evidence.messageId, evidence.sourceMessageId);
  }
  return [...new Set(values.map(clean).filter(Boolean))];
}

function looksLikeInternalFactValue(key, value) {
  const normalizedKey = normalizeProfileFactKey(key);
  const text = profileScalar(value);
  if (!text) return true;
  if (INTERNAL_PROFILE_FACT_KEYS.has(normalizedKey)) return true;
  if (/^\d{14,}$/u.test(text) && !['phone', 'telephone', 'mobile'].includes(normalizedKey)) return true;
  if (/^(?:fb|facebook|wa|whatsapp|tg|telegram|acc|contact|session)[-_:][a-z0-9-]{8,}$/iu.test(text)) return true;
  return false;
}

function validateModelProfileAgainstMessages(profile = {}, messages = [], deterministic = {}) {
  const messageIndex = new Map();
  const inboundRows = [];
  for (const message of array(messages)) {
    const ids = [message.id, message.messageId, message.platformMessageId, message.externalMessageId].map(clean).filter(Boolean);
    for (const id of ids) messageIndex.set(id, message);
    if (messageSpeakerAuthority.isPeerInbound(message)) inboundRows.push(message);
  }
  const resolveEvidence = row => {
    const evidenceIds = factEvidenceMessageIds(row);
    for (const id of evidenceIds) {
      const message = messageIndex.get(id);
      if (!message) continue;
      if (messageSpeakerAuthority.isPeerInbound(message)) return message;
      return null;
    }
    if (evidenceIds.length) return null;
    const quote = profileScalar(row.sourceText ?? row.quote ?? row.text ?? row.value);
    if (!quote) return null;
    const normalizedQuote = quote.normalize('NFKC').replace(/\s+/gu, ' ').toLowerCase();
    const matches = inboundRows.filter(message => {
      const source = clean(message.sourceText || message.text).normalize('NFKC').replace(/\s+/gu, ' ').toLowerCase();
      return source && (source.includes(normalizedQuote) || normalizedQuote.includes(source));
    });
    return matches.length === 1 ? matches[0] : null;
  };

  const confirmed = [];
  const confirmedKeyValues = new Set();
  for (const row of sanitizeFactList(array(profile.confirmedFacts).length ? profile.confirmedFacts : profile.confirmed, 'confirmed')) {
    const key = publicProfileFactKey(row.key);
    const value = profileScalar(row.value || row.text);
    if (!key || looksLikeInternalFactValue(key, value)) continue;
    const evidenceMessage = resolveEvidence(row);
    if (!evidenceMessage) continue;
    const platformMessageId = clean(evidenceMessage.platformMessageId || evidenceMessage.messageId || evidenceMessage.id);
    const sourceText = clean(evidenceMessage.sourceText || evidenceMessage.text);
    const translatedZh = clean(evidenceMessage.translatedZh);
    const normalized = {
      ...row,
      key,
      value,
      source: '对方真实消息',
      status: 'confirmed',
      confidence: Math.max(0, Math.min(100, Number(row.confidence || 100))),
      sourceMessageId: platformMessageId,
      messageId: platformMessageId,
      platformMessageId,
      sourceText,
      translatedZh,
      direction: 'inbound',
      speaker: 'peer',
      evidence: [{
        messageId: platformMessageId,
        platformMessageId,
        sourceText,
        translatedZh,
        direction: 'inbound',
        speaker: 'peer',
        sentAt: clean(evidenceMessage.sentAt)
      }]
    };
    confirmed.push(normalized);
    confirmedKeyValues.add(`${key}\u001f${value.normalize('NFKC').toLowerCase()}`);
  }

  const deterministicFacts = array(deterministic.facts);
  const deterministicKeys = new Set(deterministicFacts.map(row => publicProfileFactKey(row.key)).filter(Boolean));
  const modelFactsWithoutDeterministicDuplicates = confirmed.filter(row => !deterministicKeys.has(publicProfileFactKey(row.key)));
  const mergedConfirmed = contactFactExtractionService.mergeConfirmedFacts(modelFactsWithoutDeterministicDuplicates, deterministicFacts);
  for (const row of deterministicFacts) {
    const key = publicProfileFactKey(row.key);
    const value = profileScalar(row.value);
    if (key && value) confirmedKeyValues.add(`${key}\u001f${value.normalize('NFKC').toLowerCase()}`);
  }

  const facts = {};
  const sourceFacts = sanitizeProfileFacts(profile.facts);
  for (const [key, value] of Object.entries({ ...sourceFacts, ...object(deterministic.profileFacts) })) {
    if (looksLikeInternalFactValue(key, value)) continue;
    const normalizedValue = profileScalar(value).normalize('NFKC').toLowerCase();
    const supported = confirmedKeyValues.has(`${key}\u001f${normalizedValue}`) || Object.prototype.hasOwnProperty.call(object(deterministic.profileFacts), key);
    if (supported) facts[key] = value;
  }

  const inferred = [];
  for (const row of sanitizeFactList(array(profile.inferredFacts).length ? profile.inferredFacts : profile.inferences, 'pending')) {
    const key = publicProfileFactKey(row.key);
    const value = profileScalar(row.value || row.text);
    if ((key && looksLikeInternalFactValue(key, value)) || (!key && /^\d{14,}$/u.test(value))) continue;
    const evidenceMessage = resolveEvidence(row);
    if (!evidenceMessage) continue;
    inferred.push({
      ...row,
      key,
      status: 'pending',
      sourceMessageId: clean(evidenceMessage.platformMessageId || evidenceMessage.messageId || evidenceMessage.id),
      direction: 'inbound',
      speaker: 'peer'
    });
  }

  return {
    ...profile,
    facts,
    confirmedFacts: mergedConfirmed,
    confirmed: mergedConfirmed,
    inferredFacts: inferred,
    inferences: inferred,
    payload: {
      ...object(profile.payload),
      evidenceValidation: {
        status: 'completed',
        validatedConfirmedFacts: mergedConfirmed.length,
        validatedInferredFacts: inferred.length,
        inboundMessageCount: inboundRows.length,
        completedAt: nowIso()
      }
    }
  };
}

async function persistDeterministicFactsFromMessages(contact, conversation, messages, store) {
  const sourceScope = relationshipSourceScope(contact.id, conversation.session_key || conversation.sessionKey, store);
  let profileFacts = {};
  let confirmedFacts = [];
  let recurringInterests = [];
  const evidence = [];
  let sourceMessageId = '';
  let sourceMessageAt = '';
  for (const message of array(messages)) {
    const extracted = contactFactExtractionService.extractDeterministicFacts(message, {
      platform: clean(conversation.platform),
      sourceAccountId: clean(conversation.account_id || conversation.accountId),
      conversationId: clean(conversation.session_key || conversation.sessionKey),
      canonicalContactId: clean(sourceScope.canonicalContactId || contact.canonicalContactId || contact.id)
    });
    if (!extracted.facts.length) continue;
    profileFacts = { ...profileFacts, ...object(extracted.profileFacts) };
    confirmedFacts = contactFactExtractionService.mergeConfirmedFacts(confirmedFacts, extracted.facts);
    recurringInterests = contactFactExtractionService.mergeInterestRows(recurringInterests, extracted.recurringInterests);
    evidence.push(...extracted.facts);
    sourceMessageId = clean(message.platformMessageId || message.messageId || message.id) || sourceMessageId;
    sourceMessageAt = clean(message.sentAt) || sourceMessageAt;
  }
  if (!evidence.length) return { facts: [], profileFacts: {}, recurringInterests: [], persisted: false };
  if (clean(profileFacts.country) && clean(profileFacts.region)) profileFacts.address = `${clean(profileFacts.country)} · ${clean(profileFacts.region)}`;
  const adapter = new SqliteStorePersistenceAdapter({ store });
  await adapter.transaction(transaction => {
    transaction.upsertDeterministicCustomerFacts({
      contactId: contact.id,
      canonicalContactId: clean(sourceScope.canonicalContactId || contact.canonicalContactId || contact.id),
      platform: clean(conversation.platform),
      sourceAccountId: clean(conversation.account_id || conversation.accountId),
      conversationId: clean(conversation.session_key || conversation.sessionKey),
      sourceMessageId,
      sourceMessageAt,
      profileFacts,
      confirmedFacts,
      recurringInterests,
      evidence,
      extractionVersion: contactFactExtractionService.SERVICE_VERSION
    });
  }, { source: 'workspace-analysis-deterministic-fact-backfill' });
  return { facts: evidence, profileFacts, confirmedFacts, recurringInterests, persisted: true };
}

async function persistDeterministicFactsForConversation(sessionKey, options = {}) {
  const store = options.store || getStore();
  const { conversation, contact } = resolveContactForConversation(sessionKey, store);
  const maxMessages = Math.max(8, Math.min(240, Number(options.maxMessages || 80)));
  const sourceMessages = analysisMessages(sessionKey, maxMessages, store);
  const messages = options.onlyLatestPeerInbound === true
    ? sourceMessages.filter(message => messageSpeakerAuthority.isPeerInbound(message)).slice(-1)
    : sourceMessages;
  if (!messages.length) {
    return {
      ok: true,
      conversationId: clean(sessionKey),
      contactId: clean(contact.id),
      facts: [],
      profileFacts: {},
      recurringInterests: [],
      persisted: false,
      reason: 'NO_MESSAGES_TO_EXTRACT'
    };
  }
  const result = await persistDeterministicFactsFromMessages(contact, conversation, messages, store);
  if (result.persisted) {
    const payload = {
      ok: true,
      source: clean(options.source || 'deterministic-message-extraction'),
      contactId: clean(contact.id),
      canonicalContactId: clean(resolveCustomerProfileId(contact.id, store) || contact.id),
      conversationId: clean(sessionKey),
      platform: clean(conversation.platform).toLowerCase(),
      sourceAccountId: clean(conversation.account_id || conversation.accountId),
      factCount: result.facts.length,
      factKeys: result.facts.map(row => clean(row.key)).filter(Boolean),
      profileFacts: object(result.profileFacts),
      extractionVersion: contactFactExtractionService.SERVICE_VERSION,
      updatedAt: nowIso()
    };
    eventBus.publish('workspace.profile.updated', payload);
    eventBus.publish('workspace.deterministic-facts.updated', payload);
  }
  return {
    ok: true,
    conversationId: clean(sessionKey),
    contactId: clean(contact.id),
    ...result
  };
}

function analysisMessages(sessionKey, limit, store) {
  return latestMessages(sessionKey, limit, store)
    .filter(message => !message.revoked)
    .filter(message => messageSpeakerAuthority.isAnalysisMessage(message))
    .filter(message => clean(message.text));
}

function analysisSourceFingerprint(messages = []) {
  const material = array(messages).map(message => ({
    id: clean(message.id),
    platformMessageId: clean(message.platformMessageId),
    role: clean(message.role),
    speaker: clean(message.speaker),
    direction: clean(message.direction),
    sourceText: clean(message.sourceText || message.text),
    translatedZh: clean(message.translatedZh),
    translationStatus: clean(message.translationStatus),
    sentAt: clean(message.sentAt)
  }));
  return crypto.createHash('sha256').update(json(material)).digest('hex');
}

function captureAnalysisSource(sessionKey, conversation, contact, messages, store) {
  const lastMessage = messages.at(-1);
  return Object.freeze({
    conversationId: clean(sessionKey),
    contactId: clean(contact.id),
    canonicalContactId: clean(resolveCustomerProfileId(contact.id, store) || contact.id),
    platform: clean(conversation.platform).toLowerCase(),
    sourceAccountId: clean(conversation.account_id || conversation.accountId),
    messageCount: messages.length,
    sourceLastMessageId: clean(lastMessage?.id),
    fingerprint: analysisSourceFingerprint(messages)
  });
}

function staleAnalysisError(captured, current, reason) {
  const error = new Error('会话内容或身份已变化，旧AI分析结果已丢弃');
  error.code = 'AI_STALE_RESULT';
  error.status = 409;
  error.reason = reason;
  error.captured = captured;
  error.current = current;
  return error;
}

function assertAnalysisSourceCurrent(captured, maxMessages, store) {
  const resolved = resolveContactForConversation(captured.conversationId, store);
  const currentMessages = analysisMessages(captured.conversationId, maxMessages, store);
  const current = captureAnalysisSource(captured.conversationId, resolved.conversation, resolved.contact, currentMessages, store);
  const checks = [
    ['CONTACT_CHANGED', current.contactId === captured.contactId],
    ['CANONICAL_CONTACT_CHANGED', current.canonicalContactId === captured.canonicalContactId],
    ['PLATFORM_CHANGED', current.platform === captured.platform],
    ['ACCOUNT_CHANGED', current.sourceAccountId === captured.sourceAccountId],
    ['MESSAGE_COUNT_CHANGED', current.messageCount === captured.messageCount],
    ['LAST_MESSAGE_CHANGED', current.sourceLastMessageId === captured.sourceLastMessageId],
    ['SOURCE_FINGERPRINT_CHANGED', current.fingerprint === captured.fingerprint]
  ];
  const failed = checks.find(([, ok]) => !ok);
  if (failed) throw staleAnalysisError(captured, current, failed[0]);
  return current;
}

async function analyzeConversation(sessionKey, options = {}) {
  const signal = options.signal || null;
  const assertNotAborted = () => {
    if (!signal?.aborted) return;
    const reason = signal.reason instanceof Error ? signal.reason : new Error('AI analysis cancelled');
    if (!reason.code) reason.code = 'AI_ANALYSIS_CANCELLED';
    throw reason;
  };
  assertNotAborted();
  const store = options.store || getStore();
  const { conversation, contact } = resolveContactForConversation(sessionKey, store);
  if (contact.archived || conversation.archived_at) {
    throw Object.assign(new Error('已归档客户不参与AI分析，请先恢复客户'), { code: 'ARCHIVED_CONTACT_READ_ONLY', status: 409 });
  }
  const maxMessages = options.maxMessages || 240;
  const messages = analysisMessages(sessionKey, maxMessages, store);
  if (!messages.length) throw Object.assign(new Error('当前会话没有可分析的真实消息'), { code: 'NO_MESSAGES_TO_ANALYZE', status: 409 });

  const sourceCapture = captureAnalysisSource(sessionKey, conversation, contact, messages, store);
  const lastMessage = messages.at(-1);
  const startedAt = nowIso();
  const runId = stableId('analysis', [sessionKey, lastMessage.id, startedAt]);
  const requestPayload = {
    messageIds: messages.map(message => message.id),
    maxMessages,
    sourceFingerprint: sourceCapture.fingerprint,
    sourceLastMessageId: lastMessage.id,
    requestedModelId: clean(options.modelId),
    state: 'running'
  };
  store.db.prepare(`
    INSERT INTO ai_analysis_runs(
      id, conversation_id, contact_id, model_id, model_name, status,
      source_message_count, source_last_message_id, request_json, result_json,
      error_text, started_at, completed_at
    ) VALUES (?, ?, ?, ?, '', 'running', ?, ?, ?, '{}', '', ?, '')
  `).run(
    runId, clean(sessionKey), contact.id, clean(options.modelId), messages.length,
    lastMessage.id, json(requestPayload), startedAt
  );
  eventBus.publish('workspace.analysis.running', {
    runId,
    conversationId: clean(sessionKey),
    contactId: contact.id,
    sourceMessageCount: messages.length,
    sourceLastMessageId: lastMessage.id
  });

  let deterministic = { facts: [], profileFacts: {}, recurringInterests: [], persisted: false };
  let analysisExecutionResult = null;
  let analysisSchemaRepair = { attempted: false, succeeded: false, requestedModelId: '', selectedModelId: '' };
  try {
    deterministic = options.deterministicFacts && typeof options.deterministicFacts === 'object'
      ? options.deterministicFacts
      : await persistDeterministicFactsFromMessages(contact, conversation, messages, store);
    assertNotAborted();
    const gateway = require('../services/aiGateway');
    const executor = options.executor || (payload => gateway.execute(payload));
    const executionPayload = {
      task: 'understanding',
      modelId: options.modelId,
      dedupeKey: options.dedupeKey || `stage6-analysis:${sessionKey}:${lastMessage.id}`,
      fingerprint: options.fingerprint || messages.map(message => message.id).join('|'),
      messages: [
        { role: 'system', content: '只输出有效JSON，不使用Markdown。所有客户事实必须引用对方入站消息证据，禁止把用户自己发送的内容写入联系人档案。' },
        { role: 'user', content: buildAnalysisPrompt(contact, conversation, messages) }
      ],
      context: {
        platform: sourceCapture.platform,
        sourceAccountId: sourceCapture.sourceAccountId,
        sessionKey: sourceCapture.conversationId,
        conversationId: sourceCapture.conversationId,
        contactId: sourceCapture.contactId,
        requestId: runId,
        generation: sourceCapture.fingerprint,
        scopeKey: `analysis:${sourceCapture.platform}:${sourceCapture.sourceAccountId}:${sourceCapture.conversationId}`
      },
      signal,
      options: {
        json: true,
        maxTokens: 3000,
        temperature: 0.1,
        timeoutMs: modelTaskRuntimePolicy.normalizeTimeoutMs('understanding', options.timeoutMs)
      }
    };
    let result = await executor(executionPayload);
    assertNotAborted();
    analysisExecutionResult = result;
    assertAnalysisSourceCurrent(sourceCapture, maxMessages, store);
    let structured;
    try {
      structured = normalizeAnalysisResult(result);
    } catch (error) {
      const selectedModelId = clean(result?.modelId || options.modelId);
      const deterministicBootstrap = socialConversationBootstrapAuthority.bootstrapFromMessages(messages);
      if (deterministicBootstrap) {
        structured = deterministicBootstrap;
        analysisSchemaRepair = {
          attempted: false,
          succeeded: true,
          requestedModelId: selectedModelId,
          selectedModelId,
          deterministicBootstrap: true
        };
      } else {
        if (options.executor || !selectedModelId || clean(error?.code) !== 'INVALID_AI_ANALYSIS_RESULT') throw error;
        analysisSchemaRepair = { attempted: true, succeeded: false, requestedModelId: selectedModelId, selectedModelId: '' };
        const repaired = await gateway.execute({
          ...executionPayload,
          modelId: selectedModelId,
          dedupeKey: `${executionPayload.dedupeKey}:schema-repair`,
          fingerprint: `${executionPayload.fingerprint}:schema-repair`,
          messages: [
            executionPayload.messages[0],
            { role: 'user', content: aiAnalysisResultAuthority.repairPrompt(result, error) }
          ],
          context: {
            ...executionPayload.context,
            requestId: `${runId}:schema-repair`,
            scopeKey: `analysis-repair:${sourceCapture.platform}:${sourceCapture.sourceAccountId}:${sourceCapture.conversationId}`
          },
          options: {
            ...executionPayload.options,
            onlyRequestedModel: true,
            temperature: 0
          }
        });
        try {
          assertNotAborted();
        structured = normalizeAnalysisResult(repaired);
        } catch (repairError) {
          const repairBootstrap = socialConversationBootstrapAuthority.bootstrapFromMessages(messages);
          if (!repairBootstrap) throw repairError;
          structured = repairBootstrap;
        }
        analysisSchemaRepair = {
          attempted: true,
          succeeded: true,
          requestedModelId: selectedModelId,
          selectedModelId: clean(repaired.modelId || selectedModelId)
        };
        result = {
          ...repaired,
          attempts: [...array(result?.attempts), ...array(repaired?.attempts)]
        };
        analysisExecutionResult = result;
        assertAnalysisSourceCurrent(sourceCapture, maxMessages, store);
      }
    }
    structured = socialConversationBootstrapAuthority.enrichEnvelope(structured, messages);
    structured.profile = validateModelProfileAgainstMessages(structured.profile, messages, deterministic);
    structured.analysis = {
      ...structured.analysis,
      ...object(options.analysisMetadata),
      deterministicFactExtraction: {
        status: deterministic.persisted ? 'completed' : 'no-facts',
        factCount: deterministic.facts.length,
        factKeys: deterministic.facts.map(row => clean(row.key)).filter(Boolean),
        version: contactFactExtractionService.SERVICE_VERSION
      }
    };

    const chineseUnderstanding = await socialChineseUnderstandingService.translateBundle({
      contactId: contact.id,
      conversationId: clean(sessionKey),
      analysis: structured.analysis,
      profile: structured.profile,
      insights: structured.insights,
      dedupeKey: `stage6-analysis-zh:${sessionKey}:${lastMessage.id}`,
      fingerprint: `${lastMessage.id}:${clean(result.modelId || result.model || options.modelId)}`,
      signal,
      context: executionPayload.context,
      assertCurrent() {
        assertNotAborted();
        assertAnalysisSourceCurrent(sourceCapture, maxMessages, store);
      }
    }, { aiGateway: gateway });
    assertNotAborted();
    assertAnalysisSourceCurrent(sourceCapture, maxMessages, store);
    const translated = object(chineseUnderstanding.translated);
    structured.analysis = {
      ...structured.analysis,
      chineseUnderstanding: object(translated.analysis),
      translationStatus: chineseUnderstanding.translationStatus,
      translationModel: chineseUnderstanding.translationModel || '',
      translatedAt: chineseUnderstanding.translatedAt || '',
      translationErrorCode: chineseUnderstanding.translationErrorCode || ''
    };
    structured.profile = {
      ...structured.profile,
      payload: {
        ...object(structured.profile.payload),
        chineseUnderstanding: object(translated.profile),
        translationStatus: chineseUnderstanding.translationStatus,
        translationModel: chineseUnderstanding.translationModel || '',
        translatedAt: chineseUnderstanding.translatedAt || ''
      }
    };
    structured.insights = {
      ...structured.insights,
      payload: {
        ...object(structured.insights.payload),
        chineseUnderstanding: object(translated.insights),
        translationStatus: chineseUnderstanding.translationStatus,
        translationModel: chineseUnderstanding.translationModel || '',
        translatedAt: chineseUnderstanding.translatedAt || ''
      }
    };

    const metadata = {
      sourceMessageCount: messages.length,
      analyzedThroughMessageId: lastMessage.id,
      analyzedThroughAt: lastMessage.sentAt,
      modelId: clean(result.modelId || options.modelId),
      modelName: clean(result.model || result.modelName),
      reviewStatus: 'ai-pending-review',
      status: 'ready'
    };
    const sourceScope = relationshipSourceScope(contact.id, sessionKey, store);
    const analysisPresentation = buildSocialAnalysisPresentation({
      profile: structured.profile,
      insights: { ...structured.insights, sourceScope },
      analysis: structured.analysis,
      messages,
      scope: sourceScope,
      projectionVersion: customerProfileEvidenceAuthority.DEFAULT_PROJECTION_VERSION
    });
    let profile;
    let insights;
    let evidenceProjection;
    assertAnalysisSourceCurrent(sourceCapture, maxMessages, store);
    const completedAt = nowIso();
    structured.completeness = aiAnalysisResultAuthority.productCompleteness(structured.analysis);
    const analysisReceipt = aiAnalysisResultAuthority.executionReceipt({
      runId,
      state: 'completed',
      transactionCommitted: true,
      modelId: metadata.modelId,
      modelName: metadata.modelName,
      routeReceipt: result.qualityRouteReceipt,
      emergencyMode: result.emergencyMode === true,
      learningEligible: result.emergencyMode === true ? false : result.learningEligible === true,
      schemaRepair: analysisSchemaRepair,
      normalized: structured,
      attempts: result.attempts,
      completedAt
    });
    structured.analysisReceipt = analysisReceipt;
    structured.analysis = {
      ...structured.analysis,
      executionReceipt: {
        runId,
        state: 'completed',
        transactionCommitted: true,
        receiptSha256: analysisReceipt.receiptSha256,
        qualityRouteReceiptHash: analysisReceipt.qualityRouteReceiptHash,
        modelId: metadata.modelId,
        modelName: metadata.modelName,
        emergencyMode: analysisReceipt.emergencyMode,
        learningEligible: analysisReceipt.learningEligible,
        schemaRepair: analysisReceipt.schemaRepair,
        completeness: analysisReceipt.completeness
      }
    };
    store.transaction(() => {
      assertNotAborted();
      assertAnalysisSourceCurrent(sourceCapture, maxMessages, store);
      profile = upsertProfile(contact.id, structured.profile, metadata, store);
      insights = upsertInsights(contact.id, sessionKey, { ...structured.insights, rawAnalysis: structured.analysis }, metadata, store);
      evidenceProjection = customerProfileEvidenceAuthority.persistProjection(store, analysisPresentation, {
        messages,
        scope: sourceScope,
        projectionVersion: customerProfileEvidenceAuthority.DEFAULT_PROJECTION_VERSION
      });
      store.db.prepare(`
        UPDATE ai_analysis_runs SET
          model_id=?, model_name=?, status='completed', result_json=?, error_text='', completed_at=?
        WHERE id=?
      `).run(metadata.modelId, metadata.modelName, json(structured), completedAt, runId);
    });
    eventBus.publish('workspace.analysis.completed', {
      runId,
      conversationId: clean(sessionKey),
      contactId: contact.id,
      sourceLastMessageId: lastMessage.id,
      modelId: metadata.modelId,
      deterministicFactCount: deterministic.facts.length,
      analysisReceiptSha256: analysisReceipt.receiptSha256,
      productComplete: analysisReceipt.completeness.complete,
      schemaRepair: analysisReceipt.schemaRepair,
      completedAt
    });
    return {
      ok: true,
      runId,
      conversationId: clean(sessionKey),
      contact,
      profile,
      insights,
      analysis: structured.analysis,
      analysisReceipt,
      schemaRepair: analysisReceipt.schemaRepair,
      analysisPresentation,
      evidenceProjection,
      deterministicFacts: deterministic,
      chineseUnderstanding: {
        translationStatus: chineseUnderstanding.translationStatus,
        translationModel: chineseUnderstanding.translationModel || '',
        translatedAt: chineseUnderstanding.translatedAt || ''
      },
      source: { table: 'r32_messages', messageCount: messages.length, lastMessageId: lastMessage.id, lastMessageAt: lastMessage.sentAt },
      model: { id: metadata.modelId, name: metadata.modelName }
    };
  } catch (error) {
    const completedAt = nowIso();
    const code = clean(error?.code || 'AI_ANALYSIS_FAILED');
    const message = clean(error?.message || 'AI分析失败');
    const stale = code === 'AI_STALE_RESULT';
    const terminalStatus = stale ? 'superseded' : 'failed';
    const failedReceipt = aiAnalysisResultAuthority.executionReceipt({
      runId,
      state: terminalStatus,
      transactionCommitted: false,
      modelId: clean(analysisExecutionResult?.modelId || options.modelId),
      modelName: clean(analysisExecutionResult?.model || analysisExecutionResult?.modelName),
      routeReceipt: analysisExecutionResult?.qualityRouteReceipt,
      emergencyMode: analysisExecutionResult?.emergencyMode === true,
      learningEligible: false,
      schemaRepair: analysisSchemaRepair,
      normalized: { analysis: {}, completeness: aiAnalysisResultAuthority.productCompleteness({}), envelopeSha256: '' },
      attempts: analysisExecutionResult?.attempts,
      completedAt
    });
    try {
      store.db.prepare(`
        UPDATE ai_analysis_runs SET status=?, result_json=?, error_text=?, completed_at=? WHERE id=?
      `).run(terminalStatus, json({
        analysis: {},
        deterministicFactExtraction: {
          status: deterministic.persisted ? 'completed' : 'failed-or-no-facts',
          factCount: deterministic.facts.length,
          factKeys: deterministic.facts.map(row => clean(row.key)).filter(Boolean),
          version: contactFactExtractionService.SERVICE_VERSION
        },
        errorCode: code,
        staleReason: clean(error?.reason),
        analysisReceipt: failedReceipt,
        executionReceipt: {
          state: terminalStatus,
          transactionCommitted: false,
          receiptSha256: failedReceipt.receiptSha256,
          errorCode: code
        }
      }), `${code}: ${message}`, completedAt, runId);
    } catch (_) {}
    eventBus.publish(stale ? 'workspace.analysis.superseded' : 'workspace.analysis.failed', {
      runId,
      conversationId: clean(sessionKey),
      contactId: contact.id,
      sourceLastMessageId: lastMessage.id,
      errorCode: code,
      error: message,
      deterministicFactCount: deterministic.facts.length,
      analysisReceiptSha256: failedReceipt.receiptSha256,
      schemaRepair: failedReceipt.schemaRepair,
      completedAt
    });
    throw error;
  }
}

function identitySummaryForContact(contact = {}, personContext = null) {
  const links = array(personContext?.identityLinks);
  const platform = clean(contact.platform).toLowerCase();
  const accountId = clean(contact.accountId || contact.account_id);
  const externalId = clean(contact.externalId || contact.external_id || contact.platformIdentity);
  const matching = links.find(row =>
    clean(row.platform).toLowerCase() === platform &&
    (!accountId || !clean(row.source_account_id || row.sourceAccountId) || clean(row.source_account_id || row.sourceAccountId) === accountId) &&
    (!externalId || clean(row.external_id || row.externalId) === externalId)
  ) || links.find(row => clean(row.external_id || row.externalId) === externalId) || null;
  const status = clean(matching?.link_status || matching?.linkStatus).toLowerCase();
  const verified = ['verified', 'confirmed'].includes(status);
  const observed = verified || Boolean(externalId) || ['active', 'observed'].includes(status);
  const confidenceRaw = Number(matching?.confidence);
  const confidence = Number.isFinite(confidenceRaw)
    ? Math.round(Math.max(0, Math.min(1, confidenceRaw > 1 ? confidenceRaw / 100 : confidenceRaw)) * 100)
    : verified ? 100 : observed ? 85 : 0;
  return {
    authority: 'PersonContextAuthority',
    status: verified ? 'verified' : observed ? 'observed' : 'pending',
    verified,
    observed,
    confidence,
    identityLinkId: clean(matching?.identity_link_id || matching?.identityLinkId),
    externalId,
    platform,
    sourceAccountId: accountId
  };
}

function getContextByConversation(sessionKey, store = getStore()) {
  const { conversation, contact } = resolveContactForConversation(sessionKey, store);
  const profile = getProfile(contact.id, store);
  const insights = getInsights(contact.id, store);
  const messages = latestMessages(sessionKey, 1000, store);
  const sourceScope = relationshipSourceScope(contact.id, sessionKey, store);
  const personContext = personSnapshot({ contactId: contact.id, conversationId: clean(sessionKey) }, store);
  const latestRun = store.db.prepare(`
    SELECT id, model_id AS modelId, model_name AS modelName, status,
           source_message_count AS sourceMessageCount, source_last_message_id AS sourceLastMessageId,
           result_json AS resultJson, error_text AS errorText, started_at AS startedAt, completed_at AS completedAt
    FROM ai_analysis_runs WHERE conversation_id=?
    ORDER BY COALESCE(NULLIF(completed_at,''), started_at) DESC LIMIT 1
  `).get(clean(sessionKey));
  const analysisPayload = latestRun ? parseJson(latestRun.resultJson, {}) || {} : {};
  const analysisReceipt = object(analysisPayload.analysisReceipt);
  const currentLastMessageId = clean(messages.at(-1)?.id);
  const currentInsight = personContext?.found ? (personContext.relationship?.current || insights) : insights;
  const committedAnalysisAvailable = Boolean(
    latestRun && latestRun.status === 'completed' && analysisReceipt.transactionCommitted === true
  );
  const committedAnalysisCurrent = Boolean(
    committedAnalysisAvailable && clean(latestRun.sourceLastMessageId) &&
    clean(latestRun.sourceLastMessageId) === currentLastMessageId
  );
  const legacyInsightStatus = clean(currentInsight?.status).toLowerCase();
  const legacyAnalyzedMessageId = clean(currentInsight?.analyzedThroughMessageId);
  const legacySourceCount = Number(currentInsight?.sourceMessageCount || 0);
  const legacyAnalysisAvailable = Boolean(
    !committedAnalysisAvailable &&
    relationshipProjectionAuthority.hasSubstantiveInsight(currentInsight) &&
    clean(currentInsight?.modelId || currentInsight?.model) &&
    ['ready', 'completed', 'success'].includes(legacyInsightStatus) &&
    (legacyAnalyzedMessageId || legacySourceCount > 0)
  );
  const legacyAnalysisCurrent = Boolean(
    legacyAnalysisAvailable &&
    (!legacyAnalyzedMessageId || legacyAnalyzedMessageId === currentLastMessageId) &&
    (!legacySourceCount || legacySourceCount >= messages.length)
  );
  const analysisAvailable = committedAnalysisAvailable || legacyAnalysisAvailable;
  const analysisIsCurrent = committedAnalysisCurrent || legacyAnalysisCurrent;
  const personSocial = object(personContext?.relationship?.currentSocialState);
  const projectionInput = {
    contactId: contact.id,
    conversationId: clean(sessionKey),
    canonicalContactId: personContext?.found ? personContext.personId : sourceScope.canonicalContactId,
    insight: currentInsight,
    messages,
    analysisCurrent: analysisIsCurrent,
    analysisEvidenceAvailable: analysisAvailable,
    analysisCommitted: committedAnalysisAvailable,
    analysisRunId: committedAnalysisAvailable ? clean(latestRun?.id) : '',
    social: {
      relationship: personSocial.relationship,
      emotion: personSocial.emotion,
      interaction: personSocial.interaction,
      strategy: personSocial.strategy,
      potential: personSocial.potential,
      version: Number(personSocial.version || 0),
      calculatedAt: clean(personSocial.calculated_at || personSocial.updated_at)
    },
    timeline: personContext?.timeline || [],
    signals: personContext?.relationship?.signals || [],
    sourceScope: personContext?.found
      ? { ...sourceScope, canonicalContactId: personContext.personId, personId: personContext.personId, contactIds: personContext.contactIds }
      : sourceScope
  };
  const relationshipProjection = personContext?.found
    ? relationshipProjectionAuthority.project(projectionInput)
    : relationshipProjectionAuthority.projectFromStore({ store, ...projectionInput });
  const customerProfileId = resolveCustomerProfileId(contact.id, store) || contact.id;
  const linkedIdentities = listLinkedIdentities(contact.id, store);
  const identitySummary = identitySummaryForContact(contact, personContext);
  const trajectory = object(relationshipProjection.trajectory);
  const baseProfile = personProfileView(personContext, profile);
  const profileSnapshotId = clean(baseProfile.authoritySnapshotId);
  const authoritySnapshotId = crypto.createHash('sha256').update(json({
    personId: clean(personContext?.personId),
    profileSnapshotId,
    relationship: {
      version: relationshipProjection.projectionVersion,
      state: relationshipProjection.state,
      source: relationshipProjection.source,
      metrics: [trajectory.temperature, trajectory.activity, trajectory.initiative, trajectory.depth, trajectory.opportunity, trajectory.risk]
    },
    analysisRunId: committedAnalysisAvailable ? clean(latestRun?.id) : '',
    analysisCurrent: analysisIsCurrent,
    analysisCommitted: committedAnalysisAvailable
  })).digest('hex');
  const mergedProfile = {
    ...baseProfile,
    authoritySnapshotId,
    temperature: Number(trajectory.temperature ?? baseProfile.temperature ?? 0),
    intimacyScore: Number(trajectory.temperature ?? baseProfile.intimacyScore ?? 0),
    openness: Number(trajectory.depth ?? baseProfile.openness ?? 0),
    risk: Number(trajectory.risk ?? baseProfile.risk ?? 0),
    activity: Number(trajectory.activity ?? baseProfile.activity ?? 0),
    stage: clean(trajectory.stage || baseProfile.stage),
    lifecycleStage: clean(trajectory.stage || baseProfile.lifecycleStage),
    next: clean(trajectory.next || baseProfile.next),
    nextAction: clean(trajectory.next || baseProfile.nextAction),
    relationshipSourceType: clean(relationshipProjection.source),
    relationshipProjectionState: clean(relationshipProjection.state)
  };
  const baseInsights = personInsightsView(personContext, insights);
  const mergedInsights = {
    ...baseInsights,
    authoritySnapshotId,
    sourceType: clean(relationshipProjection.source),
    projectionState: clean(relationshipProjection.state),
    analysisRunId: committedAnalysisAvailable ? clean(latestRun?.id) : '',
    analysisCurrent: analysisIsCurrent,
    analysisCommitted: committedAnalysisAvailable,
    analysisAuthority: committedAnalysisAvailable ? 'terminal-receipt' : legacyAnalysisAvailable ? 'legacy-model-insight' : 'none',
    summary: clean(trajectory.summary),
    stage: clean(trajectory.stage),
    relationshipStage: clean(trajectory.stage),
    intimacy: Number(trajectory.temperature || 0),
    intimacyScore: Number(trajectory.temperature || 0),
    initiative: Number(trajectory.initiative || 0),
    initiativeScore: Number(trajectory.initiative || 0),
    openness: Number(trajectory.depth || 0),
    opportunity: Number(trajectory.opportunity || 0),
    opportunityScore: Number(trajectory.opportunity || 0),
    risk: Number(trajectory.risk || 0),
    riskScore: Number(trajectory.risk || 0),
    next: clean(trajectory.next),
    nextAction: clean(trajectory.next),
    status: clean(relationshipProjection.state),
    evidence: analysisAvailable ? array(baseInsights.evidence) : [],
    modelId: analysisAvailable ? clean(baseInsights.modelId) : '',
    model: analysisAvailable ? clean(baseInsights.model) : '',
    factCount: Number(mergedProfile.factCount || 0),
    evidenceCount: Number(mergedProfile.evidenceCount || 0),
    relationshipEvidenceCount: Number(relationshipProjection.relationshipEvidenceCount || 0)
  };
  const authoritySnapshot = {
    authority: 'PersonProfileRelationshipAuthority',
    snapshotId: authoritySnapshotId,
    personId: clean(personContext?.personId),
    physicalContactId: contact.id,
    customerProfileId,
    factCount: Number(mergedProfile.factCount || 0),
    evidenceCount: Number(mergedProfile.evidenceCount || 0),
    profileHealth: Number(mergedProfile.health || 0),
    identity: identitySummary,
    relationship: {
      sourceType: clean(relationshipProjection.source),
      projectionState: clean(relationshipProjection.state),
      analysisRunId: committedAnalysisAvailable ? clean(latestRun?.id) : '',
      analysisCurrent: analysisIsCurrent,
      analysisCommitted: committedAnalysisAvailable,
      temperature: Number(trajectory.temperature || 0),
      openness: Number(trajectory.depth || 0),
      initiative: Number(trajectory.initiative || 0),
      opportunity: Number(trajectory.opportunity || 0),
      risk: Number(trajectory.risk || 0)
    },
    generatedAt: nowIso()
  };
  return {
    ok: true,
    generatedAt: authoritySnapshot.generatedAt,
    conversationId: clean(sessionKey),
    physicalContactId: contact.id,
    canonicalContactId: customerProfileId,
    customerProfileId,
    linkedIdentities,
    contact: {
      ...contact,
      canonicalContactId: customerProfileId,
      customerProfileId,
      profileExists: mergedProfile.exists === true,
      linkedIdentityCount: linkedIdentities.length,
      identityStatus: identitySummary.status,
      identityConfidence: identitySummary.confidence,
      identityConfirmed: identitySummary.verified,
      platformIdentity: identitySummary.externalId
    },
    identitySummary,
    authoritySnapshot,
    person: personContext?.found ? { personId: personContext.personId, contactIds: personContext.contactIds, conversationIds: personContext.conversationIds, identityLinks: personContext.identityLinks } : null,
    personContext,
    profile: mergedProfile,
    insights: mergedInsights,
    relationshipProjection: { ...relationshipProjection, snapshotId: authoritySnapshotId },
    analysis: analysisIsCurrent ? object(analysisPayload.analysis) : {},
    analysisReceipt: analysisIsCurrent ? analysisReceipt : {},
    latestRun: latestRun ? {
      ...latestRun,
      result: analysisPayload,
      receipt: analysisReceipt,
      current: analysisIsCurrent,
      stale: latestRun.status === 'completed' && !analysisIsCurrent,
      sourceLastMessageId: clean(latestRun.sourceLastMessageId),
      currentLastMessageId
    } : null,
    source: { persons: 'persons/person_contact_bindings/conversation_bindings', contacts: 'contacts', profiles: 'customer_profiles', insights: 'relationship_insights', messages: 'r32_messages' }
  };
}

function rowEvidenceIds(row = {}) {
  return factEvidenceMessageIds(row);
}

function evidenceReferencesAny(row = {}, messageIds = new Set()) {
  return rowEvidenceIds(row).some(id => messageIds.has(clean(id)));
}

function retractFactRows(rows = [], messageIds = new Set(), timestamp = nowIso()) {
  const affectedKeys = new Set();
  let affected = 0;
  const next = array(rows).map(raw => {
    const row = object(raw);
    const directAffected = evidenceReferencesAny(row, messageIds);
    const evidence = array(row.evidence);
    const remainingEvidence = evidence.filter(item => !evidenceReferencesAny(item, messageIds));
    const nestedAffected = remainingEvidence.length !== evidence.length;
    if (!directAffected && !nestedAffected) return row;
    affected += 1;
    const key = publicProfileFactKey(row.key || row.factKey || row.field);
    if (key) affectedKeys.add(key);
    if (remainingEvidence.length) {
      const replacement = object(remainingEvidence.at(-1));
      const replacementMessageId = clean(replacement.platformMessageId || replacement.messageId || replacement.sourceMessageId);
      return {
        ...row,
        ...(directAffected ? {
          sourceMessageId: replacementMessageId,
          platformMessageId: replacementMessageId,
          messageId: replacementMessageId,
          sourceText: clean(replacement.sourceText || replacement.text || row.sourceText),
          direction: clean(replacement.direction || row.direction),
          speaker: clean(replacement.speaker || replacement.role || row.speaker)
        } : {}),
        evidence: remainingEvidence,
        evidenceStatus: 'verified',
        lastVerifiedAt: clean(replacement.sentAt || replacement.timestamp || row.lastVerifiedAt),
        revision: Number(row.revision || 1) + 1
      };
    }
    return {
      ...row,
      status: 'forgotten',
      allowInReply: false,
      evidenceStatus: 'revoked',
      forgottenAt: timestamp,
      forgottenBy: 'source-message-revoked',
      revokedSourceMessageIds: [...messageIds],
      revision: Number(row.revision || 1) + 1
    };
  });
  return { rows: next, affected, affectedKeys };
}

function retractInterestRows(rows = [], messageIds = new Set(), timestamp = nowIso()) {
  let affected = 0;
  const next = array(rows).map(raw => {
    const row = typeof raw === 'string' ? { value: raw, text: raw } : object(raw);
    const sourceId = clean(row.sourceMessageId || row.platformMessageId || row.messageId);
    if (!sourceId || !messageIds.has(sourceId)) return raw;
    affected += 1;
    return {
      ...row,
      status: 'forgotten',
      allowInReply: false,
      evidenceStatus: 'revoked',
      forgottenAt: timestamp,
      forgottenBy: 'source-message-revoked',
      revision: Number(row.revision || 1) + 1
    };
  });
  return { rows: next, affected };
}

function retractMessageEvidence(sessionKey, ids = [], options = {}) {
  const store = options.store || getStore();
  const timestamp = clean(options.at) || nowIso();
  const messageIds = new Set(array(ids).map(clean).filter(Boolean));
  if (!messageIds.size) return { ok: true, retracted: false, reason: 'NO_MESSAGE_IDS' };
  const { conversation, contact } = resolveContactForConversation(sessionKey, store);
  const profileContactId = resolveCustomerProfileId(contact.id, store) || contact.id;
  const profileRow = store.db.prepare('SELECT * FROM customer_profiles WHERE contact_id=?').get(profileContactId);
  let profileFactsAffected = 0;
  let recurringInterestsAffected = 0;
  let evidenceRowsAffected = 0;
  let profileVersion = Number(profileRow?.profile_version || 0);

  if (profileRow) {
    const currentFacts = sanitizeProfileFacts(parseRowJson(profileRow, 'facts_json', {}));
    const confirmed = retractFactRows(parseRowJson(profileRow, 'confirmed_facts_json', []), messageIds, timestamp);
    const inferred = retractFactRows(parseRowJson(profileRow, 'inferred_facts_json', []), messageIds, timestamp);
    const payload = parseRowJson(profileRow, 'payload_json', {}) || {};
    const interests = retractInterestRows(payload.recurringInterests, messageIds, timestamp);
    const activeConfirmedKeys = new Set(confirmed.rows
      .filter(row => clean(row.status).toLowerCase() === 'confirmed' && row.allowInReply !== false && clean(row.evidenceStatus).toLowerCase() !== 'revoked')
      .map(row => publicProfileFactKey(row.key || row.factKey || row.field))
      .filter(Boolean));
    const facts = { ...currentFacts };
    for (const key of new Set([...confirmed.affectedKeys, ...inferred.affectedKeys])) {
      if (!activeConfirmedKeys.has(key)) delete facts[key];
    }
    if (clean(facts.country) && clean(facts.region)) facts.address = `${clean(facts.country)} · ${clean(facts.region)}`;
    else if ((confirmed.affectedKeys.has('country') || confirmed.affectedKeys.has('region')) && !activeConfirmedKeys.has('address')) delete facts.address;
    const pendingReview = object(payload.pendingReview);
    const pendingProfile = object(pendingReview.profile);
    const pendingConfirmed = retractFactRows(pendingProfile.confirmedFacts, messageIds, timestamp);
    const pendingInferred = retractFactRows(pendingProfile.inferredFacts, messageIds, timestamp);
    const pendingInvalidated = pendingConfirmed.affected > 0 || pendingInferred.affected > 0;
    const nextPayload = {
      ...payload,
      recurringInterests: interests.rows,
      evidenceRetraction: {
        reason: 'source-message-revoked',
        conversationId: clean(sessionKey),
        messageIds: [...messageIds],
        retractedAt: timestamp
      },
      ...(pendingInvalidated ? {
        pendingReview: {
          ...pendingReview,
          profile: { ...pendingProfile, confirmedFacts: pendingConfirmed.rows, inferredFacts: pendingInferred.rows },
          invalidatedAt: timestamp,
          invalidatedReason: 'source-message-revoked'
        }
      } : {})
    };
    profileFactsAffected = confirmed.affected + inferred.affected;
    recurringInterestsAffected = interests.affected;
    profileVersion += 1;
    store.db.prepare(`
      UPDATE customer_profiles SET facts_json=?, confirmed_facts_json=?, inferred_facts_json=?,
        review_status=?, profile_version=?, payload_json=?, updated_at=? WHERE contact_id=?
    `).run(
      json(facts), json(confirmed.rows), json(inferred.rows),
      pendingInvalidated ? 'manual' : clean(profileRow.review_status || 'manual'),
      profileVersion, json(nextPayload), timestamp, profileContactId
    );
  }

  const evidenceRows = store.db.prepare(`
    SELECT evidence_id, platform_message_id, payload_json FROM customer_profile_evidence
    WHERE conversation_id=?
  `).all(clean(sessionKey));
  const updateEvidence = store.db.prepare('UPDATE customer_profile_evidence SET payload_json=?, updated_at=? WHERE evidence_id=?');
  for (const row of evidenceRows) {
    const payload = parseJson(row.payload_json, {}) || {};
    const platformMessageId = clean(payload.platformMessageId || payload.messageId || payload.sourceMessageId);
    if (!messageIds.has(platformMessageId) && !messageIds.has(clean(row.platform_message_id))) continue;
    updateEvidence.run(json({
      ...payload,
      status: 'forgotten',
      allowInReply: false,
      evidenceStatus: 'revoked',
      revokedAt: timestamp,
      revokedBy: 'source-message-revoked'
    }), timestamp, row.evidence_id);
    evidenceRowsAffected += 1;
  }

  const insightRow = store.db.prepare('SELECT * FROM relationship_insights WHERE contact_id=?').get(contact.id);
  let insightsInvalidated = false;
  if (insightRow && clean(insightRow.conversation_id) === clean(sessionKey)) {
    const payload = parseRowJson(insightRow, 'payload_json', {}) || {};
    store.db.prepare(`
      UPDATE relationship_insights SET status='stale', payload_json=?, updated_at=? WHERE contact_id=?
    `).run(json({
      ...payload,
      staleReason: 'source-message-revoked',
      staleMessageIds: [...messageIds],
      staleAt: timestamp
    }), timestamp, contact.id);
    insightsInvalidated = true;
  }
  store.db.prepare(`
    UPDATE ai_analysis_runs SET status='superseded', error_text=?, completed_at=?
    WHERE conversation_id=? AND status='completed'
  `).run('AI_SOURCE_MESSAGE_REVOKED', timestamp, clean(sessionKey));

  const result = {
    ok: true,
    retracted: profileFactsAffected > 0 || recurringInterestsAffected > 0 || evidenceRowsAffected > 0 || insightsInvalidated,
    conversationId: clean(sessionKey),
    contactId: clean(contact.id),
    canonicalContactId: clean(profileContactId),
    messageIds: [...messageIds],
    profileFactsAffected,
    recurringInterestsAffected,
    evidenceRowsAffected,
    insightsInvalidated,
    profileVersion,
    retractedAt: timestamp
  };
  if (options.publish !== false) {
    eventBus.publish('workspace.message-evidence-retracted', result);
    if (profileRow) eventBus.publish('workspace.profile.updated', result);
    if (insightsInvalidated) eventBus.publish('workspace.insights.updated', result);
  }
  return result;
}

function saveProfileForConversation(sessionKey, value, store = getStore()) {
  const { contact } = resolveContactForConversation(sessionKey, store);
  const profile = upsertProfile(contact.id, value, { reviewStatus: 'manual' }, store);
  eventBus.publish('workspace.profile.updated', {
    conversationId: clean(sessionKey),
    contactId: clean(contact.id),
    canonicalContactId: clean(resolveCustomerProfileId(contact.id, store) || contact.id),
    profileVersion: Number(profile.version || 0),
    updatedAt: clean(profile.updated) || nowIso()
  });
  return profile;
}

function saveInsightsForConversation(sessionKey, value, store = getStore()) {
  const { contact } = resolveContactForConversation(sessionKey, store);
  const insights = upsertInsights(contact.id, sessionKey, value, { status: 'manual' }, store);
  eventBus.publish('workspace.insights.updated', {
    conversationId: clean(sessionKey),
    contactId: clean(contact.id),
    canonicalContactId: clean(resolveCustomerProfileId(contact.id, store) || contact.id),
    insightVersion: Number(insights.version || 0),
    updatedAt: clean(insights.updated) || nowIso()
  });
  return insights;
}

function migrateLegacyDocuments(store = getStore()) {
  const rows = store.db.prepare(`
    SELECT namespace, key, value_json FROM r32_settings
    WHERE namespace IN ('customer-profile','relationship-trajectory','conversation-analysis')
    ORDER BY namespace, key
  `).all();
  let profiles = 0;
  let insights = 0;
  store.transaction(() => {
    for (const row of rows) {
      const value = parseJson(row.value_json, {}) || {};
      let resolved;
      try { resolved = resolveContactForConversation(row.key, store); } catch (_) { continue; }
      if (row.namespace === 'customer-profile') {
        upsertProfile(resolved.contact.id, value, { reviewStatus: 'legacy-migrated' }, store);
        profiles += 1;
      } else {
        upsertInsights(resolved.contact.id, row.key, row.namespace === 'conversation-analysis' ? { ...value, rawAnalysis: value } : value, { status: 'legacy-migrated' }, store);
        insights += 1;
      }
    }
    if (rows.length) {
      store.db.prepare("DELETE FROM r32_settings WHERE namespace IN ('customer-profile','relationship-trajectory','conversation-analysis')").run();
    }
    store.setMeta('stage6RelationalMigrationComplete', { completedAt: nowIso(), rows: rows.length, profiles, insights });
  });
  return { migrated: rows.length > 0, rows: rows.length, profiles, insights };
}

module.exports = {
  analyzeConversation,
  persistDeterministicFactsForConversation,
  getContextByConversation,
  saveProfileForConversation,
  saveInsightsForConversation,
  resolveContactForConversation,
  resolveContactReference,
  resolveCanonicalContactId,
  resolveCustomerProfileId,
  resolvePersonProfileContext,
  findPersonScopedRow,
  materializePersonAnchorRow,
  listLinkedIdentities,
  associateCustomerProfiles,
  separateCustomerProfile,
  resolveMergedConversationKey,
  getContact,
  listContacts,
  getContactContext,
  getProfile,
  getInsights,
  upsertProfile,
  reviewPendingProfile,
  upsertInsights,
  setConversationArchived,
  setConversationPinned,
  latestMessages,
  retractMessageEvidence,
  migrateLegacyDocuments,
  profileView,
  insightView,
  sanitizeProfileFacts,
  sanitizeFactList,
  profileScalar
};
