'use strict';

const { randomUUID } = require('crypto');
const express = require('express');
const registry = require('../services/modelRegistry');
const modelStatus = require('../services/modelStatusService');
const qualification = require('../services/modelQualification');
const aiGateway = require('../services/aiGateway');
const eventBus = require('../services/eventBus');
const { getSecurityGuard } = require('../core/securityGuardSingleton');
const { verifyCloudCredential } = require('../services/modelExecutor');
const aiAutomation = require('../services/aiBrainOrchestrator');
const modelAutoActivation = require('../services/modelAutoActivationService');
const replyBrainAuthority = require('../services/replyBrainModelAuthority');
const openRouterAutoConfiguration = require('../services/openRouterAutoConfigurationService');
const openRouterOnboardingSmoke = require('../services/openRouterOnboardingSmokeService');

const securityGuard = getSecurityGuard();
const router = express.Router();
const testControllers = new Map();
const pullControllers = new Map();
const pullProgress = new Map();

function clean(value) { return String(value == null ? '' : value).trim(); }
function findModel(idOrName) {
  const state = registry.read();
  return (state.models || []).find(model => model.id === idOrName || model.name === idOrName);
}
function rememberPullProgress(requestId, value = {}) {
  pullProgress.set(requestId, Object.freeze({ requestId, ...value, updatedAt: new Date().toISOString() }));
  while (pullProgress.size > 50) pullProgress.delete(pullProgress.keys().next().value);
  return pullProgress.get(requestId);
}
async function waitForCredential(credentialRef) {
  for (let attempt = 0; attempt < 10 && !securityGuard.credentials.has(credentialRef); attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return securityGuard.credentials.has(credentialRef);
}
function runtimeMetrics(result = {}) {
  const evidence = result.evidence || {};
  return {
    returnedModel: clean(evidence.selectedModel || result.model),
    model: clean(evidence.selectedModel || result.model),
    providerRequestId: clean(evidence.requestId),
    requestId: clean(evidence.requestId),
    latencyMs: Number(evidence.latencyMs || result.latencyMs || 0),
    totalMs: Number(evidence.latencyMs || result.latencyMs || 0),
    inputTokens: Number(evidence.inputTokens || result.inputTokens || 0),
    promptTokens: Number(evidence.inputTokens || result.inputTokens || 0),
    outputTokens: Number(evidence.outputTokens || result.outputTokens || 0),
    totalTokens: Number(evidence.totalTokens || result.totalTokens || 0),
    costUsd: Number(evidence.costUsd || result.costUsd || 0),
    retryCount: Number(evidence.retryCount || result.retryCount || 0),
    fallbackCount: Number(evidence.fallbackCount || result.fallbackCount || 0)
  };
}
function currentStatus() {
  const state = modelStatus.read();
  return {
    ...state,
    runtime: {
      ...aiGateway.status(),
      aiAutomation: aiAutomation.status(),
      autoActivation: modelAutoActivation.status()
    }
  };
}
function responseStatus(error, fallback = 503) {
  const status = Number(error?.status || 0);
  return status >= 400 && status <= 599 ? status : fallback;
}
function cloudFailurePayload(error, fallbackCode) {
  return {
    ok: false,
    error: clean(error?.code || fallbackCode),
    code: clean(error?.code || fallbackCode),
    message: clean(error?.message || fallbackCode),
    status: Number(error?.status || 0),
    type: clean(error?.type),
    requestId: clean(error?.requestId),
    testStage: clean(error?.testStage),
    availableModels: Array.isArray(error?.availableModels) ? error.availableModels : []
  };
}

router.get('/status', (_req, res) => res.json({ ok: true, ...currentStatus() }));
router.get('/model-brain/status', (_req, res) => {
  const state = currentStatus();
  res.json({ ok: true, modelBrain: state.modelBrain, taskReadiness: state.taskReadiness, summary: state.summary, runtime: state.runtime?.modelBrain || aiGateway.status().modelBrain });
});
router.get('/audit', (_req, res) => {
  const state = modelStatus.read();
  res.json({ ok: true, ...replyBrainAuthority.audit(state.models || []) });
});

router.patch('/:id/lifecycle', async (req, res, next) => {
  try {
    const model = findModel(req.params.id);
    if (!model) return res.status(404).json({ ok: false, error: 'MODEL_NOT_FOUND', message: '没有找到该模型' });
    const enabled = req.body?.enabled === true;
    const state = await registry.setModelEnabled(model.id, enabled, { reason: req.body?.reason });
    const projected = modelStatus.project(state);
    res.json({ ok: true, enabled, model: projected.models.find(row => row.id === model.id), modelBrain: projected.modelBrain, taskReadiness: projected.taskReadiness });
  } catch (error) { next(error); }
});

router.post('/cloud/discover', async (req, res) => {
  const endpoint = clean(req.body?.endpoint);
  const credentialRef = clean(req.body?.credentialRef);
  if (!endpoint || !credentialRef) return res.status(400).json({ ok: false, error: 'INVALID_CLOUD_MODEL_DISCOVERY', message: '地址和凭据不能为空' });
  try {
    if (!await waitForCredential(credentialRef)) return res.status(409).json({ ok: false, error: 'CLOUD_MODEL_CREDENTIAL_MISSING', message: '云模型凭据尚未写入系统安全存储' });
    const credential = aiGateway.assertCloudCredential(credentialRef, endpoint);
    const models = await aiGateway.listCloudModels({ endpoint: credential.endpoint || endpoint, credentialRef, timeoutMs: Number(req.body?.timeoutMs || 30000) });
    return res.json({ ok: true, endpoint: credential.endpoint || endpoint, models });
  } catch (error) {
    return res.status(responseStatus(error)).json(cloudFailurePayload(error, 'CLOUD_MODEL_DISCOVERY_FAILED'));
  }
});

router.post('/cloud', async (req, res, next) => {
  const name = clean(req.body?.name || req.body?.model);
  const endpoint = clean(req.body?.endpoint);
  const credentialRef = clean(req.body?.credentialRef);
  const provider = clean(req.body?.provider || 'openai-compatible').toLowerCase();
  const testVision = req.body?.testVision === true || req.body?.vision === true;
  if (!name || !endpoint || !credentialRef) return res.status(400).json({ ok: false, error: 'INVALID_CLOUD_MODEL', message: '模型名称、地址和凭据不能为空' });
  if (req.body?.verify === false) return res.status(400).json({ ok: false, error: 'CLOUD_MODEL_TEST_REQUIRED', message: '云模型必须先完成目录读取和 Model Brain 逻辑烟测，测试通过后才能保存。', persisted: false });
  try {
    if (!await waitForCredential(credentialRef)) return res.status(409).json({ ok: false, error: 'CLOUD_MODEL_CREDENTIAL_MISSING', message: '云模型凭据尚未写入系统安全存储', persisted: false });
    const credential = aiGateway.assertCloudCredential(credentialRef, endpoint);
    const availableModels = await aiGateway.listCloudModels({ endpoint: credential.endpoint || endpoint, credentialRef, timeoutMs: Number(req.body?.discoveryTimeoutMs || 30000) });
    let verification;
    try {
      verification = await verifyCloudCredential({ endpoint, credentialRef, model: name, provider, runInference: true, testVision });
    } catch (error) {
      error.availableModels = availableModels;
      return res.status(responseStatus(error)).json({ ...cloudFailurePayload(error, 'CLOUD_MODEL_TEST_FAILED'), persisted: false });
    }
    if (verification.inference?.probePass !== true) {
      return res.status(422).json({ ok: false, error: 'CLOUD_MODEL_LOGICAL_SMOKE_FAILED', code: 'CLOUD_MODEL_LOGICAL_SMOKE_FAILED', message: 'Model Brain / LiteLLM 最小逻辑烟测未通过', persisted: false, availableModels });
    }
    let state = await registry.upsertCloudModel({
      id: req.body?.id,
      name,
      endpoint,
      credentialRef,
      provider,
      source: 'user-configured',
      resetValidation: true,
      testVision,
      capabilities: testVision ? ['text', 'vision'] : ['text']
    });
    let model = (state.models || []).find(row => row.name === name && row.credentialRef === credentialRef);
    if (!model) throw Object.assign(new Error('CLOUD_MODEL_REGISTRY_WRITE_FAILED'), { code: 'CLOUD_MODEL_REGISTRY_WRITE_FAILED' });
    const metrics = runtimeMetrics(verification.inference || {});
    await registry.recordInvocation(model.id, metrics);
    const connectivity = {
      name: 'connectivity', task: 'probe', pass: true, output: clean(verification.inference?.text), metrics,
      error: '', code: '', status: 200, durationMs: metrics.latencyMs
    };
    const vision = testVision ? {
      name: 'vision', task: 'probe', pass: verification.tests?.vision?.pass === true, output: clean(verification.vision?.text),
      metrics: runtimeMetrics(verification.vision || {}), error: '', code: '', status: verification.tests?.vision?.pass === true ? 200 : 422,
      durationMs: Number(verification.tests?.vision?.totalMs || 0)
    } : null;
    const result = {
      schemaVersion: 1,
      testedAt: new Date().toISOString(),
      qualification: 'experimental',
      allowedTasks: [],
      blockedReason: '仅完成连接/隔离烟测；生产任务须通过正式 hard qualification',
      connectivity,
      vision,
      scores: { connectivity, ...(vision ? { vision } : {}) },
      summary: { passed: [connectivity, vision].filter(row => row?.pass === true).length, total: [connectivity, vision].filter(Boolean).length, averageLatencyMs: metrics.latencyMs }
    };
    state = await registry.recordTest(model.id, result);
    model = (state.models || []).find(row => row.id === model.id) || model;
    return res.status(201).json({ ok: true, persisted: true, model, verification: { ...verification, models: availableModels, modelAvailable: availableModels.includes(name) }, result, availableModels });
  } catch (error) { next(error); }
});

router.post('/cloud/openrouter/auto-configure', async (req, res, next) => {
  const credentialRef = clean(req.body?.credentialRef);
  if (!credentialRef) return res.status(400).json({ ok: false, error: 'OPENROUTER_CREDENTIAL_REF_REQUIRED', message: '请先把 OpenRouter API Key 写入系统安全存储' });
  try {
    if (!await waitForCredential(credentialRef)) return res.status(409).json({ ok: false, error: 'OPENROUTER_CREDENTIAL_MISSING', message: 'OpenRouter API Key 尚未写入系统安全存储' });
    const snapshot = await openRouterAutoConfiguration.autoConfigure({
      credentialRef,
      endpoint: req.body?.endpoint || openRouterAutoConfiguration.OPENROUTER_ENDPOINT
    });
    await registry.recordOpenRouterSnapshot({
      connectionState: 'catalog-ready',
      authenticationStatus: 'passed',
      catalogStatus: 'passed',
      onboardingSmokeStatus: 'running',
      qualificationStatus: 'pending'
    });
    try {
      await openRouterOnboardingSmoke.run({ snapshot, registry, timeoutMs: Number(req.body?.smokeTimeoutMs || 120000) });
    } catch (smokeError) {
      const smokeResults = Array.isArray(smokeError.results) ? smokeError.results : [];
      const failedState = await registry.recordOpenRouterSnapshot({
        connectionState: 'degraded',
        authenticationStatus: 'passed',
        catalogStatus: 'passed',
        onboardingSmokeStatus: 'failed',
        onboardingSmokeResults: smokeResults,
        onboardingSmokeErrorCode: clean(smokeError.code || 'OPENROUTER_ONBOARDING_SMOKE_FAILED'),
        onboardingSmokeError: clean(smokeError.message),
        qualificationStatus: 'pending'
      });
      const projected = modelStatus.project(failedState);
      return res.status(422).json({
        ok: false,
        error: smokeError.code || 'OPENROUTER_ONBOARDING_SMOKE_FAILED',
        code: smokeError.code || 'OPENROUTER_ONBOARDING_SMOKE_FAILED',
        message: smokeError.message || 'OpenRouter Model Brain 逻辑烟测失败。',
        provider: 'openrouter',
        snapshot: projected.openRouter,
        onboarding: { pass: false, results: smokeResults },
        models: projected.models,
        modelBrain: projected.modelBrain
      });
    }
    const connectedState = await registry.recordOpenRouterSnapshot({
      connectionState: 'ready',
      authenticationStatus: 'passed',
      catalogStatus: 'passed',
      onboardingSmokeStatus: 'passed',
      logicalModelBrainSmoke: true,
      qualificationStatus: 'pending'
    });
    const projected = modelStatus.project(connectedState);
    eventBus.publish('models:openrouter-auto-configured', { provider: 'openrouter', catalogCount: Number(snapshot.catalogCount || 0), registeredModelCount: Number(snapshot.registeredModelCount || 0), modelBrain: true });
    return res.json({ ok: true, provider: 'openrouter', snapshot: projected.openRouter, models: projected.models, modelBrain: projected.modelBrain, taskReadiness: projected.taskReadiness });
  } catch (error) { next(error); }
});

router.get('/cloud/openrouter/status', (_req, res) => {
  const state = modelStatus.read();
  const openRouter = state.openRouter || {};
  res.json({
    ok: true,
    provider: 'openrouter',
    connectionState: clean(openRouter.connectionState || 'not-configured'),
    authenticationStatus: clean(openRouter.authenticationStatus || 'unknown'),
    catalogStatus: clean(openRouter.catalogStatus || 'unknown'),
    onboardingSmokeStatus: clean(openRouter.onboardingSmokeStatus || 'not-run'),
    qualificationStatus: clean(openRouter.qualificationStatus || 'pending'),
    key: openRouter.key || {},
    catalogCount: Number(openRouter.catalogCount || 0),
    registeredModelCount: Number(openRouter.registeredModelCount || 0),
    smokeResults: Array.isArray(openRouter.onboardingSmokeResults) ? openRouter.onboardingSmokeResults : [],
    modelBrain: state.modelBrain,
    taskReadiness: state.taskReadiness,
    openRouter
  });
});

router.delete('/cloud/:id', async (req, res, next) => {
  try {
    const model = findModel(req.params.id);
    if (!model) return res.status(404).json({ ok: false, error: 'MODEL_NOT_FOUND' });
    if (model.provider === 'ollama') return res.status(409).json({ ok: false, error: 'LOCAL_MODEL_DELETE_ENDPOINT_REQUIRED' });
    await registry.removeModel(model.id);
    if (req.body?.removeCredential === true && clean(model.credentialRef)) await securityGuard.credentials.remove(model.credentialRef, { actor: 'backend-core' });
    res.json({ ok: true, modelId: model.id, model: model.name });
  } catch (error) { next(error); }
});

router.post('/local/pull', async (req, res, next) => {
  const name = clean(req.body?.model || req.body?.name);
  const endpoint = clean(req.body?.endpoint || registry.read().endpoint || 'http://127.0.0.1:11434');
  if (!name) return res.status(400).json({ ok: false, error: 'OLLAMA_MODEL_NAME_REQUIRED', message: '模型名称不能为空' });
  if (req.body?.consent !== true) return res.status(409).json({ ok: false, error: 'LOCAL_MODEL_PULL_CONSENT_REQUIRED', message: '下载本地模型需要用户明确确认。' });
  const requestId = clean(req.body?.requestId) || randomUUID();
  if (pullControllers.has(requestId)) return res.status(409).json({ ok: false, error: 'LOCAL_MODEL_PULL_ALREADY_RUNNING', requestId });
  const controller = new AbortController();
  pullControllers.set(requestId, controller);
  rememberPullProgress(requestId, { state: 'running', status: 'starting', model: name, endpoint, total: 0, completed: 0 });
  eventBus.publish('models:local-pull-started', { requestId, model: name, endpoint });
  try {
    const result = await aiGateway.pullLocalModel(endpoint, name, {
      signal: controller.signal,
      timeoutMs: Number(req.body?.timeoutMs || 30 * 60 * 1000),
      onProgress: progress => {
        const snapshot = rememberPullProgress(requestId, { state: 'running', ...progress });
        eventBus.publish('models:local-pull-progress', snapshot);
      }
    });
    if (controller.signal.aborted) throw controller.signal.reason || Object.assign(new Error('MODEL_CANCELLED'), { code: 'MODEL_CANCELLED' });
    pullControllers.delete(requestId);
    const finalizing = rememberPullProgress(requestId, { ...result, state: 'finalizing', status: 'finalizing', model: name, endpoint });
    eventBus.publish('models:local-pull-progress', finalizing);
    const discovery = await aiGateway.discoverLocalModels();
    let state = await registry.mergeDiscovered(discovery);
    state = await modelAutoActivation.run({ reason: 'local-pull-complete', state });
    const projected = modelStatus.project(state);
    const snapshot = rememberPullProgress(requestId, { state: 'completed', ...result });
    eventBus.publish('models:local-pull-complete', snapshot);
    return res.json({ ok: true, requestId, result, localAuxiliary: projected.localAuxiliary, models: projected.models });
  } catch (error) {
    const cancelled = error?.code === 'MODEL_CANCELLED' || controller.signal.aborted;
    const snapshot = rememberPullProgress(requestId, { state: cancelled ? 'cancelled' : 'failed', status: cancelled ? 'cancelled' : 'failed', model: name, endpoint, error: clean(error?.code || error?.message) });
    eventBus.publish(cancelled ? 'models:local-pull-cancelled' : 'models:local-pull-failed', snapshot);
    if (cancelled) return res.status(409).json({ ok: false, error: 'MODEL_CANCELLED', message: '模型下载已取消', requestId });
    return next(error);
  } finally {
    pullControllers.delete(requestId);
  }
});
router.get('/local/pull/:requestId', (req, res) => {
  const snapshot = pullProgress.get(clean(req.params.requestId));
  if (!snapshot) return res.status(404).json({ ok: false, error: 'LOCAL_MODEL_PULL_NOT_FOUND' });
  res.json({ ok: true, progress: snapshot, active: pullControllers.has(clean(req.params.requestId)) });
});
router.post('/local/pull/:requestId/cancel', (req, res) => {
  const requestId = clean(req.params.requestId);
  const controller = pullControllers.get(requestId);
  if (!controller) return res.json({ ok: true, requestId, cancelled: false, progress: pullProgress.get(requestId) || null });
  controller.abort(Object.assign(new Error('MODEL_CANCELLED'), { code: 'MODEL_CANCELLED' }));
  const snapshot = rememberPullProgress(requestId, { ...(pullProgress.get(requestId) || {}), state: 'cancelling', status: 'cancelling' });
  eventBus.publish('models:local-pull-cancelling', snapshot);
  res.json({ ok: true, requestId, cancelled: true, progress: snapshot });
});

router.delete('/local/:id', async (req, res, next) => {
  try {
    const model = findModel(req.params.id);
    if (!model) return res.status(404).json({ ok: false, error: 'MODEL_NOT_FOUND' });
    if (model.provider !== 'ollama') return res.status(409).json({ ok: false, error: 'CLOUD_MODEL_DELETE_ENDPOINT_REQUIRED' });
    if (model.userDisabled !== true) return res.status(409).json({ ok: false, error: 'MODEL_MUST_BE_DISABLED_BEFORE_DELETE', message: '请先停用模型，再执行永久删除。' });
    if (clean(req.body?.confirmName) !== clean(model.name)) return res.status(409).json({ ok: false, error: 'MODEL_DELETE_CONFIRMATION_MISMATCH', message: '模型名称确认不一致。' });
    await aiGateway.removeLocalModel(model.endpoint, model.name);
    await registry.removeModel(model.id);
    res.json({ ok: true, modelId: model.id, model: model.name });
  } catch (error) { next(error); }
});

router.post('/scan', async (_req, res, next) => {
  try {
    const discovery = await aiGateway.discoverLocalModels();
    let state = await registry.mergeDiscovered(discovery);
    state = await modelAutoActivation.run({ reason: 'manual-scan', state });
    eventBus.publish('models:scanned', { count: discovery.models?.length || 0, online: discovery.online === true });
    res.json({ ok: true, ...modelStatus.project(state) });
  } catch (error) { next(error); }
});

router.post('/:id/test', async (req, res, next) => {
  try {
    const model = findModel(req.params.id);
    if (!model) return res.status(404).json({ ok: false, error: 'MODEL_NOT_FOUND' });
    const controller = new AbortController();
    testControllers.set(model.id, controller);
    const result = await qualification.qualifyModel(model, {
      tests: Array.isArray(req.body?.tests) && req.body.tests.length ? req.body.tests : undefined,
      timeoutMs: Number(req.body?.timeoutMs || 180000),
      signal: controller.signal
    });
    const projected = modelStatus.read();
    res.json({ ok: true, model: projected.models.find(row => row.id === model.id), result, modelBrain: projected.modelBrain, taskReadiness: projected.taskReadiness });
  } catch (error) { next(error); }
  finally { testControllers.delete(req.params.id); }
});
router.post('/:id/cancel', (req, res) => {
  const controller = testControllers.get(req.params.id);
  if (!controller) return res.json({ ok: true, cancelled: false });
  controller.abort(Object.assign(new Error('TEST_CANCELLED'), { code: 'TEST_CANCELLED' }));
  testControllers.delete(req.params.id);
  res.json({ ok: true, cancelled: true });
});
router.post('/test-all', async (req, res, next) => {
  try {
    const models = (registry.read().models || []).filter(model => model.available !== false && model.userDisabled !== true);
    const results = await qualification.qualifyAll(models, {
      tests: Array.isArray(req.body?.tests) && req.body.tests.length ? req.body.tests : undefined,
      timeoutMs: Number(req.body?.timeoutMs || 180000)
    });
    res.json({ ok: true, count: results.length, results, modelBrain: modelStatus.read().modelBrain });
  } catch (error) { next(error); }
});
router.post('/:id/unload', async (req, res, next) => {
  try {
    const model = findModel(req.params.id);
    if (!model) return res.status(404).json({ ok: false, error: 'MODEL_NOT_FOUND' });
    if (model.provider !== 'ollama') return res.status(409).json({ ok: false, error: 'CLOUD_MODEL_CANNOT_BE_UNLOADED' });
    await aiGateway.unloadLocalModel(model.endpoint, model.name);
    res.json({ ok: true, modelId: model.id, model: model.name });
  } catch (error) { next(error); }
});

router.post('/model-brain/probe', async (req, res, next) => {
  try {
    const task = clean(req.body?.task || 'probe');
    const modelId = clean(req.body?.modelId);
    if (modelId && task !== 'probe') return res.status(400).json({ ok: false, error: 'PHYSICAL_MODEL_SELECTION_FORBIDDEN', message: '只有隔离资格 probe 可以指定精确 deployment；生产任务由 LiteLLM 选择。' });
    const result = await aiGateway.execute({
      task,
      modelId,
      messages: Array.isArray(req.body?.messages) && req.body.messages.length ? req.body.messages : [{ role: 'user', content: clean(req.body?.content || 'Reply with exactly: YANCE_MODEL_BRAIN_OK') }],
      options: { ...(req.body?.options || {}), timeoutMs: Number(req.body?.timeoutMs || req.body?.options?.timeoutMs || 120000) },
      context: req.body?.context || {}
    });
    res.json({ ok: true, probePass: result.probePass === true || /YANCE_MODEL_BRAIN_OK/iu.test(clean(result.text)), text: result.text || '', evidence: result.evidence || null, modelBrain: aiGateway.status().modelBrain });
  } catch (error) { next(error); }
});

router.post('/execute', async (req, res, next) => {
  try {
    const task = clean(req.body?.task);
    const modelId = clean(req.body?.modelId);
    if (modelId && task !== 'probe') return res.status(400).json({ ok: false, error: 'PHYSICAL_MODEL_SELECTION_FORBIDDEN', message: '生产执行只接受 logical task + hard constraints；物理模型由 LiteLLM 选择。' });
    const result = await aiGateway.execute({
      task,
      messages: req.body?.messages || [],
      modelId,
      options: req.body?.options || {},
      dedupeKey: req.body?.dedupeKey || '',
      fingerprint: req.body?.fingerprint || '',
      context: req.body?.context || {}
    });
    if (!res.writableEnded) res.json({ ok: true, result, structured: result.text || '' });
  } catch (error) {
    if (!res.headersSent) next(error);
  }
});
router.post('/jobs', (req, res, next) => {
  try {
    const task = clean(req.body?.task);
    const modelId = clean(req.body?.modelId);
    if (modelId && task !== 'probe') return res.status(400).json({ ok: false, error: 'PHYSICAL_MODEL_SELECTION_FORBIDDEN', message: '生产异步任务不能指定物理模型。' });
    const submitted = aiGateway.submit({ task, messages: req.body?.messages || [], modelId, options: req.body?.options || {}, context: req.body?.context || {}, background: req.body?.background === true });
    res.status(202).json({ ok: true, ...submitted });
  } catch (error) { next(error); }
});
router.get('/jobs', (_req, res) => res.json({ ok: true, status: aiGateway.status(), jobs: aiGateway.listJobs() }));
router.get('/jobs/:id', (req, res) => {
  const job = aiGateway.getJob(req.params.id);
  if (!job) return res.status(404).json({ ok: false, error: 'JOB_NOT_FOUND' });
  res.json({ ok: true, job });
});
router.post('/jobs/:id/cancel', (req, res) => res.json({ ok: true, cancelled: aiGateway.cancel(req.params.id) }));

module.exports = router;
