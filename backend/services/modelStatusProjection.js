'use strict';

const authority = require('./modelRuntimeAuthority');
const modelBrainProjection = require('./modelBrainProjection');
const modelBrainRuntime = require('./modelBrainRuntime');
const replyBrainAuthority = require('./replyBrainModelAuthority');
const aiTaskRoleReadinessAuthority = require('./aiTaskRoleReadinessAuthority');

function normalizeModel(model = {}) { return replyBrainAuthority.projectModel(modelBrainProjection.projectModel(model)); }
function project(state = {}, options = {}) {
  const models = (Array.isArray(state.models) ? state.models : []).map(normalizeModel);
  const runtime = options.modelBrainRuntime || modelBrainRuntime.status();
  const taskReadiness = aiTaskRoleReadinessAuthority.evaluate({ models: state.models || [], modelBrainRuntime: runtime });
  const replyBrain = replyBrainAuthority.evaluate(models);
  const rawOpenRouter = state.openRouter && typeof state.openRouter === 'object' ? state.openRouter : {};
  const { credentialRef: _secretRef, ...openRouterSnapshot } = rawOpenRouter;
  const trackedCloudCostUsd = models.reduce((sum, model) => sum + Number(model.totalCostUsd || 0), 0);
  return {
    schemaVersion: 6,
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
      openRouterConnected: Boolean(rawOpenRouter.credentialRef)
    }
  };
}
module.exports = { STATES: authority.STATES, normalizeQualification: authority.normalizeQualification, qualificationLabel: authority.qualificationLabel, normalizeModel, project };
