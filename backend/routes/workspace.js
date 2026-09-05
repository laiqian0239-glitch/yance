'use strict';

const express = require('express');
const workspace = require('../services/workspaceService');
const systemPolicy = require('../services/systemPolicy');
const aiAutomation = require('../services/aiBrainOrchestrator');
const workspaceData = require('../services/workspaceDataService');
const workspaceRepository = require('../repositories/workspaceRepository');
const chatExport = require('../services/chatExportService');
const outboundTranslationAuthority = require('../services/outboundTranslationAuthority');

// P0-B integration is bound once by AppRuntimeComposition to the broker-owned
// database capability. HTTP routes never acquire a primary store.
const { getWorkspaceIdentityCommandFacade } = require('../services/workspaceIdentityCommandFacade');

const router = express.Router();

function buildIdentityService() { return getWorkspaceIdentityCommandFacade().identityService; }
function buildMergeService() { return getWorkspaceIdentityCommandFacade().mergeService; }
function buildKeyNodeService() { return getWorkspaceIdentityCommandFacade().keyNodeService; }

// 把稳定契约的 CoreError.code 映射到 HTTP 状态，便于前端接线。
function respondError(res, error) {
  const code = error && error.code;
  let status = 500;
  if (code === 'VERSION_CONFLICT' || code === 'STORE_VERSION_CONFLICT' || code === 'ALREADY_MERGED' || code === 'NOT_APPLIED' || code === 'CUSTOMER_PROFILE_ASSOCIATION_CONFLICT' || code === 'CUSTOMER_PERSONA_ASSOCIATION_CONFLICT' || code === 'CONTACT_REFERENCE_AMBIGUOUS' || code === 'CONVERSATION_REFERENCE_AMBIGUOUS') status = 409;
  else if (code === 'INVALID_INPUT' || code === 'KEY_NODE_KIND_INVALID' || code === 'UNSAFE_CUSTOMER_ASSOCIATION_EVIDENCE') status = 400;
  else if (code === 'CONTACT_NOT_FOUND' || code === 'SURVIVOR_NOT_FOUND' || code === 'MERGED_NOT_FOUND' || code === 'KEY_NODE_EVENT_NOT_FOUND' || code === 'JOURNAL_NOT_FOUND') status = 404;
  res.status(status).json({ ok: false, error: { code: code || 'INTERNAL_ERROR', message: (error && error.message) ? error.message : 'internal error' } });
}

router.get('/bootstrap', (req, res, next) => {
  try {
    res.json(workspace.bootstrap({
      conversationLimit: Number(req.query.conversationLimit || 250),
      conversationOffset: Number(req.query.conversationOffset || 0),
      messageLimit: Number(req.query.messageLimit || 120)
    }));
  } catch (error) { next(error); }
});

router.get('/conversations/:sessionKey/outbound-language', (req, res, next) => {
  try {
    const authority = outboundTranslationAuthority.targetAuthority({
      sessionKey: req.params.sessionKey,
      conversationId: req.params.sessionKey
    });
    res.json({
      ok: true,
      sessionKey: req.params.sessionKey,
      authority,
      automaticTranslation: authority.verifiable === true && authority.code !== 'unknown' && authority.code !== 'zh'
    });
  } catch (error) { next(error); }
});

router.post('/conversations/:sessionKey/outbound-prepare', async (req, res, next) => {
  try {
    const sessionKey = String(req.params.sessionKey || '').trim();
    const text = String(req.body?.text == null ? '' : req.body.text).trim();
    const idempotencyKey = String(req.body?.idempotencyKey == null ? '' : req.body.idempotencyKey).trim();

    if (!sessionKey) {
      return res.status(400).json({
        ok: false,
        error: 'SESSION_KEY_REQUIRED',
        code: 'SESSION_KEY_REQUIRED',
        message: 'sessionKey is required'
      });
    }

    if (!text) {
      return res.status(400).json({
        ok: false,
        error: 'MESSAGE_TEXT_EMPTY',
        code: 'MESSAGE_TEXT_EMPTY',
        message: '消息内容为空'
      });
    }

    const prepared = await outboundTranslationAuthority.prepare({
      sessionKey,
      conversationId: sessionKey,
      text,
      ...(idempotencyKey ? { idempotencyKey } : {})
    });

    res.setHeader('Cache-Control', 'no-store');
    res.json({
      ok: true,
      sessionKey,
      prepared: {
        text: String(prepared?.text || ''),
        translationApplied: prepared?.translationApplied === true,
        translationStatus: String(prepared?.translationStatus || ''),
        targetLanguage: String(prepared?.targetLanguage || ''),
        targetLanguageCode: String(prepared?.targetLanguageCode || '')
      }
    });
  } catch (error) {
    next(error);
  }
});


router.get('/contacts', (req, res, next) => {
  try { res.json({ ok: true, contacts: workspaceData.listContacts({ limit: req.query.limit, search: req.query.search }) }); } catch (error) { next(error); }
});
router.get('/contacts/:contactId/context', (req, res, next) => {
  try { res.json(workspaceData.getContactContext(req.params.contactId)); } catch (error) { next(error); }
});
router.post('/contacts/:contactId/customer-association', (req, res, next) => {
  try {
    systemPolicy.assertWriteAllowed('customer-profile-association');
    res.json(workspaceData.associateCustomerProfiles(
      req.params.contactId,
      req.body?.targetContactId,
      { by: req.body?.by, note: req.body?.note, matchBy: req.body?.matchBy }
    ));
  } catch (error) { next(error); }
});
router.delete('/contacts/:contactId/customer-association', (req, res, next) => {
  try {
    systemPolicy.assertWriteAllowed('customer-profile-association');
    res.json(workspaceData.separateCustomerProfile(req.params.contactId, {
      by: req.body?.by,
      copyProfile: req.body?.copyProfile !== false
    }));
  } catch (error) { next(error); }
});



router.get('/conversations/:sessionKey/export', (req, res, next) => {
  try {
    res.setHeader('cache-control', 'no-store, max-age=0');
    res.setHeader('x-content-type-options', 'nosniff');
    res.json(chatExport.createConversationExport(req.params.sessionKey));
  } catch (error) { next(error); }
});

router.get('/conversations/:sessionKey/context', (req, res, next) => {
  try { const context = workspaceData.getContextByConversation(req.params.sessionKey); const derived = workspace.insights(req.params.sessionKey); res.json({ ...context, trajectory: derived.trajectory, messageCount: derived.messageCount }); } catch (error) { next(error); }
});
router.put('/conversations/:sessionKey/archive', (req, res, next) => {
  try {
    systemPolicy.assertWriteAllowed(req.body?.archived === false ? 'conversation-restore' : 'conversation-archive');
    res.json(workspaceData.setConversationArchived(req.params.sessionKey, req.body || {}));
  } catch (error) { next(error); }
});


router.put('/conversations/:sessionKey/pin', (req, res, next) => {
  try {
    systemPolicy.assertWriteAllowed(req.body?.pinned === false ? 'conversation-unpin' : 'conversation-pin');
    res.json(workspaceData.setConversationPinned(req.params.sessionKey, req.body || {}));
  } catch (error) { next(error); }
});

router.post('/conversations/:sessionKey/analyze', async (req, res, next) => {
  try {
    systemPolicy.assertWriteAllowed('cross-module-ai-analysis');
    const result = await workspaceData.analyzeConversation(req.params.sessionKey, {
      modelId: req.body?.modelId,
      maxMessages: Number(req.body?.maxMessages || 240),
      dedupeKey: req.body?.dedupeKey,
      fingerprint: req.body?.fingerprint
    });
    const derived = workspace.insights(req.params.sessionKey);
    res.json({ ...result, trajectory: derived.trajectory });
  } catch (error) { next(error); }
});

router.get('/contacts/:id/analysis', (req, res, next) => {
  try { res.json({ ok: true, analysis: workspace.getAnalysis(req.params.id) }); } catch (error) { next(error); }
});
router.put('/contacts/:id/analysis', (req, res, next) => {
  try { systemPolicy.assertWriteAllowed('conversation-analysis-update'); res.json({ ok: true, analysis: workspace.saveAnalysis(req.params.id, req.body || {}) }); } catch (error) { next(error); }
});
router.get('/contacts/:id/insights', (req, res, next) => {
  try { res.json(workspace.insights(req.params.id)); } catch (error) { next(error); }
});
router.get('/contacts/:id/daily-review', (req, res, next) => {
  try {
    res.setHeader('cache-control', 'no-store, max-age=0');
    res.json(workspace.dailyReview(req.params.id, {
      localDate: req.query.localDate,
      timeZone: req.query.timeZone
    }));
  } catch (error) { next(error); }
});
router.put('/contacts/:id/identity', (req, res, next) => {
  try { systemPolicy.assertWriteAllowed('contact-identity-update'); res.json({ ok: true, identity: workspace.saveIdentity(req.params.id, req.body || {}) }); } catch (error) { next(error); }
});
router.put('/contacts/:id/profile', (req, res, next) => {
  try { systemPolicy.assertWriteAllowed('customer-profile-update'); res.json({ ok: true, profile: workspace.saveProfile(req.params.id, req.body || {}) }); } catch (error) { next(error); }
});
router.post('/contacts/:id/profile-review', (req, res, next) => {
  try {
    systemPolicy.assertWriteAllowed('customer-profile-review');
    res.json({ ok: true, ...workspaceData.reviewPendingProfile(req.params.id, req.body || {}) });
  } catch (error) { next(error); }
});
router.put('/contacts/:id/trajectory', (req, res, next) => {
  try { systemPolicy.assertWriteAllowed('relationship-trajectory-update'); res.json({ ok: true, trajectory: workspace.saveTrajectory(req.params.id, req.body || {}) }); } catch (error) { next(error); }
});

// ---- P0-B 集成层路由：身份确认 / 合并 / 关键节点（接稳定契约，权威 SQLite） ----
router.post('/contacts/:id/confirm-identity', (req, res) => {
  try {
    systemPolicy.assertWriteAllowed('contact-identity-confirm');
    const result = buildIdentityService().confirmIdentity({
      accountId: (req.body && req.body.accountId) || 'local',
      contactId: req.params.id,
      expectedVersion: req.body && req.body.expectedVersion,
      confirmedBy: (req.body && req.body.confirmedBy) || 'unknown',
      note: (req.body && req.body.note) || ''
    });
    res.json({ ok: true, contact: result.contact, receipt: result.receipt });
  } catch (error) { respondError(res, error); }
});
router.post('/contacts/:id/merge', (req, res) => {
  try {
    systemPolicy.assertWriteAllowed('contact-merge');
    const result = buildMergeService().mergeContacts({
      survivorId: req.params.id,
      mergedId: req.body && req.body.mergedId,
      by: (req.body && req.body.by) || 'unknown',
      expectedVersion: req.body && req.body.expectedVersion
    });
    res.json({ ok: true, survivorId: result.survivorId, mergedId: result.mergedId, journalId: result.journalId, changesCount: result.changesCount });
  } catch (error) { respondError(res, error); }
});
router.post('/contacts/:id/merge/undo', (req, res) => {
  try {
    systemPolicy.assertWriteAllowed('contact-merge');
    const result = buildMergeService().undoMerge({ journalId: req.body && req.body.journalId, by: (req.body && req.body.by) || 'unknown' });
    res.json({ ok: true, survivorId: result.survivorId, mergedId: result.mergedId, journalId: result.journalId });
  } catch (error) { respondError(res, error); }
});
router.post('/contacts/:id/key-nodes', (req, res) => {
  try {
    systemPolicy.assertWriteAllowed('relationship-key-node');
    const sourceContactId = req.params.id;
    const person = workspaceRepository.resolvePersonProfileContext(sourceContactId);
    const eventId = req.body && req.body.eventId;
    // Existing timeline events retain their physical source identity. New manual
    // relationship projections are anchored once at the active Person profile.
    const projectionContactId = eventId
      ? sourceContactId
      : (person.profileContactId || person.physicalId || sourceContactId);
    const result = buildKeyNodeService().markKeyNode({
      contactId: projectionContactId,
      eventId,
      kind: (req.body && req.body.nodeKind) || 'fact',
      source: (req.body && req.body.markedBy) || 'user',
      expectedVersion: req.body && req.body.expectedVersion
    });
    res.json(Object.assign({
      ok: true,
      personId: person.personId || '',
      sourceContactId,
      projectionContactId
    }, result));
  } catch (error) { respondError(res, error); }
});
router.delete('/contacts/:id/key-nodes/:eventId', (req, res) => {
  try {
    systemPolicy.assertWriteAllowed('relationship-key-node');
    const result = buildKeyNodeService().unmarkKeyNode({ eventId: req.params.eventId, expectedVersion: req.body && req.body.expectedVersion });
    res.json(Object.assign({ ok: true }, result));
  } catch (error) { respondError(res, error); }
});
router.post('/contacts/:id/graphiti-projection', (req, res) => {
  try {
    systemPolicy.assertWriteAllowed('relationship-key-node');
    const sourceContactId = req.params.id;
    const person = workspaceRepository.resolvePersonProfileContext(sourceContactId);
    const projectionContactId = person.profileContactId || person.physicalId || sourceContactId;
    const result = buildKeyNodeService().projectGraphitiFacts({
      contactId: projectionContactId,
      conversationId: (req.body && req.body.conversationId) || '',
      facts: (req.body && req.body.facts) || []
    });
    res.json({
      ok: true,
      personId: person.personId || '',
      sourceContactId,
      projectionContactId,
      applied: Number(result && result.applied || 0),
      unchanged: Number(result && result.unchanged || 0)
    });
  } catch (error) { respondError(res, error); }
});

router.get('/ai-automation', (_req, res) => {
  res.json({ ok: true, status: aiAutomation.status(), config: aiAutomation.readConfig() });
});
router.put('/ai-automation', async (req, res, next) => {
  try {
    systemPolicy.assertWriteAllowed('ai-automation-update');
    const config = await aiAutomation.updateConfig(req.body || {});
    res.json({ ok: true, config, status: aiAutomation.status() });
  } catch (error) { next(error); }
});
router.post('/ai-automation/process/:conversationId', async (req, res, next) => {
  try {
    systemPolicy.assertWriteAllowed('ai-automation-run');
    const result = await aiAutomation.processConversation(req.params.conversationId);
    res.json({ ok: true, result, status: aiAutomation.status() });
  } catch (error) { next(error); }
});

router.put('/ai-assets', (req, res, next) => {
  try { systemPolicy.assertWriteAllowed('ai-assets-update'); res.json({ ok: true, aiAssets: workspace.saveAiAssets(req.body || {}) }); } catch (error) { next(error); }
});

module.exports = router;
