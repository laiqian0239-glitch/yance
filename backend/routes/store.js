'use strict';

const express = require('express');
const aiGateway = require('../services/aiGateway');
const eventBus = require('../services/eventBus');
const productionDiagnostics = require('../services/productionDiagnosticsService');
const { getStoreManager } = require('../store/storeManagerSingleton');
const themeAppearancePolicy = require('../store/themeAppearancePolicy');
const { getStore } = require('../repositories/storeProvider');
const workspaceRepository = require('../repositories/workspaceRepository');
const { selectCustomerSocialContext } = require('../store/selectors/customerSocialSelectors');
const contactContextAuthority = require('../services/contactContextAuthority');
const { createContextAwareReplyBrain } = require('../services/contextAwareReplyBrain');
const { ensureCustomerContext } = require('../services/storeManagerService');
const bilingualUnderstandingService = require('../services/bilingualUnderstandingService');
const messageTranslationService = require('../services/messageTranslationService');
const contactLanguageAuthority = require('../services/contactLanguageAuthority');
const socialChineseUnderstandingService = require('../services/socialChineseUnderstandingService');
const candidateInteractionLearningService = require('../services/candidateInteractionLearningService').singleton;
const identityGovernanceService = require('../services/identityGovernanceService').singleton;
const domainEventProjectionAuthority = require('../services/domainEventProjectionAuthority').singleton;
const { singleton: platformCoreRepository } = require('../repositories/platformCoreRepository');
const personContextAuthority = require('../services/personContextAuthority').singleton;
const { personScopeForContact } = require('../services/personFeedbackMutationAuthority');
const { createHttpAbortScope } = require('../lib/httpAbortScope');
const replyFeedbackLearningService = require('../services/replyFeedbackLearningService');

const router = express.Router();

function clean(value) {
  return String(value == null ? '' : value).trim();
}

const SECRET_KEY = /(secret|token|session|credential|password|api[_-]?key|private[_-]?key|access[_-]?token)/i;

function redactSecrets(value, seen = new WeakSet()) {
  if (value == null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map(item => redactSecrets(item, seen));
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    output[key] = SECRET_KEY.test(key) ? '[redacted]' : redactSecrets(child, seen);
  }
  return output;
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function canonicalContactId(reference) {
  const requested = clean(reference);
  const resolved = workspaceRepository.resolveContactReference(requested);
  return clean(resolved?.contact?.id || requested);
}

router.get('/status', (_req, res) => {
  const storeManager = getStoreManager();
  res.json({
    ok: true,
    hydrated: storeManager.hydrated,
    stateVersion: storeManager.stateVersion,
    meta: storeManager.select(state => state.meta)
  });
});

router.get('/snapshot', (req, res) => {
  const storeManager = getStoreManager();
  const requested = clean(req.query.domains)
    .split(',')
    .map(clean)
    .filter(Boolean);
  const allowed = new Set(['auth', 'ui', 'customers', 'conversations', 'typingState', 'relationships', 'memories', 'interactionPolicies', 'models', 'routing', 'aiBrain', 'outbox', 'system']);
  const domains = requested.filter(domain => allowed.has(domain));
  const snapshot = storeManager.snapshot({
    domains: domains.length ? domains : ['ui', 'customers', 'conversations', 'typingState', 'relationships', 'interactionPolicies', 'models', 'routing', 'aiBrain', 'outbox'],
    redact: redactSecrets
  });
  res.json({ ok: true, stateVersion: storeManager.stateVersion, snapshot });
});

router.put('/ui/reading-mode', asyncRoute(async (req, res) => {
  const storeManager = getStoreManager();
  const result = await storeManager.dispatch({
    type: 'SET_UI_READING_MODE',
    source: 'user-ui-settings',
    payload: {
      readingMode: req.body?.readingMode,
      density: req.body?.density,
      contrastMode: req.body?.contrastMode
    }
  });
  res.json({ ok: true, ...result.result, stateVersion: result.stateVersion });
}));

router.get('/ui/theme/catalog', (_req, res) => {
  const { catalog, THEMES, DEFAULT_THEME_ID, DEFAULT_LIGHT_THEME_ID, DEFAULT_DARK_THEME_ID } = themeAppearancePolicy;
  res.set('Cache-Control', 'no-store').json({
    ok: true,
    version: Number(catalog.version || 1),
    defaultThemeId: DEFAULT_THEME_ID,
    lightDefaultThemeId: DEFAULT_LIGHT_THEME_ID,
    darkDefaultThemeId: DEFAULT_DARK_THEME_ID,
    themes: THEMES.map(theme => ({
      id: theme.id,
      name: theme.name,
      description: theme.description,
      brightness: theme.brightness,
      style: theme.style,
      scenes: Array.isArray(theme.scenes) ? [...theme.scenes] : [],
      texture: theme.texture,
      series: theme.series,
      accessibility: theme.accessibility,
      defaults: { ...(theme.defaults || {}) },
      tokens: { ...(theme.tokens || {}) }
    }))
  });
});

router.put('/ui/theme/preview', asyncRoute(async (req, res) => {
  const result = await getStoreManager().dispatch({
    type: 'PREVIEW_THEME', source: 'user-theme-preview', payload: { themeId: req.body?.themeId }
  });
  res.json({ ok: true, ...result.result, stateVersion: result.stateVersion });
}));

router.put('/ui/theme/cancel-preview', asyncRoute(async (_req, res) => {
  const result = await getStoreManager().dispatch({
    type: 'CANCEL_THEME_PREVIEW', source: 'user-theme-preview'
  });
  res.json({ ok: true, ...result.result, stateVersion: result.stateVersion });
}));

router.put('/ui/theme/apply', asyncRoute(async (req, res) => {
  const result = await getStoreManager().dispatch({
    type: 'APPLY_THEME', source: 'user-theme-settings', payload: { themeId: req.body?.themeId }
  });
  res.json({ ok: true, ...result.result, stateVersion: result.stateVersion });
}));

router.put('/ui/motion-level', asyncRoute(async (req, res) => {
  const result = await getStoreManager().dispatch({
    type: 'SET_UI_MOTION_LEVEL', source: 'user-theme-settings', payload: { motionLevel: req.body?.motionLevel }
  });
  res.json({ ok: true, ...result.result, stateVersion: result.stateVersion });
}));

router.put('/ui/background-effect', asyncRoute(async (req, res) => {
  const result = await getStoreManager().dispatch({
    type: 'SET_UI_BACKGROUND_EFFECT', source: 'user-theme-settings', payload: { backgroundEffect: req.body?.backgroundEffect }
  });
  res.json({ ok: true, ...result.result, stateVersion: result.stateVersion });
}));

router.put('/ui/theme/preferences', asyncRoute(async (req, res) => {
  const result = await getStoreManager().dispatch({
    type: 'UPDATE_THEME_PREFERENCES', source: 'user-theme-settings', payload: req.body || {}
  });
  res.json({ ok: true, ...result.result, stateVersion: result.stateVersion });
}));

router.post('/ui/theme/presets', asyncRoute(async (req, res) => {
  const result = await getStoreManager().dispatch({
    type: 'SAVE_CUSTOM_THEME_PRESET', source: 'user-theme-settings', payload: req.body || {}
  });
  res.json({ ok: true, ...result.result, stateVersion: result.stateVersion });
}));

router.post('/ui/theme/presets/:presetId/apply', asyncRoute(async (req, res) => {
  const result = await getStoreManager().dispatch({
    type: 'APPLY_CUSTOM_THEME_PRESET', source: 'user-theme-settings', payload: { presetId: req.params.presetId }
  });
  res.json({ ok: true, ...result.result, stateVersion: result.stateVersion });
}));

router.delete('/ui/theme/presets/:presetId', asyncRoute(async (req, res) => {
  const result = await getStoreManager().dispatch({
    type: 'DELETE_CUSTOM_THEME_PRESET', source: 'user-theme-settings', payload: { presetId: req.params.presetId }
  });
  res.json({ ok: true, ...result.result, stateVersion: result.stateVersion });
}));

router.get('/search', (req, res) => {
  const query = clean(req.query?.q);
  const limit = Math.max(1, Math.min(200, Number(req.query?.limit || 80)));
  if (!query) return res.json({ ok: true, query: '', contacts: [], messages: [] });
  const lower = query.toLowerCase();
  const storeManager = getStoreManager();
  const store = getStore();
  const snapshot = storeManager.select(state => ({
    customers: Object.values(state.customers.byId || {}),
    memories: state.memories.byContactId || {}
  }));
  const contacts = snapshot.customers.filter(customer => {
    const memory = snapshot.memories[customer.id] || {};
    const haystack = [
      customer.displayName, customer.name, customer.phone, customer.externalId,
      customer.platform, ...(Array.isArray(customer.tags) ? customer.tags : []),
      JSON.stringify(memory.confirmedFacts || []), JSON.stringify(memory.userNotes || [])
    ].join('\n').toLowerCase();
    return haystack.includes(lower);
  }).slice(0, Math.min(60, limit)).map(customer => ({
    id: clean(customer.id),
    contactId: clean(customer.contactId || customer.id),
    conversationId: clean(customer.conversationId || customer.sessionKey || customer.id),
    name: clean(customer.displayName || customer.name || customer.phone || customer.externalId),
    phone: clean(customer.phone),
    platform: clean(customer.platform),
    avatarUrl: clean(customer.avatarUrl || customer.avatar),
    tags: Array.isArray(customer.tags) ? customer.tags : []
  }));
  const messages = store.searchMessages(query, { limit }).map(row => {
    const full = store.getMessage(row.id) || row;
    const customer = snapshot.customers.find(item => clean(item.conversationId || item.sessionKey || item.id) === clean(row.sessionKey)) || null;
    return {
      id: clean(row.id),
      messageId: clean(row.id),
      conversationId: clean(row.sessionKey),
      contactId: clean(customer?.contactId || customer?.id),
      contactName: clean(customer?.displayName || customer?.name || customer?.phone || customer?.externalId),
      platform: clean(customer?.platform),
      text: clean(full.text),
      translatedZh: clean(full.translatedZh || full.chineseTranslation || full.translationZh),
      sourceLanguage: clean(full.sourceLanguage || full.language),
      direction: clean(row.direction),
      messageType: clean(row.messageType),
      sentAt: clean(row.sentAt),
      rank: Number(row.rank || 0)
    };
  });
  res.json({ ok: true, query, contacts, messages });
});

router.get('/customers/:contactId/social-context', (req, res) => {
  const storeManager = getStoreManager();
  const requestedReference = clean(req.params.contactId);
  const resolved = workspaceRepository.resolveContactReference(requestedReference);
  const contactId = clean(resolved?.contact?.id || requestedReference);
  const context = contactContextAuthority.getSocialContext(contactId, {
    storeManager,
    timelineLimit: Number(req.query.timelineLimit || 24),
    recentMessageLimit: Number(req.query.recentMessageLimit || 60)
  });
  if (!context.found) {
    const workspaceContact = resolved?.contact || workspaceRepository.getContact(contactId);
    if (workspaceContact) {
      return res.json({
        ok: true,
        context: {
          found: false,
          syncing: true,
          ready: false,
          contactId: clean(workspaceContact.id || contactId),
          requestedReference,
          displayName: clean(workspaceContact.displayName || workspaceContact.name || workspaceContact.phone || workspaceContact.externalId),
          platform: clean(workspaceContact.platform),
          stateVersion: storeManager.stateVersion,
          status: 'customer_projection_syncing'
        }
      });
    }
    return res.status(404).json({ ok: false, code: 'CUSTOMER_NOT_FOUND', message: '客户不存在' });
  }
  res.json({ ok: true, context: redactSecrets({ ...context, requestedReference }) });
});

router.get('/customers/:contactId/timeline', (req, res) => {
  const storeManager = getStoreManager();
  const contactId = canonicalContactId(req.params.contactId);
  const person = personContextAuthority.snapshot({ contactId });
  const timeline = person.found
    ? person.timeline
    : storeManager.select(state => state.relationships.byContactId[contactId]?.timeline || []);
  const limit = Math.max(1, Math.min(500, Number(req.query.limit || 100)));
  const page = person.found ? timeline.slice(0, limit) : timeline.slice(-limit);
  res.json({ ok: true, contactId, personId: person.personId || '', contactIds: person.contactIds || [contactId], stateVersion: storeManager.stateVersion, timeline: page });
});

router.post('/translations/chinese', asyncRoute(async (req, res) => {
  const result = await bilingualUnderstandingService.translateToChinese({
    text: req.body?.text,
    sourceLanguage: req.body?.sourceLanguage || req.body?.language,
    modelId: req.body?.modelId,
    timeoutMs: req.body?.timeoutMs,
    dedupeKey: req.body?.dedupeKey,
    fingerprint: req.body?.fingerprint
  }, { aiGateway });
  const status = result.translationStatus === 'failed' ? 503 : 200;
  res.status(status).json({ ok: result.translationStatus !== 'failed', translation: result });
}));

router.post('/translations/messages/:messageId', asyncRoute(async (req, res) => {
  const result = await messageTranslationService.translateMessage(req.params.messageId, {
    force: req.body?.force === true,
    timeoutMs: req.body?.timeoutMs
  });
  if (result.status === 'not-found') return res.status(404).json({ ok: false, code: 'MESSAGE_NOT_FOUND', message: '消息不存在' });
  res.status(result.status === 'failed' ? 503 : 200).json({ ok: result.status !== 'failed', ...result });
}));

router.post('/translations/messages/:messageId/jobs', asyncRoute(async (req, res) => {
  const job = messageTranslationService.createJob(req.params.messageId, {
    force: req.body?.force === true,
    timeoutMs: req.body?.timeoutMs,
    forceNew: req.body?.forceNew === true
  });
  res.status(202).json({ ok: true, job });
}));

router.get('/translations/jobs/:jobId', (req, res) => {
  const job = messageTranslationService.getJob(req.params.jobId);
  if (!job) return res.status(404).json({ ok: false, code: 'TRANSLATION_JOB_NOT_FOUND', message: '翻译任务不存在' });
  res.json({ ok: true, job });
});

router.delete('/translations/jobs/:jobId', (req, res) => {
  const job = messageTranslationService.cancelJob(req.params.jobId);
  if (!job) return res.status(404).json({ ok: false, code: 'TRANSLATION_JOB_NOT_FOUND', message: '翻译任务不存在' });
  res.json({ ok: true, job });
});

router.post('/translations/jobs/:jobId/retry', asyncRoute(async (req, res) => {
  const job = messageTranslationService.retryJob(req.params.jobId, { timeoutMs: req.body?.timeoutMs });
  res.status(202).json({ ok: true, job });
}));

router.get('/translations/jobs', (req, res) => {
  res.json({ ok: true, jobs: messageTranslationService.listJobs({ messageId: req.query?.messageId, limit: req.query?.limit }) });
});

router.get('/customers/:contactId/language', (req, res) => {
  const contactId = canonicalContactId(req.params.contactId);
  const languageProfile = contactLanguageAuthority.read({
    contactId,
    conversationId: req.query?.conversationId,
    platform: req.query?.platform,
    sourceAccountId: req.query?.sourceAccountId,
    platformContactIdentity: req.query?.platformContactIdentity,
    canonicalContactId: req.query?.canonicalContactId
  });
  res.json({ ok: true, contactId, requestedContactId: clean(req.params.contactId), languageProfile });
});

router.put('/customers/:contactId/language', (req, res) => {
  const contactId = canonicalContactId(req.params.contactId);
  const languageProfile = contactLanguageAuthority.setUserOverride({
    contactId,
    conversationId: req.body?.conversationId,
    platform: req.body?.platform,
    sourceAccountId: req.body?.sourceAccountId,
    platformContactIdentity: req.body?.platformContactIdentity,
    canonicalContactId: req.body?.canonicalContactId
  }, req.body?.language);
  res.json({ ok: true, contactId, requestedContactId: clean(req.params.contactId), languageProfile });
});

router.put('/conversations/:conversationId/automation-mode', asyncRoute(async (req, res) => {
  const storeManager = getStoreManager();
  const conversationId = clean(req.params.conversationId);
  const contactId = await ensureCustomerContext(storeManager, conversationId, clean(req.body?.contactId));
  const result = await storeManager.dispatch({
    type: 'CONVERSATION_AI_AUTOMATION_MODE_SET',
    source: 'conversation-center',
    payload: {
      conversationId,
      contactId,
      mode: req.body?.mode,
      actor: clean(req.body?.actor) || 'user'
    }
  });
  res.json({
    ok: true,
    conversationId,
    contactId,
    mode: result.result?.mode,
    automationModeReceipt: result.result?.automationModeReceipt || null,
    authority: 'Store.interactionPolicies'
  });
}));

router.post('/replies/generate', asyncRoute(async (req, res) => {
  const requestAbort = createHttpAbortScope(req, res, { code: 'AI_REPLY_CLIENT_DISCONNECTED' });
  const operationId = productionDiagnostics.beginOperation({
    command: 'ai.reply.generate',
    actor: 'conversation-center',
    resource: 'reply-candidate',
    lifecycleState: 'reading-context'
  });
  try {
    const storeManager = getStoreManager();
    const conversationId = clean(req.body?.conversationId);
    const resolvedContactId = await ensureCustomerContext(storeManager, conversationId, clean(req.body?.contactId));
    const brain = createContextAwareReplyBrain({
      storeManager,
      aiGateway,
      resolveContactId: (nextConversationId, hint) => ensureCustomerContext(storeManager, nextConversationId, hint)
    });
    const progress = { lastAt: 0, text: '' };
    const common = {
      contactId: resolvedContactId,
      conversationId,
      incomingMessage: req.body?.incomingMessage || {},
      modelId: req.body?.modelId,
      temperature: req.body?.temperature,
      maxTokens: req.body?.maxTokens,
      replyTask: req.body?.replyTask,
      performanceMode: req.body?.performanceMode,
      aggregateIncoming: req.body?.aggregateIncoming !== false,
      source: req.body?.source,
      signal: requestAbort.signal,
      onToken: (_token, accumulated) => {
        progress.text = clean(accumulated);
        const now = Date.now();
        if (now - progress.lastAt < 90) return;
        progress.lastAt = now;
        eventBus.publish('ai:reply-progress', {
          contactId: resolvedContactId,
          conversationId,
          text: progress.text.slice(-500),
          done: false
        });
      },
      director: req.body?.director || {}
    };
    const result = clean(req.body?.manualText)
      ? await brain.createManualCandidate({
        ...common,
        manualText: req.body.manualText,
        contextMessageIds: req.body?.contextMessageIds || []
      })
      : await brain.generateCandidate(common);
    eventBus.publish('ai:reply-progress', {
      contactId: resolvedContactId,
      conversationId,
      text: clean(result?.text || progress.text).slice(-500),
      done: true
    });
    productionDiagnostics.completeOperation(operationId, {
      ok: true,
      lifecycleState: 'candidate-ready',
      code: 'AI_REPLY_CANDIDATE_READY',
      message: '真实候选已生成并进入人工确认流程',
      metadata: {
        candidateId: clean(result?.candidateId),
        taskId: clean(result?.taskId),
        modelId: clean(result?.modelId),
        replyTask: clean(result?.replyTask || req.body?.replyTask || 'quick_reply'),
        source: clean(req.body?.source || 'ai_routed_model'),
        requiresUserApproval: true
      }
    });
    res.status(201).json({
      ok: true,
      candidate: result,
      requiresUserApproval: true,
      automaticSend: false,
      operationId
    });
  } catch (error) {
    productionDiagnostics.completeOperation(operationId, {
      ok: false,
      lifecycleState: 'candidate-failed',
      code: clean(error?.code || error?.reasonCode || 'AI_REPLY_GENERATION_FAILED'),
      message: clean(error?.message || '候选生成失败'),
      metadata: { replyTask: clean(req.body?.replyTask || 'quick_reply'), source: clean(req.body?.source || 'ai_routed_model') }
    });
    throw error;
  } finally {
    requestAbort.dispose();
  }
}));

router.post('/replies/:candidateId/approve', asyncRoute(async (req, res) => {
  const storeManager = getStoreManager();
  const result = await storeManager.dispatch({
    type: 'AI_REPLY_CANDIDATE_APPROVED',
    source: 'user-review-api',
    payload: {
      candidateId: req.params.candidateId,
      text: req.body?.text,
      userApproved: req.body?.userApproved === true,
      approvedBy: clean(req.body?.approvedBy) || 'user',
      learningMode: req.body?.learningMode,
      source: req.body?.source
    }
  });
  res.json({ ok: true, ...result.result, requiresSendConfirmation: true });
}));

router.post('/replies/:candidateId/reject', asyncRoute(async (req, res) => {
  const storeManager = getStoreManager();
  const result = await storeManager.dispatch({
    type: 'AI_REPLY_CANDIDATE_REJECTED',
    source: 'user-review-api',
    payload: {
      candidateId: req.params.candidateId,
      reason: req.body?.reason
    }
  });
  res.json({ ok: true, ...result.result, learningQueued: true });
}));

router.post('/replies/:candidateId/interactions', asyncRoute(async (req, res) => {
  const result = candidateInteractionLearningService.record({
    candidateId: req.params.candidateId,
    signalType: req.body?.signalType,
    interactionId: req.body?.interactionId,
    interactionMode: req.body?.interactionMode,
    finalText: req.body?.finalText,
    adjustments: Array.isArray(req.body?.adjustments) ? req.body.adjustments : [],
    observedAt: req.body?.observedAt,
    source: 'conversation-ui'
  });
  res.status(201).json({ ok: true, learning: result });
}));

router.patch('/outbox/:outboxId/text', asyncRoute(async (req, res) => {
  const storeManager = getStoreManager();
  const result = await storeManager.dispatch({
    type: 'OUTBOX_TEXT_REVISED',
    source: 'user-review-api',
    payload: {
      outboxId: req.params.outboxId,
      text: req.body?.text,
      userConfirmedRevision: req.body?.userConfirmedRevision === true
    }
  });
  res.json({ ok: true, ...result.result, requiresSendConfirmation: true });
}));

router.post('/outbox/:outboxId/send', asyncRoute(async (req, res) => {
  const storeManager = getStoreManager();
  const result = await storeManager.dispatch({
    type: 'OUTBOX_SEND_CONFIRMED',
    source: 'user-send-confirmation-api',
    payload: {
      outboxId: req.params.outboxId,
      confirmSend: req.body?.confirmSend === true,
      quoted: req.body?.quoted || null
    }
  });
  res.status(202).json({ ok: true, ...result.result, state: 'send_confirmed' });
}));

function legacyLearningMutationRetired(res, operation) {
  return res.status(409).json({
    ok: false,
    reasonCode: 'LEGACY_LEARNING_PROFILE_MUTATION_RETIRED',
    operation,
    authority: 'Learning V4 evidence/proposal/evaluation/promotion',
    automaticProfileMutation: false,
    automaticPromotion: false,
    reviewRequired: true
  });
}

router.get('/customers/:contactId/reply-feedback', asyncRoute(async (req, res) => {
  const contactId = canonicalContactId(req.params.contactId);
  const scope = personScopeForContact(contactId);
  const person = personContextAuthority.snapshot({ contactId: scope.contactId });
  const signals = Array.isArray(person.learning?.learningSignals) ? person.learning.learningSignals : [];
  const events = Array.isArray(person.learning?.feedbackEvents) ? person.learning.feedbackEvents : [];
  res.json({
    ok: true,
    contactId: scope.contactId,
    personId: scope.personId,
    contactIds: scope.contactIds,
    authority: 'Learning V4 immutable evidence',
    signals,
    historicalFeedbackEvents: events,
    automaticProfileMutation: false,
    rawPrivateChatTraining: false,
    status: replyFeedbackLearningService.status()
  });
}));

router.post('/customers/:contactId/reply-feedback/restore', asyncRoute(async (_req, res) => legacyLearningMutationRetired(res, 'restore-profile')));
router.delete('/customers/:contactId/reply-feedback', asyncRoute(async (_req, res) => legacyLearningMutationRetired(res, 'reset-profile')));

router.get('/customers/:contactId/learning-governance', asyncRoute(async (req, res) => {
  const contactId = canonicalContactId(req.params.contactId);
  const scope = personScopeForContact(contactId);
  const person = personContextAuthority.snapshot({ contactId: scope.contactId });
  res.json({
    ok: true,
    contactId: scope.contactId,
    personId: scope.personId,
    contactIds: scope.contactIds,
    governance: {
      authority: 'Learning V4 evidence/proposal/evaluation/promotion',
      signals: person.learning?.learningSignals || [],
      automaticProfileMutation: false,
      automaticPromotion: false,
      reviewRequired: true,
      privacy: { rawPrivateChatTraining: false, doNotLearnSupported: true }
    }
  });
}));
router.patch('/customers/:contactId/learning-governance/:scopeType/preferences/:key', asyncRoute(async (_req, res) => legacyLearningMutationRetired(res, 'mutate-profile-preference')));
router.post('/customers/:contactId/learning-governance/:scopeType/restore', asyncRoute(async (_req, res) => legacyLearningMutationRetired(res, 'restore-profile')));
router.delete('/customers/:contactId/learning-governance/forget', asyncRoute(async (_req, res) => legacyLearningMutationRetired(res, 'forget-profile')));

router.get('/identity-governance', asyncRoute(async (req, res) => {
  const governance = identityGovernanceService.overview({
    workspaceId: clean(req.query?.workspaceId) || 'default',
    personId: clean(req.query?.personId),
    contactId: clean(req.query?.contactId),
    limit: req.query?.limit, offset: req.query?.offset
  });
  res.json({ ok: true, governance });
}));

router.post('/identity-governance/links/:identityLinkId/:action', asyncRoute(async (req, res) => {
  const result = identityGovernanceService.transition({
    identityLinkId: clean(req.params.identityLinkId), action: clean(req.params.action),
    confidence: req.body?.confidence, verificationMethod: req.body?.verificationMethod,
    evidenceRefs: req.body?.evidenceRefs, actor: clean(req.body?.actor) || 'user',
    reason: clean(req.body?.reason), payload: req.body?.payload
  });
  res.json({ ok: true, result });
}));

router.post('/identity-governance/merge', asyncRoute(async (req, res) => {
  const result = identityGovernanceService.merge({
    sourcePersonId: clean(req.body?.sourcePersonId), targetPersonId: clean(req.body?.targetPersonId),
    evidenceRefs: req.body?.evidenceRefs, actor: clean(req.body?.actor) || 'user', reason: clean(req.body?.reason)
  });
  res.json({ ok: true, result });
}));

router.post('/identity-governance/merges/:auditId/rollback', asyncRoute(async (req, res) => {
  const result = identityGovernanceService.rollback({
    auditId: clean(req.params.auditId), evidenceRefs: req.body?.evidenceRefs,
    actor: clean(req.body?.actor) || 'user', reason: clean(req.body?.reason)
  });
  res.json({ ok: true, result });
}));

router.post('/identity-governance/audits/:auditId/rollback', asyncRoute(async (req, res) => {
  const result = identityGovernanceService.rollback({
    auditId: clean(req.params.auditId), evidenceRefs: req.body?.evidenceRefs,
    actor: clean(req.body?.actor) || 'user', reason: clean(req.body?.reason)
  });
  res.json({ ok: true, result });
}));

router.get('/event-projection/governance', asyncRoute(async (req, res) => {
  const blocking = domainEventProjectionAuthority.blocking({
    status: clean(req.query?.status), limit: req.query?.limit, offset: req.query?.offset
  });
  res.json({ ok: true, status: domainEventProjectionAuthority.snapshot(), ...blocking });
}));

router.post('/event-projection/audit', asyncRoute(async (req, res) => {
  const report = domainEventProjectionAuthority.auditExisting({
    pageSize: req.body?.pageSize, maximum: req.body?.maximum
  });
  res.status(report.converged ? 200 : 207).json({ ok: report.converged, report });
}));

router.post('/event-projection/events/:eventId/repair', asyncRoute(async (req, res) => {
  const result = await domainEventProjectionAuthority.repairEvent({
    eventId: clean(req.params.eventId), actor: clean(req.body?.actor) || 'user', reason: clean(req.body?.reason)
  });
  res.json({ ok: true, result });
}));

router.post('/event-projection/repair-blocking', asyncRoute(async (req, res) => {
  const report = await domainEventProjectionAuthority.repairBlocking({
    actor: clean(req.body?.actor) || 'user', reason: clean(req.body?.reason), maximum: req.body?.maximum
  });
  res.status(report.ok ? 200 : 207).json({ ok: report.ok, report });
}));

router.get('/learning-governance/automatic-synthesis/status', asyncRoute(async (_req, res) => {
  res.json({ ok: true, status: {
    authority: 'Learning V4 evidence/proposal/evaluation/promotion',
    automaticSynthesis: false,
    customScheduler: false,
    automaticProfileMutation: false,
    automaticPromotion: false,
    reviewRequired: true
  } });
}));

router.post('/learning-governance/automatic-synthesis/run', asyncRoute(async (_req, res) => legacyLearningMutationRetired(res, 'automatic-synthesis')));

router.get('/learning-governance/automatic-synthesis/overview', asyncRoute(async (req, res) => {
  const recentAudits = platformCoreRepository.listLearningPromotionAudits({ limit: req.query?.auditLimit || 100, offset: req.query?.auditOffset || 0 });
  res.json({
    ok: true,
    status: { authority: 'Learning V4', automaticSynthesis: false, customScheduler: false, reviewRequired: true },
    recentAudits,
    automaticProfileMutation: false,
    activeProfilesAreHistoricalOnly: true
  });
}));

router.post('/learning-governance/l3-proposals/:promotionId/approve', asyncRoute(async (_req, res) => legacyLearningMutationRetired(res, 'legacy-l3-approve')));
router.post('/learning-governance/l3-proposals/:promotionId/reject', asyncRoute(async (_req, res) => legacyLearningMutationRetired(res, 'legacy-l3-reject')));
router.post('/learning-governance/profiles/rollback', asyncRoute(async (_req, res) => legacyLearningMutationRetired(res, 'legacy-profile-rollback')));
router.post('/learning-governance/profiles/forget', asyncRoute(async (_req, res) => legacyLearningMutationRetired(res, 'legacy-profile-forget')));

router.post('/translations/structured', asyncRoute(async (req, res) => {
  const result = await socialChineseUnderstandingService.translateBundle({
    contactId: req.body?.contactId,
    conversationId: req.body?.conversationId,
    analysis: req.body?.analysis,
    profile: req.body?.profile,
    insights: req.body?.insights,
    modelId: req.body?.modelId,
    timeoutMs: req.body?.timeoutMs,
    maxTokens: req.body?.maxTokens,
    dedupeKey: req.body?.dedupeKey,
    fingerprint: req.body?.fingerprint
  }, { aiGateway });
  res.set('Cache-Control', 'no-store').status(200).json({
    ok: true,
    degraded: result.translationStatus !== 'success',
    translation: result
  });
}));

router.post('/customers/:contactId/corrections', asyncRoute(async (req, res) => {
  const storeManager = getStoreManager();
  const result = await storeManager.dispatch({
    type: 'CORRECT_SOCIAL_INFERENCE',
    source: 'user-correction-api',
    payload: {
      contactId: canonicalContactId(req.params.contactId),
      targetType: req.body?.targetType,
      targetId: req.body?.targetId,
      correction: req.body?.correction,
      reason: req.body?.reason,
      correctedBy: clean(req.body?.correctedBy) || 'user'
    }
  });
  res.json({ ok: true, ...result.result });
}));

module.exports = router;
module.exports.redactSecrets = redactSecrets;
