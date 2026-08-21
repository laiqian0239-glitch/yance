'use strict';

const authority = require('./modelRuntimeAuthority');
const modelBrainProjection = require('./modelBrainProjection');
const modelBrainRuntime = require('./modelBrainRuntime');
const replyBrainAuthority = require('./replyBrainModelAuthority');
const aiTaskRoleReadinessAuthority = require('./aiTaskRoleReadinessAuthority');

const LOCAL_AUXILIARY_TASKS = Object.freeze(['translation', 'understanding', 'relationship', 'quality_review', 'summary', 'fact_extraction', 'memory_extraction', 'media_analysis', 'material_analysis', 'persona_rewrite', 'speech_transcription']);

function normalizeModel(model = {}) { return replyBrainAuthority.projectModel(modelBrainProjection.projectModel(model)); }
function localAuxiliaryBenchmark(raw = {}) {
  const benchmark = raw.lastCommercialBenchmark && typeof raw.lastCommercialBenchmark === 'object' ? raw.lastCommercialBenchmark : null;
  const completed = benchmark?.completed === true;
  const pass = completed
    && benchmark?.pass === true
    && String(benchmark?.authority || '') === 'YanceCommercialModelBenchmark'
    && String(benchmark?.status || '') === 'COMMERCIAL_MODEL_QUALIFIED';
  const qualifyingTasks = pass
    ? [...new Set((Array.isArray(benchmark?.qualifyingTasks) ? benchmark.qualifyingTasks : []).map(String).filter(task => LOCAL_AUXILIARY_TASKS.includes(task)))]
    : [];
  const scenarios = Array.isArray(benchmark?.scenarios) ? benchmark.scenarios : [];
  const totalMs = scenarios.reduce((max, scenario) => Math.max(max, Number(scenario?.metrics?.totalMs || 0)), 0);
  const outputTokens = scenarios.reduce((sum, scenario) => sum + Number(scenario?.metrics?.outputTokens || 0), 0);
  return { benchmark, completed, pass, qualifyingTasks, totalMs, outputTokens };
}
function localAuxiliaryProjection(state = {}, models = []) {
  const rawModels = Array.isArray(state.models) ? state.models : [];
  const rawById = new Map(rawModels.map(model => [String(model?.id || model?.name || ''), model]));
  const localModels = models.filter(model => model.sourceType === 'local');
  const evidence = localModels.map(model => {
    const raw = rawById.get(model.id) || {};
    const benchmarkState = localAuxiliaryBenchmark(raw);
    const rawAllowedTasks = new Set(Array.isArray(raw.allowedTasks) ? raw.allowedTasks.map(String) : []);
    const allowedTasks = benchmarkState.qualifyingTasks.filter(task => rawAllowedTasks.has(task));
    const qualification = String(model.qualification || '').toLowerCase();
    const qualified = ['verified', 'qualified'].includes(qualification) && benchmarkState.pass && allowedTasks.length > 0;
    return Object.freeze({
      modelId: model.id,
      model: model.name,
      qualification: model.qualification,
      allowedTasks: Object.freeze(allowedTasks),
      measured: benchmarkState.completed,
      qualified,
      testedAt: String(benchmarkState.benchmark?.testedAt || ''),
      benchmarkAuthority: String(benchmarkState.benchmark?.authority || ''),
      benchmarkStatus: String(benchmarkState.benchmark?.status || ''),
      benchmarkPass: benchmarkState.pass,
      score: Number(benchmarkState.benchmark?.score || 0),
      latencyMs: benchmarkState.totalMs,
      outputTokens: benchmarkState.outputTokens
    });
  });
  const measured = evidence.filter(row => row.measured);
  const qualified = evidence.filter(row => row.qualified);
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
