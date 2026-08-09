(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.YanceModelRuntimeSnapshotAuthority = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
  function requiredFunction(value, name) {
    if (typeof value !== 'function') throw Object.assign(new TypeError(`模型运行快照缺少 ${name}`), { code: 'MODEL_RUNTIME_SNAPSHOT_ADAPTER_MISSING', adapter: name });
    return value;
  }
  function currentModelBrain(source = {}, previous = {}, fallback = {}) {
    const runtime = object(source.modelBrain || source.runtime?.modelBrain);
    const old = object(previous.modelBrain);
    const base = object(fallback.modelBrain);
    const evidence = runtime.lastEvidence || source.executionEvidence || old.lastEvidence || base.lastEvidence || null;
    return Object.freeze({
      name: 'Model Brain',
      litellm: String(runtime.litellm || runtime.authority || old.litellm || base.litellm || 'LiteLLM v1.95.0'),
      health: String(runtime.health || old.health || base.health || 'unavailable'),
      runtimeAvailable: runtime.runtimeAvailable === true,
      complexityRouter: String(runtime.complexityRouter || old.complexityRouter || base.complexityRouter || 'ComplexityRouter'),
      strictTagFiltering: runtime.strictTagFiltering !== false,
      tagFilteringMatchAny: runtime.tagFilteringMatchAny === true,
      lastEvidence: evidence
    });
  }

  function projectModelRuntimeSnapshot({ modelState = {}, previousState = {}, defaults = {}, adapters = {} } = {}) {
    const source = object(modelState), previous = object(previousState), fallback = object(defaults);
    const projectServices = requiredFunction(adapters.projectServices, 'projectServices');
    const summarizeServices = requiredFunction(adapters.summarizeServices, 'summarizeServices');
    const mergeAuthoritativeSummary = requiredFunction(adapters.mergeAuthoritativeSummary, 'mergeAuthoritativeSummary');
    const services = projectServices(Array.isArray(source.models) ? source.models : []);
    const automation = source.runtime?.aiAutomation;
    return Object.freeze({
      services,
      modelSummary: mergeAuthoritativeSummary(summarizeServices(services), source.summary || {}),
      modelBrain: currentModelBrain(source, previous, fallback),
      taskReadiness: source.taskReadiness || previous.taskReadiness || fallback.taskReadiness || {},
      replyBrain: source.replyBrain || previous.replyBrain || fallback.replyBrain || {},
      openRouter: source.openRouter || previous.openRouter || fallback.openRouter || {},
      aiAutomation: automation ? { ...object(automation), ...object(automation.config) } : previous.aiAutomation || fallback.aiAutomation || {}
    });
  }

  function commitModelRuntimeSnapshot(targetState, snapshot) {
    if (!targetState || typeof targetState !== 'object' || Array.isArray(targetState)) throw Object.assign(new TypeError('模型运行状态目标无效'), { code: 'MODEL_RUNTIME_STATE_TARGET_INVALID' });
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw Object.assign(new TypeError('模型运行快照无效'), { code: 'MODEL_RUNTIME_SNAPSHOT_INVALID' });
    Object.assign(targetState, {
      services: snapshot.services,
      modelSummary: snapshot.modelSummary,
      modelBrain: snapshot.modelBrain,
      replyBrain: snapshot.replyBrain,
      taskReadiness: snapshot.taskReadiness,
      openRouter: snapshot.openRouter,
      aiAutomation: snapshot.aiAutomation
    });
    return snapshot;
  }

  return Object.freeze({ projectModelRuntimeSnapshot, commitModelRuntimeSnapshot });
});
