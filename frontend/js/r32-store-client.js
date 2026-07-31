(() => {
'use strict';

const DEFAULT_DOMAINS = [
  'auth',
  'ui',
  'customers',
  'conversations',
  'typingState',
  'relationships',
  'memories',
  'interactionPolicies',
  'models',
  'routing',
  'aiBrain',
  'outbox',
  'system'
];

const REFRESH_MIN_INTERVAL_MS = 400;
const REFRESH_RETRY_BASE_MS = 1500;
const REFRESH_RETRY_MAX_MS = 30000;
const SOCIAL_CONTEXT_CACHE_MS = 500;

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function immutable(value) {
  return deepFreeze(clone(value));
}

function shallowEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every(key => Object.prototype.hasOwnProperty.call(right, key) && Object.is(left[key], right[key]));
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body != null ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  let payload;
  try { payload = await response.json(); }
  catch (cause) {
    const error = new Error('StoreManager 返回了无法解析的响应');
    error.code = 'STORE_INVALID_RESPONSE';
    error.status = response.status;
    error.cause = cause;
    throw error;
  }
  if (!payload || typeof payload !== 'object') {
    const error = new Error('StoreManager 返回了无效响应');
    error.code = 'STORE_INVALID_RESPONSE';
    error.status = response.status;
    throw error;
  }
  if (!response.ok || payload.ok === false) {
    if (window.YanceRuntimeErrors?.createError) throw window.YanceRuntimeErrors.createError(payload, { status: response.status, rootObject: window, reasonCode: 'STORE_REQUEST_FAILED', fallback: `请求失败（HTTP ${response.status}）` });
    const error = new Error(typeof payload.error === 'string' ? payload.error : (payload.message || `请求失败（HTTP ${response.status}）`));
    error.code = payload.code || payload.error?.reasonCode || 'STORE_REQUEST_FAILED';
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

class StoreClient {
  constructor(options = {}) {
    this._domains = new Set(options.domains || DEFAULT_DOMAINS);
    this._state = immutable({ meta: { hydrated: false, stateVersion: 0, domainVersions: {} } });
    this._subscribers = new Map();
    this._listeners = new Set();
    this._started = false;
    this._startPromise = null;
    this._refreshTimer = null;
    this._pendingDomains = new Set();
    this._refreshPromise = null;
    this._removeDesktopListener = null;
    this._retryTimer = null;
    this._lastEventId = '';
    this._connectionState = 'idle';
    this._lastRefreshStartedAt = 0;
    this._rateLimitUntil = 0;
    this._consecutiveFailures = 0;
    this._pendingEventType = '';
    this._socialContextInFlight = new Map();
    this._socialContextCache = new Map();
  }

  get stateVersion() {
    return Number(this._state?.meta?.stateVersion || 0);
  }

  get hydrated() {
    return this._state?.meta?.hydrated === true;
  }

  get connectionState() {
    return this._connectionState;
  }

  snapshot() {
    return immutable(this._state);
  }

  select(selector, ...args) {
    if (typeof selector !== 'function') throw new TypeError('Store selector must be a function');
    return deepFreeze(selector(this._state, ...args));
  }

  subscribe(selector, listener, options = {}) {
    if (typeof selector !== 'function' || typeof listener !== 'function') {
      throw new TypeError('Store selector and listener are required');
    }
    const id = globalThis.crypto?.randomUUID?.() || `sub-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const equality = typeof options.equality === 'function' ? options.equality : shallowEqual;
    const current = this.select(selector);
    this._subscribers.set(id, { selector, listener, equality, current });
    if (options.fireImmediately !== false) {
      queueMicrotask(() => {
        if (!this._subscribers.has(id)) return;
        this._safeNotify(listener, current, undefined, {
          eventType: 'store.subscription.initial',
          stateVersion: this.stateVersion
        });
      });
    }
    return () => this._subscribers.delete(id);
  }

  onEvent(listener) {
    if (typeof listener !== 'function') return () => {};
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  async start() {
    if (this._started && this.hydrated) return this.snapshot();
    if (this._startPromise) return this._startPromise;
    this._started = true;
    this._connectionState = 'starting';
    this._installEventBridge();
    this._startPromise = this.refresh([...this._domains], { force: true })
      .then(snapshot => {
        this._connectionState = 'ready';
        return snapshot;
      })
      .catch(error => {
        this._connectionState = 'degraded';
        this._scheduleRetry();
        throw error;
      })
      .finally(() => {
        this._startPromise = null;
      });
    return this._startPromise;
  }

  stop() {
    this._started = false;
    this._connectionState = 'stopped';
    if (this._refreshTimer) clearTimeout(this._refreshTimer);
    if (this._retryTimer) clearTimeout(this._retryTimer);
    this._refreshTimer = null;
    this._retryTimer = null;
    this._removeDesktopListener?.();
    this._removeDesktopListener = null;
    this._subscribers.clear();
    this._listeners.clear();
    this._socialContextInFlight.clear();
    this._socialContextCache.clear();
  }

  async refresh(domains = DEFAULT_DOMAINS, options = {}) {
    const requested = [...new Set((domains || []).map(clean).filter(domain => this._domains.has(domain)))];
    if (!requested.length) requested.push(...this._domains);
    if (this._refreshPromise) {
      requested.forEach(domain => this._pendingDomains.add(domain));
      if (options.eventType) this._pendingEventType = options.eventType;
      return this._refreshPromise;
    }
    const now = Date.now();
    const notBefore = Math.max(
      this._rateLimitUntil,
      this._lastRefreshStartedAt ? this._lastRefreshStartedAt + REFRESH_MIN_INTERVAL_MS : 0
    );
    if (now < notBefore) {
      requested.forEach(domain => this._pendingDomains.add(domain));
      if (options.eventType) this._pendingEventType = options.eventType;
      this._scheduleRefresh([], notBefore - now, options.eventType || 'store.refresh.coalesced');
      return this.snapshot();
    }
    this._lastRefreshStartedAt = now;
    const query = encodeURIComponent(requested.join(','));
    const snapshotRequest = window.yanceDesktop?.storeSnapshot
      ? window.yanceDesktop.storeSnapshot({ domains: requested })
      : requestJson(`/api/r32/store/snapshot?domains=${query}`);
    this._refreshPromise = snapshotRequest
      .then(payload => {
        const incoming = payload.snapshot || {};
        const nextVersion = Number(payload.stateVersion || incoming.meta?.stateVersion || 0);
        if (!options.force && nextVersion < this.stateVersion) return this.snapshot();
        const previous = this._state;
        const merged = {
          ...clone(previous),
          ...clone(incoming),
          meta: {
            ...(previous.meta || {}),
            ...(incoming.meta || {}),
            hydrated: true,
            stateVersion: nextVersion
          }
        };
        this._state = immutable(merged);
        this._connectionState = 'ready';
        this._consecutiveFailures = 0;
        this._rateLimitUntil = 0;
        if (this._retryTimer) clearTimeout(this._retryTimer);
        this._retryTimer = null;
        this._notifySubscribers(previous, {
          eventType: options.eventType || 'store.snapshot.refreshed',
          stateVersion: this.stateVersion,
          domains: requested
        });
        this._emit({
          eventType: options.eventType || 'store.snapshot.refreshed',
          stateVersion: this.stateVersion,
          domains: requested
        });
        return this.snapshot();
      })
      .catch(error => {
        this._connectionState = 'degraded';
        this._consecutiveFailures += 1;
        const retryAfterMs = Math.max(0, Number(error?.retryAfterMs || 0));
        if (Number(error?.status || 0) === 429 || clean(error?.code || error?.reasonCode).toUpperCase() === 'RATE_LIMITED') {
          this._rateLimitUntil = Math.max(this._rateLimitUntil, Date.now() + Math.max(1000, retryAfterMs || REFRESH_RETRY_BASE_MS));
        }
        this._emit({ eventType: 'store.snapshot.failed', error, domains: requested, stateVersion: this.stateVersion });
        this._scheduleRetry(error);
        throw error;
      })
      .finally(() => {
        this._refreshPromise = null;
        if (this._pendingDomains.size) {
          const pending = [...this._pendingDomains];
          this._pendingDomains.clear();
          const pendingEventType = this._pendingEventType;
          this._pendingEventType = '';
          this._scheduleRefresh(pending, REFRESH_MIN_INTERVAL_MS, pendingEventType || 'store.event.resync');
        }
      });
    return this._refreshPromise;
  }

  async getCustomerSocialContext(contactId, options = {}) {
    const id = clean(contactId);
    if (!id) throw new Error('contactId is required');
    const cacheKey = `${id}:${Number(options.timelineLimit || 24)}:${Number(options.recentMessageLimit || 60)}`;
    const cached = this._socialContextCache.get(cacheKey);
    if (options.force !== true && cached && Date.now() - cached.at < SOCIAL_CONTEXT_CACHE_MS) return cached.value;
    if (this._socialContextInFlight.has(cacheKey)) return this._socialContextInFlight.get(cacheKey);
    if (Date.now() < this._rateLimitUntil) {
      if (cached) return cached.value;
      const error = new Error('Local API rate limit is cooling down');
      error.code = 'RATE_LIMITED';
      error.reasonCode = 'RATE_LIMITED';
      error.status = 429;
      error.retryAfterMs = Math.max(1000, this._rateLimitUntil - Date.now());
      throw error;
    }
    const query = new URLSearchParams({
      timelineLimit: String(options.timelineLimit || 24),
      recentMessageLimit: String(options.recentMessageLimit || 60)
    });
    const request = Promise.resolve(window.yanceDesktop?.storeSocialContext
      ? window.yanceDesktop.storeSocialContext({ contactId: id, timelineLimit: options.timelineLimit || 24, recentMessageLimit: options.recentMessageLimit || 60 })
      : requestJson(`/api/r32/store/customers/${encodeURIComponent(id)}/social-context?${query}`))
      .then(payload => {
        const value = immutable(payload.context);
        this._socialContextCache.set(cacheKey, { at: Date.now(), value });
        return value;
      })
      .catch(error => {
        if (Number(error?.status || 0) === 429 || clean(error?.code || error?.reasonCode).toUpperCase() === 'RATE_LIMITED') {
          this._rateLimitUntil = Math.max(this._rateLimitUntil, Date.now() + Math.max(1000, Number(error?.retryAfterMs || 0) || REFRESH_RETRY_BASE_MS));
          if (cached) return cached.value;
        }
        throw error;
      })
      .finally(() => this._socialContextInFlight.delete(cacheKey));
    this._socialContextInFlight.set(cacheKey, request);
    return request;
  }

  async generateReplyCandidate(input = {}) {
    const body = {
      contactId: input.contactId,
      conversationId: input.conversationId,
      incomingMessage: input.incomingMessage || {},
      modelId: input.modelId,
      temperature: input.temperature,
      maxTokens: input.maxTokens,
      replyTask: input.replyTask,
      performanceMode: input.performanceMode,
      aggregateIncoming: input.aggregateIncoming !== false,
      source: input.source,
      manualText: input.manualText,
      contextMessageIds: Array.isArray(input.contextMessageIds) ? input.contextMessageIds : [],
      director: input.director || {}
    };
    const payload = window.yanceDesktop?.storeGenerateReply
      ? await window.yanceDesktop.storeGenerateReply(body, { signal: input.signal })
      : await requestJson('/api/r32/store/replies/generate', { method: 'POST', body: JSON.stringify(body), signal: input.signal });
    return immutable(payload.candidate);
  }


  async translateToChinese(input = {}) {
    const body = {
      text: input.text,
      sourceLanguage: input.sourceLanguage || input.language || 'auto',
      modelId: input.modelId,
      timeoutMs: input.timeoutMs,
      dedupeKey: input.dedupeKey,
      fingerprint: input.fingerprint
    };
    const payload = await requestJson('/api/r32/store/translations/chinese', { method: 'POST', body: JSON.stringify(body) });
    return immutable(payload.translation);
  }

  async translateMessage(messageId, input = {}) {
    const payload = await requestJson(`/api/r32/store/translations/messages/${encodeURIComponent(messageId)}`, {
      method: 'POST',
      body: JSON.stringify({ force: input.force === true, timeoutMs: input.timeoutMs })
    });
    return immutable(payload);
  }

  async searchWorkspace(query, input = {}) {
    const params = new URLSearchParams({
      q: String(query || '').trim(),
      limit: String(input.limit || 80)
    });
    const payload = await requestJson(`/api/r32/store/search?${params}`);
    return immutable({ contacts: payload.contacts || [], messages: payload.messages || [], query: payload.query || '' });
  }

  async createTranslationJob(messageId, input = {}) {
    const payload = await requestJson(`/api/r32/store/translations/messages/${encodeURIComponent(messageId)}/jobs`, {
      method: 'POST',
      body: JSON.stringify({ force: input.force === true, forceNew: input.forceNew === true, timeoutMs: input.timeoutMs })
    });
    return immutable(payload.job);
  }

  async getTranslationJob(jobId) {
    const payload = await requestJson(`/api/r32/store/translations/jobs/${encodeURIComponent(jobId)}`);
    return immutable(payload.job);
  }

  async cancelTranslationJob(jobId) {
    const payload = await requestJson(`/api/r32/store/translations/jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE' });
    return immutable(payload.job);
  }

  async retryTranslationJob(jobId, input = {}) {
    const payload = await requestJson(`/api/r32/store/translations/jobs/${encodeURIComponent(jobId)}/retry`, {
      method: 'POST',
      body: JSON.stringify({ timeoutMs: input.timeoutMs })
    });
    return immutable(payload.job);
  }

  async translateStructured(input = {}) {
    const payload = await requestJson('/api/r32/store/translations/structured', {
      method: 'POST',
      body: JSON.stringify(input)
    });
    return immutable(payload.translation);
  }

  async getLearningGovernance(contactId, input = {}) {
    const query = new URLSearchParams({
      eventLimit: String(input.eventLimit || 100),
      versionLimit: String(input.versionLimit || 30)
    });
    const payload = await requestJson(`/api/r32/store/customers/${encodeURIComponent(contactId)}/learning-governance?${query}`);
    return immutable(payload.governance);
  }

  async updateLearningPreference(contactId, scopeType, key, action, input = {}) {
    const payload = await requestJson(`/api/r32/store/customers/${encodeURIComponent(contactId)}/learning-governance/${encodeURIComponent(scopeType)}/preferences/${encodeURIComponent(key)}`, {
      method: 'PATCH',
      body: JSON.stringify({ action, actor: input.actor || 'user' })
    });
    return immutable(payload.governance);
  }

  async restoreLearningScope(contactId, scopeType, version, input = {}) {
    const payload = await requestJson(`/api/r32/store/customers/${encodeURIComponent(contactId)}/learning-governance/${encodeURIComponent(scopeType)}/restore`, {
      method: 'POST',
      body: JSON.stringify({ version, actor: input.actor || 'user' })
    });
    return immutable(payload.governance);
  }

  async forgetReplyLearning(contactId, input = {}) {
    const payload = await requestJson(`/api/r32/store/customers/${encodeURIComponent(contactId)}/learning-governance/forget`, {
      method: 'DELETE',
      body: JSON.stringify({ confirmForget: input.confirmForget === true, actor: input.actor || 'user' })
    });
    return immutable(payload.governance);
  }

  async getContactLanguage(contactId, input = {}) {
    const query = new URLSearchParams();
    for (const key of ['conversationId', 'platform', 'sourceAccountId', 'platformContactIdentity', 'canonicalContactId']) {
      if (input[key]) query.set(key, String(input[key]));
    }
    const suffix = query.size ? `?${query}` : '';
    const payload = await requestJson(`/api/r32/store/customers/${encodeURIComponent(contactId)}/language${suffix}`);
    return immutable(payload.languageProfile);
  }

  async setContactLanguage(contactId, language, input = {}) {
    const payload = await requestJson(`/api/r32/store/customers/${encodeURIComponent(contactId)}/language`, {
      method: 'PUT',
      body: JSON.stringify({
        language,
        conversationId: input.conversationId,
        platform: input.platform,
        sourceAccountId: input.sourceAccountId,
        platformContactIdentity: input.platformContactIdentity,
        canonicalContactId: input.canonicalContactId
      })
    });
    return immutable(payload.languageProfile);
  }

  async approveReplyCandidate(candidateId, input = {}) {
    const body = {
      candidateId,
      text: input.text,
      userApproved: input.userApproved === true,
      approvedBy: input.approvedBy || 'user',
      learningMode: input.learningMode || 'send_and_learn',
      source: input.source || 'local_model'
    };
    const payload = window.yanceDesktop?.storeApproveReply
      ? await window.yanceDesktop.storeApproveReply(body)
      : await requestJson(`/api/r32/store/replies/${encodeURIComponent(candidateId)}/approve`, { method: 'POST', body: JSON.stringify(body) });
    return immutable(payload);
  }

  async rejectReplyCandidate(candidateId, reason = '') {
    const body = { candidateId, reason };
    return immutable(window.yanceDesktop?.storeRejectReply
      ? await window.yanceDesktop.storeRejectReply(body)
      : await requestJson(`/api/r32/store/replies/${encodeURIComponent(candidateId)}/reject`, { method: 'POST', body: JSON.stringify(body) }));
  }

  async recordCandidateInteraction(candidateId, input = {}) {
    const body = {
      signalType: input.signalType,
      interactionId: input.interactionId || globalThis.crypto?.randomUUID?.() || `candidate-interaction-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      interactionMode: input.interactionMode || '',
      finalText: input.finalText || '',
      adjustments: Array.isArray(input.adjustments) ? input.adjustments : [],
      observedAt: input.observedAt || new Date().toISOString()
    };
    return immutable(await requestJson(`/api/r32/store/replies/${encodeURIComponent(candidateId)}/interactions`, {
      method: 'POST', body: JSON.stringify(body)
    }));
  }

  async reviseOutboxText(outboxId, text) {
    const body = { outboxId, text, userConfirmedRevision: true };
    return immutable(window.yanceDesktop?.storeReviseOutbox
      ? await window.yanceDesktop.storeReviseOutbox(body)
      : await requestJson(`/api/r32/store/outbox/${encodeURIComponent(outboxId)}/text`, { method: 'PATCH', body: JSON.stringify(body) }));
  }

  async confirmOutboxSend(outboxId, confirmSend, input = {}) {
    const body = { outboxId, confirmSend: confirmSend === true, quoted: input.quoted || null };
    return immutable(window.yanceDesktop?.storeConfirmSend
      ? await window.yanceDesktop.storeConfirmSend(body)
      : await requestJson(`/api/r32/store/outbox/${encodeURIComponent(outboxId)}/send`, { method: 'POST', body: JSON.stringify(body) }));
  }

  async setReadingMode(readingMode, density, contrastMode) {
    const body = { readingMode, density, contrastMode };
    return immutable(window.yanceDesktop?.storeSetReadingMode
      ? await window.yanceDesktop.storeSetReadingMode(body)
      : await requestJson('/api/r32/store/ui/reading-mode', { method: 'PUT', body: JSON.stringify(body) }));
  }


  async previewTheme(themeId) {
    const body = { themeId };
    return immutable(window.yanceDesktop?.storePreviewTheme
      ? await window.yanceDesktop.storePreviewTheme(body)
      : await requestJson('/api/r32/store/ui/theme/preview', { method: 'PUT', body: JSON.stringify(body) }));
  }

  async cancelThemePreview() {
    return immutable(window.yanceDesktop?.storeCancelThemePreview
      ? await window.yanceDesktop.storeCancelThemePreview()
      : await requestJson('/api/r32/store/ui/theme/cancel-preview', { method: 'PUT', body: '{}' }));
  }

  async applyTheme(themeId) {
    const body = { themeId };
    return immutable(window.yanceDesktop?.storeApplyTheme
      ? await window.yanceDesktop.storeApplyTheme(body)
      : await requestJson('/api/r32/store/ui/theme/apply', { method: 'PUT', body: JSON.stringify(body) }));
  }

  async setMotionLevel(motionLevel) {
    const body = { motionLevel };
    return immutable(window.yanceDesktop?.storeSetMotionLevel
      ? await window.yanceDesktop.storeSetMotionLevel(body)
      : await requestJson('/api/r32/store/ui/motion-level', { method: 'PUT', body: JSON.stringify(body) }));
  }

  async setBackgroundEffect(backgroundEffect) {
    const body = { backgroundEffect };
    return immutable(window.yanceDesktop?.storeSetBackgroundEffect
      ? await window.yanceDesktop.storeSetBackgroundEffect(body)
      : await requestJson('/api/r32/store/ui/background-effect', { method: 'PUT', body: JSON.stringify(body) }));
  }

  async updateThemePreferences(input = {}) {
    return immutable(await requestJson('/api/r32/store/ui/theme/preferences', { method: 'PUT', body: JSON.stringify(input || {}) }));
  }

  async saveCustomThemePreset(input = {}) {
    return immutable(await requestJson('/api/r32/store/ui/theme/presets', { method: 'POST', body: JSON.stringify(input || {}) }));
  }

  async applyCustomThemePreset(presetId) {
    return immutable(await requestJson(`/api/r32/store/ui/theme/presets/${encodeURIComponent(String(presetId || ''))}/apply`, { method: 'POST', body: '{}' }));
  }

  async deleteCustomThemePreset(presetId) {
    return immutable(await requestJson(`/api/r32/store/ui/theme/presets/${encodeURIComponent(String(presetId || ''))}`, { method: 'DELETE' }));
  }

  async getReplyFeedback(contactId, options = {}) {
    const query = new URLSearchParams({
      limit: String(Math.max(1, Math.min(200, Number(options.limit || 50)))),
      versionLimit: String(Math.max(1, Math.min(50, Number(options.versionLimit || 20))))
    });
    return immutable(await requestJson(`/api/r32/store/customers/${encodeURIComponent(contactId)}/reply-feedback?${query}`));
  }

  async resetReplyFeedback(contactId) {
    return immutable(await requestJson(`/api/r32/store/customers/${encodeURIComponent(contactId)}/reply-feedback`, {
      method: 'DELETE',
      body: JSON.stringify({ resetBy: 'user' })
    }));
  }

  async restoreReplyFeedback(contactId, version) {
    return immutable(await requestJson(`/api/r32/store/customers/${encodeURIComponent(contactId)}/reply-feedback/restore`, {
      method: 'POST',
      body: JSON.stringify({ version: Number(version), restoredBy: 'user' })
    }));
  }

  async correctSocialInference(contactId, input = {}) {
    const body = { contactId, ...input };
    return immutable(window.yanceDesktop?.storeCorrectInference
      ? await window.yanceDesktop.storeCorrectInference(body)
      : await requestJson(`/api/r32/store/customers/${encodeURIComponent(contactId)}/corrections`, { method: 'POST', body: JSON.stringify(body) }));
  }

  _installEventBridge() {
    if (this._removeDesktopListener || !window.yanceDesktop?.onDesktopEvent) return;
    this._removeDesktopListener = window.yanceDesktop.onDesktopEvent(event => this._handleDesktopEvent(event));
  }

  _handleDesktopEvent(wrapper) {
    if (!wrapper || typeof wrapper !== 'object') return;
    if (wrapper.type === 'store:ready') {
      this._scheduleRefresh([...this._domains], 0);
      return;
    }
    if (wrapper.type === 'ai:reply-progress') {
      this._emit({ eventType: 'ai.reply.progress', payload: wrapper.payload || {}, stateVersion: this.stateVersion });
      return;
    }
    if (wrapper.type !== 'store:event') return;
    const event = wrapper.payload || {};
    if (!event.eventId || event.eventId === this._lastEventId) return;
    this._lastEventId = event.eventId;
    const incomingVersion = Number(event.stateVersion || 0);
    if (incomingVersion && incomingVersion <= this.stateVersion) return;
    const domain = clean(event.domain);
    const versionGap = incomingVersion > this.stateVersion + 1;
    const domains = versionGap || !this._domains.has(domain) ? [...this._domains] : [domain];
    this._emit(event);
    this._scheduleRefresh(domains, ['critical','high'].includes(event.priority) ? 0 : 35, event.eventType);
  }

  _scheduleRefresh(domains, delay = 35, eventType = '') {
    (domains || []).forEach(domain => {
      if (this._domains.has(domain)) this._pendingDomains.add(domain);
    });
    if (eventType) this._pendingEventType = eventType;
    if (this._refreshTimer) return;
    const now = Date.now();
    const earliest = Math.max(
      now + Math.max(0, delay),
      this._rateLimitUntil,
      this._lastRefreshStartedAt ? this._lastRefreshStartedAt + REFRESH_MIN_INTERVAL_MS : 0
    );
    this._refreshTimer = setTimeout(() => {
      this._refreshTimer = null;
      const requested = [...this._pendingDomains];
      this._pendingDomains.clear();
      const pendingEventType = this._pendingEventType;
      this._pendingEventType = '';
      this.refresh(requested, { eventType: pendingEventType || eventType || 'store.event.resync' }).catch(() => {});
    }, Math.max(0, earliest - now));
  }

  _scheduleRetry(error = null) {
    if (!this._started || this._retryTimer) return;
    const retryAfterMs = Math.max(0, Number(error?.retryAfterMs || 0));
    const exponentialMs = Math.min(
      REFRESH_RETRY_MAX_MS,
      REFRESH_RETRY_BASE_MS * (2 ** Math.max(0, this._consecutiveFailures - 1))
    );
    const delay = Math.max(REFRESH_RETRY_BASE_MS, retryAfterMs, exponentialMs, this._rateLimitUntil - Date.now());
    this._retryTimer = setTimeout(() => {
      this._retryTimer = null;
      this.refresh([...this._domains], { force: true, eventType: 'store.retry' }).catch(() => {});
    }, delay);
  }

  _notifySubscribers(previous, event) {
    for (const subscription of this._subscribers.values()) {
      let next;
      try {
        next = this.select(subscription.selector);
      } catch (error) {
        this._emit({ eventType: 'store.selector.failed', error, stateVersion: this.stateVersion });
        continue;
      }
      if (subscription.equality(subscription.current, next)) continue;
      const prior = subscription.current;
      subscription.current = next;
      this._safeNotify(subscription.listener, next, prior, event);
    }
  }

  _safeNotify(listener, next, previous, event) {
    try {
      listener(next, previous, event);
    } catch (error) {
      console.error('[言策 StoreClient subscriber]', error);
    }
  }

  _emit(event) {
    for (const listener of this._listeners) {
      try { listener(event); } catch (error) { console.error('[言策 StoreClient event]', error); }
    }
  }
}

function selectCurrentCustomer(state) {
  const id = clean(state.customers?.currentId);
  return id ? state.customers?.byId?.[id] || null : null;
}

function selectCustomerSocialSummary(contactId) {
  const id = clean(contactId);
  return state => ({
    customer: state.customers?.byId?.[id] || null,
    relationship: state.relationships?.byContactId?.[id] || null,
    memory: state.memories?.byContactId?.[id] || null,
    interactionPolicy: state.interactionPolicies?.byContactId?.[id] || null,
    stateVersion: Number(state.meta?.stateVersion || 0)
  });
}

const client = new StoreClient();
window.YanceStoreClient = Object.freeze({
  start: () => client.start(),
  stop: () => client.stop(),
  refresh: (domains, options) => client.refresh(domains, options),
  select: (selector, ...args) => client.select(selector, ...args),
  snapshot: () => client.snapshot(),
  subscribe: (selector, listener, options) => client.subscribe(selector, listener, options),
  onEvent: listener => client.onEvent(listener),
  get stateVersion() { return client.stateVersion; },
  get hydrated() { return client.hydrated; },
  get connectionState() { return client.connectionState; },
  getCustomerSocialContext: (contactId, options) => client.getCustomerSocialContext(contactId, options),
  generateReplyCandidate: input => client.generateReplyCandidate(input),
  translateToChinese: input => client.translateToChinese(input),
  translateMessage: (messageId, input) => client.translateMessage(messageId, input),
  searchWorkspace: (query, input) => client.searchWorkspace(query, input),
  createTranslationJob: (messageId, input) => client.createTranslationJob(messageId, input),
  getTranslationJob: jobId => client.getTranslationJob(jobId),
  cancelTranslationJob: jobId => client.cancelTranslationJob(jobId),
  retryTranslationJob: (jobId, input) => client.retryTranslationJob(jobId, input),
  translateStructured: input => client.translateStructured(input),
  getLearningGovernance: (contactId, input) => client.getLearningGovernance(contactId, input),
  updateLearningPreference: (contactId, scopeType, key, action, input) => client.updateLearningPreference(contactId, scopeType, key, action, input),
  restoreLearningScope: (contactId, scopeType, version, input) => client.restoreLearningScope(contactId, scopeType, version, input),
  forgetReplyLearning: (contactId, input) => client.forgetReplyLearning(contactId, input),
  getContactLanguage: contactId => client.getContactLanguage(contactId),
  setContactLanguage: (contactId, language) => client.setContactLanguage(contactId, language),
  approveReplyCandidate: (candidateId, input) => client.approveReplyCandidate(candidateId, input),
  rejectReplyCandidate: (candidateId, reason) => client.rejectReplyCandidate(candidateId, reason),
  recordCandidateInteraction: (candidateId, input) => client.recordCandidateInteraction(candidateId, input),
  reviseOutboxText: (outboxId, text) => client.reviseOutboxText(outboxId, text),
  confirmOutboxSend: (outboxId, confirmSend, input) => client.confirmOutboxSend(outboxId, confirmSend, input),
  correctSocialInference: (contactId, input) => client.correctSocialInference(contactId, input),
  setReadingMode: (readingMode, density, contrastMode) => client.setReadingMode(readingMode, density, contrastMode),
  previewTheme: themeId => client.previewTheme(themeId),
  cancelThemePreview: () => client.cancelThemePreview(),
  applyTheme: themeId => client.applyTheme(themeId),
  setMotionLevel: motionLevel => client.setMotionLevel(motionLevel),
  setBackgroundEffect: backgroundEffect => client.setBackgroundEffect(backgroundEffect),
  updateThemePreferences: input => client.updateThemePreferences(input),
  saveCustomThemePreset: input => client.saveCustomThemePreset(input),
  applyCustomThemePreset: presetId => client.applyCustomThemePreset(presetId),
  deleteCustomThemePreset: presetId => client.deleteCustomThemePreset(presetId),
  selectors: Object.freeze({
    selectCurrentCustomer,
    selectCustomerSocialSummary
  })
});

window.addEventListener('DOMContentLoaded', () => {
  client.start().catch(error => console.warn('[言策 StoreClient]', error.message || error));
}, { once: true });
})();
