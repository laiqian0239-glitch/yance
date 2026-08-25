'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const logger = require('./logger');
const platformAuthConfig = require('./platformAuthConfig');
const { executeWithDeadline } = require('./executionDeadline');
const { createSessionGenerationFence } = require('./sessionGenerationFence');

function clean(value) { return value == null ? '' : String(value).trim(); }
function workerErrorCode(value, fallback = 'FACEBOOK_WORKER_REQUEST_FAILED') {
  const code = clean(value);
  return /^FACEBOOK_[A-Z0-9_]+$/u.test(code) ? code : fallback;
}
function persistedOperationIdentity(options = {}) {
  const source = options.physicalAttemptContext || options.physicalOperationContext;
  if (!source || typeof source !== 'object' || Array.isArray(source) || !Object.isFrozen(source)) {
    throw Object.assign(new Error('Facebook relay physical I/O requires a frozen persisted WP-B attempt'), { code: 'FACEBOOK_RELAY_PERSISTED_ATTEMPT_REQUIRED', status: 409 });
  }
  const executionId = clean(source.executionId || source.operationId);
  const attemptId = clean(source.attemptId || source.operationId);
  const claimId = clean(source.claimId);
  const ownerId = clean(source.ownerId);
  if (!executionId || !attemptId || !claimId || !ownerId) {
    throw Object.assign(new Error('Facebook relay persisted attempt identity is incomplete'), { code: 'FACEBOOK_RELAY_PERSISTED_ATTEMPT_REQUIRED', status: 409 });
  }
  for (const field of ['generation', 'hostGeneration', 'fencingToken']) {
    const value = Number(source[field]);
    if (!Number.isSafeInteger(value) || value < 1) throw Object.assign(new Error('Facebook relay persisted fencing identity is invalid'), { code: 'FACEBOOK_RELAY_PERSISTED_ATTEMPT_REQUIRED', status: 409, field });
  }
  if (clean(source.state) && clean(source.state).toUpperCase() !== 'RUNNING') {
    throw Object.assign(new Error('Facebook relay persisted operation must be RUNNING'), { code: 'FACEBOOK_RELAY_PERSISTED_ATTEMPT_REQUIRED', status: 409, field: 'state' });
  }
  if (clean(source.platform) && clean(source.platform).toLowerCase() !== 'facebook') {
    throw Object.assign(new Error('Facebook relay persisted attempt platform mismatch'), { code: 'FACEBOOK_RELAY_PERSISTED_ATTEMPT_REQUIRED', status: 409, field: 'platform' });
  }
  return Object.freeze({
    executionId, attemptId, claimId, ownerId,
    generation: Number(source.generation), hostGeneration: Number(source.hostGeneration), fencingToken: Number(source.fencingToken),
    operationKind: clean(source.operationKind), deadlineAt: clean(source.deadlineAt), accountId: clean(source.accountId || source.accountReference)
  });
}
const PERSISTED_OPERATION_HEADER_KEYS = Object.freeze([
  'x-yance-wpb-execution-id',
  'x-yance-wpb-attempt-id',
  'x-yance-wpb-claim-id',
  'x-yance-wpb-owner-id',
  'x-yance-wpb-generation',
  'x-yance-wpb-host-generation',
  'x-yance-wpb-fencing-token',
  'x-yance-wpb-operation-kind'
]);
function persistedOperationHeaders(persisted) {
  return Object.freeze({
    'x-yance-wpb-execution-id': persisted.executionId,
    'x-yance-wpb-attempt-id': persisted.attemptId,
    'x-yance-wpb-claim-id': persisted.claimId,
    'x-yance-wpb-owner-id': persisted.ownerId,
    'x-yance-wpb-generation': String(persisted.generation),
    'x-yance-wpb-host-generation': String(persisted.hostGeneration),
    'x-yance-wpb-fencing-token': String(persisted.fencingToken),
    'x-yance-wpb-operation-kind': persisted.operationKind
  });
}
function persistedOperationBinding(headers = {}) {
  const required = PERSISTED_OPERATION_HEADER_KEYS.slice(0, 7);
  if (!required.every(key => clean(headers[key]))) return '';
  return PERSISTED_OPERATION_HEADER_KEYS.map(key => `${key}:${clean(headers[key])}`).join('\n');
}
async function readRawBodyWithDeadline(response, options = {}) {
  try {
    return await executeWithDeadline(
      () => response.arrayBuffer(),
      {
        timeoutMs: Math.max(1_000, Number(options.timeoutMs || 30_000)),
        code: clean(options.code) || 'FACEBOOK_RESPONSE_BODY_TIMEOUT',
        operation: clean(options.operation) || 'facebook-response-body'
      }
    );
  } catch (error) {
    try { await response.body?.cancel?.(error); } catch (_) {}
    throw error;
  }
}
function base64url(buffer) { return Buffer.from(buffer).toString('base64url'); }
function workerBaseUrl(value) {
  const raw = clean(value);
  if (!raw) return '';
  const url = new URL(raw);
  const allowed = url.protocol === 'https:' || (process.env.NODE_ENV === 'test' && url.protocol === 'http:');
  if (!allowed) throw Object.assign(new Error('Facebook 云端同步服务必须使用 HTTPS'), { code: 'FACEBOOK_WORKER_HTTPS_REQUIRED' });
  if (url.username || url.password) throw Object.assign(new Error('Facebook 云端同步地址不能包含凭据'), { code: 'FACEBOOK_WORKER_URL_CREDENTIALS_FORBIDDEN' });
  url.pathname = url.pathname.replace(/\/$/, ''); url.search = ''; url.hash = '';
  return url.toString().replace(/\/$/, '');
}
function assertReleaseWorkerBinding(value) {
  const actual = workerBaseUrl(value);
  if (!actual) throw Object.assign(new Error('Facebook 云端同步服务尚未配置'), { code: 'FACEBOOK_WORKER_UNCONFIGURED', status: 409 });
  const release = platformAuthConfig.facebook();
  if (release.configured === true) {
    const expected = workerBaseUrl(release.workerBaseUrl);
    if (actual !== expected) {
      throw Object.assign(new Error('Facebook 账号绑定的云端服务与当前正式发行配置不一致，请重新授权'), {
        code: 'FACEBOOK_WORKER_BINDING_MISMATCH', status: 409,
        details: { expectedHost: new URL(expected).host, actualHost: new URL(actual).host }
      });
    }
  } else if (!(process.env.NODE_ENV === 'test' || process.execArgv.some(arg => arg === '--test' || arg.startsWith('--test-')))) {
    throw Object.assign(new Error('当前安装包尚未启用 Facebook 正式云端服务'), { code: 'FACEBOOK_RELEASE_SERVICE_UNAVAILABLE', status: 409 });
  }
  return actual;
}
function generateDeviceIdentity(existing = {}) {
  if (clean(existing.deviceId) && clean(existing.devicePublicKeySpki) && clean(existing.devicePrivateKeyPkcs8)) {
    return { deviceId: clean(existing.deviceId), publicKeySpki: clean(existing.devicePublicKeySpki), privateKeyPkcs8: clean(existing.devicePrivateKeyPkcs8) };
  }
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    deviceId: `fbdev_${crypto.randomUUID()}`,
    publicKeySpki: base64url(publicKey.export({ format: 'der', type: 'spki' })),
    privateKeyPkcs8: base64url(privateKey.export({ format: 'der', type: 'pkcs8' }))
  };
}
function sha256Base64Url(value) { return crypto.createHash('sha256').update(value).digest('base64url'); }
function timingSafeTextEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}
function verifyEnvelope(envelope, relaySecret) {
  if (!envelope || typeof envelope !== 'object') return false;
  const eventId = clean(envelope.eventId);
  const sentAt = clean(envelope.sentAt);
  const signature = clean(envelope.signature);
  const secret = clean(relaySecret);
  const body = envelope.body && typeof envelope.body === 'object' ? envelope.body : null;
  if (clean(envelope.type) !== 'facebook:webhook' || !eventId || !sentAt || !signature || !secret || !body) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${eventId}.${sentAt}.${JSON.stringify(body)}`).digest('base64url');
  return timingSafeTextEqual(expected, signature);
}
function relayManagementUrl(value, pageId) {
  const url = new URL(clean(value));
  if (url.protocol === 'wss:') url.protocol = 'https:';
  else if (url.protocol === 'ws:') url.protocol = 'http:';
  const allowed = url.protocol === 'https:' || (process.env.NODE_ENV === 'test' && url.protocol === 'http:');
  if (!allowed) throw Object.assign(new Error('Facebook Relay 管理接口必须使用 HTTPS'), { code: 'FACEBOOK_RELAY_MANAGEMENT_HTTPS_REQUIRED' });
  if (url.username || url.password) throw Object.assign(new Error('Facebook Relay 管理地址不能包含凭据'), { code: 'FACEBOOK_RELAY_MANAGEMENT_URL_CREDENTIALS_FORBIDDEN' });
  const basePath = url.pathname.replace(/\/+$/, '');
  url.pathname = `${basePath}/credentials/${encodeURIComponent(clean(pageId))}`;
  url.search = '';
  url.hash = '';
  return url.toString();
}
function canonicalRequest({ deviceId, timestamp, requestId, method, path, bodySha256, idempotencyKey = '' }) {
  return ['YANCE-FACEBOOK-DESKTOP-V1', clean(deviceId), clean(timestamp), clean(requestId), clean(method).toUpperCase(), clean(path), clean(bodySha256), clean(idempotencyKey)].join('\n');
}
function signedHeaders(secret, url, method, bodyText = '', idempotencyKey = '', authenticatedMetadata = {}) {
  const deviceId = clean(secret.deviceId);
  const privateBytes = Buffer.from(clean(secret.devicePrivateKeyPkcs8), 'base64url');
  if (!deviceId || !privateBytes.length) throw Object.assign(new Error('Facebook 设备身份未就绪，请重新授权'), { code: 'FACEBOOK_DEVICE_IDENTITY_MISSING', status: 409 });
  const timestamp = new Date().toISOString();
  const metadataBinding = persistedOperationBinding(authenticatedMetadata);
  const requestId = metadataBinding ? `${crypto.randomUUID()}.${sha256Base64Url(metadataBinding)}` : crypto.randomUUID();
  const bodySha256 = sha256Base64Url(Buffer.from(bodyText));
  const parsed = new URL(url);
  const path = `${parsed.pathname}${parsed.search}`;
  const canonical = canonicalRequest({ deviceId, timestamp, requestId, method, path, bodySha256, idempotencyKey });
  const key = crypto.createPrivateKey({ key: privateBytes, format: 'der', type: 'pkcs8' });
  const signature = crypto.sign(null, Buffer.from(canonical), key).toString('base64url');
  return {
    'x-yance-device-id': deviceId,
    'x-yance-timestamp': timestamp,
    'x-yance-request-id': requestId,
    'x-yance-body-sha256': bodySha256,
    'x-yance-signature': signature,
    ...(idempotencyKey ? { 'x-yance-idempotency-key': idempotencyKey } : {}),
    ...authenticatedMetadata
  };
}

class FacebookRelayClient {
  constructor() { this.sessions = new Map(); }

  status(accountId) {
    const row = this.sessions.get(accountId);
    return row ? {
      state: row.state,
      connectedAt: row.connectedAt || '',
      lastError: row.lastError || '',
      lastSyncAt: row.lastSyncAt || '',
      lastAckAt: row.lastAckAt || '',
      pendingEvents: Number(row.pendingEvents || 0),
      deadLetter: Number(row.deadLetter || 0),
      workerStatus: row.workerStatus || 'unknown'
    } : { state: 'unconfigured', connectedAt: '', lastError: '', lastSyncAt: '', lastAckAt: '', pendingEvents: 0, deadLetter: 0, workerStatus: 'unconfigured' };
  }

  async request(secret, endpoint, options = {}, timeoutMs = 30000) {
    const persisted = persistedOperationIdentity(options);
    const base = assertReleaseWorkerBinding(secret.workerBaseUrl);
    const url = new URL(endpoint, `${base}/`).toString();
    const method = clean(options.method || 'GET').toUpperCase();
    const bodyText = options.body == null ? '' : typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
    const signatureHeaders = signedHeaders(secret, url, method, bodyText, clean(options.idempotencyKey), persistedOperationHeaders(persisted));
    const localRequestId = clean(signatureHeaders['x-yance-request-id']);
    const headers = {
      accept: options.accept || 'application/json',
      ...(bodyText ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {}),
      ...signatureHeaders,
      'user-agent': 'Yance-FacebookWorkerClient/1'
    };
    return executeWithDeadline(async ({ signal }) => {
      const response = await fetch(url, { method, headers, body: bodyText || undefined, signal });
      if (options.raw === true) {
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw Object.assign(new Error(data.message || `Facebook 云端媒体请求失败（HTTP ${response.status}）`), { code: workerErrorCode(data.code), status: response.status, details: { ...(data.details || {}), requestId: clean(data.details?.requestId || response.headers?.get?.('x-yance-request-id') || localRequestId) } });
        }
        Object.defineProperty(response, 'yanceRequestId', { value: clean(response.headers?.get?.('x-yance-request-id') || localRequestId), enumerable: false });
        return response;
      }
      const data = await response.json().catch(() => ({}));
      const providerRequestId = clean(response.headers?.get?.('x-yance-request-id') || data?.providerRequestId || localRequestId);
      if (!response.ok || data.ok === false) throw Object.assign(new Error(data.message || `Facebook 云端服务返回 HTTP ${response.status}`), { code: workerErrorCode(data.code), status: response.status, details: { ...(data.details || {}), requestId: clean(data.details?.requestId || providerRequestId) } });
      return { ...data, providerRequestId };
    }, {
      deadlineAt: persisted.deadlineAt,
      timeoutMs,
      signal: options.signal || null,
      generation: persisted.generation,
      code: 'FACEBOOK_WORKER_TIMEOUT',
      operation: 'facebook-relay-request',
      platform: 'facebook',
      accountId: persisted.accountId
    });
  }

  async health(secret, options = {}) { return this.request(secret, '/api/desktop/health', { ...options, signal: options.signal }, 15000); }
  async accounts(secret, options = {}) { return this.request(secret, '/api/desktop/accounts', options, 15000); }
  async refreshPermissions(secret, options = {}) { return this.request(secret, '/api/desktop/permissions/refresh', { ...options, method: 'POST', body: {} }, 15000); }

  async avatarBuffer(secret, kind = 'profile', psid = '', options = {}) {
    const endpoint = kind === 'page' ? '/api/desktop/avatar/page' : `/api/desktop/avatar/profile?psid=${encodeURIComponent(clean(psid))}`;
    const response = await this.request(secret, endpoint, { ...options, raw: true, accept: 'image/*' }, 30000);
    const declared = Number(response.headers?.get?.('content-length') || 0);
    if (declared > 8 * 1024 * 1024) throw Object.assign(new Error('Facebook 头像文件过大'), { code: 'FACEBOOK_AVATAR_TOO_LARGE', status: 413 });
    const buffer = Buffer.from(await readRawBodyWithDeadline(response, { timeoutMs: 30_000, code: 'FACEBOOK_AVATAR_BODY_TIMEOUT', operation: 'facebook-avatar-body' }));
    if (!buffer.length || buffer.length > 8 * 1024 * 1024) throw Object.assign(new Error('Facebook 头像响应无效'), { code: 'FACEBOOK_AVATAR_RESPONSE_INVALID', status: 502 });
    return { buffer, mimeType: clean(response.headers?.get?.('content-type')), requestId: clean(response.yanceRequestId || response.headers?.get?.('x-yance-request-id')) };
  }

  async _processEventWithLeaseRenewal(secret, event, onWebhook, options, isCurrent, signal) {
    const deliveryId = clean(event?.delivery_id);
    const leaseToken = clean(event?.lease_token);
    let leaseExpiresAt = Date.parse(clean(event?.lease_expires_at));
    if (!deliveryId || !leaseToken || !Number.isFinite(leaseExpiresAt)) {
      await onWebhook(event?.payload || {});
      return;
    }

    let done = false;
    let timer = null;
    let wake = null;
    let renewalError = null;
    const stop = () => {
      done = true;
      if (timer) { clearTimeout(timer); timer = null; }
      if (wake) { const resolve = wake; wake = null; resolve(); }
    };
    const abort = () => stop();
    if (signal?.aborted) stop();
    else signal?.addEventListener?.('abort', abort, { once: true });

    const heartbeat = (async () => {
      while (!done && isCurrent()) {
        const remainingMs = leaseExpiresAt - Date.now();
        const delayMs = Math.max(1_000, Math.min(60_000, remainingMs - 60_000));
        await new Promise(resolve => {
          wake = resolve;
          timer = setTimeout(() => { timer = null; wake = null; resolve(); }, delayMs);
        });
        if (done || !isCurrent()) break;
        const renewal = await this.request(secret, '/api/desktop/events/renew', {
          ...options,
          method: 'POST',
          body: { renewals: [{ delivery_id: deliveryId, lease_token: leaseToken, lease_seconds: 240 }] },
          signal: options.signal || signal
        }, 30000);
        const renewed = Array.isArray(renewal.renewed) && renewal.renewed.includes(deliveryId);
        if (!renewed) {
          const failure = Array.isArray(renewal.failed)
            ? renewal.failed.find(item => clean(item?.delivery_id) === deliveryId)
            : null;
          throw Object.assign(new Error('Facebook Worker event lease renewal rejected'), {
            code: workerErrorCode(failure?.code, 'FACEBOOK_RENEW_FAILED'), status: 409,
            details: { deliveryId }
          });
        }
        leaseExpiresAt = Date.now() + 240_000;
      }
    })().catch(error => { renewalError = error; });

    let processingError = null;
    try { await onWebhook(event.payload || {}); }
    catch (error) { processingError = error; }
    finally {
      stop();
      signal?.removeEventListener?.('abort', abort);
    }
    await heartbeat;
    if (renewalError) throw renewalError;
    if (processingError) throw processingError;
  }

  async syncOnce(account, secret, onWebhook, options = {}) {
    const row = this.sessions.get(account.id);
    const fence = row?.sessionFence || null;
    const isCurrent = () => !row || (
      row.stopped !== true
      && this.sessions.get(account.id) === row
      && (!fence || fence.isCurrent())
    );
    const staleResult = () => ({ received: 0, acked: 0, hasMore: false, stale: true, syncedAt: '' });
    const signal = row?.pollController?.signal || null;
    const result = await this.request(secret, '/api/desktop/events?limit=50&lease_seconds=180', { ...options, signal: options.signal || signal }, 30000);
    if (!isCurrent()) return staleResult();
    const acknowledgements = [];
    for (const event of Array.isArray(result.events) ? result.events : []) {
      if (!isCurrent()) return staleResult();
      try {
        await this._processEventWithLeaseRenewal(secret, event, onWebhook, options, isCurrent, options.signal || signal);
        if (!isCurrent()) return staleResult();
        acknowledgements.push({ delivery_id: event.delivery_id, lease_token: event.lease_token });
      } catch (error) {
        if (!isCurrent()) return staleResult();
        logger.warn('facebook', 'worker-event-local-persist-failed', { accountId: account.id, eventId: event.event_id, code: error.code || '', error: error.message });
      }
    }
    let ackedCount = 0;
    if (acknowledgements.length) {
      if (!isCurrent()) return staleResult();
      const ack = await this.request(secret, '/api/desktop/ack', { ...options, method: 'POST', body: { acknowledgements }, signal: options.signal || signal }, 30000);
      if (!isCurrent()) return staleResult();
      ackedCount = Array.isArray(ack.acked) ? ack.acked.length : 0;
      if (ack.failed?.length) logger.warn('facebook', 'worker-ack-partial-failure', { accountId: account.id, failed: ack.failed.length });
      if (row && ackedCount > 0) row.lastAckAt = new Date().toISOString();
    }
    if (row && isCurrent()) {
      row.lastSyncAt = new Date().toISOString();
      row.pendingEvents = Math.max(0, Number(row.pendingEvents || 0) + Number(result.events?.length || 0) - ackedCount);
    }
    return { received: Number(result.events?.length || 0), acked: ackedCount, hasMore: result.has_more === true, syncedAt: new Date().toISOString() };
  }

  async connect(account, secret, onWebhook, onState = () => {}, options = {}) {
    await this.disconnect(account.id);
    if (!clean(secret.workerBaseUrl) || !clean(secret.cloudAccountId) || !clean(secret.deviceId) || !clean(secret.devicePrivateKeyPkcs8)) {
      return { state: 'unconfigured', connectedAt: '', lastError: 'Facebook 云端账号尚未完成授权' };
    }
    persistedOperationIdentity(options);
    const row = { accountId: account.id, state: 'connecting', connectedAt: '', lastError: '', stopped: false, onState, lastSyncAt: '', lastAckAt: '', pendingEvents: 0, deadLetter: 0, workerStatus: 'checking', pollController: new AbortController() };
    row.sessionFence = createSessionGenerationFence(
      () => this.sessions.get(account.id) === row && row.stopped !== true,
      { prefix: `facebook:${account.id}` }
    );
    const publish = () => {
      try { row.onState(this.status(account.id)); }
      catch (error) { logger.warn('facebook', 'worker-state-listener-failed', { accountId: account.id, code: clean(error?.code), error: clean(error?.message || error) }); }
    };
    this.sessions.set(account.id, row);
    const health = await this.health(secret, { ...options, signal: options.signal || row.pollController.signal });
    if (!row.sessionFence.isCurrent()) return { state: 'paused', connectedAt: '', lastError: '' };
    row.state = health.status === 'ready' ? 'connected' : 'connecting';
    row.workerStatus = health.status || 'unknown';
    row.connectedAt = new Date().toISOString();
    row.lastError = '';
    row.pendingEvents = Number(health.queue?.pending || 0) + Number(health.queue?.leased || 0);
    row.deadLetter = Number(health.queue?.deadLetter || 0);
    row.lastAckAt = clean(health.queue?.lastAckAt || row.lastAckAt);
    publish();
    // Polling/retry scheduling is owned by the durable HISTORY_SYNCHRONIZATION /
    // SESSION_RESTORE operation pump. connect() performs exactly one health observation.
    return this.status(account.id);
  }

  async send(secret, operation, idempotencyKey, options = {}) {
    return this.request(secret, '/api/desktop/send', { ...options, method: 'POST', body: operation, idempotencyKey, signal: options.signal, executionGeneration: options.executionGeneration }, 90000);
  }

  async history(secret, { limit = 50, messagesLimit = 50, after = '' } = {}, options = {}) {
    const query = new URLSearchParams({ limit: String(limit), messages_limit: String(messagesLimit) });
    if (after) query.set('after', after);
    return this.request(secret, `/api/desktop/history?${query}`, {
      ...options,
      signal: options.signal,
      executionGeneration: options.executionGeneration
    }, 45000);
  }

  async historyMessages(secret, conversationId, { limit = 50, after = '' } = {}, options = {}) {
    const query = new URLSearchParams({ conversation_id: clean(conversationId), limit: String(limit) });
    if (after) query.set('after', after);
    return this.request(secret, `/api/desktop/history/messages?${query}`, {
      ...options,
      signal: options.signal,
      executionGeneration: options.executionGeneration
    }, 45000);
  }

  async profile(secret, psid, options = {}) { return this.request(secret, `/api/desktop/profile?psid=${encodeURIComponent(clean(psid))}`, options, 15000); }

  async downloadMedia(secret, eventId, index, outputPath, options = {}) {
    const response = await this.request(secret, `/api/desktop/media/${encodeURIComponent(clean(eventId))}/${Number(index)}`, { ...options, raw: true, accept: 'application/octet-stream' }, 60000);
    const bytes = Buffer.from(await readRawBodyWithDeadline(response, { timeoutMs: 60_000, code: 'FACEBOOK_MEDIA_BODY_TIMEOUT', operation: 'facebook-media-body' }));
    fs.writeFileSync(outputPath, bytes, { flag: 'wx' });
    return { bytes: bytes.length, mimeType: clean(response.headers.get('content-type'), 'application/octet-stream'), filename: clean(response.headers.get('content-disposition')) };
  }

  async revoke(accountId, secret = {}, options = {}) {
    const persisted = persistedOperationIdentity(options);
    const legacyRelayUrl = clean(secret.relayUrl);
    const legacyPageId = clean(secret.pageId);
    const legacyRelayToken = clean(secret.relayToken);
    if (legacyRelayUrl || legacyPageId || legacyRelayToken) {
      if (!legacyRelayUrl || !legacyPageId || !legacyRelayToken) return { revoked: false, skipped: true };
      const url = relayManagementUrl(legacyRelayUrl, legacyPageId);
      return executeWithDeadline(async ({ signal }) => {
        const response = await fetch(url, {
          method: 'DELETE',
          headers: { accept: 'application/json', authorization: `Bearer ${legacyRelayToken}`, 'user-agent': 'Yance-FacebookRelayClient/1' },
          signal
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.ok === false) {
          throw Object.assign(new Error(data.message || `Facebook Relay 凭据撤销失败（HTTP ${response.status}）`), {
            code: workerErrorCode(data.code, 'FACEBOOK_RELAY_REVOKE_FAILED'), status: response.status, details: { pageId: legacyPageId }
          });
        }
        logger.info('facebook', 'relay-credential-revoked', { accountId, pageId: legacyPageId });
        return { revoked: data.revoked === true, skipped: false };
      }, { deadlineAt: persisted.deadlineAt, timeoutMs: 30000, signal: options.signal || null, generation: persisted.generation, code: 'FACEBOOK_RELAY_REVOKE_TIMEOUT', operation: 'facebook-relay-revoke', platform: 'facebook', accountId });
    }
    if (!clean(secret.workerBaseUrl) || !clean(secret.deviceId)) return { revoked: false, skipped: true };
    const disconnectAccount = options.disconnectAccount === true;
    const body = { disconnectAccount };
    if (disconnectAccount) body.unsubscribe = options.unsubscribe !== false;
    const result = await this.request(secret, '/api/desktop/disconnect', { ...options, method: 'POST', body }, 30000);
    logger.info('facebook', disconnectAccount ? 'worker-account-disconnected' : 'worker-device-disconnected', { accountId, pageId: clean(secret.pageId), disconnectAccount });
    return { revoked: result.disconnected === true, accountDisconnected: result.accountDisconnected === true, skipped: false };
  }

  async disconnect(accountId) {
    const row = this.sessions.get(accountId);
    if (!row) return { state: 'paused' };
    row.stopped = true;
    row.sessionFence?.invalidate?.('FACEBOOK_RELAY_DISCONNECT');
    if (!row.pollController?.signal?.aborted) {
      row.pollController?.abort?.(Object.assign(new Error('Facebook relay disconnected'), { code: 'FACEBOOK_RELAY_DISCONNECTED' }));
    }
    this.sessions.delete(accountId);
    return { state: 'paused' };
  }
}

module.exports = new FacebookRelayClient();
module.exports.FacebookRelayClient = FacebookRelayClient;
module.exports.workerBaseUrl = workerBaseUrl;
module.exports.assertReleaseWorkerBinding = assertReleaseWorkerBinding;
module.exports.generateDeviceIdentity = generateDeviceIdentity;
module.exports.canonicalRequest = canonicalRequest;
module.exports.signedHeaders = signedHeaders;
module.exports.verifyEnvelope = verifyEnvelope;
module.exports.relayManagementUrl = relayManagementUrl;

module.exports.readRawBodyWithDeadline = readRawBodyWithDeadline;

module.exports.persistedOperationIdentity = persistedOperationIdentity;
