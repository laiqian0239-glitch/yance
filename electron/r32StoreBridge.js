'use strict';

const CHANNELS = Object.freeze({
  snapshot: 'store:get-snapshot',
  socialContext: 'store:get-social-context',
  searchWorkspace: 'store:search-workspace',
  createTranslationJob: 'store:create-translation-job',
  getTranslationJob: 'store:get-translation-job',
  cancelTranslationJob: 'store:cancel-translation-job',
  retryTranslationJob: 'store:retry-translation-job',
  generateReply: 'store:generate-reply',
  cancelRequest: 'store:cancel-request',
  approveReply: 'store:approve-reply',
  rejectReply: 'store:reject-reply',
  reviseOutbox: 'store:revise-outbox',
  confirmSend: 'store:confirm-send',
  correctInference: 'store:correct-inference',
  setReadingMode: 'store:set-reading-mode',
  previewTheme: 'store:preview-theme',
  cancelThemePreview: 'store:cancel-theme-preview',
  applyTheme: 'store:apply-theme',
  setMotionLevel: 'store:set-motion-level',
  setBackgroundEffect: 'store:set-background-effect'
});

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function jsonBody(value) {
  return JSON.stringify(value || {});
}

function requiredIdentifier(value, name) {
  const id = clean(value);
  if (id) return id;
  const error = new Error(`${name} is required`);
  error.code = `${String(name || 'identifier').replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase()}_REQUIRED`;
  error.reasonCode = error.code;
  throw error;
}

function serializeBridgeError(error) {
  return {
    __yanceBridgeError: true,
    message: String(error?.message || 'Local API request failed'),
    code: String(error?.code || error?.reasonCode || 'LOCAL_API_REQUEST_FAILED'),
    reasonCode: String(error?.reasonCode || error?.code || 'LOCAL_API_REQUEST_FAILED'),
    status: Math.max(0, Number(error?.status || 0)),
    retryAfterMs: Math.max(0, Number(error?.retryAfterMs || 0)),
    requestId: String(error?.requestId || '')
  };
}

function bridgeAbortError(code = 'AI_REPLY_GENERATION_SUPERSEDED') {
  const error = new Error(code);
  error.name = 'AbortError';
  error.code = code;
  error.reasonCode = code;
  return error;
}

function rendererKey(event, requestId) {
  const senderId = String(event?.sender?.id ?? 'unknown');
  return `${senderId}:${clean(requestId)}`;
}

function installR32StoreBridge({ ipcMain, apiRequest }) {
  if (!ipcMain?.handle || typeof apiRequest !== 'function') throw new TypeError('ipcMain and apiRequest are required');
  const activeRequests = new Map();
  const handlers = {
    [CHANNELS.snapshot]: (_event, input = {}) => {
      const domains = Array.isArray(input.domains) ? input.domains.map(clean).filter(Boolean).join(',') : '';
      return apiRequest(`/api/r32/store/snapshot${domains ? `?domains=${encodeURIComponent(domains)}` : ''}`);
    },
    [CHANNELS.socialContext]: (_event, input = {}) => {
      const contactId = clean(input.contactId);
      if (!contactId) throw new Error('contactId is required');
      const query = new URLSearchParams({
        timelineLimit: String(input.timelineLimit || 24),
        recentMessageLimit: String(input.recentMessageLimit || 36)
      });
      return apiRequest(`/api/r32/store/customers/${encodeURIComponent(contactId)}/social-context?${query}`);
    },
    [CHANNELS.searchWorkspace]: (_event, input = {}) => {
      const queryText = clean(input.query);
      const numericLimit = input.limit == null ? 80 : Number(input.limit);
      const limit = Math.max(1, Math.min(200, Number.isFinite(numericLimit) ? numericLimit : 80));
      const query = new URLSearchParams({ q: queryText, limit: String(limit) });
      return apiRequest(`/api/r32/store/search?${query}`);
    },
    [CHANNELS.createTranslationJob]: (_event, input = {}) => {
      const messageId = requiredIdentifier(input.messageId, 'messageId');
      return apiRequest(`/api/r32/store/translations/messages/${encodeURIComponent(messageId)}/jobs`, {
        method: 'POST',
        body: jsonBody({
          force: input.force === true,
          forceNew: input.forceNew === true,
          timeoutMs: input.timeoutMs
        })
      });
    },
    [CHANNELS.getTranslationJob]: (_event, input = {}) => {
      const jobId = requiredIdentifier(input.jobId, 'jobId');
      return apiRequest(`/api/r32/store/translations/jobs/${encodeURIComponent(jobId)}`);
    },
    [CHANNELS.cancelTranslationJob]: (_event, input = {}) => {
      const jobId = requiredIdentifier(input.jobId, 'jobId');
      return apiRequest(`/api/r32/store/translations/jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE' });
    },
    [CHANNELS.retryTranslationJob]: (_event, input = {}) => {
      const jobId = requiredIdentifier(input.jobId, 'jobId');
      return apiRequest(`/api/r32/store/translations/jobs/${encodeURIComponent(jobId)}/retry`, {
        method: 'POST', body: jsonBody({ timeoutMs: input.timeoutMs })
      });
    },
    [CHANNELS.generateReply]: async (event, input = {}) => {
      const requestId = clean(input.__yanceBridgeRequestId);
      const body = { ...input };
      delete body.__yanceBridgeRequestId;
      const controller = new AbortController();
      const key = requestId ? rendererKey(event, requestId) : '';
      if (key && activeRequests.has(key)) {
        const error = new Error('Duplicate desktop bridge request ID');
        error.code = 'BRIDGE_REQUEST_ID_CONFLICT';
        throw error;
      }
      if (key) activeRequests.set(key, { controller, senderId: String(event?.sender?.id ?? 'unknown') });
      try {
        return await apiRequest('/api/r32/store/replies/generate', {
          method: 'POST', body: jsonBody(body), signal: controller.signal
        });
      } finally {
        if (key && activeRequests.get(key)?.controller === controller) activeRequests.delete(key);
      }
    },
    [CHANNELS.approveReply]: (_event, input = {}) => apiRequest(`/api/r32/store/replies/${encodeURIComponent(clean(input.candidateId))}/approve`, {
      method: 'POST', body: jsonBody(input)
    }),
    [CHANNELS.rejectReply]: (_event, input = {}) => apiRequest(`/api/r32/store/replies/${encodeURIComponent(clean(input.candidateId))}/reject`, {
      method: 'POST', body: jsonBody(input)
    }),
    [CHANNELS.reviseOutbox]: (_event, input = {}) => apiRequest(`/api/r32/store/outbox/${encodeURIComponent(clean(input.outboxId))}/text`, {
      method: 'PATCH', body: jsonBody(input)
    }),
    [CHANNELS.confirmSend]: (_event, input = {}) => apiRequest(`/api/r32/store/outbox/${encodeURIComponent(clean(input.outboxId))}/send`, {
      method: 'POST', body: jsonBody(input)
    }),
    [CHANNELS.correctInference]: (_event, input = {}) => apiRequest(`/api/r32/store/customers/${encodeURIComponent(clean(input.contactId))}/corrections`, {
      method: 'POST', body: jsonBody(input)
    }),
    [CHANNELS.setReadingMode]: (_event, input = {}) => apiRequest('/api/r32/store/ui/reading-mode', {
      method: 'PUT', body: jsonBody(input)
    }),
    [CHANNELS.previewTheme]: (_event, input = {}) => apiRequest('/api/r32/store/ui/theme/preview', {
      method: 'PUT', body: jsonBody(input)
    }),
    [CHANNELS.cancelThemePreview]: () => apiRequest('/api/r32/store/ui/theme/cancel-preview', {
      method: 'PUT', body: '{}'
    }),
    [CHANNELS.applyTheme]: (_event, input = {}) => apiRequest('/api/r32/store/ui/theme/apply', {
      method: 'PUT', body: jsonBody(input)
    }),
    [CHANNELS.setMotionLevel]: (_event, input = {}) => apiRequest('/api/r32/store/ui/motion-level', {
      method: 'PUT', body: jsonBody(input)
    }),
    [CHANNELS.setBackgroundEffect]: (_event, input = {}) => apiRequest('/api/r32/store/ui/background-effect', {
      method: 'PUT', body: jsonBody(input)
    })
  };
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, async (...args) => {
      try {
        return await handler(...args);
      } catch (error) {
        return serializeBridgeError(error);
      }
    });
  }
  const cancelHandler = (event, payload = {}) => {
    const requestId = clean(payload.requestId);
    if (!requestId) return;
    const key = rendererKey(event, requestId);
    const request = activeRequests.get(key);
    if (!request) return;
    activeRequests.delete(key);
    if (!request.controller.signal.aborted) request.controller.abort(bridgeAbortError());
  };
  ipcMain.on?.(CHANNELS.cancelRequest, cancelHandler);
  return () => {
    for (const channel of Object.keys(handlers)) ipcMain.removeHandler(channel);
    ipcMain.removeListener?.(CHANNELS.cancelRequest, cancelHandler);
    for (const request of activeRequests.values()) {
      if (!request.controller.signal.aborted) request.controller.abort(bridgeAbortError('DESKTOP_BRIDGE_DISPOSED'));
    }
    activeRequests.clear();
  };
}

module.exports = { installR32StoreBridge, CHANNELS, serializeBridgeError };
