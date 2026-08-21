'use strict';

const authority = require('./modelRuntimeAuthority');
const modelBrainProjection = require('./modelBrainProjection');
const modelBrainRuntime = require('./modelBrainRuntime');
const replyBrainAuthority = require('./replyBrainModelAuthority');
const aiTaskRoleReadinessAuthority = require('./aiTaskRoleReadinessAuthority');

const LOCAL_AUXILIARY_TASKS = Object.freeze(['translation', 'understanding', 'relationship', 'quality_review', 'summary', 'fact_extraction', 'memory_extraction', 'media_analysis', 'material_analysis', 'persona_rewrite', 'speech_transcription']);

function normalizeModel(model = {}) { return replyBrainAuthority.projectModel(modelBrainProjection.projectModel(model)); }
function localAuxiliaryProjection(state = {}, models = []) {
  const rawModels = Array.isArray(state.models) ? state.models : [];
  const rawById = new Map(rawModels.map(model => [String(model?.id || model?.name || ''), model]));
  const localModels = models.filter(model => model.sourceType === 'local');
  const evidence = localModels.map(model => {
    const raw = rawById.get(model.id) || {};
    const qualification = raw.lastTest || raw.lastQualificationTest || null;
    const benchmark = raw.lastCommercialBenchmark || null;
    const invocation = raw.lastSuccessfulInvocation || null;
    const measured = Boolean(qualification || benchmark || invocation);
    return Object.freeze({
      modelId: model.id,
      model: model.name,
      qualification: model.qualification,
      allowedTasks: Object.freeze((Array.isArray(raw.allowedTasks) ? raw.allowedTasks : []).filter(task => LOCAL_AUXILIARY_TASKS.includes(String(task)))),
      measured,
      testedAt: String(benchmark?.testedAt || raw.testedAt || raw.qualificationTestedAt || ''),
      benchmarkStatus: String(raw.commercialBenchmarkStatus || benchmark?.status || ''),
      score: Number(raw.commercialBenchmarkScore || benchmark?.score || 0),
      latencyMs: Number(invocation?.latencyMs || 0),
      outputTokens: Number(invocation?.outputTokens || 0)
    });
  });
  const measured = evidence.filter(row => row.measured);
  const qualified = localModels.filter(model => ['verified', 'qualified'].includes(String(model.qualification).toLowerCase()));
  return Object.freeze({
    authority: 'Local Auxiliary Runtime Authority',
    runtime: 'Ollama',
    optional: true,
    asynchronousByDefault: true,
    independentlyScheduled: true,
    scheduler: 'local-auxiliary',
    runtimeAvailable: state.ollamaOnline === true,
    endpoint: state.endpoint || '',
    realtimeReplyAuthority: false,
    formalReplyFallback: false,
    formalReplyDependency: false,
    lifecycle: Object.freeze({ onDemandPull: true, progress: true, cancellation: true, unload: true, delete: true }),
    benchmark: Object.freeze({
      available: measured.length > 0,
      measuredModels: measured.length,
      qualifiedModels: qualified.length,
      evidence: Object.freeze(evidence)
    }),
    sla: Object.freeze({
      interactiveQueueShared: false,
      formalReplyDependency: false,
      formalReplyFallback: false,
      admissionRequiresQualificationAndBenchmarkEvidence: true,
      allowedTasks: LOCAL_AUXILIARY_TASKS
    })
  });
}
function project(state = {}, options = {}) {
  const models = (Array.isArray(state.models) ? state.models : []).map(normalizeModel);
  const runtime = options.modelBrainRuntime || modelBrainRuntime.status();
  const taskReadiness = aiTaskRoleReadinessAuthority.evaluate({ models: state.models || [], modelBrainRuntime: runtime });
  const replyBrain = replyBrainAuthority.evaluate(models);
  const rawOpenRouter = state.openRouter && typeof state.openRouter === 'object' ? state.openRouter : {};
  const { credentialRef: _secretRef, ...openRouterSnapshot } = rawOpenRouter;
  const trackedCloudCostUsd = models.reduce((sum, model) => sum + Number(model.totalCostUsd || 0), 0);
  const localAuxiliary = localAuxiliaryProjection(state, models);
  return {
    schemaVersion: 7,
    source: 'sqlite:model-registry',
    authority: 'Model Brain / LiteLLM',
    generatedAt: new Date().toISOString(),
    modelBrain: {
      name: 'Model Brain',
      litellm: 'LiteLLM v1.95.0',
      health: runtime.health,
      runtimeAvailable: runtime.runtimeAvailable,
      complexityRouter: runtime.complexityRouter,
      strictTagFiltering: runtime.strictTagFiltering,
      lastEvidence: runtime.lastEvidence || null
    },
    localAuxiliary,
    catalog: {
      ollamaOnline: state.ollamaOnline === true,
      endpoint: state.endpoint || '',
      version: state.version || '',
      scannedAt: state.scannedAt || '',
      scanError: state.scanError || ''
    },
    history: Array.isArray(state.history) ? state.history.slice(0, 500) : [],
    models,
    openRouter: { ...openRouterSnapshot, credentialConfigured: Boolean(rawOpenRouter.credentialRef) },
    replyBrain,
    taskReadiness,
    summary: {
      total: models.length,
      verified: models.filter(model => model.qualification === 'verified').length,
      experimental: models.filter(model => model.qualification === 'experimental').length,
      local: models.filter(model => model.sourceType === 'local').length,
      cloud: models.filter(model => model.sourceType === 'cloud').length,
      coreTasksReady: taskReadiness.pass,
      coreTasksMissing: taskReadiness.missing.map(row => ({ task: row.task, reason: row.reason })),
      trackedCloudCostUsd: Number(trackedCloudCostUsd.toFixed(12)),
      openRouterConnected: Boolean(rawOpenRouter.credentialRef),
      localAuxiliaryAvailable: localAuxiliary.runtimeAvailable,
      localAuxiliaryMeasuredModels: localAuxiliary.benchmark.measuredModels
    }
  };
}
module.exports = { STATES: authority.STATES, normalizeQualification: authority.normalizeQualification, qualificationLabel: authority.qualificationLabel, normalizeModel, localAuxiliaryProjection, project };
