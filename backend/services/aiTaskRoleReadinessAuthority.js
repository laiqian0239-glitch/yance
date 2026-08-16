'use strict';

const modelBrainProjection = require('./modelBrainProjection');
const modelBrainRuntime = require('./modelBrainRuntime');
const roleReceiptAuthority = require('./aiRoleQualificationReceiptAuthority');
const AUTHORITY = 'ModelBrainTaskCapabilityReadiness';
const SCHEMA_VERSION = 2;
const CORE_AI_TASKS = Object.freeze(['translation','understanding','relationship','director','quick_reply','deep_reply','fact_extraction','memory_extraction']);
const REDUNDANCY_REQUIRED_TASKS = Object.freeze([]);
function clean(value) { return String(value == null ? '' : value).trim(); }
function commercialTaskPass(model = {}, task = '') {
  const benchmark = model.lastCommercialBenchmark && typeof model.lastCommercialBenchmark === 'object' ? model.lastCommercialBenchmark : null;
  return Boolean(benchmark && roleReceiptAuthority.evidenceAllowsIssuance(clean(task), benchmark).pass === true);
}
function formalTaskEligible(model = {}, task = '') {
  const projection = modelBrainProjection.project({ models: [model] }, { task });
  return projection.candidates.length === 1;
}
function evaluate(modelState = {}) {
  const models = Array.isArray(modelState.models) ? modelState.models : [];
  const runtime = modelState.modelBrainRuntime || modelBrainRuntime.status();
  const tasks = CORE_AI_TASKS.map(task => {
    const projection = modelBrainProjection.project({ models }, { task });
    const capabilityCount = projection.candidates.length;
    const ready = capabilityCount > 0 && runtime.runtimeAvailable !== false;
    return {
      task,
      logicalModel: projection.logicalModel,
      capabilityCount,
      ready,
      reason: capabilityCount === 0 ? 'no-hard-qualified-capability' : runtime.runtimeAvailable === false ? 'model-brain-runtime-unavailable' : ''
    };
  });
  const missing = tasks.filter(row => !row.ready);
  return {
    authority: AUTHORITY,
    schemaVersion: SCHEMA_VERSION,
    modelBrain: 'Model Brain',
    litellm: 'LiteLLM v1.95.0',
    runtime: { health: runtime.health, available: runtime.runtimeAvailable !== false },
    coreTasks: [...CORE_AI_TASKS],
    tasks,
    configured: tasks.filter(row => row.capabilityCount > 0).length,
    operational: tasks.filter(row => row.ready).length,
    missing,
    pass: models.length > 0 && missing.length === 0,
    summary: missing.length ? `Model Brain capability readiness ${tasks.length - missing.length}/${tasks.length}` : `Model Brain capability readiness ${tasks.length}/${tasks.length}`
  };
}
module.exports = { AUTHORITY, SCHEMA_VERSION, CORE_AI_TASKS, REDUNDANCY_REQUIRED_TASKS, commercialTaskPass, formalTaskEligible, evaluate, roleReceiptAuthority };
