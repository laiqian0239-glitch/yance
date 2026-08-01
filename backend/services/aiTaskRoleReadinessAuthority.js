'use strict';

const routingIntegrity = require('./modelRoutingIntegrityService');
const replyBrainAuthority = require('./replyBrainModelAuthority');
const roleReceiptAuthority = require('./aiRoleQualificationReceiptAuthority');

const AUTHORITY = 'AITaskRoleReadinessAuthority';
const SCHEMA_VERSION = 1;
const CORE_AI_TASKS = Object.freeze([
  'translation',
  'understanding',
  'relationship',
  'director',
  'quick_reply',
  'deep_reply',
  'fact_extraction',
  'memory_extraction'
]);
const REDUNDANCY_REQUIRED_TASKS = Object.freeze([
  'translation',
  'director',
  'quick_reply',
  'deep_reply'
]);

function clean(value) { return String(value == null ? '' : value).trim(); }
function commercialTaskPass(model = {}, task = '') {
  const benchmark = model.lastCommercialBenchmark && typeof model.lastCommercialBenchmark === 'object'
    ? model.lastCommercialBenchmark
    : null;
  return Boolean(benchmark && roleReceiptAuthority.evidenceAllowsIssuance(clean(task), benchmark).pass === true);
}
function formalTaskEligible(model, task, route = {}) {
  if (!model) return false;
  const target = clean(task);
  if (!routingIntegrity.eligibleForTask(model, target, {
    allowExperimental: route.allowExperimental === true,
    allowConditional: false
  })) return false;
  if (roleReceiptAuthority.GOVERNED_TASKS.includes(target)) {
    if (!roleReceiptAuthority.validate(model, target, { now: route.now }).pass) return false;
  }
  if (target === 'translation') return commercialTaskPass(model, 'translation');
  if (['quick_reply', 'deep_reply', 'director'].includes(target)) {
    return replyBrainAuthority.taskQualification(model, target).full === true;
  }
  return true;
}

function evaluate(modelState = {}) {
  const models = Array.isArray(modelState.models) ? modelState.models : [];
  const byId = new Map(models.map(model => [clean(model?.id), model]));
  const persistedRoutes = modelState.routes && typeof modelState.routes === 'object' ? modelState.routes : {};
  const repaired = routingIntegrity.repairRegistryDocument({ models, routes: persistedRoutes }, { autoSelectVerified: false });
  const routes = repaired.repairedRoutes || {};
  const persistedIntegrity = modelState.routeIntegrity && typeof modelState.routeIntegrity === 'object'
    ? modelState.routeIntegrity
    : null;
  const routeIntegrity = persistedIntegrity || {
    authority: 'ModelRoutingIntegrityService',
    pass: repaired.quarantine.length === 0,
    invalidPersistedRouteCount: repaired.quarantine.length,
    quarantine: repaired.quarantine.map(row => ({ ...row }))
  };
  const tasks = CORE_AI_TASKS.map(task => {
    const route = routes[task] || {};
    const primaryId = clean(route.primary);
    const fallbackId = clean(route.fallback);
    const primary = byId.get(primaryId) || null;
    const fallback = byId.get(fallbackId) || null;
    const requestedEnabled = route.requestedEnabled !== undefined ? route.requestedEnabled !== false : route.enabled !== false;
    const primaryRuntimeEligible = Boolean(primary && routingIntegrity.eligibleForTask(primary, task, {
      allowExperimental: route.allowExperimental === true,
      allowConditional: route.allowConditional === true
    }));
    const fallbackRuntimeEligible = Boolean(fallback && routingIntegrity.eligibleForTask(fallback, task, {
      allowExperimental: route.allowExperimental === true,
      allowConditional: route.allowConditional === true
    }));
    const primaryQualified = formalTaskEligible(primary, task, route);
    const fallbackQualified = formalTaskEligible(fallback, task, route);
    const redundancyRequired = REDUNDANCY_REQUIRED_TASKS.includes(task);
    const fallbackDistinct = Boolean(fallbackId && fallbackId !== primaryId);
    const operational = requestedEnabled && Boolean(primaryId) && primaryQualified;
    const resilient = operational && (!redundancyRequired || (fallbackDistinct && fallbackQualified));
    let reason = '';
    if (!requestedEnabled) reason = '任务已由用户停用';
    else if (!primaryId) reason = '未配置主模型';
    else if (!primary) reason = '主模型不存在';
    else if (!primaryRuntimeEligible) reason = '主模型未通过运行资格';
    else if (!primaryQualified) reason = task === 'translation' ? '主模型未通过专用翻译实测' : '主模型未通过正式任务资格';
    else if (redundancyRequired && !fallbackId) reason = '缺少独立备用模型';
    else if (redundancyRequired && !fallbackDistinct) reason = '主模型与备用模型必须独立';
    else if (redundancyRequired && !fallback) reason = '备用模型不存在';
    else if (redundancyRequired && !fallbackRuntimeEligible) reason = '备用模型未通过运行资格';
    else if (redundancyRequired && !fallbackQualified) reason = task === 'translation' ? '备用模型未通过专用翻译实测' : '备用模型未通过正式任务资格';
    return {
      task,
      requestedEnabled,
      enabled: requestedEnabled,
      configured: Boolean(primaryId),
      redundancyRequired,
      operational,
      resilient,
      ready: resilient,
      primaryId,
      fallbackId,
      primaryName: clean(primary?.name),
      fallbackName: clean(fallback?.name),
      primaryRuntimeEligible,
      fallbackRuntimeEligible,
      primaryQualified,
      fallbackQualified,
      fallbackDistinct,
      reason
    };
  });
  const missing = tasks.filter(row => !row.ready);
  const routeIntegrityPass = routeIntegrity.pass !== false && Number(routeIntegrity.invalidPersistedRouteCount || 0) === 0;
  const pass = models.length > 0 && missing.length === 0 && routeIntegrityPass;
  return {
    authority: AUTHORITY,
    schemaVersion: SCHEMA_VERSION,
    coreTasks: [...CORE_AI_TASKS],
    redundancyRequiredTasks: [...REDUNDANCY_REQUIRED_TASKS],
    tasks,
    configured: tasks.filter(row => row.configured).length,
    operational: tasks.filter(row => row.operational).length,
    resilient: tasks.filter(row => row.resilient).length,
    missing,
    routeIntegrity,
    pass,
    summary: models.length === 0
      ? '尚未配置可用AI模型，核心任务不可运行'
      : !routeIntegrityPass
        ? `模型注册表仍有 ${Number(routeIntegrity.invalidPersistedRouteCount || routeIntegrity.quarantine?.length || 0)} 条不合格持久路由，已阻止任务就绪`
        : missing.length
          ? `核心AI任务 ${tasks.length - missing.length}/${tasks.length} 完整就绪；待处理：${missing.map(row => `${row.task}:${row.reason}`).join(' · ')}`
          : `核心AI任务 ${tasks.length}/${tasks.length} 已具备正式主路由${REDUNDANCY_REQUIRED_TASKS.length ? '与关键任务独立备用路由' : ''}`
  };
}

module.exports = {
  AUTHORITY,
  SCHEMA_VERSION,
  CORE_AI_TASKS,
  REDUNDANCY_REQUIRED_TASKS,
  commercialTaskPass,
  formalTaskEligible,
  evaluate,
  roleReceiptAuthority
};
