'use strict';

const replyBrainAuthority = require('./replyBrainModelAuthority');
const roleReceiptAuthority = require('./aiRoleQualificationReceiptAuthority');

const AUTHORITY = 'AIBrainRoleLifecycleAuthority';
const SCHEMA_VERSION = 2;

const STATES = Object.freeze({
  CATALOG_ONLY: 'CATALOG_ONLY',
  CONNECTIVITY_VERIFIED: 'CONNECTIVITY_VERIFIED',
  TASK_CHALLENGER: 'TASK_CHALLENGER',
  TASK_BENCHMARK_PASSED: 'TASK_BENCHMARK_PASSED',
  ROLE_QUALIFIED: 'ROLE_QUALIFIED',
  TASK_CHAMPION: 'TASK_CHAMPION',
  TASK_RUNNER_UP: 'TASK_RUNNER_UP',
  SHADOW_VALIDATED: 'SHADOW_VALIDATED',
  ACTIVE: 'ACTIVE',
  DEGRADED: 'DEGRADED',
  REVOKED: 'REVOKED'
});

const STAGES = Object.freeze({
  [STATES.CATALOG_ONLY]: 0,
  [STATES.CONNECTIVITY_VERIFIED]: 10,
  [STATES.TASK_CHALLENGER]: 20,
  [STATES.TASK_BENCHMARK_PASSED]: 30,
  [STATES.ROLE_QUALIFIED]: 40,
  [STATES.TASK_CHAMPION]: 50,
  [STATES.TASK_RUNNER_UP]: 50,
  [STATES.SHADOW_VALIDATED]: 60,
  [STATES.ACTIVE]: 70,
  [STATES.DEGRADED]: 80,
  [STATES.REVOKED]: 90
});

function clean(value) { return String(value == null ? '' : value).trim(); }
function normalizedTask(value) {
  const task = clean(value);
  if (task === 'reply' || task === 'standard_reply') return 'quick_reply';
  return task;
}
function idSet(value) {
  if (value instanceof Set) return value;
  return new Set(Array.isArray(value) ? value.map(clean).filter(Boolean) : []);
}
function isMutableAlias(model = {}) {
  const identity = `${clean(model.id)} ${clean(model.name)} ${clean(model.modelSlug)}`;
  return /(?:^|[\s/:._-])latest(?:$|[\s/:._-])/iu.test(identity)
    || model.catalogMetadata?.mutableAlias === true
    || model.mutableAlias === true;
}
function hasConnectivityEvidence(model = {}) {
  return Boolean(
    model.connectivityStatus === 'passed'
    || model.runtimeAvailable === true
    || model.routeContinuityAvailable === true
    || model.lastSuccessfulInvocation
    || model.lastSuccessAt
    || Number(model.callCount || 0) > 0
  );
}
function benchmarkFor(model = {}, task = '') {
  return normalizedTask(task) === 'translation'
    ? (model.lastCommercialBenchmark && typeof model.lastCommercialBenchmark === 'object' ? model.lastCommercialBenchmark : null)
    : (model.lastReplyBrainBenchmark && typeof model.lastReplyBrainBenchmark === 'object' ? model.lastReplyBrainBenchmark : null);
}
function benchmarkPassed(model = {}, task = '') {
  const target = normalizedTask(task);
  const benchmark = benchmarkFor(model, target);
  const tasks = new Set(Array.isArray(benchmark?.qualifyingTasks) ? benchmark.qualifyingTasks.map(clean) : []);
  if (!benchmark || benchmark.completed !== true || benchmark.pass !== true || !tasks.has(target)) return false;
  if (target === 'translation') return clean(benchmark.authority) === 'YanceCommercialModelBenchmark' && clean(benchmark.status) === 'COMMERCIAL_MODEL_QUALIFIED';
  return clean(benchmark.authority) === 'YanceReplyBrainBenchmark' && clean(benchmark.status) === 'REPLY_BRAIN_QUALIFIED';
}
function receiptDecision(model = {}, task = '', context = {}) {
  const target = normalizedTask(task);
  if (!roleReceiptAuthority.GOVERNED_TASKS.includes(target)) return { pass: false, reason: 'ROLE_RECEIPT_TASK_UNSUPPORTED' };
  return roleReceiptAuthority.validate(model, target, { now: context.now });
}
function runtimeDegraded(model = {}) {
  const openedUntil = Date.parse(clean(model.circuitOpenedUntil));
  return model.available === false
    || model.currentFailure
    || model.lastInvocationStatus === 'failed'
    || Boolean(clean(model.lastError))
    || (Number.isFinite(openedUntil) && openedUntil > Date.now());
}
function challengerEligible(model = {}, task = '') {
  const target = normalizedTask(task);
  const benchmark = benchmarkFor(model, target);
  if (benchmark) return replyBrainAuthority.taskQualification(model, target).selectable === true;
  const attempt = target === 'translation' ? model.lastCommercialBenchmarkAttempt : model.lastReplyBrainBenchmarkAttempt;
  if (attempt) return true;
  const declaredTasks = [
    ...(Array.isArray(model.challengerTasks) ? model.challengerTasks : []),
    ...(Array.isArray(model.taskHints) ? model.taskHints : []),
    ...(Array.isArray(model.catalogMetadata?.challengerTasks) ? model.catalogMetadata.challengerTasks : [])
  ].map(clean);
  return model.taskChallenger === true || declaredTasks.includes(target);
}
function makeResult(model, task, state, reasonCode, facts = {}) {
  const formal = facts.receipt?.pass === true;
  const selectable = ![STATES.CATALOG_ONLY, STATES.CONNECTIVITY_VERIFIED, STATES.DEGRADED, STATES.REVOKED].includes(state);
  const routable = formal && ![STATES.DEGRADED, STATES.REVOKED].includes(state);
  return Object.freeze({
    authority: AUTHORITY,
    schemaVersion: SCHEMA_VERSION,
    modelId: clean(model?.id),
    task: normalizedTask(task),
    state,
    stage: STAGES[state],
    selectable,
    routable,
    formal,
    active: state === STATES.ACTIVE,
    reasonCode: clean(reasonCode),
    evidence: Object.freeze({
      connectivityVerified: facts.connectivity === true,
      benchmarkPassed: facts.benchmarkPass === true,
      benchmark: facts.benchmark || null,
      roleReceipt: facts.receipt || null,
      mutableAlias: facts.mutableAlias === true
    })
  });
}

function deriveModelTaskLifecycle(model = {}, task = '', context = {}) {
  const target = normalizedTask(task);
  const modelId = clean(model.id);
  const connectivity = hasConnectivityEvidence(model);
  const benchmark = benchmarkFor(model, target);
  const benchmarkPass = benchmarkPassed(model, target);
  const receipt = receiptDecision(model, target, context);
  const mutableAlias = isMutableAlias(model);
  const facts = { connectivity, benchmark, benchmarkPass, receipt, mutableAlias };

  if (!modelId) return makeResult(model, target, STATES.CATALOG_ONLY, 'MODEL_ID_REQUIRED', facts);
  if (model.userDisabled === true || model.revoked === true || clean(model.lifecycleState) === STATES.REVOKED) {
    return makeResult(model, target, STATES.REVOKED, 'MODEL_ROLE_REVOKED', facts);
  }
  if (runtimeDegraded(model)) return makeResult(model, target, STATES.DEGRADED, 'MODEL_RUNTIME_DEGRADED', facts);
  if (mutableAlias && (benchmarkPass || receipt.pass === true)) {
    return makeResult(model, target, STATES.TASK_CHALLENGER, 'MUTABLE_MODEL_ALIAS_NOT_FORMALLY_QUALIFIABLE', { ...facts, receipt: { ...receipt, pass: false } });
  }

  const active = idSet(context.activeModelIds).has(modelId);
  const shadow = idSet(context.shadowValidatedModelIds).has(modelId);
  if (receipt.pass === true && active) return makeResult(model, target, STATES.ACTIVE, 'MODEL_ACTIVE_FOR_TASK', facts);
  if (receipt.pass === true && shadow) return makeResult(model, target, STATES.SHADOW_VALIDATED, 'MODEL_SHADOW_VALIDATED', facts);
  if (receipt.pass === true && clean(context.championModelId) === modelId) return makeResult(model, target, STATES.TASK_CHAMPION, 'MODEL_TASK_CHAMPION', facts);
  if (receipt.pass === true && clean(context.runnerUpModelId) === modelId) return makeResult(model, target, STATES.TASK_RUNNER_UP, 'MODEL_TASK_RUNNER_UP', facts);
  if (receipt.pass === true) return makeResult(model, target, STATES.ROLE_QUALIFIED, 'MODEL_ROLE_QUALIFIED', facts);
  if (benchmarkPass) return makeResult(model, target, STATES.TASK_BENCHMARK_PASSED, receipt.reason || 'ROLE_RECEIPT_MISSING', facts);
  if (connectivity && challengerEligible(model, target)) return makeResult(model, target, STATES.TASK_CHALLENGER, 'MODEL_TASK_CHALLENGER', facts);
  if (connectivity) return makeResult(model, target, STATES.CONNECTIVITY_VERIFIED, 'MODEL_CONNECTIVITY_VERIFIED', facts);
  return makeResult(model, target, STATES.CATALOG_ONLY, 'MODEL_CATALOG_ONLY', facts);
}

function projectModelLifecycles(models = [], tasks = [], context = {}) {
  const targetTasks = Array.isArray(tasks) ? tasks.map(normalizedTask).filter(Boolean) : [];
  return Object.fromEntries((Array.isArray(models) ? models : []).map(model => [clean(model.id), Object.fromEntries(targetTasks.map(task => [task, deriveModelTaskLifecycle(model, task, context?.[task] || context)]))]));
}

module.exports = {
  AUTHORITY,
  SCHEMA_VERSION,
  STATES,
  STAGES,
  normalizedTask,
  isMutableAlias,
  hasConnectivityEvidence,
  benchmarkFor,
  benchmarkPassed,
  deriveModelTaskLifecycle,
  projectModelLifecycles
};
