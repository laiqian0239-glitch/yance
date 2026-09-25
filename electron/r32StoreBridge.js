'use strict';

const CHANNELS = Object.freeze({
  snapshot: 'store:get-snapshot',
  socialContext: 'store:get-social-context',
  searchWorkspace: 'store:search-workspace',
  matrixDirectProjection: 'store:matrix-direct-projection',
  translateChinese: 'store:translate-chinese',
  createTranslationJob: 'store:create-translation-job',
  getTranslationJob: 'store:get-translation-job',
  cancelTranslationJob: 'store:cancel-translation-job',
  retryTranslationJob: 'store:retry-translation-job',
  productMessageProjection: 'store:product-message-projection',
  productDailyReview: 'store:product-daily-review',
  platformAccountLogout: 'store:platform-account-logout',
  personaProfiles: 'store:persona-profiles',
  personaEffective: 'store:persona-effective',
  personaScopes: 'store:persona-scopes',
  personaCurrent: 'store:persona-current',
  personaSetScope: 'store:persona-set-scope',
  personaClearScope: 'store:persona-clear-scope',
  notificationSettings: 'store:notification-settings',
  notificationSettingsUpdate: 'store:notification-settings-update',
  notificationSoundCreate: 'store:notification-sound-create',
  notificationSoundDelete: 'store:notification-sound-delete',
  personaVersions: 'store:persona-versions',
  personaImport: 'store:persona-import',
  personaInitializeDefault: 'store:persona-initialize-default',
  personaUpdateAuthoritative: 'store:persona-update-authoritative',
  personaVersionDiff: 'store:persona-version-diff',
  personaRollback: 'store:persona-rollback',
  workspaceConversationArchive: 'store:workspace-conversation-archive',
  workspaceConversationPin: 'store:workspace-conversation-pin',
  workspaceContactMerge: 'store:workspace-contact-merge',
  workspaceContactMergeUndo: 'store:workspace-contact-merge-undo',
  workspaceProfileReview: 'store:workspace-profile-review',
  workspaceKeyNodeMark: 'store:workspace-key-node-mark',
  workspaceKeyNodeUnmark: 'store:workspace-key-node-unmark',
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
  personalAccessLogin: 'store:personal-access-login',
  personalAccessActivate: 'store:personal-access-activate',
  personalAccessLogout: 'store:personal-access-logout',
  productDataProtectionState: 'store:product-system-data-protection-state',
  productDataProtectionMutation: 'store:product-system-data-protection-mutation',
  productModelRuntimeState: 'store:product-system-model-runtime-state',
  productModelRuntimeMutation: 'store:product-system-model-runtime-mutation',
  productRuntimeSafeExitPrepare: 'store:product-system-runtime-safe-exit-prepare',
  conversationAutomationMode: 'store:conversation-automation-mode',
  outboundPrepare: 'store:outbound-prepare',
  humanTypingPrepare: 'store:human-typing-prepare',
  humanTypingRelease: 'store:human-typing-release',
  humanTypingCancel: 'store:human-typing-cancel',
  humanTypingComplete: 'store:human-typing-complete',
  platformAccountCreate: 'store:platform-account-create',
  platformAccountCommand: 'store:platform-account-command',
  platformAccountsList: 'store:platform-accounts-list',
  platformAccountCapabilities: 'store:platform-account-capabilities',
  platformAccountAudit: 'store:platform-account-audit',
  platformAccountConnect: 'store:platform-account-connect',
  platformAccountReconnect: 'store:platform-account-reconnect',
  platformAccountSync: 'store:platform-account-sync',
  platformAccountsSyncAll: 'store:platform-accounts-sync-all',
  aiWorkspaceLoad: 'store:ai-workspace-load',
  aiWorkspaceCreateTask: 'store:ai-workspace-create-task',
  aiWorkspaceUpdateTask: 'store:ai-workspace-update-task',
  aiWorkspaceRunTask: 'store:ai-workspace-run-task',
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

function canonicalGroupConversations(value) {
  const bootstrap = objectRecord(value);
  const conversations = Array.isArray(bootstrap.conversations) ? bootstrap.conversations : [];
  return conversations
    .map(objectRecord)
    .filter(row => {
      const payload = objectRecord(row.payload);
      return clean(row.conversationKind || payload.conversationKind).toLowerCase() === 'group';
    });
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
        apiRequest('/api/r32/workspace/bootstrap?conversationLimit=2000&messageLimit=1').catch(() => null)
      ]);
      return {
        ...objectRecord(snapshot),
        relationshipConversationIdsByContactId: relationshipConversationIdsByContactId(conversationSnapshot),
        relationshipConversationsById: relationshipConversationsById(conversationSnapshot),
        groupConversations: canonicalGroupConversations(bootstrap),
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
    [CHANNELS.translateChinese]: (_event, input = {}) => {
      const sourceText = clean(input.text);
      return apiRequest('/api/r32/store/translations/chinese', {
        method: 'POST',
        body: jsonBody({
          text: sourceText,
          ...(clean(input.sourceLanguage) ? { sourceLanguage: clean(input.sourceLanguage) } : {}),
          ...(clean(input.dedupeKey) ? { dedupeKey: clean(input.dedupeKey) } : {}),
          ...(clean(input.fingerprint) ? { fingerprint: clean(input.fingerprint) } : {}),
          ...(input.timeoutMs == null ? {} : { timeoutMs: input.timeoutMs })
        })
      });
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
    [CHANNELS.productDailyReview]: (_event, input = {}) => {
      const contactId = safeRouteSegment(input.contactId, 'contactId');
      const localDate = requiredIdentifier(input.localDate, 'localDate');
      const timeZone = requiredIdentifier(input.timeZone, 'timeZone');
      return apiRequest(`/api/r32/workspace/contacts/${contactId}/daily-review?localDate=${encodeURIComponent(localDate)}&timeZone=${encodeURIComponent(timeZone)}`);
    },
    [CHANNELS.platformAccountLogout]: (_event, input = {}) => apiRequest(
      `/api/r32/accounts/${safeRouteSegment(input.id, 'id')}/logout`,
      { method: 'POST', body: '{}' }
    ),
    [CHANNELS.personaProfiles]: (_event, input = {}) => {
      const raw = Number(input.limit == null ? 100 : input.limit);
      const limit = Math.max(1, Math.min(1000, Number.isFinite(raw) ? Math.trunc(raw) : 100));
      return apiRequest(`/api/v2/persona/profiles?limit=${limit}`);
    },
    [CHANNELS.personaEffective]: (_event, input = {}) => {
      const params = new URLSearchParams();
      if (clean(input.contactId)) params.set('contactId', clean(input.contactId));
      if (clean(input.conversationId)) params.set('conversationId', clean(input.conversationId));
      if (clean(input.globalScopeId)) params.set('globalScopeId', clean(input.globalScopeId));
      return apiRequest(`/api/v2/persona/effective?${params.toString()}`);
    },
    [CHANNELS.personaScopes]: (_event, input = {}) => {
      const params = new URLSearchParams();
      if (clean(input.scopeType)) params.set('scopeType', clean(input.scopeType));
      if (clean(input.profileId)) params.set('profileId', clean(input.profileId));
      if (clean(input.limit)) params.set('limit', clean(input.limit));
      return apiRequest(`/api/v2/persona/scopes?${params.toString()}`);
    },
    [CHANNELS.personaCurrent]: (_event, input = {}) => apiRequest(
      `/api/v2/persona/${safeRouteSegment(input.profileId, 'profileId')}/current`
    ),
    [CHANNELS.personaSetScope]: (_event, input = {}) => apiRequest(
      `/api/v2/persona/scopes/${safeRouteSegment(input.scopeType, 'scopeType')}/${safeRouteSegment(input.scopeId, 'scopeId')}`,
      { method: 'PUT', body: jsonBody({ profileId: requiredIdentifier(input.profileId, 'profileId'),
        ...(input.expectedVersion == null ? {} : { expectedVersion: input.expectedVersion }) }) }
    ),
    [CHANNELS.personaClearScope]: (_event, input = {}) => apiRequest(
      `/api/v2/persona/scopes/${safeRouteSegment(input.scopeType, 'scopeType')}/${safeRouteSegment(input.scopeId, 'scopeId')}`,
      { method: 'DELETE' }
    ),
    [CHANNELS.notificationSettings]: () => apiRequest('/api/r32/system/notifications'),
    [CHANNELS.notificationSettingsUpdate]: (_event, input = {}) => apiRequest(
      '/api/r32/system/notifications', { method: 'POST', body: jsonBody(input) }
    ),
    [CHANNELS.notificationSoundCreate]: (_event, input = {}) => {
      const raw = input.bytes;
      if (!(raw instanceof Uint8Array) && !(raw instanceof ArrayBuffer) && !Buffer.isBuffer(raw)) {
        throw Object.assign(new Error('notification sound raw bytes are required'), { code: 'NOTIFICATION_SOUND_BYTES_REQUIRED' });
      }
      const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      const fileName = requiredIdentifier(input.fileName, 'fileName');
      const label = clean(input.label || fileName);
      const mimeType = clean(input.mimeType) || 'application/octet-stream';
      return apiRequest(`/api/r32/system/notifications/sounds?label=${encodeURIComponent(label)}&fileName=${encodeURIComponent(fileName)}`,
        { method: 'POST', headers: { 'content-type': mimeType }, body: buffer });
    },
    [CHANNELS.notificationSoundDelete]: (_event, input = {}) => apiRequest(
      `/api/r32/system/notifications/sounds/${safeRouteSegment(input.id, 'id')}`, { method: 'DELETE' }
    ),
    [CHANNELS.productMessageProjection]: (_event, input = {}) => {
      const sessionKey = safeRouteSegment(input.sessionKey, 'sessionKey');
      const accountId = requiredIdentifier(input.accountId, 'accountId');
      const chatJid = requiredIdentifier(input.chatJid, 'chatJid');
      const messageIds = [...new Set((Array.isArray(input.messageIds) ? input.messageIds : []).map(clean).filter(Boolean))];
      if (!messageIds.length || messageIds.length > 16) throw Object.assign(new Error('messageIds must contain 1..16 values'), { code:'MESSAGE_PROJECTION_IDS_INVALID' });
      return apiRequest(`/api/r32/workspace/conversations/${sessionKey}/message-projection`, { method:'POST', body:jsonBody({ accountId, chatJid, messageIds }) });
    },
    [CHANNELS.personaVersions]: (_event, input = {}) => {
      const profileId = safeRouteSegment(input.profileId, 'profileId');
      const n = Number(input.limit == null ? 100 : input.limit); const limit = Math.max(1, Math.min(1000, Number.isFinite(n) ? Math.trunc(n) : 100));
      return apiRequest(`/api/v2/persona/${profileId}/versions?limit=${limit}`);
    },
    [CHANNELS.personaImport]: (_event, input = {}) => apiRequest(`/api/v2/persona/${safeRouteSegment(input.profileId,'profileId')}/import`, { method:'POST', body:jsonBody({ exportedPayload:input.exportedPayload }) }),
    [CHANNELS.personaInitializeDefault]: (_event, input = {}) => apiRequest(
      `/api/v2/persona/${safeRouteSegment(input.profileId,'profileId')}/initialize-default`,
      { method:'POST', body:jsonBody({ presetId:clean(input.presetId), metadata:objectRecord(input.metadata) }) }
    ),
    [CHANNELS.personaUpdateAuthoritative]: (_event, input = {}) => apiRequest(
      `/api/v2/persona/${safeRouteSegment(input.profileId,'profileId')}/authoritative`,
      { method:'PATCH', body:jsonBody({ patch:objectRecord(input.patch), expectedVersion:input.expectedVersion, reason:clean(input.reason) || 'product-persona-management' }) }
    ),
    [CHANNELS.personaVersionDiff]: (_event, input = {}) => {
      const profileId=safeRouteSegment(input.profileId,'profileId');
      const fromVersion=Number(input.fromVersion); const toVersion=Number(input.toVersion);
      if(!Number.isInteger(fromVersion)||fromVersion<1||!Number.isInteger(toVersion)||toVersion<1) throw Object.assign(new Error('Persona version diff requires positive versions'),{code:'PERSONA_VERSION_DIFF_INVALID'});
      return apiRequest(`/api/v2/persona/${profileId}/diff?fromVersion=${fromVersion}&toVersion=${toVersion}`);
    },
    [CHANNELS.personaRollback]: (_event, input = {}) => apiRequest(
      `/api/v2/persona/${safeRouteSegment(input.profileId,'profileId')}/rollback`,
      { method:'POST', body:jsonBody({ targetVersion:Number(input.targetVersion), expectedVersion:input.expectedVersion, reason:clean(input.reason) || 'product-persona-management', actor:'user' }) }
    ),
    [CHANNELS.workspaceConversationArchive]: (_event, input = {}) => apiRequest(`/api/r32/workspace/conversations/${safeRouteSegment(input.sessionKey,'sessionKey')}/archive`, { method:'PUT', body:jsonBody({ archived:input.archived===true, by:'product' }) }),
    [CHANNELS.workspaceConversationPin]: (_event, input = {}) => apiRequest(`/api/r32/workspace/conversations/${safeRouteSegment(input.sessionKey,'sessionKey')}/pin`, { method:'PUT', body:jsonBody({ pinned:input.pinned===true, by:'product' }) }),
    [CHANNELS.workspaceContactMerge]: (_event, input = {}) => apiRequest(`/api/r32/workspace/contacts/${safeRouteSegment(input.survivorId,'survivorId')}/merge`, { method:'POST', body:jsonBody({ mergedId:requiredIdentifier(input.mergedId,'mergedId'), by:'product', ...(input.expectedVersion==null?{}:{expectedVersion:input.expectedVersion}) }) }),
    [CHANNELS.workspaceContactMergeUndo]: (_event, input = {}) => apiRequest(`/api/r32/workspace/contacts/${safeRouteSegment(input.survivorId,'survivorId')}/merge/undo`, { method:'POST', body:jsonBody({ journalId:requiredIdentifier(input.journalId,'journalId'), by:'product' }) }),
    [CHANNELS.workspaceProfileReview]: (_event, input = {}) => { const contactId=safeRouteSegment(input.contactId,'contactId'); const body={...input}; delete body.contactId; return apiRequest(`/api/r32/workspace/contacts/${contactId}/profile-review`, {method:'POST',body:jsonBody(body)}); },
    [CHANNELS.workspaceKeyNodeMark]: (_event, input = {}) => apiRequest(`/api/r32/workspace/contacts/${safeRouteSegment(input.contactId,'contactId')}/key-nodes`, { method:'POST', body:jsonBody({ ...(clean(input.eventId)?{eventId:clean(input.eventId)}:{}), ...(clean(input.nodeKind)?{nodeKind:clean(input.nodeKind)}:{}), markedBy:'user', ...(input.expectedVersion==null?{}:{expectedVersion:input.expectedVersion}) }) }),
    [CHANNELS.workspaceKeyNodeUnmark]: (_event, input = {}) => apiRequest(`/api/r32/workspace/contacts/${safeRouteSegment(input.contactId,'contactId')}/key-nodes/${safeRouteSegment(input.eventId,'eventId')}`, { method:'DELETE', body:jsonBody({ ...(input.expectedVersion==null?{}:{expectedVersion:input.expectedVersion}) }) }),
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
    [CHANNELS.personalAccessStatus]: (_event, input = {}) => apiRequest('/api/r32/personal-access/status', {
      method: 'POST', body: jsonBody(input)
    }),
    [CHANNELS.personalAccessLogin]: (_event, input = {}) => apiRequest('/api/r32/personal-access/login', {
      method: 'POST',
      body: jsonBody({ invitationKey: clean(input.invitationKey) })
    }),
    [CHANNELS.personalAccessActivate]: (_event, input = {}) => apiRequest('/api/r32/personal-access/activate', {
      method: 'POST', body: jsonBody(input)
    }),
    [CHANNELS.personalAccessLogout]: () => apiRequest('/api/r32/personal-access/logout', {
      method: 'POST', body: '{}'
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
      return apiRequest(`/api/r32/workspace/conversations/${sessionKey}/outbound-prepare`, {
        method: 'POST',
        body: jsonBody({
          text,
          ...(clean(input.idempotencyKey)
            ? { idempotencyKey: clean(input.idempotencyKey) }
            : {})
        })
      });
    },
    [CHANNELS.humanTypingPrepare]: (_event, input = {}) => apiRequest('/api/r32/messages/typing/element/prepare', {
      method: 'POST',
      body: jsonBody(input || {})
    }),
    [CHANNELS.humanTypingRelease]: (_event, input = {}) => apiRequest('/api/r32/messages/typing/element/release', {
      method: 'POST',
      body: jsonBody(input || {})
    }),
    [CHANNELS.humanTypingCancel]: (_event, input = {}) => apiRequest('/api/r32/messages/typing/element/cancel', {
      method: 'POST',
      body: jsonBody(input || {})
    }),
    [CHANNELS.humanTypingComplete]: (_event, input = {}) => apiRequest('/api/r32/messages/typing/element/complete', {
      method: 'POST',
      body: jsonBody(input || {})
    }),
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
        'provisioning-login-flows',
        'provisioning-login-start',
        'provisioning-login-input',
        'provisioning-login-wait',
        'provisioning-login-cancel',
        'provisioning-direct-chat-ensure',
        'facebook-page-inboxes',
        'facebook-page-attach',
        'facebook-oauth-start',
        'facebook-oauth-status',
        'facebook-oauth-cancel'
      ], 'action');

      if (action === 'auth-challenge') {
        const waitMs = Math.max(0, Math.min(Number(input.waitMs || 0), 30000));
        return apiRequest(`/api/r32/accounts/${id}/auth-challenge${waitMs ? `?waitMs=${waitMs}` : ''}`);
      }
      if (action === 'discard-pending') {
        return apiRequest(`/api/r32/accounts/${id}/authorization/discard-pending`, {
          method: 'POST',
          body: jsonBody({
            reason: clean(input.reason) || 'product-authorization-abandoned'
          })
        });
      }
      if (action === 'provisioning-login-flows') {
        const matrixUserId = clean(input.matrixUserId);
        return apiRequest(`/api/r32/accounts/${id}/provisioning/login/flows${matrixUserId ? `?matrixUserId=${encodeURIComponent(matrixUserId)}` : ''}`);
      }
      if (action === 'provisioning-login-start') {
        return apiRequest(`/api/r32/accounts/${id}/provisioning/login/start`, {
          method: 'POST',
          body: jsonBody({
            flowId: requiredIdentifier(input.flowId, 'flowId'),
            matrixUserId: clean(input.matrixUserId)
          })
        });
      }
      if (action === 'provisioning-login-input') {
        return apiRequest(`/api/r32/accounts/${id}/provisioning/login/input`, {
          method: 'POST',
          body: jsonBody({
            loginProcessId: requiredIdentifier(input.loginProcessId, 'loginProcessId'),
            stepId: requiredIdentifier(input.stepId, 'stepId'),
            input: objectRecord(input.input),
            matrixUserId: clean(input.matrixUserId)
          })
        });
      }
      if (action === 'provisioning-login-wait') {
        return apiRequest(`/api/r32/accounts/${id}/provisioning/login/wait`, {
          method: 'POST',
          body: jsonBody({
            loginProcessId: requiredIdentifier(input.loginProcessId, 'loginProcessId'),
            stepId: requiredIdentifier(input.stepId, 'stepId'),
            matrixUserId: clean(input.matrixUserId)
          })
        });
      }
      if (action === 'provisioning-login-cancel') {
        return apiRequest(`/api/r32/accounts/${id}/provisioning/login/cancel`, {
          method: 'POST',
          body: jsonBody({
            loginProcessId: clean(input.loginProcessId),
            matrixUserId: clean(input.matrixUserId)
          })
        });
      }
      if (action === 'provisioning-direct-chat-ensure') {
        return apiRequest(`/api/r32/accounts/${id}/provisioning/direct-chat/ensure`, {
          method: 'POST',
          body: jsonBody({
            identifier: requiredIdentifier(input.identifier, 'identifier'),
            matrixUserId: clean(input.matrixUserId)
          })
        });
      }
      if (action === 'facebook-page-inboxes') {
        return apiRequest(`/api/r32/accounts/${id}/facebook/page/inboxes`);
      }
      if (action === 'facebook-page-attach') {
        return apiRequest(`/api/r32/accounts/${id}/facebook/page/attach`, {
          method: 'POST',
          body: jsonBody({
            inboxId: requiredIdentifier(input.inboxId, 'inboxId'),
            pageId: requiredIdentifier(input.pageId, 'pageId')
          })
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
      if (action === 'facebook-oauth-cancel') {
        return apiRequest(`/api/r32/accounts/${id}/facebook/oauth/cancel`, {
          method: 'POST',
          body: jsonBody({ flowId: requiredIdentifier(input.flowId, 'flowId') })
        });
      }
      throw Object.assign(new Error('Unsupported platform account command'), {
        code: 'PLATFORM_ACCOUNT_COMMAND_UNSUPPORTED',
        reasonCode: 'PLATFORM_ACCOUNT_COMMAND_UNSUPPORTED'
      });
    },
    [CHANNELS.matrixDirectProjection]: (_event, input = {}) => apiRequest('/api/r32/workspace/matrix-direct-projection', {
      method: 'POST',
      body: jsonBody(input || {})
    }),    [CHANNELS.platformAccountsList]: (_event, input = {}) => {
      const matrixUserId = clean(input.matrixUserId);
      return apiRequest(`/api/r32/accounts${matrixUserId ? `?matrixUserId=${encodeURIComponent(matrixUserId)}` : ''}`);
    },
    [CHANNELS.platformAccountCapabilities]: () => apiRequest('/api/r32/accounts/capabilities'),
    [CHANNELS.platformAccountAudit]: (_event, input = {}) => {
      const limit = clean(input.limit);
      return apiRequest(`/api/r32/accounts/audit${limit ? `?limit=${encodeURIComponent(limit)}` : ''}`);
    },
    [CHANNELS.platformAccountConnect]: (_event, input = {}) => apiRequest(`/api/r32/accounts/${safeRouteSegment(input.id, 'id')}/connect`, {
      method: 'POST',
      body: jsonBody({ matrixUserId: clean(input.matrixUserId) })
    }),
    [CHANNELS.platformAccountReconnect]: (_event, input = {}) => apiRequest(`/api/r32/accounts/${safeRouteSegment(input.id, 'id')}/reconnect`, {
      method: 'POST',
      body: jsonBody({ matrixUserId: clean(input.matrixUserId) })
    }),
    [CHANNELS.platformAccountSync]: (_event, input = {}) => apiRequest(`/api/r32/accounts/${safeRouteSegment(input.id, 'id')}/sync`, {
      method: 'POST',
      body: jsonBody({ matrixUserId: clean(input.matrixUserId) })
    }),
    [CHANNELS.platformAccountsSyncAll]: () => apiRequest('/api/r32/accounts/actions/sync-all', {
      method: 'POST',
      body: '{}'
    }),
    [CHANNELS.aiWorkspaceLoad]: () => apiRequest('/api/r32/workspace/ai-workspace'),
    [CHANNELS.aiWorkspaceCreateTask]: (_event, input = {}) => apiRequest('/api/r32/workspace/ai-workspace/tasks', {
      method: 'POST',
      body: jsonBody(input || {})
    }),
    [CHANNELS.aiWorkspaceUpdateTask]: (_event, input = {}) => apiRequest(
      `/api/r32/workspace/ai-workspace/tasks/${safeRouteSegment(input.id, 'id')}`,
      { method: 'PUT', body: jsonBody(input.task || input || {}) }
    ),
    [CHANNELS.aiWorkspaceRunTask]: (_event, input = {}) => apiRequest(
      `/api/r32/workspace/ai-workspace/tasks/${safeRouteSegment(input.id, 'id')}/run`,
      { method: 'POST', body: '{}' }
    ),
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
    [CHANNELS.productRuntimeSafeExitPrepare]: async (_event, input = {}) => {
      const response = await apiRequest('/api/core/command', {
        method: 'POST',
        body: jsonBody({
          command: 'recovery.prepareSafeModeExit',
          payload: {
            confirmation: 'EXIT_SAFE_MODE',
            reason: clean(input.reason) || 'product-system-settings'
          },
          context: { actor: 'product-system-settings' }
        })
      });
      return objectRecord(response.result);
    },
    [CHANNELS.productModelRuntimeState]: async () => {
      const [modelBrain, modelStatus, catalog, hardware, adaptiveLocal] = await Promise.all([
        apiRequest('/api/r32/models/model-brain/status'),
        apiRequest('/api/r32/models/status'),
        apiRequest('/api/r32/models/adaptive-local/catalog'),
        apiRequest('/api/r32/models/adaptive-local/hardware'),
        apiRequest('/api/r32/models/adaptive-local/status')
      ]);
      return {
        ok: true,
        modelBrain: objectRecord(modelBrain),
        modelStatus: objectRecord(modelStatus),
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
        'set-local-model-enabled',
        'delete-local-model',
        'pull-ollama-model',
        'cancel-ollama-pull',
        'scan-local-models',
        'configure-openrouter',
        'set-model-brain-preferences',
        'set-task-model-policy',
        'qualify-model',
        'validate-logical-task',
        'discover-compatible-cloud',
        'register-compatible-cloud'
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
      if (action === 'set-local-model-enabled') {
        const modelId = requiredIdentifier(input.modelId, 'modelId');
        return apiRequest(`/api/r32/models/${encodeURIComponent(modelId)}/lifecycle`, {
          method: 'PATCH',
          body: jsonBody({
            enabled: input.enabled === true,
            reason: clean(input.reason) || 'product-model-center'
          })
        });
      }
      if (action === 'delete-local-model') {
        const modelId = requiredIdentifier(input.modelId, 'modelId');
        return apiRequest(`/api/r32/models/local/${encodeURIComponent(modelId)}`, {
          method: 'DELETE',
          body: jsonBody({ confirmName: requiredIdentifier(input.confirmName, 'confirmName') })
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
      if (action === 'scan-local-models') {
        return apiRequest('/api/r32/models/scan', { method: 'POST', body: jsonBody({}) });
      }
      if (action === 'configure-openrouter') {
        return apiRequest('/api/r32/models/cloud/openrouter/auto-configure', {
          method: 'POST',
          body: jsonBody({ credentialRef: requiredIdentifier(input.credentialRef, 'credentialRef') })
        });
      }
      if (action === 'set-model-brain-preferences') {
        const reasoningLevel = requiredAction(input.reasoningLevel, [
          'minimum', 'low', 'medium', 'high', 'very_high', 'maximum', 'ultra'
        ], 'reasoningLevel');
        return apiRequest('/api/r32/models/model-brain/preferences', {
          method: 'PUT',
          body: jsonBody({ reasoningLevel, fastMode: input.fastMode === true })
        });
      }
      if (action === 'set-task-model-policy') {
        const task = requiredAction(input.task, [
          'translation', 'understanding', 'relationship', 'director',
          'quick_reply', 'deep_reply', 'fact_extraction', 'memory_extraction'
        ], 'task');
        const mode = requiredAction(input.mode, ['auto', 'manual'], 'mode');
        return apiRequest(`/api/r32/models/model-brain/preferences/${encodeURIComponent(task)}`, {
          method: 'PUT',
          body: jsonBody({
            mode,
            primaryModelId: mode === 'manual' ? requiredIdentifier(input.primaryModelId, 'primaryModelId') : '',
            fallbackModelId: mode === 'manual' ? clean(input.fallbackModelId) : ''
          })
        });
      }
      if (action === 'qualify-model') {
        const modelId = requiredIdentifier(input.modelId, 'modelId');
        const tests = Array.isArray(input.tests) ? input.tests.map(clean).filter(Boolean) : undefined;
        return apiRequest(`/api/r32/models/${encodeURIComponent(modelId)}/test`, {
          method: 'POST',
          body: jsonBody({ tests, timeoutMs: Math.max(1000, Number(input.timeoutMs || 180000)) })
        });
      }
      if (action === 'validate-logical-task') {
        const task = requiredAction(input.task, [
          'translation', 'understanding', 'relationship', 'director',
          'quick_reply', 'deep_reply', 'fact_extraction', 'memory_extraction'
        ], 'task');
        const messages = (Array.isArray(input.messages) ? input.messages : []).slice(0, 8).map(row => ({
          role: ['system', 'user', 'assistant'].includes(clean(row?.role).toLowerCase()) ? clean(row.role).toLowerCase() : 'user',
          content: String(row?.content || '').slice(0, 12000)
        })).filter(row => row.content.trim());
        if (!messages.length) throw Object.assign(new Error('messages are required'), { code: 'MESSAGES_REQUIRED', reasonCode: 'MESSAGES_REQUIRED' });
        return apiRequest('/api/r32/models/execute', {
          method: 'POST',
          body: jsonBody({
            task,
            messages,
            options: {
              timeoutMs: Math.max(1000, Math.min(180000, Number(input.timeoutMs || 120000))),
              maxTokens: Math.max(1, Math.min(1024, Number(input.maxTokens || 256))),
              temperature: Math.max(0, Math.min(2, Number(input.temperature || 0)))
            }
          })
        });
      }
      if (action === 'discover-compatible-cloud') {
        return apiRequest('/api/r32/models/cloud/discover', {
          method: 'POST',
          body: jsonBody({
            endpoint: requiredIdentifier(input.endpoint, 'endpoint'),
            credentialRef: requiredIdentifier(input.credentialRef, 'credentialRef')
          })
        });
      }
      if (action === 'register-compatible-cloud') {
        return apiRequest('/api/r32/models/cloud', {
          method: 'POST',
          body: jsonBody({
            name: requiredIdentifier(input.model, 'model'),
            endpoint: requiredIdentifier(input.endpoint, 'endpoint'),
            credentialRef: requiredIdentifier(input.credentialRef, 'credentialRef'),
            provider: 'openai-compatible',
            verify: true,
            testVision: input.testVision === true
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
