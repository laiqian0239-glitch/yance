'use strict';

const lifecycleAuthority = require('./aiBrainRoleLifecycleAuthority');
const replyChampionAuthority = require('./replyChampionAuthority');
const modelCapabilityAuthority = require('./modelCapabilityAuthority');

const AUTHORITY = 'ModelPoolSegmentationAuthority';
const SCHEMA_VERSION = 1;
const REPLY_TASKS = Object.freeze(['quick_reply', 'deep_reply', 'director']);
const CHALLENGER_STATES = new Set([
  lifecycleAuthority.STATES.TASK_CHALLENGER,
  lifecycleAuthority.STATES.TASK_BENCHMARK_PASSED
]);
const QUALIFIED_STATES = new Set([
  lifecycleAuthority.STATES.ROLE_QUALIFIED,
  lifecycleAuthority.STATES.TASK_RUNNER_UP,
  lifecycleAuthority.STATES.SHADOW_VALIDATED
]);
const CHAMPION_STATES = new Set([
  lifecycleAuthority.STATES.TASK_CHAMPION,
  lifecycleAuthority.STATES.ACTIVE
]);

function clean(value) { return String(value == null ? '' : value).trim(); }
function lower(value) { return clean(value).toLowerCase(); }
function array(value) { return Array.isArray(value) ? value : []; }
function modelIdFromRoute(route = {}, role = 'primary') {
  return clean(route?.resolved?.[role]?.modelId || route?.[role]);
}
function publicModel(model = {}, extra = {}) {
  return Object.freeze({
    modelId: clean(model.id),
    name: clean(model.displayName || model.name || model.id),
    provider: clean(model.provider),
    modelSlug: clean(model.modelSlug || model.catalogMetadata?.slug || model.catalogMetadata?.canonicalSlug || model.name),
    ...extra
  });
}
function isMultimodal(model = {}) {
  const capabilities = new Set(array(model.capabilities).map(lower));
  const inputs = new Set(array(model.catalogMetadata?.inputModalities).map(lower));
  const outputs = new Set(array(model.catalogMetadata?.outputModalities).map(lower));
  return capabilities.has('vision')
    || capabilities.has('image')
    || capabilities.has('audio-input')
    || capabilities.has('video-input')
    || inputs.has('image')
    || inputs.has('audio')
    || inputs.has('video')
    || outputs.has('image')
    || outputs.has('audio')
    || outputs.has('video');
}
function isFree(model = {}) {
  const metadata = model.catalogMetadata && typeof model.catalogMetadata === 'object' ? model.catalogMetadata : {};
  return model.free === true || metadata.free === true || /:free$/iu.test(clean(model.modelSlug || model.name));
}
function isBackground(model = {}) {
  const provider = lower(model.provider);
  const replyTasks = new Set(REPLY_TASKS);
  const allowed = array(model.allowedTasks).map(clean);
  const hints = array(model.taskHints).map(clean);
  const utilityOnly = [...allowed, ...hints].some(task => task && !replyTasks.has(task))
    && ![...allowed, ...hints].some(task => replyTasks.has(task));
  return provider === 'ollama' || provider === 'local' || isFree(model) || utilityOnly;
}
function routeContexts(models = [], routes = {}, options = {}) {
  return Object.fromEntries(REPLY_TASKS.map(task => {
    const decision = replyChampionAuthority.decide(models, task, { now: options.now });
    const routePrimary = modelIdFromRoute(routes?.[task] || {}, 'primary');
    const championId = clean(decision.champion?.modelId);
    return [task, {
      now: options.now,
      championModelId: championId,
      runnerUpModelId: clean(decision.fallback?.modelId),
      activeModelIds: routePrimary && routePrimary === championId ? [routePrimary] : [],
      shadowValidatedModelIds: array(options.shadowValidatedByTask?.[task])
    }];
  }));
}
function compareRows(left, right) {
  if (Number(right.stage || 0) !== Number(left.stage || 0)) return Number(right.stage || 0) - Number(left.stage || 0);
  if (Number(right.score || 0) !== Number(left.score || 0)) return Number(right.score || 0) - Number(left.score || 0);
  return left.modelId.localeCompare(right.modelId);
}
function uniqueRows(rows = []) {
  const byId = new Map();
  for (const row of rows) {
    if (!row?.modelId) continue;
    const previous = byId.get(row.modelId);
    if (!previous || Number(row.stage || 0) > Number(previous.stage || 0)) byId.set(row.modelId, row);
  }
  return [...byId.values()].sort(compareRows);
}
function platformUat(options = {}) {
  const accounts = array(options.platformAccounts);
  const connected = accounts.filter(account => ['connected', 'ready'].includes(lower(account?.status || account?.state)));
  const platforms = new Set(connected.map(account => lower(account?.platform)).filter(Boolean));
  return Object.freeze({
    connectedAccountCount: connected.length,
    connectedPlatforms: [...platforms].sort(),
    releaseGatePassed: options.platformUatPassed === true
  });
}

function segment(models = [], routes = {}, options = {}) {
  const source = array(models);
  const maxChallengers = Math.max(1, Number(options.maxChallengersPerTask || 5));
  const contexts = routeContexts(source, routes, options);
  const taskPools = Object.fromEntries(REPLY_TASKS.map(task => [task, { champions: [], qualified: [], challengers: [] }]));
  const lifecycles = {};
  const batchOnly = [];
  const multimodal = [];
  const background = [];
  const unassigned = [];

  for (const model of source) {
    const modelId = clean(model.id);
    const capability = modelCapabilityAuthority.classify(model);
    if (capability.batchOnly || model.batchOnly === true) {
      batchOnly.push(publicModel(model, { pool: 'batchOnly', reasonCode: 'BATCH_ONLY_INTERACTIVE_FORBIDDEN' }));
      continue;
    }
    const byTask = {};
    for (const task of REPLY_TASKS) {
      const result = lifecycleAuthority.deriveModelTaskLifecycle(model, task, contexts[task]);
      byTask[task] = result;
      const row = publicModel(model, {
        task,
        state: result.state,
        stage: result.stage,
        reasonCode: result.reasonCode,
        formal: result.formal,
        routable: result.routable,
        score: Number(result.evidence?.benchmark?.score || 0)
      });
      if (CHAMPION_STATES.has(result.state)) taskPools[task].champions.push(row);
      else if (QUALIFIED_STATES.has(result.state)) taskPools[task].qualified.push(row);
      else if (CHALLENGER_STATES.has(result.state)) taskPools[task].challengers.push(row);
    }
    lifecycles[modelId] = byTask;
    if (isMultimodal(model)) multimodal.push(publicModel(model, { pool: 'multimodal' }));
    if (isBackground(model)) background.push(publicModel(model, { pool: 'background' }));
    unassigned.push(publicModel(model, { pool: 'inventory' }));
  }

  for (const task of REPLY_TASKS) {
    taskPools[task].champions = uniqueRows(taskPools[task].champions);
    taskPools[task].qualified = uniqueRows(taskPools[task].qualified);
    taskPools[task].challengers = uniqueRows(taskPools[task].challengers).slice(0, maxChallengers);
  }

  const champions = uniqueRows(REPLY_TASKS.flatMap(task => taskPools[task].champions));
  const qualified = uniqueRows(REPLY_TASKS.flatMap(task => taskPools[task].qualified));
  const challengers = uniqueRows(REPLY_TASKS.flatMap(task => taskPools[task].challengers));
  const replyCandidateIds = new Set([...champions, ...qualified, ...challengers].map(row => row.modelId));
  const multimodalIds = new Set(multimodal.map(row => row.modelId));
  const backgroundIds = new Set(background.map(row => row.modelId));
  const inventory = uniqueRows(unassigned.filter(row => !replyCandidateIds.has(row.modelId) && !multimodalIds.has(row.modelId) && !backgroundIds.has(row.modelId)));
  const connectedPlatformUat = platformUat(options);

  return Object.freeze({
    authority: AUTHORITY,
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    tasks: taskPools,
    inventory,
    background: uniqueRows(background.filter(row => !replyCandidateIds.has(row.modelId))),
    multimodal: uniqueRows(multimodal.filter(row => !replyCandidateIds.has(row.modelId))),
    challengers,
    qualified,
    champions,
    batchOnly: uniqueRows(batchOnly),
    lifecycles,
    qualificationGates: Object.freeze({
      modelBenchmarkRequiresPlatformLogin: false,
      platformUatRequiredForRelease: true,
      mutableAliasesFormallyQualifiable: false,
      benchmarkAuthority: 'task-role-lifecycle',
      platformUatAuthority: 'end-to-end-release-gate'
    }),
    platformUat: connectedPlatformUat,
    summary: Object.freeze({
      registeredModelCount: source.length,
      replyCandidateModelCount: replyCandidateIds.size,
      championModelCount: champions.length,
      qualifiedModelCount: qualified.length,
      challengerModelCount: challengers.length,
      inventoryModelCount: inventory.length,
      backgroundModelCount: background.length,
      multimodalModelCount: multimodal.length,
      batchOnlyModelCount: batchOnly.length
    })
  });
}

module.exports = {
  AUTHORITY,
  SCHEMA_VERSION,
  REPLY_TASKS,
  isMultimodal,
  isBackground,
  segment
};
