'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');
const { CONFIG, PATHS } = require('../config');
const { getSecurityGuard } = require('../core/securityGuardSingleton');
const securityGuard = getSecurityGuard();
const messageStore = require('./messageStore');
const mediaPipeline = require('./mediaPipeline');
const eventBus = require('./eventBus');
const logger = require('./logger');
const notificationPolicy = require('./notificationPolicy');
const avatarService = require('./avatarService');
const relayClient = require('./facebookRelayClient');
const platformAuthConfig = require('./platformAuthConfig');
const syncCheckpoint = require('./syncCheckpointService');
const { REQUIRED_PAGE_PERMISSIONS, OPTIONAL_PAGE_PERMISSIONS, permissionList } = require('./facebookOAuthService');

function clean(value, fallback = '') { return value == null ? fallback : String(value).trim(); }
function operationAbortError(signal, fallbackCode = 'FACEBOOK_OPERATION_ABORTED', details = {}) {
  const reason = signal?.reason instanceof Error
    ? signal.reason
    : Object.assign(new Error('Facebook operation aborted'), { code: fallbackCode });
  if (!reason.code) reason.code = fallbackCode;
  return Object.assign(reason, details);
}
function assertOperationActive(signal, fallbackCode = 'FACEBOOK_OPERATION_ABORTED', details = {}) {
  if (signal?.aborted) throw operationAbortError(signal, fallbackCode, details);
}
function requirePersistedLegacyFacebookOperation(options = {}, account = {}) {
  const persisted = relayClient.persistedOperationIdentity(options);
  const accountId = clean(account?.id || account);
  if (persisted.accountId && accountId && persisted.accountId !== accountId) {
    throw Object.assign(new Error('Facebook legacy adapter persisted operation account scope mismatch'), {
      code: 'FACEBOOK_LEGACY_PERSISTED_OPERATION_SCOPE_MISMATCH', status: 409, accountId, persistedAccountId: persisted.accountId
    });
  }
  return persisted;
}
function localAvatarFallback(value) { const avatar = clean(value); return avatar && !/^https?:\/\//iu.test(avatar) ? avatar : ''; }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0))); }
async function retrySqliteBusy(operation, work, options = {}) {
  const attempts = boundedInteger(options.attempts, 12, 1, 30);
  const baseDelayMs = boundedInteger(options.baseDelayMs, 40, 1, 1000);
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    assertOperationActive(options.signal, 'FACEBOOK_SYNC_ABORTED', { operation, attempt });
    try {
      const result = await work();
      assertOperationActive(options.signal, 'FACEBOOK_SYNC_ABORTED', { operation, attempt });
      return result;
    }
    catch (error) {
      lastError = error;
      if (clean(error?.code) !== 'SQLITE_TRANSACTION_BUSY_CONTEXT' || attempt === attempts) throw error;
      const delayMs = Math.min(500, baseDelayMs * (2 ** Math.min(attempt - 1, 4)));
      logger.warn('facebook', 'history-sync-sqlite-write-retrying', {
        operation, attempt, attempts, delayMs, code: clean(error?.code)
      });
      await sleep(delayMs);
      assertOperationActive(options.signal, 'FACEBOOK_SYNC_ABORTED', { operation, attempt });
    }
  }
  throw lastError;
}
function avatarErrorEvidence(error = {}) {
  const details = error.details && typeof error.details === 'object' ? error.details : {};
  const pictureEdgeCode = clean(details.pictureEdgeCode || details.primaryCode);
  const pictureEdgeStatus = Number(details.pictureEdgeStatus || details.primaryStatus || 0) || 0;
  const profileCode = clean(details.profileCode || details.messengerProfileCode);
  const profileStatus = Number(details.profileStatus || details.messengerProfileStatus || 0) || 0;
  return {
    code: clean(error.code || error.message, 'FACEBOOK_AVATAR_FAILED'),
    status: Number(error.status || 0) || 0,
    requestId: clean(details.requestId || error.requestId),
    pictureEdgeCode,
    pictureEdgeStatus,
    pictureEdgeMetaCode: Number(details.pictureEdgeMetaCode || 0) || 0,
    pictureEdgeMetaSubcode: Number(details.pictureEdgeMetaSubcode || 0) || 0,
    pictureEdgeMetaReason: clean(details.pictureEdgeMetaReason),
    identityPictureCode: clean(details.identityPictureCode),
    identityPictureStatus: Number(details.identityPictureStatus || 0) || 0,
    identityPictureMetaCode: Number(details.identityPictureMetaCode || 0) || 0,
    identityPictureMetaSubcode: Number(details.identityPictureMetaSubcode || 0) || 0,
    identityPictureMetaReason: clean(details.identityPictureMetaReason),
    profileCode,
    profileStatus,
    profileMetaCode: Number(details.profileMetaCode || 0) || 0,
    profileMetaSubcode: Number(details.profileMetaSubcode || 0) || 0,
    profileMetaReason: clean(details.profileMetaReason),
    profileDiagnosis: clean(details.diagnosis),
    profileOriginalCode: clean(details.originalCode),
    primaryCode: pictureEdgeCode,
    primaryStatus: pictureEdgeStatus,
    messengerProfileCode: profileCode,
    messengerProfileStatus: profileStatus
  };
}
function avatarProbeMetaClassification(probe = {}) {
  const values = [
    probe.error,
    probe.pictureEdge?.code, probe.pictureEdge?.metaReason,
    probe.identityPicture?.code, probe.identityPicture?.metaReason,
    probe.messengerProfile?.code, probe.messengerProfile?.metaReason,
    probe.messengerProfile?.diagnosis, probe.messengerProfileCode
  ].map(value => clean(value).toLowerCase());
  if (values.some(value => ['facebook_contact_profile_permission_denied', 'missing_permission', 'meta-contact-profile-access-denied'].includes(value))) return 'access-denied';
  if (values.some(value => ['facebook_contact_avatar_unsupported_get', 'unsupported_get', 'object_unavailable', 'meta-contact-avatar-unsupported-get'].includes(value))) return 'unsupported-get';
  return '';
}
function contactAvatarCapability(rootCause, existingAvatarUrl = '') {
  const value = clean(rootCause);
  if (value === 'READY') return { status: 'ready', retryRecommended: false, action: '' };
  if (value === 'META_CONTACT_PROFILE_ACCESS_DENIED') return {
    status: 'meta-access-denied', retryRecommended: false, deterministic: true, preservedAvatar: Boolean(clean(existingAvatarUrl)),
    action: 'Meta 拒绝联系人头像访问；账号消息能力保持健康，重新连接通常不会改变该结果'
  };
  if (value === 'META_CONTACT_AVATAR_UNSUPPORTED_GET') return {
    status: 'meta-api-unavailable', retryRecommended: false, deterministic: true, preservedAvatar: Boolean(clean(existingAvatarUrl)),
    action: 'Meta 当前不支持通过该联系人身份读取头像；保留已有头像，不再自动重复请求'
  };
  if (value === 'IDENTITY_UNRESOLVED') return { status: 'identity-unresolved', retryRecommended: true, action: '重新同步会话身份' };
  if (value === 'LOCAL_CACHE_INVALID') return { status: 'cache-invalid', retryRecommended: true, action: '重新缓存头像图片' };
  return { status: 'worker-or-persistence-failed', retryRecommended: true, action: '检查 Worker 请求与本地持久化日志' };
}
function logCriticalFailure(operation, error, detail = {}) {
  logger.warn('facebook', 'critical-operation-failed', {
    operation,
    accountId: clean(detail.accountId),
    conversationId: clean(detail.conversationId),
    reasonCode: clean(error?.code || detail.reasonCode, 'FACEBOOK_OPERATION_FAILED'),
    httpStatus: Number(error?.status || error?.httpStatus || 0),
    attempt: Number(detail.attempt || error?.attempt || 1),
    nextRetryAt: clean(detail.nextRetryAt || error?.nextRetryAt),
    error: clean(error?.message || error),
    ...detail
  });
}
function recipientId(value) { return clean(value).replace(/^facebook:/i, ''); }
function uniqueStrings(values = []) { return [...new Set((Array.isArray(values) ? values : []).map(clean).filter(Boolean))]; }
function missingPermissions(values = []) {
  const granted = new Set(permissionList({ permissions: values }));
  return REQUIRED_PAGE_PERMISSIONS.filter(permission => !granted.has(permission));
}
function missingOptionalPermissions(values = []) {
  const granted = new Set(permissionList({ permissions: values }));
  return OPTIONAL_PAGE_PERMISSIONS.filter(permission => !granted.has(permission));
}
function subscriptionFields(rows = []) {
  return uniqueStrings(rows.flatMap(row => Array.isArray(row?.subscribed_fields) ? row.subscribed_fields : []));
}

function normalizeReferral(value = {}) {
  if (!value || typeof value !== 'object') return null;
  const adsContext = value.ads_context_data && typeof value.ads_context_data === 'object' ? value.ads_context_data : {};
  const referral = {
    source: clean(value.source).toUpperCase(),
    type: clean(value.type).toUpperCase(),
    ref: clean(value.ref).slice(0, 500),
    adId: clean(value.ad_id || value.adId).slice(0, 128),
    flowId: clean(value.flow_id || value.flowId).slice(0, 128),
    adTitle: clean(adsContext.ad_title || value.ad_title).slice(0, 500),
    postId: clean(adsContext.post_id || value.post_id).slice(0, 128),
    productId: clean(adsContext.product_id || value.product_id).slice(0, 128),
    photoUrl: safeReferralUrl(adsContext.photo_url || value.photo_url),
    videoUrl: safeReferralUrl(adsContext.video_url || value.video_url)
  };
  return Object.values(referral).some(Boolean) ? referral : null;
}

function referralMessageText(referral) {
  if (!referral) return '';
  if (referral.source === 'ADS') return referral.adTitle ? `客户通过 Facebook 广告「${referral.adTitle}」进入会话` : '客户通过 Facebook 广告进入会话';
  return '客户通过 Facebook 引流入口进入会话';
}

function safeReferralUrl(value) {
  const raw = clean(value);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' ? url.toString().slice(0, 2048) : '';
  } catch (_) { return ''; }
}

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
}

function safeGraphPagingUrl(value) {
  const url = new URL(clean(value));
  if (url.protocol !== 'https:' || url.hostname !== 'graph.facebook.com') {
    throw Object.assign(new Error('Facebook Graph 分页地址无效'), { code: 'FACEBOOK_GRAPH_PAGING_URL_INVALID' });
  }
  url.searchParams.delete('access_token');
  return url.toString();
}

function facebookExpressionId(attachment = {}) {
  return clean(attachment?.payload?.sticker_id || attachment?.payload?.stickerId || attachment?.sticker_id || attachment?.stickerId);
}
function facebookExpressionDescriptor(attachment = {}) {
  const platformExpressionId = facebookExpressionId(attachment);
  return platformExpressionId ? { platformExpressionId, presentation: 'compact-expression' } : {};
}

function graphAttachmentKind(attachment = {}) {
  if (facebookExpressionId(attachment)) return 'sticker';
  const mime = clean(attachment.mime_type || attachment.mimeType).toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (attachment.image_data || attachment.imageData) return 'image';
  if (attachment.video_data || attachment.videoData) return 'video';
  return 'document';
}

function graphAttachments(message = {}) {
  const top = Array.isArray(message.attachments?.data) ? message.attachments.data : Array.isArray(message.attachments) ? message.attachments : [];
  const rows = top.flatMap(attachment => {
    const nested = Array.isArray(attachment?.subattachments?.data) ? attachment.subattachments.data : [];
    return nested.length ? nested : [attachment];
  });
  return rows.map((attachment, index) => {
    const sourceUrl = clean(attachment.file_url || attachment.url || attachment.image_data?.url || attachment.video_data?.url || attachment.payload?.url);
    return {
      id: clean(attachment.id, `attachment-${index}`),
      kind: graphAttachmentKind(attachment),
      mimeType: clean(attachment.mime_type || attachment.mimeType),
      filename: clean(attachment.name || attachment.filename),
      size: Math.max(0, Number(attachment.size || 0)),
      sourceUrl,
      url: sourceUrl,
      mediaUrl: sourceUrl,
      status: sourceUrl ? 'remote' : 'unavailable',
      downloadStatus: sourceUrl ? 'remote' : 'unavailable',
      ...facebookExpressionDescriptor(attachment)
    };
  });
}

function conversationPeer(conversation = {}, pageId = '', messages = []) {
  const participants = Array.isArray(conversation.participants?.data) ? conversation.participants.data : [];
  const direct = participants.find(participant => clean(participant?.id) && clean(participant.id) !== clean(pageId));
  if (direct) return { id: clean(direct.id), name: clean(direct.name || direct.username || direct.email) };
  for (const message of messages) {
    const candidates = [message?.from, ...(Array.isArray(message?.to?.data) ? message.to.data : [])];
    const peer = candidates.find(participant => clean(participant?.id) && clean(participant.id) !== clean(pageId));
    if (peer) return { id: clean(peer.id), name: clean(peer.name || peer.username || peer.email) };
  }
  return { id: '', name: '' };
}

function webhookPeerId(event = {}, pageId = '', isEcho = false) {
  const sender = clean(event?.sender?.id);
  const recipient = clean(event?.recipient?.id);
  const ordered = isEcho ? [recipient, sender] : [sender, recipient];
  return ordered.find(value => value && value !== clean(pageId)) || '';
}

function facebookContactId(accountId, pageScopedUserId) {
  const account = clean(accountId);
  const psid = clean(pageScopedUserId);
  if (!account || !psid) return '';
  return `contact-facebook-${crypto.createHash('sha256').update(`${account}:${psid}`).digest('hex').slice(0, 32)}`;
}

class FacebookAdapter {
  constructor() {
    this.sessions = new Map();
    this.contactAvatarRepairTasks = new Map();
    this.webhookContactEnrichmentTasks = new Map();
    this.historyContactEnrichmentTasks = new Map();
    this.historyContactEnrichmentQueue = [];
    this.historyContactEnrichmentRunning = 0;
    this.historyContactEnrichmentConcurrency = Math.max(1, boundedInteger(process.env.YANCE_FACEBOOK_HISTORY_PROFILE_CONCURRENCY, 4, 1, 8));
  }
  graphUrl(value, version = platformAuthConfig.DEFAULT_FACEBOOK_GRAPH_VERSION) { return `https://graph.facebook.com/${version}/${String(value || '').replace(/^\//, '')}`; }
  status(accountId) {
    const row = this.sessions.get(accountId);
    if (!row) return { state: 'unconfigured', lastError: '', page: null, connectedAt: '', webhook: 'unconfigured', relayState: 'unconfigured' };
    const relay = relayClient.status(accountId);
    const terminalState = ['paused', 'logged-out', 'stopped'].includes(clean(row.state).toLowerCase());
    if (!terminalState) {
      const sendReady = row.permissionReady === true && clean(row.tokenStatus).toLowerCase() === 'active';
      const receiveReady = sendReady && row.subscriptionReady === true && relay.state === 'connected';
      row.canSend = sendReady;
      row.canReceive = receiveReady;
      if (!sendReady) {
        row.state = 'reauthorize';
        row.webhook = row.subscriptionReady === true ? (row.webhook || 'subscribed') : 'unsubscribed';
        row.lastError = row.permissionReady !== true
          ? `缺少 Facebook 必要权限：${(row.missingPermissions || []).join('、') || '尚未验证'}`
          : `Facebook Page Token 状态不可用：${row.tokenStatus || 'unknown'}`;
      } else if (row.subscriptionReady !== true) {
        row.state = 'limited';
        row.webhook = 'unsubscribed';
        row.lastError = 'Facebook Page 尚未完成 messages Webhook 订阅';
      } else if (relay.state === 'connected') {
        row.webhook = 'relay-connected';
        row.state = row.historySyncAvailable === true ? 'connected' : 'limited';
        row.connectedAt = relay.connectedAt || row.connectedAt || '';
        row.lastError = row.historySyncAvailable === true
          ? (row.reconciliationLastError || '')
          : (row.historySyncReason || 'pages_read_engagement 尚未授权，Meta Business Suite 最近会话无法补拉');
      } else {
        row.webhook = 'relay-connecting';
        row.state = 'connecting';
        row.lastError = relay.lastError || '';
      }
    }
    if (relay.lastError && !row.lastError) row.lastError = relay.lastError;
    return this.publicState(row);
  }
  publicState(row) {
    const relay = relayClient.status(row.account?.id || '');
    return {
      state: row.state || 'unconfigured',
      lastError: row.lastError || relay.lastError || '',
      connectedAt: row.connectedAt || '',
      page: row.page || null,
      webhook: row.webhook || 'unconfigured',
      relayState: relay.state || 'unconfigured',
      permissions: row.permissions || [],
      missingPermissions: row.missingPermissions || [],
      missingOptionalPermissions: row.missingOptionalPermissions || [],
      permissionReady: row.permissionReady === true,
      newMessagingReady: row.newMessagingReady === true,
      historySyncAvailable: row.historySyncAvailable === true,
      historySyncReason: row.historySyncReason || '',
      subscriptionFields: row.subscriptionFields || [],
      subscriptionReady: row.subscriptionReady === true,
      canSend: row.canSend === true,
      canReceive: row.canReceive === true,
      tokenExpiresAt: row.tokenExpiresAt || '',
      tokenStatus: row.tokenStatus || '',
      lastSyncAt: row.lastSyncAt || relay.lastSyncAt || '',
      lastAckAt: row.lastAckAt || relay.lastAckAt || '',
      pendingEvents: Number(row.pendingEvents ?? relay.pendingEvents ?? 0),
      deadLetter: Number(row.deadLetter ?? relay.deadLetter ?? 0),
      workerStatus: relay.workerStatus || '',
      reconciliationActive: row.reconciliationActive === true,
      reconciliationRunning: row.reconciliationRunning === true,
      reconciliationLastAt: row.reconciliationLastAt || '',
      reconciliationLastError: row.reconciliationLastError || '',
      reconciliationLastResult: row.reconciliationLastResult || null,
      reconciliationIntervalMs: Number(row.reconciliationIntervalMs || 0),
      attemptId: clean(row.attemptId)
    };
  }
  emit(accountId, row) { eventBus.publish('account:state', { accountId, platform: 'facebook', ...this.publicState(row) }); }

  reconciliationPolicy() {
    return {
      initialDelayMs: boundedInteger(process.env.YANCE_FACEBOOK_RECONCILE_INITIAL_DELAY_MS, 3000, 0, 60000),
      intervalMs: boundedInteger(process.env.YANCE_FACEBOOK_RECONCILE_INTERVAL_MS, 60000, 15000, 3600000),
      maximumConversations: boundedInteger(process.env.YANCE_FACEBOOK_RECONCILE_CONVERSATIONS, 50, 1, 200),
      maximumMessages: boundedInteger(process.env.YANCE_FACEBOOK_RECONCILE_MESSAGES_PER_CONVERSATION, 100, 1, 200)
    };
  }

  stopReconciliation(row) {
    if (!row) return;
    row.stopped = true;
    row.reconciliationActive = false;
    if (row.reconciliationTimer) clearTimeout(row.reconciliationTimer);
    row.reconciliationTimer = null;
  }

  scheduleReconciliation(account, row) {
    if (!row || !account) return false;
    row.reconciliationActive = false;
    row.reconciliationRunning = false;
    row.reconciliationTimer = null;
    row.reconciliationIntervalMs = 0;
    row.reconciliationLastError = row.historySyncAvailable === true
      ? 'DURABLE_HISTORY_SYNCHRONIZATION_REQUIRED'
      : (row.historySyncReason || 'FACEBOOK_HISTORY_PERMISSION_MISSING');
    eventBus.publish('facebook:reconciliation-delegated', {
      accountId: account.id,
      authority: 'DurableExecutionAuthorityV2',
      operationKind: 'HISTORY_SYNCHRONIZATION',
      reasonCode: row.reconciliationLastError
    });
    return false;
  }

  async request() {
    throw Object.assign(new Error('Facebook Page Token 只允许由 Cloudflare Worker 使用，Windows 客户端禁止直接调用 Graph API'), {
      code: 'FACEBOOK_DIRECT_GRAPH_FORBIDDEN', status: 403
    });
  }

  credentials(account) {
    const secret = securityGuard.credentials.get(account.credentialRef) || {};
    if (!clean(secret.cloudAccountId) || !clean(secret.workerBaseUrl) || !clean(secret.deviceId) || !clean(secret.devicePrivateKeyPkcs8)) {
      throw Object.assign(new Error('Facebook 公共主页尚未完成云端授权'), { code: 'FACEBOOK_NOT_AUTHORIZED', status: 409 });
    }
    return { secret, version: secret.graphVersion || platformAuthConfig.DEFAULT_FACEBOOK_GRAPH_VERSION };
  }

  async avatarBufferWithRetry(secret, kind, psid = '', _maximumAttempts = 1, options = {}) {
    requirePersistedLegacyFacebookOperation(options, options.account || {});
    return relayClient.avatarBuffer(secret, kind, psid, options);
  }

  async refreshPageAvatar(account, row, secret, _maximumAttempts = 1, options = {}) {
    requirePersistedLegacyFacebookOperation(options, account);
    const previousPicture = localAvatarFallback(row.page?.picture || account.metadata?.picture || account.metadata?.pagePicture);
    row.page = {
      ...(row.page || {}),
      picture: previousPicture,
      avatarStatus: 'syncing',
      avatarLastError: '',
      avatarUpdatedAt: clean(row.page?.avatarUpdatedAt || account.metadata?.avatarUpdatedAt)
    };
    this.emit(account.id, row);
    try {
      const avatar = await this.avatarBufferWithRetry(secret, 'page', '', 1, { ...options, account });
      const cached = await avatarService.cacheStandaloneBuffer({ accountId: account.id, assetKey: 'facebook-page-avatar', buffer: avatar.buffer, source: 'facebook-page-profile-proxy' });
      row.page = {
        ...(row.page || {}),
        picture: cached.avatarUrl || previousPicture,
        avatarStatus: cached.avatarUrl ? 'ready' : 'empty',
        avatarLastError: '',
        avatarUpdatedAt: cached.avatarUpdatedAt || new Date().toISOString(),
        avatarSource: 'facebook-page-profile-proxy'
      };
      logger.info('facebook', 'page-avatar-cache-ready', { accountId: account.id, avatarStatus: row.page.avatarStatus });
      this.emit(account.id, row);
      return row.page.picture;
    } catch (error) {
      const evidence = avatarErrorEvidence(error);
      row.page = {
        ...(row.page || {}),
        picture: previousPicture,
        avatarStatus: 'failed',
        avatarLastError: evidence.code,
        avatarUpdatedAt: new Date().toISOString(),
        avatarSource: 'facebook-page-profile-proxy'
      };
      logger.warn('facebook', 'page-avatar-cache-failed', { accountId: account.id, ...evidence });
      this.emit(account.id, row);
      return previousPicture;
    }
  }

  facebookPeerIdFromConversation(conversation = {}, accountId = '') {
    const candidates = [
      clean(conversation.chatJid || conversation.chat_jid).replace(/^facebook:/iu, ''),
      clean(conversation.externalId || conversation.external_id).replace(/^facebook:/iu, ''),
      clean(conversation.contactExternalId || conversation.contact_external_id).replace(/^facebook:/iu, ''),
      clean(conversation.sessionKey || conversation.conversationId || conversation.id).startsWith(`${clean(accountId)}:`)
        ? clean(conversation.sessionKey || conversation.conversationId || conversation.id).slice(`${clean(accountId)}:`.length)
        : ''
    ];
    return candidates.find(value => /^\d{3,64}$/u.test(clean(value))) || '';
  }

  facebookPeerIdentityEvidence(conversation = {}, accountId = '') {
    const payload = conversation?.payload && typeof conversation.payload === 'object' ? conversation.payload : conversation;
    const metadata = conversation?.metadata && typeof conversation.metadata === 'object' ? conversation.metadata : {};
    const rawCandidates = [
      ['pageScopedUserId', conversation.pageScopedUserId || conversation.page_scoped_user_id || payload.pageScopedUserId || payload.page_scoped_user_id || metadata.pageScopedUserId || metadata.page_scoped_user_id, 'authoritative'],
      ['contactExternalId', conversation.contactExternalId || conversation.contact_external_id || payload.contactExternalId || payload.contact_external_id || metadata.contactExternalId || metadata.contact_external_id, 'authoritative'],
      ['participantId', conversation.participantId || conversation.participant_id || payload.participantId || payload.participant_id || metadata.participantId || metadata.participant_id, 'authoritative'],
      ['peerId', conversation.peerId || conversation.peer_id || payload.peerId || payload.peer_id || metadata.peerId || metadata.peer_id, 'authoritative'],
      ['psid', conversation.psid || conversation.PSID || payload.psid || payload.PSID || metadata.psid || metadata.PSID, 'authoritative'],
      ['senderId', conversation.senderId || conversation.sender_id || payload.senderId || payload.sender_id || metadata.senderId || metadata.sender_id, 'authoritative'],
      ['chatJid', conversation.chatJid || conversation.chat_jid || payload.chatJid || payload.chat_jid || metadata.chatJid || metadata.chat_jid, 'derived'],
      ['externalId', conversation.externalId || conversation.external_id || payload.externalId || payload.external_id || metadata.externalId || metadata.external_id, 'fallback'],
      ['sessionKey', conversation.sessionKey || conversation.conversationId || conversation.id || payload.sessionKey || payload.conversationId || payload.id, 'fallback']
    ];
    const normalize = (source, value) => {
      let normalized = clean(value);
      if (source === 'sessionKey' && normalized.startsWith(`${clean(accountId)}:`)) normalized = normalized.slice(`${clean(accountId)}:`.length);
      normalized = normalized.replace(/^facebook:/iu, '');
      return normalized;
    };
    const classify = (raw, normalized) => {
      if (!raw) return 'empty';
      if (/^facebook:/iu.test(raw)) return 'facebook-prefixed';
      if (clean(accountId) && raw.startsWith(`${clean(accountId)}:`)) return 'account-prefixed';
      if (/^\d{3,64}$/u.test(normalized)) return 'numeric';
      if (/^[0-9+() .-]{7,32}$/u.test(normalized)) return 'phone-like';
      if (/^[0-9a-f]{8}-[0-9a-f-]{20,}$/iu.test(normalized)) return 'uuid-like';
      return 'other';
    };
    const candidates = rawCandidates.map(([source, value, confidence]) => {
      const raw = clean(value);
      const normalized = normalize(source, value);
      const numeric = /^\d{3,64}$/u.test(normalized);
      return {
        source,
        confidence,
        present: Boolean(raw),
        format: classify(raw, normalized),
        normalizedLength: normalized.length,
        numeric,
        identityHash: normalized ? crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16) : ''
      };
    });
    const selected = candidates.find(row => row.numeric && row.confidence === 'authoritative')
      || candidates.find(row => row.numeric && row.confidence === 'derived')
      || candidates.find(row => row.numeric) || null;
    return {
      resolved: Boolean(selected),
      source: selected?.source || '',
      confidence: selected?.confidence || '',
      identityHash: selected?.identityHash || '',
      rawIdentity: selected ? normalize(selected.source, rawCandidates.find(row => row[0] === selected.source)?.[1]) : '',
      candidates
    };
  }

  async diagnoseAvatarClosure(account, options = {}) {
    requirePersistedLegacyFacebookOperation(options, account);
    assertOperationActive(options.signal, 'FACEBOOK_AVATAR_DIAGNOSE_ABORTED', { accountId: account.id });
    const startedAt = new Date().toISOString();
    const limit = boundedInteger(options.limit, 8, 1, 25);
    const { secret } = this.credentials(account);
    const pageId = clean(secret.pageId || account.metadata?.pageId);
    const publicHealth = { ok: false, status: 0, contract: null, error: 'LEGACY_PUBLIC_HEALTH_PROBE_RETIRED' };

    let signedHealth = { ok: false, status: '', error: '' };
    try {
      const health = await relayClient.health(secret, options);
      assertOperationActive(options.signal, 'FACEBOOK_AVATAR_DIAGNOSE_ABORTED', { accountId: account.id });
      signedHealth = { ok: true, status: clean(health?.status), queue: health?.queue || null, error: '' };
    } catch (error) {
      signedHealth = { ok: false, status: '', error: clean(error?.code || error?.message, 'FACEBOOK_WORKER_HEALTH_FAILED'), httpStatus: Number(error?.status || 0) };
    }

    let pageProbe = { ok: false, bytes: 0, mimeType: '', error: '', httpStatus: 0 };
    try {
      const avatar = await relayClient.avatarBuffer(secret, 'page', '', options);
      assertOperationActive(options.signal, 'FACEBOOK_AVATAR_DIAGNOSE_ABORTED', { accountId: account.id });
      const verified = avatarService.validateBuffer(avatar.buffer, { expectedPlatform: 'facebook' });
      pageProbe = { ok: true, bytes: verified.bytes, mimeType: verified.mimeType || avatar.mimeType || '', imageHash: clean(verified.hash).slice(0, 16), error: '', httpStatus: 200, requestId: clean(avatar.requestId) };
    } catch (error) {
      const evidence = avatarErrorEvidence(error);
      pageProbe = { ok: false, bytes: 0, mimeType: '', error: evidence.code, httpStatus: evidence.status, requestId: evidence.requestId };
    }

    const rows = messageStore.listConversations({ limit: 1000 })
      .filter(row => clean(row.platform).toLowerCase() === 'facebook'
        && clean(row.accountId || row.sourceAccountId || row.source_account_id) === clean(account.id))
      .sort((left, right) => Date.parse(right.updatedAt || right.lastMessageAt || 0) - Date.parse(left.updatedAt || left.lastMessageAt || 0))
      .slice(0, limit);

    const contacts = [];
    for (const conversation of rows) {
      assertOperationActive(options.signal, 'FACEBOOK_AVATAR_DIAGNOSE_ABORTED', { accountId: account.id });
      const conversationId = clean(conversation.conversationId || conversation.sessionKey || conversation.id);
      const identity = this.facebookPeerIdentityEvidence(conversation, account.id);
      const currentAvatarUrl = clean(conversation.avatarUrl || conversation.avatar_url || conversation.avatar);
      const cache = currentAvatarUrl
        ? avatarService.validateCachedAvatar(currentAvatarUrl, { expectedPlatform: 'facebook' })
        : { valid: false, errorCode: 'avatar-url-empty', localFile: '' };
      let workerProbe = { attempted: false, ok: false, bytes: 0, mimeType: '', error: '', httpStatus: 0, requestId: '' };
      if (identity.resolved) {
        workerProbe.attempted = true;
        try {
          const avatar = await relayClient.avatarBuffer(secret, 'profile', identity.rawIdentity, options);
          assertOperationActive(options.signal, 'FACEBOOK_AVATAR_DIAGNOSE_ABORTED', { accountId: account.id });
          const verified = avatarService.validateBuffer(avatar.buffer, { expectedPlatform: 'facebook' });
          workerProbe = { attempted: true, ok: true, bytes: verified.bytes, mimeType: verified.mimeType || avatar.mimeType || '', imageHash: clean(verified.hash).slice(0, 16), error: '', httpStatus: 200, requestId: clean(avatar.requestId) };
        } catch (error) {
          const evidence = avatarErrorEvidence(error);
          workerProbe = {
            attempted: true, ok: false, bytes: 0, mimeType: '', error: evidence.code,
            httpStatus: evidence.status, requestId: evidence.requestId,
            pictureEdge: {
              code: evidence.pictureEdgeCode, status: evidence.pictureEdgeStatus,
              metaCode: evidence.pictureEdgeMetaCode, metaSubcode: evidence.pictureEdgeMetaSubcode,
              metaReason: evidence.pictureEdgeMetaReason
            },
            identityPicture: {
              code: evidence.identityPictureCode, status: evidence.identityPictureStatus,
              metaCode: evidence.identityPictureMetaCode, metaSubcode: evidence.identityPictureMetaSubcode,
              metaReason: evidence.identityPictureMetaReason
            },
            messengerProfile: {
              code: evidence.profileCode, status: evidence.profileStatus,
              metaCode: evidence.profileMetaCode, metaSubcode: evidence.profileMetaSubcode,
              metaReason: evidence.profileMetaReason, diagnosis: evidence.profileDiagnosis,
              originalCode: evidence.profileOriginalCode
            },
            primaryCode: evidence.primaryCode, primaryStatus: evidence.primaryStatus,
            messengerProfileCode: evidence.messengerProfileCode,
            messengerProfileStatus: evidence.messengerProfileStatus
          };
        }
      }

      const externalConversationId = clean(
        conversation.externalConversationId || conversation.external_conversation_id
        || conversation.metadata?.externalConversationId || conversation.metadata?.external_conversation_id
      );
      const identityProvenance = {
        attempted: false,
        externalConversationIdPresent: Boolean(externalConversationId),
        pageIdPresent: Boolean(pageId),
        messagesRead: 0,
        messageDerivedResolved: false,
        messageDerivedIdentityHash: '',
        differsFromPersisted: false,
        source: '',
        error: '',
        workerProbe: { attempted: false, ok: false, bytes: 0, mimeType: '', error: '', httpStatus: 0, requestId: '' }
      };
      if (externalConversationId && pageId) {
        identityProvenance.attempted = true;
        try {
          const page = await relayClient.historyMessages(secret, externalConversationId, { limit: 25 }, options);
          assertOperationActive(options.signal, 'FACEBOOK_AVATAR_DIAGNOSE_ABORTED', { accountId: account.id });
          const messages = Array.isArray(page?.data) ? page.data : [];
          identityProvenance.messagesRead = messages.length;
          const candidates = [];
          for (const message of messages) {
            const from = message?.from;
            const to = Array.isArray(message?.to?.data) ? message.to.data : [];
            for (const participant of [from, ...to]) {
              const candidateId = clean(participant?.id);
              if (candidateId && candidateId !== pageId && /^\d{3,64}$/u.test(candidateId)) candidates.push(candidateId);
            }
          }
          if (candidates.length) {
            const counts = new Map();
            for (const candidateId of candidates) counts.set(candidateId, Number(counts.get(candidateId) || 0) + 1);
            candidates.sort((left, right) => Number(counts.get(right) || 0) - Number(counts.get(left) || 0));
            const messageDerivedIdentity = candidates[0];
            identityProvenance.messageDerivedResolved = true;
            identityProvenance.messageDerivedIdentityHash = crypto.createHash('sha256').update(messageDerivedIdentity).digest('hex').slice(0, 16);
            identityProvenance.differsFromPersisted = Boolean(identity.identityHash && identity.identityHash !== identityProvenance.messageDerivedIdentityHash);
            identityProvenance.source = 'history-message-from-to';
            identityProvenance.workerProbe.attempted = true;
            try {
              const avatar = await relayClient.avatarBuffer(secret, 'profile', messageDerivedIdentity, options);
              const verified = avatarService.validateBuffer(avatar.buffer, { expectedPlatform: 'facebook' });
              identityProvenance.workerProbe = {
                attempted: true, ok: true, bytes: verified.bytes,
                mimeType: verified.mimeType || avatar.mimeType || '',
                imageHash: clean(verified.hash).slice(0, 16),
                error: '', httpStatus: 200, requestId: clean(avatar.requestId)
              };
            } catch (error) {
              const evidence = avatarErrorEvidence(error);
              identityProvenance.workerProbe = {
                attempted: true, ok: false, bytes: 0, mimeType: '', error: evidence.code,
                httpStatus: evidence.status, requestId: evidence.requestId,
                pictureEdge: {
                  code: evidence.pictureEdgeCode, status: evidence.pictureEdgeStatus,
                  metaCode: evidence.pictureEdgeMetaCode, metaSubcode: evidence.pictureEdgeMetaSubcode,
                  metaReason: evidence.pictureEdgeMetaReason
                },
                identityPicture: {
                  code: evidence.identityPictureCode, status: evidence.identityPictureStatus,
                  metaCode: evidence.identityPictureMetaCode, metaSubcode: evidence.identityPictureMetaSubcode,
                  metaReason: evidence.identityPictureMetaReason
                },
                messengerProfile: {
                  code: evidence.profileCode, status: evidence.profileStatus,
                  metaCode: evidence.profileMetaCode, metaSubcode: evidence.profileMetaSubcode,
                  metaReason: evidence.profileMetaReason, diagnosis: evidence.profileDiagnosis,
                  originalCode: evidence.profileOriginalCode
                }
              };
            }
          } else {
            identityProvenance.error = 'NO_NON_PAGE_MESSAGE_ID';
          }
        } catch (error) {
          identityProvenance.error = clean(error?.code || error?.message, 'HISTORY_IDENTITY_PROBE_FAILED');
        }
      }

      let rootCause = 'READY';
      const workerMetaClassification = avatarProbeMetaClassification(workerProbe);
      const derivedMetaClassification = avatarProbeMetaClassification(identityProvenance.workerProbe);
      const metaClassification = workerMetaClassification || derivedMetaClassification;
      if (!identity.resolved) rootCause = 'IDENTITY_UNRESOLVED';
      else if (metaClassification === 'access-denied') rootCause = 'META_CONTACT_PROFILE_ACCESS_DENIED';
      else if (metaClassification === 'unsupported-get') rootCause = 'META_CONTACT_AVATAR_UNSUPPORTED_GET';
      else if (!workerProbe.ok && identityProvenance.workerProbe?.ok === true && identityProvenance.differsFromPersisted) rootCause = 'PERSISTED_IDENTITY_WRONG_MESSAGE_ID_READY';
      else if (!workerProbe.ok && identityProvenance.messageDerivedResolved && identityProvenance.differsFromPersisted) rootCause = 'PERSISTED_AND_MESSAGE_IDENTITIES_REJECTED';
      else if (!workerProbe.ok && identityProvenance.messageDerivedResolved && !identityProvenance.differsFromPersisted) rootCause = 'WORKER_REJECTS_MESSAGE_DERIVED_IDENTITY';
      else if (!workerProbe.ok) rootCause = 'WORKER_AVATAR_REQUEST_FAILED';
      else if (!currentAvatarUrl) rootCause = 'WORKER_OK_BUT_AVATAR_NOT_PERSISTED';
      else if (!cache.valid) rootCause = 'LOCAL_CACHE_INVALID';
      else if (clean(conversation.avatarStatus || conversation.avatar_status) !== 'ready') rootCause = 'AVATAR_STATUS_NOT_READY';
      const capability = contactAvatarCapability(rootCause, currentAvatarUrl);
      contacts.push({
        conversationIdHash: crypto.createHash('sha256').update(conversationId).digest('hex').slice(0, 16),
        displayName: clean(conversation.title || conversation.contactName, 'Facebook 联系人').slice(0, 80),
        identity: { resolved: identity.resolved, source: identity.source, confidence: identity.confidence, identityHash: identity.identityHash, candidates: identity.candidates },
        sqlite: {
          avatarUrlPresent: Boolean(currentAvatarUrl),
          avatarStatus: clean(conversation.avatarStatus || conversation.avatar_status),
          avatarLastError: clean(conversation.avatarLastError || conversation.avatar_last_error),
          avatarSource: clean(conversation.avatarSource || conversation.avatar_source),
          avatarUpdatedAt: clean(conversation.avatarUpdatedAt || conversation.avatar_updated_at)
        },
        cache: { valid: cache.valid === true, errorCode: clean(cache.errorCode), bytes: Number(cache.bytes || 0), mimeType: clean(cache.mimeType), avatarHash: clean(cache.avatarHash).slice(0, 16), localFilePresent: Boolean(cache.localFile) },
        workerProbe,
        identityProvenance,
        capability,
        rootCause
      });
    }

    const summary = {
      conversationsScanned: contacts.length,
      identityResolved: contacts.filter(row => row.identity.resolved).length,
      workerAvatarReady: contacts.filter(row => row.workerProbe.ok).length,
      sqliteAvatarPresent: contacts.filter(row => row.sqlite.avatarUrlPresent).length,
      localCacheValid: contacts.filter(row => row.cache.valid).length,
      fullyReady: contacts.filter(row => row.rootCause === 'READY').length,
      identityProvenanceAttempted: contacts.filter(row => row.identityProvenance?.attempted).length,
      messageDerivedResolved: contacts.filter(row => row.identityProvenance?.messageDerivedResolved).length,
      persistedIdentityDiffers: contacts.filter(row => row.identityProvenance?.differsFromPersisted).length,
      messageDerivedWorkerReady: contacts.filter(row => row.identityProvenance?.workerProbe?.ok).length,
      contactAvatarAccessDenied: contacts.filter(row => row.rootCause === 'META_CONTACT_PROFILE_ACCESS_DENIED').length,
      contactAvatarUnsupportedGet: contacts.filter(row => row.rootCause === 'META_CONTACT_AVATAR_UNSUPPORTED_GET').length,
      contactAvatarCapability: contacts.some(row => row.rootCause === 'META_CONTACT_PROFILE_ACCESS_DENIED')
        ? 'meta-access-denied'
        : contacts.some(row => row.rootCause === 'META_CONTACT_AVATAR_UNSUPPORTED_GET')
          ? 'meta-api-unavailable'
          : (contacts.every(row => row.rootCause === 'READY') ? 'ready' : 'degraded'),
      rootCauses: contacts.reduce((acc, row) => { acc[row.rootCause] = Number(acc[row.rootCause] || 0) + 1; return acc; }, {})
    };
    const report = {
      schemaVersion: 6,
      evidenceContract: 'worker-v11-avatar-unavailable-and-translation-persistence',
      documentType: 'YANCE_FACEBOOK_AVATAR_CLOSURE_DIAGNOSTIC',
      privacyMode: true,
      generatedAt: new Date().toISOString(),
      startedAt,
      durationMs: Math.max(0, Date.now() - Date.parse(startedAt)),
      mode: 'read-only-real-signed-worker-probe',
      mutationsPerformed: false,
      accountIdHash: crypto.createHash('sha256').update(clean(account.id)).digest('hex').slice(0, 16),
      worker: { publicHealth, signedHealth, pageProbe },
      summary,
      contacts
    };
    assertOperationActive(options.signal, 'FACEBOOK_AVATAR_DIAGNOSE_ABORTED', { accountId: account.id });
    logger.info('facebook', 'avatar-closure-diagnostic-completed', { accountId: account.id, ...summary });
    return report;
  }

  async refreshExistingContactAvatars(account, options = {}) {
    requirePersistedLegacyFacebookOperation(options, account);
    const limit = boundedInteger(options.limit, 100, 1, 500);
    const all = messageStore.listConversations({ limit: Math.max(limit * 4, 500) });
    const rows = all
      .filter(row => clean(row.platform).toLowerCase() === 'facebook' && clean(row.accountId) === clean(account.id))
      .sort((left, right) => Date.parse(right.updatedAt || right.lastMessageAt || 0) - Date.parse(left.updatedAt || left.lastMessageAt || 0))
      .slice(0, limit);
    let attempted = 0; let ready = 0; let failed = 0; let skipped = 0;
    for (const conversation of rows) {
      const conversationId = clean(conversation.conversationId || conversation.sessionKey || conversation.id);
      if (!conversationId || conversation.customAvatar === true || !avatarService.needsRefresh(conversationId, options.force === true)) { skipped += 1; continue; }
      const peerId = this.facebookPeerIdFromConversation(conversation, account.id);
      if (!peerId) {
        failed += 1;
        await messageStore.updateConversationMetadata(conversationId, {
          avatarStatus: 'failed',
          avatarLastError: 'FACEBOOK_CONTACT_PSID_MISSING',
          avatarUpdatedAt: new Date().toISOString(),
          avatarSource: 'facebook-profile-proxy'
        }).catch(error => logCriticalFailure('messageStore.updateConversationMetadata.avatarPeerMissing', error, { accountId: account.id, conversationId }));
        logger.warn('facebook', 'contact-avatar-repair-peer-missing', { accountId: account.id, conversationId });
        continue;
      }
      attempted += 1;
      await messageStore.updateConversationMetadata(conversationId, {
        avatarStatus: 'syncing',
        avatarLastError: '',
        avatarUpdatedAt: new Date().toISOString(),
        avatarSource: 'facebook-profile-proxy'
      }).catch(error => logCriticalFailure('messageStore.updateConversationMetadata.avatarSyncing', error, { accountId: account.id, conversationId }));
      try {
        const profile = await this.senderProfile(account, peerId, conversationId, options);
        if (profile.avatarUrl) ready += 1; else failed += 1;
      } catch (error) {
        failed += 1;
        const evidence = avatarErrorEvidence(error);
        await messageStore.updateConversationMetadata(conversationId, {
          avatarStatus: ['FACEBOOK_CONTACT_AVATAR_UNSUPPORTED_GET','META_CONTACT_AVATAR_UNSUPPORTED_GET','FACEBOOK_CONTACT_PROFILE_PERMISSION_DENIED','META_CONTACT_PROFILE_ACCESS_DENIED'].includes(evidence.code) ? 'unavailable' : 'failed',
          avatarLastError: evidence.code,
          avatarUpdatedAt: new Date().toISOString(),
          avatarSource: 'facebook-profile-proxy'
        }).catch(metadataError => logCriticalFailure('messageStore.updateConversationMetadata.avatarRepairFailed', metadataError, { accountId: account.id, conversationId, reasonCode: evidence.code }));
        logger.warn('facebook', 'contact-avatar-repair-failed', { accountId: account.id, conversationId, senderId: peerId, ...evidence });
      }
    }
    const result = { scanned: rows.length, attempted, ready, failed, skipped, completedAt: new Date().toISOString() };
    logger.info('facebook', 'contact-avatar-repair-completed', { accountId: account.id, ...result });
    return result;
  }

  scheduleExistingContactAvatarRepair(account, _options = {}) {
    const accountId = clean(account?.id);
    logger.info('facebook', 'contact-avatar-repair-delegated', {
      accountId, authority: 'DurableExecutionAuthorityV2', operationKind: 'HISTORY_SYNCHRONIZATION'
    });
    return null;
  }

  scheduleWebhookMediaTransfer(payload = {}, traceId = '') {
    const accountId = clean(payload.accountId);
    const conversationId = clean(payload.conversationId);
    const messageId = clean(payload.messageId);
    const workerMediaCount = Math.max(0, Number(payload.workerMediaCount || 0));
    if (!accountId || !conversationId || !messageId) {
      throw Object.assign(new Error('Facebook delegated media requires persisted account, conversation, and message references'), {
        code: 'FACEBOOK_MEDIA_DELEGATION_REFERENCE_REQUIRED', status: 409
      });
    }
    if (workerMediaCount < 1) {
      logger.info('facebook', 'legacy-media-transfer-not-scheduled', {
        accountId, conversationId, messageId, reasonCode: 'FACEBOOK_LEGACY_MEDIA_FETCH_RETIRED'
      });
      return null;
    }
    const metadataSha256 = crypto.createHash('sha256')
      .update(['facebook', accountId, conversationId, messageId].join('\n'))
      .digest('hex');
    const scheduled = mediaPipeline.prepareMediaTransfer({
      idempotencyKey: `facebook:webhook-media:${accountId}:${messageId}`,
      traceId: clean(traceId, `facebook-webhook-media:${messageId}`),
      maxAttempts: 3,
      command: Object.freeze({
        transferKind: 'FETCH',
        mediaReference: messageId,
        sourceScopeReference: `facebook:${accountId}:webhook:${messageId}`,
        destinationScopeReference: `conversation:${conversationId}:message:${messageId}`,
        metadataSha256,
        custodyReference: `facebook:${accountId}`
      })
    });
    eventBus.publish('facebook:webhook-media-scheduled', {
      accountId, conversationId, messageId,
      operationKind: 'MEDIA_TRANSFER',
      executionId: clean(scheduled.executionId),
      intentId: clean(scheduled.intentId),
      idempotencyKey: clean(scheduled.idempotencyKey)
    });
    return scheduled;
  }

  async connect(account, options = {}) {
    requirePersistedLegacyFacebookOperation(options, account);
    const attemptId = clean(options.attemptId);
    assertOperationActive(options.signal, 'FACEBOOK_CONNECT_ABORTED', { accountId: account.id, attemptId });
    const secret = securityGuard.credentials.get(account.credentialRef) || {};
    const pageId = clean(secret.pageId || account.metadata?.pageId);
    if (!pageId || !clean(secret.cloudAccountId) || !clean(secret.workerBaseUrl)) {
      const row = { account, state: 'unconfigured', lastError: '需要通过浏览器授权 Facebook 公共主页', page: null, webhook: 'unconfigured', permissions: [], attemptId };
      this.sessions.set(account.id, row); this.emit(account.id, row); return this.publicState(row);
    }
    const row = {
      account, state: 'connecting', lastError: '', attemptId,
      page: { id: pageId, name: account.displayName, username: clean(account.metadata?.username), picture: clean(account.metadata?.picture || account.metadata?.pagePicture) },
      webhook: 'checking', permissions: permissionList({ permissions: secret.permissions }), missingPermissions: [], missingOptionalPermissions: [],
      permissionReady: false, newMessagingReady: false, historySyncAvailable: false, historySyncReason: '', subscriptionFields: [], subscriptionReady: false, canSend: false, canReceive: false,
      connectedAt: '', lastSyncAt: '', lastAckAt: '', pendingEvents: 0, deadLetter: 0, tokenStatus: clean(secret.tokenStatus, 'active'),
      stopped: false, reconciliationActive: false, reconciliationRunning: false, reconciliationTimer: null,
      reconciliationLastAt: '', reconciliationLastError: '', reconciliationLastResult: null, reconciliationIntervalMs: 0
    };
    this.sessions.set(account.id, row); this.emit(account.id, row);
    try {
      assertOperationActive(options.signal, 'FACEBOOK_CONNECT_ABORTED', { accountId: account.id, attemptId });
      await relayClient.refreshPermissions(secret, options).catch(error => logger.warn('facebook', 'permission-refresh-failed', { accountId: account.id, code: clean(error?.code), error: clean(error?.message) }));
      assertOperationActive(options.signal, 'FACEBOOK_CONNECT_ABORTED', { accountId: account.id, attemptId });
      const cloud = await relayClient.accounts(secret, options);
      assertOperationActive(options.signal, 'FACEBOOK_CONNECT_ABORTED', { accountId: account.id, attemptId });
      if (this.sessions.get(account.id) !== row || row.stopped || (attemptId && clean(row.attemptId) !== attemptId)) {
        throw Object.assign(new Error('Facebook connect completion belongs to a stale generation'), { code: 'FACEBOOK_CONNECT_GENERATION_STALE', accountId: account.id, attemptId });
      }
      const remote = (cloud.accounts || []).find(item => clean(item.cloudAccountId) === clean(secret.cloudAccountId)) || cloud.accounts?.[0] || null;
      if (remote) {
        row.page = {
          id: clean(remote.pageId || pageId),
          name: clean(remote.pageName, account.displayName),
          username: clean(remote.pageUsername),
          picture: localAvatarFallback(account.metadata?.picture || account.metadata?.pagePicture),
          avatarStatus: clean(account.metadata?.avatarStatus),
          avatarLastError: clean(account.metadata?.avatarLastError),
          avatarUpdatedAt: clean(account.metadata?.avatarUpdatedAt),
          avatarSource: clean(account.metadata?.avatarSource)
        };
        row.permissions = permissionList({ permissions: remote.grantedScopes || remote.permissions || secret.permissions });
        row.permissionCheckedAt = clean(remote.lastPermissionCheckAt || secret.permissionCheckedAt);
        row.permissionSource = clean(remote.permissionSource || secret.permissionSource);
        row.tokenStatus = clean(remote.tokenStatus, secret.tokenStatus || 'unknown');
        row.webhook = clean(remote.webhookStatus, 'unknown');
        row.subscriptionReady = row.webhook === 'subscribed';
        row.subscriptionFields = row.subscriptionReady ? ['messages'] : [];
      }
      row.missingPermissions = missingPermissions(row.permissions);
      row.missingOptionalPermissions = missingOptionalPermissions(row.permissions);
      row.permissionReady = row.missingPermissions.length === 0;
      row.newMessagingReady = row.permissionReady;
      row.historySyncAvailable = remote && typeof remote.historySyncAvailable === 'boolean'
        ? remote.historySyncAvailable
        : row.missingOptionalPermissions.length === 0;
      row.historySyncReason = row.historySyncAvailable ? '' : clean(remote?.historySyncReason, 'pages_read_engagement 尚未授权；实时 Webhook 可继续收发，但 Meta Business Suite 最近会话与外部发送消息无法主动补齐');
      if (!row.permissionReady || row.tokenStatus !== 'active') {
        row.state = 'reauthorize';
        row.lastError = !row.permissionReady ? `Facebook 授权缺少必要权限：${row.missingPermissions.join(', ')}` : 'Facebook 授权已失效，请重新授权';
        row.canSend = false; row.canReceive = false; this.emit(account.id, row); return this.publicState(row);
      }
      if (!row.subscriptionReady) {
        row.state = 'limited'; row.lastError = 'Facebook 公共主页 Webhook 尚未在云端完成订阅';
        row.canSend = true; row.canReceive = false; this.emit(account.id, row); return this.publicState(row);
      }
      assertOperationActive(options.signal, 'FACEBOOK_CONNECT_ABORTED', { accountId: account.id, attemptId });
      const relay = await relayClient.connect(account, secret, body => {
        if (options.signal?.aborted || row.stopped || this.sessions.get(account.id) !== row) return { accepted: false, reason: 'stale-connect-generation' };
        return this.handleWebhook(body, [account]);
      }, relayState => {
        if (options.signal?.aborted || row.stopped || this.sessions.get(account.id) !== row || (attemptId && clean(row.attemptId) !== attemptId)) {
          logger.warn('facebook', 'stale-relay-state-ignored', { accountId: account.id, attemptId, state: clean(relayState?.state) });
          return;
        }
        row.webhook = relayState.state === 'connected' ? 'worker-connected' : 'worker-connecting';
        row.state = relayState.state === 'connected'
          ? (row.historySyncAvailable === true ? 'connected' : 'limited')
          : 'connecting';
        row.connectedAt = relayState.connectedAt || '';
        row.lastSyncAt = relayState.lastSyncAt || row.lastSyncAt;
        row.lastAckAt = relayState.lastAckAt || row.lastAckAt;
        row.pendingEvents = Number(relayState.pendingEvents || 0);
        row.deadLetter = Number(relayState.deadLetter || 0);
        row.canSend = row.permissionReady && row.tokenStatus === 'active';
        row.canReceive = relayState.state === 'connected' && row.subscriptionReady;
        row.lastError = relayState.state === 'connected'
          ? (row.historySyncAvailable === true ? (row.reconciliationLastError || '') : row.historySyncReason)
          : (relayState.lastError || row.lastError);
        this.emit(account.id, row);
      }, options);
      assertOperationActive(options.signal, 'FACEBOOK_CONNECT_ABORTED', { accountId: account.id, attemptId });
      if (this.sessions.get(account.id) !== row || row.stopped || (attemptId && clean(row.attemptId) !== attemptId)) {
        throw Object.assign(new Error('Facebook relay completion belongs to a stale generation'), { code: 'FACEBOOK_CONNECT_GENERATION_STALE', accountId: account.id, attemptId });
      }
      row.state = relay.state === 'connected'
        ? (row.historySyncAvailable === true ? 'connected' : 'limited')
        : 'connecting';
      row.webhook = relay.state === 'connected' ? 'worker-connected' : 'worker-connecting';
      row.connectedAt = relay.connectedAt || '';
      row.canSend = row.permissionReady && row.tokenStatus === 'active';
      row.canReceive = relay.state === 'connected' && row.subscriptionReady;
      row.lastError = relay.lastError || (row.historySyncAvailable === true ? '' : row.historySyncReason);
      this.emit(account.id, row);
      logger.info('facebook', 'worker-connected', {
        accountId: account.id,
        pageId: row.page.id,
        workerHost: new URL(secret.workerBaseUrl).host,
        state: row.state,
        historySyncAvailable: row.historySyncAvailable === true,
        missingOptionalPermissions: row.missingOptionalPermissions || []
      });
      this.scheduleReconciliation(account, row);
      return this.publicState(row);
    } catch (error) {
      if (options.signal?.aborted || error?.code === 'FACEBOOK_CONNECT_GENERATION_STALE') {
        row.stopped = true;
        await relayClient.disconnect(account.id).catch(disconnectError => logCriticalFailure('relayClient.disconnect.connectAbort', disconnectError, { accountId: account.id, attemptId }));
        throw options.signal?.aborted
          ? operationAbortError(options.signal, 'FACEBOOK_CONNECT_ABORTED', { accountId: account.id, attemptId })
          : error;
      }
      row.state = ['FACEBOOK_TOKEN_EXPIRED','FACEBOOK_PERMISSION_REVOKED','FACEBOOK_ACCOUNT_DISCONNECTED'].includes(error.code) ? 'reauthorize' : 'error';
      row.lastError = error.message; row.canSend = false; row.canReceive = false; this.emit(account.id, row);
      logger.error('facebook', 'worker-connect-failed', { accountId: account.id, error: error.message, code: error.code || '' });
      return this.publicState(row);
    }
  }

  async disconnect(accountId, logout = false, account = null, options = {}) {
    assertOperationActive(options.signal, logout ? 'FACEBOOK_LOGOUT_ABORTED' : 'FACEBOOK_DISCONNECT_ABORTED', { accountId });
    const row = this.sessions.get(accountId) || {};
    this.stopReconciliation(row);
    const sourceAccount = account || row.account || null;
    try {
      if (logout && sourceAccount?.credentialRef) {
        const secret = securityGuard.credentials.get(sourceAccount.credentialRef) || {};
        await relayClient.revoke(accountId, secret, options).catch(error => logger.warn('facebook', 'worker-account-revoke-failed', { accountId, error: error.message, code: error.code || '' }));
        assertOperationActive(options.signal, 'FACEBOOK_LOGOUT_ABORTED', { accountId });
      }
      await relayClient.disconnect(accountId).catch(error => logCriticalFailure('relayClient.disconnect', error, { accountId }));
      assertOperationActive(options.signal, logout ? 'FACEBOOK_LOGOUT_ABORTED' : 'FACEBOOK_DISCONNECT_ABORTED', { accountId });
    } catch (error) {
      if (options.signal?.aborted) {
        row.stopped = true;
        row.attemptId = `expired:${clean(row.attemptId)}:${Date.now()}`;
        row.state = 'error'; row.connectedAt = ''; row.canSend = false; row.canReceive = false;
        row.lastError = 'Facebook disconnect outcome is unknown after deadline';
        this.sessions.set(accountId, row); this.emit(accountId, row);
        throw operationAbortError(options.signal, logout ? 'FACEBOOK_LOGOUT_ABORTED' : 'FACEBOOK_DISCONNECT_ABORTED', { accountId });
      }
      throw error;
    }
    row.stopped = true;
    row.attemptId = `expired:${clean(row.attemptId)}:${Date.now()}`;
    row.state = logout ? 'logged-out' : 'paused'; row.connectedAt = ''; row.canSend = false; row.canReceive = false;
    this.sessions.set(accountId, row); this.emit(accountId, row); return this.publicState(row);
  }

  assertEgressCurrent(account, session, signal, executionGeneration, result = null, operation = 'egress') {
    const platformMessageId = clean(result?.messageId || result?.message_id || result?.id);
    const current = this.sessions.get(account.id);
    if (!signal?.aborted && current === session) return true;
    const reason = signal?.reason instanceof Error
      ? signal.reason
      : Object.assign(new Error('Facebook egress result belongs to an expired generation'), { code: 'FACEBOOK_EGRESS_LATE_RESULT_QUARANTINED' });
    if (!reason.code) reason.code = 'FACEBOOK_EGRESS_LATE_RESULT_QUARANTINED';
    reason.platformAccepted = Boolean(platformMessageId);
    reason.platformMessageId = platformMessageId;
    reason.lateResult = true;
    reason.automaticRetryBlocked = true;
    reason.executionGeneration = clean(executionGeneration);
    reason.operation = operation;
    eventBus.publish('facebook:egress-late-result-quarantined', {
      accountId: account.id, operation, executionGeneration: clean(executionGeneration),
      platformMessageId, platformAccepted: reason.platformAccepted, reasonCode: reason.code,
      at: new Date().toISOString()
    });
    throw reason;
  }

  async sendText(account, target, text, options = {}) {
    requirePersistedLegacyFacebookOperation(options, account);
    const { secret } = this.credentials(account); const recipient = recipientId(target);
    const session = this.sessions.get(account.id);
    const idempotencyKey = clean(options.localMessageId, `yance-text-${crypto.randomUUID()}`);
    const result = await relayClient.send(secret, { kind: 'text', recipientId: recipient, text: String(text || ''), replyToMessageId: clean(options.quoted?.externalMessageId || options.quoted?.id) }, idempotencyKey, { ...options, signal: options.signal, executionGeneration: options.executionGeneration });
    this.assertEgressCurrent(account, session, options.signal, options.executionGeneration, result, 'text');
    if (options.localProjectionOwnedByQueue === true) return { messageId: clean(result.messageId), raw: null, localPersistencePending: false, localPersistenceErrorCode: '', localPersistenceRepair: null };
    let localPersistencePending = false;
    let localPersistenceErrorCode = '';
    let localPersistenceRepair = null;
    if (options.localMessageId) {
      const localMessage = { id: options.localMessageId, dedupeKey: options.localMessageId, externalMessageId: clean(result.messageId || options.localMessageId), accountId: account.id, platform: 'facebook', chatJid: `facebook:${recipient}`, conversationId: options.sessionKey || `${account.id}:${recipient}`, direction: 'outbound', fromMe: true, type: 'text', text: String(text || ''), timestamp: new Date().toISOString(), deliveryStatus: 'sent' };
      try {
        await messageStore.upsert(localMessage);
      } catch (error) {
        localPersistencePending = true;
        localPersistenceErrorCode = clean(error?.code || error?.message, 'FACEBOOK_LOCAL_PERSISTENCE_FAILED').split(/\s+/u)[0];
        localPersistenceRepair = { kind: 'message-upsert', message: localMessage };
        logger.error('facebook', 'outbound-meta-accepted-local-persistence-pending', {
          accountId: account.id,
          conversationId: options.sessionKey || `${account.id}:${recipient}`,
          localMessageId: clean(options.localMessageId),
          platformMessageId: clean(result.messageId),
          code: localPersistenceErrorCode,
          error: clean(error?.message || error)
        });
        eventBus.publish('message:local-persistence-pending', {
          platform: 'facebook',
          accountId: account.id,
          conversationId: options.sessionKey || `${account.id}:${recipient}`,
          localMessageId: clean(options.localMessageId),
          platformMessageId: clean(result.messageId),
          code: localPersistenceErrorCode
        });
      }
    }
    return { messageId: clean(result.messageId), raw: null, localPersistencePending, localPersistenceErrorCode, localPersistenceRepair };
  }

  async sendMedia(account, target, input = {}) {
    requirePersistedLegacyFacebookOperation(input, account);
    const { secret } = this.credentials(account); const recipient = recipientId(target); const filePath = path.resolve(input.filePath || '');
    mediaPipeline.verifyFile(filePath);
    const kindMap = { image: 'image', video: 'video', gif: 'image', sticker: 'image', voice: 'audio', audio: 'audio', document: 'file' };
    const attachmentType = kindMap[clean(input.kind, 'document').toLowerCase()] || 'file';
    const bytes = fs.readFileSync(filePath);
    if (bytes.length > 20 * 1024 * 1024) throw Object.assign(new Error('Facebook 附件超过云端发送大小限制'), { code: 'FACEBOOK_MEDIA_SIZE_INVALID', status: 413 });
    const session = this.sessions.get(account.id);
    const idempotencyKey = clean(input.localMessageId, `yance-media-${crypto.randomUUID()}`);
    const result = await relayClient.send(secret, { kind: 'media', recipientId: recipient, replyToMessageId: clean(input.quoted?.externalMessageId || input.quoted?.id), media: { dataBase64: bytes.toString('base64'), attachmentType, mimeType: clean(input.mimeType, 'application/octet-stream'), filename: clean(input.filename, path.basename(filePath)) } }, idempotencyKey, { ...input, signal: input.signal, executionGeneration: input.executionGeneration });
    this.assertEgressCurrent(account, session, input.signal, input.executionGeneration, result, 'media');
    const externalId = clean(result.messageId);
    if (input.localProjectionOwnedByQueue === true && input.localMessageId) {
      const conversationId = input.sessionKey || `${account.id}:${recipient}`;
      const descriptor = { kind: clean(input.kind, 'document'), mimeType: input.mimeType, filename: input.filename, downloadStatus: 'ready', status: 'ready' };
      const localMessage = { id: input.localMessageId, dedupeKey: input.localMessageId, externalMessageId: externalId || input.localMessageId, accountId: account.id, platform: 'facebook', chatJid: `facebook:${recipient}`, conversationId, direction: 'outbound', fromMe: true, type: clean(input.kind, 'document'), text: clean(input.caption), timestamp: new Date().toISOString(), deliveryStatus: 'sent' };
      return {
        messageId: externalId, raw: null, localPersistencePending: true,
        localPersistenceErrorCode: 'FACEBOOK_MEDIA_ATTACHMENT_REPAIR_REQUIRED',
        localPersistenceRepair: { kind: 'outbound-media-upsert', message: localMessage, source: { filePath, expectedSha256: input.expectedSha256 || '' }, descriptor }
      };
    }
    let localPersistencePending = false;
    let localPersistenceErrorCode = '';
    let localPersistenceRepair = null;
    if (input.localMessageId) {
      const conversationId = input.sessionKey || `${account.id}:${recipient}`;
      const descriptor = { kind: clean(input.kind, 'document'), mimeType: input.mimeType, filename: input.filename, downloadStatus: 'ready', status: 'ready' };
      const localMessage = { id: input.localMessageId, dedupeKey: input.localMessageId, externalMessageId: externalId || input.localMessageId, accountId: account.id, platform: 'facebook', chatJid: `facebook:${recipient}`, conversationId, direction: 'outbound', fromMe: true, type: clean(input.kind, 'document'), text: clean(input.caption), timestamp: new Date().toISOString(), deliveryStatus: 'sent' };
      try {
        const attachment = mediaPipeline.saveFile({ accountId: account.id, conversationId, messageId: input.localMessageId, filePath, expectedSha256: input.expectedSha256 || '', descriptor });
        await messageStore.upsert({ ...localMessage, attachments: [attachment], mediaPath: attachment.localFile, mediaUrl: attachment.mediaUrl });
      } catch (error) {
        localPersistencePending = true;
        localPersistenceErrorCode = clean(error?.code || error?.message, 'FACEBOOK_LOCAL_PERSISTENCE_FAILED').split(/\s+/u)[0];
        localPersistenceRepair = { kind: 'outbound-media-upsert', message: localMessage, source: { filePath, expectedSha256: input.expectedSha256 || '' }, descriptor };
        logger.error('facebook', 'outbound-media-meta-accepted-local-persistence-pending', { accountId: account.id, conversationId, localMessageId: input.localMessageId, platformMessageId: externalId, code: localPersistenceErrorCode, error: clean(error?.message || error) });
        eventBus.publish('message:local-persistence-pending', { platform: 'facebook', accountId: account.id, conversationId, localMessageId: input.localMessageId, platformMessageId: externalId, code: localPersistenceErrorCode });
      }
    }
    return { messageId: externalId, raw: null, localPersistencePending, localPersistenceErrorCode, localPersistenceRepair };
  }

  async sendPresence(account, target, state = 'composing', options = {}) {
    requirePersistedLegacyFacebookOperation(options, account);
    const { secret } = this.credentials(account); const action = ['paused','available','cancel'].includes(clean(state).toLowerCase()) ? 'typing_off' : 'typing_on';
    const session = this.sessions.get(account.id);
    const result = await relayClient.send(secret, { kind: action, recipientId: recipientId(target) }, `yance-presence-${crypto.randomUUID()}`, { ...options, signal: options.signal, executionGeneration: options.executionGeneration });
    this.assertEgressCurrent(account, session, options.signal, options.executionGeneration, result, 'presence');
    return result;
  }

  async markRead(account, target, options = {}) {
    requirePersistedLegacyFacebookOperation(options, account);
    const { secret } = this.credentials(account);
    const session = this.sessions.get(account.id);
    const result = await relayClient.send(secret, { kind: 'mark_seen', recipientId: recipientId(target) }, `yance-read-${crypto.randomUUID()}`, { ...options, signal: options.signal, executionGeneration: options.executionGeneration });
    this.assertEgressCurrent(account, session, options.signal, options.executionGeneration, result, 'read');
    return { marked: true, result };
  }

  verifyWebhook() { return null; }
  verifyWebhookSignature() { return { checked: true, valid: false, accountId: '', reason: 'cloudflare-worker-only' }; }

  validateAttachmentUrl(value) {
    const url = new URL(clean(value));
    const host = url.hostname.toLowerCase();
    const localTest = process.env.NODE_ENV === 'test' && ['127.0.0.1', 'localhost'].includes(host);
    const allowed = localTest || url.protocol === 'https:' && ['facebook.com', 'fbcdn.net', 'fbsbx.com'].some(domain => host === domain || host.endsWith(`.${domain}`));
    if (!allowed) throw Object.assign(new Error('Facebook媒体地址不在允许的CDN范围内'), { code: 'FACEBOOK_MEDIA_URL_BLOCKED' });
    return url.toString();
  }

  async fetchAttachmentUrl(value, _signal, options = {}) {
    this.validateAttachmentUrl(value);
    requirePersistedLegacyFacebookOperation(options, options.account || {});
    throw Object.assign(new Error('Legacy Facebook direct CDN fetch is retired; media transfer must run through the persisted Worker adapter'), {
      code: 'FACEBOOK_LEGACY_MEDIA_FETCH_RETIRED', status: 409
    });
  }

  async downloadRemoteAttachment({ account, accountId, conversationId, messageId, attachment, index = 0, physicalOperationContext = null, signal = null }) {
    const options = Object.freeze({ physicalOperationContext, signal, account });
    requirePersistedLegacyFacebookOperation(options, account);
    const workerMedia = attachment?.payload?.worker_media || attachment?.workerMedia || null;
    const workerEventId = clean(workerMedia?.eventId || workerMedia?.event_id);
    if (!workerMedia || !workerEventId) {
      throw Object.assign(new Error('Legacy Facebook remote media URL fetch is retired; a Worker media reference is required'), {
        code: 'FACEBOOK_LEGACY_MEDIA_REFERENCE_REQUIRED', status: 409
      });
    }
    fs.mkdirSync(PATHS.tmp, { recursive: true });
    const tempFile = path.join(PATHS.tmp, `facebook-${crypto.randomUUID()}-${index}.download`);
    try {
      const { secret } = this.credentials(account);
      const result = await relayClient.downloadMedia(secret, workerEventId, Number(workerMedia.index ?? index), tempFile, options);
      if (Number(result.bytes || 0) > CONFIG.mediaMaxBytes) throw Object.assign(new Error('Facebook媒体超过大小限制'), { code: 'MEDIA_TOO_LARGE' });
      return mediaPipeline.saveFile({
        accountId, conversationId, messageId: `${messageId}-${index}`, filePath: tempFile,
        descriptor: {
          id: `${messageId}:${index}`, kind: this.attachmentType(attachment),
          mimeType: clean(result.mimeType, clean(workerMedia?.mime_type || workerMedia?.mimeType, 'application/octet-stream')),
          filename: clean(workerMedia?.filename || attachment?.name, `facebook-${messageId}-${index}`),
          sourceUrl: '', workerMedia: { eventId: workerEventId, index: Number(workerMedia.index ?? index) },
          ...facebookExpressionDescriptor(attachment), status: 'ready', downloadStatus: 'ready'
        }
      });
    } finally {
      try { fs.rmSync(tempFile, { force: true }); } catch (error) { logCriticalFailure('facebookMedia.removeTemporaryFile', error, { accountId: account.id, conversationId, reasonCode: 'FACEBOOK_MEDIA_TEMP_CLEANUP_FAILED' }); }
    }
  }

  async cacheWebhookAttachments(account, baseMessage, rawAttachments = [], options = {}) {
    requirePersistedLegacyFacebookOperation(options, account);
    if (!rawAttachments.length) return baseMessage;
    const attachments = await Promise.all(rawAttachments.map((attachment, index) => {
      const workerMedia = attachment?.payload?.worker_media || attachment?.workerMedia || null;
      const workerEventId = clean(workerMedia?.eventId || workerMedia?.event_id);
      const downloadState = clean(attachment?.downloadStatus || attachment?.status).toLowerCase();
      if (downloadState === 'ready') return Promise.resolve(attachment);
      if (['failed', 'unavailable'].includes(downloadState)) {
        return Promise.resolve({
          ...attachment,
          sourceUrl: '', url: '', mediaUrl: '',
          status: downloadState,
          downloadStatus: downloadState,
          downloadError: clean(
            attachment?.downloadError,
            downloadState === 'failed' ? 'FACEBOOK_WORKER_MEDIA_FAILED' : 'FACEBOOK_LEGACY_MEDIA_FETCH_RETIRED'
          )
        });
      }
      if (!workerEventId || !['pending', 'remote'].includes(downloadState)) {
        return Promise.resolve({
          ...attachment,
          sourceUrl: '', url: '', mediaUrl: '',
          status: 'unavailable', downloadStatus: 'unavailable',
          downloadError: workerEventId ? 'FACEBOOK_WORKER_MEDIA_STATE_INVALID' : 'FACEBOOK_LEGACY_MEDIA_FETCH_RETIRED'
        });
      }
      return this.downloadRemoteAttachment({
        account,
        accountId: account.id,
        conversationId: baseMessage.conversationId,
        messageId: baseMessage.externalMessageId,
        attachment,
        index,
        physicalOperationContext: options.physicalOperationContext,
        signal: options.signal
      });
    }));
    const outcome = await messageStore.upsert({ ...baseMessage, attachments });
    eventBus.publish('facebook:media-cached', { accountId: account.id, conversationId: baseMessage.conversationId, messageId: baseMessage.externalMessageId, attachments });
    return outcome;
  }

  attachmentType(attachment = {}) {
    if (facebookExpressionId(attachment)) return 'sticker';
    const value = clean(attachment.type).toLowerCase(); if (value === 'image') return 'image'; if (value === 'video') return 'video'; if (value === 'audio') return 'audio'; if (value === 'file') return 'document'; if (value === 'fallback') return 'unknown'; return value || 'unknown';
  }

  async senderProfile(account, senderId, conversationId = '', options = {}) {
    requirePersistedLegacyFacebookOperation(options, account);
    const { secret } = this.credentials(account);
    const normalizedSenderId = recipientId(senderId);
    const currentConversation = conversationId ? messageStore.getConversation(clean(conversationId)) : null;
    let profile = {};
    let profileError = null;
    try { profile = await relayClient.profile(secret, normalizedSenderId, options); }
    catch (error) {
      profileError = error;
      logger.warn('facebook', 'contact-profile-fetch-failed', { accountId: account.id, conversationId, senderId: normalizedSenderId, ...avatarErrorEvidence(error) });
    }
    let avatarUrl = clean(currentConversation?.avatarUrl);
    try {
      const avatar = await this.avatarBufferWithRetry(secret, 'profile', normalizedSenderId, 1, { ...options, account });
      const cached = currentConversation
        ? await avatarService.cacheBuffer({ accountId: account.id, conversationId, buffer: avatar.buffer, source: 'facebook-profile-proxy' })
        : await avatarService.cacheStandaloneBuffer({ accountId: account.id, assetKey: `facebook-profile-${normalizedSenderId}`, buffer: avatar.buffer, source: 'facebook-profile-proxy' });
      avatarUrl = cached.avatarUrl || avatarUrl;
      if (currentConversation) {
        await messageStore.updateConversationMetadata(conversationId, {
          avatarUrl,
          avatarStatus: 'ready',
          avatarLastError: '',
          avatarUpdatedAt: cached.avatarUpdatedAt || new Date().toISOString(),
          avatarSource: 'facebook-profile-proxy'
        });
      }
      logger.info('facebook', 'contact-avatar-cache-ready', { accountId: account.id, conversationId, senderId: normalizedSenderId });
    } catch (error) {
      const evidence = avatarErrorEvidence(error);
      logger.warn('facebook', 'contact-avatar-cache-failed', { accountId: account.id, conversationId, senderId: normalizedSenderId, ...evidence });
      if (currentConversation) {
        await messageStore.updateConversationMetadata(conversationId, {
          avatarStatus: ['FACEBOOK_CONTACT_AVATAR_UNSUPPORTED_GET','META_CONTACT_AVATAR_UNSUPPORTED_GET','FACEBOOK_CONTACT_PROFILE_PERMISSION_DENIED','META_CONTACT_PROFILE_ACCESS_DENIED'].includes(evidence.code) ? 'unavailable' : 'failed',
          avatarLastError: evidence.code,
          avatarUpdatedAt: new Date().toISOString(),
          avatarSource: 'facebook-profile-proxy'
        }).catch(metadataError => logCriticalFailure('messageStore.updateConversationMetadata.senderProfileFailed', metadataError, { accountId: account.id, conversationId, reasonCode: evidence.code }));
      }
    }
    const fallbackName = clean(currentConversation?.title || currentConversation?.contactName, `Facebook ${senderId}`);
    return {
      name: clean([profile.firstName, profile.lastName].filter(Boolean).join(' '), fallbackName),
      avatarUrl,
      profileStatus: profileError ? 'failed' : 'ready',
      profileLastError: profileError ? avatarErrorEvidence(profileError).code : ''
    };
  }

  async pagedRows(firstPage, maximumItems, maximumPages = 10, accessToken = '') {
    const rows = [];
    let page = firstPage && typeof firstPage === 'object' ? firstPage : { data: [] };
    for (let pageIndex = 0; pageIndex < maximumPages && rows.length < maximumItems; pageIndex += 1) {
      rows.push(...(Array.isArray(page.data) ? page.data : []));
      const next = clean(page.paging?.next);
      if (!next || rows.length >= maximumItems) break;
      page = await this.request(safeGraphPagingUrl(next), { accessToken });
    }
    return rows.slice(0, maximumItems);
  }

  async sync(account, options = {}) {
    requirePersistedLegacyFacebookOperation(options, account);
    assertOperationActive(options.signal, 'FACEBOOK_SYNC_ABORTED', { accountId: account.id });
    const { secret } = this.credentials(account);
    const pageId = clean(secret.pageId || account.metadata?.pageId);
    if (!pageId) throw Object.assign(new Error('Facebook 公共主页 ID 不存在'), { code: 'FACEBOOK_PAGE_ID_MISSING' });
    const maximumConversations = boundedInteger(options.maximumConversations ?? process.env.YANCE_FACEBOOK_SYNC_CONVERSATIONS, 200, 1, 1000);
    const maximumMessages = boundedInteger(options.maximumMessages ?? process.env.YANCE_FACEBOOK_SYNC_MESSAGES_PER_CONVERSATION, 200, 1, 1000);
    const syncSource = clean(options.source, 'facebook-history-sync');
    const usePersistentCursor = options.usePersistentCursor !== false && /reconciliation/iu.test(syncSource);
    const checkpointScope = 'business-suite-reconciliation';
    const previousCheckpoint = usePersistentCursor ? syncCheckpoint.read('facebook', account.id, checkpointScope) : null;
    const startAfter = options.resetCursor === true ? '' : clean(previousCheckpoint?.cursor);
    const checkpointBatch = usePersistentCursor
      ? syncCheckpoint.begin({ platform: 'facebook', accountId: account.id, scopeId: checkpointScope, cursor: startAfter, payload: { source: syncSource } })
      : null;
    const conversations = [];
    let after = startAfter;
    let nextCursor = '';
    try {
      for (let pageIndex = 0; pageIndex < 20 && conversations.length < maximumConversations; pageIndex += 1) {
        assertOperationActive(options.signal, 'FACEBOOK_SYNC_ABORTED', { accountId: account.id, pageIndex });
        const page = await relayClient.history(secret, {
          limit: Math.min(100, maximumConversations - conversations.length),
          messagesLimit: Math.min(100, maximumMessages),
          after
        }, {
          signal: options.signal,
          executionGeneration: options.executionGeneration || options.operationGeneration || '',
          physicalOperationContext: options.physicalOperationContext
        });
        assertOperationActive(options.signal, 'FACEBOOK_SYNC_ABORTED', { accountId: account.id, pageIndex });
        conversations.push(...(Array.isArray(page.data) ? page.data : []));
        const nextAfter = clean(page.paging?.cursors?.after);
        const hasNext = Boolean(nextAfter && nextAfter !== after && page.paging?.next === 'available');
        nextCursor = hasNext ? nextAfter : '';
        if (!hasNext || conversations.length >= maximumConversations) break;
        after = nextAfter;
      }
    } catch (error) {
      if (checkpointBatch) syncCheckpoint.fail({ platform: 'facebook', accountId: account.id, scopeId: checkpointScope, batchId: checkpointBatch.batchId, error: error.message, payload: { source: syncSource, startAfter } });
      throw error;
    }
    let synchronized = 0; let messagesScanned = 0; let messagesInserted = 0; let avatars = 0; let failedConversations = 0;

    for (const conversation of conversations.slice(0, maximumConversations)) {
      assertOperationActive(options.signal, 'FACEBOOK_SYNC_ABORTED', { accountId: account.id });
      try {
        const messages = [];
        const embedded = Array.isArray(conversation.messages?.data) ? conversation.messages.data : [];
        messages.push(...embedded);
        let messageAfter = clean(conversation.messages?.paging?.cursors?.after);
        while (messageAfter && messages.length < maximumMessages) {
          assertOperationActive(options.signal, 'FACEBOOK_SYNC_ABORTED', { accountId: account.id, externalConversationId: clean(conversation.id) });
          const page = await relayClient.historyMessages(secret, clean(conversation.id), {
            limit: Math.min(100, maximumMessages - messages.length),
            after: messageAfter
          }, {
            signal: options.signal,
            executionGeneration: options.executionGeneration || options.operationGeneration || '',
            physicalOperationContext: options.physicalOperationContext
          });
          assertOperationActive(options.signal, 'FACEBOOK_SYNC_ABORTED', { accountId: account.id, externalConversationId: clean(conversation.id) });
          const batch = Array.isArray(page.data) ? page.data : [];
          messages.push(...batch);
          const nextAfter = clean(page.paging?.cursors?.after);
          if (!nextAfter || nextAfter === messageAfter || page.paging?.next !== 'available' || !batch.length) break;
          messageAfter = nextAfter;
        }
        const limitedMessages = messages.slice(0, maximumMessages);
        const peer = conversationPeer(conversation, pageId, limitedMessages);
        if (!peer.id) {
          failedConversations += 1;
          logger.warn('facebook', 'history-sync-peer-missing', { accountId: account.id, externalConversationId: clean(conversation.id) });
          continue;
        }
        const conversationId = `${account.id}:${peer.id}`;
        const existing = messageStore.getConversation(conversationId);
        const unreadBefore = Number(existing?.unreadCount ?? existing?.unread ?? 0);
        const ordered = [...limitedMessages].sort((left, right) => Date.parse(left?.created_time || '') - Date.parse(right?.created_time || ''));
        for (const message of ordered) {
          assertOperationActive(options.signal, 'FACEBOOK_SYNC_ABORTED', { accountId: account.id, externalConversationId: clean(conversation.id) });
          const externalId = clean(message?.id);
          if (!externalId) continue;
          const rawTimestamp = Date.parse(clean(message.created_time));
          const timestamp = new Date(Number.isFinite(rawTimestamp) ? rawTimestamp : Date.now()).toISOString();
          const fromId = clean(message.from?.id);
          const fromMe = fromId === pageId;
          const attachments = graphAttachments(message);
          const type = attachments[0]?.kind || 'text';
          const text = clean(message.message) || (type === 'text' ? '' : `[${type}]`);
          const outcome = await retrySqliteBusy('message-upsert', () => messageStore.upsert({
            id: externalId,
            externalMessageId: externalId,
            dedupeKey: `${account.id}:${peer.id}:${externalId}`,
            accountId: account.id,
            sourceAccountId: account.id,
            platform: 'facebook',
            pageId,
            pageScopedUserId: peer.id,
            contactExternalId: peer.id,
            contactId: facebookContactId(account.id, peer.id),
            chatJid: `facebook:${peer.id}`,
            conversationId,
            direction: fromMe ? 'outbound' : 'inbound',
            fromMe,
            type,
            text,
            sender: fromId || peer.id,
            senderName: fromMe ? account.displayName : (clean(message.from?.name) || peer.name),
            contactName: peer.name || `Facebook ${peer.id}`,
            timestamp,
            attachments,
            deliveryStatus: fromMe ? 'sent' : '',
            source: syncSource,
            historical: true,
            externalConversationId: clean(conversation.id),
            rawMessage: null
          }), { attempts: 12, baseDelayMs: 40, signal: options.signal });
          messagesScanned += 1;
          if (outcome.inserted) messagesInserted += 1;
        }

        const basicName = existing?.title || existing?.contactName || peer.name || `Facebook ${peer.id}`;
        const existingAvatarUrl = existing?.avatarUrl || '';
        if (existingAvatarUrl) avatars += 1;
        const serverUnread = Number(conversation.unread_count);
        await retrySqliteBusy('conversation-metadata', () => messageStore.updateConversationMetadata(conversationId, {
          accountId: account.id,
          sourceAccountId: account.id,
          platform: 'facebook',
          pageId,
          pageScopedUserId: peer.id,
          contactExternalId: peer.id,
          contactId: facebookContactId(account.id, peer.id),
          chatJid: `facebook:${peer.id}`,
          title: basicName,
          contactName: basicName,
          externalConversationId: clean(conversation.id),
          ...(existingAvatarUrl ? { avatarUrl: existingAvatarUrl } : {}),
          unreadCount: Number.isFinite(serverUnread) ? Math.max(0, serverUnread) : Math.max(0, unreadBefore),
          historySyncAt: new Date().toISOString(),
          lastSyncAt: new Date().toISOString(),
          reconciliationSource: syncSource
        }), { attempts: 12, baseDelayMs: 40, signal: options.signal });
        assertOperationActive(options.signal, 'FACEBOOK_SYNC_ABORTED', { accountId: account.id, conversationId });
        synchronized += 1;
      } catch (error) {
        if (options.signal?.aborted) {
          if (checkpointBatch) syncCheckpoint.fail({ platform: 'facebook', accountId: account.id, scopeId: checkpointScope, batchId: checkpointBatch.batchId, error: clean(options.signal.reason?.message, 'Facebook sync aborted'), payload: { source: syncSource, startAfter, aborted: true } });
          throw operationAbortError(options.signal, 'FACEBOOK_SYNC_ABORTED', { accountId: account.id, externalConversationId: clean(conversation?.id) });
        }
        failedConversations += 1;
        logger.warn('facebook', 'history-sync-conversation-failed', { accountId: account.id, externalConversationId: clean(conversation?.id), error: error.message, code: error.code || '' });
      }
    }
    assertOperationActive(options.signal, 'FACEBOOK_SYNC_ABORTED', { accountId: account.id });
    const syncedAt = new Date().toISOString();
    if (checkpointBatch) {
      syncCheckpoint.commit({
        platform: 'facebook',
        accountId: account.id,
        scopeId: checkpointScope,
        batchId: checkpointBatch.batchId,
        cursor: failedConversations > 0 ? startAfter : nextCursor,
        remoteTimestamp: syncedAt,
        payload: { source: syncSource, conversations: synchronized, failedConversations, nextCursor: failedConversations > 0 ? startAfter : nextCursor }
      });
    }
    return {
      conversations: synchronized, messagesScanned, messagesInserted, avatars, failedConversations, syncedAt,
      ...(usePersistentCursor ? { reconciliationCursor: failedConversations > 0 ? startAfter : nextCursor, cursorAdvanced: failedConversations === 0 && startAfter !== nextCursor } : {})
    };
  }

  drainHistoryContactEnrichmentQueue() { return 0; }

  scheduleHistoryContactEnrichment(account, peerId, conversationId, fallbackName = '') {
    return Promise.resolve({
      ok: false, delegated: true, authority: 'DurableExecutionAuthorityV2', operationKind: 'HISTORY_SYNCHRONIZATION',
      accountId: clean(account?.id), peerId: clean(peerId), conversationId: clean(conversationId), fallbackName: clean(fallbackName),
      code: 'FACEBOOK_HISTORY_PROFILE_ENRICHMENT_DELEGATED'
    });
  }

  scheduleWebhookContactEnrichment(account, peerId, conversationId, fallbackName = '') {
    return Promise.resolve({
      ok: false, delegated: true, authority: 'DurableExecutionAuthorityV2', operationKind: 'HISTORY_SYNCHRONIZATION',
      accountId: clean(account?.id), peerId: clean(peerId), conversationId: clean(conversationId), fallbackName: clean(fallbackName),
      code: 'FACEBOOK_WEBHOOK_PROFILE_ENRICHMENT_DELEGATED'
    });
  }

  async handleWebhook(body, accounts) {
    const entries = Array.isArray(body?.entry) ? body.entry : []; let accepted = 0;
    for (const entry of entries) {
      const pageId = clean(entry.id);
      const account = accounts.find(row => row.platform === 'facebook' && clean((securityGuard.credentials.get(row.credentialRef) || {}).pageId || row.metadata?.pageId) === pageId);
      if (!account) {
        logger.warn('facebook', 'webhook-page-unbound', { pageId, configuredAccountIds: accounts.filter(row => row.platform === 'facebook').map(row => row.id) });
        continue;
      }
      for (const event of Array.isArray(entry.messaging) ? entry.messaging : []) {
        const msg = event.message || null;
        const isEcho = msg?.is_echo === true;
        const sender = clean(event.sender?.id);
        const recipient = clean(event.recipient?.id);
        const peerId = webhookPeerId(event, pageId, isEcho);
        if (!peerId) {
          logger.warn('facebook', 'webhook-peer-unresolved', { accountId: account.id, pageId, sender, recipient, isEcho, messageId: clean(msg?.mid) });
          continue;
        }
        const chatJid = `facebook:${peerId}`;
        if (event.delivery?.mids) for (const mid of event.delivery.mids) await messageStore.updateReceipt({ accountId: account.id, chatJid, messageId: mid, status: 'delivered' });
        if (event.read) {
          const receipt = await messageStore.updateReceiptsThrough({ accountId: account.id, chatJid, watermark: event.read.watermark || Date.now(), status: 'read' });
          eventBus.publish('message:receipt', { accountId: account.id, platform: 'facebook', chatJid, status: 'read', watermark: event.read.watermark || 0, persisted: receipt.count });
        }
        if (event.reaction?.mid) {
          await messageStore.applyReaction({
            accountId: account.id,
            chatJid,
            targetId: clean(event.reaction.mid),
            emoji: clean(event.reaction.action).toLowerCase() === 'remove' ? '' : clean(event.reaction.emoji),
            actor: peerId
          });
        }
        if (msg?.is_deleted === true && clean(msg.mid)) {
          await messageStore.revoke({ accountId: account.id, chatJid, targetId: clean(msg.mid) });
          continue;
        }
        const referral = normalizeReferral(event.referral || msg?.referral);
        if (!msg && !referral) continue;
        const rawTimestampMs = Number(event.timestamp || Date.now());
        const timestampMs = Number.isFinite(rawTimestampMs) && rawTimestampMs > 0 ? rawTimestampMs : Date.now();
        const referralKey = referral ? [referral.source, referral.type, referral.adId, referral.flowId, referral.ref].join(':') : '';
        const generatedId = `referral-${crypto.createHash('sha256').update(`${account.id}:${peerId}:${timestampMs}:${referralKey}`).digest('hex').slice(0, 24)}`;
        const externalId = clean(msg?.mid || generatedId);
        const text = clean(msg?.text) || referralMessageText(referral);
        const conversationId = `${account.id}:${peerId}`;
        const rawAttachments = Array.isArray(msg?.attachments) ? msg.attachments : [];
        const attachments = rawAttachments.map((attachment, index) => {
          const workerMedia = attachment?.payload?.worker_media || null;
          const sourceUrl = clean(attachment?.payload?.url);
          const available = Boolean(sourceUrl || (workerMedia && workerMedia.status !== 'failed'));
          return {
            id: `${externalId}:${index}`,
            kind: this.attachmentType(attachment),
            mimeType: clean(workerMedia?.mime_type),
            filename: clean(workerMedia?.filename || attachment?.name),
            size: Math.max(0, Number(workerMedia?.size || 0)),
            sourceUrl,
            url: sourceUrl,
            mediaUrl: sourceUrl,
            workerMedia: workerMedia ? { eventId: clean(workerMedia.event_id), index: Number(workerMedia.index ?? index) } : null,
            ...facebookExpressionDescriptor(attachment),
            status: available ? 'remote' : 'unavailable',
            downloadStatus: available ? 'remote' : 'unavailable'
          };
        });
        const type = msg ? (attachments[0]?.kind || 'text') : 'referral';
        const currentConversation = messageStore.getConversation(conversationId);
        const baseMessage = {
          id: externalId, externalMessageId: externalId, dedupeKey: `${account.id}:${peerId}:${externalId}`,
          accountId: account.id, sourceAccountId: account.id, platform: 'facebook', pageId,
          pageScopedUserId: peerId, contactExternalId: peerId, contactId: facebookContactId(account.id, peerId),
          chatJid, conversationId, externalConversationId: clean(currentConversation?.externalConversationId),
          direction: isEcho ? 'outbound' : 'inbound', fromMe: isEcho, type, text: text || (type === 'text' ? '' : `[${type}]`), sender: isEcho ? pageId : peerId,
          timestamp: new Date(timestampMs).toISOString(), attachments, quotedMessageId: clean(msg?.reply_to?.mid),
          source: referral?.source === 'ADS' ? 'facebook-ad-referral' : referral ? 'facebook-referral' : 'facebook-webhook',
          facebookReferral: referral,
          acquisitionSource: referral?.source === 'ADS' ? 'facebook-ad' : referral ? 'facebook-referral' : '',
          rawMessage: null
        };
        const receivedAtMs = Date.now();
        const fallbackName = clean(
          currentConversation?.title || currentConversation?.contactName,
          'Facebook Messenger 联系人'
        );
        const avatarUrl = clean(currentConversation?.avatarUrl);
        const messageWithContact = { ...baseMessage, contactName: fallbackName, avatarUrl };
        const workerMediaCount = rawAttachments.filter(attachment => {
          const workerMedia = attachment?.payload?.worker_media || null;
          return clean(workerMedia?.event_id) && workerMedia?.status !== 'failed';
        }).length;
        const legacyRemoteMediaCount = rawAttachments.filter(attachment => attachment?.payload?.url).length;
        const hasWorkerMedia = workerMediaCount > 0;
        const pendingAttachments = attachments.map((attachment, index) => {
          const workerMedia = rawAttachments[index]?.payload?.worker_media || null;
          const workerEventId = clean(workerMedia?.event_id);
          const workerReady = Boolean(workerEventId && workerMedia?.status !== 'failed');
          return {
            ...attachment,
            id: attachment.id || `${externalId}:${index}`,
            sourceUrl: '',
            url: '',
            mediaUrl: '',
            status: workerReady ? 'pending' : 'unavailable',
            downloadStatus: workerReady ? 'pending' : 'unavailable',
            downloadError: workerReady ? '' : 'FACEBOOK_LEGACY_MEDIA_FETCH_RETIRED'
          };
        });
        const outcome = await messageStore.upsert({
          ...messageWithContact,
          attachments: pendingAttachments.length ? pendingAttachments : messageWithContact.attachments
        });
        const persistedAtMs = Date.now();
        eventBus.publish('facebook:webhook-message-persisted', {
          accountId: account.id,
          conversationId,
          messageId: externalId,
          peerId,
          direction: isEcho ? 'outbound' : 'inbound',
          isEcho,
          newConversation: !currentConversation,
          inserted: outcome.inserted === true,
          source: baseMessage.source,
          latencyMs: Math.max(0, persistedAtMs - receivedAtMs)
        });
        logger.info('facebook', 'webhook-message-persisted-before-enrichment', {
          accountId: account.id,
          conversationId,
          messageId: externalId,
          peerId,
          direction: isEcho ? 'outbound' : 'inbound',
          isEcho,
          newConversation: !currentConversation,
          inserted: outcome.inserted === true,
          source: baseMessage.source,
          latencyMs: Math.max(0, persistedAtMs - receivedAtMs)
        });
        if (referral) {
          await messageStore.updateConversationMetadata(conversationId, {
            facebookReferral: referral,
            acquisitionSource: referral.source === 'ADS' ? 'facebook-ad' : 'facebook-referral',
            facebookAdId: referral.adId || '',
            facebookReferralUpdatedAt: baseMessage.timestamp
          }).catch(error => logCriticalFailure('webhook.referralMetadata', error, { accountId: account.id, conversationId }));
        }
        if (hasWorkerMedia) {
          eventBus.publish('facebook:webhook-media-delegated', {
            accountId: account.id,
            conversationId,
            messageId: externalId,
            operationKind: 'MEDIA_TRANSFER',
            workerMediaCount,
            legacyRemoteMediaCount
          });
        }
        if (outcome.inserted && !isEcho) {
          const notificationConversation = outcome.conversation || {};
          const notificationMessage = outcome.message || baseMessage;
          try {
            notificationPolicy.notify({
              accountId: account.id,
              platform: 'facebook',
              conversationId,
              sessionKey: conversationId,
              title: notificationConversation.title || notificationConversation.contactName || fallbackName,
              senderName: notificationConversation.title || notificationConversation.contactName || fallbackName,
              body: notificationMessage.text || text || `[${type}]`,
              messagePreview: notificationMessage.text || text || `[${type}]`,
              messageId: notificationMessage.externalMessageId || notificationMessage.id || externalId,
              mediaType: notificationMessage.type || type,
              avatarUrl: notificationConversation.avatarUrl || avatarUrl || ''
            });
          } catch (error) {
            logCriticalFailure('webhook.notification', error, { accountId: account.id, conversationId, messageId: externalId });
          }
          accepted += 1;
        }
        if (!currentConversation || avatarService.needsRefresh(conversationId)) {
          eventBus.publish('facebook:webhook-profile-enrichment-delegated', { accountId: account.id, conversationId, peerId, operationKind: 'HISTORY_SYNCHRONIZATION' });
        }
      }
    }
    return { accepted };
  }
}

const facebookAdapter = new FacebookAdapter();
eventBus.on('facebook:webhook-media-delegated', event => facebookAdapter.scheduleWebhookMediaTransfer(event.payload || {}, event.id));
module.exports = facebookAdapter;
module.exports.FacebookAdapter = FacebookAdapter;
module.exports.missingPermissions = missingPermissions;
module.exports.missingOptionalPermissions = missingOptionalPermissions;
module.exports.subscriptionFields = subscriptionFields;
module.exports.normalizeReferral = normalizeReferral;
module.exports.referralMessageText = referralMessageText;
module.exports.graphAttachments = graphAttachments;
module.exports.facebookExpressionId = facebookExpressionId;
module.exports.facebookExpressionDescriptor = facebookExpressionDescriptor;
module.exports.conversationPeer = conversationPeer;
module.exports.webhookPeerId = webhookPeerId;
module.exports.facebookContactId = facebookContactId;
module.exports.safeGraphPagingUrl = safeGraphPagingUrl;
module.exports.retrySqliteBusy = retrySqliteBusy;

module.exports.avatarProbeMetaClassification = avatarProbeMetaClassification;
module.exports.contactAvatarCapability = contactAvatarCapability;
