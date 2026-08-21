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
  themeCatalog: 'store:get-theme-catalog',
  updateThemePreferences: 'store:update-theme-preferences',
  previewTheme: 'store:preview-theme',
  cancelThemePreview: 'store:cancel-theme-preview',
  applyTheme: 'store:apply-theme',
  setMotionLevel: 'store:set-motion-level',
  setBackgroundEffect: 'store:set-background-effect',
  personalAccessStatus: 'store:personal-access-status',
  personalAccessSubmitRequest: 'store:personal-access-submit-request',
  personalAccessRefreshRequest: 'store:personal-access-refresh-request',
  personalAccessOwnerRequests: 'store:personal-access-owner-requests',
  personalAccessOwnerRequestMutation: 'store:personal-access-owner-request-mutation',
  personalAccessOwnerGrantMutation: 'store:personal-access-owner-grant-mutation'
});

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function jsonBody(value) {
  return JSON.stringify(value || {});
}

function objectRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function trustedRelationshipIntelligence(value) {
  const bootstrap = objectRecord(value);
  const trajectoryState = objectRecord(bootstrap.trajectoryState);
  const projections = {};
  for (const [rawTrajectoryId, rawTrajectory] of Object.entries(trajectoryState)) {
    const trajectoryId = clean(rawTrajectoryId);
    if (!trajectoryId) continue;
    const trajectory = objectRecord(rawTrajectory);
    const projection = objectRecord(trajectory.relationshipProjection);
    if (projection.authorityId === 'RelationshipProjectionAuthority') {
      projections[trajectoryId] = projection;
    }
  }
  return projections;
}

function relationshipConversationIdsByContactId(value) {
  const payload = objectRecord(value);
  const snapshot = objectRecord(payload.snapshot || payload);
  const conversations = objectRecord(snapshot.conversations);
  const byContactId = objectRecord(conversations.byContactId);
  const projection = {};
  for (const [rawContactId, rawConversationIds] of Object.entries(byContactId)) {
    const contactId = clean(rawContactId);
    const conversationIds = Array.isArray(rawConversationIds)
      ? rawConversationIds.map(clean).filter(Boolean)
      : [];
    if (contactId && conversationIds.length) projection[contactId] = conversationIds;
  }
  return projection;
}

function requiredIdentifier(value, name) {
  const id = clean(value);
  if (id) return id;
  const error = new Error(`${name} is required`);
  error.code = `${String(name || 'identifier').replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase()}_REQUIRED`;
  error.reasonCode = error.code;
  throw error;
}

function requiredAction(value, allowed, name = 'action') {
  const action = clean(value).toLowerCase();
  if (allowed.includes(action)) return action;
  const error = new Error(`${name} is invalid`);
  error.code = `${String(name).replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase()}_INVALID`;
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
    [CHANNELS.snapshot]: async (_event, input = {}) => {
      const domains = Array.isArray(input.domains) ? input.domains.map(clean).filter(Boolean).join(',') : '';
      const snapshotPath = `/api/r32/store/snapshot${domains ? `?domains=${encodeURIComponent(domains)}` : ''}`;
      if (input.includeRelationshipIntelligence !== true) return apiRequest(snapshotPath);
      const [snapshot, conversationSnapshot, bootstrap] = await Promise.all([
        apiRequest(snapshotPath),
        apiRequest('/api/r32/store/snapshot?domains=conversations').catch(() => null),
        apiRequest('/api/workspace/bootstrap?conversationLimit=2000&messageLimit=1').catch(() => null)
      ]);
      return {
        ...objectRecord(snapshot),
        relationshipConversationIdsByContactId: relationshipConversationIdsByContactId(conversationSnapshot),
        relationshipIntelligence: trustedRelationshipIntelligence(bootstrap)
      };
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
    [CHANNELS.themeCatalog]: () => apiRequest('/api/r32/store/ui/theme/catalog'),
    [CHANNELS.updateThemePreferences]: (_event, input = {}) => apiRequest('/api/r32/store/ui/theme/preferences', {
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
    }),
    [CHANNELS.personalAccessStatus]: () => apiRequest('/api/r32/personal-access/status'),
    [CHANNELS.personalAccessSubmitRequest]: (_event, input = {}) => apiRequest('/api/r32/personal-access/submit-request', {
      method: 'POST', body: jsonBody(input)
    }),
    [CHANNELS.personalAccessRefreshRequest]: () => apiRequest('/api/r32/personal-access/refresh-request', {
      method: 'POST', body: '{}'
    }),
    [CHANNELS.personalAccessOwnerRequests]: () => apiRequest('/api/r32/personal-access/owner/requests'),
    [CHANNELS.personalAccessOwnerRequestMutation]: (_event, input = {}) => {
      const requestId = requiredIdentifier(input.requestId, 'requestId');
      const action = requiredAction(input.action, ['assign', 'approve', 'reject']);
      return apiRequest(`/api/r32/personal-access/owner/requests/${encodeURIComponent(requestId)}/${encodeURIComponent(action)}`, {
        method: 'POST', body: jsonBody({})
      });
    },
    [CHANNELS.personalAccessOwnerGrantMutation]: (_event, input = {}) => {
      const grantId = requiredIdentifier(input.grantId, 'grantId');
      const action = requiredAction(input.action, ['suspend', 'revoke']);
      return apiRequest(`/api/r32/personal-access/owner/grants/${encodeURIComponent(grantId)}/${encodeURIComponent(action)}`, {
        method: 'POST', body: jsonBody({})
      });
    }
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
