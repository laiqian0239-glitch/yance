'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { PATHS } = require('../config');
const { normalizeIncoming, timestampIso } = require('./messageNormalizer');
const messageStore = require('./messageStore');
const mediaPipeline = require('./mediaPipeline');
const whatsappHistoryMediaRecovery = require('./whatsappHistoryMediaRecovery');
const { reconstructBaileysMessageInfo, hasMediaEnvelope } = require('./whatsappMediaEnvelope');
const eventBus = require('./eventBus');
const logger = require('./logger');
const notificationPolicy = require('./notificationPolicy');
const avatarService = require('./avatarService');
const accountStore = require('./accountStore');
const settingsRepository = require('../repositories/settingsRepository');
const whatsappVersionDiscoveryAuthority = require('./whatsappVersionDiscoveryAuthority');
const { resolveStableAccountKey, resolveAuthLocation } = require('./whatsappAuthResolver');
const accountLifecycle = require('./accountLifecycle');
const canonicalIdentity = require('./canonicalIdentityService');
const { safeDisplayName, normalizeJid, normalizePhone } = require('./whatsappIdentity');
const whatsappIdentityAuthority = require('./whatsappIdentityAuthority');
const whatsappConversationMerge = require('./whatsappConversationMergeService');
const whatsappAccountReconciliation = require('./whatsappAccountReconciliationService');
const syncCheckpoint = require('./syncCheckpointService');
const authChallenges = require('./authChallengeService');
const { getBackendReleaseIdentity } = require('../releaseIdentity');
const releaseSource = require('../../release/release-source.json');
const { getStore } = require('../repositories/storeProvider');
const { createSessionGenerationFence, createSocketGenerationGuard } = require('./sessionGenerationFence');
const { validatePersistedEgressContext } = require('./platformAdapterPorts');

let qrCodeRenderer = null;
function loadQRCodeDependency(moduleLoader = require) {
  try {
    const dependency = moduleLoader('qrcode');
    if (!dependency || typeof dependency.toDataURL !== 'function') {
      throw Object.assign(new Error('qrcode 模块缺少 toDataURL'), { code: 'WHATSAPP_QR_RENDERER_INVALID' });
    }
    return dependency;
  } catch (error) {
    const wrapped = new Error(`WhatsApp 二维码渲染组件不可用：${error.message || error}`);
    wrapped.code = error.code === 'WHATSAPP_QR_RENDERER_INVALID' ? error.code : 'WHATSAPP_QR_RENDERER_MISSING';
    wrapped.cause = error;
    throw wrapped;
  }
}
function getQRCodeRenderer() {
  if (!qrCodeRenderer) qrCodeRenderer = loadQRCodeDependency();
  return qrCodeRenderer;
}
const { stableId } = require('../lib/r32SqliteStore');


const WHATSAPP_VERSION_DISCOVERY_TIMEOUT_MS = 5000;
const WHATSAPP_QR_STARTUP_TIMEOUT_MS = 30000;


function operationAbortError(signal, fallbackCode = 'WHATSAPP_OPERATION_ABORTED', details = {}) {
  const reason = signal?.reason instanceof Error
    ? signal.reason
    : Object.assign(new Error('WhatsApp operation aborted'), { code: fallbackCode });
  if (!reason.code) reason.code = fallbackCode;
  return Object.assign(reason, details);
}
function assertOperationActive(signal, fallbackCode = 'WHATSAPP_OPERATION_ABORTED', details = {}) {
  if (signal?.aborted) throw operationAbortError(signal, fallbackCode, details);
}

function structuredWhatsAppEgressError(message, code, status, details = {}) {
  return Object.assign(new Error(message), { code, status, ...details });
}

function normalizeWhatsAppProviderEgressError(error, { accountId = '', operation = '', signal = null } = {}) {
  const metadata = {
    platform: 'whatsapp',
    accountId: String(accountId || '').trim(),
    operation: String(operation || '').trim(),
    outcomeUnknown: true,
    automaticRetryBlocked: true
  };
  if (signal?.aborted) return operationAbortError(signal, 'WHATSAPP_EGRESS_ABORTED', metadata);
  const causeMessage = String(error?.message || error || 'unknown provider rejection')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 240);
  return Object.assign(new Error('WhatsApp provider egress failed with uncertain outcome'), {
    code: 'WHATSAPP_EGRESS_PROVIDER_REJECTED',
    status: 502,
    ...metadata,
    causeMessage: causeMessage || 'unknown provider rejection'
  });
}

async function performWhatsAppProviderEgress(invoke, context = {}) {
  try {
    return await invoke();
  } catch (error) {
    throw normalizeWhatsAppProviderEgressError(error, context);
  }
}

function requirePersistedWhatsAppOperation(value, { accountId = '', operation = '' } = {}) {
  const fail = (message, details = {}) => {
    throw Object.assign(new Error(message), {
      code: 'WHATSAPP_PERSISTED_OPERATION_REQUIRED',
      status: 409,
      operation: String(operation || '').trim(),
      ...details
    });
  };
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.isFrozen(value)) {
    fail('WhatsApp physical operation requires one frozen persisted WP-B operation context.');
  }
  if (String(value.state || '').trim().toUpperCase() !== 'RUNNING') {
    fail('WhatsApp physical operation requires a RUNNING persisted WP-B operation context.', { field: 'state' });
  }
  for (const field of ['operationId', 'executionId', 'operationType', 'operationKind', 'scopeKey', 'objectFingerprint', 'ownerId', 'claimId']) {
    if (!String(value[field] == null ? '' : value[field]).trim()) {
      fail('WhatsApp persisted operation identity is incomplete.', { field });
    }
  }
  for (const field of ['generation', 'hostGeneration', 'fencingToken']) {
    const number = Number(value[field]);
    if (!Number.isSafeInteger(number) || number < 1) {
      fail('WhatsApp persisted operation fencing identity is invalid.', { field });
    }
  }
  const platform = String(value.platform || '').trim().toLowerCase();
  if (platform !== 'whatsapp') {
    fail('WhatsApp persisted operation platform scope mismatch.', { field: 'platform' });
  }
  const expectedAccountId = String(accountId || '').trim();
  if (expectedAccountId && String(value.accountId || '').trim() !== expectedAccountId) {
    fail('WhatsApp persisted operation account scope mismatch.', { field: 'accountId' });
  }
  return value;
}

async function discoverBaileysVersion(baileys, timeoutMs = WHATSAPP_VERSION_DISCOVERY_TIMEOUT_MS) {
  let timer;
  const timeout = new Promise(resolve => {
    timer = setTimeout(() => resolve({ version: null, isLatest: false, timedOut: true }), Math.max(10, Number(timeoutMs || WHATSAPP_VERSION_DISCOVERY_TIMEOUT_MS)));
  });
  try {
    const result = await Promise.race([
      Promise.resolve().then(() => baileys.fetchLatestBaileysVersion()),
      timeout
    ]);
    return {
      version: Array.isArray(result?.version) ? result.version : null,
      isLatest: result?.isLatest === true,
      timedOut: result?.timedOut === true,
      error: result?.error || null
    };
  } catch (error) {
    return { version: null, isLatest: false, timedOut: false, error };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function clearStartupWatchdog(row) {
  if (row?.startupTimer) clearTimeout(row.startupTimer);
  if (row) row.startupTimer = null;
}


function whatsappBrowserIdentity() {
  let productName = String(releaseSource.publicProductName || releaseSource.productName || '言策');
  let productVersion = String(releaseSource.publicVersion || releaseSource.productVersion || '0.0.0');
  try {
    const identity = getBackendReleaseIdentity();
    productName = String(identity.publicProductName || identity.productName || productName);
    productVersion = String(identity.publicVersion || identity.productVersion || productVersion);
  } catch (error) {
    logger.warn('whatsapp', 'release-identity-read-failed', { operation: 'whatsappBrowserIdentity', reasonCode: error.code || 'WHATSAPP_RELEASE_IDENTITY_READ_FAILED', httpStatus: Number(error.status || 0), attempt: 1, nextRetryAt: '' });
  }
  return [productName, 'Desktop', productVersion];
}

function normalizeWhatsAppIdentity(value) {
  const raw = String(value == null ? '' : value).trim().toLowerCase();
  const [local, domain = ''] = raw.split('@');
  return `${local.replace(/:\d+$/, '')}@${domain}`;
}


function shouldSkipDuplicateReceipt({ claim = {}, message = {}, accountId = '', hasExternalMessage = messageStore.hasExternalMessage, getExternalMessage = messageStore.getExternalMessage } = {}) {
  if (claim.duplicate !== true) return false;
  if (['reaction', 'revoke'].includes(String(message.type || '').toLowerCase())) return false;
  const targetId = String(message.externalMessageId || message.id || '').trim();
  if (!targetId || typeof hasExternalMessage !== 'function') return false;
  const lookup = { accountId, chatJid: String(message.chatJid || '').trim(), targetId };
  const existing = typeof getExternalMessage === 'function' ? getExternalMessage(lookup) : null;
  // A companion-device echo can arrive first as an unknown wrapper and then as
  // the real audio/image payload. Never let the placeholder block that upgrade.
  const existingType = String(existing?.type || existing?.messageType || '').toLowerCase();
  const incomingType = String(message.type || message.messageType || '').toLowerCase();
  if (existing && ['unknown', 'protocol', ''].includes(existingType) && !['unknown', 'protocol', ''].includes(incomingType)) return false;
  return hasExternalMessage(lookup) === true;
}


function historyJid(value) {
  return whatsappIdentityAuthority.normalizeJid(value);
}
function phoneJidToken(value) {
  const classified = whatsappIdentityAuthority.classifyJid(value);
  return classified.valid && classified.kind === 'phone-jid' ? normalizePhone(classified.normalized) : '';
}

function isWeakWhatsAppName(value, jid = '') {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return true;
  if (/@(?:s\.whatsapp\.net|c\.us|lid|g\.us)$/i.test(text) || /^\d+:\d+@/i.test(text)) return true;
  if (/^(?:whatsapp(?: 联系人| 群聊| 账号)?|未知联系人|联系人|me|myself|self|我|自己|本账号|当前账号)$/i.test(text)) return true;
  const compact = text.replace(/[\s()+-]/g, '');
  if (/^\d{7,}$/.test(compact)) return true;
  const phone = normalizePhone(jid);
  return Boolean(phone && compact === phone);
}

function whatsappJidCandidates(row = {}) {
  const values = [row.remoteJidAlt, row.senderPn, row.pn, row.phoneNumber, row.phone, row.jid, row.id, row.remoteJid, row.participant, row.lid, row.senderLid];
  if (Array.isArray(row.aliases)) values.push(...row.aliases);
  const result = [];
  for (const value of values) {
    const jid = historyJid(value);
    if (jid && !result.includes(jid)) result.push(jid);
  }
  return result;
}

function bestWhatsAppDisplayName(values = [], jid = '') {
  for (const value of values) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!isWeakWhatsAppName(text, jid)) return text.slice(0, 160);
  }
  if (jid.endsWith('@g.us')) return 'WhatsApp 群聊';
  const phone = normalizePhone(jid);
  if (phone) return `+${phone}`;
  return 'WhatsApp 联系人';
}

function historyDisplayName(row = {}, jid = '') {
  return bestWhatsAppDisplayName([
    row.name, row.notify, row.verifiedBizName, row.verifiedName, row.businessName,
    row.fullName, row.shortName, row.subject, row.displayName, row.pushName
  ], jid);
}

function canonicalWhatsAppTarget(databaseAccountId, chatJid, sessionKey = '') {
  const key = String(sessionKey || '').trim();
  const prefix = `${databaseAccountId}:`;
  const sessionJid = key.startsWith(prefix) ? key.slice(prefix.length) : '';
  const aliases = [chatJid, sessionJid].map(whatsappIdentityAuthority.normalizeJid).filter(Boolean);
  const resolved = whatsappIdentityAuthority.resolve(databaseAccountId, aliases);
  const canonicalJid = whatsappIdentityAuthority.chooseCanonical([...(resolved?.aliases || []), ...aliases], resolved?.canonicalJid || chatJid);
  if (!canonicalJid) {
    const error = new Error('WhatsApp 发送目标身份无效，已阻止发送');
    error.code = 'WHATSAPP_SEND_TARGET_INVALID';
    error.status = 409;
    error.details = { accountId: databaseAccountId, sessionKey: key, chatJid: String(chatJid || '').trim() };
    throw error;
  }
  const merge = whatsappConversationMerge.mergeConversationAliases({ accountId: databaseAccountId, aliases: [...aliases, ...(resolved?.aliases || [])], canonicalJid });
  return {
    chatJid: canonicalJid,
    conversationId: merge?.conversationId || `${databaseAccountId}:${canonicalJid}`,
    contactId: merge?.contactId || '',
    displayName: merge?.displayName || resolved?.displayName || '',
    avatarUrl: merge?.avatarUrl || resolved?.avatarUrl || ''
  };
}

function recordWhatsAppAvatarIdentity(input = {}) {
  const recorded = whatsappIdentityAuthority.recordAvatar(input);
  if (recorded?.canonicalJid) {
    try {
      whatsappConversationMerge.mergeConversationAliases({
        accountId: input.accountId,
        aliases: recorded.aliases || input.aliases || [],
        canonicalJid: recorded.canonicalJid
      });
    } catch (error) {
      logger.warn('whatsapp', 'avatar-identity-merge-failed', { accountId: input.accountId, canonicalJid: recorded.canonicalJid, errorCode: error.code || error.message });
    }
  }
  return recorded;
}

function optionalTimestampIso(value) {
  const raw = typeof value === 'object' && value !== null && typeof value.toNumber === 'function' ? value.toNumber() : Number(value || 0);
  return raw > 0 ? timestampIso(raw) : '';
}

function whatsappContactRecord(databaseAccountId, row = {}, source = 'baileys-contact') {
  const aliases = whatsappJidCandidates(row);
  const authority = whatsappIdentityAuthority.resolve(databaseAccountId, aliases);
  const jid = whatsappIdentityAuthority.chooseCanonical([...(authority?.aliases || []), ...aliases], authority?.canonicalJid || '');
  if (!jid) return null;
  const existing = storedWhatsAppContact(databaseAccountId, [...aliases, ...(authority?.aliases || [])]);
  const displayName = bestWhatsAppDisplayName([
    row.name, row.notify, row.verifiedBizName, row.verifiedName, row.businessName,
    row.fullName, row.shortName, row.subject, row.displayName, row.pushName,
    authority?.displayName, existing?.displayName
  ], jid);
  const contactId = existing?.id || stableId('contact', ['whatsapp', databaseAccountId, jid]);
  const avatarUrl = String(row.avatarUrl || row.avatar_url || authority?.avatarUrl || existing?.avatarUrl || '').trim();
  const recorded = whatsappIdentityAuthority.record({
    accountId: databaseAccountId,
    aliases: [...aliases, ...(authority?.aliases || [])],
    canonicalJid: jid,
    displayName,
    nameSource: source,
    avatarUrl,
    avatarSource: avatarUrl ? source : ''
  });
  const resolvedJid = recorded?.canonicalJid || jid;
  const resolvedName = recorded?.displayName || displayName;
  const resolvedAvatar = recorded?.avatarUrl || avatarUrl;
  return {
    ...row,
    id: contactId,
    contactId,
    accountId: databaseAccountId,
    platform: 'whatsapp',
    externalId: existing?.externalId || resolvedJid,
    jid: resolvedJid,
    aliases: [...new Set([...(existing?.aliases || []), ...aliases, ...(recorded?.aliases || [])])],
    displayName: resolvedName,
    phone: resolvedJid.endsWith('@g.us') ? '' : normalizePhone(resolvedJid),
    ...(resolvedAvatar ? { avatarUrl: resolvedAvatar } : {}),
    source,
    lastSeenAt: optionalTimestampIso(row.lastSeen || row.conversationTimestamp || row.timestamp)
  };
}

function persistWhatsAppDirectorySnapshot({ databaseAccountId, contacts = [], chats = [], source = 'baileys-history-set' } = {}) {
  const store = getStore();
  const contactNames = new Map();
  const stats = { contacts: 0, conversations: 0 };
  store.transaction(() => {
    for (const row of Array.isArray(contacts) ? contacts : []) {
      const contact = whatsappContactRecord(databaseAccountId, row, source);
      if (!contact) continue;
      store.upsertContact(contact);
      for (const alias of [contact.externalId, contact.jid, ...(contact.aliases || [])].filter(Boolean)) {
        const previous = contactNames.get(alias);
        if (!previous || (isWeakWhatsAppName(previous, alias) && !isWeakWhatsAppName(contact.displayName, alias))) contactNames.set(alias, contact.displayName);
      }
      stats.contacts += 1;
    }
    for (const chat of Array.isArray(chats) ? chats : []) {
      const aliases = whatsappJidCandidates(chat);
      const prior = whatsappIdentityAuthority.resolve(databaseAccountId, aliases);
      const jid = whatsappIdentityAuthority.chooseCanonical([...(prior?.aliases || []), ...aliases], prior?.canonicalJid || '');
      if (!jid) continue;
      const mappedName = aliases.map(alias => contactNames.get(alias)).find(name => !isWeakWhatsAppName(name, jid)) || '';
      const contact = whatsappContactRecord(databaseAccountId, { ...chat, id: jid, aliases, name: chat?.name || chat?.notify || mappedName || '' }, source);
      if (!contact) continue;
      store.upsertContact(contact);
      store.upsertConversation({
        ...chat,
        sessionKey: `${databaseAccountId}:${jid}`,
        accountId: databaseAccountId,
        contactId: contact.contactId,
        platform: 'whatsapp',
        chatJid: jid,
        externalId: jid,
        aliases: contact.aliases,
        title: contact.displayName,
        contactName: contact.displayName,
        avatarUrl: contact.avatarUrl || '',
        unreadCount: Math.max(0, Number(chat?.unreadCount || 0)),
        lastMessageAt: optionalTimestampIso(chat?.conversationTimestamp || chat?.lastMessageRecvTimestamp),
        source
      });
      stats.conversations += 1;
    }
  });
  try { whatsappConversationMerge.reconcileAccount(databaseAccountId); }
  catch (error) { logger.warn('whatsapp', 'directory-conversation-merge-failed', { accountId: databaseAccountId, errorCode: error.code || error.message }); }
  return stats;
}

async function ingestWhatsAppHistoryMessages({ databaseAccountId, socket, messages = [] } = {}) {
  const stats = { messages: 0, skipped: 0, failed: 0, mediaQueued: 0, mediaQueueSkipped: 0 };
  for (const info of Array.isArray(messages) ? messages : []) {
    try {
      let message = normalizeIncoming({ accountId: databaseAccountId, info, source: 'baileys-history-set' });
      if (!message) { stats.skipped += 1; continue; }
      message = await enrichWhatsAppMessageIdentity({ socket, databaseAccountId, info, message });
      message.historical = true;
      if (message.type === 'reaction') {
        await messageStore.applyReaction({ accountId: databaseAccountId, chatJid: message.chatJid, targetId: message.targetId, emoji: message.text, actor: message.fromMe ? 'me' : message.chatJid });
      } else if (message.type === 'revoke') {
        await messageStore.revoke({ accountId: databaseAccountId, chatJid: message.chatJid, targetId: message.targetId });
      } else {
        let queuedMedia = null;
        if (message.attachments?.length) {
          queuedMedia = whatsappHistoryMediaRecovery.queue.enqueue({
            accountId: databaseAccountId,
            conversationId: message.conversationId,
            messageId: message.id,
            info,
            socket,
            descriptor: message.attachments[0],
            message,
            priority: message.timestamp || message.sentAt
          });
          if (queuedMedia.attachment) message.attachments = [queuedMedia.attachment];
          if (queuedMedia.queued) stats.mediaQueued += 1;
          else stats.mediaQueueSkipped += 1;
        }
        await messageStore.upsert(message);
        if (queuedMedia?.queued) whatsappHistoryMediaRecovery.queue.drain();
      }
      stats.messages += 1;
    } catch (error) {
      stats.failed += 1;
      logger.warn('whatsapp', 'history-message-ingest-failed', { accountId: databaseAccountId, messageId: info?.key?.id || '', errorCode: error.code || error.message });
    }
  }
  return stats;
}

async function ownWhatsAppProfile(socket, user = {}, databaseAccountId = '') {
  const base = user && typeof user === 'object' ? { ...user } : {};
  const jid = historyJid(base.id || base.lid || '');
  if (!jid || typeof socket?.profilePictureUrl !== 'function') return base;
  try {
    const remoteAvatarUrl = String(await socket.profilePictureUrl(jid, 'image') || '').trim();
    if (!remoteAvatarUrl) return { ...base, avatarStatus: 'no-profile-photo' };
    const cached = await avatarService.cacheStandaloneRemote({
      accountId: databaseAccountId || jid,
      assetKey: 'whatsapp-account-avatar',
      url: remoteAvatarUrl,
      source: 'whatsapp-account-profile',
      retries: 1
    }).catch(() => null);
    const avatarUrl = cached?.avatarUrl || remoteAvatarUrl;
    return {
      ...base,
      avatarUrl,
      avatar_url: avatarUrl,
      remoteAvatarUrl,
      avatarUpdatedAt: cached?.avatarUpdatedAt || new Date().toISOString(),
      avatarStatus: 'ready'
    };
  } catch (error) {
    const status = Number(error?.output?.statusCode || error?.statusCode || 0);
    return { ...base, avatarStatus: status === 403 ? 'privacy-restricted' : status === 404 ? 'no-profile-photo' : 'avatar-unavailable' };
  }
}

function readableWhatsAppName(values = [], jid = '') {
  return bestWhatsAppDisplayName(values, jid);
}

async function resolveWhatsAppCanonicalJid(socket, jid, databaseAccountId = '') {
  const raw = historyJid(jid);
  if (!raw) return raw;
  const authority = databaseAccountId ? whatsappIdentityAuthority.resolve(databaseAccountId, [raw]) : null;
  if (authority?.canonicalJid?.endsWith('@s.whatsapp.net')) return authority.canonicalJid;
  if (!raw.endsWith('@lid')) return authority?.canonicalJid || raw;
  try {
    const mapped = await socket?.signalRepository?.lidMapping?.getPNForLID?.(raw);
    const normalized = historyJid(mapped) || raw;
    if (databaseAccountId && normalized !== raw) {
      whatsappIdentityAuthority.record({ accountId: databaseAccountId, aliases: [raw, normalized], canonicalJid: normalized, source: 'baileys-lid-mapping' });
    }
    return normalized;
  } catch (error) {
    logger.warn('whatsapp', 'lid-mapping-read-failed', { operation: 'signalRepository.lidMapping.getPNForLID', accountId: databaseAccountId, conversationId: '', reasonCode: error.code || 'WHATSAPP_LID_MAPPING_READ_FAILED', httpStatus: Number(error.status || 0), attempt: 1, nextRetryAt: '', jidHash: crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16) });
    return raw;
  }
}

function storedWhatsAppContact(databaseAccountId, jids = []) {
  const candidates = [...new Set(jids.map(historyJid).filter(Boolean))];
  if (!candidates.length) return null;
  const rows = getStore().db.prepare(`
    SELECT id, external_id AS externalId, display_name AS displayName, phone, avatar_url AS avatarUrl,
           aliases_json AS aliasesJson, payload_json AS payloadJson, updated_at AS updatedAt
    FROM contacts
    WHERE account_id=? AND platform='whatsapp'
    ORDER BY updated_at DESC
    LIMIT 2500
  `).all(databaseAccountId);
  const matches = [];
  for (const row of rows) {
    let aliases = [];
    try { aliases = JSON.parse(row.aliasesJson || '[]'); } catch (error) { logger.rateLimited('whatsapp', 'warn', 'stored-contact-aliases-json-invalid', { operation: 'storedWhatsAppContact.parseAliases', accountId: databaseAccountId, conversationId: '', reasonCode: 'WHATSAPP_CONTACT_ALIASES_JSON_INVALID', httpStatus: 0, attempt: 1, nextRetryAt: '', contactId: row.id, error: error.message }, { key: `wa-contact-aliases:${row.id}`, intervalMs: 60000 }); }
    let payload = {};
    try { payload = JSON.parse(row.payloadJson || '{}'); } catch (error) { logger.rateLimited('whatsapp', 'warn', 'stored-contact-payload-json-invalid', { operation: 'storedWhatsAppContact.parsePayload', accountId: databaseAccountId, conversationId: '', reasonCode: 'WHATSAPP_CONTACT_PAYLOAD_JSON_INVALID', httpStatus: 0, attempt: 1, nextRetryAt: '', contactId: row.id, error: error.message }, { key: `wa-contact-payload:${row.id}`, intervalMs: 60000 }); }
    const rowCandidates = [...new Set([
      row.externalId, ...(Array.isArray(aliases) ? aliases : []), ...whatsappJidCandidates(payload)
    ].map(historyJid).filter(Boolean))];
    const exact = candidates.some(value => rowCandidates.includes(value));
    const rowPhone = normalizePhone(row.phone || '') || phoneJidToken(row.externalId);
    const phoneMatch = Boolean(rowPhone) && candidates.some(value => phoneJidToken(value) === rowPhone);
    if (!exact && !phoneMatch) continue;
    const strongName = !isWeakWhatsAppName(row.displayName, row.externalId);
    const score = (exact ? 40 : 20) + (strongName ? 100 : 0) + (row.avatarUrl ? 30 : 0);
    matches.push({ ...row, aliases: rowCandidates, score });
  }
  matches.sort((a, b) => b.score - a.score || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  return matches[0] || null;
}

async function resolveWhatsAppPeerIdentity({ socket, databaseAccountId, info = {}, jid = '' } = {}) {
  const rawCandidates = whatsappJidCandidates({
    id: jid || info?.key?.remoteJid,
    remoteJid: info?.key?.remoteJid,
    remoteJidAlt: info?.key?.remoteJidAlt,
    participant: info?.key?.participant,
    senderPn: info?.senderPn,
    senderLid: info?.senderLid
  });
  const rawJid = rawCandidates[0] || '';
  if (!rawJid) return { rawJid: '', canonicalJid: '', contactId: '', displayName: '', aliases: [], avatarUrl: '', reasonCode: 'WHATSAPP_PEER_IDENTITY_INVALID' };
  const priorAuthority = whatsappIdentityAuthority.resolve(databaseAccountId, rawCandidates);
  const canonicalJid = await resolveWhatsAppCanonicalJid(socket, priorAuthority?.canonicalJid || rawJid, databaseAccountId);
  const candidates = [...new Set([canonicalJid, ...rawCandidates, ...(priorAuthority?.aliases || [])].filter(Boolean))];
  const stored = storedWhatsAppContact(databaseAccountId, candidates);
  const displayName = readableWhatsAppName([
    info?.pushName,
    info?.verifiedBizName,
    info?.name,
    priorAuthority?.displayName,
    stored?.displayName
  ], canonicalJid || rawJid);
  const contactJid = whatsappIdentityAuthority.chooseCanonical(candidates, canonicalJid || rawJid);
  if (!contactJid) return { rawJid, canonicalJid: '', contactId: '', displayName: '', aliases: candidates, avatarUrl: '', reasonCode: 'WHATSAPP_CANONICAL_IDENTITY_INVALID' };
  const contactId = stored?.id || stableId('contact', ['whatsapp', databaseAccountId, contactJid]);
  const aliases = [...new Set([...(stored?.aliases || []), ...candidates].filter(Boolean))];
  const authority = whatsappIdentityAuthority.record({
    accountId: databaseAccountId,
    aliases,
    canonicalJid: contactJid,
    displayName,
    nameSource: info?.pushName ? 'live-message-pushName' : 'stored-contact',
    avatarUrl: priorAuthority?.avatarUrl || stored?.avatarUrl || '',
    avatarSource: priorAuthority?.avatarSource || (stored?.avatarUrl ? 'stored-contact' : '')
  });
  const finalJid = authority?.canonicalJid || contactJid;
  const finalName = authority?.displayName || displayName;
  const finalAliases = [...new Set([...aliases, ...(authority?.aliases || [])])];
  const finalAvatar = authority?.avatarUrl || stored?.avatarUrl || '';
  const store = getStore();
  store.upsertContact({
    id: contactId, contactId, accountId: databaseAccountId, platform: 'whatsapp',
    externalId: stored?.externalId || finalJid, jid: finalJid, displayName: finalName,
    phone: normalizePhone(finalJid), aliases: finalAliases, source: 'whatsapp-live-identity',
    ...(finalAvatar ? { avatarUrl: finalAvatar } : {})
  });
  return { rawJid, canonicalJid: finalJid, contactId, displayName: finalName, aliases: finalAliases, avatarUrl: finalAvatar };
}

function mediaAttachment(message = {}) {
  return Array.isArray(message.attachments) ? message.attachments[0] || null : null;
}

function messageHistoryKey(message = {}, chatJid = '') {
  const id = String(message.externalMessageId || message.messageId || '').trim();
  const remoteJid = historyJid(message.chatJid || chatJid || String(message.conversationId || '').split(':').slice(1).join(':'));
  if (!id || !remoteJid) return null;
  return { remoteJid, id, fromMe: message.fromMe === true || message.direction === 'outbound' };
}

async function hydrateWhatsAppBusinessProfiles({ databaseAccountId, socket, limit = 30 } = {}) {
  if (!databaseAccountId || typeof socket?.getBusinessProfile !== 'function') return { scanned: 0, updated: 0, unavailable: 0 };
  const conversations = messageStore.listConversations({ limit: 1000 }).filter(row => (
    String(row.platform || '').toLowerCase() === 'whatsapp'
    && String(row.accountId || '') === String(databaseAccountId)
    && isWeakWhatsAppName(row.title || row.contactName || '', row.chatJid || row.externalId || '')
    && historyJid(row.chatJid || row.externalId || '').endsWith('@s.whatsapp.net')
  )).slice(0, Math.max(1, Number(limit || 30)));
  const stats = { scanned: 0, updated: 0, unavailable: 0 };
  for (const conversation of conversations) {
    const jid = historyJid(conversation.chatJid || conversation.externalId || '');
    if (!jid) continue;
    stats.scanned += 1;
    try {
      const profile = await socket.getBusinessProfile(jid);
      if (!profile) { stats.unavailable += 1; continue; }
      const displayName = bestWhatsAppDisplayName([
        profile.verifiedBizName, profile.verifiedName, profile.businessName,
        profile.displayName, profile.name, conversation.title
      ], jid);
      const strong = !isWeakWhatsAppName(displayName, jid);
      const store = getStore();
      const existing = storedWhatsAppContact(databaseAccountId, [jid]);
      if (existing) {
        store.upsertContact({
          ...existing,
          id: existing.id,
          accountId: databaseAccountId,
          platform: 'whatsapp',
          externalId: existing.externalId || jid,
          displayName: strong ? displayName : existing.displayName,
          businessProfile: profile,
          businessProfileUpdatedAt: new Date().toISOString(),
          source: 'whatsapp-business-profile'
        });
      }
      if (strong) {
        whatsappIdentityAuthority.record({ accountId: databaseAccountId, aliases: [jid], canonicalJid: jid, displayName, nameSource: 'whatsapp-business-profile' });
        await messageStore.updateConversationMetadata(conversation.id || conversation.sessionKey, { title: displayName, contactName: displayName, businessProfile: profile, businessProfileUpdatedAt: new Date().toISOString() });
        stats.updated += 1;
      }
    } catch (error) {
      stats.unavailable += 1;
      logger.rateLimited('whatsapp', 'warn', 'business-profile-fetch-failed', { accountId: databaseAccountId, conversationId: conversation.id || conversation.sessionKey || '', reasonCode: error.code || 'WHATSAPP_BUSINESS_PROFILE_FETCH_FAILED' }, { key: `wa-business-profile:${databaseAccountId}:${jid}`, intervalMs: 6 * 60 * 60 * 1000 });
    }
  }
  logger.info('whatsapp', 'business-profile-hydration-completed', { accountId: databaseAccountId, ...stats });
  return stats;
}

async function requestLegacyWhatsAppMediaHistory({ databaseAccountId, socket, targetConversationId = '', targetMessageId = '', maxRequests = 12, count = 50, cooldownMs = 6 * 60 * 60 * 1000 } = {}) {
  if (!databaseAccountId || typeof socket?.fetchMessageHistory !== 'function') return { requested: 0, reason: 'history-fetch-unavailable' };
  const targeted = Boolean(targetConversationId || targetMessageId);
  const cutoff = Date.now() - Math.max(60_000, Number(cooldownMs || 0));
  const pending = whatsappHistoryMediaRecovery.queue.recoverableMessages(databaseAccountId, { limit: 5000 })
    .filter(row => !hasMediaEnvelope(row.descriptor))
    .filter(row => targeted || !row.descriptor?.recoveryHistoryRequestedAt || Date.parse(row.descriptor.recoveryHistoryRequestedAt) < cutoff)
    .filter(row => !targetConversationId || String(row.message.conversationId || row.message.sessionKey) === String(targetConversationId))
    .filter(row => !targetMessageId || [row.message.id, row.message.externalMessageId].map(String).includes(String(targetMessageId)));
  if (!pending.length) return { requested: 0, missingEnvelope: 0, reason: 'no-legacy-media' };

  const byConversation = new Map();
  for (const row of pending) {
    const conversationId = String(row.message.conversationId || row.message.sessionKey || '');
    if (!conversationId) continue;
    if (!byConversation.has(conversationId)) byConversation.set(conversationId, []);
    byConversation.get(conversationId).push(row);
  }

  const plans = [];
  const windowSize = Math.max(10, Math.min(50, Number(count || 50))) - 4;
  for (const [conversationId, rows] of byConversation) {
    const messages = messageStore.listMessages(conversationId, { limit: 5000 });
    if (!messages.length) continue;
    const indexById = new Map();
    messages.forEach((row, index) => {
      for (const id of [row.id, row.externalMessageId].filter(Boolean)) indexById.set(String(id), index);
    });
    const buckets = new Map();
    for (const row of rows) {
      const index = indexById.get(String(row.message.id)) ?? indexById.get(String(row.message.externalMessageId));
      if (!Number.isInteger(index)) continue;
      const bucket = Math.floor(index / windowSize);
      if (!buckets.has(bucket)) buckets.set(bucket, []);
      buckets.get(bucket).push(row);
    }
    for (const [bucket, bucketRows] of buckets) {
      const desiredAnchor = Math.min(messages.length - 1, (bucket + 1) * windowSize + 1);
      let anchorIndex = desiredAnchor;
      const latestTargetIndex = Math.max(...bucketRows.map(row => indexById.get(String(row.message.id)) ?? indexById.get(String(row.message.externalMessageId)) ?? -1));
      if (anchorIndex <= latestTargetIndex) anchorIndex = Math.min(messages.length - 1, latestTargetIndex + 1);
      const anchor = messages[anchorIndex];
      const key = messageHistoryKey(anchor, bucketRows[0]?.message?.chatJid);
      if (!key || anchorIndex <= latestTargetIndex) continue;
      plans.push({ conversationId, key, timestamp: Math.floor(new Date(anchor.timestamp || anchor.sentAt || Date.now()).getTime() / 1000), rows: bucketRows });
    }
  }

  const limited = plans.slice(0, Math.max(1, Number(maxRequests || 12)));
  let requested = 0;
  for (const plan of limited) {
    try {
      await socket.fetchMessageHistory(Math.max(10, Math.min(50, Number(count || 50))), plan.key, plan.timestamp);
      requested += 1;
      const requestedAt = new Date().toISOString();
      for (const row of plan.rows) {
        await messageStore.upsert({
          ...row.message,
          attachments: [{ ...row.descriptor, downloadStatus: 'history-requested', recoveryHistoryRequestedAt: requestedAt, retryable: true }]
        });
      }
      logger.info('whatsapp', 'legacy-media-history-requested', { accountId: databaseAccountId, conversationId: plan.conversationId, count: Math.max(10, Math.min(50, Number(count || 50))), pendingMedia: plan.rows.length });
      if (requested < limited.length) await new Promise(resolve => setTimeout(resolve, 650));
    } catch (error) {
      logger.warn('whatsapp', 'legacy-media-history-request-failed', { accountId: databaseAccountId, conversationId: plan.conversationId, errorCode: error.code || error.message });
    }
  }
  return { requested, missingEnvelope: pending.length, planned: plans.length, limited: limited.length };
}

async function enrichWhatsAppMessageIdentity({ socket, databaseAccountId, info, message } = {}) {
  if (!message) return message;
  const peerInfo = message.fromMe ? {
    ...info,
    pushName: '',
    verifiedBizName: '',
    name: '',
    key: { ...(info?.key || {}), remoteJid: info?.key?.remoteJid || message.chatJid }
  } : info;
  const identity = await resolveWhatsAppPeerIdentity({ socket, databaseAccountId, info: peerInfo, jid: message.chatJid });
  if (!identity.rawJid && !identity.canonicalJid) {
    const raw = String(message.chatJid || info?.key?.remoteJid || '').trim();
    if (raw.includes('@')) {
      const error = new Error('WhatsApp 消息来源身份无效，已阻止写入');
      error.code = 'WHATSAPP_MESSAGE_PEER_IDENTITY_INVALID';
      error.status = 422;
      error.details = { accountId: databaseAccountId, chatJid: raw, reasonCode: identity.reasonCode || 'WHATSAPP_PEER_IDENTITY_INVALID' };
      throw error;
    }
    return message;
  }
  message.contactId = identity.contactId;
  message.contactName = identity.displayName;
  if (!message.fromMe) {
    message.sender = identity.displayName;
    message.senderName = identity.displayName;
  }
  message.avatarUrl = identity.avatarUrl || message.avatarUrl || '';
  message.rawMeta = {
    ...(message.rawMeta || {}),
    canonicalJid: identity.canonicalJid,
    rawJid: identity.rawJid,
    aliases: identity.aliases || []
  };
  return whatsappConversationMerge.canonicalizeMessage(message);
}

class WhatsAppAdapter {
  constructor() {
    this.accounts = new Map();
    this.stopping = new Set();
    this.stoppedAccounts = new Set();
    this.generations = new Map();
    this.credentialStateCache = new Map();
    this.credentialStateTtlMs = 3000;
  }

  status() {
    return [...this.accounts.entries()].map(([accountId, row]) => ({
      accountId,
      state: row.state,
      connectedAt: row.connectedAt || '',
      lastError: row.lastError || '',
      user: row.user || null,
      attemptId: String(row.attemptId || ''),
      identityReconciliationRunning: row.identityReconciliationRunning === true,
      identityReconciliationLastAt: row.identityReconciliationLastAt || '',
      identityReconciliationLastError: row.identityReconciliationLastError || '',
      identityReconciliationLastResult: row.identityReconciliationLastResult || null,
      qrReady: authChallenges.status(row.databaseAccountId || accountId).ready,
      qrExpiresAt: authChallenges.status(row.databaseAccountId || accountId).expiresAt,
      qrVersion: authChallenges.status(row.databaseAccountId || accountId).version
    }));
  }

  resolveAccountReference(accountOrId = 'account-a') {
    if (accountOrId && typeof accountOrId === 'object') return accountOrId;
    const value = String(accountOrId || '').trim();
    return accountStore.list().find(account => account.platform === 'whatsapp' && (
      account.id === value
      || account.adapterAccountId === value
      || account.metadata?.openClawAccountId === value
      || account.metadata?.resolvedAuthAccountKey === value
    )) || value || 'account-a';
  }

  resolveAccountKey(accountOrId = 'account-a') {
    return resolveStableAccountKey(this.resolveAccountReference(accountOrId));
  }

  credentialState(accountOrId = 'account-a', options = {}) {
    const reference = this.resolveAccountReference(accountOrId);
    const cacheKey = typeof reference === 'object' ? String(reference.id || reference.adapterAccountId || '') : String(reference || 'account-a');
    const cached = this.credentialStateCache.get(cacheKey);
    if (options.force !== true && cached && Date.now() - cached.at < this.credentialStateTtlMs) return { ...cached.value };
    try {
      const resolved = resolveAuthLocation(reference, { migrate: true });
      const value = {
        accountKey: resolved.key,
        directory: resolved.directory,
        legacyDirectory: resolved.legacy.directory,
        usable: resolved.usable,
        registered: resolved.registered,
        hasIdentity: Boolean(resolved.current.hasIdentity || resolved.legacy.hasIdentity),
        migrated: resolved.migration.performed,
        fileCount: resolved.fileCount,
        error: ''
      };
      this.credentialStateCache.set(cacheKey, { at: Date.now(), value });
      return { ...value };
    } catch (error) {
      const value = { accountKey: '', directory: '', legacyDirectory: '', usable: false, registered: false, hasIdentity: false, migrated: false, fileCount: 0, error: error.message, code: error.code || '' };
      this.credentialStateCache.set(cacheKey, { at: Date.now(), value });
      return { ...value };
    }
  }

  invalidateCredentialState(accountOrId = '') {
    const reference = this.resolveAccountReference(accountOrId);
    const keys = new Set([typeof reference === 'object' ? reference.id : reference, typeof reference === 'object' ? reference.adapterAccountId : '', this.resolveAccountKey(reference)]);
    for (const key of keys) if (key) this.credentialStateCache.delete(String(key));
  }

  hasCredentials(accountOrId = 'account-a') {
    try { return this.credentialState(accountOrId).usable; } catch (_) { return false; }
  }

  accountByAdapterId(adapterAccountId) {
    const stableKey = this.resolveAccountKey(adapterAccountId);
    return accountStore.list().find(account => account.platform === 'whatsapp' && (
      account.adapterAccountId === stableKey
      || (() => { try { return resolveStableAccountKey(account) === stableKey; } catch (_) { return false; } })()
    )) || null;
  }

  async recordLiveValidationSuccess(adapterAccountId, user = null) {
    const account = this.accountByAdapterId(adapterAccountId);
    if (!account) return null;
    const jid = normalizeJid(user?.id || user?.lid || account.metadata?.jid || '');
    const phone = normalizePhone(jid || user?.id || account.metadata?.phone || '');
    const displayName = safeDisplayName(user?.name, account.displayName, account.identityLabel);
    return accountStore.update(account.id, {
      displayName,
      identityLabel: displayName,
      metadata: {
        validationState: 'live-validated',
        validatedAt: new Date().toISOString(),
        lastConnectionError: '',
        phone,
        jid,
        liveUser: { ...(user || {}), ...(jid ? { id: jid } : {}) }
      }
    });
  }

  async rollbackPendingCredentialRecovery(adapterAccountId, error = '') {
    const account = this.accountByAdapterId(adapterAccountId);
    if (!account || account.metadata?.validationState !== 'pending-live-connect') return { rolledBack: false, reason: 'not-pending-recovery' };
    const credentialDirectory = path.resolve(account.metadata?.credentialDirectory || path.join(PATHS.whatsappAuth, adapterAccountId));
    const authRoot = path.resolve(PATHS.whatsappAuth);
    const insideAuthRoot = credentialDirectory === authRoot || credentialDirectory.startsWith(`${authRoot}${path.sep}`);
    const report = {
      accountId: account.id,
      adapterAccountId,
      recoveredFrom: account.metadata?.recoveredFrom || account.metadata?.migrationSource || '',
      credentialDirectory,
      error: String(error || 'WhatsApp credentials were rejected during first live connection'),
      rolledBackAt: new Date().toISOString(),
      sourceUntouched: true
    };
    const disposableRecoveryAccount = account.metadata?.recoveryCreatedAccount === true
      || (account.source === 'legacy-account-migration' && Boolean(account.metadata?.migrationSource));
    if (!disposableRecoveryAccount) {
      const preserved = await accountStore.update(account.id, {
        paused: true,
        autoReconnect: false,
        identityLabel: 'WhatsApp 凭据连接验证失败，需要重新登录',
        metadata: {
          validationState: 'live-validation-failed',
          lastConnectionError: report.error,
          lastConnectionFailureAt: report.rolledBackAt,
          preservedExistingAccount: true
        }
      });
      report.preservedExistingAccount = true;
      report.accountRemoved = false;
      report.credentialDirectoryRemoved = false;
      settingsRepository.set('credential-recovery', 'last-live-validation-failure', report);
      eventBus.publish('accounts:credential-recovery-preserved', report);
      logger.warn('whatsapp', 'existing-account-live-validation-failed-preserved', report);
      return { rolledBack: false, preserved: true, account: preserved, report };
    }
    if (insideAuthRoot && credentialDirectory !== authRoot) fs.rmSync(credentialDirectory, { recursive: true, force: true });
    await accountStore.remove(account.id);
    report.preservedExistingAccount = false;
    report.accountRemoved = true;
    report.credentialDirectoryRemoved = true;
    settingsRepository.set('credential-recovery', 'last-live-validation-failure', report);
    eventBus.publish('accounts:credential-recovery-rolled-back', report);
    logger.warn('whatsapp', 'pending-credential-recovery-rolled-back', report);
    return { rolledBack: true, report };
  }

  async recordConnectionFailure(adapterAccountId, error = '', loggedOut = false) {
    const account = this.accountByAdapterId(adapterAccountId);
    if (!account) return null;
    if (loggedOut && account.metadata?.validationState === 'pending-live-connect') {
      return this.rollbackPendingCredentialRecovery(adapterAccountId, error);
    }
    return accountStore.update(account.id, {
      identityLabel: loggedOut ? 'WhatsApp 凭据已失效，需要重新登录' : account.identityLabel,
      metadata: {
        validationState: loggedOut ? 'live-validation-failed' : (account.metadata?.validationState || ''),
        lastConnectionError: String(error || ''),
        lastConnectionFailureAt: new Date().toISOString()
      }
    });
  }


  async reconcileKnownIdentities(adapterAccountId, databaseAccountId, socket, options = {}) {
    const runtimeRow = this.accounts.get(adapterAccountId) || [...this.accounts.values()].find(item => item.databaseAccountId === databaseAccountId) || null;
    if (runtimeRow) {
      runtimeRow.identityReconciliationRunning = true;
      runtimeRow.identityReconciliationLastError = '';
    }
    let accountReconciliation = { applied: 0, reports: [] };
    try {
      accountReconciliation = whatsappAccountReconciliation.reconcileOrphanAccounts();
      if (accountReconciliation.applied > 0) {
        logger.info('whatsapp', 'orphan-account-reconciliation-applied', {
          operation: 'reconcileKnownIdentities',
          accountId: databaseAccountId,
          applied: accountReconciliation.applied,
          reasonCode: 'WHATSAPP_ORPHAN_ACCOUNT_RECONCILED'
        });
      }
    } catch (error) {
      if (runtimeRow) {
        runtimeRow.identityReconciliationRunning = false;
        runtimeRow.identityReconciliationLastAt = new Date().toISOString();
        runtimeRow.identityReconciliationLastError = String(error.message || error);
        runtimeRow.identityReconciliationLastResult = { failed: true, code: error.code || 'WHATSAPP_ORPHAN_ACCOUNT_RECONCILIATION_FAILED', at: runtimeRow.identityReconciliationLastAt };
      }
      logger.error('whatsapp', 'orphan-account-reconciliation-blocked', {
        operation: 'reconcileKnownIdentities',
        accountId: databaseAccountId,
        reasonCode: error.code || 'WHATSAPP_ORPHAN_ACCOUNT_RECONCILIATION_FAILED',
        error: error.message
      });
      throw error;
    }
    const rows = messageStore.listConversations({ limit: 2000 }).filter(item => (
      item.platform === 'whatsapp'
      && (item.accountId === databaseAccountId || item.accountId === adapterAccountId || item.adapterAccountId === adapterAccountId)
    ));
    let resolved = 0;
    let failed = 0;
    for (const conversation of rows) {
      const jid = historyJid(conversation.chatJid || conversation.externalId || String(conversation.id || conversation.sessionKey || '').split(':').slice(1).join(':'));
      if (!jid) continue;
      try {
        const conversationId = conversation.id || conversation.sessionKey || conversation.conversationId;
        const historicalMessages = messageStore.listMessages(conversationId, { limit: 500 }).slice().reverse();
        const inboundHistoricalMessages = historicalMessages.filter(message => (
          message.direction === 'inbound' || message.side === 'in' || message.fromMe === false
        ));
        const historicalNames = inboundHistoricalMessages.flatMap(message => [message.pushName, message.senderName, message.contactName, message.sender, message.notify]);
        const historicalAliases = historicalMessages.flatMap(message => whatsappJidCandidates({
          remoteJid: message.rawMeta?.remoteJid || message.raw?.remoteJid,
          remoteJidAlt: message.rawMeta?.remoteJidAlt || message.raw?.remoteJidAlt,
          senderPn: message.rawMeta?.senderPn || message.raw?.senderPn,
          participant: message.rawMeta?.participant || message.raw?.participant,
          aliases: message.rawMeta?.aliases || message.raw?.aliases || []
        }));
        const preferredAlias = historicalAliases.find(value => value.endsWith('@s.whatsapp.net')) || historicalAliases[0] || '';
        const identity = await resolveWhatsAppPeerIdentity({
          socket,
          databaseAccountId,
          jid,
          info: { key: { remoteJid: jid, remoteJidAlt: preferredAlias }, senderPn: preferredAlias }
        });
        if (!identity.canonicalJid || !identity.contactId) {
          const error = new Error('WhatsApp 历史会话缺少可用规范身份，已保留原资料并跳过');
          error.code = identity.reasonCode || 'WHATSAPP_RECONCILE_CANONICAL_IDENTITY_INVALID';
          error.status = 422;
          error.details = { accountId: databaseAccountId, conversationId, jid, preferredAlias };
          throw error;
        }
        const displayName = readableWhatsAppName([
          ...historicalNames,
          identity.displayName,
          conversation.title,
          conversation.contactName
        ], identity.canonicalJid);
        await messageStore.updateConversationMetadata(conversationId, {
          contactId: identity.contactId,
          title: displayName,
          contactName: displayName,
          chatJid: identity.canonicalJid,
          externalId: identity.canonicalJid,
          aliases: [...new Set([...(identity.aliases || []), ...historicalAliases])],
          canonicalJid: identity.canonicalJid,
          identityResolvedAt: new Date().toISOString(),
          identityResolutionSource: options.reason || 'runtime-reconcile'
        });
        const task = this.avatarTaskForConversation({
          adapterAccountId, databaseAccountId, socket,
          conversation: { ...conversation, chatJid: identity.canonicalJid, contactId: identity.contactId },
          force: options.force === true, reason: options.reason || 'identity-reconcile'
        });
        if (task.conversationId && task.jid) {
          avatarService.enqueueWhatsApp(task).then(result => {
            if (result?.avatarUrl) recordWhatsAppAvatarIdentity({
              accountId: databaseAccountId,
              aliases: task.jidCandidates,
              canonicalJid: result.resolvedJid || task.jid,
              avatarUrl: result.avatarUrl,
              source: 'whatsapp-profile'
            });
          }).catch(error => {
            logger.warn('whatsapp', 'identity-reconcile-avatar-failed', { operation: 'avatarService.enqueueWhatsApp', accountId: databaseAccountId, conversationId: task.conversationId, reasonCode: error.code || 'WHATSAPP_AVATAR_RECONCILE_FAILED', httpStatus: Number(error.status || 0), attempt: Number(error.attempt || 1), nextRetryAt: error.nextRetryAt || '' });
          });
        }
        resolved += 1;
      } catch (error) {
        failed += 1;
        logger.warn('whatsapp', 'identity-reconcile-item-failed', { accountId: databaseAccountId, conversationId: conversation.id || conversation.sessionKey || '', errorCode: error.code || error.message });
      }
    }
    let conversationMerges = [];
    try { conversationMerges = whatsappConversationMerge.reconcileAccount(databaseAccountId); }
    catch (error) { logger.warn('whatsapp', 'account-conversation-merge-failed', { accountId: databaseAccountId, errorCode: error.code || error.message }); }
    const result = {
      scanned: rows.length,
      resolved,
      failed,
      conversationMerges: conversationMerges.filter(row => row?.merged).length,
      orphanAccountReconciliations: Number(accountReconciliation.applied || 0),
      reason: options.reason || 'runtime-reconcile'
    };
    if (runtimeRow) {
      runtimeRow.identityReconciliationRunning = false;
      runtimeRow.identityReconciliationLastAt = new Date().toISOString();
      runtimeRow.identityReconciliationLastError = failed > 0 ? `${failed} 个会话身份尚未解析，原数据已保留` : '';
      runtimeRow.identityReconciliationLastResult = { ...result, completedAt: runtimeRow.identityReconciliationLastAt };
    }
    eventBus.publish('whatsapp:identity-reconciled', { accountId: databaseAccountId, ...result });
    return result;
  }

  avatarTaskForConversation({ adapterAccountId, databaseAccountId, socket, conversation, force = false, reason = 'background' }) {
    let rawCandidates = [...new Set([conversation?.canonicalJid, conversation?.chatJid, conversation?.externalId, ...(Array.isArray(conversation?.aliases) ? conversation.aliases : []), String(conversation?.id || '').split(':').slice(1).join(':')].map(historyJid).filter(Boolean))];
    try {
      const authority = whatsappIdentityAuthority.resolve(databaseAccountId || adapterAccountId, rawCandidates);
      rawCandidates = [...new Set([...(authority?.aliases || []), authority?.canonicalJid, ...rawCandidates].map(historyJid).filter(Boolean))];
    } catch (error) {
      logger.warn('whatsapp', 'avatar-identity-authority-resolve-failed', {
        accountId: databaseAccountId || adapterAccountId,
        conversationId: conversation?.id || conversation?.conversationId || conversation?.sessionKey || '',
        errorCode: error.code || error.message
      });
    }
    const preferredJid = whatsappIdentityAuthority.chooseCanonical(rawCandidates);
    const jid = avatarService.normalizeJid(preferredJid);
    return {
      accountId: databaseAccountId || adapterAccountId,
      adapterAccountId,
      databaseAccountId,
      contactId: conversation?.contactId || '',
      conversationId: conversation?.id || conversation?.conversationId || conversation?.sessionKey || '',
      jid,
      jidCandidates: rawCandidates,
      socket,
      force,
      reason
    };
  }

  avatarTasksForKnownConversations(adapterAccountId, databaseAccountId, socket, options = {}) {
    return messageStore.listConversations({ limit: 500 }).filter(item => (
      item.platform === 'whatsapp'
      && (item.accountId === databaseAccountId || item.accountId === adapterAccountId || item.adapterAccountId === adapterAccountId)
    )).map(conversation => this.avatarTaskForConversation({ adapterAccountId, databaseAccountId, socket, conversation, force: options.force === true, reason: options.reason || 'background' }))
      .filter(task => task.conversationId && task.jid);
  }

  queueKnownAvatarSync(adapterAccountId, databaseAccountId, socket, options = {}) {
    const tasks = this.avatarTasksForKnownConversations(adapterAccountId, databaseAccountId, socket, options);
    const run = avatarService.syncWhatsAppContacts(tasks);
    run.then(stats => {
      (stats.results || []).forEach((result, index) => {
        const task = tasks[index];
        if (result?.avatarUrl && task) recordWhatsAppAvatarIdentity({
          accountId: databaseAccountId,
          aliases: task.jidCandidates,
          canonicalJid: result.resolvedJid || task.jid,
          avatarUrl: result.avatarUrl,
          source: 'whatsapp-profile-batch'
        });
      });
      logger.info('whatsapp', 'avatar-sync-completed', { accountId: databaseAccountId, reason: options.reason || 'background', ...stats });
      eventBus.publish('whatsapp:avatar-sync', { accountId: databaseAccountId, reason: options.reason || 'background', ...stats });
    }).catch(error => logger.warn('whatsapp', 'avatar-sync-batch-failed', { accountId: databaseAccountId, reason: options.reason || 'background', errorCode: error.code || error.message }));
    return run;
  }

  queueAvatarRows(adapterAccountId, databaseAccountId, socket, rows = [], reason = 'contacts-update') {
    const wanted = new Set((Array.isArray(rows) ? rows : []).flatMap(row => whatsappJidCandidates(row)).map(avatarService.normalizeJid).filter(Boolean));
    if (!wanted.size) return Promise.resolve({ contactsScanned: 0, avatarsRequested: 0, avatarsDownloaded: 0, avatarsUnchanged: 0, avatarsUnavailable: 0, avatarsFailed: 0, cacheRepaired: 0, results: [] });
    const tasks = this.avatarTasksForKnownConversations(adapterAccountId, databaseAccountId, socket, { reason })
      .filter(task => [task.jid, ...(task.jidCandidates || [])].map(avatarService.normalizeJid).some(jid => wanted.has(jid)));
    return avatarService.syncWhatsAppContacts(tasks).then(stats => {
      (stats.results || []).forEach((result, index) => {
        const task = tasks[index];
        if (result?.avatarUrl && task) recordWhatsAppAvatarIdentity({
          accountId: databaseAccountId,
          aliases: task.jidCandidates,
          canonicalJid: result.resolvedJid || task.jid,
          avatarUrl: result.avatarUrl,
          source: 'whatsapp-profile-update'
        });
      });
      eventBus.publish('whatsapp:avatar-sync', { accountId: databaseAccountId, reason, ...stats });
      return stats;
    });
  }

  async prepareStartGeneration(accountId, existing, context = {}) {
    if (existing) {
      const startupAgeMs = Date.now() - Number(existing.startedAtMs || Date.now());
      const reusable = Boolean(existing.socket) && (existing.state === 'online' || existing.state === 'qr' || (existing.state === 'connecting' && startupAgeMs < WHATSAPP_QR_STARTUP_TIMEOUT_MS));
      if (reusable) {
        this.stopping.delete(accountId);
        this.stoppedAccounts.delete(accountId);
        return { reused: true, row: existing, generation: Number(existing.generation || this.generations.get(accountId) || 0) };
      }
      logger.warn('whatsapp', 'stale-startup-replaced', { accountId, databaseAccountId: context.databaseAccountId || '', state: existing.state || '', startupAgeMs });
      await this.stop(accountId, false);
    }

    this.stopping.delete(accountId);
    this.stoppedAccounts.delete(accountId);
    const generation = Number(this.generations.get(accountId) || 0) + 1;
    this.generations.set(accountId, generation);
    return { reused: false, row: null, generation };
  }

  async start(accountId = 'account-a', options = {}) {
    assertOperationActive(options.signal, 'WHATSAPP_CONNECT_ABORTED', { attemptId: String(options.attemptId || '') });
    const reference = this.resolveAccountReference(accountId);
    const persistedAccountId = reference && typeof reference === 'object'
      ? String(reference.id || '').trim()
      : String(this.accountByAdapterId(accountId)?.id || accountId || '').trim();
    requirePersistedWhatsAppOperation(options.physicalOperationContext, { accountId: persistedAccountId, operation: 'start' });
    if (reference && typeof reference === 'object') {
      accountLifecycle.assertEligible(reference, { manual: options.manual === true });
      const canonicalAccountId = canonicalIdentity.resolveCanonicalAccountId(reference.id);
      if (canonicalAccountId !== reference.id) throw Object.assign(new Error('重复WhatsApp账号已合并，禁止启动旧运行实例'), { code: 'ACCOUNT_IDENTITY_ALIAS', status: 409, canonicalAccountId });
    }
    const auth = resolveAuthLocation(reference, { migrate: true, includeFileCount: true });
    accountId = auth.key;
    const databaseAccountId = reference && typeof reference === 'object' ? reference.id : (this.accountByAdapterId(accountId)?.id || accountId);
    const existing = this.accounts.get(accountId);
    const preparation = await this.prepareStartGeneration(accountId, existing, { databaseAccountId });
    assertOperationActive(options.signal, 'WHATSAPP_CONNECT_ABORTED', { accountId: databaseAccountId, attemptId: String(options.attemptId || '') });
    if (preparation.reused) return this.publicAccount(accountId, preparation.row);
    const generation = preparation.generation;

    logger.rateLimited('whatsapp', 'info', 'auth-location-resolved', {
      accountId,
      databaseAccountId: reference && typeof reference === 'object' ? reference.id || '' : '',
      databaseAdapterAccountId: reference && typeof reference === 'object' ? reference.adapterAccountId || '' : '',
      currentAuthDirectory: auth.directory,
      legacyAuthDirectory: auth.legacy.directory,
      currentCredentialsUsable: auth.current.usable,
      legacyCredentialsUsable: auth.legacy.usable,
      registeredFlag: auth.registered,
      migrationPerformed: auth.migration.performed,
      credentialFileCount: auth.fileCount
    }, { key: `auth-location-resolved:${accountId}`, intervalMs: 30000 });

    const baileys = await import('@whiskeysockets/baileys');
    assertOperationActive(options.signal, 'WHATSAPP_CONNECT_ABORTED', { accountId: databaseAccountId, attemptId: String(options.attemptId || '') });
    const authDir = auth.directory;
    fs.mkdirSync(authDir, { recursive: true });
    const { state, saveCreds } = await baileys.useMultiFileAuthState(authDir);
    assertOperationActive(options.signal, 'WHATSAPP_CONNECT_ABORTED', { accountId: databaseAccountId, attemptId: String(options.attemptId || '') });
    const discoveryDecision = whatsappVersionDiscoveryAuthority.beforeAttempt();
    let versionInfo;
    if (discoveryDecision.attempt) {
      versionInfo = await discoverBaileysVersion(baileys);
      if (Array.isArray(versionInfo.version)) {
        whatsappVersionDiscoveryAuthority.recordSuccess(versionInfo);
      } else {
        const reasonCode = versionInfo.timedOut ? 'VERSION_DISCOVERY_TIMEOUT' : (versionInfo.error?.code || 'VERSION_DISCOVERY_FAILED');
        const authorityState = whatsappVersionDiscoveryAuthority.recordFailure(reasonCode);
        if (whatsappVersionDiscoveryAuthority.shouldLogWarning()) {
          logger.warn('whatsapp', versionInfo.timedOut ? 'version-discovery-timeout' : 'version-discovery-failed', {
            accountId,
            reasonCode,
            timeoutMs: WHATSAPP_VERSION_DISCOVERY_TIMEOUT_MS,
            fallback: Array.isArray(authorityState.version) ? 'cached-version' : 'baileys-default-version',
            cachedVersion: authorityState.version || null,
            consecutiveFailures: authorityState.consecutiveFailures,
            nextRetryAt: authorityState.nextAttemptAt
          });
          whatsappVersionDiscoveryAuthority.markWarning();
        }
        if (Array.isArray(authorityState.version)) versionInfo.version = authorityState.version;
      }
    } else {
      versionInfo = {
        version: discoveryDecision.cachedVersion,
        isLatest: discoveryDecision.isLatest,
        timedOut: false,
        error: null,
        skipped: true,
        reasonCode: discoveryDecision.reasonCode
      };
      logger.rateLimited('whatsapp', 'info', 'version-discovery-backoff', {
        accountId,
        cachedVersion: discoveryDecision.cachedVersion || null,
        nextRetryAt: discoveryDecision.nextAttemptAt,
        consecutiveFailures: discoveryDecision.consecutiveFailures
      }, { key: 'version-discovery-backoff', intervalMs: 300000 });
    }
    const row = {
      state: 'connecting',
      lastError: '',
      qr: '',
      qrDataUrl: '',
      socket: null,
      connectedAt: '',
      user: null,
      presenceSubscriptions: new Set(),
      databaseAccountId,
      startedAtMs: Date.now(),
      startupTimer: null,
      startupTimedOut: false,
      generation,
      attemptId: String(options.attemptId || ''),
      identityReconciliationRunning: false,
      identityReconciliationLastAt: '',
      identityReconciliationLastError: '',
      identityReconciliationLastResult: null,
      appStateCollections: Array.isArray(baileys.ALL_WA_PATCH_NAMES) ? baileys.ALL_WA_PATCH_NAMES : []
    };
    row.sessionFence = createSessionGenerationFence(
      () => this.accounts.get(accountId) === row && this.generations.get(accountId) === row.generation,
      { prefix: `whatsapp:${databaseAccountId}` }
    );
    this.accounts.set(accountId, row);
    const onOperationAbort = () => {
      if (this.accounts.get(accountId) !== row) return;
      row.startupTimedOut = true;
      row.lastError = operationAbortError(options.signal, 'WHATSAPP_CONNECT_ABORTED', { accountId: databaseAccountId }).message;
      clearStartupWatchdog(row);
      try { row.socket?.end?.(operationAbortError(options.signal, 'WHATSAPP_CONNECT_ABORTED', { accountId: databaseAccountId })); }
      catch (error) { logger.warn('whatsapp', 'connect-abort-socket-close-failed', { accountId: databaseAccountId, adapterAccountId: accountId, reasonCode: error?.code || 'WHATSAPP_CONNECT_ABORT_SOCKET_CLOSE_FAILED', error: error?.message || String(error) }); }
      this.generations.set(accountId, Number(this.generations.get(accountId) || row.generation || 0) + 1);
      row.sessionFence.invalidate('WHATSAPP_CONNECT_ABORTED');
      this.accounts.delete(accountId);
    };
    options.signal?.addEventListener?.('abort', onOperationAbort, { once: true });
    eventBus.publish('whatsapp:state', { accountId, databaseAccountId, state: 'connecting', attemptId: String(options.attemptId || '') });

    const socketOptions = {
      auth: state,
      printQRInTerminal: false,
      markOnlineOnConnect: false,
      syncFullHistory: true,
      shouldSyncHistoryMessage: () => true,
      generateHighQualityLinkPreview: true,
      browser: whatsappBrowserIdentity(),
      getMessage: async key => {
        const rawConversationId = `${databaseAccountId}:${key.remoteJid}`;
        const target = canonicalWhatsAppTarget(databaseAccountId, key.remoteJid, rawConversationId);
        const conversationIds = [...new Set([target.conversationId, rawConversationId].filter(Boolean))];
        let found = null;
        for (const conversationId of conversationIds) {
          found = messageStore.listMessages(conversationId, { limit: 5000 }).find(message => (
            String(message.externalMessageId || '') === String(key.id || '') || String(message.id || '') === String(key.id || '')
          ));
          if (found) break;
        }
        if (found?.rawMessage) return found.rawMessage;
        const envelope = mediaAttachment(found || {})?.mediaEnvelope;
        return reconstructBaileysMessageInfo(envelope)?.message || undefined;
      }
    };
    if (Array.isArray(versionInfo.version)) socketOptions.version = versionInfo.version;
    assertOperationActive(options.signal, 'WHATSAPP_CONNECT_ABORTED', { accountId: databaseAccountId, attemptId: row.attemptId });
    const socket = baileys.default(socketOptions);
    row.socket = socket;
    const socketGuard = createSocketGenerationGuard(row.sessionFence, () => row.socket === socket);
    const onSocket = (eventName, handler) => socketGuard.bind(socket.ev, eventName, handler);
    row.startupTimer = setTimeout(() => {
      if (this.accounts.get(accountId) !== row || row.state !== 'connecting') return;
      row.state = 'offline';
      row.startupTimedOut = true;
      row.lastError = 'WhatsApp 二维码生成超时，请检查网络后重试';
      const staleSocket = row.socket;
      row.sessionFence.invalidate('WHATSAPP_QR_START_TIMEOUT');
      row.socket = null;
      try { staleSocket?.end?.(Object.assign(new Error('WHATSAPP_QR_START_TIMEOUT'), { code: 'WHATSAPP_QR_START_TIMEOUT' })); } catch (error) {
        logger.warn('whatsapp', 'qr-timeout-socket-close-failed', { operation: 'socket.end', accountId: databaseAccountId, reasonCode: error.code || 'WHATSAPP_SOCKET_CLOSE_FAILED', httpStatus: Number(error.status || 0), attempt: 1, nextRetryAt: '' });
      }
      eventBus.publish('whatsapp:state', { accountId, databaseAccountId, state: 'offline', error: row.lastError, lastError: row.lastError, code: 'WHATSAPP_QR_START_TIMEOUT', reasonCode: 'WHATSAPP_QR_START_TIMEOUT', attemptId: String(options.attemptId || '') });
      logger.warn('whatsapp', 'qr-start-timeout', { accountId, databaseAccountId, timeoutMs: WHATSAPP_QR_STARTUP_TIMEOUT_MS });
    }, WHATSAPP_QR_STARTUP_TIMEOUT_MS);
    row.startupTimer.unref?.();

    onSocket('creds.update', async update => {
      await saveCreds(update);
      socketGuard.assertCurrent({ accountId: databaseAccountId, eventName: 'creds.update' });
      this.invalidateCredentialState(reference);
    });
    onSocket('connection.update', async update => {
      if (options.signal?.aborted || this.accounts.get(accountId) !== row || this.generations.get(accountId) !== row.generation) return;
      const { connection, lastDisconnect, qr } = update;
      if (qr) {
        clearStartupWatchdog(row);
        try {
          const qrDataUrl = await getQRCodeRenderer().toDataURL(qr, { margin: 1, width: 320 });
          socketGuard.assertCurrent({ accountId: databaseAccountId, eventName: 'connection.update', phase: 'qr-rendered' });
          row.qr = qr;
          row.qrDataUrl = qrDataUrl;
          row.state = 'qr';
          row.lastError = '';
          const challenge = authChallenges.issue({ accountId: databaseAccountId, aliases: [accountId], dataUrl: row.qrDataUrl });
          eventBus.publish('whatsapp:qr', { accountId, databaseAccountId, challenge, qrDataUrl: row.qrDataUrl });
        } catch (error) {
          if (!socketGuard.isCurrent() || error?.code === 'SOCKET_GENERATION_STALE') return;
          row.state = 'offline';
          row.lastError = `WhatsApp 二维码渲染失败：${error.message || error}`;
          eventBus.publish('whatsapp:state', { accountId, databaseAccountId, state: 'offline', error: row.lastError, lastError: row.lastError, code: 'WHATSAPP_QR_RENDER_FAILED', reasonCode: 'WHATSAPP_QR_RENDER_FAILED', attemptId: String(options.attemptId || '') });
          logger.error('whatsapp', 'qr-render-failed', { accountId, databaseAccountId, errorCode: error.code || error.message });
        }
      }
      if (connection === 'open') {
        clearStartupWatchdog(row);
        const user = await ownWhatsAppProfile(socket, socket.user || {}, databaseAccountId);
        socketGuard.assertCurrent({ accountId: databaseAccountId, eventName: 'connection.update', phase: 'profile-loaded' });
        row.state = 'online';
        row.connectedAt = new Date().toISOString();
        row.lastError = '';
        row.qr = '';
        row.qrDataUrl = '';
        authChallenges.clear(databaseAccountId);
        row.user = user;
        await this.recordLiveValidationSuccess(accountId, row.user).catch(error => logger.error('whatsapp', 'account-live-validation-update-failed', { accountId, error: error.message }));
        socketGuard.assertCurrent({ accountId: databaseAccountId, eventName: 'connection.update', phase: 'validation-recorded' });
        eventBus.publish('whatsapp:state', { accountId, databaseAccountId, state: 'online', user: row.user, attemptId: String(options.attemptId || '') });
        setImmediate(() => socketGuard.isCurrent() && this.reconcileKnownIdentities(accountId, databaseAccountId, socket, { force: true, reason: 'connection-ready' })
          .catch(error => logger.warn('whatsapp', 'connection-identity-reconcile-failed', { accountId: databaseAccountId, errorCode: error.code || error.message })));
        setImmediate(() => {
          if (!socketGuard.isCurrent()) return;
          try {
            const mobileEchoRepair = messageStore.collapseDuplicateUnsupportedMobileEchoes(databaseAccountId);
            if (mobileEchoRepair.removed) logger.info('whatsapp', 'mobile-device-echo-placeholders-removed', { accountId: databaseAccountId, ...mobileEchoRepair });
          } catch (error) {
            logger.warn('whatsapp', 'mobile-device-echo-repair-failed', { accountId: databaseAccountId, errorCode: error.code || error.message });
          }
        });
        this.subscribeKnownConversations(accountId).catch(error => logger.warn('whatsapp', 'presence-subscribe-known-failed', { accountId, error: error.message }));
        this.queueKnownAvatarSync(accountId, databaseAccountId, socket, { reason: 'connection-ready' });
        let durableMedia = { missingEnvelope: 0 };
        try { durableMedia = whatsappHistoryMediaRecovery.queue.resumeAccount({ accountId: databaseAccountId, socket, limit: 800 }); }
        catch (error) { logger.warn('whatsapp', 'durable-media-resume-failed', { accountId: databaseAccountId, errorCode: error.code || error.message }); }
        const profileTimer = setTimeout(() => {
          if (!socketGuard.isCurrent()) return;
          hydrateWhatsAppBusinessProfiles({ databaseAccountId, socket, limit: 30 })
            .catch(error => logger.warn('whatsapp', 'business-profile-hydration-failed', { accountId: databaseAccountId, errorCode: error.code || error.message }));
        }, 900);
        profileTimer.unref?.();
        if (durableMedia.missingEnvelope > 0) {
          const mediaTimer = setTimeout(() => {
            if (!socketGuard.isCurrent()) return;
            requestLegacyWhatsAppMediaHistory({ databaseAccountId, socket, maxRequests: 12, count: 50 })
              .catch(error => logger.warn('whatsapp', 'legacy-media-history-plan-failed', { accountId: databaseAccountId, errorCode: error.code || error.message }));
          }, 1800);
          mediaTimer.unref?.();
        }
        if (typeof socket.resyncAppState === 'function' && row.appStateCollections.length) {
          const timer = setTimeout(() => {
            if (!socketGuard.isCurrent()) return;
            socket.resyncAppState(row.appStateCollections, true)
              .then(() => new Promise(resolve => setTimeout(resolve, 1200)))
              .then(() => socketGuard.assertCurrent({ accountId: databaseAccountId, eventName: 'connection.update', phase: 'app-state-resynced' }))
              .then(() => this.reconcileKnownIdentities(accountId, databaseAccountId, socket, {
                force: true,
                reason: 'connection-app-state-ready'
              }))
              .then(() => hydrateWhatsAppBusinessProfiles({ databaseAccountId, socket, limit: 30 }))
              .catch(error => logger.warn('whatsapp', 'app-state-resync-failed', {
                operation: 'socket.resyncAppState.reconcileKnownIdentities',
                accountId: databaseAccountId,
                reasonCode: error.code || 'WHATSAPP_APP_STATE_RECONCILIATION_FAILED',
                httpStatus: Number(error.status || 0),
                attempt: 1,
                nextRetryAt: '',
                error: error.message
              }));
          }, 250);
          timer.unref?.();
        }
      }
      if (connection === 'close') {
        clearStartupWatchdog(row);
        const statusCode = lastDisconnect?.error?.output?.statusCode || lastDisconnect?.error?.statusCode || 0;
        const loggedOut = statusCode === baileys.DisconnectReason.loggedOut;
        const closeError = lastDisconnect?.error?.message || `连接关闭（${statusCode || 'unknown'}）`;
        await this.recordConnectionFailure(accountId, closeError, loggedOut).catch(error => logger.error('whatsapp', 'account-connection-failure-update-failed', { accountId, error: error.message }));
        socketGuard.assertCurrent({ accountId: databaseAccountId, eventName: 'connection.update', phase: 'close-recorded' });
        row.state = loggedOut ? 'logged-out' : 'offline';
        row.lastError = closeError;
        row.sessionFence.invalidate(loggedOut ? 'WHATSAPP_LOGGED_OUT' : 'WHATSAPP_CONNECTION_CLOSED');
        row.socket = null;
        if (loggedOut) authChallenges.clear(databaseAccountId);
        const reasonCode = loggedOut ? 'WHATSAPP_LOGGED_OUT' : 'WHATSAPP_CONNECTION_CLOSED';
        eventBus.publish('whatsapp:state', { accountId, databaseAccountId, state: row.state, error: row.lastError, lastError: row.lastError, code: reasonCode, reasonCode, attemptId: String(options.attemptId || '') });
        logger.warn('whatsapp', 'connection-closed', { accountId, statusCode, loggedOut, error: row.lastError });
      }
    });

    onSocket('messaging-history.set', async payload => {
      const startedAt = Date.now();
      try {
        const directoryStats = persistWhatsAppDirectorySnapshot({
          databaseAccountId,
          contacts: payload?.contacts,
          chats: payload?.chats,
          source: payload?.isLatest === false ? 'baileys-history-set-partial' : 'baileys-history-set'
        });
        const messageStats = await ingestWhatsAppHistoryMessages({ databaseAccountId, socket, messages: payload?.messages });
        socketGuard.assertCurrent({ accountId: databaseAccountId, eventName: 'messaging-history.set', phase: 'messages-ingested' });
        const syncType = Number(payload?.syncType ?? -1);
        const onDemandMediaRecovery = syncType === 7 || Boolean(payload?.peerDataRequestSessionId && payload?.isLatest === undefined);
        const result = {
          accountId: databaseAccountId,
          ...directoryStats,
          ...messageStats,
          syncType,
          peerDataRequestSessionId: String(payload?.peerDataRequestSessionId || ''),
          mediaRecoveryOnly: onDemandMediaRecovery,
          isLatest: payload?.isLatest !== false,
          progress: payload?.progress == null ? null : Number(payload.progress),
          durationMs: Date.now() - startedAt
        };
        if (onDemandMediaRecovery) {
          eventBus.publish('whatsapp:history-media-refetched', result);
          logger.info('whatsapp', 'legacy-media-history-sync-completed', result);
        } else {
          eventBus.publish('whatsapp:history-synced', result);
          logger.info('whatsapp', 'history-sync-completed', result);
          this.queueKnownAvatarSync(accountId, databaseAccountId, socket, { reason: 'history-sync' });
        }
      } catch (error) {
        if (!socketGuard.isCurrent() || error?.code === 'SOCKET_GENERATION_STALE') return;
        logger.error('whatsapp', 'history-sync-failed', { accountId: databaseAccountId, errorCode: error.code || error.message });
        eventBus.publish('whatsapp:ingest-error', { accountId: databaseAccountId, scope: 'history', error: error.message });
      }
    });

    onSocket('messages.upsert', async payload => {
      const batch = syncCheckpoint.begin({ platform: 'whatsapp', accountId: databaseAccountId, scopeId: 'messages', payload: { source: payload.type || 'unknown' } });
      let lastRemoteMessageId = '';
      let lastRemoteTimestamp = '';
      let failedMessages = 0;
      for (const info of Array.isArray(payload.messages) ? payload.messages : []) {
        let remoteMessageId = '';
        let claimedConversationId = '';
        let receiptClaimed = false;
        let persisted = false;
        try {
          let message = normalizeIncoming({ accountId: databaseAccountId, info, source: payload.type === 'append' ? 'baileys-history' : 'baileys-live' });
          if (!message) continue;
          message = await enrichWhatsAppMessageIdentity({ socket, databaseAccountId, info, message });
          socketGuard.assertCurrent({ accountId: databaseAccountId, eventName: 'messages.upsert', phase: 'identity-enriched' });
          remoteMessageId = String(message.externalMessageId || info?.key?.id || '').trim();
          claimedConversationId = String(message.conversationId || message.chatJid || '').trim();
          const claim = syncCheckpoint.claimRemoteMessage({ platform: 'whatsapp', accountId: databaseAccountId, remoteMessageId, conversationId: claimedConversationId, messageId: message.id });
          receiptClaimed = claim.claimed === true;
          if (shouldSkipDuplicateReceipt({ claim, message, accountId: databaseAccountId })) continue;
          lastRemoteMessageId = remoteMessageId || lastRemoteMessageId;
          lastRemoteTimestamp = String(message.timestamp || message.sentAt || lastRemoteTimestamp);
          if (message.chatJid && message.direction === 'inbound') {
            this.ensurePresenceSubscription(accountId, message.chatJid).catch(error => {
              logger.warn('whatsapp', 'presence-subscription-failed', { operation: 'ensurePresenceSubscription', accountId: databaseAccountId, conversationId: message.conversationId, reasonCode: error.code || 'WHATSAPP_PRESENCE_SUBSCRIPTION_FAILED', httpStatus: Number(error.status || 0), attempt: 1, nextRetryAt: '' });
            });
          }
          if (message.type === 'reaction') {
            await messageStore.applyReaction({ accountId: databaseAccountId, chatJid: message.chatJid, targetId: message.targetId, emoji: message.text, actor: message.fromMe ? 'me' : message.chatJid });
            socketGuard.assertCurrent({ accountId: databaseAccountId, eventName: 'messages.upsert', phase: 'reaction-persisted' });
            persisted = true;
            continue;
          }
          if (message.type === 'revoke') {
            await messageStore.revoke({ accountId: databaseAccountId, chatJid: message.chatJid, targetId: message.targetId });
            socketGuard.assertCurrent({ accountId: databaseAccountId, eventName: 'messages.upsert', phase: 'revoke-persisted' });
            persisted = true;
            continue;
          }

          let outcome;
          if (message.attachments?.length) {
            const existingTransport = messageStore.getMessageByDedupeKey(message.dedupeKey);
            const existingAttachment = Array.isArray(existingTransport?.attachments) ? existingTransport.attachments[0] : null;
            const existingReady = String(existingAttachment?.downloadStatus || '').toLowerCase() === 'ready' && (existingAttachment?.mediaUrl || existingAttachment?.localFile);
            if (existingReady) {
              message.attachments = [existingAttachment];
              message.mediaUrl = existingTransport.mediaUrl || existingAttachment.mediaUrl || '';
              message.mediaPath = existingTransport.mediaPath || existingAttachment.localFile || '';
              outcome = await messageStore.upsert(message);
              socketGuard.assertCurrent({ accountId: databaseAccountId, eventName: 'messages.upsert', phase: 'message-persisted' });
              persisted = true;
            } else {
              const descriptor = { ...message.attachments[0], status: 'pending', downloadStatus: 'pending', downloadError: '' };
              message.attachments = [descriptor];
              outcome = await messageStore.upsert(message);
              socketGuard.assertCurrent({ accountId: databaseAccountId, eventName: 'messages.upsert', phase: 'message-persisted' });
              persisted = true;
              setImmediate(async () => {
                if (!socketGuard.isCurrent()) return;
                try {
                  const attachment = await mediaPipeline.materializeBaileys({
                    accountId: databaseAccountId,
                    conversationId: message.conversationId,
                    messageId: message.id,
                    info,
                    socket,
                    descriptor
                  });
                  socketGuard.assertCurrent({ accountId: databaseAccountId, eventName: 'messages.upsert', phase: 'media-materialized' });
                  await messageStore.upsert({
                    ...message,
                    attachments: [attachment],
                    mediaUrl: attachment.mediaUrl || '',
                    mediaPath: attachment.localFile || ''
                  });
                  socketGuard.assertCurrent({ accountId: databaseAccountId, eventName: 'messages.upsert', phase: 'media-persisted' });
                  eventBus.publish('whatsapp:media-cached', { accountId: databaseAccountId, conversationId: message.conversationId, messageId: message.externalMessageId || message.id });
                } catch (error) {
                  if (!socketGuard.isCurrent() || error?.code === 'SOCKET_GENERATION_STALE') return;
                  const failedAttachment = {
                    ...descriptor,
                    status: 'failed',
                    downloadStatus: 'failed',
                    downloadError: error.code || error.message || 'WHATSAPP_MEDIA_DOWNLOAD_FAILED'
                  };
                  await messageStore.upsert({ ...message, attachments: [failedAttachment] }).catch(persistError => {
                    logger.error('whatsapp', 'media-failure-state-persist-failed', { accountId: databaseAccountId, conversationId: message.conversationId, messageId: message.externalMessageId || message.id, error: persistError.message });
                  });
                  if (!socketGuard.isCurrent()) return;
                  eventBus.publish('whatsapp:media-cache-failed', { accountId: databaseAccountId, conversationId: message.conversationId, messageId: message.externalMessageId || message.id, error: error.message, code: error.code || 'WHATSAPP_MEDIA_DOWNLOAD_FAILED' });
                  logger.warn('whatsapp', 'media-cache-task-failed', { accountId: databaseAccountId, conversationId: message.conversationId, messageId: message.externalMessageId || message.id, errorCode: error.code || error.message });
                }
              });
            }
          } else {
            outcome = await messageStore.upsert(message);
            socketGuard.assertCurrent({ accountId: databaseAccountId, eventName: 'messages.upsert', phase: 'message-persisted' });
            persisted = true;
          }

          socketGuard.assertCurrent({ accountId: databaseAccountId, eventName: 'messages.upsert', phase: 'before-visible-effects' });
          if (message.direction === 'inbound' && message.chatJid) {
            const task = this.avatarTaskForConversation({
              adapterAccountId: accountId,
              databaseAccountId,
              socket,
              conversation: { ...(outcome.conversation || {}), id: message.conversationId, chatJid: message.rawMeta?.canonicalJid || message.chatJid, contactId: message.contactId || outcome.conversation?.contactId || '' },
              reason: outcome.inserted ? 'new-contact-message' : 'inbound-message'
            });
            avatarService.enqueueWhatsApp(task).then(result => {
              if (result?.avatarUrl) recordWhatsAppAvatarIdentity({
                accountId: databaseAccountId,
                aliases: task.jidCandidates,
                canonicalJid: result.resolvedJid || task.jid,
                avatarUrl: result.avatarUrl,
                source: 'whatsapp-profile'
              });
            }).catch(error => logger.warn('whatsapp', 'avatar-queue-failed', { accountId: databaseAccountId, conversationId: message.conversationId, jidHash: require('crypto').createHash('sha256').update(task.jid).digest('hex').slice(0, 16), errorCode: error.code || error.message }));
          }
          const avatarUrl = outcome.conversation?.avatarUrl || message.avatarUrl || '';
          if (outcome.inserted && message.direction === 'inbound') {
            const notificationConversation = outcome.conversation || {};
            const notificationMessage = outcome.message || message;
            notificationPolicy.notify({
              accountId: databaseAccountId,
              platform: 'whatsapp',
              conversationId: message.conversationId,
              sessionKey: message.conversationId,
              chatJid: message.chatJid,
              title: notificationConversation.title || notificationConversation.contactName || message.senderName || message.sender || 'WhatsApp 新消息',
              senderName: notificationConversation.title || notificationConversation.contactName || message.senderName || message.sender || '',
              body: notificationMessage.text || message.text || `[${message.type}]`,
              messagePreview: notificationMessage.text || message.text || `[${message.type}]`,
              messageId: notificationMessage.externalMessageId || notificationMessage.id || message.id,
              mediaType: notificationMessage.type || message.type,
              avatarUrl: notificationConversation.avatarUrl || avatarUrl || ''
            });
          }
        } catch (error) {
          if (!socketGuard.isCurrent() || error?.code === 'SOCKET_GENERATION_STALE') return;
          failedMessages += 1;
          if (receiptClaimed && !persisted) {
            try {
              syncCheckpoint.releaseRemoteMessage({ platform: 'whatsapp', accountId: databaseAccountId, remoteMessageId, conversationId: claimedConversationId });
            } catch (releaseError) {
              logger.warn('whatsapp', 'message-receipt-release-failed', { accountId: databaseAccountId, messageId: remoteMessageId, error: releaseError.message });
            }
          }
          logger.error('whatsapp', 'message-ingest-failed', { accountId, messageId: info?.key?.id, error: error.message });
          eventBus.publish('whatsapp:ingest-error', { accountId, messageId: info?.key?.id || '', error: error.message });
        }
      }
      if (!socketGuard.isCurrent()) return;
      try {
        if (failedMessages > 0) {
          syncCheckpoint.fail({ platform: 'whatsapp', accountId: databaseAccountId, scopeId: 'messages', batchId: batch.batchId, error: `${failedMessages} message(s) failed`, payload: { source: payload.type || 'unknown', failedMessages, lastRemoteMessageId, lastRemoteTimestamp } });
        } else {
          syncCheckpoint.commit({ platform: 'whatsapp', accountId: databaseAccountId, scopeId: 'messages', batchId: batch.batchId, remoteMessageId: lastRemoteMessageId, remoteTimestamp: lastRemoteTimestamp, payload: { source: payload.type || 'unknown', failedMessages: 0 } });
        }
      } catch (error) {
        syncCheckpoint.fail({ platform: 'whatsapp', accountId: databaseAccountId, scopeId: 'messages', batchId: batch.batchId, error: error.message });
        logger.warn('whatsapp', 'sync-checkpoint-commit-failed', { accountId: databaseAccountId, error: error.message });
      }
    });

    onSocket('lid-mapping.update', async mapping => {
      const lid = historyJid(mapping?.lid || '');
      const pn = historyJid(mapping?.pn || '');
      if (!lid || !pn) return;
      try {
        whatsappIdentityAuthority.record({ accountId: databaseAccountId, aliases: [lid, pn], canonicalJid: pn, source: 'baileys-lid-mapping' });
        const identity = await resolveWhatsAppPeerIdentity({ socket, databaseAccountId, jid: lid });
        socketGuard.assertCurrent({ accountId: databaseAccountId, eventName: 'lid-mapping.update', phase: 'identity-resolved' });
        const mergeReport = whatsappConversationMerge.mergeConversationAliases({ accountId: databaseAccountId, aliases: [lid, pn, ...(identity.aliases || [])], canonicalJid: pn });
        const rows = messageStore.listConversations({ limit: 2000 }).filter(item => item.platform === 'whatsapp' && item.accountId === databaseAccountId && historyJid(item.chatJid || item.externalId || '') === lid);
        await Promise.all(rows.map(item => messageStore.updateConversationMetadata(item.id || item.sessionKey || item.conversationId, {
          contactId: identity.contactId,
          title: identity.displayName,
          contactName: identity.displayName,
          canonicalJid: pn
        })));
        socketGuard.assertCurrent({ accountId: databaseAccountId, eventName: 'lid-mapping.update', phase: 'metadata-persisted' });
        eventBus.publish('contacts:identity-resolved', { accountId: databaseAccountId, platform: 'whatsapp', lid, pn, displayName: identity.displayName, contactId: mergeReport?.contactId || identity.contactId, conversationId: mergeReport?.conversationId || `${databaseAccountId}:${pn}` });
      } catch (error) {
        if (!socketGuard.isCurrent() || error?.code === 'SOCKET_GENERATION_STALE') return;
        logger.warn('whatsapp', 'lid-mapping-reconcile-failed', { accountId: databaseAccountId, errorCode: error.code || error.message });
      }
    });

    onSocket('presence.update', payload => {
      const chatJid = String(payload?.id || '').trim();
      if (!chatJid) return;
      const presences = payload?.presences && typeof payload.presences === 'object' ? payload.presences : {};
      for (const [participant, presence] of Object.entries(presences)) {
        if (row.user?.id && normalizeWhatsAppIdentity(participant) === normalizeWhatsAppIdentity(row.user.id)) continue;
        const state = String(presence?.lastKnownPresence || presence?.presence || '').trim().toLowerCase();
        if (!state) continue;
        const requestedConversationId = `${databaseAccountId}:${chatJid}`;
        const terminalState = ['available', 'online'].includes(state) ? 'available' : (['unavailable', 'offline'].includes(state) ? 'unavailable' : '');
        const lastSeenAt = optionalTimestampIso(presence?.lastSeen);
        const isGroup = /@g\.us$/i.test(chatJid);
        const publishPresence = conversation => {
          if (!socketGuard.isCurrent()) return;
          const conversationId = String(conversation?.id || conversation?.sessionKey || conversation?.conversationId || requestedConversationId);
          eventBus.publish('conversation:presence', {
            platform: 'whatsapp',
            accountId: databaseAccountId,
            conversationId,
            chatJid,
            participant,
            state,
            lastSeen: lastSeenAt || null,
            at: new Date().toISOString(),
            contactId: conversation?.contactId || '',
            title: conversation?.title || conversation?.contactName || '',
            senderName: conversation?.title || conversation?.contactName || '',
            avatarUrl: conversation?.avatarUrl || conversation?.avatar_url || '',
            notificationEligible: !isGroup,
            presenceScope: isGroup ? 'group-participant' : 'direct-contact'
          });
        };
        const conversation = messageStore.getConversation(requestedConversationId);
        if (!terminalState || !conversation) { publishPresence(conversation); continue; }
        messageStore.updateConversationMetadata(conversation.id || conversation.sessionKey || requestedConversationId, {
          online: terminalState === 'available',
          presence: terminalState,
          presenceState: terminalState === 'available' ? 'online' : 'offline',
          presenceUpdatedAt: new Date().toISOString(),
          lastSeenAt: lastSeenAt || conversation.lastSeenAt || conversation.last_seen_at || ''
        }).then(updated => {
          socketGuard.assertCurrent({ accountId: databaseAccountId, eventName: 'presence.update', phase: 'metadata-persisted' });
          publishPresence(updated);
        }).catch(error => {
          if (!socketGuard.isCurrent() || error?.code === 'SOCKET_GENERATION_STALE') return;
          logger.warn('whatsapp', 'presence-persist-failed', { accountId: databaseAccountId, conversationId: requestedConversationId, errorCode: error.code || 'WHATSAPP_PRESENCE_PERSIST_FAILED', error: error.message });
          publishPresence(conversation);
        });
      }
    });

    onSocket('messages.update', async rows => {
      for (const rowUpdate of Array.isArray(rows) ? rows : []) {
        const id = rowUpdate.key?.id;
        const remoteJid = rowUpdate.key?.remoteJid;
        const status = rowUpdate.update?.status;
        if (!id || !remoteJid || status == null) continue;
        await messageStore.updateReceipt({ accountId: databaseAccountId, chatJid: remoteJid, messageId: id, status }).catch(error => logger.warn('whatsapp', 'receipt-persist-failed', { accountId: databaseAccountId, messageId: id, error: error.message }));
        socketGuard.assertCurrent({ accountId: databaseAccountId, eventName: 'messages.update', phase: 'receipt-persisted' });
        eventBus.publish('message:receipt', { accountId: databaseAccountId, messageId: id, chatJid: remoteJid, status });
      }
    });

    onSocket('message-receipt.update', rows => {
      eventBus.publish('message:receipt-batch', { accountId: databaseAccountId, rows: Array.isArray(rows) ? rows.length : 0 });
    });

    onSocket('chats.upsert', rows => {
      const persisted = persistWhatsAppDirectorySnapshot({ databaseAccountId, chats: rows, source: 'chats.upsert' });
      eventBus.publish('conversations:upsert', { accountId: databaseAccountId, platform: 'whatsapp', rows, persisted });
      this.queueAvatarRows(accountId, databaseAccountId, socket, rows, 'chats.upsert').catch(error => logger.warn('whatsapp', 'avatar-chat-upsert-failed', { accountId: databaseAccountId, errorCode: error.code || error.message }));
    });
    onSocket('chats.update', rows => {
      const persisted = persistWhatsAppDirectorySnapshot({ databaseAccountId, chats: rows, source: 'chats.update' });
      eventBus.publish('conversations:update', { accountId: databaseAccountId, platform: 'whatsapp', rows, persisted });
      this.queueAvatarRows(accountId, databaseAccountId, socket, rows, 'chats.update').catch(error => logger.warn('whatsapp', 'avatar-chat-update-failed', { accountId: databaseAccountId, errorCode: error.code || error.message }));
    });
    onSocket('contacts.upsert', rows => {
      const persisted = persistWhatsAppDirectorySnapshot({ databaseAccountId, contacts: rows, source: 'contacts.upsert' });
      eventBus.publish('contacts:upsert', { accountId: databaseAccountId, rows, persisted });
      this.queueAvatarRows(accountId, databaseAccountId, socket, rows, 'contacts.upsert').catch(error => logger.warn('whatsapp', 'avatar-contact-upsert-failed', { accountId: databaseAccountId, errorCode: error.code || error.message }));
    });
    onSocket('contacts.update', rows => {
      const persisted = persistWhatsAppDirectorySnapshot({ databaseAccountId, contacts: rows, source: 'contacts.update' });
      eventBus.publish('contacts:update', { accountId: databaseAccountId, rows, persisted });
      this.queueAvatarRows(accountId, databaseAccountId, socket, rows, 'contacts.update').catch(error => logger.warn('whatsapp', 'avatar-contact-update-failed', { accountId: databaseAccountId, errorCode: error.code || error.message }));
    });

    assertOperationActive(options.signal, 'WHATSAPP_CONNECT_ABORTED', { accountId: databaseAccountId, attemptId: row.attemptId });
    options.signal?.removeEventListener?.('abort', onOperationAbort);
    return this.publicAccount(accountId, row);
  }

  async retryMedia({ accountId, conversationId, messageId } = {}) {
    const adapterAccountId = this.resolveAccountKey(accountId);
    const row = this.accounts.get(adapterAccountId) || [...this.accounts.values()].find(item => item.databaseAccountId === accountId);
    if (!row?.socket) throw Object.assign(new Error('WhatsApp账号未连接，无法恢复媒体'), { code: 'WHATSAPP_NOT_CONNECTED', status: 409 });
    const databaseAccountId = row.databaseAccountId || accountId;
    const immediate = whatsappHistoryMediaRecovery.queue.retryStored({ accountId: databaseAccountId, conversationId, messageId, socket: row.socket });
    if (immediate.queued) return { ok: true, mode: 'durable-envelope', ...immediate };
    if (immediate.reason !== 'media-envelope-missing') return { ok: false, ...immediate };
    const requested = await requestLegacyWhatsAppMediaHistory({ databaseAccountId, socket: row.socket, targetConversationId: conversationId, targetMessageId: messageId, maxRequests: 1, count: 50 });
    return { ok: requested.requested > 0, mode: 'history-refetch', ...requested };
  }

  publicAccount(accountId, row = this.accounts.get(accountId)) {
    if (!row) return null;
    return {
      accountId,
      state: row.state,
      connectedAt: row.connectedAt || '',
      lastError: row.lastError || '',
      qrReady: authChallenges.status(row.databaseAccountId || accountId).ready,
      qrExpiresAt: authChallenges.status(row.databaseAccountId || accountId).expiresAt,
      qrVersion: authChallenges.status(row.databaseAccountId || accountId).version,
      user: row.user || null,
      attemptId: String(row.attemptId || ''),
      identityReconciliationRunning: row.identityReconciliationRunning === true,
      identityReconciliationLastAt: row.identityReconciliationLastAt || '',
      identityReconciliationLastError: row.identityReconciliationLastError || '',
      identityReconciliationLastResult: row.identityReconciliationLastResult || null
    };
  }

  async sync(accountId = 'account-a', options = {}) {
    assertOperationActive(options.signal, 'WHATSAPP_SYNC_ABORTED');
    accountId = this.resolveAccountKey(accountId);
    const row = this.accounts.get(accountId);
    const databaseAccountId = row?.databaseAccountId || this.accountByAdapterId(accountId)?.id || accountId;
    requirePersistedWhatsAppOperation(options.physicalOperationContext, { accountId: databaseAccountId, operation: 'sync' });
    if (!row?.socket) throw Object.assign(new Error('WhatsApp账号未连接'), { code: 'WHATSAPP_NOT_CONNECTED', status: 409 });
    let appStateRefreshed = false;
    if (typeof row.socket.resyncAppState === 'function' && Array.isArray(row.appStateCollections) && row.appStateCollections.length) {
      try {
        await row.socket.resyncAppState(row.appStateCollections, true);
        assertOperationActive(options.signal, 'WHATSAPP_SYNC_ABORTED', { accountId: databaseAccountId });
        appStateRefreshed = true;
        await new Promise(resolve => setTimeout(resolve, 1200));
        assertOperationActive(options.signal, 'WHATSAPP_SYNC_ABORTED', { accountId: databaseAccountId });
      } catch (error) {
        logger.warn('whatsapp', 'manual-app-state-resync-failed', { accountId: databaseAccountId, errorCode: error.code || error.message });
      }
    }
    const identityStats = await this.reconcileKnownIdentities(accountId, databaseAccountId, row.socket, { force: true, reason: 'manual-sync', signal: options.signal, executionGeneration: options.executionGeneration || options.operationGeneration || '' });
    assertOperationActive(options.signal, 'WHATSAPP_SYNC_ABORTED', { accountId: databaseAccountId });
    const tasks = this.avatarTasksForKnownConversations(accountId, databaseAccountId, row.socket, { force: true, reason: 'manual-sync' });
    for (const task of tasks) this.ensurePresenceSubscription(accountId, task.jid).catch(error => {
      logger.warn('whatsapp', 'manual-sync-presence-subscription-failed', { operation: 'ensurePresenceSubscription', accountId: databaseAccountId, conversationId: task.conversationId, reasonCode: error.code || 'WHATSAPP_PRESENCE_SUBSCRIPTION_FAILED', httpStatus: Number(error.status || 0), attempt: 1, nextRetryAt: '' });
    });
    assertOperationActive(options.signal, 'WHATSAPP_SYNC_ABORTED', { accountId: databaseAccountId });
    const avatarStats = await avatarService.syncWhatsAppContacts(tasks, {
      signal: options.signal,
      executionGeneration: options.executionGeneration || options.operationGeneration || ''
    });
    assertOperationActive(options.signal, 'WHATSAPP_SYNC_ABORTED', { accountId: databaseAccountId });
    const syncedAt = new Date().toISOString();
    await Promise.all(tasks.map(task => {
      assertOperationActive(options.signal, 'WHATSAPP_SYNC_ABORTED', { accountId: databaseAccountId, conversationId: task.conversationId });
      return messageStore.updateConversationMetadata(task.conversationId, {
      accountId: databaseAccountId,
      platform: 'whatsapp',
      chatJid: task.jid,
      lastSyncAt: syncedAt
      }).catch(error => logger.warn('whatsapp', 'conversation-sync-metadata-failed', { accountId: databaseAccountId, conversationId: task.conversationId, errorCode: error.code || error.message }));
    }));
    assertOperationActive(options.signal, 'WHATSAPP_SYNC_ABORTED', { accountId: databaseAccountId });
    const result = { conversations: tasks.length, appStateRefreshed, identityStats, syncedAt, ...avatarStats };
    logger.info('whatsapp', 'manual-sync-completed', { accountId: databaseAccountId, ...result });
    return result;
  }

  async stop(accountId = 'account-a', logout = false) {
    accountId = this.resolveAccountKey(accountId);
    const row = this.accounts.get(accountId);
    this.stoppedAccounts.add(accountId);
    this.generations.set(accountId, Number(this.generations.get(accountId) || 0) + 1);
    if (!row) return { ok: true, state: 'stopped' };
    this.stopping.add(accountId);
    clearStartupWatchdog(row);
    const stoppingSocket = row.socket;
    row.state = logout ? 'logging-out' : 'stopping';
    row.socket = null;
    if (typeof row.sessionFence?.invalidate !== 'function' || typeof row.sessionFence?.drain !== 'function') {
      throw Object.assign(new Error('WhatsApp runtime row is missing generation drain custody'), { code: 'SESSION_GENERATION_FENCE_INVALID' });
    }
    row.sessionFence.invalidate(logout ? 'WHATSAPP_LOGOUT' : 'WHATSAPP_STOP');
    try {
      if (logout && stoppingSocket?.logout) await stoppingSocket.logout();
      else stoppingSocket?.end?.(new Error('YANCE_STOP'));
    } catch (error) {
      logger.warn('whatsapp', 'account-stop-failed', { operation: logout ? 'socket.logout' : 'socket.end', accountId: row.databaseAccountId || accountId, reasonCode: error.code || 'WHATSAPP_ACCOUNT_STOP_FAILED', httpStatus: Number(error.status || 0), attempt: 1, nextRetryAt: '' });
    }
    await row.sessionFence.drain();
    authChallenges.clear(row.databaseAccountId || accountId);
    this.invalidateCredentialState(row.databaseAccountId || accountId);
    this.accounts.delete(accountId);
    eventBus.publish('whatsapp:state', { accountId, state: 'stopped' });
    return { ok: true, state: 'stopped' };
  }

  async restart(accountId = 'account-a') {
    const stableKey = this.resolveAccountKey(accountId);
    await this.stop(stableKey, false);
    return this.start(stableKey);
  }

  bindEgressAbort(accountId, row, signal, executionGeneration = '') {
    if (!signal || typeof signal.addEventListener !== 'function') return () => {};
    const onAbort = () => {
      if (this.accounts.get(accountId) !== row || !row?.socket) return;
      const reason = signal.reason instanceof Error
        ? signal.reason
        : Object.assign(new Error('WhatsApp egress generation aborted'), { code: 'WHATSAPP_EGRESS_ABORTED' });
      row.egressDeadlineGeneration = String(executionGeneration || '').trim();
      row.egressDeadlineAt = new Date().toISOString();
      try { row.socket.end?.(reason); }
      catch (error) {
        logger.warn('whatsapp', 'egress-generation-socket-close-failed', {
          accountId: row.databaseAccountId || accountId,
          adapterAccountId: accountId,
          executionGeneration: row.egressDeadlineGeneration,
          code: error?.code || '',
          error: error?.message || String(error)
        });
      }
      eventBus.publish('whatsapp:egress-generation-quarantined', {
        accountId: row.databaseAccountId || accountId,
        adapterAccountId: accountId,
        executionGeneration: row.egressDeadlineGeneration,
        reasonCode: reason.code || 'WHATSAPP_EGRESS_ABORTED',
        at: row.egressDeadlineAt
      });
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
    return () => signal.removeEventListener?.('abort', onAbort);
  }

  assertEgressGenerationCurrent(accountId, row, expectedSocket, expectedRowGeneration, signal, executionGeneration, result = null, operation = 'egress') {
    const platformMessageId = String(result?.key?.id || result?.messageId || result?.id || '').trim();
    const current = this.accounts.get(accountId);
    const stale = signal?.aborted
      || current !== row
      || row?.socket !== expectedSocket
      || Number(row?.generation || this.generations.get(accountId) || 0) !== Number(expectedRowGeneration || 0)
      || (String(row?.egressDeadlineGeneration || '').trim()
        && String(row.egressDeadlineGeneration).trim() === String(executionGeneration || '').trim());
    if (!stale) return true;
    const reason = signal?.reason instanceof Error ? signal.reason : new Error('WhatsApp egress result belongs to an expired generation');
    const error = Object.assign(reason, {
      code: reason.code || 'WHATSAPP_EGRESS_LATE_RESULT_QUARANTINED',
      platformAccepted: Boolean(platformMessageId),
      platformMessageId,
      lateResult: true,
      automaticRetryBlocked: true,
      executionGeneration: String(executionGeneration || '').trim(),
      operation
    });
    eventBus.publish('whatsapp:egress-late-result-quarantined', {
      accountId: row?.databaseAccountId || accountId, adapterAccountId: accountId,
      operation, executionGeneration: error.executionGeneration, platformMessageId,
      platformAccepted: error.platformAccepted, reasonCode: error.code, at: new Date().toISOString()
    });
    throw error;
  }

  async sendText({ accountId = 'account-a', chatJid, text, quoted, localMessageId = '', sessionKey = '', signal = null, executionGeneration = '', physicalAttemptContext }) {
    accountId = this.resolveAccountKey(accountId);
    const row = this.accounts.get(accountId);
    if (!row?.socket || row.state !== 'online') throw structuredWhatsAppEgressError('WHATSAPP_NOT_CONNECTED', 'WHATSAPP_NOT_CONNECTED', 409);
    const body = String(text || '').trim();
    if (!body) throw structuredWhatsAppEgressError('MESSAGE_TEXT_EMPTY', 'MESSAGE_TEXT_EMPTY', 400);
    const databaseAccountId = row.databaseAccountId || this.accountByAdapterId(accountId)?.id || accountId;
    validatePersistedEgressContext(physicalAttemptContext, { accountId: databaseAccountId, idempotencyKey: String(physicalAttemptContext?.idempotencyKey || '').trim() }, 'whatsapp');
    const expectedSocket = row.socket;
    const expectedRowGeneration = Number(row.generation || this.generations.get(accountId) || 0);
    const target = canonicalWhatsAppTarget(databaseAccountId, chatJid, sessionKey);
    const detachAbort = this.bindEgressAbort(accountId, row, signal, executionGeneration);
    let result;
    try {
      result = await performWhatsAppProviderEgress(
        () => expectedSocket.sendMessage(target.chatJid, { text: body }, quoted ? { quoted } : undefined),
        { accountId: databaseAccountId, operation: 'text', signal }
      );
      this.assertEgressGenerationCurrent(accountId, row, expectedSocket, expectedRowGeneration, signal, executionGeneration, result, 'text');
    } finally { detachAbort(); }
    const messageId = result?.key?.id || '';
    this.assertEgressGenerationCurrent(accountId, row, expectedSocket, expectedRowGeneration, signal, executionGeneration, result, 'text');
    const conversationId = target.conversationId;
    const localMessage = {
      id: localMessageId || messageId || undefined,
      dedupeKey: localMessageId || undefined,
      externalMessageId: messageId,
      accountId: databaseAccountId,
      conversationId,
      sessionKey: conversationId,
      chatJid: target.chatJid,
      contactId: target.contactId,
      contactName: target.displayName,
      avatarUrl: target.avatarUrl,
      platform: 'whatsapp',
      direction: 'outbound',
      fromMe: true,
      sender: row.user?.name || '我',
      senderName: row.user?.name || '我',
      type: 'text',
      text: body,
      quotedMessageId: quoted?.key?.id || quoted?.id || '',
      rawMessage: result?.message || null,
      timestamp: new Date().toISOString(),
      deliveryStatus: 'sent'
    };
    let localPersistencePending = false;
    let localPersistenceErrorCode = '';
    try {
      await messageStore.upsert(localMessage);
    } catch (error) {
      localPersistencePending = true;
      localPersistenceErrorCode = String(error.code || error.message || 'WHATSAPP_LOCAL_PERSISTENCE_FAILED').trim().split(/\s+/u)[0];
      logger.error('whatsapp', 'outbound-platform-accepted-local-persistence-pending', { accountId: databaseAccountId, conversationId, localMessageId, platformMessageId: messageId, code: localPersistenceErrorCode, error: error.message });
      eventBus.publish('message:local-persistence-pending', { platform: 'whatsapp', accountId: databaseAccountId, conversationId, localMessageId, platformMessageId: messageId, code: localPersistenceErrorCode });
    }
    eventBus.publish('message:outbound-sent', { accountId: databaseAccountId, chatJid: target.chatJid, conversationId, messageId });
    return {
      ...result,
      localPersistencePending,
      localPersistenceErrorCode,
      localPersistenceRepair: localPersistencePending ? { kind: 'message-upsert', message: localMessage } : null
    };
  }

  async markRead({ accountId = 'account-a', chatJid, messageKeys = [], signal = null, executionGeneration = '', physicalAttemptContext }) {
    accountId = this.resolveAccountKey(accountId);
    const row = this.accounts.get(accountId);
    if (!row?.socket || row.state !== 'online') throw structuredWhatsAppEgressError('WHATSAPP_NOT_CONNECTED', 'WHATSAPP_NOT_CONNECTED', 409);
    const databaseAccountId = row.databaseAccountId || this.accountByAdapterId(accountId)?.id || accountId;
    validatePersistedEgressContext(physicalAttemptContext, { accountId: databaseAccountId, idempotencyKey: String(physicalAttemptContext?.idempotencyKey || '').trim() }, 'whatsapp');
    const keys = (Array.isArray(messageKeys) ? messageKeys : []).filter(key => key && key.id).map(key => ({ remoteJid: key.remoteJid || chatJid, id: key.id, fromMe: Boolean(key.fromMe), participant: key.participant || undefined }));
    if (!keys.length) return { read: 0 };
    const expectedSocket = row.socket;
    const expectedRowGeneration = Number(row.generation || this.generations.get(accountId) || 0);
    const detachAbort = this.bindEgressAbort(accountId, row, signal, executionGeneration);
    try {
      await performWhatsAppProviderEgress(
        () => expectedSocket.readMessages(keys),
        { accountId: databaseAccountId, operation: 'read', signal }
      );
      this.assertEgressGenerationCurrent(accountId, row, expectedSocket, expectedRowGeneration, signal, executionGeneration, null, 'read');
    } finally {
      detachAbort();
    }
    this.assertEgressGenerationCurrent(accountId, row, expectedSocket, expectedRowGeneration, signal, executionGeneration, null, 'read');
    eventBus.publish('conversation:platform-read', { accountId: row.databaseAccountId || this.accountByAdapterId(accountId)?.id || accountId, chatJid, count: keys.length });
    return { read: keys.length };
  }

  async subscribeKnownConversations(accountId = 'account-a', limit = 250) {
    accountId = this.resolveAccountKey(accountId);
    const row = this.accounts.get(accountId);
    if (!row?.socket || row.state !== 'online') return { subscribed: 0, attempted: 0 };
    const databaseAccountId = row.databaseAccountId || this.accountByAdapterId(accountId)?.id || accountId;
    const conversations = messageStore.listConversations()
      .filter(item => item.platform === 'whatsapp' && (
        item.accountId === databaseAccountId
        || item.accountId === accountId
        || item.adapterAccountId === accountId
      ))
      .slice(0, Math.max(1, Math.min(1000, Number(limit || 250))));
    let subscribed = 0;
    for (const conversation of conversations) {
      const jid = String(conversation.chatJid || conversation.externalId || conversation.id?.split(':').slice(1).join(':') || '').trim();
      if (!jid) continue;
      const result = await this.ensurePresenceSubscription(accountId, jid).catch(() => ({ subscribed: false }));
      if (result.subscribed) subscribed += 1;
    }
    return { subscribed, attempted: conversations.length };
  }

  async ensurePresenceSubscription(accountId = 'account-a', chatJid = '') {
    accountId = this.resolveAccountKey(accountId);
    const row = this.accounts.get(accountId);
    const jid = String(chatJid || '').trim();
    if (!row?.socket || row.state !== 'online' || !jid) return { subscribed: false };
    row.presenceSubscriptions ||= new Set();
    if (row.presenceSubscriptions.has(jid)) return { subscribed: true, cached: true };
    if (typeof row.socket.presenceSubscribe !== 'function') return { subscribed: false, reason: 'UNSUPPORTED' };
    await row.socket.presenceSubscribe(jid);
    row.presenceSubscriptions.add(jid);
    return { subscribed: true, cached: false };
  }

  async sendPresence({ accountId = 'account-a', chatJid, state = 'composing', signal = null, executionGeneration = '', physicalAttemptContext }) {
    accountId = this.resolveAccountKey(accountId);
    const row = this.accounts.get(accountId);
    if (!row?.socket || row.state !== 'online') throw structuredWhatsAppEgressError('WHATSAPP_NOT_CONNECTED', 'WHATSAPP_NOT_CONNECTED', 409);
    const databaseAccountId = row.databaseAccountId || this.accountByAdapterId(accountId)?.id || accountId;
    validatePersistedEgressContext(physicalAttemptContext, { accountId: databaseAccountId, idempotencyKey: String(physicalAttemptContext?.idempotencyKey || '').trim() }, 'whatsapp');
    const allowed = new Set(['available', 'unavailable', 'composing', 'recording', 'paused']);
    const presence = allowed.has(String(state)) ? String(state) : 'paused';
    const expectedSocket = row.socket;
    const expectedRowGeneration = Number(row.generation || this.generations.get(accountId) || 0);
    const detachAbort = this.bindEgressAbort(accountId, row, signal, executionGeneration);
    try {
      if (chatJid) await this.ensurePresenceSubscription(accountId, chatJid).catch(error => {
        logger.warn('whatsapp', 'send-presence-subscription-failed', { operation: 'ensurePresenceSubscription', accountId: row.databaseAccountId || accountId, conversationId: `${row.databaseAccountId || accountId}:${chatJid}`, reasonCode: error.code || 'WHATSAPP_PRESENCE_SUBSCRIPTION_FAILED', httpStatus: Number(error.status || 0), attempt: 1, nextRetryAt: '' });
      });
      await performWhatsAppProviderEgress(
        () => expectedSocket.sendPresenceUpdate(presence, chatJid),
        { accountId: databaseAccountId, operation: 'presence', signal }
      );
      this.assertEgressGenerationCurrent(accountId, row, expectedSocket, expectedRowGeneration, signal, executionGeneration, null, 'presence');
    } finally {
      detachAbort();
    }
    this.assertEgressGenerationCurrent(accountId, row, expectedSocket, expectedRowGeneration, signal, executionGeneration, null, 'presence');
    return { state: presence };
  }

  async sendReaction({ accountId = 'account-a', chatJid, targetId, emoji = '', targetFromMe = false, participant = '', signal = null, executionGeneration = '', physicalAttemptContext }) {
    accountId = this.resolveAccountKey(accountId);
    const row = this.accounts.get(accountId);
    if (!row?.socket || row.state !== 'online') throw structuredWhatsAppEgressError('WHATSAPP_NOT_CONNECTED', 'WHATSAPP_NOT_CONNECTED', 409);
    const databaseAccountId = row.databaseAccountId || this.accountByAdapterId(accountId)?.id || accountId;
    validatePersistedEgressContext(physicalAttemptContext, { accountId: databaseAccountId, idempotencyKey: String(physicalAttemptContext?.idempotencyKey || '').trim() }, 'whatsapp');
    const key = { remoteJid: chatJid, id: String(targetId || ''), fromMe: Boolean(targetFromMe) };
    if (participant) key.participant = participant;
    const expectedSocket = row.socket;
    const expectedRowGeneration = Number(row.generation || this.generations.get(accountId) || 0);
    const detachAbort = this.bindEgressAbort(accountId, row, signal, executionGeneration);
    let result;
    try {
      result = await performWhatsAppProviderEgress(
        () => expectedSocket.sendMessage(chatJid, { react: { text: String(emoji || ''), key } }),
        { accountId: databaseAccountId, operation: 'reaction', signal }
      );
      this.assertEgressGenerationCurrent(accountId, row, expectedSocket, expectedRowGeneration, signal, executionGeneration, result, 'reaction');
    } finally {
      detachAbort();
    }
    this.assertEgressGenerationCurrent(accountId, row, expectedSocket, expectedRowGeneration, signal, executionGeneration, result, 'reaction');
    let localPersistencePending = false;
    let localPersistenceErrorCode = '';
    try {
      await messageStore.applyReaction({ accountId: databaseAccountId, chatJid, targetId, emoji, actor: 'me' });
    } catch (error) {
      localPersistencePending = true;
      localPersistenceErrorCode = String(error.code || error.message || 'WHATSAPP_REACTION_LOCAL_PERSISTENCE_FAILED').trim().split(/\s+/u)[0];
      logger.error('whatsapp', 'reaction-platform-accepted-local-persistence-pending', { accountId: databaseAccountId, chatJid, targetId, code: localPersistenceErrorCode, error: error.message });
    }
    eventBus.publish('message:reaction-sent', { accountId: databaseAccountId, chatJid, targetId, emoji, messageId: result?.key?.id || '' });
    return { ...result, localPersistencePending, localPersistenceErrorCode, localPersistenceRepair: localPersistencePending ? { kind: 'reaction-apply', reaction: { accountId: databaseAccountId, chatJid, targetId, emoji, actor: 'me' } } : null };
  }

  async revokeMessage({ accountId = 'account-a', chatJid, targetId, targetFromMe = true, participant = '', signal = null, executionGeneration = '', physicalAttemptContext }) {
    accountId = this.resolveAccountKey(accountId);
    const row = this.accounts.get(accountId);
    if (!row?.socket || row.state !== 'online') throw structuredWhatsAppEgressError('WHATSAPP_NOT_CONNECTED', 'WHATSAPP_NOT_CONNECTED', 409);
    const databaseAccountId = row.databaseAccountId || this.accountByAdapterId(accountId)?.id || accountId;
    validatePersistedEgressContext(physicalAttemptContext, { accountId: databaseAccountId, idempotencyKey: String(physicalAttemptContext?.idempotencyKey || '').trim() }, 'whatsapp');
    const key = { remoteJid: chatJid, id: String(targetId || ''), fromMe: Boolean(targetFromMe) };
    if (participant) key.participant = participant;
    const expectedSocket = row.socket;
    const expectedRowGeneration = Number(row.generation || this.generations.get(accountId) || 0);
    const detachAbort = this.bindEgressAbort(accountId, row, signal, executionGeneration);
    let result;
    try {
      result = await performWhatsAppProviderEgress(
        () => expectedSocket.sendMessage(chatJid, { delete: key }),
        { accountId: databaseAccountId, operation: 'revoke', signal }
      );
      this.assertEgressGenerationCurrent(accountId, row, expectedSocket, expectedRowGeneration, signal, executionGeneration, result, 'revoke');
    } finally {
      detachAbort();
    }
    this.assertEgressGenerationCurrent(accountId, row, expectedSocket, expectedRowGeneration, signal, executionGeneration, result, 'revoke');
    let localPersistencePending = false;
    let localPersistenceErrorCode = '';
    try {
      await messageStore.revoke({ accountId: databaseAccountId, chatJid, targetId });
    } catch (error) {
      localPersistencePending = true;
      localPersistenceErrorCode = String(error.code || error.message || 'WHATSAPP_REVOKE_LOCAL_PERSISTENCE_FAILED').trim().split(/\s+/u)[0];
      logger.error('whatsapp', 'revoke-platform-accepted-local-persistence-pending', { accountId: databaseAccountId, chatJid, targetId, code: localPersistenceErrorCode, error: error.message });
    }
    eventBus.publish('message:revoke-sent', { accountId: databaseAccountId, chatJid, targetId, messageId: result?.key?.id || '' });
    return { ...result, localPersistencePending, localPersistenceErrorCode, localPersistenceRepair: localPersistencePending ? { kind: 'message-revoke', revoke: { accountId: databaseAccountId, chatJid, targetId } } : null };
  }

  async sendMedia({ accountId = 'account-a', chatJid, kind, buffer, filePath = '', mimeType, filename, caption = '', quoted, localMessageId = '', sessionKey = '', expectedSha256 = '', signal = null, executionGeneration = '', physicalAttemptContext }) {
    accountId = this.resolveAccountKey(accountId);
    const row = this.accounts.get(accountId);
    if (!row?.socket || row.state !== 'online') throw structuredWhatsAppEgressError('WHATSAPP_NOT_CONNECTED', 'WHATSAPP_NOT_CONNECTED', 409);
    const hasFile = Boolean(String(filePath || '').trim());
    if (hasFile) mediaPipeline.verifyFile(filePath);
    else mediaPipeline.verifyBuffer(buffer);
    const source = hasFile ? { url: filePath } : buffer;
    const normalizedKind = String(kind || '').toLowerCase();
    const content = normalizedKind === 'image' ? { image: source, mimetype: mimeType, caption }
      : normalizedKind === 'video' || normalizedKind === 'gif' ? { video: source, mimetype: mimeType, caption, gifPlayback: normalizedKind === 'gif' }
      : normalizedKind === 'sticker' ? { sticker: source }
      : normalizedKind === 'voice' || normalizedKind === 'audio' ? { audio: source, mimetype: mimeType, ptt: normalizedKind === 'voice' }
      : { document: source, mimetype: mimeType, fileName: filename || 'file', caption };
    const databaseAccountId = row.databaseAccountId || this.accountByAdapterId(accountId)?.id || accountId;
    validatePersistedEgressContext(physicalAttemptContext, { accountId: databaseAccountId, idempotencyKey: String(physicalAttemptContext?.idempotencyKey || '').trim() }, 'whatsapp');
    const expectedSocket = row.socket;
    const expectedRowGeneration = Number(row.generation || this.generations.get(accountId) || 0);
    const target = canonicalWhatsAppTarget(databaseAccountId, chatJid, sessionKey);
    const detachAbort = this.bindEgressAbort(accountId, row, signal, executionGeneration);
    let result;
    try {
      result = await performWhatsAppProviderEgress(
        () => expectedSocket.sendMessage(target.chatJid, content, quoted ? { quoted } : undefined),
        { accountId: databaseAccountId, operation: 'media', signal }
      );
      this.assertEgressGenerationCurrent(accountId, row, expectedSocket, expectedRowGeneration, signal, executionGeneration, result, 'media');
    } finally {
      detachAbort();
    }
    this.assertEgressGenerationCurrent(accountId, row, expectedSocket, expectedRowGeneration, signal, executionGeneration, result, 'media');
    const messageId = result?.key?.id || `out-${Date.now()}`;
    const conversationId = target.conversationId;
    const descriptor = { kind: normalizedKind || 'document', mimeType: mimeType || 'application/octet-stream', filename: filename || '', caption: String(caption || ''), outgoing: true };
    const localMessage = {
      id: localMessageId || messageId,
      dedupeKey: localMessageId || undefined,
      externalMessageId: messageId,
      accountId: databaseAccountId,
      conversationId,
      sessionKey: conversationId,
      chatJid: target.chatJid,
      contactId: target.contactId,
      contactName: target.displayName,
      avatarUrl: target.avatarUrl,
      platform: 'whatsapp',
      direction: 'outbound',
      fromMe: true,
      sender: row.user?.name || '我',
      senderName: row.user?.name || '我',
      type: normalizedKind || 'document',
      text: String(caption || ''),
      quotedMessageId: quoted?.key?.id || quoted?.id || '',
      rawMessage: result?.message || null,
      timestamp: new Date().toISOString(),
      deliveryStatus: 'sent'
    };
    let localPersistencePending = false;
    let localPersistenceErrorCode = '';
    try {
      const attachment = hasFile
        ? mediaPipeline.saveFile({ accountId: databaseAccountId, conversationId, messageId, filePath, descriptor, expectedSha256 })
        : mediaPipeline.saveBuffer({ accountId: databaseAccountId, conversationId, messageId, buffer, descriptor });
      await messageStore.upsert({ ...localMessage, attachments: [attachment], mediaPath: attachment.localFile, mediaUrl: attachment.mediaUrl });
    } catch (error) {
      localPersistencePending = true;
      localPersistenceErrorCode = String(error.code || error.message || 'WHATSAPP_LOCAL_PERSISTENCE_FAILED').trim().split(/\s+/u)[0];
      logger.error('whatsapp', 'outbound-media-platform-accepted-local-persistence-pending', { accountId: databaseAccountId, conversationId, localMessageId, platformMessageId: messageId, code: localPersistenceErrorCode, error: error.message });
      eventBus.publish('message:local-persistence-pending', { platform: 'whatsapp', accountId: databaseAccountId, conversationId, localMessageId, platformMessageId: messageId, code: localPersistenceErrorCode });
    }
    eventBus.publish('message:outbound-sent', { accountId: databaseAccountId, chatJid: target.chatJid, conversationId, messageId, type: normalizedKind || 'document' });
    return {
      ...result,
      localPersistencePending,
      localPersistenceErrorCode,
      localPersistenceRepair: localPersistencePending ? {
        kind: 'outbound-media-upsert',
        message: localMessage,
        source: hasFile ? { filePath, expectedSha256 } : { bufferBase64: Buffer.from(buffer).toString('base64') },
        descriptor
      } : null
    };
  }
}

const whatsappAdapter = new WhatsAppAdapter();
module.exports = whatsappAdapter;
module.exports.WhatsAppAdapter = WhatsAppAdapter;
module.exports.shouldSkipDuplicateReceipt = shouldSkipDuplicateReceipt;
module.exports.discoverBaileysVersion = discoverBaileysVersion;
module.exports.WHATSAPP_VERSION_DISCOVERY_TIMEOUT_MS = WHATSAPP_VERSION_DISCOVERY_TIMEOUT_MS;
module.exports.WHATSAPP_QR_STARTUP_TIMEOUT_MS = WHATSAPP_QR_STARTUP_TIMEOUT_MS;
module.exports.loadQRCodeDependency = loadQRCodeDependency;

module.exports.historyJid = historyJid;
module.exports.canonicalWhatsAppTarget = canonicalWhatsAppTarget;
module.exports.phoneJidToken = phoneJidToken;
module.exports.isWeakWhatsAppName = isWeakWhatsAppName;
module.exports.whatsappJidCandidates = whatsappJidCandidates;
module.exports.bestWhatsAppDisplayName = bestWhatsAppDisplayName;
module.exports.whatsappContactRecord = whatsappContactRecord;
module.exports.persistWhatsAppDirectorySnapshot = persistWhatsAppDirectorySnapshot;
module.exports.ingestWhatsAppHistoryMessages = ingestWhatsAppHistoryMessages;
module.exports.ownWhatsAppProfile = ownWhatsAppProfile;
module.exports.resolveWhatsAppCanonicalJid = resolveWhatsAppCanonicalJid;
module.exports.resolveWhatsAppPeerIdentity = resolveWhatsAppPeerIdentity;
module.exports.enrichWhatsAppMessageIdentity = enrichWhatsAppMessageIdentity;
module.exports.requestLegacyWhatsAppMediaHistory = requestLegacyWhatsAppMediaHistory;
module.exports.hydrateWhatsAppBusinessProfiles = hydrateWhatsAppBusinessProfiles;

module.exports.optionalTimestampIso = optionalTimestampIso;
