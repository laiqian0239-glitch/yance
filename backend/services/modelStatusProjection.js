'use strict';

const { TASKS } = require('../../shared/constants');
const routingIntegrity = require('./modelRoutingIntegrityService');
const authority = require('./modelRuntimeAuthority');
const replyBrainAuthority = require('./replyBrainModelAuthority');
const aiTaskRoleReadinessAuthority = require('./aiTaskRoleReadinessAuthority');
const modelPoolSegmentationAuthority = require('./modelPoolSegmentationAuthority');

function buildAssignments(routes = {}) {
  const byModel = new Map();
  const add = (modelId, row) => {
    if (!modelId) return;
    const rows = byModel.get(modelId) || [];
    rows.push(row);
    byModel.set(modelId, rows);
  };
  for (const [task, route] of Object.entries(routes)) {
    if (route?.enabled === false) continue;
    add(route?.primary, {
      task,
      role: 'primary',
      fallbackModelId: route?.fallback || '',
      allowExperimental: route?.allowExperimental === true,
      allowConditional: route?.allowConditional === true,
      humanReviewRequired: route?.humanReviewRequired === true || route?.allowConditional === true
    });
    add(route?.fallback, {
      task,
      role: 'fallback',
      primaryModelId: route?.primary || '',
      allowExperimental: route?.allowExperimental === true,
      allowConditional: route?.allowConditional === true,
      humanReviewRequired: route?.humanReviewRequired === true || route?.allowConditional === true
    });
  }
  return byModel;
}

function normalizeModel(model = {}, state = {}, options = {}) {
  const assignments = Array.isArray(options.routeAssignments)
    ? options.routeAssignments
    : (Array.isArray(options.routedTasks) ? options.routedTasks.map(task => ({ task, role: 'primary', fallbackModelId: '', allowExperimental: true })) : []);
  return replyBrainAuthority.projectModel(authority.projectModel(model, state, { ...options, routeAssignments: assignments }));
}

function project(state = {}, options = {}) {
  const persistedRoutes = state.routes && typeof state.routes === 'object' ? state.routes : {};
  const repaired = routingIntegrity.repairRegistryDocument({
    models: state.models || [],
    routes: persistedRoutes
  }, { autoSelectVerified: false });
  const routes = repaired.repairedRoutes;
  const assignments = buildAssignments(routes);
  const models = (state.models || []).map(model => replyBrainAuthority.projectModel(authority.projectModel(model, state, {
    ...options,
    routeAssignments: assignments.get(model.id) || []
  })));
  const replyBrain = replyBrainAuthority.evaluate(models, routes);
  const taskReadiness = aiTaskRoleReadinessAuthority.evaluate({
    models,
    routes: persistedRoutes,
    routeIntegrity: {
      authority: 'ModelRoutingIntegrityService',
      pass: repaired.quarantine.length === 0,
      invalidPersistedRouteCount: repaired.quarantine.length,
      quarantine: repaired.quarantine.map(row => ({ ...row }))
    }
  });
  const modelPools = modelPoolSegmentationAuthority.segment(models, routes, {
    now: options.now,
    platformAccounts: options.platformAccounts || state.platformAccounts || [],
    platformUatPassed: options.platformUatPassed === true || state.platformUatPassed === true,
    shadowValidatedByTask: options.shadowValidatedByTask || state.shadowValidatedByTask || {}
  });
  const modelsWithLifecycle = models.map(model => ({
    ...model,
    taskLifecycles: modelPools.lifecycles[model.id] || {}
  }));
  const rawOpenRouter = state.openRouter && typeof state.openRouter === 'object' ? state.openRouter : {};
  const { credentialRef: _credentialRef, ...openRouterSnapshot } = rawOpenRouter;
  const trackedCloudCostUsd = modelsWithLifecycle.reduce((sum, model) => sum + Number(model.totalCostUsd || 0), 0);
  return {
    schemaVersion: 5,
    source: 'sqlite:model-registry',
    authority: 'ModelRuntimeAuthority',
    generatedAt: new Date().toISOString(),
    ollamaOnline: state.ollamaOnline === true,
    endpoint: state.endpoint || '',
    version: state.version || '',
    scannedAt: state.scannedAt || '',
    scanError: state.scanError || '',
    routes,
    routeIntegrity: {
      authority: 'ModelRoutingIntegrityService',
      pass: repaired.quarantine.length === 0,
      persistedRouteCount: routingIntegrity.configuredRouteCount(persistedRoutes),
      operationalRouteCount: routingIntegrity.configuredRouteCount(routes),
      invalidPersistedRouteCount: repaired.quarantine.length,
      quarantine: repaired.quarantine.map(row => ({ ...row }))
    },
    routesUpdatedAt: state.routesUpdatedAt || state.routesRepairedAt || '',
    history: Array.isArray(state.history) ? state.history.slice(0, 500) : [],
    models: modelsWithLifecycle,
    modelPools,
    openRouter: {
      ...openRouterSnapshot,
      credentialConfigured: Boolean(rawOpenRouter.credentialRef)
    },
    replyBrain,
    taskReadiness,
    summary: {
      ...authority.summarize(models, TASKS.length),
      routesPersisted: routingIntegrity.configuredRouteCount(persistedRoutes),
      routesOperational: routingIntegrity.configuredRouteCount(routes),
      invalidPersistedRoutes: repaired.quarantine.length,
      replyBrainReady: replyBrain.pass,
      replyBrainCandidates: replyBrain.coreCandidateCount,
      replyCandidateInventoryCount: modelPools.summary.replyCandidateModelCount,
      coreTasksConfigured: taskReadiness.configured,
      coreTasksOperational: taskReadiness.operational,
      coreTasksResilient: taskReadiness.resilient,
      coreTasksReady: taskReadiness.pass,
      coreTasksMissing: taskReadiness.missing.map(row => ({ task: row.task, reason: row.reason })),
      trackedCloudCostUsd: Number(trackedCloudCostUsd.toFixed(12)),
      openRouterConnected: Boolean(rawOpenRouter.credentialRef)
    }
  };
}

module.exports = {
  STATES: authority.STATES,
  normalizeQualification: authority.normalizeQualification,
  qualificationLabel: authority.qualificationLabel,
  normalizeModel,
  project
};
