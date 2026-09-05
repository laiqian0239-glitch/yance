'use strict';

const crypto = require('crypto');
const settingsRepository = require('../repositories/settingsRepository');
const messageStore = require('./messageStore');
const accountStore = require('./accountStore');
const accountManager = require('./accountManager');
const platformCapabilityAuthority = require('./platformCapabilityAuthority');
const modelStatus = require('./modelStatusService');
const { getTemplateCatalog, TEMPLATE_CATALOG_VERSION } = require('./aiWorkbenchDefaults');
const aiWorkbenchDirectorRuleAuthority = require('./aiWorkbenchDirectorRuleAuthority');
const workspaceData = require('./workspaceDataService');
const { mergeLocalized, chineseFirst } = require('./localizedContentAuthority');
const { buildSocialAnalysisPresentation } = require('./socialAnalysisPresentationService');
const { MAX_EXPORT_MESSAGES } = require('./chatExportService');

function summarizeWorkspaceLearningEvidence(contacts = []) {
  return {
    authority: 'Learning V4 evidence/proposal/evaluation',
    mode: 'immutable-signal-ledger',
    contactCount: Array.isArray(contacts) ? contacts.length : 0,
    automaticProfileMutation: false,
    automaticPromotion: false,
    reviewRequired: true,
    rawPrivateChatTraining: false
  };
}
function nowIso() { return new Date().toISOString(); }
function clean(value, fallback = '') { return value == null ? fallback : String(value).trim(); }
function parseJson(value, fallback = null) { try { return value ? JSON.parse(value) : fallback; } catch (_) { return fallback; } }
function stableColor(value) {
  const digest = crypto.createHash('sha1').update(clean(value, 'contact')).digest();
  const hue = digest[0] / 255 * 300 + 20;
  return `hsl(${Math.round(hue)} 48% 42%)`;
}
function relativeTime(value) {
  const at = new Date(value || 0).getTime();
  if (!Number.isFinite(at) || at <= 0) return '';
  const delta = Math.max(0, Date.now() - at);
  if (delta < 60000) return '刚刚';
  if (delta < 3600000) return `${Math.floor(delta / 60000)}分钟前`;
  if (delta < 86400000) return `${Math.floor(delta / 3600000)}小时前`;
  if (delta < 172800000) return '昨天';
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(new Date(at));
}
function emptyIdentity(contact = {}) {
  const stableId = contact.platformIdentity || contact.externalId || contact.chatJid || contact.sessionKey || contact.id || '';
  const status = clean(contact.identityStatus || (stableId ? 'observed' : 'pending')).toLowerCase();
  const observed = ['observed', 'verified', 'confirmed'].includes(status);
  return {
    platform: contact.platform || 'unknown',
    phone: contact.phone || '',
    stableId,
    source: contact.platform ? `${contact.platform}真实会话` : '真实会话',
    confidence: Number(contact.identityConfidence ?? (status === 'verified' || status === 'confirmed' ? 100 : observed ? 85 : 0)),
    pending: !observed,
    maintained: Boolean(contact.profileExists),
    bound: Boolean(contact.profileExists),
    identityStatus: status,
    identityConfirmed: status === 'verified' || status === 'confirmed',
    system: false,
    duplicate: false,
    ignored: false,
    note: ''
  };
}
function emptyProfile() {
  return {
    health: 0, temperature: 0, openness: 0, risk: 0, activity: 0,
    next: '等待真实互动与人工确认后生成建议。', updated: '',
    confirmed: [], inferences: [], commitments: [], boundaries: [], milestones: []
  };
}
function deriveTrajectory(messages = [], profile = {}) {
  const customer = messages.filter(row => !(row.fromMe === true || /outgoing|outbound/i.test(row.direction || '')));
  const owner = messages.length - customer.length;
  const total = messages.length;
  const last = messages.at(-1)?.timestamp || messages.at(-1)?.sentAt || '';
  const dayMap = new Map();
  for (const row of messages) {
    const date = new Date(row.timestamp || row.sentAt || 0);
    if (!Number.isFinite(date.getTime())) continue;
    const key = `${date.getMonth() + 1}/${date.getDate()}`;
    const item = dayMap.get(key) || { count: 0, customer: 0, owner: 0 };
    item.count += 1;
    if (row.fromMe === true || /outgoing|outbound/i.test(row.direction || '')) item.owner += 1;
    else item.customer += 1;
    dayMap.set(key, item);
  }
  const points = [...dayMap.entries()].slice(-12).map(([date, value]) => {
    const engagement = Math.min(100, Math.round(value.count * 8 + (value.customer ? 20 : 0)));
    const initiative = value.count ? Math.round(value.customer / value.count * 100) : 0;
    return [date, engagement, initiative, Math.max(0, 100 - engagement)];
  });
  const activity = Math.min(100, total * 3);
  const initiative = total ? Math.round(customer.length / total * 100) : 0;
  const stage = total >= 80 ? '持续互动' : total >= 30 ? '稳定联系' : total >= 8 ? '初步了解' : total ? '新会话' : '待建立';
  const events = messages.slice(-20).reverse().map(row => [
    relativeTime(row.timestamp || row.sentAt),
    row.fromMe ? '你发送了消息' : '收到消息',
    clean(row.text || `[${row.type || row.messageType || '消息'}]`, '').slice(0, 180),
    row.type || row.messageType || 'message',
    row.id || row.externalMessageId || ''
  ]);
  return {
    stage, momentum: total ? `+${Math.min(99, Math.max(1, Math.round(activity / 8)))}` : '0',
    initiative, reply: '', depth: Math.min(100, total * 2),
    opportunity: Number(profile.temperature || 0), risk: Number(profile.risk || 0),
    updated: relativeTime(last), points, events,
    next: profile.next || '等待真实互动与人工确认后生成建议。',
    opportunityText: '', riskText: '', ownerMessages: owner, customerMessages: customer.length
  };
}
function avatarFrom(...sources) {
  for (const source of sources) {
    if (!source) continue;
    for (const key of ['avatarUrl', 'avatar_url', 'avatar', 'photoUrl', 'photo_url']) {
      const value = source[key];
      if (value !== undefined && value !== null && clean(value)) return clean(value);
    }
  }
  return '';
}

function latestMessageSnippet(messages = []) {
  const latest = [...(Array.isArray(messages) ? messages : [])].reverse().find(message => {
    if (!message || /^(read|receipt|delivered|delivery|presence|typing|sync|metadata)$/i.test(clean(message.type || message.messageType))) return false;
    return Boolean(clean(message.text || message.caption || message.body || message.translatedZh || message.translationZh || message.chineseTranslation));
  });
  if (!latest) return {};
  const original = clean(latest.text || latest.caption || latest.body || latest.sourceText);
  const translatedZh = clean(latest.translatedZh || latest.translationZh || latest.translationZH || latest.chineseTranslation || latest.translation || latest.chinese);
  return {
    snippet: original || translatedZh,
    snippetOriginal: original,
    snippetZh: translatedZh,
    snippetTranslationStatus: clean(latest.translationStatus || (translatedZh ? 'success' : '')),
    snippetMessageId: clean(latest.id || latest.externalMessageId || latest.messageId),
    snippetMessageAt: clean(latest.timestamp || latest.sentAt || latest.createdAt || latest.updatedAt)
  };
}

function messageTimestamp(row = {}) {
  const value = row.timestamp || row.sentAt || row.createdAt || row.updatedAt || '';
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function personConversationIds(context = {}, fallbackId = '') {
  return [...new Set([
    ...(Array.isArray(context.person?.conversationIds) ? context.person.conversationIds : []),
    ...(Array.isArray(context.personContext?.conversationIds) ? context.personContext.conversationIds : []),
    context.conversationId,
    fallbackId
  ].map(clean).filter(Boolean))];
}

function messagesForPersonContext(context = {}, fallbackId = '', options = {}) {
  const requestedLimit = Number(options.limit || 5000);
  const limit = Math.max(1, Math.min(Number.isFinite(requestedLimit) ? Math.trunc(requestedLimit) : 5000, 5000));
  const loadMessages = options.listMessages
    || messageStore.listMessagesForExport
    || messageStore.listMessages;
  const rows = [];
  for (const conversationId of personConversationIds(context, fallbackId)) {
    for (const raw of loadMessages(conversationId, { limit })) {
      const row = raw || {};
      rows.push({
        ...row,
        conversationId: clean(row.conversationId || row.sessionKey, conversationId),
        sessionKey: clean(row.sessionKey || row.conversationId, conversationId)
      });
    }
  }
  const deduped = new Map();
  rows.forEach((row, index) => {
    const conversationId = clean(row.conversationId || row.sessionKey);
    const id = clean(row.id || row.messageId || row.externalMessageId);
    const key = id ? `${conversationId}\u0000${id}` : `${conversationId}\u0000anonymous-${index}`;
    if (!deduped.has(key)) deduped.set(key, row);
  });
  return [...deduped.values()]
    .sort((left, right) => messageTimestamp(left) - messageTimestamp(right)
      || clean(left.conversationId).localeCompare(clean(right.conversationId))
      || clean(left.id || left.messageId || left.externalMessageId).localeCompare(clean(right.id || right.messageId || right.externalMessageId)))
    .slice(-limit);
}

// Daily Conversation Review (Product Final) — truthful current-local-day review.
// Reuses the mature export/list-message authority with a cap+1 ceiling proof so
// that `coverageComplete:true` only when every canonical Person conversation has
// been proven fully scanned under the repository safety limit.
function localDayKey(timestamp, timeZone) {
  const value = clean(timestamp);
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(date);
    const get = type => (parts.find(part => part.type === type) || {}).value || '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch (_) { return ''; }
}

function messageIdentity(row = {}) {
  return clean(row.id || row.messageId || row.externalMessageId || row.sourceMessageId || row.platformMessageId);
}

function dailyReview(contactId, options = {}) {
  const requestedContactId = clean(contactId);
  const context = options.context || workspaceData.getContextByConversation(requestedContactId);
  const conversationIds = personConversationIds(context, requestedContactId);
  const timeZone = clean(options.timeZone) || 'Asia/Shanghai';
  const localDate = clean(options.localDate) || localDayKey(Date.now(), timeZone);
  const requestedCeiling = Number(options.ceiling);
  const ceiling = Math.min(MAX_EXPORT_MESSAGES, Math.max(1, Number.isFinite(requestedCeiling) ? Math.trunc(requestedCeiling) : MAX_EXPORT_MESSAGES));
  const listMessagesForExport = options.listMessagesForExport || messageStore.listMessagesForExport;

  let coverageComplete = true;
  const scanned = [];
  for (const conversationId of conversationIds) {
    const rows = listMessagesForExport(conversationId, { limit: ceiling + 1 });
    if (rows.length > ceiling) coverageComplete = false;
    for (const raw of rows.slice(0, ceiling)) {
      const row = raw || {};
      scanned.push({
        ...row,
        conversationId: clean(row.conversationId || row.sessionKey, conversationId),
        sessionKey: clean(row.sessionKey || row.conversationId, conversationId)
      });
    }
  }

  const dayMessages = scanned.filter(row => localDayKey(row.timestamp || row.sentAt || row.createdAt, timeZone) === localDate);
  const dayMessageIds = new Set(dayMessages.map(messageIdentity).filter(Boolean));

  const analysisPresentation = buildSocialAnalysisPresentation({
    profile: context.profile || {},
    insights: context.insights || {},
    analysis: context.analysis || {},
    messages: dayMessages,
    scope: (context.insights && context.insights.sourceScope) || {}
  });

  const resolvesToDay = row => {
    const id = clean((row && (row.messageId || row.sourceMessageId || row.platformMessageId)) || '');
    return Boolean(id) && dayMessageIds.has(id);
  };

  // Correction B: problems/nextActions/successes are fail-closed. Each lane may
  // contain only an already-existing mature analysis/signal row that resolves to
  // a real message ID inside the selected local day. No content:digest fallback.
  const problems = (analysisPresentation.risks || []).filter(resolvesToDay);
  const nextActions = (analysisPresentation.recommendations || []).filter(resolvesToDay);
  const successes = [
    ...(analysisPresentation.milestones || []).filter(row => resolvesToDay(row)
      && (row.completed === true || row.userConfirmed === true || row.status === 'observed' || row.status === 'completed')),
    ...(analysisPresentation.commitments || []).filter(row => resolvesToDay(row) && row.completed === true)
  ];

  return {
    ok: true,
    contactId: requestedContactId,
    personId: clean((context.person && context.person.personId) || (context.personContext && context.personContext.personId)),
    localDate,
    timeZone,
    coverageComplete,
    conversationIds,
    scannedMessageCount: scanned.length,
    dayMessageCount: dayMessages.length,
    messages: dayMessages.map(row => ({
      id: messageIdentity(row),
      conversationId: clean(row.conversationId),
      direction: clean(row.direction || row.role),
      text: clean(row.text || row.caption || row.body).slice(0, 2000),
      sentAt: clean(row.sentAt || row.timestamp || row.createdAt)
    })),
    problems,
    successes,
    nextActions,
    generatedAt: nowIso()
  };
}

function contactFromConversation(row) {
  const payload = row.payload || row;
  const sessionKey = clean(row.sessionKey || row.conversationId || row.id);
  const platform = clean(row.platform || payload.platform, 'whatsapp').toLowerCase();
  const candidateName = clean(row.title || row.contactName || payload.displayName || payload.name);
  const rawIdentity = clean(payload.chatJid || payload.remoteJid || payload.externalId || sessionKey);
  const rawIdentityVisible = /@(?:lid|s\.whatsapp\.net|c\.us|g\.us)$/i.test(candidateName) || /^\d+:\d+@/i.test(candidateName);
  const phone = platform === 'whatsapp' ? String(rawIdentity).split('@')[0].replace(/:\d+$/, '').replace(/\D/g, '') : '';
  const platformFallback = { whatsapp: 'WhatsApp 联系人', telegram: 'Telegram 联系人', facebook: 'Facebook 联系人' }[platform] || '联系人';
  const fallbackName = phone.length >= 7 ? `+${phone}` : platformFallback;
  const name = !candidateName || rawIdentityVisible ? fallbackName : candidateName;
  const tags = [platform, payload.routeState || row.routeState].filter(Boolean);
  const avatarUrl = avatarFrom(row, payload);
  const presenceState = clean(payload.presenceState || payload.presence).toLowerCase();
  const online = payload.online === true || ['online', 'available'].includes(presenceState);
  const lastSeenAt = clean(payload.lastSeenAt || payload.last_seen_at || payload.lastSeen);
  const lastSeenPrecision = clean(payload.lastSeenPrecision || payload.last_seen_precision);
  const presenceSupport = platformCapabilityAuthority.definitionsForPlatform(platform).find(row => row.capabilityId === 'presence.contact.receive')?.support || 'unknown';
  const recentActivity = relativeTime(row.lastMessageAt || row.updatedAt);
  return {
    id: sessionKey,
    sessionKey,
    conversationId: sessionKey,
    accountId: clean(row.accountId || payload.accountId),
    contactId: clean(row.contactId || payload.contactId),
    externalId: clean(payload.externalId || payload.chatJid || payload.remoteJid),
    chatJid: clean(payload.chatJid || payload.remoteJid || payload.externalId),
    platform,
    name,
    online,
    presence: online ? 'available' : (presenceState || 'unknown'),
    presenceState: online ? 'online' : (presenceState === 'unavailable' ? 'offline' : presenceState),
    presenceSupport,
    lastSeenAt,
    last_seen_at: lastSeenAt,
    lastSeenPrecision,
    last_seen_precision: lastSeenPrecision,
    last: online ? '在线' : (lastSeenAt ? `最后上线 ${relativeTime(lastSeenAt)}` : (presenceSupport === 'unsupported' ? recentActivity : (recentActivity || '状态未知'))),
    time: recentActivity,
    snippet: clean(row.lastMessage || row.lastText || payload.lastMessage),
    tags,
    unread: Number(row.unreadCount ?? row.unread ?? 0),
    vip: Boolean(payload.vip || payload.highIntent),
    pinned: payload.pinned === true,
    pinnedAt: clean(payload.pinnedAt),
    pinnedBy: clean(payload.pinnedBy),
    archived: Boolean(row.archived || payload.archived),
    archivedAt: clean(row.archivedAt || payload.archivedAt),
    archiveReason: clean(row.archiveReason || payload.archiveReason),
    archivedBy: clean(row.archivedBy || payload.archivedBy),
    color: stableColor(sessionKey),
    avatarUrl,
    avatar_url: avatarUrl,
    avatar: avatarUrl,
    photo_url: avatarUrl,
    age: '', birthday: '', address: '', city: '', country: '', job: '', languages: '', family: '', stage: '', interests: '', note: ''
  };
}
function getDocument(namespace, key, fallback) {
  return settingsRepository.get(namespace, key, fallback);
}
function setDocument(namespace, key, value) {
  settingsRepository.set(namespace, key, value);
  return value;
}
function mergeProfileIntoContact(contact, profileDocument = {}) {
  const localizedProfile = chineseFirst(profileDocument);
  const facts = localizedProfile.facts || localizedProfile.contact || {};
  return {
    ...contact,
    age: clean(facts.age || contact.age), birthday: clean(facts.birthday || contact.birthday),
    address: clean(facts.address || contact.address), city: clean(facts.city || contact.city), country: clean(facts.country || contact.country),
    job: clean(facts.job || facts.occupation || contact.job), languages: clean(facts.languages || contact.languages),
    family: clean(facts.family || contact.family), stage: clean(facts.stage || contact.stage), interests: clean(facts.interests || contact.interests),
    note: clean(localizedProfile.note || facts.note || contact.note)
  };
}
function trajectoryFromInsight(insight = {}, messages = [], profile = {}, analysis = {}, relationshipProjection = {}) {
  const derived = deriveTrajectory(messages, profile);
  const localizedInsight = chineseFirst(insight);
  const evidence = Array.isArray(localizedInsight.evidence) ? localizedInsight.evidence : [];
  const dimensions = localizedInsight.dimensions || {};
  const analysisLayers = buildSocialAnalysisPresentation({ profile, insights: insight, analysis, messages, scope: insight.sourceScope || insight.payload?.sourceScope || {} });
  const authorityTrajectory = relationshipProjection && relationshipProjection.authorityId === 'RelationshipProjectionAuthority'
    ? (relationshipProjection.trajectory || {})
    : {};
  return {
    ...derived,
    summary: localizedInsight.summary || '',
    stage: localizedInsight.relationshipStage || localizedInsight.stage || derived.stage,
    initiative: Number(localizedInsight.initiativeScore ?? localizedInsight.initiative ?? dimensions.initiative ?? derived.initiative) || 0,
    depth: Number(dimensions.depth ?? derived.depth) || 0,
    opportunity: Number(localizedInsight.opportunityScore ?? localizedInsight.opportunity ?? derived.opportunity) || 0,
    risk: Number(localizedInsight.riskScore ?? localizedInsight.risk ?? derived.risk) || 0,
    next: localizedInsight.nextAction || localizedInsight.next || derived.next,
    opportunityText: localizedInsight.summary || derived.opportunityText,
    riskText: localizedInsight.hiddenNeed || derived.riskText,
    evidence: evidence.map(item => Array.isArray(item) ? item : [clean(item.quote || item.text), clean(item.label || item.claim || item.source), clean(item.source || '真实消息'), Number(item.confidence || 0)]),
    events: Array.isArray(localizedInsight.events) && localizedInsight.events.length ? localizedInsight.events : derived.events,
    points: Array.isArray(localizedInsight.points) && localizedInsight.points.length ? localizedInsight.points : derived.points,
    topics: Array.isArray(localizedInsight.topics) ? localizedInsight.topics : [],
    reply: localizedInsight.reply || derived.reply,
    momentum: localizedInsight.momentum || derived.momentum,
    opportunityText: localizedInsight.opportunityText || localizedInsight.summary || derived.opportunityText,
    riskText: localizedInsight.riskText || localizedInsight.hiddenNeed || derived.riskText,
    updated: relativeTime(localizedInsight.updatedAt || localizedInsight.updated) || derived.updated,
    sourceMessageCount: Number(localizedInsight.sourceMessageCount || messages.length),
    analyzedThroughMessageId: localizedInsight.analyzedThroughMessageId || '',
    analysisLayers,
    bilingualPresentation: analysisLayers.relationship,
    ...authorityTrajectory,
    relationshipProjection: relationshipProjection && relationshipProjection.authorityId === 'RelationshipProjectionAuthority'
      ? relationshipProjection
      : null
  };
}
function capabilityProjectionForContact(contact, accountState) {
  const platform = clean(contact.platform).toLowerCase();
  const accountId = clean(contact.accountId);
  const projection = platformCapabilityAuthority.evaluate(accountState, { platform, accountId });
  const account = projection.platforms?.[platform]?.accounts?.find(row => row.accountId === accountId)
    || projection.platforms?.[platform]?.accounts?.[0]
    || null;
  const contracts = Object.fromEntries((account?.capabilities || []).map(row => [row.capabilityId, row]));
  const capabilities = {};
  for (const row of account?.capabilities || []) {
    const legacy = row.legacyId || platformCapabilityAuthority.CANONICAL_TO_LEGACY?.[row.capabilityId];
    if (legacy) capabilities[legacy] = row.enabled === true;
  }
  const platformDefinition = (projection.platforms?.[platform]?.definitions || []).find(row => row.capabilityId === 'presence.contact.receive') || null;
  const presence = contracts['presence.contact.receive'] || platformDefinition;
  return {
    capabilities,
    capabilityContracts: contracts,
    capabilityAuthority: {
      authority: platformCapabilityAuthority.AUTHORITY,
      platform,
      accountId,
      accountAvailability: account?.availability || 'not-configured',
      generatedAt: projection.generatedAt
    },
    presenceSupport: presence?.support || 'unknown',
    presenceAvailability: presence?.availability || 'unknown',
    presenceReasonCode: presence?.reasonCode || ''
  };
}

function bootstrap({ conversationLimit = 250, conversationOffset = 0, messageLimit = 120 } = {}) {
  const normalizedConversationLimit = Math.min(2000, Math.max(1, Number(conversationLimit) || 250));
  const normalizedConversationOffset = Math.max(0, Number(conversationOffset) || 0);
  const conversationRows = messageStore.listConversations({
    limit: normalizedConversationLimit + 1,
    offset: normalizedConversationOffset
  });
  const hasMoreConversations = conversationRows.length > normalizedConversationLimit;
  const conversations = conversationRows.slice(0, normalizedConversationLimit);
  const accountState = accountManager.list();
  const contacts = [];
  const identityState = {};
  const profileState = {};
  const trajectoryState = {};
  const histories = {};
  const drafts = {};
  for (const conversation of conversations) {
    const baseContact = contactFromConversation(conversation);
    const context = workspaceData.getContextByConversation(baseContact.id);
    const profileDocument = context.profile || emptyProfile();
    const contact = {
      ...mergeProfileIntoContact(baseContact, profileDocument),
      contactId: context.contact?.id || baseContact.contactId,
      canonicalContactId: context.customerProfileId || context.contact?.canonicalContactId || context.contact?.id || baseContact.contactId,
      customerProfileId: context.customerProfileId || context.contact?.customerProfileId || context.contact?.id || baseContact.contactId,
      linkedIdentities: context.linkedIdentities || [],
      linkedIdentityCount: Number(context.contact?.linkedIdentityCount || context.linkedIdentities?.length || 0),
      profileExists: context.profile?.exists === true,
      identityStatus: context.identitySummary?.status || context.contact?.identityStatus || '',
      identityConfidence: Number(context.identitySummary?.confidence ?? context.contact?.identityConfidence ?? 0),
      identityConfirmed: context.identitySummary?.verified === true || context.contact?.identityConfirmed === true,
      platformIdentity: context.contact?.platformIdentity || context.contact?.externalId || baseContact.externalId || baseContact.chatJid || '',
      phone: context.contact?.phone || '',
      avatarUrl: context.contact?.avatarUrl || baseContact.avatarUrl,
      avatar_url: context.contact?.avatarUrl || baseContact.avatarUrl,
      avatar: context.contact?.avatarUrl || baseContact.avatarUrl,
      photo_url: context.contact?.avatarUrl || baseContact.avatarUrl,
      ...capabilityProjectionForContact(baseContact, accountState),
      personId: context.person?.personId || context.personContext?.personId || '',
      canonicalPersonId: context.person?.personId || context.personContext?.personId || ''
    };
    if (contact.presenceSupport === 'unsupported') contact.last = relativeTime(conversation.lastMessageAt || conversation.updatedAt) || '平台不支持在线状态';
    else if (contact.presenceAvailability === 'blocked') contact.last = contact.presenceReasonCode || '在线状态当前不可用';
    const messages = messageStore.listMessages(baseContact.id, { limit: messageLimit });
    Object.assign(contact, latestMessageSnippet(messages));
    contacts.push(contact);
    const persistedIdentity = getDocument('contact-identity', contact.id, {});
    identityState[contact.id] = {
      ...emptyIdentity(contact),
      ...persistedIdentity,
      phone: contact.phone || persistedIdentity.phone || '',
      stableId: contact.platformIdentity || persistedIdentity.stableId || contact.externalId || contact.chatJid || contact.id || '',
      confidence: Number(contact.identityConfidence || persistedIdentity.confidence || 0),
      pending: !['observed', 'verified', 'confirmed'].includes(clean(contact.identityStatus).toLowerCase()),
      bound: contact.profileExists === true,
      maintained: contact.profileExists === true || persistedIdentity.maintained === true,
      identityStatus: contact.identityStatus || persistedIdentity.identityStatus || 'pending',
      identityConfirmed: contact.identityConfirmed === true
    };
    const analysisPresentation = buildSocialAnalysisPresentation({ profile: profileDocument, insights: context.insights || {}, analysis: context.analysis || {}, messages, scope: context.insights?.sourceScope || {} });
    profileState[contact.id] = {
      ...emptyProfile(),
      ...chineseFirst(profileDocument),
      analysisPresentation,
      translationAuthority: {
        originalIsAuthoritative: true,
        chineseIsPresentationLayer: true,
        pendingTranslationMustBeVisible: true
      }
    };
    trajectoryState[contact.id] = trajectoryFromInsight(context.insights || {}, messages, profileDocument, context.analysis || {}, context.relationshipProjection || {});
    histories[contact.id] = messages;
    const draftDocument = getDocument('conversation-drafts', contact.id, null);
    if (draftDocument) drafts[contact.id] = typeof draftDocument === 'string' ? draftDocument : clean(draftDocument.text);
  }
  return {
    ok: true,
    generatedAt: nowIso(),
    contacts,
    contactDirectory: workspaceData.listContacts({ limit: Math.max(normalizedConversationLimit, 500) }),
    conversations,
    pagination: {
      conversationOffset: normalizedConversationOffset,
      conversationLimit: normalizedConversationLimit,
      returned: conversations.length,
      nextOffset: normalizedConversationOffset + conversations.length,
      hasMore: hasMoreConversations
    },
    histories,
    drafts,
    identityState,
    profileState,
    trajectoryState,
    aiAssets: {
      ...aiWorkbenchDirectorRuleAuthority.ensureDefaults().state,
      templateCatalog: getTemplateCatalog(),
      templateCatalogVersion: TEMPLATE_CATALOG_VERSION,
      learningGovernance: summarizeWorkspaceLearningEvidence(contacts)
    },
    analyses: Object.fromEntries(contacts.map(contact => { const context = workspaceData.getContextByConversation(contact.id); return [contact.id, context.analysis || null]; }).filter(([, value]) => value)),
    models: modelStatus.read(),
    accounts: accountManager.list().accounts,
    capabilityMatrix: accountManager.CAPABILITY_MATRIX
  };
}
function saveIdentity(contactId, value) { return setDocument('contact-identity', clean(contactId), { ...value, updatedAt: nowIso() }); }
function saveProfile(contactId, value) { return workspaceData.saveProfileForConversation(clean(contactId), value); }
function saveTrajectory(contactId, value) { return workspaceData.saveInsightsForConversation(clean(contactId), value); }
function saveAiAssets(value) {
  const { templateCatalog: _catalog, templateCatalogVersion: _catalogVersion, ...persisted } = value || {};
  const current = aiWorkbenchDirectorRuleAuthority.ensureDefaults().state;
  const normalized = aiWorkbenchDirectorRuleAuthority.normalizeState({
    ...current,
    ...persisted,
    directorDefaults: current.directorDefaults
  });
  return setDocument('ai-workbench', 'state', { ...normalized, updatedAt: nowIso() });
}
function saveAnalysis(contactId, value) { return workspaceData.saveInsightsForConversation(clean(contactId), { ...value, rawAnalysis: value }); }
function getAnalysis(contactId) { return workspaceData.getContextByConversation(clean(contactId)).analysis || null; }
function insights(contactId) {
  const requestedContactId = clean(contactId);
  const context = workspaceData.getContextByConversation(requestedContactId);
  const messages = messagesForPersonContext(context, requestedContactId, { limit: 5000 });
  return {
    ok: true,
    contactId: requestedContactId,
    physicalContactId: context.physicalContactId || context.contact?.id || '',
    personId: context.person?.personId || context.personContext?.personId || '',
    contactIds: context.person?.contactIds || context.personContext?.contactIds || [context.contact?.id].filter(Boolean),
    conversationIds: personConversationIds(context, requestedContactId),
    contact: context.contact,
    profile: context.profile,
    insights: context.insights,
    analysis: context.analysis,
    trajectory: trajectoryFromInsight(context.insights, messages, context.profile, context.analysis, context.relationshipProjection || {}),
    analysisPresentation: buildSocialAnalysisPresentation({ profile: context.profile, insights: context.insights, analysis: context.analysis, messages, scope: context.insights?.sourceScope || {} }),
    messageCount: messages.length,
    generatedAt: nowIso(),
    source: context.source
  };
}
function initializeDataPipelines() { return workspaceData.migrateLegacyDocuments(); }

module.exports = {
  bootstrap, saveIdentity, saveProfile, saveTrajectory, saveAiAssets, saveAnalysis, getAnalysis, insights,
  initializeDataPipelines, trajectoryFromInsight, mergeLocalized, chineseFirst, buildSocialAnalysisPresentation,
  emptyIdentity, emptyProfile, deriveTrajectory, contactFromConversation, latestMessageSnippet,
  personConversationIds, messagesForPersonContext, dailyReview, localDayKey, messageIdentity
};
