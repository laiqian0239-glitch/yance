'use strict';

const express = require('express');
const ollama = require('../services/ollamaClient');
const registry = require('../services/modelRegistry');
const modelStatus = require('../services/modelStatusService');
const qualification = require('../services/modelQualification');
const aiGateway = require('../services/aiGateway');
const eventBus = require('../services/eventBus');
const { getSecurityGuard } = require('../core/securityGuardSingleton');
const securityGuard = getSecurityGuard();
const { verifyCloudCredential } = require('../services/modelExecutor');
const aiAutomation = require('../services/aiBrainOrchestrator');
const modelAutoActivation = require('../services/modelAutoActivationService');
const replyBrainAuthority = require('../services/replyBrainModelAuthority');
const replyBrainBenchmark = require('../services/replyBrainBenchmark');
const whatsappReplyStyle = require('../services/whatsappReplyStyleAuthority');
const { appearsGerman } = require('../services/modelQualification');
const modelTaskRuntimePolicy = require('../services/modelTaskRuntimePolicy');
const openRouterAutoConfiguration = require('../services/openRouterAutoConfigurationService');
const commercialModelBenchmark = require('../services/commercialModelBenchmarkService');
const aiQualityRouteAuthority = require('../services/aiQualityRouteAuthority');
const openRouterOnboardingSmoke = require('../services/openRouterOnboardingSmokeService');

const router = express.Router();
const testControllers = new Map();

function findModel(idOrName) {
  const state = registry.read();
  return (state.models || []).find(model => model.id === idOrName || model.name === idOrName);
}


function qualificationHasTechnicalFailure(result = {}) {
  return Object.values(result.scores || {}).some(row => ['MODEL_TIMEOUT', 'MODEL_CANCELLED', 'MODEL_REQUEST_FAILED', 'REQUEST_TIMEOUT', 'EMPTY_MODEL_OUTPUT'].includes(String(row?.code || '')));
}

async function runReplyBrainBenchmarkWorkflow(inputModel, options = {}) {
  let model = inputModel;
  let baseQualification = null;
  const runtimeProfile = replyBrainBenchmark.runtimeProfileForModel(model, options);
  const warmupResult = await replyBrainBenchmark.warmupModel(model, options, runtimeProfile);

  if (!replyBrainBenchmark.isSpecialPurpose(model) && !replyBrainAuthority.baseReplyEligible(model) && warmupResult.pass) {
    baseQualification = await qualification.qualifyModel(model, {
      tests: ['connectivity', 'json', 'persona', 'hallucination'],
      timeoutMs: runtimeProfile.baseQualificationTimeoutMs,
      runtimeProfile,
      signal: options.signal
    });
    model = findModel(model.id) || model;
  }

  // 基础资格是诊断事实，不再阻止模型参加真正的聊天专项基准。
  // 回复专项本身已经包含德语、英语、Persona 事实边界、导演 JSON、候选差异和速度。
  const result = await replyBrainBenchmark.runReplyBrainBenchmark(model, {
    ...options,
    runtimeProfile,
    warmupResult,
    signal: options.signal
  });
  result.baseQualification = baseQualification ? {
    completed: !qualificationHasTechnicalFailure(baseQualification),
    pass: baseQualification.pass === true,
    testedAt: baseQualification.testedAt || '',
    failedTests: Object.entries(baseQualification.scores || {}).filter(([, row]) => row?.pass !== true).map(([name, row]) => ({ name, code: row?.code || '', message: row?.message || '' }))
  } : null;
  const state = await registry.recordReplyBrainBenchmark(model.id, result);
  eventBus.publish('model:reply-brain-benchmark-complete', { modelId: model.id, model: model.name, result, runtimeProfile });
  return { model, baseQualification, result, state, runtimeProfile };
}

router.get('/status', (_req, res) => {
  const state = modelStatus.read();
  res.json({ ok: true, ...state, runtime: { ...aiGateway.status(), aiAutomation: aiAutomation.status(), autoActivation: modelAutoActivation.status() } });
});

router.get('/audit', (_req, res) => {
  const state = modelStatus.read();
  res.json({ ok: true, ...replyBrainAuthority.audit(state.models || [], state.routes || {}) });
});

router.get('/quality-routing', (_req, res) => {
  const state = modelStatus.read();
  const tasks = Object.keys(aiQualityRouteAuthority.TASK_PROFILES);
  const plans = Object.fromEntries(tasks.map(task => {
    const route = state.routes?.[task] || {};
    return [task, aiQualityRouteAuthority.routePlan({
      task,
      route: {
        primary: route.primary || route.primaryModelId || '',
        fallback: route.fallback || route.fallbackModelId || '',
        emergency: route.emergency || route.emergencyModelId || '',
        allowConditional: route.allowConditional === true,
        humanReviewRequired: route.humanReviewRequired === true,
        allowEmergency: route.allowEmergency === true
      },
      models: state.models || []
    })];
  }));
  const rows = Object.values(plans);
  res.json({
    ok: true,
    authority: aiQualityRouteAuthority.AUTHORITY,
    plans,
    summary: {
      tasks: rows.length,
      ready: rows.filter(row => row.state === aiQualityRouteAuthority.ROUTE_STATE.READY).length,
      degraded: rows.filter(row => row.state === aiQualityRouteAuthority.ROUTE_STATE.DEGRADED).length,
      conditional: rows.filter(row => row.state === aiQualityRouteAuthority.ROUTE_STATE.CONDITIONAL).length,
      emergencyOnly: rows.filter(row => row.state === aiQualityRouteAuthority.ROUTE_STATE.EMERGENCY_ONLY).length,
      blocked: rows.filter(row => row.state === aiQualityRouteAuthority.ROUTE_STATE.BLOCKED).length
    }
  });
});

router.patch('/:id/lifecycle', async (req, res, next) => {
  try {
    const model = findModel(req.params.id);
    if (!model) return res.status(404).json({ ok: false, error: 'MODEL_NOT_FOUND', message: '没有找到该模型' });
    const enabled = req.body?.enabled === true;
    const state = await registry.setModelEnabled(model.id, enabled, { reason: req.body?.reason });
    const projected = modelStatus.project(state);
    res.json({ ok: true, enabled, model: projected.models.find(row => row.id === model.id), replyBrain: projected.replyBrain });
  } catch (error) { next(error); }
});


router.post('/cloud', async (req, res, next) => {
  const name = String(req.body?.name || req.body?.model || '').trim();
  const endpoint = String(req.body?.endpoint || '').trim();
  const credentialRef = String(req.body?.credentialRef || '').trim();
  if (!name || !endpoint || !credentialRef) return res.status(400).json({ ok: false, error: 'INVALID_CLOUD_MODEL', message: '模型名称、地址和凭据不能为空' });
  if (req.body?.verify === false) return res.status(400).json({ ok: false, error: 'CLOUD_MODEL_TEST_REQUIRED', message: '云模型必须先完成模型列表和最小真实调用测试，测试通过后才能保存并启用。', persisted: false });
  try {
    for (let attempt = 0; attempt < 10 && !securityGuard.credentials.has(credentialRef); attempt += 1) await new Promise(resolve => setTimeout(resolve, 50));
    if (!securityGuard.credentials.has(credentialRef)) return res.status(409).json({ ok: false, error: 'CLOUD_MODEL_CREDENTIAL_MISSING', message: '云模型凭据尚未写入系统安全存储', persisted: false });
    const testVision = req.body?.testVision === true || req.body?.vision === true;
    let verification;
    try {
      verification = await verifyCloudCredential({ endpoint, credentialRef, model: name, runInference: true, testVision });
    } catch (error) {
      const availableModels = Array.isArray(error.availableModels) ? error.availableModels : [];
      const modelHint = error.modelAvailable === false && availableModels.length
        ? `；当前账号可见模型包括：${availableModels.slice(0, 12).join('、')}`
        : '';
      const responseStatus = Number(error.status) >= 400 && Number(error.status) <= 599 ? Number(error.status) : 503;
      return res.status(responseStatus).json({
        ok: false,
        error: error.code || 'CLOUD_MODEL_TEST_FAILED',
        code: error.code || 'CLOUD_MODEL_TEST_FAILED',
        message: `${error.message || '云模型真实调用测试失败'}${modelHint}`,
        status: Number(error.status || 0),
        type: String(error.type || ''),
        requestId: String(error.requestId || ''),
        testStage: String(error.testStage || 'text-inference'),
        modelAvailable: error.modelAvailable !== false,
        availableModels,
        persisted: false
      });
    }

    const inference = verification.inference || {};
    const visionInference = verification.vision || {};
    const textPass = /YANCE_MODEL_OK/i.test(String(inference.text || ''));
    const visionPass = !testVision || /YANCE_VISION_OK/i.test(String(visionInference.text || ''));
    if (!textPass || !visionPass) {
      const code = !textPass ? 'CLOUD_MODEL_MINIMUM_RESPONSE_INVALID' : 'CLOUD_MODEL_VISION_RESPONSE_INVALID';
      const message = !textPass ? '模型文本返回不符合最小真实调用测试要求' : '模型图片识别返回不符合最小真实调用测试要求';
      return res.status(422).json({ ok: false, error: code, code, message, persisted: false, verification: { ...verification, inference: { ...inference, text: String(inference.text || '').slice(0, 200) } }, availableModels: verification.models || [] });
    }

    let state = await registry.upsertCloudModel({
      id: req.body?.id,
      name,
      endpoint,
      credentialRef,
      provider: req.body?.provider || 'openai-compatible',
      source: 'user-configured',
      resetValidation: true,
      testVision
    });
    let model = (state.models || []).find(row => row.name === name && row.credentialRef === credentialRef);
    await registry.recordInvocation(model.id, inference);
    const connectivity = {
      name: 'connectivity', task: 'general', pass: true, output: String(inference.text || ''),
      metrics: {
        firstTokenMs: Number(inference.firstTokenMs || 0), totalMs: Number(inference.totalMs || 0),
        promptTokens: Number(inference.promptTokens || 0), outputTokens: Number(inference.outputTokens || 0),
        totalTokens: Number(inference.totalTokens || 0), returnedModel: String(inference.returnedModel || '')
      },
      error: '', code: '', status: 200, durationMs: Number(inference.totalMs || 0)
    };
    const vision = testVision ? {
      name: 'vision', task: 'vision', pass: true, output: String(visionInference.text || ''),
      metrics: {
        firstTokenMs: Number(visionInference.firstTokenMs || 0), totalMs: Number(visionInference.totalMs || 0),
        promptTokens: Number(visionInference.promptTokens || 0), outputTokens: Number(visionInference.outputTokens || 0),
        totalTokens: Number(visionInference.totalTokens || 0), returnedModel: String(visionInference.returnedModel || '')
      },
      error: '', code: '', status: 200, durationMs: Number(visionInference.totalMs || 0)
    } : null;
    const completedTests = [connectivity, ...(vision ? [vision] : [])];
    const result = {
      schemaVersion: 1,
      testedAt: new Date().toISOString(),
      qualification: 'experimental',
      allowedTasks: ['general', ...(testVision ? ['vision'] : [])],
      blockedReason: '', connectivity, vision, scores: { connectivity, ...(vision ? { vision } : {}) },
      summary: {
        passed: completedTests.length,
        total: completedTests.length,
        averageLatencyMs: Math.round(completedTests.reduce((sum, row) => sum + Number(row.durationMs || 0), 0) / completedTests.length)
      }
    };
    state = await registry.recordTest(model.id, result);
    model = (state.models || []).find(row => row.id === model.id) || model;
    return res.status(201).json({ ok: true, persisted: true, model, verification, result, availableModels: verification.models || [] });
  } catch (error) { next(error); }
});

router.post('/cloud/discover', async (req, res) => {
  const endpoint = String(req.body?.endpoint || '').trim();
  const credentialRef = String(req.body?.credentialRef || '').trim();
  if (!endpoint || !credentialRef) return res.status(400).json({ ok: false, error: 'INVALID_CLOUD_MODEL_DISCOVERY', message: '地址和凭据不能为空' });
  try {
    const verification = await verifyCloudCredential({ endpoint, credentialRef, runInference: false });
    return res.json({ ok: true, endpoint: verification.endpoint, models: verification.models });
  } catch (error) {
    const responseStatus = Number(error.status) >= 400 && Number(error.status) <= 599 ? Number(error.status) : 503;
    return res.status(responseStatus).json({ ok: false, error: error.code || 'CLOUD_MODEL_DISCOVERY_FAILED', message: error.message || String(error), status: Number(error.status || 0), type: String(error.type || ''), requestId: String(error.requestId || ''), testStage: String(error.testStage || 'model-discovery') });
  }
});

router.post('/cloud/openrouter/auto-configure', async (req, res, next) => {
  const credentialRef = String(req.body?.credentialRef || '').trim();
  if (!credentialRef) return res.status(400).json({ ok: false, error: 'OPENROUTER_CREDENTIAL_REF_REQUIRED', message: '请先把OpenRouter API Key写入系统安全存储' });
  try {
    for (let attempt = 0; attempt < 10 && !securityGuard.credentials.has(credentialRef); attempt += 1) await new Promise(resolve => setTimeout(resolve, 50));
    if (!securityGuard.credentials.has(credentialRef)) return res.status(409).json({ ok: false, error: 'OPENROUTER_CREDENTIAL_MISSING', message: 'OpenRouter API Key尚未写入系统安全存储' });
    const snapshot = await openRouterAutoConfiguration.autoConfigure({
      credentialRef,
      endpoint: req.body?.endpoint || openRouterAutoConfiguration.OPENROUTER_ENDPOINT
    });
    await registry.recordOpenRouterSnapshot({
      connectionState: 'catalog-ready',
      authenticationStatus: 'passed',
      catalogStatus: 'passed',
      onboardingSmokeStatus: 'running',
      routeStatus: 'blocked',
      formalQualificationStatus: 'pending'
    });
    let onboarding;
    try {
      onboarding = await openRouterOnboardingSmoke.run({
        snapshot,
        registry,
        timeoutMs: Number(req.body?.smokeTimeoutMs || 120000)
      });
    } catch (smokeError) {
      const smokeResults = Array.isArray(smokeError.results) ? smokeError.results : [];
      const failedSnapshot = await registry.recordOpenRouterSnapshot({
        connectionState: 'degraded',
        authenticationStatus: 'passed',
        catalogStatus: 'passed',
        onboardingSmokeStatus: 'failed',
        onboardingSmokeResults: smokeResults,
        onboardingSmokeErrorCode: String(smokeError.code || 'OPENROUTER_ONBOARDING_SMOKE_FAILED'),
        onboardingSmokeError: String(smokeError.message || smokeError),
        routeStatus: 'blocked',
        formalQualificationStatus: 'pending'
      });
      const projectedFailure = modelStatus.project(failedSnapshot);
      return res.status(422).json({
        ok: false,
        error: smokeError.code || 'OPENROUTER_ONBOARDING_SMOKE_FAILED',
        code: smokeError.code || 'OPENROUTER_ONBOARDING_SMOKE_FAILED',
        message: smokeError.message || 'OpenRouter 最小真实调用未通过，未启用生产候选路由。',
        provider: 'openrouter',
        snapshot: failedSnapshot.openRouter || snapshot,
        onboarding: { pass: false, results: smokeResults },
        models: projectedFailure.models,
        routes: projectedFailure.routes,
        replyBrain: projectedFailure.replyBrain,
        nextAction: '检查失败模型后重新运行最小真实调用；不得把目录读取成功当作回复链路成功。'
      });
    }
    const automationConfig = await aiAutomation.updateConfig({ enabled: true, localOnly: false });
    const connectedState = await registry.recordOpenRouterSnapshot({
      connectionState: 'conditional-ready',
      authenticationStatus: 'passed',
      catalogStatus: 'passed',
      onboardingSmokeStatus: 'passed',
      onboardingSmokeResults: onboarding.results,
      onboardingPrimaryModelId: onboarding.primaryModelId,
      onboardingPrimaryModelSlug: onboarding.primaryModelSlug,
      onboardingFallbackModelId: onboarding.fallbackModelId,
      onboardingFallbackModelSlug: onboarding.fallbackModelSlug,
      routeStatus: 'conditional-ready',
      humanReviewRequired: true,
      formalQualificationStatus: 'pending',
      benchmarkStatus: 'pending'
    });
    const projected = modelStatus.project(connectedState);
    eventBus.publish('models:openrouter-auto-configured', {
      modelCount: snapshot.modelCount,
      freeModelCount: snapshot.freeModelCount,
      registeredModelCount: snapshot.registeredModelCount,
      onboardingSmokeStatus: 'passed',
      routeStatus: 'conditional-ready',
      benchmarkStatus: 'pending'
    });
    return res.json({
      ok: true,
      provider: 'openrouter',
      connectionState: 'conditional-ready',
      snapshot: connectedState.openRouter || snapshot,
      onboarding,
      models: projected.models,
      routes: projected.routes,
      replyBrain: projected.replyBrain,
      automation: automationConfig,
      routingPolicy: 'cloud-quality-first-local-fallback',
      localFallbackScope: 'offline-only',
      routingPolicyDetail: 'cloud-quality-first-local-offline-fallback',
      formalQualificationStatus: 'pending',
      humanReviewRequired: true,
      nextAction: '当前已可在人工确认下生成候选；商业专项评估需从模型服务页单独运行，不能阻塞接入弹窗。'
    });
  } catch (error) { next(error); }
});

router.get('/cloud/openrouter/status', (_req, res) => {
  const state = modelStatus.read();
  const openRouter = state.openRouter || {};
  const routeTasks = ['director', 'quick_reply', 'deep_reply', 'translation', 'learning_synthesis'];
  const plans = Object.fromEntries(routeTasks.map(task => [task, aiQualityRouteAuthority.routePlan({
    task,
    route: state.routes?.[task] || {},
    models: state.models || []
  })]));
  res.json({
    ok: true,
    provider: 'openrouter',
    connectionState: String(openRouter.connectionState || 'not-configured'),
    authenticationStatus: String(openRouter.authenticationStatus || 'unknown'),
    catalogStatus: String(openRouter.catalogStatus || 'unknown'),
    onboardingSmokeStatus: String(openRouter.onboardingSmokeStatus || 'not-run'),
    routeStatus: String(openRouter.routeStatus || 'blocked'),
    formalQualificationStatus: String(openRouter.formalQualificationStatus || openRouter.benchmarkStatus || 'pending'),
    key: openRouter.key || {},
    modelCount: Number(openRouter.modelCount || 0),
    eligibleModelCount: Number(openRouter.eligibleModelCount || 0),
    registeredModelCount: Number(openRouter.registeredModelCount || 0),
    primaryModel: { id: String(openRouter.onboardingPrimaryModelId || ''), slug: String(openRouter.onboardingPrimaryModelSlug || '') },
    fallbackModel: { id: String(openRouter.onboardingFallbackModelId || ''), slug: String(openRouter.onboardingFallbackModelSlug || '') },
    smokeResults: Array.isArray(openRouter.onboardingSmokeResults) ? openRouter.onboardingSmokeResults : [],
    routePlans: plans,
    openRouter
  });
});

router.post('/cloud/openrouter/commercial-benchmark', async (req, res, next) => {
  const batchKey = 'openrouter-commercial-benchmark';
  if (testControllers.has(batchKey)) {
    return res.status(409).json({
      ok: false,
      error: 'OPENROUTER_COMMERCIAL_BENCHMARK_ALREADY_RUNNING',
      message: 'OpenRouter商业模型评估正在串行运行，请等待当前批次完成。'
    });
  }
  const controller = new AbortController();
  testControllers.set(batchKey, controller);
  try {
    const initial = registry.read();
    if (!initial.openRouter?.credentialRef) {
      return res.status(409).json({ ok: false, error: 'OPENROUTER_NOT_CONFIGURED', message: '请先一键接入OpenRouter。' });
    }
    const benchmarkPlan = commercialModelBenchmark.chooseOpenRouterBenchmarkPlan(initial, {
      maxUtilityModels: Number(req.body?.maxUtilityModels || req.body?.maxModels || 10),
      maxReplyModels: Number(req.body?.maxReplyModels || 8),
      translationLimit: Number(req.body?.translationLimit || 4),
      memoryLimit: Number(req.body?.memoryLimit || 4),
      quickLimit: Number(req.body?.quickLimit || 3),
      directorLimit: Number(req.body?.directorLimit || 3),
      deepLimit: Number(req.body?.deepLimit || 3)
    });
    const utilityCandidates = benchmarkPlan.utilityCandidates;
    if (!utilityCandidates.length) {
      return res.status(409).json({ ok: false, error: 'OPENROUTER_BENCHMARK_CANDIDATES_EMPTY', message: '没有找到已接入的OpenRouter商业评估候选模型。' });
    }

    await registry.recordOpenRouterSnapshot({
      benchmarkStatus: 'running',
      benchmarkStartedAt: new Date().toISOString(),
      benchmarkPlan: {
        catalogCount: benchmarkPlan.catalogCount,
        registeredCount: benchmarkPlan.registeredCount,
        shortlistedCount: benchmarkPlan.shortlistedCount,
        utilityCandidateCount: benchmarkPlan.utilityCandidateCount,
        replyCandidateCount: benchmarkPlan.replyCandidateCount,
        unassessedCatalogCount: benchmarkPlan.unassessedCatalogCount,
        roleCoverage: benchmarkPlan.roleCoverage
      }
    });
    const commercialResults = [];
    for (const model of utilityCandidates) {
      if (controller.signal.aborted) break;
      const result = await commercialModelBenchmark.runAndRecord(model, {
        timeoutMs: Number(req.body?.timeoutMs || 180000),
        signal: controller.signal,
        registry
      });
      commercialResults.push({ modelId: model.id, model: model.name, displayName: model.displayName || model.name, result });
      eventBus.publish('models:openrouter-commercial-benchmark-progress', {
        phase: 'translation-and-evidence',
        completed: commercialResults.length,
        total: utilityCandidates.length,
        modelId: model.id,
        model: model.displayName || model.name,
        result
      });
    }

    let state = registry.read();
    const utilityRoutes = commercialModelBenchmark.recommendedUtilityRoutes(state.models || []);
    if (!controller.signal.aborted && req.body?.applyRoutes !== false) state = await registry.applyRecommendedUtilityRoutes(utilityRoutes);

    const stateModelsById = new Map((state.models || []).map(model => [model.id, model]));
    const replyCandidates = benchmarkPlan.replyCandidates
      .map(model => stateModelsById.get(model.id) || model)
      .filter(Boolean)
      .filter(model => !replyBrainBenchmark.isSpecialPurpose(model));
    const replyResults = [];
    for (const model of replyCandidates) {
      if (controller.signal.aborted) break;
      const workflow = await runReplyBrainBenchmarkWorkflow(model, {
        timeoutMs: Number(req.body?.replyTimeoutMs || req.body?.timeoutMs || 180000),
        latencyThresholdMs: Number(req.body?.latencyThresholdMs || 90000),
        signal: controller.signal,
        warmup: false
      });
      replyResults.push({ modelId: model.id, model: model.name, displayName: model.displayName || model.name, result: workflow.result, baseQualification: workflow.baseQualification });
      eventBus.publish('models:openrouter-commercial-benchmark-progress', {
        phase: 'reply-brain',
        completed: replyResults.length,
        total: replyCandidates.length,
        modelId: model.id,
        model: model.displayName || model.name,
        result: workflow.result
      });
    }

    state = registry.read();
    const replyRecommendation = replyBrainAuthority.recommendedReplyRoutes(state.models || [], state.routes || {});
    const completed = !controller.signal.aborted
      && commercialResults.length === utilityCandidates.length
      && replyResults.length === replyCandidates.length;
    if (completed && req.body?.applyRoutes !== false) state = await registry.applyRecommendedReplyBrainRoutes(replyRecommendation.routes);
    let balanceRefresh = null;
    if (!controller.signal.aborted) {
      try {
        balanceRefresh = await openRouterAutoConfiguration.refreshAccountStatus({
          credentialRef: initial.openRouter.credentialRef,
          endpoint: initial.openRouter.endpoint || openRouterAutoConfiguration.OPENROUTER_ENDPOINT,
          signal: controller.signal,
          registry
        });
      } catch (balanceError) {
        balanceRefresh = { balanceRefreshStatus: 'failed', balanceRefreshErrorCode: String(balanceError.code || 'OPENROUTER_BALANCE_REFRESH_FAILED') };
        await registry.recordOpenRouterSnapshot({ ...balanceRefresh, balanceRefreshedAt: new Date().toISOString() }).catch(() => {});
      }
    }
    const benchmarkCompletedAt = new Date().toISOString();
    state = await registry.recordOpenRouterSnapshot({
      benchmarkStatus: completed ? 'completed' : 'cancelled',
      benchmarkCompletedAt,
      benchmarkModelCount: commercialResults.length,
      replyBenchmarkModelCount: replyResults.length,
      benchmarkCatalogCount: benchmarkPlan.catalogCount,
      benchmarkRegisteredCount: benchmarkPlan.registeredCount,
      benchmarkShortlistedCount: benchmarkPlan.shortlistedCount,
      benchmarkUnassessedCatalogCount: benchmarkPlan.unassessedCatalogCount,
      balanceRefreshStatus: balanceRefresh?.balanceRefreshStatus || (controller.signal.aborted ? 'cancelled' : 'not-run'),
      balanceRefreshedAt: balanceRefresh?.balanceRefreshedAt || '',
      balanceRefreshErrorCode: balanceRefresh?.balanceRefreshErrorCode || '',
      routesApplied: completed && req.body?.applyRoutes !== false,
      utilityRoutes,
      replyRoutes: replyRecommendation.routes
    });
    const projected = modelStatus.project(state);
    eventBus.publish('models:openrouter-commercial-benchmark-complete', {
      completed,
      commercialCount: commercialResults.length,
      replyCount: replyResults.length,
      utilityRoutes,
      replyRoutes: replyRecommendation.routes
    });
    return res.json({
      ok: true,
      completed,
      cancelled: controller.signal.aborted,
      commercialResults,
      replyResults,
      utilityRoutes,
      replyRecommendation,
      benchmarkPlan: {
        catalogCount: benchmarkPlan.catalogCount,
        registeredCount: benchmarkPlan.registeredCount,
        shortlistedCount: benchmarkPlan.shortlistedCount,
        utilityCandidateCount: benchmarkPlan.utilityCandidateCount,
        replyCandidateCount: benchmarkPlan.replyCandidateCount,
        unassessedCatalogCount: benchmarkPlan.unassessedCatalogCount,
        roleCoverage: benchmarkPlan.roleCoverage
      },
      balanceRefresh,
      models: projected.models,
      routes: projected.routes,
      replyBrain: projected.replyBrain,
      openRouter: projected.openRouter || state.openRouter
    });
  } catch (error) {
    await registry.recordOpenRouterSnapshot({
      benchmarkStatus: controller.signal.aborted ? 'cancelled' : 'failed',
      benchmarkCompletedAt: new Date().toISOString(),
      benchmarkError: String(error.message || error),
      benchmarkErrorCode: String(error.code || 'OPENROUTER_COMMERCIAL_BENCHMARK_FAILED')
    }).catch(() => {});
    next(error);
  } finally {
    testControllers.delete(batchKey);
  }
});

router.post('/cloud/openrouter/commercial-benchmark/cancel', (_req, res) => {
  const controller = testControllers.get('openrouter-commercial-benchmark');
  if (!controller) return res.json({ ok: true, cancelled: false });
  controller.abort(Object.assign(new Error('MODEL_CANCELLED'), { code: 'MODEL_CANCELLED' }));
  res.json({ ok: true, cancelled: true });
});

router.delete('/cloud/:id', async (req, res, next) => {
  try {
    const model = findModel(req.params.id);
    if (!model) return res.status(404).json({ ok: false, error: 'MODEL_NOT_FOUND' });
    if (model.provider === 'ollama') return res.status(409).json({ ok: false, error: 'OLLAMA_MODEL_CANNOT_BE_REMOVED_HERE' });
    const state = await registry.removeModel(model.id);
    if (req.body?.removeCredential === true && model.credentialRef) await securityGuard.credentials.remove(model.credentialRef);
    res.json({ ok: true, removed: model.id, models: state.models });
  } catch (error) { next(error); }
});

router.delete('/local/:id', async (req, res, next) => {
  try {
    const model = findModel(req.params.id);
    if (!model) return res.status(404).json({ ok: false, error: 'MODEL_NOT_FOUND', message: '没有找到该本地模型' });
    if (model.provider !== 'ollama') return res.status(409).json({ ok: false, error: 'LOCAL_MODEL_REQUIRED', message: '该接口只删除本地 Ollama 模型' });
    if (model.userDisabled !== true) return res.status(409).json({ ok: false, error: 'MODEL_MUST_BE_DISABLED_FIRST', message: '必须先停用模型并移出全部任务路由，才能从 Ollama 删除。' });
    const exactName = String(req.body?.confirmName || '').trim();
    if (exactName !== model.name) return res.status(400).json({ ok: false, error: 'MODEL_DELETE_CONFIRMATION_MISMATCH', message: '请输入完整模型名称确认删除。' });
    const current = modelStatus.read();
    const projected = (current.models || []).find(row => row.id === model.id);
    if ((projected?.routedTasks || []).length) return res.status(409).json({ ok: false, error: 'MODEL_ROUTE_DEPENDENCY_EXISTS', message: '该模型仍被任务路由引用，请先迁移任务路由。', routedTasks: projected.routedTasks });
    await ollama.unload(model.endpoint, model.name).catch(() => {});
    await ollama.remove(model.endpoint, model.name);
    const state = await registry.removeModel(model.id);
    res.json({ ok: true, removed: model.id, removedName: model.name, removedFromOllama: true, models: state.models });
  } catch (error) { next(error); }
});

router.post('/scan', async (req, res, next) => {
  try {
    const discovery = await ollama.discover({ hosts: req.body?.hosts });
    await registry.mergeDiscovered(discovery);
    const state = modelStatus.read();
    eventBus.publish('models:scanned', { discovery, registry: state });
    const activation = modelAutoActivation.schedule({ force: req.body?.forceQualification === true });
    res.json({ ok: true, discovery, registry: state, activation });
  } catch (error) { next(error); }
});

router.post('/reply-brain/benchmark-local', async (req, res, next) => {
  const batchKey = 'reply-brain-local-batch';
  if (testControllers.has(batchKey)) {
    return res.status(409).json({
      ok: false,
      error: 'REPLY_BRAIN_BENCHMARK_ALREADY_RUNNING',
      message: '本地回复模型正在串行评估，请等待当前批次完成，不要重复启动。'
    });
  }
  const controller = new AbortController();
  testControllers.set(batchKey, controller);
  try {
    const initial = registry.read();
    const force = req.body?.force === true;
    const candidates = (initial.models || []).filter(model => {
      const last = model.lastReplyBrainBenchmarkAttempt || model.lastReplyBrainBenchmark;
      return model.provider === 'ollama'
        && model.available !== false
        && model.userDisabled !== true
        && !replyBrainBenchmark.isSpecialPurpose(model)
        && (force || !last || last.pass !== true || last.status === 'REPLY_BRAIN_INCOMPLETE');
    });
    const results = [];
    for (const model of candidates) {
      if (controller.signal.aborted) break;
      let row;
      try {
        row = await runReplyBrainBenchmarkWorkflow(model, {
          timeoutMs: Number(req.body?.timeoutMs || 0) || undefined,
          latencyThresholdMs: Number(req.body?.latencyThresholdMs || 0) || undefined,
          signal: controller.signal
        });
        results.push({ modelId: model.id, model: model.name, result: row.result, baseQualification: row.baseQualification, runtimeProfile: row.runtimeProfile });
        eventBus.publish('model:reply-brain-benchmark-progress', {
          completed: results.length,
          total: candidates.length,
          modelId: model.id,
          model: model.name,
          result: row.result,
          runtimeProfile: row.runtimeProfile
        });
      } finally {
        await ollama.unload(model.endpoint, model.name).catch(() => {});
      }
    }

    let state = registry.read();
    const recommendation = replyBrainAuthority.recommendedReplyRoutes(state.models || [], state.routes || {});
    const batchCompleted = !controller.signal.aborted && results.length === candidates.length;
    if (batchCompleted && req.body?.applyRoutes !== false) state = await registry.applyRecommendedReplyBrainRoutes(recommendation.routes);
    const projected = modelStatus.project(state);
    eventBus.publish('models:reply-brain-benchmark-complete', { count: results.length, recommendation, batchCompleted });
    res.json({
      ok: true,
      batchCompleted,
      count: results.length,
      skipped: (initial.models || []).filter(model => model.provider === 'ollama').length - candidates.length,
      incomplete: results.filter(row => row.result?.completed === false).length,
      results,
      recommendation,
      models: projected.models,
      routes: projected.routes,
      replyBrain: projected.replyBrain
    });
  } catch (error) {
    next(error);
  } finally {
    testControllers.delete(batchKey);
  }
});

router.post('/:id/reply-brain-benchmark', async (req, res, next) => {
  const model = findModel(req.params.id);
  if (!model) return res.status(404).json({ ok: false, error: 'MODEL_NOT_FOUND', message: '没有找到该模型' });
  if (testControllers.has(model.id) || testControllers.has('reply-brain-local-batch')) {
    return res.status(409).json({ ok: false, error: 'REPLY_BRAIN_BENCHMARK_ALREADY_RUNNING', message: '该模型或本地批次正在评估，请等待当前任务完成。' });
  }
  const controller = new AbortController();
  testControllers.set(model.id, controller);
  try {
    const workflow = await runReplyBrainBenchmarkWorkflow(model, {
      timeoutMs: Number(req.body?.timeoutMs || 0) || undefined,
      latencyThresholdMs: Number(req.body?.latencyThresholdMs || 0) || undefined,
      signal: controller.signal
    });
    const projected = modelStatus.project(workflow.state);
    res.json({
      ok: true,
      qualified: workflow.result.pass === true,
      completed: workflow.result.completed !== false,
      baseQualification: workflow.baseQualification,
      runtimeProfile: workflow.runtimeProfile,
      result: workflow.result,
      model: projected.models.find(row => row.id === model.id),
      replyBrain: projected.replyBrain
    });
  } catch (error) {
    next(error);
  } finally {
    testControllers.delete(model.id);
    await ollama.unload(model.endpoint, model.name).catch(() => {});
  }
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
    testControllers.delete(model.id);
    res.json({ ok: true, model, result });
  } catch (error) {
    testControllers.delete(req.params.id);
    next(error);
  }
});

router.post('/:id/cancel', (req, res) => {
  const controller = testControllers.get(req.params.id);
  if (!controller) return res.json({ ok: true, cancelled: false });
  controller.abort(new Error('TEST_CANCELLED'));
  testControllers.delete(req.params.id);
  res.json({ ok: true, cancelled: true });
});

router.post('/test-all', async (req, res, next) => {
  try {
    const state = registry.read();
    const models = (state.models || []).filter(model => model.available !== false);
    const results = await qualification.qualifyAll(models, {
      tests: Array.isArray(req.body?.tests) && req.body.tests.length ? req.body.tests : undefined,
      timeoutMs: Number(req.body?.timeoutMs || 180000)
    });
    res.json({ ok: true, count: results.length, results });
  } catch (error) { next(error); }
});

router.post('/:id/unload', async (req, res, next) => {
  try {
    const model = findModel(req.params.id);
    if (!model) return res.status(404).json({ ok: false, error: 'MODEL_NOT_FOUND' });
    if (model.provider !== 'ollama') return res.status(409).json({ ok: false, error: 'CLOUD_MODEL_CANNOT_BE_UNLOADED' });
    await ollama.unload(model.endpoint, model.name);
    res.json({ ok: true, modelId: model.id, model: model.name });
  } catch (error) { next(error); }
});

function routeTestMessages(task) {
  if (task === 'director') return [
    { role: 'system', content: '只输出合法 JSON，不要代码块。字段：strategy、reasonZh、targetLanguage、maxQuestions。targetLanguage 必须是 de，maxQuestions 只能是 0 或 1。' },
    { role: 'user', content: '为德语 WhatsApp 消息“Ich hatte heute einen langen Tag, wollte aber trotzdem wissen, wie es dir geht.”制定自然成熟的回复策略。' }
  ];
  const stylePrompt = task === 'deep_reply'
    ? '成熟、独立、温暖但有边界。结合上下文，输出 1 到 2 个自然短句。'
    : '成熟、独立、自然、简短。输出 1 到 2 个 WhatsApp 短句。';
  return [
    { role: 'system', content: whatsappReplyStyle.runtimePrompt({ targetLanguage: '德语', presentationProfile: { expressionHabits: ['short natural messages', 'at most one question', 'no repeated name', 'no em dash'] }, stylePrompt }) },
    { role: 'user', content: '对方说：Ich hatte heute einen langen Tag, wollte aber trotzdem wissen, wie es dir geht.' }
  ];
}

function judgeRouteTest(task, text) {
  if (task === 'director') {
    let value = null;
    try { value = JSON.parse(String(text || '').replace(/^```json\s*/iu, '').replace(/```$/u, '').trim()); } catch (_) {}
    const issues = [];
    if (!value || typeof value !== 'object' || Array.isArray(value)) issues.push({ code: 'INVALID_JSON', message: '导演模型没有输出合法 JSON 对象' });
    if (value && String(value.targetLanguage || '').toLowerCase() !== 'de') issues.push({ code: 'WRONG_TARGET_LANGUAGE', message: '导演模型没有保持德语目标语言' });
    if (value && ![0, 1].includes(Number(value.maxQuestions))) issues.push({ code: 'INVALID_MAX_QUESTIONS', message: '导演模型问题数量上限无效' });
    return { pass: issues.length === 0, issues, structured: value };
  }
  const validation = whatsappReplyStyle.validate(text);
  const issues = [...(validation.issues || [])];
  if (!appearsGerman(text)) issues.push({ code: 'WRONG_LANGUAGE', message: '测试回复不是自然德语' });
  if (/[\u3400-\u9fff]/u.test(String(text || ''))) issues.push({ code: 'CHINESE_LEAK', message: '客户回复正文混入中文' });
  return { pass: issues.length === 0, issues };
}

router.post('/routes/:task/test', async (req, res, next) => {
  try {
    const task = String(req.params.task || '').trim();
    if (!['quick_reply', 'deep_reply', 'director'].includes(task)) return res.status(400).json({ ok: false, error: 'UNSUPPORTED_ROUTE_TEST', message: '当前只支持测试快速回复、深度回复和 AI 导演路由。' });
    const state = modelStatus.read();
    const route = state.routes?.[task] || {};
    if (route.enabled === false || !route.primary) return res.status(409).json({ ok: false, error: 'ROUTE_NOT_CONFIGURED', message: '请先选择主模型并启用该任务路由。' });
    const startedAt = Date.now();
    const result = await aiGateway.execute({
      task,
      messages: routeTestMessages(task),
      options: {
        maxTokens: Number(route.maxTokens || (task === 'deep_reply' ? 480 : task === 'director' ? 360 : 220)),
        timeoutMs: modelTaskRuntimePolicy.normalizeTimeoutMs(task, Math.max(Number(route.timeoutMs || 0), Number(req.body?.timeoutMs || 0))),
        temperature: task === 'director' ? 0.2 : 0.65,
        json: task === 'director'
      }
    });
    const judged = judgeRouteTest(task, result.text || '');
    res.json({
      ok: true,
      pass: judged.pass,
      task,
      route: {
        primary: route.primary,
        fallback: route.fallback || '',
        allowConditional: route.allowConditional === true,
        humanReviewRequired: route.humanReviewRequired === true || route.allowConditional === true,
        primarySelection: route.primarySelection || 'manual',
        fallbackSelection: route.fallbackSelection || 'manual',
        autoSelectionReason: route.autoSelectionReason || '',
        timeoutMs: modelTaskRuntimePolicy.normalizeTimeoutMs(task, route.timeoutMs)
      },
      modelId: result.modelId,
      model: result.model,
      fallbackUsed: result.fallbackUsed === true,
      conditionalRoute: result.conditionalRoute === true,
      durationMs: Date.now() - startedAt,
      attempts: result.attempts || [],
      issues: judged.issues || [],
      preview: String(result.text || '').slice(0, 600),
      structured: judged.structured || null,
      message: judged.pass ? '当前路由真实测试通过。' : '模型能够调用，但输出没有通过语言、Persona 或 WhatsApp 风格门禁。'
    });
  } catch (error) { next(error); }
});

router.post('/routes', async (req, res, next) => {
  try {
    const state = await registry.setRoutes(req.body?.routes || {});
    res.json({ ok: true, routes: state.routes });
  } catch (error) { next(error); }
});

router.post('/execute', async (req, res, next) => {
  const controller = new AbortController();
  const abortRequest = () => {
    if (!controller.signal.aborted) controller.abort(Object.assign(new Error('MODEL_REQUEST_DISCONNECTED'), { code: 'MODEL_REQUEST_DISCONNECTED' }));
  };
  req.once('aborted', abortRequest);
  const closeHandler = () => { if (!res.writableEnded) abortRequest(); };
  res.once('close', closeHandler);
  try {
    const result = await aiGateway.execute({
      task: req.body?.task,
      messages: req.body?.messages || [],
      modelId: req.body?.modelId || '',
      options: req.body?.options || {},
      dedupeKey: req.body?.dedupeKey || '',
      fingerprint: req.body?.fingerprint || '',
      context: req.body?.context || {},
      signal: controller.signal
    });
    if (!res.writableEnded) res.json({ ok: true, result, structured: result.structured ?? null });
  } catch (error) {
    if (!controller.signal.aborted && !res.headersSent) next(error);
  } finally {
    req.removeListener('aborted', abortRequest);
    res.removeListener('close', closeHandler);
  }
});


router.post('/jobs', (req, res, next) => {
  try {
    const submitted = aiGateway.submit({
      task: req.body?.task,
      messages: req.body?.messages || [],
      modelId: req.body?.modelId || '',
      options: req.body?.options || {},
      context: req.body?.context || {}
    });
    res.status(202).json({ ok: true, ...submitted });
  } catch (error) { next(error); }
});
router.get('/jobs', (_req, res) => res.json({ ok: true, status: aiGateway.status() }));
router.get('/jobs/:id', (req, res) => {
  const job = aiGateway.getJob(req.params.id);
  if (!job) return res.status(404).json({ ok: false, error: 'JOB_NOT_FOUND' });
  res.json({ ok: true, job });
});

router.post('/jobs/:id/cancel', (req, res) => {
  res.json({ ok: true, cancelled: aiGateway.cancel(req.params.id) });
});

module.exports = router;
