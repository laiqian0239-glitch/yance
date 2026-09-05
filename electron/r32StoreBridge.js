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
  personalAccessOwnerGrantMutation: 'store:personal-access-owner-grant-mutation',
  matrixLocalIdentityStatus: 'desktop:matrix-local-identity-status',
  matrixLocalIdentityCreate: 'desktop:matrix-local-identity-create',
  productDataProtectionState: 'store:product-system-data-protection-state',
  productDataProtectionMutation: 'store:product-system-data-protection-mutation',
  productModelRuntimeState: 'store:product-system-model-runtime-state',
  productModelRuntimeMutation: 'store:product-system-model-runtime-mutation',
  conversationAutomationMode: 'store:conversation-automation-mode',
  outboundPrepare: 'store:outbound-prepare',
  platformAccountCreate: 'store:platform-account-create',
  platformAccountCommand: 'store:platform-account-command',
  platformAccountsList: 'store:platform-accounts-list',
  platformAccountCapabilities: 'store:platform-account-capabilities',
  platformAccountAudit: 'store:platform-account-audit',
  platformAccountConnect: 'store:platform-account-connect',
  platformAccountReconnect: 'store:platform-account-reconnect',
  platformAccountSync: 'store:platform-account-sync',
  platformAccountsSyncAll: 'store:platform-accounts-sync-all',
  personaCharacterCardPreview: 'store:persona-character-card-preview'
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

function relationshipConversationsById(value) {
  const payload = objectRecord(value);
  const snapshot = objectRecord(payload.snapshot || payload);
  const conversations = objectRecord(snapshot.conversations);
  const byId = objectRecord(conversations.byId);
  const projection = {};
  for (const [rawConversationId, rawConversation] of Object.entries(byId)) {
    const conversationId = clean(rawConversationId);
    if (conversationId) projection[conversationId] = objectRecord(rawConversation);
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

function safeRouteSegment(value, name) {
  return encodeURIComponent(requiredIdentifier(value, name));
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
        relationshipConversationsById: relationshipConversationsById(conversationSnapshot),
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
    },
    [CHANNELS.matrixLocalIdentityStatus]: () => apiRequest('/api/desktop/matrix-local-identity'),
    [CHANNELS.matrixLocalIdentityCreate]: (_event, input = {}) => apiRequest('/api/desktop/matrix-local-identity', {
      method: 'POST',
      body: jsonBody({
        localpart: clean(input.localpart),
        password: String(input.password == null ? '' : input.password),
        confirmPassword: String(input.confirmPassword == null ? '' : input.confirmPassword)
      })
    }),
    [CHANNELS.conversationAutomationMode]: (_event, input = {}) => {
      const conversationId = safeRouteSegment(input.conversationId, 'conversationId');
      const mode = requiredAction(input.mode, ['human', 'ai_assist', 'ai_auto'], 'mode').toUpperCase();
      return apiRequest(`/api/r32/store/conversations/${conversationId}/automation-mode`, {
        method: 'PUT',
        body: jsonBody({
          contactId: clean(input.contactId),
          mode
        })
      });
    },
    [CHANNELS.outboundPrepare]: (_event, input = {}) => {
      const sessionKey = safeRouteSegment(input.sessionKey, 'sessionKey');
      const text = String(input.text == null ? '' : input.text).trim();
      if (!text) {
        const error = new Error('text is required');
        error.code = 'MESSAGE_TEXT_EMPTY';
        error.reasonCode = error.code;
        throw error;
      }
      return apiRequest(`/api/workspace/conversations/${sessionKey}/outbound-prepare`, {
        method: 'POST',
        body: jsonBody({
          text,
          ...(clean(input.idempotencyKey)
            ? { idempotencyKey: clean(input.idempotencyKey) }
            : {})
        })
      });
    },
    [CHANNELS.platformAccountCreate]: (_event, input = {}) => {
      const platform = requiredAction(input.platform, ['whatsapp', 'telegram', 'facebook'], 'platform');
      const displayName = clean(input.displayName) || `${platform} 账号`;
      const accountKind = clean(input.accountKind);
      const driverId = clean(input.driverId);
      return apiRequest('/api/r32/accounts', {
        method: 'POST',
        body: jsonBody({
          platform,
          displayName,
          identityLabel: '登录后自动识别',
          authorizationPending: true,
          ...(accountKind ? {
            accountKind,
            driverId,
            metadata: { accountKind, driverId }
          } : {})
        })
      });
    },
    [CHANNELS.platformAccountCommand]: (_event, input = {}) => {
      const id = safeRouteSegment(input.id, 'id');
      const action = requiredAction(input.action, [
        'auth-challenge',
        'discard-pending',
        'telegram-qr-start',
        'telegram-phone-start',
        'telegram-cancel',
        'telegram-code',
        'telegram-password',
        'facebook-oauth-start',
        'facebook-oauth-status',
        'facebook-select-page',
        'facebook-oauth-cancel',
        'facebook-messenger-start',
        'facebook-messenger-input',
        'facebook-messenger-wait',
        'facebook-messenger-cancel'
      ], 'action');

      if (action === 'auth-challenge') {
        return apiRequest(`/api/r32/accounts/${id}/auth-challenge`);
      }
      if (action === 'discard-pending') {
        return apiRequest(`/api/r32/accounts/${id}/authorization/discard-pending`, {
          method: 'POST',
          body: jsonBody({
            reason: clean(input.reason) || 'product-authorization-abandoned'
          })
        });
      }
      if (action === 'telegram-qr-start') {
        return apiRequest(`/api/r32/accounts/${id}/telegram/qr/start`, {
          method: 'POST', body: '{}'
        });
      }
      if (action === 'telegram-phone-start') {
        return apiRequest(`/api/r32/accounts/${id}/telegram/phone/start`, {
          method: 'POST',
          body: jsonBody({ phoneNumber: requiredIdentifier(input.phoneNumber, 'phoneNumber') })
        });
      }
      if (action === 'telegram-cancel') {
        return apiRequest(`/api/r32/accounts/${id}/telegram/cancel`, {
          method: 'POST', body: '{}'
        });
      }
      if (action === 'telegram-code') {
        return apiRequest(`/api/r32/accounts/${id}/telegram/code`, {
          method: 'POST',
          body: jsonBody({ code: requiredIdentifier(input.code, 'code') })
        });
      }
      if (action === 'telegram-password') {
        const password = String(input.password == null ? '' : input.password);
        if (!password) throw Object.assign(new Error('password is required'), {
          code: 'PASSWORD_REQUIRED',
          reasonCode: 'PASSWORD_REQUIRED'
        });
        return apiRequest(`/api/r32/accounts/${id}/telegram/password`, {
          method: 'POST',
          body: jsonBody({ password })
        });
      }
      if (action === 'facebook-oauth-start') {
        return apiRequest(`/api/r32/accounts/${id}/facebook/oauth/start`, {
          method: 'POST', body: '{}'
        });
      }
      if (action === 'facebook-oauth-status') {
        const flowId = safeRouteSegment(input.flowId, 'flowId');
        return apiRequest(`/api/r32/accounts/${id}/facebook/oauth/status?flowId=${flowId}`);
      }
      if (action === 'facebook-select-page') {
        return apiRequest(`/api/r32/accounts/${id}/facebook/oauth/select-page`, {
          method: 'POST',
          body: jsonBody({
            flowId: requiredIdentifier(input.flowId, 'flowId'),
            pageId: requiredIdentifier(input.pageId, 'pageId')
          })
        });
      }
      if (action === 'facebook-oauth-cancel') {
        return apiRequest(`/api/r32/accounts/${id}/facebook/oauth/cancel`, {
          method: 'POST',
          body: jsonBody({ flowId: requiredIdentifier(input.flowId, 'flowId') })
        });
      }
      if (action === 'facebook-messenger-start') {
        return apiRequest(`/api/r32/accounts/${id}/facebook/messenger/start`, {
          method: 'POST', body: '{}'
        });
      }
      if (action === 'facebook-messenger-input') {
        return apiRequest(`/api/r32/accounts/${id}/facebook/messenger/input`, {
          method: 'POST',
          body: jsonBody({
            loginProcessId: requiredIdentifier(input.loginProcessId, 'loginProcessId'),
            stepId: requiredIdentifier(input.stepId, 'stepId'),
            txnId: clean(input.txnId),
            input: objectRecord(input.input)
          })
        });
      }
      if (action === 'facebook-messenger-wait') {
        return apiRequest(`/api/r32/accounts/${id}/facebook/messenger/wait`, {
          method: 'POST',
          body: jsonBody({
            loginProcessId: requiredIdentifier(input.loginProcessId, 'loginProcessId'),
            stepId: requiredIdentifier(input.stepId, 'stepId'),
            txnId: clean(input.txnId)
          })
        });
      }
      return apiRequest(`/api/r32/accounts/${id}/facebook/messenger/cancel`, {
        method: 'POST',
        body: jsonBody({
          loginProcessId: clean(input.loginProcessId)
        })
      });
    },
    [CHANNELS.platformAccountsList]: () => apiRequest('/api/r32/accounts'),
    [CHANNELS.platformAccountCapabilities]: () => apiRequest('/api/r32/accounts/capabilities'),
    [CHANNELS.platformAccountAudit]: (_event, input = {}) => {
      const limit = clean(input.limit);
      return apiRequest(`/api/r32/accounts/audit${limit ? `?limit=${encodeURIComponent(limit)}` : ''}`);
    },
    [CHANNELS.platformAccountConnect]: (_event, input = {}) => apiRequest(`/api/r32/accounts/${safeRouteSegment(input.id, 'id')}/connect`, {
      method: 'POST',
      body: '{}'
    }),
    [CHANNELS.platformAccountReconnect]: (_event, input = {}) => apiRequest(`/api/r32/accounts/${safeRouteSegment(input.id, 'id')}/reconnect`, {
      method: 'POST',
      body: '{}'
    }),
    [CHANNELS.platformAccountSync]: (_event, input = {}) => apiRequest(`/api/r32/accounts/${safeRouteSegment(input.id, 'id')}/sync`, {
      method: 'POST',
      body: '{}'
    }),
    [CHANNELS.platformAccountsSyncAll]: () => apiRequest('/api/r32/accounts/actions/sync-all', {
      method: 'POST',
      body: '{}'
    }),
    [CHANNELS.personaCharacterCardPreview]: (_event, input = {}) => {
      // Correction E: renderer ships raw bytes only — never a filesystem path.
      // The bridge converts the structured-cloned payload to a Buffer and calls the
      // existing backend route with application/octet-stream. The backend SillyTavern
      // parser remains the sole Character Card parser; renderer-side parsing is forbidden.
      const raw = input.bytes;
      if (!(raw instanceof Uint8Array) && !(raw instanceof ArrayBuffer) && !Buffer.isBuffer(raw)) {
        const error = new Error('Character Card raw bytes are required');
        error.code = 'PERSONA_CHARACTER_CARD_BYTES_REQUIRED';
        error.reasonCode = error.code;
        throw error;
      }
      const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      if (buffer.length > 8 * 1024 * 1024) {
        const error = new Error('Character Card exceeds the 8 MB limit');
        error.code = 'PERSONA_CHARACTER_CARD_TOO_LARGE';
        error.reasonCode = error.code;
        throw error;
      }
      return apiRequest('/api/v2/persona/character-card/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: buffer
      });
    },
    [CHANNELS.productDataProtectionState]: async () => {
      const [backups, portableBackups] = await Promise.all([
        apiRequest('/api/r32/system/backups'),
        apiRequest('/api/r32/system/portable-backups')
      ]);
      return { ok: true, backups: objectRecord(backups), portableBackups: objectRecord(portableBackups) };
    },
    [CHANNELS.productDataProtectionMutation]: (_event, input = {}) => {
      const action = requiredAction(input.action, [
        'create-backup',
        'verify-backup',
        'stage-restore',
        'cancel-restore',
        'create-portable-backup',
        'verify-portable-backup',
        'stage-portable-restore',
        'delete-portable-backup'
      ]);
      if (action === 'create-backup') {
        return apiRequest('/api/r32/system/backups', {
          method: 'POST',
          body: jsonBody({
            label: clean(input.label) || 'product-system-settings',
            profile: clean(input.profile) || undefined,
            roots: Array.isArray(input.roots) ? input.roots.map(clean).filter(Boolean) : undefined
          })
        });
      }
      if (action === 'verify-backup') {
        const name = safeRouteSegment(input.name, 'name');
        return apiRequest(`/api/r32/system/backups/${name}/verify`, { method: 'POST', body: '{}' });
      }
      if (action === 'stage-restore') {
        const name = safeRouteSegment(input.name, 'name');
        return apiRequest(`/api/r32/system/backups/${name}/restore`, { method: 'POST', body: '{}' });
      }
      if (action === 'cancel-restore') {
        return apiRequest('/api/r32/system/restore/pending', { method: 'DELETE' });
      }
      if (action === 'create-portable-backup') {
        return apiRequest('/api/r32/system/portable-backups', {
          method: 'POST',
          body: jsonBody({
            passphrase: String(input.passphrase || ''),
            profile: clean(input.profile) || 'data-only',
            label: clean(input.label) || 'product-system-settings'
          })
        });
      }
      if (action === 'verify-portable-backup') {
        const name = safeRouteSegment(input.name, 'name');
        return apiRequest(`/api/r32/system/portable-backups/${name}/verify`, {
          method: 'POST', body: jsonBody({ passphrase: String(input.passphrase || '') })
        });
      }
      if (action === 'stage-portable-restore') {
        const name = safeRouteSegment(input.name, 'name');
        return apiRequest(`/api/r32/system/portable-backups/${name}/restore`, {
          method: 'POST', body: jsonBody({ passphrase: String(input.passphrase || '') })
        });
      }
      const name = safeRouteSegment(input.name, 'name');
      return apiRequest(`/api/r32/system/portable-backups/${name}`, { method: 'DELETE' });
    },
    [CHANNELS.productModelRuntimeState]: async () => {
      const [modelBrain, catalog, hardware, adaptiveLocal] = await Promise.all([
        apiRequest('/api/r32/models/model-brain/status'),
        apiRequest('/api/r32/models/adaptive-local/catalog'),
        apiRequest('/api/r32/models/adaptive-local/hardware'),
        apiRequest('/api/r32/models/adaptive-local/status')
      ]);
      return {
        ok: true,
        modelBrain: objectRecord(modelBrain),
        catalog: objectRecord(catalog),
        hardware: objectRecord(hardware),
        adaptiveLocal: objectRecord(adaptiveLocal)
      };
    },
    [CHANNELS.productModelRuntimeMutation]: (_event, input = {}) => {
      const action = requiredAction(input.action, [
        'plan-adaptive-local',
        'materialize-adaptive-runtime',
        'remove-adaptive-runtime',
        'pull-ollama-model',
        'cancel-ollama-pull'
      ]);
      if (action === 'plan-adaptive-local') {
        const hardware = objectRecord(input.hardware);
        return apiRequest('/api/r32/models/adaptive-local/plan', {
          method: 'POST',
          body: jsonBody({
            hardware: Object.keys(hardware).length ? hardware : undefined,
            candidates: Array.isArray(input.candidates) ? input.candidates : undefined,
            runtime: objectRecord(input.runtime),
            model: objectRecord(input.model),
            benchmark: objectRecord(input.benchmark)
          })
        });
      }
      if (action === 'materialize-adaptive-runtime') {
        return apiRequest('/api/r32/models/adaptive-local/materialize', {
          method: 'POST',
          body: jsonBody({
            consent: input.consent === true,
            targetName: clean(input.targetName),
            runtimeId: clean(input.runtimeId),
            localAssetPath: clean(input.localAssetPath),
            expectedSha256: clean(input.expectedSha256),
            requiredBytes: Math.max(0, Number(input.requiredBytes || 0))
          })
        });
      }
      if (action === 'remove-adaptive-runtime') {
        return apiRequest('/api/r32/models/adaptive-local/remove', {
          method: 'POST',
          body: jsonBody({ targetName: clean(input.targetName), runtimeId: clean(input.runtimeId) })
        });
      }
      if (action === 'pull-ollama-model') {
        return apiRequest('/api/r32/models/ollama/pull', {
          method: 'POST',
          body: jsonBody({
            model: requiredIdentifier(input.model, 'model'),
            endpoint: clean(input.endpoint) || 'http://127.0.0.1:11434',
            requestId: clean(input.requestId)
          })
        });
      }
      return apiRequest('/api/r32/models/ollama/pull/cancel', {
        method: 'POST', body: jsonBody({ requestId: requiredIdentifier(input.requestId, 'requestId') })
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
