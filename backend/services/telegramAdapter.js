'use strict';

const path = require('path');
const crypto = require('node:crypto');
const { getSecurityGuard } = require('../core/securityGuardSingleton');
const securityGuard = getSecurityGuard();
const messageStore = require('./messageStore');
const mediaPipeline = require('./mediaPipeline');
const eventBus = require('./eventBus');
const logger = require('./logger');
const notificationPolicy = require('./notificationPolicy');
const syncCheckpoint = require('./syncCheckpointService');
const avatarService = require('./avatarService');
const platformAuthConfig = require('./platformAuthConfig');
const authChallenges = require('./authChallengeService');
const expressionReferences = require('./telegramExpressionReferenceService');
const { currentRuntimeInternalOperationAuthority } = require('./durableInternalOperationAuthority');
const { currentRuntimeRecoveryAuthority } = require('./durableExecutionRecoveryAuthority');
const { executeWithDeadline } = require('./executionDeadline');
const { createSessionGenerationFence } = require('./sessionGenerationFence');

let qrCodeRenderer = null;
function loadQRCodeDependency(moduleLoader = require) {
  try {
    const dependency = moduleLoader('qrcode');
    if (!dependency || typeof dependency.toDataURL !== 'function') {
      throw Object.assign(new Error('qrcode 模块缺少 toDataURL'), { code: 'TELEGRAM_QR_RENDERER_INVALID' });
    }
    return dependency;
  } catch (error) {
    const wrapped = new Error(`Telegram 二维码渲染组件不可用：${error.message || error}`);
    wrapped.code = error.code === 'TELEGRAM_QR_RENDERER_INVALID' ? error.code : 'TELEGRAM_QR_RENDERER_MISSING';
    wrapped.cause = error;
    throw wrapped;
  }
}
function getQRCodeRenderer() {
  if (!qrCodeRenderer) qrCodeRenderer = loadQRCodeDependency();
  return qrCodeRenderer;
}

class Deferred {
  constructor() {
    this.promise = new Promise((resolve, reject) => { this.resolve = resolve; this.reject = reject; });
  }
}

function clean(value, fallback = '') { return value == null ? fallback : String(value).trim(); }
function targetId(value) { return clean(value).replace(/^telegram:/i, ''); }
function messageId(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : value;
}

function compareMessageIds(left, right) {
  const leftText = clean(left);
  const rightText = clean(right);
  if (leftText === rightText) return 0;
  if (/^-?\d+$/.test(leftText) && /^-?\d+$/.test(rightText)) {
    try {
      const leftBigInt = BigInt(leftText);
      const rightBigInt = BigInt(rightText);
      return leftBigInt < rightBigInt ? -1 : 1;
    } catch (_) {}
  }
  return leftText < rightText ? -1 : 1;
}

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
}


function operationAbortError(signal, fallbackCode = 'TELEGRAM_OPERATION_ABORTED', details = {}) {
  const reason = signal?.reason instanceof Error
    ? signal.reason
    : Object.assign(new Error('Telegram operation aborted'), { code: fallbackCode });
  if (!reason.code) reason.code = fallbackCode;
  return Object.assign(reason, details);
}

function assertOperationActive(signal, fallbackCode = 'TELEGRAM_OPERATION_ABORTED', details = {}) {
  if (signal?.aborted) throw operationAbortError(signal, fallbackCode, details);
}

function telegramTimestamp(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return new Date().toISOString();
  const milliseconds = number > 10_000_000_000 ? number : number * 1000;
  return new Date(milliseconds).toISOString();
}

function telegramDisplayName(user = {}, fallback = 'Telegram 账号') {
  return clean([user.firstName, user.lastName].filter(Boolean).join(' ') || (user.username ? `@${user.username}` : '') || user.phone || fallback);
}

function peerValue(peer) {
  if (peer == null) return '';
  if (typeof peer === 'string' || typeof peer === 'number' || typeof peer === 'bigint') return clean(peer);
  return clean(peer.userId || peer.chatId || peer.channelId || peer.id || peer.value);
}

function telegramTypingActivity(action) {
  const name = clean(action?.className || action?.constructor?.name || action?._).toLowerCase();
  if (!name || name.includes('cancel')) return 'paused';
  if (name.includes('typing')) return 'composing';
  if (name.includes('record') || name.includes('voice') || name.includes('audio')) return 'recording';
  if (name.includes('upload') || name.includes('photo') || name.includes('video') || name.includes('document') || name.includes('sticker')) return 'uploading';
  return 'composing';
}

function telegramPresenceUpdate(update) {
  const className = clean(update?.className || update?.constructor?.name || update?._).toLowerCase();
  if (!className.includes('userstatus')) return null;
  const userId = peerValue(update?.userId || update?.peer || update?.id);
  if (!userId) return null;
  const status = update?.status || {};
  const statusName = clean(status?.className || status?.constructor?.name || status?._).toLowerCase();
  if (statusName.includes('online')) return { userId, state: 'available', lastSeen: '', lastSeenPrecision: '' };
  if (statusName.includes('offline')) {
    return { userId, state: 'unavailable', lastSeen: status?.wasOnline ? telegramTimestamp(status.wasOnline) : '', lastSeenPrecision: 'exact' };
  }
  const privacyPrecision = statusName.includes('recently')
    ? 'recently'
    : statusName.includes('lastweek')
      ? 'last_week'
      : statusName.includes('lastmonth')
        ? 'last_month'
        : statusName.includes('empty')
          ? 'hidden'
          : '';
  if (privacyPrecision) return { userId, state: 'unavailable', lastSeen: '', lastSeenPrecision: privacyPrecision };
  return null;
}

function telegramTypingUpdate(update) {
  const className = clean(update?.className || update?.constructor?.name || update?._).toLowerCase();
  if (!className.includes('typing')) return null;
  let chatId = '';
  let kind = 'user';
  if (update.userId != null) chatId = peerValue(update.userId);
  else if (update.chatId != null) { chatId = peerValue(update.chatId); kind = 'chat'; }
  else if (update.channelId != null) { chatId = peerValue(update.channelId); kind = 'channel'; }
  else if (update.peer != null) chatId = peerValue(update.peer);
  if (!chatId) return null;
  return {
    chatId,
    kind,
    participant: peerValue(update.fromId || update.userId),
    state: telegramTypingActivity(update.action),
    action: clean(update.action?.className || update.action?.constructor?.name || update.action?._)
  };
}

class TelegramAdapter {
  constructor() { this.sessions = new Map(); }

  persistCredentials(credentialRef, value) { return securityGuard.credentials.persist(credentialRef, value, { actor: 'platform-adapter' }); }

  loadSdk() {
    try {
      const telegram = require('telegram');
      const { StringSession } = require('telegram/sessions');
      const { NewMessage } = require('telegram/events');
      return { ...telegram, StringSession, NewMessage };
    } catch (error) {
      const wrapped = new Error('Telegram 运行库尚未安装，请先执行依赖安装');
      wrapped.code = 'TELEGRAM_SDK_MISSING';
      wrapped.cause = error;
      throw wrapped;
    }
  }

  status(accountId) {
    const row = this.sessions.get(accountId);
    return row ? this.publicState(row) : { state: 'unconfigured', lastError: '', step: '', user: null, connectedAt: '' };
  }

  publicState(row) {
    const challenge = authChallenges.status(row.account?.id || '');
    return {
      state: row.state || 'unconfigured', step: row.step || '', lastError: row.lastError || '',
      connectedAt: row.connectedAt || '', lastSyncAt: row.lastSyncAt || '', user: row.user || null, floodWaitSeconds: row.floodWaitSeconds || 0,
      historySyncRunning: row.historySyncRunning === true,
      historySyncLastAt: row.historySyncLastAt || row.lastSyncAt || '',
      historySyncLastError: row.historySyncLastError || '',
      historySyncLastResult: row.historySyncLastResult || null,
      authMode: row.authMode || '', qrReady: challenge.ready, qrExpiresAt: challenge.expiresAt || '',
      qrVersion: Number(challenge.version || 0), phoneHint: row.phoneHint || '',
      attemptId: clean(row.attemptId)
    };
  }

  emit(accountId, row) { eventBus.publish('account:state', { accountId, platform: 'telegram', ...this.publicState(row) }); }

  isCurrentRow(accountId, row) { return this.sessions.get(accountId) === row; }

  connected(accountId) {
    const row = this.sessions.get(accountId);
    if (!row?.client || row.state !== 'connected') {
      throw Object.assign(new Error('Telegram账号未连接'), { code: 'TELEGRAM_NOT_CONNECTED', status: 409 });
    }
    return row;
  }

  bindEgressAbort(accountId, row, options = {}) {
    const signal = options?.signal;
    const executionGeneration = clean(options?.executionGeneration);
    if (!signal || typeof signal.addEventListener !== 'function') return () => {};
    const onAbort = () => {
      if (!this.isCurrentRow(accountId, row) || !row?.client) return;
      const reason = signal.reason instanceof Error
        ? signal.reason
        : Object.assign(new Error('Telegram egress generation aborted'), { code: 'TELEGRAM_EGRESS_ABORTED' });
      row.egressDeadlineGeneration = executionGeneration;
      row.egressDeadlineAt = new Date().toISOString();
      row.state = 'recovering';
      row.step = 'egress-recovery';
      row.lastError = reason.message || 'Telegram 发送执行超时，正在重建连接';
      this.emit(accountId, row);
      eventBus.publish('telegram:egress-generation-quarantined', {
        accountId,
        executionGeneration,
        reasonCode: reason.code || 'TELEGRAM_EGRESS_ABORTED',
        at: row.egressDeadlineAt
      });
      if (row.egressRecoveryScheduled) return;
      row.egressRecoveryScheduled = true;
      Promise.resolve()
        .then(() => executeWithDeadline(() => row.client?.disconnect?.(), {
          timeoutMs: 5_000,
          code: 'TELEGRAM_EGRESS_ABORT_DISCONNECT_TIMEOUT',
          operation: 'telegram-egress-abort-disconnect',
          platform: 'telegram',
          accountId
        }))
        .catch(error => logger.warn('telegram', 'egress-abort-disconnect-failed', {
          accountId,
          executionGeneration,
          errorCode: error.code || '',
          error: error.message
        }))
        .finally(() => {
          row.egressRecoveryScheduled = false;
          if (!this.isCurrentRow(accountId, row) || !row.account) return;
          this.connect(row.account).catch(error => logger.warn('telegram', 'egress-reconnect-failed', {
            accountId,
            executionGeneration,
            errorCode: error.code || '',
            error: error.message
          }));
        });
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
    return () => signal.removeEventListener?.('abort', onAbort);
  }

  assertEgressActive(accountId, row, options = {}, platformAccepted = false) {
    if (!options?.signal?.aborted && this.isCurrentRow(accountId, row)) return;
    const reason = options?.signal?.reason;
    throw Object.assign(
      reason instanceof Error ? reason : new Error('Telegram egress generation is no longer authoritative'),
      {
        code: reason?.code || 'TELEGRAM_EGRESS_GENERATION_STALE',
        platformAccepted: platformAccepted === true,
        outcomeUnknown: true,
        automaticRetryBlocked: true,
        executionGeneration: clean(options?.executionGeneration)
      }
    );
  }

  credentials(account) {
    const appCredentials = platformAuthConfig.telegram();
    const secret = securityGuard.credentials.get(account.credentialRef) || {};
    if (!appCredentials.configured) {
      throw Object.assign(new Error('当前安装包尚未启用 Telegram 登录，请安装已启用的正式升级包'), {
        code: 'TELEGRAM_RELEASE_SERVICE_UNAVAILABLE', status: 409
      });
    }
    return { appCredentials, secret };
  }

  createClient(account, secret, appCredentials) {
    const { TelegramClient, StringSession } = this.loadSdk();
    return new TelegramClient(
      new StringSession(clean(secret.session)),
      appCredentials.apiId,
      appCredentials.apiHash,
      { connectionRetries: 5, autoReconnect: true }
    );
  }

  async completeLogin(account, row, secret, user = null, options = {}) {
    const activeSignal = row.authOperationSignal || options.signal || null;
    assertOperationActive(activeSignal, 'TELEGRAM_LOGIN_COMPLETION_ABORTED', { accountId: account.id, attemptId: clean(row.attemptId) });
    if (!this.isCurrentRow(account.id, row)) {
      logger.info('telegram', 'stale-login-completion-ignored', { accountId: account.id, authMode: row.authMode || '' });
      return this.publicState(row);
    }
    if (row.loginCompleted && row.state === 'connected') return this.publicState(row);
    assertOperationActive(activeSignal, 'TELEGRAM_LOGIN_COMPLETION_ABORTED', { accountId: account.id, attemptId: clean(row.attemptId) });
    row.loginCompleted = true;
    row.state = 'connected';
    row.step = '';
    row.connectedAt = new Date().toISOString();
    row.lastError = '';
    authChallenges.clear(account.id);
    if (row.authDeadlineTimer) clearTimeout(row.authDeadlineTimer);
    row.authDeadlineTimer = null;
    const me = user || await executeWithDeadline(() => row.client.getMe(), { timeoutMs: 15_000, code: 'TELEGRAM_GET_ME_TIMEOUT', operation: 'telegram-get-me', platform: 'telegram', accountId: account.id, signal: activeSignal, generation: clean(row.authOperationGeneration || row.attemptId) }).catch(error => { if (activeSignal?.aborted) throw error; return null; });
    assertOperationActive(activeSignal, 'TELEGRAM_LOGIN_COMPLETION_ABORTED', { accountId: account.id, attemptId: clean(row.attemptId) });
    let avatarUrl = '';
    let avatarStatus = 'no-profile-photo';
    if (me) {
      try {
        const buffer = await executeWithDeadline(() => row.client.downloadProfilePhoto(me, { isBig: false }), { timeoutMs: 20_000, code: 'TELEGRAM_ACCOUNT_AVATAR_TIMEOUT', operation: 'telegram-account-avatar', platform: 'telegram', accountId: account.id }).catch(() => null);
        if (Buffer.isBuffer(buffer) && buffer.length) {
          const cached = await avatarService.cacheStandaloneBuffer({
            accountId: account.id,
            assetKey: 'telegram-account-avatar',
            buffer,
            source: 'telegram-account-profile'
          });
          avatarUrl = cached.avatarUrl || '';
          avatarStatus = avatarUrl ? 'ready' : 'avatar-unavailable';
        }
      } catch (error) {
        avatarStatus = 'avatar-unavailable';
        logger.warn('telegram', 'account-avatar-cache-failed', { accountId: account.id, errorCode: error.code || error.message });
      }
    }
    row.user = me ? {
      id: clean(me.id), username: me.username || '', firstName: me.firstName || '',
      lastName: me.lastName || '', phone: me.phone || '', name: telegramDisplayName(me),
      avatarUrl, avatar_url: avatarUrl, avatarStatus
    } : null;
    const session = row.client.session?.save?.() || '';
    assertOperationActive(activeSignal, 'TELEGRAM_LOGIN_COMPLETION_ABORTED', { accountId: account.id, attemptId: clean(row.attemptId) });
    if (session) await this.persistCredentials(account.credentialRef, { ...secret, session, phoneNumber: secret.phoneNumber || row.user?.phone || '' });
    assertOperationActive(activeSignal, 'TELEGRAM_LOGIN_COMPLETION_ABORTED', { accountId: account.id, attemptId: clean(row.attemptId) });
    const { NewMessage } = this.loadSdk();
    this.attachMessageHandler(account, row, NewMessage);
    this.attachTypingHandler(account, row);
    this.emit(account.id, row);
    row.authOperationSignal = null;
    logger.info('telegram', 'connected', { accountId: account.id, userId: row.user?.id || '', authMode: row.authMode || 'session' });
    setImmediate(() => this.recoverMessageEnrichment(account, row).catch(error => logger.warn('telegram', 'enrichment-recovery-start-failed', { accountId: account.id, code: error.code || '', error: error.message })));
    if (row.enrichmentRecoveryTimer) clearInterval(row.enrichmentRecoveryTimer);
    row.enrichmentRecoveryTimer = setInterval(() => {
      if (!this.isCurrentRow(account.id, row) || row.state !== 'connected') return;
      this.recoverMessageEnrichment(account, row, { budgetMs: 15_000, maximumPages: 10 }).catch(error => {
        logger.warn('telegram', 'enrichment-recovery-periodic-failed', { accountId: account.id, code: error.code || '', error: error.message });
      });
    }, Math.max(5_000, Number(process.env.YANCE_TELEGRAM_ENRICHMENT_RETRY_INTERVAL_MS || 30_000)));
    row.enrichmentRecoveryTimer.unref?.();

    setTimeout(() => {
      if (!this.isCurrentRow(account.id, row) || row.state !== 'connected' || row.syncStarted) return;
      row.syncStarted = true;
      this.sync(account).then(result => {
        row.lastSyncAt = result.syncedAt || new Date().toISOString();
        row.lastError = '';
        this.emit(account.id, row);
        eventBus.publish('telegram:history-synced', { accountId: account.id, ...result });
        logger.info('telegram', 'post-login-sync-completed', { accountId: account.id, ...result });
      }).catch(error => {
        row.lastError = `登录成功，但历史同步失败：${error.message || error}`;
        row.historySyncRunning = false;
        row.historySyncLastAt = new Date().toISOString();
        row.historySyncLastError = String(error.message || error);
        row.historySyncLastResult = { failed: true, code: error.code || 'TELEGRAM_HISTORY_SYNC_FAILED', at: row.historySyncLastAt };
        this.emit(account.id, row);
        logger.warn('telegram', 'post-login-sync-failed', { accountId: account.id, errorCode: error.code || error.message });
      }).finally(() => { row.syncStarted = false; });
    }, 100).unref?.();

    return this.publicState(row);
  }

  async waitForQrAuthorization(account, row, timeoutMs = 125000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs && this.isCurrentRow(account.id, row) && row.state === 'waiting-verification') {
      try {
        const authorized = await executeWithDeadline(
          () => row.client.checkAuthorization(),
          {
            timeoutMs: Math.min(5_000, Math.max(process.env.NODE_ENV === 'test' ? 20 : 1_000, timeoutMs - (Date.now() - startedAt))),
            code: 'TELEGRAM_QR_AUTHORIZATION_CHECK_TIMEOUT',
            operation: 'telegram-qr-authorization-check',
            platform: 'telegram',
            accountId: account.id
          }
        );
        if (authorized) {
          const user = await executeWithDeadline(
            () => row.client.getMe(),
            {
              timeoutMs: Math.min(10_000, Math.max(process.env.NODE_ENV === 'test' ? 20 : 1_000, timeoutMs - (Date.now() - startedAt))),
              code: 'TELEGRAM_QR_GET_ME_TIMEOUT',
              operation: 'telegram-qr-get-me',
              platform: 'telegram',
              accountId: account.id
            }
          ).catch(() => null);
          if (user) return user;
        }
      } catch (error) {
        if (['TELEGRAM_QR_AUTHORIZATION_CHECK_TIMEOUT', 'TELEGRAM_QR_GET_ME_TIMEOUT'].includes(error?.code)) {
          logger.warn('telegram', 'qr-poll-call-timeout', { accountId: account.id, code: error.code });
        }
      }
      const remainingMs = timeoutMs - (Date.now() - startedAt);
      if (remainingMs <= 0) break;
      await new Promise(resolve => setTimeout(resolve, Math.min(750, remainingMs)));
    }
    throw Object.assign(new Error('Telegram 二维码等待确认超时，请刷新二维码或使用手机号登录'), { code: 'TELEGRAM_QR_CONFIRM_TIMEOUT' });
  }

  makeRow(account, client, mode, attemptId = '') {
    const row = {
      account, client, authMode: mode, state: 'connecting', step: 'connecting', lastError: '',
      attemptId: clean(attemptId), authOperationSignal: null, authOperationGeneration: clean(attemptId),
      connectedAt: '', user: null, codeDeferred: null, passwordDeferred: null,
      floodWaitSeconds: 0, phoneHint: '', loginCompleted: false, syncStarted: false, lastSyncAt: '',
      historySyncRunning: false, historySyncLastAt: '', historySyncLastError: '', historySyncLastResult: null, authDeadlineTimer: null
    };
    row.sessionFence = createSessionGenerationFence(
      () => this.isCurrentRow(account.id, row),
      { prefix: `telegram:${clean(account.id)}` }
    );
    return row;
  }

  authErrorHandler(account, row) {
    return async error => {
      row.lastError = error?.message || String(error);
      const wait = /FLOOD_WAIT_(\d+)/i.exec(row.lastError);
      if (wait) row.floodWaitSeconds = Number(wait[1]);
      logger.warn('telegram', 'login-error', { accountId: account.id, error: row.lastError, authMode: row.authMode });
      this.emit(account.id, row);
      return row.lastError === 'AUTH_USER_CANCEL';
    };
  }

  async connect(account, options = {}) {
    const attemptId = clean(options.attemptId);
    let credentials;
    try { credentials = this.credentials(account); }
    catch (error) {
      const row = { account, state: 'unconfigured', step: 'release-service', lastError: error.message, authMode: '', attemptId };
      this.sessions.set(account.id, row); this.emit(account.id, row); return this.publicState(row);
    }
    const { appCredentials, secret } = credentials;
    const existing = this.sessions.get(account.id);
    if (existing?.client && ['connecting','waiting-verification','connected'].includes(existing.state)) {
      if (attemptId) existing.attemptId = attemptId;
      return this.publicState(existing);
    }
    if (!clean(secret.session)) {
      const row = { account, state: 'unconfigured', step: 'choose-method', lastError: '', authMode: '', phoneHint: clean(secret.phoneNumber), attemptId };
      this.sessions.set(account.id, row); this.emit(account.id, row); return this.publicState(row);
    }
    const row = this.makeRow(account, this.createClient(account, secret, appCredentials), 'session', attemptId);
    this.sessions.set(account.id, row); this.emit(account.id, row);
    try {
      assertOperationActive(options.signal, 'TELEGRAM_CONNECT_ABORTED', { accountId: account.id, attemptId });
      await executeWithDeadline(() => row.client.connect(), {
        timeoutMs: 30_000, code: 'TELEGRAM_CONNECT_TIMEOUT', operation: 'telegram-connect', platform: 'telegram', accountId: account.id,
        signal: options.signal || null, generation: clean(options.executionGeneration || options.operationGeneration || attemptId)
      });
      assertOperationActive(options.signal, 'TELEGRAM_CONNECT_ABORTED', { accountId: account.id, attemptId });
      if (!this.isCurrentRow(account.id, row) || (attemptId && clean(row.attemptId) !== attemptId)) {
        throw Object.assign(new Error('Telegram connect completion belongs to a stale generation'), { code: 'TELEGRAM_CONNECT_GENERATION_STALE', accountId: account.id, attemptId });
      }
      if (!await executeWithDeadline(() => row.client.checkAuthorization(), {
        timeoutMs: 15_000, code: 'TELEGRAM_AUTHORIZATION_CHECK_TIMEOUT', operation: 'telegram-authorization-check', platform: 'telegram', accountId: account.id,
        signal: options.signal || null, generation: clean(options.executionGeneration || options.operationGeneration || attemptId)
      })) {
        row.state = 'unconfigured'; row.step = 'choose-method'; row.lastError = 'Telegram 会话已失效，请重新登录';
        await this.persistCredentials(account.credentialRef, { ...secret, session: '' });
        this.emit(account.id, row); return this.publicState(row);
      }
      assertOperationActive(options.signal, 'TELEGRAM_CONNECT_ABORTED', { accountId: account.id, attemptId });
      return await this.completeLogin(account, row, secret, null, options);
    } catch (error) {
      if (options.signal?.aborted || error?.code === 'TELEGRAM_CONNECT_GENERATION_STALE') {
        try { await executeWithDeadline(() => row.client?.disconnect?.(), { timeoutMs: 5_000, code: 'TELEGRAM_CONNECT_ABORT_DISCONNECT_TIMEOUT', operation: 'telegram-connect-abort', platform: 'telegram', accountId: account.id }); } catch (_) {}
        throw options.signal?.aborted ? operationAbortError(options.signal, 'TELEGRAM_CONNECT_ABORTED', { accountId: account.id, attemptId }) : error;
      }
      row.state = 'error'; row.step = ''; row.lastError = error?.message || String(error); this.emit(account.id, row);
      logger.error('telegram', 'session-connect-failed', { accountId: account.id, error: row.lastError });
      return this.publicState(row);
    }
  }

  async beginQrLogin(account, options = {}) {
    assertOperationActive(options.signal, 'TELEGRAM_QR_START_ABORTED', { accountId: account.id, attemptId: clean(options.attemptId) });
    const { appCredentials, secret } = this.credentials(account);
    const existing = this.sessions.get(account.id);
    if (existing?.client && existing.authMode === 'qr' && ['connecting', 'waiting-verification'].includes(existing.state)) {
      logger.info('telegram', 'qr-login-reused', { accountId: account.id, state: existing.state, step: existing.step || '' });
      return this.publicState(existing);
    }
    const attemptId = clean(options.attemptId || existing?.attemptId);
    assertOperationActive(options.signal, 'TELEGRAM_QR_START_ABORTED', { accountId: account.id, attemptId });
    await this.disconnect(account.id, false).catch(() => {});
    assertOperationActive(options.signal, 'TELEGRAM_QR_START_ABORTED', { accountId: account.id, attemptId });
    const row = this.makeRow(account, this.createClient(account, { ...secret, session: '' }, appCredentials), 'qr', attemptId);
    row.authOperationSignal = options.signal || null;
    row.authOperationGeneration = clean(options.operationGeneration || attemptId);
    row.state = 'waiting-verification'; row.step = 'qr';
    this.sessions.set(account.id, row); this.emit(account.id, row);
    row.startPromise = (async () => {
      try {
        await executeWithDeadline(() => row.client.connect(), {
          timeoutMs: 30_000, code: 'TELEGRAM_CONNECT_TIMEOUT', operation: 'telegram-qr-connect', platform: 'telegram', accountId: account.id,
          signal: options.signal || null, generation: clean(options.operationGeneration || attemptId)
        });
        const sdkLogin = row.client.signInUserWithQrCode(appCredentials, {
          qrCode: async ({ token, expires }) => {
            const uri = `tg://login?token=${token.toString('base64url')}`;
            const dataUrl = await getQRCodeRenderer().toDataURL(uri, { errorCorrectionLevel: 'M', margin: 2, width: 360 });
            const expiresAtMs = Number(expires) * 1000;
            const ttlMs = Number.isFinite(expiresAtMs)
              ? Math.max(5_000, Math.min(120_000, expiresAtMs - Date.now()))
              : 60_000;
            if (!this.isCurrentRow(account.id, row) || options.signal?.aborted) return;
            const challenge = authChallenges.issue({ accountId: account.id, type: 'telegram-qr', dataUrl, ttlMs });
            row.state = 'waiting-verification'; row.step = 'qr'; row.lastError = '';
            this.emit(account.id, row);
            logger.info('telegram', 'qr-challenge-issued', { accountId: account.id, challengeId: challenge.challengeId, expiresAt: challenge.expiresAt, version: challenge.version });
          },
          password: async hint => {
            authChallenges.clear(account.id);
            row.passwordDeferred = new Deferred(); row.state = 'waiting-verification'; row.step = 'password';
            row.lastError = hint ? `请输入两步验证密码（提示：${hint}）` : '请输入两步验证密码';
            this.emit(account.id, row); return row.passwordDeferred.promise;
          },
          onError: this.authErrorHandler(account, row)
        });
        const user = await Promise.race([sdkLogin, this.waitForQrAuthorization(account, row)]);
        return await this.completeLogin(account, row, secret, user, options);
      } catch (error) {
        if (!this.isCurrentRow(account.id, row)) {
          logger.info('telegram', 'stale-qr-login-finished', { accountId: account.id, error: error?.message || String(error) });
          return this.publicState(row);
        }
        authChallenges.clear(account.id);
        if (error?.message === 'AUTH_USER_CANCEL') return this.publicState(row);
        row.state = 'error'; row.step = ''; row.lastError = error?.message || String(error); this.emit(account.id, row);
        try { await executeWithDeadline(() => row.client?.disconnect?.(), { timeoutMs: 5_000, code: 'TELEGRAM_QR_ABORT_DISCONNECT_TIMEOUT', operation: 'telegram-qr-abort', platform: 'telegram', accountId: account.id }); } catch (_) {}
        logger.error('telegram', 'qr-login-failed', { accountId: account.id, error: row.lastError });
        return this.publicState(row);
      }
    })();
    await this.waitForSettledStep(row, 500);
    return this.publicState(row);
  }

  async beginPhoneLogin(account, phoneNumber, options = {}) {
    assertOperationActive(options.signal, 'TELEGRAM_PHONE_START_ABORTED', { accountId: account.id, attemptId: clean(options.attemptId) });
    const { appCredentials, secret } = this.credentials(account);
    const phone = clean(phoneNumber || secret.phoneNumber);
    if (!phone) throw Object.assign(new Error('请输入 Telegram 手机号'), { code: 'TELEGRAM_PHONE_REQUIRED', status: 400 });
    assertOperationActive(options.signal, 'TELEGRAM_PHONE_START_ABORTED', { accountId: account.id, attemptId: clean(options.attemptId) });
    await this.persistCredentials(account.credentialRef, { ...secret, phoneNumber: phone, session: clean(secret.session) });
    assertOperationActive(options.signal, 'TELEGRAM_PHONE_START_ABORTED', { accountId: account.id, attemptId: clean(options.attemptId) });
    const existing = this.sessions.get(account.id);
    const attemptId = clean(options.attemptId || existing?.attemptId);
    assertOperationActive(options.signal, 'TELEGRAM_PHONE_START_ABORTED', { accountId: account.id, attemptId });
    await this.disconnect(account.id, false).catch(() => {});
    assertOperationActive(options.signal, 'TELEGRAM_PHONE_START_ABORTED', { accountId: account.id, attemptId });
    const row = this.makeRow(account, this.createClient(account, { ...secret, session: '' }, appCredentials), 'phone', attemptId);
    row.authOperationSignal = options.signal || null;
    row.authOperationGeneration = clean(options.operationGeneration || attemptId);
    row.phoneHint = phone.replace(/.(?=.{4})/g, '•');
    this.sessions.set(account.id, row); this.emit(account.id, row);
    const authTimeoutMs = boundedInteger(
      process.env.YANCE_TELEGRAM_AUTH_CHALLENGE_TIMEOUT_MS,
      300_000,
      process.env.NODE_ENV === 'test' ? 25 : 30_000,
      900_000
    );
    const expireAuthChallenge = (error = null) => {
      const expired = error || Object.assign(new Error('Telegram 登录挑战已过期，请重新开始登录'), { code: 'TELEGRAM_AUTH_CHALLENGE_EXPIRED' });
      row.codeDeferred?.reject?.(expired); row.passwordDeferred?.reject?.(expired);
      row.state = 'error'; row.step = ''; row.lastError = expired.message; this.emit(account.id, row);
      executeWithDeadline(() => row.client?.disconnect?.(), {
        timeoutMs: 5_000,
        code: 'TELEGRAM_AUTH_ABORT_DISCONNECT_TIMEOUT',
        operation: 'telegram-auth-abort',
        platform: 'telegram',
        accountId: account.id
      }).catch(() => {});
      return expired;
    };
    row.authDeadlineTimer = setTimeout(() => expireAuthChallenge(), authTimeoutMs);
    row.authDeadlineTimer.unref?.();
    const markWaiting = (step, message) => { row.state = 'waiting-verification'; row.step = step; row.lastError = message || ''; this.emit(account.id, row); };
    row.startPromise = executeWithDeadline(
      () => row.client.start({
        phoneNumber: async () => phone,
        phoneCode: async () => { row.codeDeferred = new Deferred(); markWaiting('code', '验证码已发送，请输入 Telegram 验证码'); return row.codeDeferred.promise; },
        password: async hint => { row.passwordDeferred = new Deferred(); markWaiting('password', hint ? `请输入两步验证密码（提示：${hint}）` : '请输入两步验证密码'); return row.passwordDeferred.promise; },
        onError: this.authErrorHandler(account, row)
      }),
      {
        timeoutMs: authTimeoutMs,
        code: 'TELEGRAM_PHONE_LOGIN_DEADLINE_EXCEEDED',
        message: 'Telegram 登录挑战已过期，请重新开始登录',
        operation: 'telegram-phone-login',
        platform: 'telegram',
        accountId: account.id,
        signal: options.signal || null,
        generation: clean(options.operationGeneration || attemptId),
        onTimeout: error => expireAuthChallenge(error)
      }
    ).then(() => this.completeLogin(account, row, { ...secret, phoneNumber: phone }, null, options))
      .catch(error => {
        if (error?.message === 'AUTH_USER_CANCEL') return this.publicState(row);
        if (row.authDeadlineTimer) clearTimeout(row.authDeadlineTimer);
        row.authDeadlineTimer = null;
        row.state = 'error'; row.step = ''; row.lastError = error?.message || String(error); this.emit(account.id, row);
        logger.error('telegram', 'phone-login-failed', { accountId: account.id, error: row.lastError, code: error?.code || '' }); return this.publicState(row);
      });
    await this.waitForSettledStep(row, 1800);
    return this.publicState(row);
  }

  async cancelLogin(accountId, options = {}) {
    assertOperationActive(options.signal, 'TELEGRAM_LOGIN_CANCEL_ABORTED', { accountId });
    const row = this.sessions.get(accountId);
    if (!row) return { state: 'unconfigured', step: 'choose-method', lastError: '' };
    row.authOperationSignal = options.signal || null;
    row.authOperationGeneration = clean(options.operationGeneration || row.attemptId);
    row.codeDeferred?.reject?.(new Error('AUTH_USER_CANCEL'));
    row.passwordDeferred?.reject?.(new Error('AUTH_USER_CANCEL'));
    row.codeDeferred = null; row.passwordDeferred = null;
    if (row.authDeadlineTimer) clearTimeout(row.authDeadlineTimer); row.authDeadlineTimer = null;
    try {
      await executeWithDeadline(() => row.client?.disconnect?.(), { timeoutMs: 5_000, code: 'TELEGRAM_CANCEL_DISCONNECT_TIMEOUT', operation: 'telegram-cancel-login', platform: 'telegram', accountId, signal: options.signal || null, generation: row.authOperationGeneration });
    } catch (error) {
      if (options.signal?.aborted) throw operationAbortError(options.signal, 'TELEGRAM_LOGIN_CANCEL_ABORTED', { accountId });
    }
    assertOperationActive(options.signal, 'TELEGRAM_LOGIN_CANCEL_ABORTED', { accountId });
    authChallenges.clear(accountId);
    row.state = 'unconfigured'; row.step = 'choose-method'; row.lastError = ''; row.authOperationSignal = null;
    this.emit(accountId, row); return this.publicState(row);
  }

  async waitForSettledStep(row, timeoutMs = 1800) {
    const started = Date.now(); while (Date.now() - started < timeoutMs && row.state === 'connecting') await new Promise(resolve => setTimeout(resolve, 80));
  }

  mediaDescriptor(msg, kind) {
    const file = msg.file || {};
    const mimeType = clean(file.mimeType || msg.document?.mimeType);
    const animatedSticker = kind === 'sticker' && Boolean(msg.sticker?.animated || ['application/x-tgsticker', 'video/webm'].includes(mimeType));
    const stickerFormat = kind !== 'sticker' ? '' : mimeType === 'application/x-tgsticker' ? 'lottie' : mimeType === 'video/webm' ? 'webm' : 'webp';
    const renderable = stickerFormat !== 'lottie' && stickerFormat !== 'webm';
    return {
      kind, mediaType: kind, mimeType,
      filename: clean(file.name || msg.document?.attributes?.find?.(item => item.fileName)?.fileName || `${kind}-${msg.id}`),
      size: Number(file.size || 0), width: Number(file.width || 0), height: Number(file.height || 0),
      duration: Number(file.duration || 0), isAnimated: Boolean(msg.gif || animatedSticker), isAnimatedSticker: animatedSticker,
      stickerFormat, renderable, supportState: renderable ? 'supported' : 'unsupported', downloadStatus: 'pending'
    };
  }

  detectKind(msg) {
    if (msg.sticker) return 'sticker';
    if (msg.gif) return 'gif';
    if (msg.photo) return 'image';
    if (msg.video) return 'video';
    if (msg.voice) return 'voice';
    if (msg.audio) return 'audio';
    if (msg.document) return 'document';
    return msg.media ? 'unknown' : 'text';
  }

  async materializeMessageMedia(account, msg, conversationId, messageIdValue, descriptor, options = {}) {
    if (!msg.media || descriptor.kind === 'unknown') return descriptor.kind === 'unknown' ? [{ ...descriptor, downloadStatus: 'unavailable' }] : [];
    try {
      const buffer = await executeWithDeadline(
        () => msg.downloadMedia?.({}),
        {
          timeoutMs: boundedInteger(options.timeoutMs || process.env.YANCE_TELEGRAM_MEDIA_DOWNLOAD_TIMEOUT_MS, 45_000, 1_000, 300_000),
          code: 'TELEGRAM_MEDIA_DOWNLOAD_TIMEOUT', operation: 'telegram-media-download',
          platform: 'telegram', accountId: account.id, commandId: clean(messageIdValue)
        }
      );
      if (!Buffer.isBuffer(buffer) || !buffer.length) return [{ ...descriptor, downloadStatus: 'unavailable' }];
      return [mediaPipeline.saveBuffer({ accountId: account.id, conversationId, messageId: messageIdValue, buffer, descriptor })];
    } catch (error) {
      logger.warn('telegram', 'media-download-failed', { accountId: account.id, messageId: messageIdValue, error: error.message, code: error.code || '' });
      if (options.throwOnFailure === true) throw error;
      return [{ ...descriptor, downloadStatus: 'failed', downloadError: error.message, retryable: true }];
    }
  }

  enrichmentIdentity(account, chatId, externalId, conversationId) {
    const scopedDedupeKey = `${clean(account.id)}:${clean(chatId)}:${clean(externalId)}`;
    return {
      jobType: 'telegram-message-enrichment', platform: 'telegram', sourceAccountId: account.id,
      conversationId, entityId: clean(externalId), revision: 'v1',
      payload: { chatId: clean(chatId), externalId: clean(externalId), conversationId, scopedDedupeKey }
    };
  }

  enrichmentFingerprint(identity = {}) {
    return crypto.createHash('sha256').update([
      identity.jobType,
      identity.platform,
      identity.sourceAccountId,
      identity.conversationId,
      identity.entityId,
      identity.revision
    ].map(clean).join('\u001f')).digest('hex');
  }

  enrichmentOperationSpec(identity = {}) {
    return {
      operationType: 'history.telegram-message-enrichment',
      scopeKey: [identity.platform, identity.sourceAccountId, identity.conversationId, identity.entityId].map(clean).join(':'),
      objectFingerprint: this.enrichmentFingerprint(identity),
      maxAttempts: 5,
      metadata: {
        accountId: clean(identity.sourceAccountId),
        messageId: clean(identity.entityId)
      }
    };
  }

  canonicalEnrichmentLease(operation = {}) {
    return Object.freeze({
      operationId: clean(operation.operationId),
      generation: Number(operation.generation || 0),
      objectFingerprint: clean(operation.objectFingerprint)
    });
  }

  maybeRecoverEnrichment(authority, operation) {
    const now = Date.now();
    const retryDue = operation?.state === 'RETRY_SCHEDULED'
      && (!operation.nextAttemptAt || Date.parse(operation.nextAttemptAt) <= now);
    const leaseExpired = operation?.state === 'RUNNING'
      && operation.leaseExpiresAt
      && Date.parse(operation.leaseExpiresAt) <= now;
    if (!retryDue && !leaseExpired) return operation;
    currentRuntimeRecoveryAuthority().recoverExecution(operation.operationId, {
      authorityTimestamp: new Date(now).toISOString()
    });
    return authority.read(operation.operationId);
  }

  acquireEnrichment(identity = {}) {
    const authority = currentRuntimeInternalOperationAuthority();
    const created = authority.create(this.enrichmentOperationSpec(identity));
    let operation = this.maybeRecoverEnrichment(authority, created.operation);
    if (operation.state === 'SCHEDULED') {
      operation = authority.start(operation.operationId, { progress: 1 }).operation;
      return { acquired: true, reason: created.created ? 'created' : 'scheduled', operation, job: operation, lease: this.canonicalEnrichmentLease(operation) };
    }
    return {
      acquired: false,
      reason: operation.state === 'SUCCEEDED' ? 'already-succeeded'
        : operation.state === 'RETRY_SCHEDULED' ? 'retry-wait'
          : operation.state === 'RUNNING' ? 'already-running'
            : ['FAILED', 'DEAD_LETTERED'].includes(operation.state) ? 'failed_final'
              : operation.state === 'CANCELLED' ? 'cancelled'
                : clean(operation.state).toLowerCase(),
      operation,
      job: operation,
      lease: null
    };
  }

  heartbeatEnrichment(lease) {
    if (!lease?.operationId) return { updated: false };
    return currentRuntimeInternalOperationAuthority().heartbeat(lease.operationId);
  }

  failEnrichment(lease, error, options = {}) {
    if (!lease?.operationId) return { updated: false };
    const errorCode = clean(error?.code || error?.errorCode || error || 'TELEGRAM_ENRICHMENT_FAILED').toUpperCase();
    return currentRuntimeInternalOperationAuthority().fail(lease.operationId, { errorCode }, {
      retryable: options.retryable !== false,
      retryDelayMs: Math.max(0, Number(options.retryDelayMs || 15_000)),
      generation: lease.generation,
      objectFingerprint: lease.objectFingerprint,
      reasonCode: errorCode
    });
  }

  succeedEnrichment(lease, externalId) {
    if (!lease?.operationId) return { updated: false };
    return currentRuntimeInternalOperationAuthority().succeed(lease.operationId, {
      status: 'enriched',
      messageId: clean(externalId)
    }, {
      generation: lease.generation,
      objectFingerprint: lease.objectFingerprint
    });
  }

  async enrichPersistedMessage(account, row, msg, baseMessage, descriptor, options = {}) {
    const chatId = clean(options.chatId || targetId(baseMessage.chatJid));
    const externalId = clean(baseMessage.externalMessageId || baseMessage.id);
    const identity = this.enrichmentIdentity(account, chatId, externalId, baseMessage.conversationId);
    const acquired = options.acquired || this.acquireEnrichment(identity);
    if (!acquired.acquired) return acquired;
    try {
      const attachments = await this.materializeMessageMedia(account, msg, baseMessage.conversationId, externalId, descriptor, { throwOnFailure: true });
      if (!this.heartbeatEnrichment(acquired.lease).updated) {
        throw Object.assign(new Error('Telegram enrichment lease was lost after media materialization'), { code: 'BACKGROUND_JOB_LEASE_LOST' });
      }
      let displayName = clean(baseMessage.contactName || baseMessage.senderName || account.displayName || 'Telegram 联系人');
      let avatarUrl = clean(baseMessage.avatarUrl);
      if (!baseMessage.fromMe) {
        const senderEntity = typeof msg.getSender === 'function'
          ? await executeWithDeadline(() => msg.getSender(), {
            timeoutMs: 15_000, code: 'TELEGRAM_SENDER_LOOKUP_TIMEOUT', operation: 'telegram-sender-lookup',
            platform: 'telegram', accountId: account.id, commandId: externalId
          }).catch(() => null)
          : null;
        displayName = clean([senderEntity?.firstName, senderEntity?.lastName].filter(Boolean).join(' ') || senderEntity?.username || displayName);
        if (senderEntity && avatarService.needsRefresh(baseMessage.conversationId)) {
          const avatarBuffer = await executeWithDeadline(
            () => row.client.downloadProfilePhoto(senderEntity, { isBig: false }),
            { timeoutMs: 20_000, code: 'TELEGRAM_AVATAR_DOWNLOAD_TIMEOUT', operation: 'telegram-avatar-download', platform: 'telegram', accountId: account.id, commandId: externalId }
          ).catch(() => null);
          if (Buffer.isBuffer(avatarBuffer) && avatarBuffer.length) {
            avatarUrl = await avatarService.bestEffort({ accountId: account.id, conversationId: baseMessage.conversationId, buffer: avatarBuffer, source: 'telegram-profile' });
          }
        }
      }
      if (!this.heartbeatEnrichment(acquired.lease).updated) {
        throw Object.assign(new Error('Telegram enrichment lease was lost before durable message projection'), { code: 'BACKGROUND_JOB_LEASE_LOST' });
      }
      await messageStore.upsert({ ...baseMessage, contactName: displayName, senderName: displayName, avatarUrl, attachments });
      return this.succeedEnrichment(acquired.lease, externalId);
    } catch (error) {
      this.failEnrichment(acquired.lease, error, { retryable: true, retryDelayMs: 15_000 });
      throw error;
    }
  }

  scheduleMessageEnrichment(account, row, msg, baseMessage, descriptor, options = {}) {
    setImmediate(() => this.enrichPersistedMessage(account, row, msg, baseMessage, descriptor, options).catch(error => {
      logger.warn('telegram', 'message-enrichment-deferred', { accountId: account.id, messageId: baseMessage.externalMessageId || baseMessage.id, code: error.code || '', error: error.message });
    }));
  }

  async recoverMessageEnrichment(account, row, options = {}) {
    if (row.enrichmentRecoveryRunning) return { skipped: true, reason: 'already-running' };
    row.enrichmentRecoveryRunning = true;
    const pageSize = Math.max(1, Math.min(500, Number(options.pageSize || 200)));
    const maximumPages = Math.max(1, Math.min(100, Number(options.maximumPages || 20)));
    const budgetMs = Math.max(1000, Number(options.budgetMs || 30_000));
    const startedAt = Date.now();
    let scanned = 0;
    let recovered = 0;
    let orphanJobs = 0;
    let orphanMessages = 0;
    let pages = 0;
    let hasMore = false;
    try {
      // AppRuntime performs Schema 23 recovery before adapters start. The
      // authoritative recovery worklist is the persisted message projection,
      // not a duplicate job payload table.
      let messageCursor = null;
      do {
        const pendingMessages = messageStore.listPendingTelegramEnrichment?.(account.id, {
          limit: pageSize,
          cursor: messageCursor
        }) || { messages: [], hasMore: false, nextCursor: null };
        pages += 1;
        hasMore = pendingMessages.hasMore === true;
        for (const message of pendingMessages.messages || []) {
          if (Date.now() - startedAt >= budgetMs) {
            hasMore = true;
            break;
          }
          scanned += 1;
          const conversationId = clean(message.conversationId || message.sessionKey);
          const chatId = clean(message.chatJid).replace(/^telegram:/i, '')
            || conversationId.split(':').slice(1).join(':');
          const externalId = clean(message.externalMessageId || message.id);
          const scopedDedupeKey = clean(message.dedupeKey) || `${account.id}:${chatId}:${externalId}`;
          if (!chatId || !externalId || !conversationId) {
            orphanMessages += 1;
            continue;
          }
          const identity = this.enrichmentIdentity(account, chatId, externalId, conversationId);
          const acquired = this.acquireEnrichment(identity);
          if (!acquired.acquired) continue;
          try {
            const rows = await executeWithDeadline(
              () => row.client.getMessages(targetId(chatId), { ids: [messageId(externalId)], limit: 1 }),
              { timeoutMs: 20_000, code: 'TELEGRAM_ENRICHMENT_RECOVERY_TIMEOUT', operation: 'telegram-enrichment-recovery', platform: 'telegram', accountId: account.id, commandId: externalId }
            );
            const msg = Array.isArray(rows) ? rows[0] : rows?.[0];
            if (!msg) {
              orphanJobs += 1;
              throw Object.assign(new Error('Telegram enrichment remote message is unavailable'), {
                code: 'TELEGRAM_ENRICHMENT_REMOTE_MESSAGE_MISSING'
              });
            }
            const existing = messageStore.getMessageByDedupeKey?.(scopedDedupeKey) || message;
            await this.enrichPersistedMessage(
              account,
              row,
              msg,
              existing,
              this.mediaDescriptor(msg, this.detectKind(msg)),
              { chatId, acquired }
            );
            recovered += 1;
          } catch (error) {
            try {
              this.failEnrichment(acquired.lease, error, {
                retryable: error?.code !== 'TELEGRAM_ENRICHMENT_JOB_IDENTITY_INCOMPLETE',
                retryDelayMs: 15_000
              });
            } catch (failure) {
              logger.error('telegram', 'message-enrichment-recovery-durable-fail-rejected', {
                accountId: account.id,
                messageId: externalId,
                code: failure.code || '',
                error: failure.message
              });
            }
            logger.warn('telegram', 'message-enrichment-recovery-failed', {
              accountId: account.id,
              messageId: externalId,
              code: error.code || '',
              error: error.message
            });
          }
        }
        messageCursor = pendingMessages.nextCursor;
        if (!hasMore || !messageCursor || Date.now() - startedAt >= budgetMs) break;
      } while (pages < maximumPages);

      const remainingPage = messageStore.listPendingTelegramEnrichment?.(account.id, { limit: 1 }) || { messages: [], hasMore: false };
      const remaining = (remainingPage.messages || []).length + (remainingPage.hasMore ? 1 : 0);
      const metrics = {
        scanned,
        recovered,
        remaining,
        oldestPendingAt: clean(remainingPage.messages?.[0]?.updatedAt || remainingPage.messages?.[0]?.timestamp),
        orphanJobs,
        orphanMessages,
        pages,
        budgetExhausted: hasMore && (pages >= maximumPages || Date.now() - startedAt >= budgetMs)
      };
      eventBus.publish('telegram:enrichment-recovery-progress', { accountId: account.id, ...metrics, at: new Date().toISOString() });
      return metrics;
    } finally {
      row.enrichmentRecoveryRunning = false;
    }
  }

  attachMessageHandler(account, row, NewMessage) {
    if (row.handlerAttached) return;
    const fence = row.sessionFence || createSessionGenerationFence(
      () => this.isCurrentRow(account.id, row),
      { prefix: `telegram:${clean(account.id)}` }
    );
    row.sessionFence = fence;
    row.handlerAttached = true;
    const handler = async event => {
      let batch = null;
      let chatId = '';
      let externalId = '';
      let conversationId = '';
      try {
        if (!fence.isCurrent()) return;
        const msg = event.message;
        if (!msg) return;
        chatId = clean(msg.chatId || msg.peerId?.channelId || msg.peerId?.chatId || msg.peerId?.userId || 'unknown');
        externalId = clean(msg.id || Date.now());
        conversationId = `${account.id}:${chatId}`;
        batch = syncCheckpoint.begin({ platform: 'telegram', accountId: account.id, scopeId: chatId, payload: { source: 'telegram-live' } });
        const claim = syncCheckpoint.claimRemoteMessage({ platform: 'telegram', accountId: account.id, remoteMessageId: externalId, conversationId, messageId: `${account.id}:${chatId}:${externalId}` });
        if (claim.duplicate && messageStore.hasExternalMessage({ accountId: account.id, chatJid: `telegram:${chatId}`, targetId: externalId })) {
          fence.assertCurrent('TELEGRAM_SESSION_GENERATION_STALE', { accountId: account.id });
          syncCheckpoint.commit({ platform: 'telegram', accountId: account.id, scopeId: chatId, batchId: batch.batchId, remoteMessageId: externalId, payload: { duplicate: true, persisted: true } });
          return;
        }
        const kind = this.detectKind(msg);
        const timestamp = telegramTimestamp(msg.date);
        const fromMe = Boolean(msg.out);
        const text = clean(msg.message || (kind === 'text' ? '' : `[${kind}]`));
        const descriptor = this.mediaDescriptor(msg, kind);
        const attachments = msg.media ? [{ ...descriptor, downloadStatus: 'queued', retryable: true }] : [];
        const displayName = clean(account.displayName || 'Telegram 新消息');
        const message = {
          id: externalId, externalMessageId: externalId, dedupeKey: `${account.id}:${chatId}:${externalId}`,
          accountId: account.id, platform: 'telegram', chatJid: `telegram:${chatId}`, conversationId,
          direction: fromMe ? 'outbound' : 'inbound', fromMe, type: kind, text,
          sender: clean(msg.senderId || chatId), senderName: displayName, contactName: displayName,
          timestamp, attachments, quotedMessageId: clean(msg.replyTo?.replyToMsgId || msg.replyToMsgId),
          deliveryStatus: fromMe ? 'sent' : '', source: 'telegram-live', rawMessage: null,
          rawMeta: { groupedId: clean(msg.groupedId), viaBotId: clean(msg.viaBotId), enrichmentState: msg.media || !fromMe ? 'pending' : 'not-required' },
          backgroundJobs: (msg.media || !fromMe)
            ? [{ ...this.enrichmentIdentity(account, chatId, externalId, conversationId), maxAttempts: 5 }]
            : []
        };

        // Message visibility is authoritative and must not wait for media,
        // sender profile or avatar network calls.
        const outcome = await messageStore.upsert(message);
        fence.assertCurrent('TELEGRAM_SESSION_GENERATION_STALE', { accountId: account.id, conversationId, messageId: externalId });
        syncCheckpoint.commit({ platform: 'telegram', accountId: account.id, scopeId: chatId, batchId: batch.batchId, remoteMessageId: externalId, remoteTimestamp: timestamp, payload: { source: 'telegram-live', messagePersisted: true, enrichmentPending: msg.media || !fromMe } });

        if (outcome.inserted && !fromMe) {
          fence.assertCurrent('TELEGRAM_SESSION_GENERATION_STALE', { accountId: account.id, conversationId, messageId: externalId });
          const notificationConversation = outcome.conversation || {};
          const notificationMessage = outcome.message || message;
          notificationPolicy.notify({
            accountId: account.id, platform: 'telegram', conversationId, sessionKey: conversationId,
            title: notificationConversation.title || notificationConversation.contactName || displayName,
            senderName: notificationConversation.title || notificationConversation.contactName || displayName,
            body: notificationMessage.text || text || `[${kind}]`, messagePreview: notificationMessage.text || text || `[${kind}]`,
            messageId: notificationMessage.externalMessageId || notificationMessage.id || externalId,
            mediaType: notificationMessage.type || kind, avatarUrl: notificationConversation.avatarUrl || ''
          });
        }
        if (msg.media || !fromMe) {
          fence.assertCurrent('TELEGRAM_SESSION_GENERATION_STALE', { accountId: account.id, conversationId, messageId: externalId });
          this.scheduleMessageEnrichment(account, row, msg, message, descriptor, { chatId });
        }
      } catch (error) {
        if (!fence.isCurrent() || error?.code === 'TELEGRAM_SESSION_GENERATION_STALE') return;
        if (batch?.batchId && chatId) {
          try { syncCheckpoint.fail({ platform: 'telegram', accountId: account.id, scopeId: chatId, batchId: batch.batchId, error: error.message, payload: { source: 'telegram-live', remoteMessageId: externalId } }); } catch (_) {}
        }
        if (externalId && conversationId) {
          try { syncCheckpoint.releaseRemoteMessage({ platform: 'telegram', accountId: account.id, remoteMessageId: externalId, conversationId }); } catch (_) {}
        }
        logger.error('telegram', 'message-ingest-failed', { accountId: account.id, chatId, messageId: externalId, code: error.code || '', error: error.stack || error.message });
      }
    };
    row.mainMessageHandler = handler;
    row.client.addEventHandler(handler, new NewMessage({}));
  }


  resolveTypingConversationId(accountId, chatId, kind = 'user') {
    const raw = clean(chatId);
    const candidates = new Set([raw]);
    if (kind === 'chat') candidates.add(`-${raw}`);
    if (kind === 'channel') candidates.add(`-100${raw}`);
    const conversations = messageStore.listConversations().filter(item => item.platform === 'telegram' && item.accountId === accountId);
    const found = conversations.find(item => {
      const values = [item.id, item.sessionKey, item.chatJid, item.externalId]
        .map(value => clean(value).replace(/^telegram:/i, ''));
      return values.some(value => [...candidates].some(candidate => value === candidate || value.endsWith(`:${candidate}`)));
    });
    return found?.id || `${accountId}:${kind === 'chat' ? `-${raw}` : kind === 'channel' ? `-100${raw}` : raw}`;
  }

  attachTypingHandler(account, row) {
    if (row.typingHandlerAttached) return;
    row.typingHandlerAttached = true;
    const handler = update => {
      const rows = Array.isArray(update?.updates) ? update.updates : [update];
      for (const item of rows) {
        const terminal = telegramPresenceUpdate(item);
        if (terminal) {
          if (terminal.userId === clean(row.user?.id)) continue;
          const requestedConversationId = this.resolveTypingConversationId(account.id, terminal.userId, 'user');
          const conversation = messageStore.getConversation(requestedConversationId);
          const publishPresence = saved => {
            const conversationId = clean(saved?.id || saved?.sessionKey || saved?.conversationId || requestedConversationId);
            eventBus.publish('conversation:presence', {
              platform: 'telegram',
              accountId: account.id,
              conversationId,
              chatJid: `telegram:${terminal.userId}`,
              participant: terminal.userId,
              state: terminal.state,
              lastSeen: terminal.lastSeen,
              lastSeenPrecision: terminal.lastSeenPrecision || '',
              at: new Date().toISOString(),
              contactId: clean(saved?.contactId),
              title: clean(saved?.title || saved?.contactName),
              senderName: clean(saved?.title || saved?.contactName),
              avatarUrl: clean(saved?.avatarUrl || saved?.avatar_url),
              notificationEligible: true,
              presenceScope: 'direct-contact'
            });
          };
          if (!conversation) { publishPresence(null); continue; }
          messageStore.updateConversationMetadata(conversation.id || conversation.sessionKey || requestedConversationId, {
            online: terminal.state === 'available',
            presence: terminal.state,
            presenceState: terminal.state === 'available' ? 'online' : 'offline',
            presenceUpdatedAt: new Date().toISOString(),
            lastSeenAt: terminal.lastSeen || conversation.lastSeenAt || conversation.last_seen_at || '',
            lastSeenPrecision: terminal.lastSeenPrecision || conversation.lastSeenPrecision || conversation.last_seen_precision || ''
          }).then(publishPresence).catch(error => {
            logger.warn('telegram', 'presence-persist-failed', { accountId: account.id, conversationId: requestedConversationId, errorCode: error.code || 'TELEGRAM_PRESENCE_PERSIST_FAILED', error: error.message });
            publishPresence(conversation);
          });
          continue;
        }
        const typing = telegramTypingUpdate(item);
        if (!typing) continue;
        if (typing.participant && typing.participant === clean(row.user?.id)) continue;
        const conversationId = this.resolveTypingConversationId(account.id, typing.chatId, typing.kind);
        const conversation = messageStore.getConversation(conversationId);
        eventBus.publish('conversation:presence', {
          platform: 'telegram',
          accountId: account.id,
          conversationId: clean(conversation?.id || conversation?.sessionKey || conversationId),
          chatJid: `telegram:${typing.chatId}`,
          participant: typing.participant,
          state: typing.state,
          action: typing.action,
          at: new Date().toISOString(),
          contactId: clean(conversation?.contactId),
          title: clean(conversation?.title || conversation?.contactName),
          senderName: clean(conversation?.title || conversation?.contactName),
          avatarUrl: clean(conversation?.avatarUrl || conversation?.avatar_url),
          notificationEligible: false,
          presenceScope: typing.kind === 'user' ? 'direct-contact-activity' : 'group-activity'
        });
      }
    };
    row.typingHandler = handler;
    // GramJS dispatches raw Api.TypeUpdate objects when no EventBuilder is supplied.
    row.client.addEventHandler(handler);
  }

  async submitCode(accountId, code, options = {}) {
    assertOperationActive(options.signal, 'TELEGRAM_CODE_SUBMIT_ABORTED', { accountId });
    const row = this.sessions.get(accountId); if (!row?.codeDeferred) throw Object.assign(new Error('当前没有等待验证码'), { code: 'TELEGRAM_NOT_WAITING_CODE', status: 409 });
    row.authOperationSignal = options.signal || null;
    row.authOperationGeneration = clean(options.operationGeneration || row.attemptId);
    row.state = 'connecting'; row.step = 'verifying-code'; row.codeDeferred.resolve(clean(code)); row.codeDeferred = null; this.emit(accountId, row);
    await this.waitForSettledStep(row, 2500);
    assertOperationActive(options.signal, 'TELEGRAM_CODE_SUBMIT_ABORTED', { accountId });
    return this.publicState(row);
  }

  async submitPassword(accountId, password, options = {}) {
    assertOperationActive(options.signal, 'TELEGRAM_PASSWORD_SUBMIT_ABORTED', { accountId });
    const row = this.sessions.get(accountId); if (!row?.passwordDeferred) throw Object.assign(new Error('当前没有等待两步验证密码'), { code: 'TELEGRAM_NOT_WAITING_PASSWORD', status: 409 });
    row.authOperationSignal = options.signal || null;
    row.authOperationGeneration = clean(options.operationGeneration || row.attemptId);
    row.state = 'connecting'; row.step = 'verifying-password'; row.passwordDeferred.resolve(String(password || '')); row.passwordDeferred = null; this.emit(accountId, row);
    await this.waitForSettledStep(row, 2500);
    assertOperationActive(options.signal, 'TELEGRAM_PASSWORD_SUBMIT_ABORTED', { accountId });
    return this.publicState(row);
  }

  async disconnect(accountId, logout = false, options = {}) {
    assertOperationActive(options.signal, logout ? 'TELEGRAM_LOGOUT_ABORTED' : 'TELEGRAM_DISCONNECT_ABORTED', { accountId });
    const row = this.sessions.get(accountId);
    authChallenges.clear(accountId);
    if (!row) return { state: 'logged-out', lastError: '', step: '', user: null, connectedAt: '', qrReady: false, qrExpiresAt: '', qrVersion: 0 };
    try {
      row.sessionFence?.invalidate?.(logout ? 'TELEGRAM_LOGOUT' : 'TELEGRAM_DISCONNECT');
      if (row.mainMessageHandler && typeof row.client?.removeEventHandler === 'function') {
        row.client.removeEventHandler(row.mainMessageHandler);
        row.mainMessageHandler = null;
        row.handlerAttached = false;
      }
      if (row.typingHandler && typeof row.client?.removeEventHandler === 'function') {
        row.client.removeEventHandler(row.typingHandler);
        row.typingHandler = null;
        row.typingHandlerAttached = false;
      }
      if (row.authDeadlineTimer) clearTimeout(row.authDeadlineTimer); row.authDeadlineTimer = null;
      if (row.enrichmentRecoveryTimer) clearInterval(row.enrichmentRecoveryTimer); row.enrichmentRecoveryTimer = null;
      if (logout && row.client?.invoke) { const { Api } = this.loadSdk(); await executeWithDeadline(() => row.client.invoke(new Api.auth.LogOut()), { timeoutMs: 15_000, code: 'TELEGRAM_LOGOUT_TIMEOUT', operation: 'telegram-logout', platform: 'telegram', accountId, signal: options.signal || null, generation: clean(options.executionGeneration || options.operationGeneration) }); }
      await executeWithDeadline(() => row.client?.disconnect?.(), { timeoutMs: 10_000, code: 'TELEGRAM_DISCONNECT_TIMEOUT', operation: 'telegram-disconnect', platform: 'telegram', accountId, signal: options.signal || null, generation: clean(options.executionGeneration || options.operationGeneration) });
    }
    catch (error) {
      logger.warn('telegram', 'disconnect-error', { accountId, error: error.message });
      if (options.signal?.aborted) {
        row.state = 'error'; row.step = ''; row.lastError = 'Telegram disconnect outcome is unknown after deadline';
        row.attemptId = `expired:${clean(row.attemptId)}:${Date.now()}`; this.emit(accountId, row);
        throw operationAbortError(options.signal, logout ? 'TELEGRAM_LOGOUT_ABORTED' : 'TELEGRAM_DISCONNECT_ABORTED', { accountId });
      }
    }
    assertOperationActive(options.signal, logout ? 'TELEGRAM_LOGOUT_ABORTED' : 'TELEGRAM_DISCONNECT_ABORTED', { accountId });
    row.state = logout ? 'logged-out' : 'paused'; row.step = ''; row.connectedAt = ''; this.emit(accountId, row);
    if (logout) await this.persistCredentials(row.account.credentialRef, { ...(securityGuard.credentials.get(row.account.credentialRef) || {}), session: '' });
    assertOperationActive(options.signal, logout ? 'TELEGRAM_LOGOUT_ABORTED' : 'TELEGRAM_DISCONNECT_ABORTED', { accountId });
    return this.publicState(row);
  }

  async sync(account, options = {}) {
    assertOperationActive(options.signal, 'TELEGRAM_SYNC_ABORTED', { accountId: account.id });
    const row = this.connected(account.id);
    const maximumDialogs = boundedInteger(process.env.YANCE_TELEGRAM_SYNC_DIALOGS, 200, 1, 1000);
    const maximumMessages = boundedInteger(process.env.YANCE_TELEGRAM_SYNC_MESSAGES_PER_DIALOG, 200, 1, 2000);
    const maximumBackfillPages = boundedInteger(process.env.YANCE_TELEGRAM_HISTORY_PAGES_PER_DIALOG, 3, 1, 50);
    const maximumCatchupPages = boundedInteger(process.env.YANCE_TELEGRAM_CATCHUP_PAGES_PER_DIALOG, 3, 1, 50);
    row.historySyncRunning = true;
    row.historySyncLastError = '';
    let dialogs;
    try {
      dialogs = await executeWithDeadline(
        () => row.client.getDialogs({ limit: maximumDialogs }),
        { timeoutMs: 45_000, code: 'TELEGRAM_HISTORY_DIALOGS_TIMEOUT', operation: 'telegram-history-dialogs', platform: 'telegram', accountId: account.id,
          signal: options.signal || null, generation: clean(options.executionGeneration || options.operationGeneration) }
      );
    } catch (error) {
      row.historySyncRunning = false;
      row.historySyncLastAt = new Date().toISOString();
      row.historySyncLastError = String(error.message || error);
      row.historySyncLastResult = { failed: true, code: error.code || 'TELEGRAM_HISTORY_SYNC_FAILED', at: row.historySyncLastAt };
      this.emit(account.id, row);
      throw error;
    }
    let conversations = 0; let messagesScanned = 0; let messagesInserted = 0; let avatars = 0;
    let failedConversations = 0; let failedMessages = 0; let historyPages = 0; let historyCompletedConversations = 0;

    for (const dialog of dialogs || []) {
      assertOperationActive(options.signal, 'TELEGRAM_SYNC_ABORTED', { accountId: account.id });
      const entity = dialog.entity || dialog.inputEntity || null;
      const chatId = clean(dialog.id || entity?.id || dialog.message?.chatId);
      if (!chatId) continue;
      const conversationId = `${account.id}:${chatId}`;
      const title = clean(dialog.title || [entity?.firstName, entity?.lastName].filter(Boolean).join(' ') || entity?.username || `Telegram ${chatId}`);
      const previousCheckpoint = syncCheckpoint.read('telegram', account.id, chatId);
      const previousPayload = previousCheckpoint?.payload && typeof previousCheckpoint.payload === 'object' ? previousCheckpoint.payload : {};
      let backfillOffsetId = clean(previousPayload.backfillOffsetId || (previousPayload.historyComplete === false ? previousCheckpoint?.cursor : ''));
      let historyComplete = previousPayload.historyComplete === true;
      const committedRemoteMessageId = clean(previousCheckpoint?.remoteMessageId);
      const committedRemoteTimestamp = clean(previousCheckpoint?.remoteTimestamp);
      let catchupBaseRemoteMessageId = clean(previousPayload.catchupBaseRemoteMessageId || committedRemoteMessageId);
      let catchupOffsetId = clean(previousPayload.catchupOffsetId);
      let catchupTargetRemoteMessageId = clean(previousPayload.catchupTargetRemoteMessageId);
      let catchupTargetRemoteTimestamp = clean(previousPayload.catchupTargetRemoteTimestamp);
      let catchupInProgress = previousPayload.catchupInProgress === true
        && Boolean(catchupBaseRemoteMessageId && catchupOffsetId && catchupTargetRemoteMessageId);
      if (!catchupInProgress) {
        catchupBaseRemoteMessageId = committedRemoteMessageId;
        catchupOffsetId = '';
        catchupTargetRemoteMessageId = '';
        catchupTargetRemoteTimestamp = '';
      }
      const batch = syncCheckpoint.begin({
        platform: 'telegram', accountId: account.id, scopeId: chatId, cursor: backfillOffsetId,
        payload: {
          source: 'telegram-history-sync', schemaVersion: 3,
          previousBackfillOffsetId: backfillOffsetId,
          previousHistoryComplete: historyComplete,
          previousCatchupInProgress: catchupInProgress,
          previousCatchupOffsetId: catchupOffsetId,
          previousCatchupTargetRemoteMessageId: catchupTargetRemoteMessageId,
          previousCatchupBaseRemoteMessageId: catchupBaseRemoteMessageId
        }
      });
      let latestRemoteMessageId = committedRemoteMessageId;
      let latestRemoteTimestamp = committedRemoteTimestamp;
      let dialogPages = 0;
      let dialogMessagesScanned = 0;
      try {
        const processPage = async (history, { minimumExclusiveId = '' } = {}) => {
          const rawMessages = Array.from(history || []);
          const messages = minimumExclusiveId
            ? rawMessages.filter(message => compareMessageIds(clean(message?.id), minimumExclusiveId) > 0)
            : rawMessages;
          const ordered = messages.sort((left, right) => Date.parse(telegramTimestamp(left?.date)) - Date.parse(telegramTimestamp(right?.date)));
          const current = messageStore.getConversation(conversationId);
          const unreadBefore = Number(current?.unreadCount ?? current?.unread ?? 0);
          let oldestRemoteId = '';
          let newestRemoteId = '';
          let newestRemoteTimestamp = '';
          for (const msg of ordered) {
            assertOperationActive(options.signal, 'TELEGRAM_SYNC_ABORTED', { accountId: account.id, conversationId });
            const externalId = clean(msg?.id);
            if (!externalId) continue;
            if (!oldestRemoteId || compareMessageIds(externalId, oldestRemoteId) < 0) oldestRemoteId = externalId;
            const timestamp = telegramTimestamp(msg.date);
            if (!newestRemoteId || compareMessageIds(externalId, newestRemoteId) > 0) {
              newestRemoteId = externalId;
              newestRemoteTimestamp = timestamp;
            }
            messagesScanned += 1;
            dialogMessagesScanned += 1;
            if (messageStore.hasExternalMessage({ accountId: account.id, chatJid: `telegram:${chatId}`, targetId: externalId })) continue;
            try {
              const kind = this.detectKind(msg);
              const descriptor = this.mediaDescriptor(msg, kind);
              const fromMe = Boolean(msg.out);
              const baseMessage = {
                id: externalId, externalMessageId: externalId, dedupeKey: `${account.id}:${chatId}:${externalId}`,
                accountId: account.id, platform: 'telegram', chatJid: `telegram:${chatId}`, conversationId,
                direction: fromMe ? 'outbound' : 'inbound', fromMe, type: kind,
                text: clean(msg.message || (kind === 'text' ? '' : `[${kind}]`)),
                sender: clean(msg.senderId || chatId), senderName: title, contactName: title,
                timestamp, attachments: msg.media ? [{ ...descriptor, downloadStatus: 'queued', retryable: true }] : [],
                quotedMessageId: clean(msg.replyTo?.replyToMsgId || msg.replyToMsgId),
                deliveryStatus: fromMe ? 'sent' : '', source: 'telegram-history-sync', rawMessage: null,
                rawMeta: { groupedId: clean(msg.groupedId), viaBotId: clean(msg.viaBotId), enrichmentState: msg.media || !fromMe ? 'pending' : 'not-required' },
                backgroundJobs: (msg.media || !fromMe)
                  ? [{ ...this.enrichmentIdentity(account, chatId, externalId, conversationId), maxAttempts: 5 }]
                  : []
              };
              assertOperationActive(options.signal, 'TELEGRAM_SYNC_ABORTED', { accountId: account.id, conversationId, messageId: externalId });
              const outcome = await messageStore.upsert(baseMessage);
              assertOperationActive(options.signal, 'TELEGRAM_SYNC_ABORTED', { accountId: account.id, conversationId, messageId: externalId });
              if (outcome.inserted) messagesInserted += 1;
              if (msg.media || !fromMe) this.scheduleMessageEnrichment(account, row, msg, baseMessage, descriptor, { chatId });
            } catch (error) {
              failedMessages += 1;
              logger.warn('telegram', 'history-sync-message-failed', { accountId: account.id, chatId, messageId: externalId, error: error.message, code: error.code || '' });
              // Do not commit a page cursor past a locally failed message. A
              // crash/retry may replay already persisted rows, which are
              // idempotently suppressed by account/chat/message identity.
              throw Object.assign(error, { failedRemoteMessageId: externalId });
            }
          }
          return {
            rawCount: rawMessages.length,
            count: messages.length,
            oldestRemoteId,
            newestRemoteId,
            newestRemoteTimestamp,
            boundaryObserved: Boolean(minimumExclusiveId && rawMessages.some(message => compareMessageIds(clean(message?.id), minimumExclusiveId) <= 0)),
            unreadBefore
          };
        };

        const historyTarget = entity || dialog.inputEntity || targetId(chatId);
        if (!committedRemoteMessageId) {
          const latestHistory = await executeWithDeadline(
            () => row.client.getMessages(historyTarget, { limit: maximumMessages }),
            { timeoutMs: 60_000, code: 'TELEGRAM_HISTORY_MESSAGES_TIMEOUT', operation: 'telegram-history-messages', platform: 'telegram', accountId: account.id, commandId: `${chatId}:latest`, signal: options.signal || null, generation: clean(options.executionGeneration || options.operationGeneration) }
          );
          const latestPage = await processPage(latestHistory);
          historyPages += 1;
          dialogPages += 1;
          latestRemoteMessageId = latestPage.newestRemoteId;
          latestRemoteTimestamp = latestPage.newestRemoteTimestamp;
          if (!previousCheckpoint || !backfillOffsetId) {
            historyComplete = latestPage.rawCount < maximumMessages || !latestPage.oldestRemoteId;
            backfillOffsetId = historyComplete ? '' : latestPage.oldestRemoteId;
          }
        } else {
          let catchupPages = 0;
          let catchupComplete = false;
          if (!catchupInProgress) {
            const latestHistory = await executeWithDeadline(
              () => row.client.getMessages(historyTarget, { limit: maximumMessages, minId: messageId(committedRemoteMessageId) }),
              { timeoutMs: 60_000, code: 'TELEGRAM_HISTORY_MESSAGES_TIMEOUT', operation: 'telegram-history-catchup', platform: 'telegram', accountId: account.id, commandId: `${chatId}:catchup:${committedRemoteMessageId}`, signal: options.signal || null, generation: clean(options.executionGeneration || options.operationGeneration) }
            );
            const page = await processPage(latestHistory, { minimumExclusiveId: committedRemoteMessageId });
            historyPages += 1;
            dialogPages += 1;
            catchupPages += 1;
            if (!page.newestRemoteId) {
              catchupComplete = true;
            } else {
              catchupTargetRemoteMessageId = page.newestRemoteId;
              catchupTargetRemoteTimestamp = page.newestRemoteTimestamp;
              catchupBaseRemoteMessageId = committedRemoteMessageId;
              catchupOffsetId = page.oldestRemoteId;
              catchupComplete = page.rawCount < maximumMessages || page.boundaryObserved;
              catchupInProgress = !catchupComplete;
            }
          }
          while (catchupInProgress && catchupPages < maximumCatchupPages) {
            const previousOffset = catchupOffsetId;
            const history = await executeWithDeadline(
              () => row.client.getMessages(historyTarget, {
                limit: maximumMessages,
                offsetId: messageId(catchupOffsetId),
                minId: messageId(catchupBaseRemoteMessageId)
              }),
              { timeoutMs: 60_000, code: 'TELEGRAM_HISTORY_MESSAGES_TIMEOUT', operation: 'telegram-history-catchup-page', platform: 'telegram', accountId: account.id, commandId: `${chatId}:catchup:${catchupOffsetId}`, signal: options.signal || null, generation: clean(options.executionGeneration || options.operationGeneration) }
            );
            const page = await processPage(history, { minimumExclusiveId: catchupBaseRemoteMessageId });
            historyPages += 1;
            dialogPages += 1;
            catchupPages += 1;
            if (!page.oldestRemoteId || page.rawCount < maximumMessages || page.boundaryObserved) {
              catchupComplete = true;
              catchupInProgress = false;
              catchupOffsetId = '';
              break;
            }
            if (compareMessageIds(page.oldestRemoteId, previousOffset) >= 0) {
              throw Object.assign(new Error('Telegram catch-up cursor moved in the wrong direction'), {
                code: 'TELEGRAM_CATCHUP_CURSOR_NON_MONOTONIC', previousCursor: previousOffset, nextCursor: page.oldestRemoteId
              });
            }
            catchupOffsetId = page.oldestRemoteId;
          }
          if (catchupComplete) {
            latestRemoteMessageId = catchupTargetRemoteMessageId || committedRemoteMessageId;
            latestRemoteTimestamp = catchupTargetRemoteTimestamp || committedRemoteTimestamp;
            catchupInProgress = false;
            catchupOffsetId = '';
            catchupTargetRemoteMessageId = '';
            catchupTargetRemoteTimestamp = '';
            catchupBaseRemoteMessageId = latestRemoteMessageId;
          }
        }

        let previousOffset = '';
        for (let page = 0; !catchupInProgress && !historyComplete && backfillOffsetId && page < maximumBackfillPages; page += 1) {
          if (backfillOffsetId === previousOffset) {
            throw Object.assign(new Error('Telegram history cursor did not advance'), {
              code: 'TELEGRAM_HISTORY_CURSOR_STALLED', cursor: backfillOffsetId
            });
          }
          previousOffset = backfillOffsetId;
          const olderHistory = await executeWithDeadline(
            () => row.client.getMessages(historyTarget, { limit: maximumMessages, offsetId: messageId(backfillOffsetId) }),
            { timeoutMs: 60_000, code: 'TELEGRAM_HISTORY_MESSAGES_TIMEOUT', operation: 'telegram-history-messages-page', platform: 'telegram', accountId: account.id, commandId: `${chatId}:${backfillOffsetId}`, signal: options.signal || null, generation: clean(options.executionGeneration || options.operationGeneration) }
          );
          const olderPage = await processPage(olderHistory);
          historyPages += 1;
          dialogPages += 1;
          if (olderPage.count < maximumMessages || !olderPage.oldestRemoteId) {
            historyComplete = true;
            backfillOffsetId = '';
            break;
          }
          if (compareMessageIds(olderPage.oldestRemoteId, previousOffset) >= 0) {
            throw Object.assign(new Error('Telegram history cursor moved in the wrong direction'), {
              code: 'TELEGRAM_HISTORY_CURSOR_NON_MONOTONIC', previousCursor: previousOffset, nextCursor: olderPage.oldestRemoteId
            });
          }
          backfillOffsetId = olderPage.oldestRemoteId;
        }

        assertOperationActive(options.signal, 'TELEGRAM_SYNC_ABORTED', { accountId: account.id, conversationId });
        const current = messageStore.getConversation(conversationId);
        const unreadBefore = Number(current?.unreadCount ?? current?.unread ?? 0);
        const serverUnread = Number(dialog.unreadCount ?? dialog.unread_count);
        await messageStore.updateConversationMetadata(conversationId, {
          accountId: account.id, platform: 'telegram', chatJid: `telegram:${chatId}`, title, contactName: title,
          unreadCount: Number.isFinite(serverUnread) ? Math.max(0, serverUnread) : Math.max(0, unreadBefore),
          historySyncAt: new Date().toISOString(), lastSyncAt: new Date().toISOString()
        });
        assertOperationActive(options.signal, 'TELEGRAM_SYNC_ABORTED', { accountId: account.id, conversationId });
        syncCheckpoint.commit({
          platform: 'telegram', accountId: account.id, scopeId: chatId, batchId: batch.batchId,
          cursor: backfillOffsetId, remoteMessageId: latestRemoteMessageId, remoteTimestamp: latestRemoteTimestamp,
          payload: {
            source: 'telegram-history-sync', schemaVersion: 3,
            messagesScanned: dialogMessagesScanned, dialogPages, fullyPersisted: true,
            backfillOffsetId, historyComplete,
            catchupInProgress,
            catchupBaseRemoteMessageId,
            catchupOffsetId,
            catchupTargetRemoteMessageId,
            catchupTargetRemoteTimestamp
          }
        });
        if (historyComplete) historyCompletedConversations += 1;
        conversations += 1;
      } catch (error) {
        if (options.signal?.aborted) {
          row.historySyncRunning = false;
          row.historySyncLastAt = new Date().toISOString();
          row.historySyncLastError = clean(options.signal.reason?.message, 'Telegram sync aborted');
          row.historySyncLastResult = { failed: true, code: clean(options.signal.reason?.code, 'TELEGRAM_SYNC_ABORTED'), at: row.historySyncLastAt };
          this.emit(account.id, row);
          throw operationAbortError(options.signal, 'TELEGRAM_SYNC_ABORTED', { accountId: account.id, conversationId });
        }
        failedConversations += 1;
        syncCheckpoint.fail({
          platform: 'telegram', accountId: account.id, scopeId: chatId, batchId: batch.batchId, error: error.message,
          payload: {
            source: 'telegram-history-sync', schemaVersion: 3,
            failedRemoteMessageId: clean(error.failedRemoteMessageId),
            backfillOffsetId, historyComplete, dialogPages, code: clean(error.code),
            catchupInProgress,
            catchupBaseRemoteMessageId,
            catchupOffsetId,
            catchupTargetRemoteMessageId,
            catchupTargetRemoteTimestamp
          }
        });
        logger.warn('telegram', 'history-sync-conversation-failed', { accountId: account.id, chatId, error: error.message, code: error.code || '' });
      }
    }
    assertOperationActive(options.signal, 'TELEGRAM_SYNC_ABORTED', { accountId: account.id });
    const syncedAt = new Date().toISOString();
    const result = {
      conversations, messagesScanned, messagesInserted, avatars, failedConversations, failedMessages,
      historyPages, historyCompletedConversations, syncedAt
    };
    row.lastSyncAt = syncedAt;
    row.historySyncRunning = false;
    row.historySyncLastAt = syncedAt;
    row.historySyncLastError = failedConversations || failedMessages ? `${failedConversations} 个会话、${failedMessages} 条消息未完成同步` : '';
    row.historySyncLastResult = result;
    this.emit(account.id, row);
    return result;
  }


  async listNativeExpressions(accountId, kind = 'sticker', options = {}) {
    const row = this.connected(accountId);
    const { Api } = this.loadSdk();
    const normalizedKind = clean(kind).toLowerCase() === 'gif' ? 'gif' : 'sticker';
    const limit = boundedInteger(options.limit, 24, 1, 48);
    const timeoutMs = boundedInteger(options.timeoutMs, 15000, 3000, 45000);
    const request = normalizedKind === 'gif'
      ? new Api.messages.GetSavedGifs({ hash: BigInt(0) })
      : new Api.messages.GetRecentStickers({ hash: BigInt(0), attached: false });
    const result = await row.client.invoke(request);
    const documents = normalizedKind === 'gif'
      ? (Array.isArray(result?.gifs) ? result.gifs : [])
      : (Array.isArray(result?.stickers) ? result.stickers : []);
    const items = [];
    for (const document of documents.slice(0, limit)) {
      const attributes = Array.isArray(document?.attributes) ? document.attributes : [];
      const stickerAttribute = attributes.find(item => /DocumentAttributeSticker/i.test(clean(item?.className || item?.constructor?.name || item?._)));
      const filenameAttribute = attributes.find(item => /DocumentAttributeFilename/i.test(clean(item?.className || item?.constructor?.name || item?._)));
      const animated = attributes.some(item => /DocumentAttributeAnimated|DocumentAttributeVideo/i.test(clean(item?.className || item?.constructor?.name || item?._)));
      const mimeType = clean(document?.mimeType, normalizedKind === 'gif' ? 'video/mp4' : 'image/webp');
      const documentId = clean(document?.id, `native-${items.length + 1}`);
      let buffer = null;
      try {
        const media = new Api.MessageMediaDocument({ document });
        buffer = await Promise.race([
          row.client.downloadMedia(media, {}),
          new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error('Telegram 素材下载超时'), { code: 'TELEGRAM_EXPRESSION_TIMEOUT' })), timeoutMs))
        ]);
      } catch (error) {
        logger.warn('telegram', 'native-expression-download-failed', { accountId, kind: normalizedKind, documentId, error: error.code || error.message || String(error) });
      }
      if (!Buffer.isBuffer(buffer) || !buffer.length) continue;
      const attachment = mediaPipeline.saveBuffer({
        accountId,
        conversationId: `telegram-native-${normalizedKind}`,
        messageId: `telegram-${normalizedKind}-${documentId}`,
        buffer,
        descriptor: {
          kind: normalizedKind,
          mimeType,
          filename: clean(filenameAttribute?.fileName, `${normalizedKind}-${documentId}`),
          source: 'telegram-native-library',
          isAnimated: animated,
          isAnimatedSticker: normalizedKind === 'sticker' && animated
        }
      });
      const sendRef = expressionReferences.create({
        accountId,
        kind: normalizedKind,
        document,
        metadata: { documentId, mimeType, animated, label: clean(stickerAttribute?.alt) }
      });
      const isTgs = mimeType === 'application/x-tgsticker' || /[.]tgs$/i.test(clean(filenameAttribute?.fileName));
      const isWebm = mimeType === 'video/webm' || /[.]webm$/i.test(clean(filenameAttribute?.fileName));
      items.push({
        id: `telegram-native:${normalizedKind}:${documentId}`,
        source: 'telegram-native-library',
        kind: normalizedKind,
        label: clean(stickerAttribute?.alt, normalizedKind === 'gif' ? '已保存 GIF' : '最近贴纸'),
        name: clean(filenameAttribute?.fileName, `${normalizedKind}-${documentId}`),
        keywords: `${clean(stickerAttribute?.alt)} Telegram ${normalizedKind}`,
        url: attachment.mediaUrl,
        mimeType,
        platform: 'telegram',
        accountId,
        supportedSend: true,
        supportReason: '',
        animated: attachment.isAnimated === true || animated,
        animationFormat: isTgs ? 'tgs' : isWebm ? 'webm' : animated ? 'animated' : '',
        previewMode: isTgs ? 'format-icon' : 'media',
        sendReference: sendRef.reference,
        sendReferenceExpiresAt: sendRef.expiresAt
      });
    }
    return { items, kind: normalizedKind, accountId, source: 'telegram-native-library' };
  }

  async sendNativeExpression(accountId, chatId, reference, options = {}) {
    const row = this.connected(accountId);
    const resolved = expressionReferences.resolve(reference, { accountId, kind: options.kind });
    const kind = resolved.kind;
    const replyTo = clean(options.quoted?.key?.id || options.quoted?.quotedMessageId);
    const caption = kind === 'gif' ? clean(options.caption) : '';
    const detachAbort = this.bindEgressAbort(accountId, row, options);
    let result;
    try {
      result = await row.client.sendFile(targetId(chatId), {
        file: resolved.document,
        caption,
        ...(replyTo ? { replyTo: messageId(replyTo) } : {}),
        forceDocument: false,
        supportsStreaming: kind === 'gif' || resolved.metadata?.mimeType === 'video/webm'
      });
      this.assertEgressActive(accountId, row, options, true);
    } finally {
      detachAbort();
    }
    const externalId = clean(result?.id);
    const localMessage = options.localMessageId ? {
      id: options.localMessageId,
      dedupeKey: options.localMessageId,
      externalMessageId: externalId || options.localMessageId,
      accountId,
      platform: 'telegram',
      chatJid: `telegram:${targetId(chatId)}`,
      conversationId: options.sessionKey || `${accountId}:${targetId(chatId)}`,
      direction: 'outbound',
      fromMe: true,
      type: kind,
      text: caption,
      timestamp: new Date().toISOString(),
      deliveryStatus: 'sent',
      quotedMessageId: replyTo,
      payload: { source: 'telegram-native-library', animationFormat: clean(resolved.metadata?.mimeType), nativeExpression: true }
    } : null;
    let localPersistencePending = false;
    let localPersistenceErrorCode = '';
    if (localMessage) {
      try { await messageStore.upsert(localMessage); }
      catch (error) { localPersistencePending = true; localPersistenceErrorCode = clean(error.code || error.message || 'TELEGRAM_NATIVE_LOCAL_PERSISTENCE_FAILED'); }
    }
    return {
      messageId: externalId,
      kind,
      captionApplied: Boolean(caption),
      composerTextConsumed: kind === 'gif' && Boolean(caption),
      localPersistencePending,
      localPersistenceErrorCode,
      localPersistenceRepair: localPersistencePending ? { kind: 'message-upsert', message: localMessage } : null,
      raw: result
    };
  }

  async sendText(accountId, chatId, text, options = {}) {
    const row = this.connected(accountId);
    const replyTo = clean(options.quoted?.key?.id || options.quoted?.quotedMessageId);
    const detachAbort = this.bindEgressAbort(accountId, row, options);
    let result;
    try {
      result = await row.client.sendMessage(targetId(chatId), { message: String(text || ''), ...(replyTo ? { replyTo: messageId(replyTo) } : {}) });
      this.assertEgressActive(accountId, row, options, true);
    } finally {
      detachAbort();
    }
    const externalId = clean(result?.id);
    const localMessage = options.localMessageId ? {
      id: options.localMessageId, dedupeKey: options.localMessageId, externalMessageId: externalId || options.localMessageId,
      accountId, platform: 'telegram', chatJid: `telegram:${targetId(chatId)}`, conversationId: options.sessionKey || `${accountId}:${targetId(chatId)}`,
      direction: 'outbound', fromMe: true, type: 'text', text: String(text || ''), timestamp: new Date().toISOString(), deliveryStatus: 'sent', quotedMessageId: replyTo
    } : null;
    let localPersistencePending = false;
    let localPersistenceErrorCode = '';
    if (localMessage) {
      try { await messageStore.upsert(localMessage); }
      catch (error) {
        localPersistencePending = true;
        localPersistenceErrorCode = clean(error.code || error.message || 'TELEGRAM_TEXT_LOCAL_PERSISTENCE_FAILED');
      }
    }
    return {
      messageId: externalId, raw: result, localPersistencePending, localPersistenceErrorCode,
      localPersistenceRepair: localPersistencePending ? { kind: 'message-upsert', message: localMessage } : null
    };
  }

  async sendMedia(accountId, chatId, input = {}) {
    const row = this.connected(accountId);
    const kind = clean(input.kind, 'document').toLowerCase();
    const replyTo = clean(input.quoted?.key?.id || input.quoted?.quotedMessageId);
    const filePath = path.resolve(input.filePath || '');
    mediaPipeline.verifyFile(filePath);
    const detachAbort = this.bindEgressAbort(accountId, row, input);
    let result;
    try {
      result = await row.client.sendFile(targetId(chatId), {
        file: filePath, caption: clean(input.caption), ...(replyTo ? { replyTo: messageId(replyTo) } : {}),
        forceDocument: kind === 'document', voiceNote: kind === 'voice', supportsStreaming: kind === 'video' || kind === 'gif'
      });
      this.assertEgressActive(accountId, row, input, true);
    } finally {
      detachAbort();
    }
    const externalId = clean(result?.id);
    let localPersistencePending = false;
    let localPersistenceErrorCode = '';
    let localMessage = null;
    if (input.localMessageId) {
      try {
        const attachment = mediaPipeline.saveFile({
          accountId, conversationId: input.sessionKey || `${accountId}:${targetId(chatId)}`, messageId: input.localMessageId,
          filePath, expectedSha256: input.expectedSha256 || '', descriptor: { kind, mimeType: input.mimeType, filename: input.filename, downloadStatus: 'ready' }
        });
        localMessage = {
          id: input.localMessageId, dedupeKey: input.localMessageId, externalMessageId: externalId || input.localMessageId,
          accountId, platform: 'telegram', chatJid: `telegram:${targetId(chatId)}`, conversationId: input.sessionKey || `${accountId}:${targetId(chatId)}`,
          direction: 'outbound', fromMe: true, type: kind, text: clean(input.caption), timestamp: new Date().toISOString(), deliveryStatus: 'sent', attachments: [attachment], quotedMessageId: replyTo
        };
        await messageStore.upsert(localMessage);
      } catch (error) {
        localPersistencePending = true;
        localPersistenceErrorCode = clean(error.code || error.message || 'TELEGRAM_MEDIA_LOCAL_PERSISTENCE_FAILED');
        localMessage = localMessage || {
          id: input.localMessageId, dedupeKey: input.localMessageId, externalMessageId: externalId || input.localMessageId,
          accountId, platform: 'telegram', chatJid: `telegram:${targetId(chatId)}`, conversationId: input.sessionKey || `${accountId}:${targetId(chatId)}`,
          direction: 'outbound', fromMe: true, type: kind, text: clean(input.caption), timestamp: new Date().toISOString(), deliveryStatus: 'sent',
          attachments: [{ kind, mimeType: input.mimeType, filename: input.filename, sourceFile: filePath, expectedSha256: input.expectedSha256 || '', downloadStatus: 'local-persistence-pending' }], quotedMessageId: replyTo
        };
      }
    }
    return {
      messageId: externalId, raw: result, localPersistencePending, localPersistenceErrorCode,
      localPersistenceRepair: localPersistencePending ? {
        kind: 'outbound-media-upsert', message: localMessage,
        sourceFile: filePath, expectedSha256: input.expectedSha256 || '', descriptor: { kind, mimeType: input.mimeType, filename: input.filename }
      } : null
    };
  }


  async sendReaction(accountId, chatId, targetMessageId, emoji, options = {}) {
    const row = this.connected(accountId); const { Api } = this.loadSdk();
    const detachAbort = this.bindEgressAbort(accountId, row, options);
    let result;
    try {
      const peer = await row.client.getInputEntity(targetId(chatId));
      this.assertEgressActive(accountId, row, options, false);
      const reaction = clean(emoji) ? [new Api.ReactionEmoji({ emoticon: clean(emoji) })] : [];
      result = await row.client.invoke(new Api.messages.SendReaction({ peer, msgId: messageId(targetMessageId), reaction, addToRecent: true }));
      this.assertEgressActive(accountId, row, options, true);
    } finally {
      detachAbort();
    }
    const reactionInput = { accountId, chatJid: `telegram:${targetId(chatId)}`, targetId: clean(targetMessageId), emoji: clean(emoji), actor: 'me' };
    let localPersistencePending = false;
    let localPersistenceErrorCode = '';
    try { await messageStore.applyReaction(reactionInput); }
    catch (error) { localPersistencePending = true; localPersistenceErrorCode = clean(error.code || error.message || 'TELEGRAM_REACTION_LOCAL_PERSISTENCE_FAILED'); }
    return { raw: result, messageId: clean(result?.id), localPersistencePending, localPersistenceErrorCode, localPersistenceRepair: localPersistencePending ? { kind: 'reaction-apply', reaction: reactionInput } : null };
  }

  async revokeMessage(accountId, chatId, targetMessageId, options = {}) {
    const row = this.connected(accountId);
    const detachAbort = this.bindEgressAbort(accountId, row, options);
    let result;
    try {
      result = await row.client.deleteMessages(targetId(chatId), [messageId(targetMessageId)], { revoke: true });
      this.assertEgressActive(accountId, row, options, true);
    } finally {
      detachAbort();
    }
    const revokeInput = { accountId, chatJid: `telegram:${targetId(chatId)}`, targetId: clean(targetMessageId) };
    let localPersistencePending = false;
    let localPersistenceErrorCode = '';
    try { await messageStore.revoke(revokeInput); }
    catch (error) { localPersistencePending = true; localPersistenceErrorCode = clean(error.code || error.message || 'TELEGRAM_REVOKE_LOCAL_PERSISTENCE_FAILED'); }
    return { raw: result, messageId: clean(result?.id), localPersistencePending, localPersistenceErrorCode, localPersistenceRepair: localPersistencePending ? { kind: 'message-revoke', revoke: revokeInput } : null };
  }

  async markRead(accountId, chatId, keys = [], options = {}) {
    const row = this.connected(accountId);
    const ids = (Array.isArray(keys) ? keys : []).map(item => messageId(item?.id || item)).filter(Boolean);
    const detachAbort = this.bindEgressAbort(accountId, row, options);
    let value;
    try {
      value = await row.client.markAsRead(targetId(chatId), ids.length ? ids : undefined);
      this.assertEgressActive(accountId, row, options, true);
    } finally {
      detachAbort();
    }
    return { marked: value !== false, count: ids.length };
  }

  async sendPresence(accountId, chatId, state = 'composing', options = {}) {
    const row = this.connected(accountId); const { Api } = this.loadSdk();
    const detachAbort = this.bindEgressAbort(accountId, row, options);
    let result;
    try {
      const peer = await row.client.getInputEntity(targetId(chatId));
      this.assertEgressActive(accountId, row, options, false);
      const action = ['paused', 'available', 'cancel'].includes(clean(state).toLowerCase()) ? new Api.SendMessageCancelAction({}) : new Api.SendMessageTypingAction({});
      result = await row.client.invoke(new Api.messages.SetTyping({ peer, action }));
      this.assertEgressActive(accountId, row, options, true);
    } finally {
      detachAbort();
    }
    return { state, accepted: Boolean(result) };
  }
}

const telegramAdapter = new TelegramAdapter();
module.exports = telegramAdapter;
module.exports.TelegramAdapter = TelegramAdapter;
module.exports.telegramTypingActivity = telegramTypingActivity;
module.exports.telegramTypingUpdate = telegramTypingUpdate;
module.exports.telegramPresenceUpdate = telegramPresenceUpdate;
module.exports.telegramTimestamp = telegramTimestamp;
module.exports.loadQRCodeDependency = loadQRCodeDependency;
