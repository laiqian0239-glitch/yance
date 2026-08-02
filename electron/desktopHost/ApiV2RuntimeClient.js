'use strict';

const {
  CONTRACT_VERSION,
  assertCommandEnvelope,
  assertEventBatch,
  assertSnapshot,
  createCommandEnvelope,
  digest,
  makeError
} = require('../../shared/runtimeApiV2Contract');

function sessionIdentity(binding = {}) {
  return [binding.backendPid, binding.startupNonce, binding.backendSessionId, binding.fd6PipeInstanceId, binding.ownerSessionId || '', binding.apiSessionToken].map(value => String(value || '')).join('|');
}

class ApiV2RuntimeClient {
  constructor(options = {}) {
    if (Reflect.has(Object(options), 'authorityWriteHostCapability')) {
      throw makeError(
        'DESKTOP_WRITE_CAPABILITY_FORBIDDEN',
        'Desktop and renderer command transports must never receive a primary write-host capability',
        {},
        403
      );
    }
    this.baseURL = String(options.baseURL || '').replace(/\/$/, '');
    this.fetch = options.fetch || globalThis.fetch;
    this.sessionProvider = options.sessionProvider;
    this.expectedBuildId = String(options.expectedBuildId || '');
    this.clock = options.clock || (() => new Date().toISOString());
    this.randomUUID = options.randomUUID;
    this.defaultTimeoutMs = Math.max(250, Number(options.timeoutMs || 5000));
    this.requestSequence = 0;
    this.activeControllers = new Set();
    this.lastRequest = null;
    if (!this.baseURL || typeof this.fetch !== 'function' || typeof this.sessionProvider !== 'function') {
      throw new TypeError('ApiV2RuntimeClient requires baseURL, fetch, and sessionProvider');
    }
  }

  _binding(options = {}) {
    const binding = this.sessionProvider({ includeToken: true }) || null;
    if (!binding || !String(binding.apiSessionToken || '') || !String(binding.backendSessionId || '') || !String(binding.startupNonce || '')) {
      throw makeError('DESKTOP_API_SESSION_UNAVAILABLE', 'Backend API session binding is unavailable', {}, 503);
    }
    if (options.requireTrusted === true && binding.ownerTrusted !== true) {
      throw makeError('WP6_TRUSTED_OWNER_REQUIRED', 'Runtime projection requires a durably trusted backend owner', {}, 409);
    }
    return Object.freeze({ ...binding, apiSessionToken: String(binding.apiSessionToken) });
  }

  currentBinding(options = {}) {
    const binding = this._binding(options);
    const { apiSessionToken: _secret, ...publicBinding } = binding;
    return Object.freeze({ ...publicBinding, sessionFingerprint: digest(sessionIdentity(binding)) });
  }

  abortAll(reasonCode = 'WP6_RUNTIME_CLIENT_INVALIDATED') {
    for (const controller of this.activeControllers) {
      try { controller.abort(makeError(reasonCode, 'Runtime API request invalidated by owner/session transition', {}, 409)); } catch (_) {}
    }
    this.activeControllers.clear();
  }

  async _request(pathname, options = {}) {
    const binding = this._binding({ requireTrusted: options.requireTrusted === true });
    const identity = sessionIdentity(binding);
    const requestId = ++this.requestSequence;
    const controller = new AbortController();
    this.activeControllers.add(controller);
    const timeoutMs = Math.max(100, Number(options.timeoutMs || this.defaultTimeoutMs));
    const timer = setTimeout(() => controller.abort(makeError('TRANSPORT_OUTCOME_UNKNOWN', 'Runtime API request timed out', {
      commandId: options.commandId || '', requestId
    }, 504)), timeoutMs);
    const onAbort = () => controller.abort(options.signal.reason);
    if (options.signal) {
      if (options.signal.aborted) onAbort();
      else options.signal.addEventListener('abort', onAbort, { once: true });
    }
    const startedAtUtc = this.clock();
    try {
      const response = await this.fetch(`${this.baseURL}${pathname}`, {
        method: options.method || 'GET',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          authorization: `Bearer ${binding.apiSessionToken}`,
          'x-yance-contract-version': String(CONTRACT_VERSION),
          ...(options.headers || {})
        },
        body: options.body == null ? undefined : JSON.stringify(options.body),
        signal: controller.signal
      });
      const payload = await response.json().catch(() => ({}));
      const current = this._binding({ requireTrusted: false });
      if (sessionIdentity(current) !== identity) {
        throw makeError('WP6_STALE_API_SESSION_RESPONSE', 'Response belongs to a stale backend API session', {
          requestId, pathname
        }, 409);
      }
      if (!response.ok || payload?.ok === false) {
        const reasonCode = String(payload?.reasonCode || payload?.code || (response.status === 401 ? 'API_SESSION_UNAUTHORIZED' : `HTTP_${response.status}`));
        throw makeError(reasonCode, payload?.message || payload?.error || `Runtime API request failed (${response.status})`, payload?.details || {}, response.status);
      }
      this.lastRequest = Object.freeze({ requestId, pathname, method: options.method || 'GET', startedAtUtc, completedAtUtc: this.clock(), status: response.status, commandId: options.commandId || '' });
      return payload;
    } catch (error) {
      if (error?.name === 'AbortError' || controller.signal.aborted) {
        const cause = controller.signal.reason;
        if (cause?.reasonCode) throw cause;
        throw makeError('TRANSPORT_OUTCOME_UNKNOWN', 'Runtime API request outcome is unknown', { commandId: options.commandId || '', requestId, pathname }, 504);
      }
      if (error?.reasonCode) throw error;
      throw makeError('RUNTIME_API_TRANSPORT_FAILED', error?.message || 'Runtime API transport failed', { commandId: options.commandId || '', requestId, pathname }, 503);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener?.('abort', onAbort);
      this.activeControllers.delete(controller);
    }
  }

  async getSnapshot(options = {}) {
    return assertSnapshot(await this._request('/api/app/v2/snapshot', { requireTrusted: options.requireTrusted === true, signal: options.signal, timeoutMs: options.timeoutMs }), {
      expectedBuildId: options.expectedBuildId || this.expectedBuildId
    });
  }

  async getEvents(afterSequence, limit = 100, options = {}) {
    const after = Number(afterSequence || 0);
    const payload = await this._request(`/api/app/v2/events?afterSequence=${encodeURIComponent(after)}&limit=${encodeURIComponent(Number(limit || 100))}`, {
      requireTrusted: options.requireTrusted !== false,
      signal: options.signal,
      timeoutMs: options.timeoutMs
    });
    return assertEventBatch(payload, { afterSequence: after, expectedBuildId: options.expectedBuildId || this.expectedBuildId });
  }

  async executeCommand(envelope, options = {}) {
    const normalized = assertCommandEnvelope(envelope);
    return this._request('/api/app/v2/commands', {
      method: 'POST',
      body: normalized,
      requireTrusted: options.requireTrusted !== false,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
      commandId: normalized.commandId
    });
  }

  command(input = {}) {
    return createCommandEnvelope(input, { clock: this.clock, randomUUID: this.randomUUID });
  }

  setOperatingMode(input = {}, options = {}) {
    const envelope = this.command({
      commandId: input.commandId,
      commandType: 'runtime.setOperatingMode',
      expectedStateVersion: input.expectedStateVersion,
      payload: { operatingMode: input.operatingMode, reason: String(input.reason || 'desktop-runtime-mode-change'), source: 'electron-api-v2', exitAuthorizationId: String(input.exitAuthorizationId || ''), exitAuthorizationToken: String(input.exitAuthorizationToken || '') }
    });
    return this.executeCommand(envelope, options);
  }

  injectWp7ProbeEventGap(afterSequence, options = {}) {
    return this._request('/api/app/v2/wp7/event-gap', {
      method: 'POST',
      body: { afterSequence: Number(afterSequence || 0) },
      requireTrusted: true,
      timeoutMs: options.timeoutMs
    });
  }

  requestStop(input = {}, options = {}) {
    const envelope = this.command({
      commandId: input.commandId,
      commandType: 'runtime.stop',
      expectedStateVersion: input.expectedStateVersion,
      payload: { reason: String(input.reason || 'desktop-runtime-stop') }
    });
    return this.executeCommand(envelope, options);
  }

  setNetwork(input = {}, options = {}) {
    const envelope = this.command({ commandId: input.commandId, commandType: 'runtime.setNetwork', expectedStateVersion: input.expectedStateVersion, payload: { online: input.online !== false, reason: String(input.reason || 'desktop-network-change') } });
    return this.executeCommand(envelope, options);
  }

  suspend(input = {}, options = {}) {
    const envelope = this.command({ commandId: input.commandId, commandType: 'runtime.suspend', expectedStateVersion: input.expectedStateVersion, payload: { reason: String(input.reason || 'desktop-suspend') } });
    return this.executeCommand(envelope, options);
  }

  resume(input = {}, options = {}) {
    const envelope = this.command({ commandId: input.commandId, commandType: 'runtime.resume', expectedStateVersion: input.expectedStateVersion, payload: { reason: String(input.reason || 'desktop-resume') } });
    return this.executeCommand(envelope, options);
  }

  snapshot() {
    return Object.freeze({ role: 'API_V2_RUNTIME_CLIENT', contractVersion: CONTRACT_VERSION, expectedBuildId: this.expectedBuildId, requestSequence: this.requestSequence, activeRequestCount: this.activeControllers.size, lastRequest: this.lastRequest });
  }
}

module.exports = { ApiV2RuntimeClient, sessionIdentity };
