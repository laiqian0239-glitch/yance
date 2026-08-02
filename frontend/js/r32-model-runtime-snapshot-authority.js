(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.YanceModelRuntimeSnapshotAuthority = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function object(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function requiredFunction(value, name) {
    if (typeof value !== 'function') {
      throw Object.assign(new TypeError(`模型运行快照缺少 ${name}`), {
        code: 'MODEL_RUNTIME_SNAPSHOT_ADAPTER_MISSING',
        adapter: name
      });
    }
    return value;
  }

  function shouldPreserveRoutes(state = {}) {
    return String(state?.tab || '') === 'routing' && state?.routeDraftDirty === true;
  }

  function projectModelRuntimeSnapshot({
    modelState = {},
    previousState = {},
    defaults = {},
    adapters = {},
    preserveRoutes = shouldPreserveRoutes(previousState)
  } = {}) {
    const source = object(modelState);
    const previous = object(previousState);
    const fallback = object(defaults);
    const projectServices = requiredFunction(adapters.projectServices, 'projectServices');
    const projectRoutes = requiredFunction(adapters.projectRoutes, 'projectRoutes');
    const summarizeServices = requiredFunction(adapters.summarizeServices, 'summarizeServices');
    const mergeAuthoritativeSummary = requiredFunction(adapters.mergeAuthoritativeSummary, 'mergeAuthoritativeSummary');

    const services = projectServices(Array.isArray(source.models) ? source.models : []);
    const taskReadiness = source.taskReadiness || previous.taskReadiness || fallback.taskReadiness || {};
    const routes = preserveRoutes
      ? (Array.isArray(previous.routes) ? previous.routes : [])
      : projectRoutes(source.routes || {}, taskReadiness);
    const automation = source.runtime?.aiAutomation;
    const aiAutomation = automation
      ? { ...object(automation), ...object(automation.config) }
      : previous.aiAutomation || fallback.aiAutomation || {};

    return Object.freeze({
      services,
      modelSummary: mergeAuthoritativeSummary(summarizeServices(services), source.summary || {}),
      replyBrain: source.replyBrain || previous.replyBrain || fallback.replyBrain || {},
      modelPools: source.modelPools || previous.modelPools || fallback.modelPools || {},
      taskReadiness,
      routes,
      openRouter: source.openRouter || previous.openRouter || fallback.openRouter || {},
      aiAutomation
    });
  }

  function commitModelRuntimeSnapshot(targetState, snapshot, options = {}) {
    if (!targetState || typeof targetState !== 'object' || Array.isArray(targetState)) {
      throw Object.assign(new TypeError('模型运行状态目标无效'), { code: 'MODEL_RUNTIME_STATE_TARGET_INVALID' });
    }
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      throw Object.assign(new TypeError('模型运行快照无效'), { code: 'MODEL_RUNTIME_SNAPSHOT_INVALID' });
    }

    const next = {
      services: snapshot.services,
      modelSummary: snapshot.modelSummary,
      replyBrain: snapshot.replyBrain,
      modelPools: snapshot.modelPools,
      taskReadiness: snapshot.taskReadiness,
      openRouter: snapshot.openRouter,
      aiAutomation: snapshot.aiAutomation
    };
    if (options.preserveRoutes !== true) next.routes = snapshot.routes;
    Object.assign(targetState, next);
    return snapshot;
  }

  return Object.freeze({
    shouldPreserveRoutes,
    projectModelRuntimeSnapshot,
    commitModelRuntimeSnapshot
  });
});
