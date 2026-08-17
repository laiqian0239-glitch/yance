'use strict';

const fs = require('fs');
const crypto = require('crypto');
const mediaPipeline = require('./mediaPipeline');
const messageStore = require('./messageStore');
const logger = require('./logger');
const { currentRuntimeInternalOperationAuthority } = require('./durableInternalOperationAuthority');
const { currentRuntimeRecoveryAuthority } = require('./durableExecutionRecoveryAuthority');

const MAX_AVATAR_BYTES = 4 * 1024 * 1024;
const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_PROFILE_URL_TIMEOUT_MS = 10000;
const DEFAULT_CONCURRENCY = 4;
const ALLOWED_PROTOCOLS = new Set(['https:', 'http:']);
const LOCAL_MEDIA_PATTERN = /^\/api\/r32\/messages\/media\/([^/]+)\/([^/]+)\/([^/?#]+)(?:[?#].*)?$/;
// Avatar pixels are not platform identity. A WhatsApp Business contact may
// legitimately use another brand's logo. Provenance is the account/JID and
// profilePictureUrl request that produced the file, never image-content hashes.
const KNOWN_PLATFORM_AVATAR_HASHES = new Map();

function clean(value) { return String(value == null ? '' : value).trim(); }
function nowIso() { return new Date().toISOString(); }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function jidHash(jid) { return crypto.createHash('sha256').update(clean(jid).toLowerCase()).digest('hex').slice(0, 16); }
function contentHash(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }
function platformFromSource(source) {
  const value = clean(source).toLowerCase();
  if (value.startsWith('whatsapp-')) return 'whatsapp';
  if (value.startsWith('facebook-')) return 'facebook';
  if (value.startsWith('telegram-')) return 'telegram';
  return '';
}
function errorWith(code, message = code, details = {}) { return Object.assign(new Error(message), { code, ...details }); }
function abortError(signal, fallbackCode = 'AVATAR_SYNC_ABORTED') {
  const reason = signal?.reason instanceof Error ? signal.reason : errorWith(fallbackCode);
  if (!reason.code) reason.code = fallbackCode;
  return reason;
}
function assertNotAborted(signal, fallbackCode = 'AVATAR_SYNC_ABORTED') {
  if (signal?.aborted) throw abortError(signal, fallbackCode);
}
function withAbort(promise, signal, fallbackCode = 'AVATAR_SYNC_ABORTED') {
  if (!signal) return Promise.resolve(promise);
  assertNotAborted(signal, fallbackCode);
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError(signal, fallbackCode));
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

function normalizeJid(value) {
  const raw = clean(value).toLowerCase();
  if (!raw || !raw.includes('@')) return '';
  const [local, domain] = raw.split('@');
  return `${local.replace(/:\d+$/, '')}@${domain}`;
}

function classifyJid(value) {
  const jid = normalizeJid(value);
  const domain = jid.split('@')[1] || '';
  if (!jid) return { jid: '', kind: 'invalid', applicable: false };
  if (domain === 'broadcast') return { jid, kind: 'broadcast', applicable: false };
  if (domain === 'newsletter') return { jid, kind: 'newsletter', applicable: false };
  if (domain === 'g.us') return { jid, kind: 'group', applicable: true };
  if (['s.whatsapp.net', 'c.us', 'lid'].includes(domain)) return { jid, kind: 'contact', applicable: true };
  return { jid, kind: 'system', applicable: false };
}

function detectImageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 3) return null;
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { mimeType: 'image/jpeg', extension: 'jpg' };
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))) return { mimeType: 'image/png', extension: 'png' };
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return { mimeType: 'image/webp', extension: 'webp' };
  if (buffer.toString('ascii', 0, 6) === 'GIF87a' || buffer.toString('ascii', 0, 6) === 'GIF89a') return { mimeType: 'image/gif', extension: 'gif' };
  return null;
}

function mapFailure(error, fallback = 'avatar-sync-failed') {
  const code = clean(error?.code || error?.message || fallback);
  const status = Number(error?.httpStatus || error?.status || error?.response?.status || 0);
  if (code === 'AbortError' || /abort|timeout/i.test(code)) return { errorCode: 'fetch-timeout', httpStatus: status };
  if (status === 403 || /AVATAR_HTTP_403|HTTP_403/i.test(code)) return { errorCode: 'http-403', httpStatus: 403 };
  if (status === 404 || /AVATAR_HTTP_404|HTTP_404/i.test(code)) return { errorCode: 'http-404', httpStatus: 404 };
  if (/AVATAR_TOO_LARGE|TOO_LARGE/i.test(code)) return { errorCode: 'avatar-too-large', httpStatus: status };
  if (/INVALID_IMAGE|MEDIA_EMPTY|UNKNOWN_IMAGE/i.test(code)) return { errorCode: 'invalid-image', httpStatus: status };
  if (/FILE_WRITE|EACCES|ENOSPC|EROFS/i.test(code)) return { errorCode: 'file-write-failed', httpStatus: status };
  if (/DATABASE_UPDATE|SQLITE|DB_/i.test(code)) return { errorCode: 'database-update-failed', httpStatus: status };
  return { errorCode: code.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '') || fallback, httpStatus: status };
}

function avatarFailureRetryable(errorOrCode = {}) {
  const mapped = typeof errorOrCode === 'string' ? { errorCode: errorOrCode } : mapFailure(errorOrCode);
  const normalizedCode = clean(mapped.errorCode)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return !new Set([
    'http-403', 'http-404', 'invalid-image', 'avatar-too-large',
    'not-applicable-invalid', 'privacy-restricted', 'no-profile-photo',
    'facebook-contact-profile-permission-denied', 'meta-contact-profile-access-denied',
    'facebook-contact-avatar-unsupported-get', 'meta-contact-avatar-unsupported-get'
  ]).has(normalizedCode);
}

class AvatarSyncService {
  constructor(options = {}) {
    this.fetchImpl = options.fetchImpl || global.fetch;
    this.fs = options.fs || fs;
    this.mediaPipeline = options.mediaPipeline || mediaPipeline;
    this.messageStore = options.messageStore || messageStore;
    this.logger = options.logger || logger;
    this.timeoutMs = Math.max(50, Number(options.timeoutMs || DEFAULT_TIMEOUT_MS));
    this.profileUrlTimeoutMs = Math.max(1000, Number(options.profileUrlTimeoutMs || DEFAULT_PROFILE_URL_TIMEOUT_MS));
    this.maxBytes = Math.max(1024, Number(options.maxBytes || MAX_AVATAR_BYTES));
    this.refreshIntervalMs = Math.max(1000, Number(options.refreshIntervalMs || REFRESH_INTERVAL_MS));
    this.concurrency = Math.max(1, Math.min(8, Number(options.concurrency || DEFAULT_CONCURRENCY)));
    this.queue = [];
    this.active = 0;
    this.inFlight = new Map();
    this.refreshedAt = new Map();
    this.maxRefreshEntries = Math.max(1, Number(options.maxRefreshEntries || 10_000));
    this.knownPlatformAvatarHashes = options.knownPlatformAvatarHashes instanceof Map
      ? options.knownPlatformAvatarHashes
      : KNOWN_PLATFORM_AVATAR_HASHES;
    this.backgroundJobs = options.backgroundJobs === undefined ? null : options.backgroundJobs;
    this.useCanonicalDurability = options.backgroundJobs === undefined && this.messageStore === messageStore;
    this.avatarJobMaxAttempts = Math.max(1, Number(options.avatarJobMaxAttempts || 4));
    this.avatarRetryDelayMs = Math.max(1000, Number(options.avatarRetryDelayMs || 15 * 60 * 1000));
  }

  rememberRefresh(conversationId, at = Date.now()) {
    const key = clean(conversationId);
    if (!key) return;
    this.refreshedAt.delete(key);
    this.refreshedAt.set(key, Number(at) || Date.now());
    while (this.refreshedAt.size > this.maxRefreshEntries) {
      const oldest = this.refreshedAt.keys().next().value;
      if (!oldest) break;
      this.refreshedAt.delete(oldest);
    }
  }

  classifyKnownPlatformAsset(buffer, expectedPlatform = '') {
    if (!Buffer.isBuffer(buffer) || !buffer.length) return null;
    const hash = contentHash(buffer);
    const known = this.knownPlatformAvatarHashes.get(hash) || null;
    if (!known) return { hash, known: false };
    const actualPlatform = clean(known.platform).toLowerCase();
    const expected = clean(expectedPlatform).toLowerCase();
    return {
      hash,
      known: true,
      actualPlatform,
      expectedPlatform: expected,
      mismatch: false,
      reasonCode: clean(known.reasonCode) || 'known-platform-placeholder'
    };
  }

  validateBuffer(buffer, options = {}) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw errorWith('INVALID_IMAGE', 'Avatar response is empty');
    if (buffer.length > this.maxBytes) throw errorWith('AVATAR_TOO_LARGE', 'Avatar exceeds size limit');
    const type = detectImageType(buffer);
    if (!type) throw errorWith('INVALID_IMAGE', 'Avatar payload is not JPEG, PNG, WebP or GIF');
    const platformAsset = this.classifyKnownPlatformAsset(buffer, options.expectedPlatform);
    return { ...type, bytes: buffer.length, hash: platformAsset?.hash || contentHash(buffer) };
  }

  resolveLocalFile(url) {
    const match = LOCAL_MEDIA_PATTERN.exec(clean(url));
    if (!match) return '';
    try {
      return this.mediaPipeline.resolveFile(decodeURIComponent(match[1]), decodeURIComponent(match[2]), decodeURIComponent(match[3]));
    } catch (_) { return ''; }
  }

  validateCachedAvatar(url, options = {}) {
    const localFile = this.resolveLocalFile(url);
    if (!localFile) return { valid: false, errorCode: 'cache-file-missing', localFile: '' };
    try {
      const stat = this.fs.statSync(localFile);
      if (!stat.isFile() || stat.size <= 0) return { valid: false, errorCode: 'cache-file-missing', localFile };
      if (stat.size > this.maxBytes) return { valid: false, errorCode: 'avatar-too-large', localFile, bytes: stat.size };
      const fd = this.fs.openSync(localFile, 'r');
      try {
        const preview = Buffer.alloc(Math.min(32, stat.size));
        const bytesRead = Number(this.fs.readSync(fd, preview, 0, preview.length, 0) || preview.length);
        const sample = preview.subarray(0, Math.max(0, Math.min(preview.length, bytesRead)));
        const type = detectImageType(sample);
        if (!type) return { valid: false, errorCode: 'cache-file-corrupt', localFile, bytes: stat.size };
        // Full-file hashing is diagnostic-only. Cache validity must not depend on
        // content classification or on an optional injected readFileSync method.
        const buffer = typeof this.fs.readFileSync === 'function' ? this.fs.readFileSync(localFile) : sample;
        const platformAsset = this.classifyKnownPlatformAsset(buffer, options.expectedPlatform);
        return { valid: true, localFile, bytes: stat.size, avatarHash: platformAsset?.hash || contentHash(buffer), ...type };
      } finally { this.fs.closeSync(fd); }
    } catch (error) {
      return { valid: false, errorCode: error?.code === 'ENOENT' ? 'cache-file-missing' : 'cache-file-corrupt', localFile };
    }
  }

  needsRefresh(conversationId, force = false) {
    const key = clean(conversationId);
    if (force || !key) return true;
    const current = this.messageStore.getConversation(key);
    if (current?.customAvatar) return false;
    if (!current?.avatarUrl) {
      const deterministicFailure = new Set([
        'FACEBOOK_CONTACT_PROFILE_PERMISSION_DENIED',
        'META_CONTACT_PROFILE_ACCESS_DENIED',
        'FACEBOOK_CONTACT_AVATAR_UNSUPPORTED_GET',
        'META_CONTACT_AVATAR_UNSUPPORTED_GET'
      ]).has(clean(current?.avatarLastError || current?.avatar_last_error).toUpperCase());
      const failedAt = Date.parse(current?.avatarUpdatedAt || current?.avatar_updated_at || 0);
      if (deterministicFailure && Number.isFinite(failedAt) && Date.now() - failedAt < 24 * 60 * 60 * 1000) return false;
      return true;
    }
    if (['frontend-load-failed', 'cache-file-missing', 'cache-file-corrupt', 'invalid-image', 'file-write-failed'].includes(clean(current.avatarStatus || current.avatar_status))) return true;
    const cache = this.validateCachedAvatar(current.avatarUrl, { expectedPlatform: clean(current.platform) });
    if (!cache.valid) return true;
    const persisted = Date.parse(current.avatarUpdatedAt || current.avatar_updated_at || 0);
    const memory = Number(this.refreshedAt.get(key) || 0);
    const timestamp = Math.max(Number.isFinite(persisted) ? persisted : 0, memory);
    return !(timestamp > 0 && Date.now() - timestamp < this.refreshIntervalMs);
  }

  async persistAvatarState(conversationId, patch) {
    try {
      const saved = await this.messageStore.updateConversationMetadata(conversationId, patch);
      if (!saved) throw errorWith('DATABASE_UPDATE_FAILED', 'Conversation does not exist');
      return saved;
    } catch (error) {
      throw errorWith('DATABASE_UPDATE_FAILED', error.message, { cause: error });
    }
  }

  async cacheBuffer({ accountId, conversationId, buffer, source = '', avatarStatus = 'ready', platform = '' } = {}) {
    const expectedPlatform = clean(platform || platformFromSource(source));
    const verified = this.validateBuffer(buffer, { expectedPlatform });
    const previous = this.messageStore.getConversation(clean(conversationId));
    const previousLocalFile = previous?.avatarUrl ? this.resolveLocalFile(previous.avatarUrl) : '';
    let attachment;
    try {
      attachment = this.mediaPipeline.saveBuffer({
        accountId,
        conversationId,
        messageId: 'contact-avatar',
        buffer,
        descriptor: { kind: 'image', mimeType: verified.mimeType, filename: `contact-avatar.${verified.extension}`, source }
      });
    } catch (error) {
      throw errorWith('FILE_WRITE_FAILED', error.message, { cause: error });
    }
    const cache = this.validateCachedAvatar(attachment.mediaUrl, { expectedPlatform });
    if (!cache.valid) {
      try { if (attachment.localFile) this.fs.rmSync(attachment.localFile, { force: true }); } catch (cleanupError) { this.logger.warn('accounts', 'avatar-cache-cleanup-failed', { operation: 'avatar.cacheBuffer.removeInvalidFile', accountId: clean(accountId), conversationId: clean(conversationId), reasonCode: cleanupError.code || 'AVATAR_CACHE_CLEANUP_FAILED', httpStatus: 0, attempt: 1, nextRetryAt: '', error: cleanupError.message }); }
      throw errorWith(cache.errorCode === 'cache-file-missing' ? 'FILE_WRITE_FAILED' : 'INVALID_IMAGE', cache.errorCode);
    }
    const avatarUpdatedAt = nowIso();
    try {
      await this.persistAvatarState(conversationId, {
        avatarUrl: attachment.mediaUrl,
        avatarUpdatedAt,
        avatarStatus,
        avatarSource: source,
        clearAvatar: false
      });
    } catch (error) {
      try { if (attachment.localFile) this.fs.rmSync(attachment.localFile, { force: true }); } catch (cleanupError) { this.logger.warn('accounts', 'avatar-cache-cleanup-failed', { operation: 'avatar.cacheBuffer.rollbackFile', accountId: clean(accountId), conversationId: clean(conversationId), reasonCode: cleanupError.code || 'AVATAR_CACHE_ROLLBACK_FAILED', httpStatus: 0, attempt: 1, nextRetryAt: '', error: cleanupError.message }); }
      throw error;
    }
    if (previousLocalFile && previousLocalFile !== attachment.localFile) {
      try { this.fs.rmSync(previousLocalFile, { force: true }); } catch (error) {
        this.logger.warn('accounts', 'avatar-cache-cleanup-failed', { accountId: clean(accountId), conversationId: clean(conversationId), stage: 'replace-old-cache', errorCode: error.code || 'cache-cleanup-failed' });
      }
    }
    this.rememberRefresh(conversationId);
    return { avatarUrl: attachment.mediaUrl, avatarUpdatedAt, avatarStatus, localFile: attachment.localFile, bytes: verified.bytes, mimeType: verified.mimeType };
  }

  async fetchBuffer(url, attempt = 1, options = {}) {
    if (typeof this.fetchImpl !== 'function') throw errorWith('AVATAR_FETCH_UNAVAILABLE');
    let parsed;
    try { parsed = new URL(clean(url)); } catch (_) { throw errorWith('AVATAR_PROTOCOL_NOT_ALLOWED'); }
    if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) throw errorWith('AVATAR_PROTOCOL_NOT_ALLOWED');
    assertNotAborted(options.signal);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(errorWith('AVATAR_FETCH_TIMEOUT', 'Avatar request timed out')), this.timeoutMs);
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
    try {
      const response = await this.fetchImpl(parsed, { signal, redirect: 'follow' });
      if (!response?.ok) throw errorWith(`AVATAR_HTTP_${response?.status || 0}`, 'Avatar HTTP request failed', { httpStatus: Number(response?.status || 0) });
      const declared = Number(response.headers?.get?.('content-length') || 0);
      if (declared > this.maxBytes) throw errorWith('AVATAR_TOO_LARGE');
      const chunks = [];
      let bytes = 0;
      for await (const chunk of response.body || []) {
        const part = Buffer.from(chunk);
        bytes += part.length;
        if (bytes > this.maxBytes) throw errorWith('AVATAR_TOO_LARGE');
        chunks.push(part);
      }
      const buffer = Buffer.concat(chunks);
      const verified = this.validateBuffer(buffer);
      return { buffer, ...verified, attempt };
    } catch (error) {
      if (options.signal?.aborted) throw abortError(options.signal);
      if (error?.name === 'AbortError') throw errorWith('AVATAR_FETCH_TIMEOUT', 'Avatar request timed out', { cause: error });
      throw error;
    } finally { clearTimeout(timer); }
  }

  async cacheStandaloneBuffer({ accountId, assetKey = 'account-profile', buffer, source = '' } = {}) {
    const verified = this.validateBuffer(buffer);
    let attachment;
    try {
      attachment = this.mediaPipeline.saveBuffer({
        accountId: clean(accountId) || 'account',
        conversationId: `account-profile:${clean(accountId) || 'unknown'}`,
        messageId: clean(assetKey) || 'account-profile',
        buffer,
        descriptor: {
          kind: 'image',
          mimeType: verified.mimeType,
          filename: `${clean(assetKey) || 'account-profile'}.${verified.extension}`,
          source: source || 'account-profile'
        }
      });
    } catch (error) {
      throw errorWith('FILE_WRITE_FAILED', error.message, { cause: error });
    }
    const cache = this.validateCachedAvatar(attachment.mediaUrl);
    if (!cache.valid) {
      try { if (attachment.localFile) this.fs.rmSync(attachment.localFile, { force: true }); } catch (cleanupError) { this.logger.warn('accounts', 'avatar-cache-cleanup-failed', { operation: 'avatar.cacheStandaloneBuffer.removeInvalidFile', accountId: clean(accountId), conversationId: clean(assetKey), reasonCode: cleanupError.code || 'AVATAR_CACHE_CLEANUP_FAILED', httpStatus: 0, attempt: 1, nextRetryAt: '', error: cleanupError.message }); }
      throw errorWith(cache.errorCode === 'cache-file-missing' ? 'FILE_WRITE_FAILED' : 'INVALID_IMAGE', cache.errorCode);
    }
    return {
      avatarUrl: attachment.mediaUrl,
      avatarUpdatedAt: nowIso(),
      avatarStatus: 'ready',
      localFile: attachment.localFile,
      bytes: verified.bytes,
      mimeType: verified.mimeType
    };
  }

  async cacheStandaloneRemote({ accountId, assetKey = 'account-profile', url, source = '', retries = 1 } = {}) {
    let lastError;
    for (let attempt = 1; attempt <= Math.max(1, retries + 1); attempt += 1) {
      try {
        const result = await this.fetchBuffer(url, attempt);
        return await this.cacheStandaloneBuffer({ accountId, assetKey, buffer: result.buffer, source: source || 'account-profile' });
      } catch (error) {
        lastError = error;
        const mapped = mapFailure(error);
        if (['http-403', 'http-404', 'invalid-image', 'avatar-too-large'].includes(mapped.errorCode) || attempt > retries) break;
        await sleep(200 * 2 ** (attempt - 1));
      }
    }
    throw lastError;
  }

  async cacheRemote({ accountId, conversationId, url, source = '', platform = '', retries = 1, signal = null } = {}) {
    let lastError;
    for (let attempt = 1; attempt <= Math.max(1, retries + 1); attempt += 1) {
      assertNotAborted(signal);
      try {
        const result = await this.fetchBuffer(url, attempt, { signal });
        return await this.cacheBuffer({ accountId, conversationId, buffer: result.buffer, source: source || 'remote-avatar', platform });
      } catch (error) {
        if (signal?.aborted) throw abortError(signal);
        lastError = error;
        if (lastError && typeof lastError === 'object') lastError.attempt = attempt;
        const mapped = mapFailure(error);
        if (['http-403', 'http-404', 'invalid-image', 'avatar-too-large'].includes(mapped.errorCode) || attempt > retries) break;
        await withAbort(sleep(200 * 2 ** (attempt - 1)), signal);
      }
    }
    throw lastError;
  }

  recordFailure(input, error, stage, attempt, startedAt) {
    const mapped = mapFailure(error);
    const source = clean(input.source).toLowerCase();
    const platform = clean(input.platform || (source.startsWith('facebook-') ? 'facebook' : source.startsWith('telegram-') ? 'telegram' : input.jid ? 'whatsapp' : 'generic')).toLowerCase();
    const identity = platform === 'whatsapp' || clean(input.jid)
      ? { jidHash: jidHash(input.jid), jidKind: classifyJid(input.jid).kind }
      : { profileIdentityKind: platform || 'generic' };
    this.logger.warn('accounts', 'avatar-sync-failed', {
      accountId: clean(input.accountId),
      conversationId: clean(input.conversationId),
      contactId: clean(input.contactId),
      platform,
      ...identity,
      stage,
      errorCode: mapped.errorCode,
      httpStatus: mapped.httpStatus,
      attempt,
      durationMs: Math.max(0, Date.now() - startedAt)
    });
    return mapped;
  }

  async markUnavailable(input, status) {
    const current = this.messageStore.getConversation(clean(input.conversationId));
    const existingAvatarUrl = clean(current?.avatarUrl);
    const expectedPlatform = clean(input.platform || (input.jid ? 'whatsapp' : platformFromSource(input.source)));
    const existingCache = existingAvatarUrl ? this.validateCachedAvatar(existingAvatarUrl, { expectedPlatform }) : { valid: false };
    const confirmedRemoved = input.confirmedRemoved === true;
    // A 403, privacy restriction, missing response or temporary 404 is not proof
    // that the person deliberately removed the photo. Preserve a known-good cache,
    // but clear a stale database URL whose local cache file is already missing/corrupt.
    const preserveExisting = !confirmedRemoved && existingAvatarUrl && existingCache.valid;
    const clearBrokenCache = Boolean(existingAvatarUrl && !existingCache.valid);
    const shouldClear = confirmedRemoved || clearBrokenCache;
    await this.persistAvatarState(input.conversationId, {
      ...(shouldClear ? { clearAvatar: true, avatarUrl: '' } : {}),
      avatarStatus: status,
      avatarUpdatedAt: nowIso(),
      avatarLastError: status,
      avatarSource: 'whatsapp-profile'
    });
    if (shouldClear && existingAvatarUrl) {
      const previousLocalFile = this.resolveLocalFile(existingAvatarUrl);
      if (previousLocalFile) {
        try { this.fs.rmSync(previousLocalFile, { force: true }); } catch (error) {
          this.logger.warn('accounts', 'avatar-cache-cleanup-failed', { accountId: clean(input.accountId), conversationId: clean(input.conversationId), stage: 'remove-confirmed-avatar', errorCode: error.code || 'cache-cleanup-failed' });
        }
      }
    }
    this.rememberRefresh(input.conversationId);
    return { status: 'unavailable', avatarStatus: status, avatarUrl: preserveExisting ? existingAvatarUrl : '' };
  }

  async syncWhatsAppContact(input = {}) {
    assertNotAborted(input.signal);
    const startedAt = Date.now();
    const candidates = [...new Set([input.jid, ...(Array.isArray(input.jidCandidates) ? input.jidCandidates : [])].map(normalizeJid).filter(Boolean))];
    const applicable = candidates.map(classifyJid).filter(row => row.applicable);
    if (!applicable.length) return { status: 'skipped', avatarStatus: 'not-applicable-invalid', jidKind: 'invalid' };
    const task = { ...input, jid: applicable[0].jid };
    const current = this.messageStore.getConversation(clean(task.conversationId));
    const priorCache = current?.avatarUrl ? this.validateCachedAvatar(current.avatarUrl, { expectedPlatform: 'whatsapp' }) : { valid: false, errorCode: 'cache-file-missing' };
    if (!this.needsRefresh(task.conversationId, task.force === true)) return { status: 'unchanged', avatarUrl: current.avatarUrl, avatarStatus: current.avatarStatus || 'ready' };
    const failures = [];
    let remoteUrl = '';
    let resolvedJid = '';
    for (let candidateIndex = 0; candidateIndex < applicable.length; candidateIndex += 1) {
      const candidate = applicable[candidateIndex];
      for (const type of ['image', 'preview']) {
        assertNotAborted(task.signal);
        try {
          const rawUrl = await withAbort(
            task.socket?.profilePictureUrl?.(candidate.jid, type, this.profileUrlTimeoutMs),
            task.signal
          );
          remoteUrl = clean(rawUrl);
          if (remoteUrl) { resolvedJid = candidate.jid; break; }
          this.logger.warn('accounts', 'avatar-profile-picture-url-empty', {
            accountId: clean(task.accountId),
            conversationId: clean(task.conversationId),
            contactId: clean(task.contactId),
            jidHash: jidHash(candidate.jid),
            jidKind: candidate.kind,
            candidateIndex,
            candidateCount: applicable.length,
            type,
            timeoutMs: this.profileUrlTimeoutMs,
            profilePicPrivacyToken: task.socket?.serverProps?.profilePicPrivacyToken === true,
            reason: clean(task.reason) || 'avatar-sync'
          });
        } catch (error) {
          failures.push({ candidate: candidate.jid, type, error, mapped: mapFailure(error) });
        }
      }
      if (remoteUrl) break;
    }
    if (!remoteUrl) {
      assertNotAborted(task.signal);
      const firstUnexpected = failures.find(row => !['http-403', 'http-404'].includes(row.mapped.errorCode));
      if (firstUnexpected) {
        const mapped = this.recordFailure({ ...task, jid: firstUnexpected.candidate }, firstUnexpected.error, 'profile-picture-url', 1, startedAt);
        try { await this.persistAvatarState(task.conversationId, { avatarStatus: mapped.errorCode, avatarUpdatedAt: nowIso(), avatarLastError: mapped.errorCode, avatarTriedJids: applicable.map(row => row.jid) }); } catch (databaseError) { this.recordFailure(task, databaseError, 'database-update', 1, startedAt); }
        return { status: 'failed', avatarStatus: mapped.errorCode, errorCode: mapped.errorCode, httpStatus: mapped.httpStatus };
      }
      const allForbidden = failures.length && failures.every(row => row.mapped.errorCode === 'http-403');
      const status = allForbidden ? 'privacy-restricted' : (failures.length ? 'no-profile-photo' : 'profile-url-empty');
      return this.markUnavailable(task, status);
    }
    try {
      const cached = await this.cacheRemote({ accountId: task.accountId, conversationId: task.conversationId, url: remoteUrl, source: 'whatsapp-profile', platform: 'whatsapp', retries: Number.isInteger(task.retries) ? task.retries : 1, signal: task.signal });
      assertNotAborted(task.signal);
      await this.persistAvatarState(task.conversationId, { avatarResolvedJid: resolvedJid, avatarTriedJids: applicable.map(row => row.jid), avatarStatus: 'ready' });
      return { status: 'downloaded', ...cached, resolvedJid, cacheRepaired: Boolean(current?.avatarUrl && !priorCache.valid) };
    } catch (error) {
      if (task.signal?.aborted) throw abortError(task.signal);
      const mapped = this.recordFailure({ ...task, jid: resolvedJid || task.jid }, error, 'download-validate-persist', Number(error?.attempt || 1), startedAt);
      if (mapped.errorCode === 'http-403') return this.markUnavailable(task, 'privacy-restricted');
      if (mapped.errorCode === 'http-404') return this.markUnavailable(task, 'no-profile-photo');
      try {
        await this.persistAvatarState(task.conversationId, { avatarStatus: mapped.errorCode, avatarUpdatedAt: nowIso(), avatarLastError: mapped.errorCode, avatarResolvedJid: resolvedJid });
      } catch (databaseError) {
        this.recordFailure(task, databaseError, 'database-update', 1, startedAt);
      }
      return { status: 'failed', avatarStatus: mapped.errorCode, errorCode: mapped.errorCode, httpStatus: mapped.httpStatus };
    }
  }

  taskKey(input) { return `${clean(input.accountId)}:${clean(input.conversationId) || normalizeJid(input.jid)}`; }

  durableJobInput(input = {}) {
    const candidates = [...new Set([input.jid, ...(Array.isArray(input.jidCandidates) ? input.jidCandidates : [])]
      .map(normalizeJid).filter(Boolean))].sort();
    return {
      jobType: 'account-avatar-sync',
      platform: 'whatsapp',
      sourceAccountId: clean(input.accountId),
      conversationId: clean(input.conversationId),
      entityId: clean(input.conversationId) || candidates[0] || 'unknown-avatar',
      revision: clean(input.avatarRevision) || `avatar-v1:${candidates.join('|')}`,
      force: input.force === true,
      maxAttempts: this.avatarJobMaxAttempts,
      payload: { reason: clean(input.reason), candidateCount: candidates.length }
    };
  }

  avatarOperationScope(input = {}) {
    const durable = this.durableJobInput(input);
    return JSON.stringify([durable.sourceAccountId, durable.conversationId || durable.entityId]);
  }

  avatarOperationFingerprint(input = {}) {
    const durable = this.durableJobInput(input);
    const current = durable.conversationId ? this.messageStore.getConversation(durable.conversationId) : null;
    const anchor = clean(current?.avatarUpdatedAt || current?.avatar_updated_at) || 'initial';
    return crypto.createHash('sha256')
      .update([durable.revision, anchor, input.force === true ? 'force' : 'scheduled'].join('\u001f'))
      .digest('hex');
  }

  canonicalAvatarLease(operation = {}) {
    return Object.freeze({
      operationId: clean(operation.operationId),
      generation: Number(operation.generation || 0),
      objectFingerprint: clean(operation.objectFingerprint)
    });
  }

  maybeRecoverCanonicalAvatar(authority, operation) {
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

  acquireAvatarJob(input = {}) {
    if (this.backgroundJobs?.begin) {
      return this.backgroundJobs.begin(this.durableJobInput(input), {
        maxAttempts: this.avatarJobMaxAttempts,
        refreshAfterMs: this.refreshIntervalMs,
        force: input.force === true
      });
    }
    if (!this.useCanonicalDurability) return { acquired: true, reason: 'non-production-no-durable-authority', lease: null, job: null };

    const authority = currentRuntimeInternalOperationAuthority();
    const scopeKey = this.avatarOperationScope(input);
    let latest = authority.latest({ operationType: 'media.account-avatar-sync', scopeKey });
    if (latest && !['SUCCEEDED', 'FAILED', 'CANCELLED', 'DEAD_LETTERED'].includes(latest.state)) {
      latest = this.maybeRecoverCanonicalAvatar(authority, latest);
      if (latest.state === 'SCHEDULED') {
        const started = authority.start(latest.operationId, { progress: 1 }).operation;
        return { acquired: true, reason: 'recovered', lease: this.canonicalAvatarLease(started), job: started, operation: started };
      }
      return {
        acquired: false,
        reason: latest.state === 'RETRY_SCHEDULED' ? 'retry-wait' : 'already-running',
        lease: null,
        job: latest,
        operation: latest
      };
    }
    if (latest && ['FAILED', 'DEAD_LETTERED'].includes(latest.state) && input.force !== true) {
      return { acquired: false, reason: 'failed_final', lease: null, job: latest, operation: latest };
    }
    if (input.force !== true && !this.needsRefresh(input.conversationId, false)) {
      return { acquired: false, reason: 'already-succeeded', lease: null, job: latest, operation: latest };
    }

    const durable = this.durableJobInput(input);
    const created = authority.create({
      operationType: 'media.account-avatar-sync',
      scopeKey,
      objectFingerprint: this.avatarOperationFingerprint(input),
      maxAttempts: this.avatarJobMaxAttempts,
      metadata: {
        accountId: durable.sourceAccountId,
        resultReference: durable.conversationId || durable.entityId
      }
    });
    let operation = this.maybeRecoverCanonicalAvatar(authority, created.operation);
    if (operation.state === 'SCHEDULED') {
      operation = authority.start(operation.operationId, { progress: 1 }).operation;
      return { acquired: true, reason: created.created ? 'created' : 'scheduled', lease: this.canonicalAvatarLease(operation), job: operation, operation };
    }
    return {
      acquired: false,
      reason: operation.state === 'SUCCEEDED' ? 'already-succeeded'
        : operation.state === 'RETRY_SCHEDULED' ? 'retry-wait'
          : operation.state === 'RUNNING' ? 'already-running'
            : ['FAILED', 'DEAD_LETTERED'].includes(operation.state) ? 'failed_final'
              : clean(operation.state).toLowerCase(),
      lease: null,
      job: operation,
      operation
    };
  }

  failAvatarJob(lease, error, options = {}) {
    if (!lease) return null;
    if (this.backgroundJobs?.fail) {
      return this.backgroundJobs.fail(lease, error, {
        retryable: options.retryable === true,
        maxAttempts: this.avatarJobMaxAttempts,
        retryDelayMs: this.avatarRetryDelayMs,
        payload: { stage: clean(options.stage || 'avatar-sync') }
      });
    }
    if (!this.useCanonicalDurability || !lease.operationId) return null;
    const errorCode = clean(error?.code || error?.errorCode || error || 'AVATAR_SYNC_FAILED').toUpperCase();
    return currentRuntimeInternalOperationAuthority().fail(lease.operationId, { errorCode }, {
      retryable: options.retryable === true,
      retryDelayMs: this.avatarRetryDelayMs,
      generation: lease.generation,
      objectFingerprint: lease.objectFingerprint,
      reasonCode: errorCode
    });
  }

  succeedAvatarJob(lease, result = {}) {
    if (!lease) return null;
    if (this.backgroundJobs?.succeed) return this.backgroundJobs.succeed(lease, result);
    if (!this.useCanonicalDurability || !lease.operationId) return null;
    return currentRuntimeInternalOperationAuthority().succeed(lease.operationId, {
      status: clean(result.status || 'completed'),
      reasonCode: clean(result.avatarStatus || '')
    }, {
      generation: lease.generation,
      objectFingerprint: lease.objectFingerprint
    });
  }

  suppressedAvatarResult(input, decision) {
    const current = clean(input.conversationId) ? this.messageStore.getConversation(clean(input.conversationId)) : null;
    if (decision.reason === 'already-succeeded') {
      return { status: 'unchanged', avatarUrl: clean(current?.avatarUrl), avatarStatus: clean(current?.avatarStatus) || 'ready', backgroundJobState: decision.job?.state, suppressed: true };
    }
    if (decision.reason === 'retry-wait' || decision.reason === 'already-running') {
      return { status: 'deferred', avatarUrl: clean(current?.avatarUrl), avatarStatus: clean(current?.avatarStatus) || 'retry-wait', backgroundJobState: decision.job?.state, nextRetryAt: clean(decision.job?.nextRetryAt), suppressed: true };
    }
    return { status: 'failed', avatarUrl: clean(current?.avatarUrl), avatarStatus: clean(current?.avatarStatus) || 'failed-final', errorCode: clean(decision.job?.lastErrorCode) || decision.reason, backgroundJobState: decision.job?.state, suppressed: true };
  }

  enqueueWhatsApp(input = {}) {
    assertNotAborted(input.signal);
    const key = this.taskKey(input);
    if (this.inFlight.has(key)) return this.inFlight.get(key);
    const promise = Promise.resolve().then(() => {
      const decision = this.acquireAvatarJob(input);
      if (!decision.acquired) return this.suppressedAvatarResult(input, decision);
      return new Promise((resolve, reject) => {
        this.queue.push({ input, resolve, reject, key, lease: decision?.lease || null });
        this.pump();
      });
    }).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, promise);
    return promise;
  }

  async runQueuedJob(job) {
    try {
      const result = await this.syncWhatsAppContact(job.input);
      if (job.lease) {
        if (result?.status === 'failed') {
          const failed = this.failAvatarJob(job.lease, { code: result.errorCode || result.avatarStatus || 'AVATAR_SYNC_FAILED' }, {
            retryable: avatarFailureRetryable(result.errorCode || result.avatarStatus),
            stage: 'avatar-sync-result'
          });
          const operation = failed?.operation || failed?.job || null;
          return { ...result, backgroundJobState: operation?.state || failed?.state || '', nextRetryAt: operation?.nextAttemptAt || failed?.nextRetryAt || '' };
        }
        const succeeded = this.succeedAvatarJob(job.lease, { status: result?.status || 'completed', avatarStatus: result?.avatarStatus || '' });
        return { ...result, backgroundJobState: succeeded?.operation?.state || succeeded?.job?.state || 'SUCCEEDED' };
      }
      return result;
    } catch (error) {
      if (job.lease) this.failAvatarJob(job.lease, error, {
        retryable: avatarFailureRetryable(error),
        stage: 'queue-unhandled'
      });
      throw error;
    }
  }

  pump() {
    while (this.active < this.concurrency && this.queue.length) {
      const job = this.queue.shift();
      this.active += 1;
      this.runQueuedJob(job).then(job.resolve, job.reject).finally(() => {
        this.active -= 1;
        this.pump();
      });
    }
  }

  async syncWhatsAppContacts(inputs = [], options = {}) {
    const rows = Array.isArray(inputs) ? inputs : [];
    const signal = options.signal || null;
    const executionGeneration = clean(options.executionGeneration);
    const stats = {
      contactsScanned: rows.length,
      avatarsRequested: 0,
      avatarsDownloaded: 0,
      avatarsUnchanged: 0,
      avatarsUnavailable: 0,
      avatarsFailed: 0,
      cacheRepaired: 0
    };
    const results = new Array(rows.length);
    let cursor = 0;
    const worker = async () => {
      while (true) {
        assertNotAborted(signal);
        const index = cursor;
        cursor += 1;
        if (index >= rows.length) return;
        const input = { ...rows[index], signal: rows[index]?.signal || signal, executionGeneration: clean(rows[index]?.executionGeneration) || executionGeneration };
        const classified = classifyJid(input.jid);
        if (classified.applicable) stats.avatarsRequested += 1;
        try {
          results[index] = await this.enqueueWhatsApp(input);
        } catch (error) {
          if (signal?.aborted || input.signal?.aborted || /_ABORTED$/u.test(clean(error?.code))) throw abortError(input.signal || signal, clean(error?.code) || 'AVATAR_SYNC_ABORTED');
          results[index] = { status: 'failed', errorCode: mapFailure(error).errorCode };
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.concurrency, Math.max(1, rows.length)) }, () => worker()));
    for (const result of results) {
      if (result.status === 'downloaded') stats.avatarsDownloaded += 1;
      else if (result.status === 'unchanged') stats.avatarsUnchanged += 1;
      else if (result.status === 'unavailable') stats.avatarsUnavailable += 1;
      else if (result.status === 'failed') stats.avatarsFailed += 1;
      if (result.cacheRepaired) stats.cacheRepaired += 1;
    }
    return { ...stats, results };
  }

  async bestEffort(input = {}) {
    const current = clean(input.conversationId) ? this.messageStore.getConversation(clean(input.conversationId)) : null;
    if (!this.needsRefresh(input.conversationId, input.force === true)) return current?.avatarUrl || '';
    try {
      const result = input.buffer ? await this.cacheBuffer(input) : input.url ? await this.cacheRemote(input) : null;
      return result?.avatarUrl || '';
    } catch (error) {
      this.recordFailure(input, error, input.buffer ? 'buffer-validate-persist' : 'download-validate-persist', 1, Date.now());
      return '';
    }
  }

  snapshot() { return { concurrency: this.concurrency, active: this.active, queued: this.queue.length, deduplicatedKeys: this.inFlight.size }; }
}

const service = new AvatarSyncService();

module.exports = {
  AvatarSyncService,
  cacheBuffer: input => service.cacheBuffer(input).then(result => result.avatarUrl),
  cacheRemote: input => service.cacheRemote(input).then(result => result.avatarUrl),
  cacheStandaloneBuffer: input => service.cacheStandaloneBuffer(input),
  cacheStandaloneRemote: input => service.cacheStandaloneRemote(input),
  bestEffort: input => service.bestEffort(input),
  needsRefresh: (conversationId, force) => service.needsRefresh(conversationId, force),
  enqueueWhatsApp: input => service.enqueueWhatsApp(input),
  syncWhatsAppContacts: (inputs, options = {}) => service.syncWhatsAppContacts(inputs, options),
  validateBuffer: (buffer, options = {}) => service.validateBuffer(buffer, options),
  validateCachedAvatar: (url, options = {}) => service.validateCachedAvatar(url, options),
  snapshot: () => service.snapshot(),
  classifyJid,
  normalizeJid,
  detectImageType,
  avatarFailureRetryable,
  mapFailure,
  MAX_AVATAR_BYTES,
  REFRESH_INTERVAL_MS,
  DEFAULT_CONCURRENCY
};
