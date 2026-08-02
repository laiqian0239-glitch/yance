'use strict';

const providerDomainAuthority = require('./modelProviderFailureDomainAuthority');
const taskRuntimePolicy = require('./modelTaskRuntimePolicy');

const REPLY_TASKS = Object.freeze(['quick_reply', 'deep_reply', 'director']);
const CORE_REPLY_TASKS = Object.freeze(['quick_reply', 'deep_reply']);
const TASK_QUALIFICATION = Object.freeze({
  qualified: 'qualified',
  conditional: 'conditional',
  pending: 'pending',
  blocked: 'blocked',
  notApplicable: 'not-applicable'
});
const CONDITIONAL_THRESHOLDS = Object.freeze({ quick_reply: 60, deep_reply: 68, director: 70 });
const HARD_BLOCKING_ISSUES = new Set([
  'WRONG_LANGUAGE', 'CHINESE_LEAK', 'INVENTED_DATE', 'INVENTED_COMPANY',
  'BOUNDARY_NOT_EXPLICIT', 'SYSTEM_PROMPT_LEAK', 'ANALYSIS_LEAK', 'EMPTY_REPLY'
]);

function clean(value) { return String(value == null ? '' : value).trim(); }
function nameOf(model = {}) { return clean(model.name || model.id).toLowerCase(); }
function allowedSet(model = {}) { return new Set(Array.isArray(model.allowedTasks) ? model.allowedTasks.map(clean) : []); }
function isTranslation(model = {}) { return /(?:translate|translation|translategemma)/iu.test(nameOf(model)); }
function isCoder(model = {}) { return /(?:coder|codeqwen|starcoder|deepseek-coder)/iu.test(nameOf(model)); }
function isEmbedding(model = {}) { return /(?:embed|bge-|nomic-embed|e5-)/iu.test(nameOf(model)); }
function isVision(model = {}) {
  const capabilities = new Set(Array.isArray(model.capabilities) ? model.capabilities.map(value => clean(value).toLowerCase()) : []);
  return capabilities.has('vision') || /(?:vision|llava|bakllava|minicpm-v|moondream)/iu.test(nameOf(model));
}
function parameterBillions(model = {}) {
  const explicit = clean(model.parameterSize || model.details?.parameterSize).match(/([0-9]+(?:\.[0-9]+)?)\s*[bB]/);
  if (explicit) return Number(explicit[1]);
  const named = nameOf(model).match(/(?:^|[:\-_])([0-9]+(?:\.[0-9]+)?)b(?:$|[:\-_])/i);
  if (named) return Number(named[1]);
  const bytes = Number(model.sizeBytes || model.size || 0);
  return Number.isFinite(bytes) && bytes > 0 ? bytes / 650000000 : 0;
}
function testPass(model = {}, name) {
  return model.lastQualificationTest?.scores?.[name]?.pass === true || model.lastTest?.scores?.[name]?.pass === true;
}
function taskPassed(model = {}, task) { return allowedSet(model).has(task); }
function benchmarkResult(model = {}) {
  if (model.lastReplyBrainBenchmark && typeof model.lastReplyBrainBenchmark === 'object') return model.lastReplyBrainBenchmark;
  return model.lastSuccessfulReplyBrainBenchmark && typeof model.lastSuccessfulReplyBrainBenchmark === 'object' ? model.lastSuccessfulReplyBrainBenchmark : null;
}
function benchmarkAttempt(model = {}) {
  return model.lastReplyBrainBenchmarkAttempt && typeof model.lastReplyBrainBenchmarkAttempt === 'object' ? model.lastReplyBrainBenchmarkAttempt : benchmarkResult(model);
}
function benchmarkAttemptIncomplete(model = {}) {
  const attempt = benchmarkAttempt(model);
  return attempt?.completed === false || attempt?.status === 'REPLY_BRAIN_INCOMPLETE';
}
function benchmarkPass(model = {}) {
  const result = benchmarkResult(model);
  return result?.authority === 'YanceReplyBrainBenchmark' && result.pass === true && result.status === 'REPLY_BRAIN_QUALIFIED';
}
function benchmarkScore(model = {}) {
  return Math.max(0, Math.min(100, Number(benchmarkResult(model)?.score || model.replyBrainBenchmarkScore || 0)));
}
function routeTasks(model = {}) {
  if (Array.isArray(model.routedTasks)) return model.routedTasks.map(clean).filter(Boolean);
  return Array.isArray(model.routeAssignments) ? model.routeAssignments.map(row => clean(row?.task)).filter(Boolean) : [];
}

function benchmarkScenario(model = {}, scenarioId = '') {
  const result = benchmarkResult(model);
  return Array.isArray(result?.scenarios) ? result.scenarios.find(row => clean(row?.id) === clean(scenarioId)) || null : null;
}
function benchmarkScenarioPass(model = {}, scenarioId = '') { return benchmarkScenario(model, scenarioId)?.pass === true; }
function benchmarkChatScenariosExecuted(model = {}) {
  const result = benchmarkResult(model);
  const scenarios = Array.isArray(result?.scenarios) ? result.scenarios : [];
  return scenarios.some(row => ['german_whatsapp', 'english_whatsapp', 'persona_boundary'].includes(clean(row?.id)));
}
function benchmarkIssues(model = {}) {
  const result = benchmarkResult(model);
  return (Array.isArray(result?.scenarios) ? result.scenarios : []).flatMap(row => Array.isArray(row?.issues) ? row.issues : []);
}
function hardBlockingIssueCodes(model = {}) {
  return [...new Set(benchmarkIssues(model).map(issue => clean(issue?.code)).filter(code => HARD_BLOCKING_ISSUES.has(code)))];
}
function hasRuntimeEvidence(model = {}) {
  return Boolean(model.runtimeAvailable === true || model.routeContinuityAvailable === true || model.lastSuccessfulInvocation || model.lastSuccessAt || Number(model.callCount || 0) > 0);
}
function taskBenchmarkScore(model = {}, task = '') {
  const result = benchmarkResult(model);
  const scenarios = Array.isArray(result?.scenarios) ? result.scenarios : [];
  const ids = task === 'director'
    ? ['director_schema', 'persona_boundary']
    : task === 'deep_reply'
      ? ['german_whatsapp', 'english_whatsapp', 'persona_boundary', 'german_alternative', 'latency']
      : ['german_whatsapp', 'english_whatsapp', 'persona_boundary', 'latency'];
  const selected = scenarios.filter(row => ids.includes(clean(row?.id)));
  const maximum = selected.reduce((sum, row) => sum + Number(row?.weight || 0), 0);
  const earned = selected.reduce((sum, row) => sum + Number(row?.score || 0), 0);
  if (maximum > 0) return Math.max(0, Math.min(100, Math.round(earned / maximum * 100)));
  return benchmarkScore(model);
}
function taskQualification(model = {}, task = '') {
  const target = clean(task);
  if (!REPLY_TASKS.includes(target)) return { state: TASK_QUALIFICATION.notApplicable, selectable: false, full: false, score: 0, reason: '不是回复大脑任务' };
  if (model.userDisabled === true || isTranslation(model) || isCoder(model) || isEmbedding(model)) return { state: TASK_QUALIFICATION.notApplicable, selectable: false, full: false, score: 0, reason: '专用或已停用模型不能参与客户回复' };
  const full = replyBrainQualified(model) && taskPassed(model, target);
  const score = taskBenchmarkScore(model, target);
  if (full) return { state: TASK_QUALIFICATION.qualified, selectable: true, full: true, score, reason: '回复大脑专项基准已通过' };
  const blockers = hardBlockingIssueCodes(model);
  if (blockers.length) return { state: TASK_QUALIFICATION.blocked, selectable: false, full: false, score, blockers, reason: `存在语言或事实安全阻断：${blockers.join('、')}` };
  if (target === 'director' && benchmarkScenarioPass(model, 'director_schema')) {
    return { state: TASK_QUALIFICATION.conditional, selectable: true, full: false, score, reason: '导演结构场景通过，可在人工确认模式试运行' };
  }
  if (target === 'director') return { state: benchmarkAttemptIncomplete(model) || !benchmarkResult(model) ? TASK_QUALIFICATION.pending : TASK_QUALIFICATION.blocked, selectable: false, full: false, score, reason: '导演结构化能力尚未通过' };
  const result = benchmarkResult(model);
  const threshold = Number(CONDITIONAL_THRESHOLDS[target] || 60);
  const chatScenariosExecuted = benchmarkChatScenariosExecuted(model);
  const oldPreconditionOnly = result && (clean(result.status) === 'REPLY_BRAIN_BASE_QUALIFICATION_FAILED' || (!chatScenariosExecuted && Number(result.score || 0) === 0));
  if (oldPreconditionOnly && hasRuntimeEvidence(model)) {
    return { state: TASK_QUALIFICATION.pending, selectable: true, full: false, score: 0, threshold, reason: '旧版前置资格阻止了聊天专项测试；模型已有真实成功调用，可直接人工试用并重新评估' };
  }
  if (result?.completed !== false && result && score >= threshold) {
    return { state: TASK_QUALIFICATION.conditional, selectable: true, full: false, score, threshold, reason: `达到${target === 'deep_reply' ? '深度' : '快速'}回复条件试运行门槛，必须人工确认` };
  }
  if ((!result || benchmarkAttemptIncomplete(model)) && hasRuntimeEvidence(model)) {
    return { state: TASK_QUALIFICATION.pending, selectable: true, full: false, score, threshold, reason: '专项评估尚未完成，但模型已有真实成功调用，可人工指定试运行' };
  }
  return { state: TASK_QUALIFICATION.blocked, selectable: false, full: false, score, threshold, reason: result ? `专项分数低于条件试运行门槛 ${threshold}` : '尚无真实运行证据' };
}
function manualRouteEligible(model = {}, task = '') { return taskQualification(model, task).selectable === true; }

function replyBrainScore(model = {}) {
  if (isTranslation(model) || isCoder(model) || isEmbedding(model) || model.userDisabled === true) return 0;
  const allowed = allowedSet(model);
  const billions = parameterBillions(model);
  let score = 0;
  if (model.qualification === 'verified') score += 18;
  else if (model.qualification === 'experimental') score += 8;
  if (allowed.has('quick_reply')) score += 8;
  if (allowed.has('deep_reply')) score += 10;
  if (allowed.has('director')) score += 6;
  if (benchmarkPass(model)) score += Math.round(benchmarkScore(model) * 0.55);
  else score -= 28;
  if (testPass(model, 'persona')) score += 12;
  if (testPass(model, 'hallucination')) score += 12;
  if (testPass(model, 'json')) score += 5;
  if (model.lastSuccessfulInvocation || model.lastSuccessAt || Number(model.callCount || 0) > 0) score += 7;
  if (model.currentFailure || model.lastInvocationStatus === 'failed') score -= 10;
  if (model.provider !== 'ollama') score += 8;
  if (billions >= 12 && billions <= 35) score += 18;
  else if (billions >= 8) score += 12;
  else if (billions > 0 && billions < 6) score -= 14;
  if (/ministral|mistral-small|gemma.*12b/iu.test(nameOf(model))) score += 8;
  return Math.max(0, Math.min(120, Math.round(score)));
}

function baseReplyEligible(model = {}) {
  const allowed = allowedSet(model);
  return model.userDisabled !== true
    && !isTranslation(model)
    && !isCoder(model)
    && !isEmbedding(model)
    && model.qualification === 'verified'
    && allowed.has('quick_reply')
    && allowed.has('deep_reply')
    && testPass(model, 'persona')
    && testPass(model, 'hallucination');
}

function replyBrainQualified(model = {}) {
  const allowed = allowedSet(model);
  return baseReplyEligible(model)
    && benchmarkPass(model)
    && allowed.has('quick_reply')
    && allowed.has('deep_reply')
    && testPass(model, 'persona')
    && testPass(model, 'hallucination');
}

function role(model = {}) {
  if (model.userDisabled === true) return 'disabled';
  if (isEmbedding(model)) return 'embedding';
  if (isCoder(model)) return 'coder';
  if (isTranslation(model)) return 'translation';
  if (replyBrainQualified(model)) return replyBrainScore(model) >= 92 ? 'core-reply' : 'reply-backup';
  if (manualRouteEligible(model, 'deep_reply') || manualRouteEligible(model, 'quick_reply')) return 'conditional-reply';
  if (baseReplyEligible(model)) return 'unqualified';
  if (isVision(model)) return 'vision';
  if (taskPassed(model, 'fact_extraction') || taskPassed(model, 'understanding') || taskPassed(model, 'summary')) return 'utility';
  return 'unqualified';
}

const ROLE_LABELS = Object.freeze({
  'core-reply': '核心回复大脑候选',
  'reply-backup': '回复备用候选',
  'conditional-reply': '条件试运行回复候选',
  translation: '专用翻译模型',
  vision: '图片与多模态模型',
  utility: '理解与摘要辅助模型',
  coder: '代码模型，不适合客户回复',
  embedding: '向量模型，不适合生成回复',
  disabled: '已停用',
  unqualified: '尚未证明适合言策'
});

function recommendation(model = {}) {
  const currentRole = role(model);
  const routed = routeTasks(model);
  const used = Number(model.callCount || 0) > 0 || Boolean(model.lastSuccessfulInvocation || model.lastSuccessAt);
  const attemptIncomplete = benchmarkAttemptIncomplete(model);
  if (attemptIncomplete && benchmarkPass(model)) return { code: 'BENCHMARK_INCOMPLETE_PRESERVED', label: '本次评估未完成，已保留上次合格结果与回复路由', action: 'benchmark', removable: false };
  if (attemptIncomplete) return { code: 'BENCHMARK_INCOMPLETE_RETRY', label: '本次评估因超时或技术原因未完成，可在模型预热后重试', action: 'benchmark', removable: false };
  if (currentRole === 'core-reply') return { code: 'KEEP_CORE_REPLY', label: '保留并优先作为核心回复模型', action: 'keep', removable: false };
  if (currentRole === 'reply-backup') return { code: 'KEEP_REPLY_BACKUP', label: '保留为回复备用模型', action: 'keep', removable: false };
  if (currentRole === 'conditional-reply') return { code: 'CONDITIONAL_REPLY_TRIAL', label: '可由用户手动指定为回复试运行模型；只生成候选并强制人工确认', action: 'route-trial', removable: false };
  if (currentRole === 'translation') return { code: 'KEEP_TRANSLATION_ONLY', label: '保留，但只允许翻译任务', action: 'keep', removable: false };
  if (currentRole === 'coder' || currentRole === 'embedding') return { code: 'DISABLE_NON_CHAT', label: routed.length ? '停止参与言策回复，迁移依赖后可删除' : (used ? '不适合客户回复；曾有历史调用，确认后可删除' : '不适合本项目，可停用并删除'), action: 'disable', removable: !routed.length };
  if (currentRole === 'disabled') return { code: 'DISABLED_REVIEW_REMOVAL', label: routed.length ? '已停用，但仍需清理任务路由' : (used ? '已停用；曾有历史调用，确认不再需要后可删除' : '已停用，可评估删除'), action: 'review-remove', removable: !routed.length };
  if (['failed', 'blocked'].includes(clean(model.qualification).toLowerCase())) return { code: 'DISABLE_FAILED', label: routed.length ? '资格失败，先停用并迁移路由' : (used ? '资格失败；曾有历史调用，确认后可删除' : '资格失败，可停用并评估删除'), action: 'disable', removable: !routed.length };
  if (baseReplyEligible(model) && !benchmarkResult(model)) return { code: 'BENCHMARK_REQUIRED', label: '必须先通过言策回复大脑基准，才能参与客户回复', action: 'benchmark', removable: false };
  if (baseReplyEligible(model) && !benchmarkPass(model)) return { code: 'DISABLE_BENCHMARK_FAILED', label: '回复大脑基准未通过，停用回复路由后评估保留或删除', action: 'disable', removable: routed.length === 0 };
  if (currentRole === 'vision') return { code: 'KEEP_VISION', label: '保留为图片与多模态模型；如需参与回复，必须另行通过回复大脑基准', action: 'keep', removable: false };
  if (currentRole === 'utility') return { code: 'KEEP_UTILITY', label: '保留为理解、摘要或事实提取辅助模型', action: 'keep', removable: false };
  return { code: 'BASE_QUALIFICATION_REQUIRED', label: '先完成基础资格与事实边界测试，再运行回复大脑基准', action: 'qualify', removable: false };
}

function projectModel(model = {}) {
  const currentRole = role(model);
  const suggestion = recommendation(model);
  return {
    ...model,
    replyBrainAuthority: 'ReplyBrainModelAuthority',
    replyBrainRole: currentRole,
    replyBrainRoleLabel: ROLE_LABELS[currentRole] || ROLE_LABELS.unqualified,
    replyBrainScore: replyBrainScore(model),
    replyBrainQualified: replyBrainQualified(model),
    replyBrainBenchmark: benchmarkResult(model),
    replyBrainBenchmarkAttempt: benchmarkAttempt(model),
    replyBrainBenchmarkAttemptIncomplete: benchmarkAttemptIncomplete(model),
    replyBrainBenchmarkPass: benchmarkPass(model),
    replyBrainBenchmarkScore: benchmarkScore(model),
    replyTaskQualifications: Object.fromEntries(REPLY_TASKS.map(task => [task, taskQualification(model, task)])),
    manualReplySelectableTasks: REPLY_TASKS.filter(task => manualRouteEligible(model, task)),
    conditionalReplyTasks: REPLY_TASKS.filter(task => taskQualification(model, task).state === TASK_QUALIFICATION.conditional || taskQualification(model, task).state === TASK_QUALIFICATION.pending),
    replyBrainRecommendation: suggestion,
    parameterBillions: parameterBillions(model),
    specialPurposeOnly: ['translation', 'vision', 'coder', 'embedding'].includes(currentRole)
  };
}

function taskCandidates(models = [], task = '', options = {}) {
  const projected = (Array.isArray(models) ? models : []).map(model => model.replyBrainAuthority ? model : projectModel(model));
  return projected
    .map(model => ({ model, qualification: taskQualification(model, task) }))
    .filter(row => options.fullOnly === true ? row.qualification.full === true : row.qualification.selectable)
    .sort((a, b) => {
      if (a.qualification.full !== b.qualification.full) return a.qualification.full ? -1 : 1;
      if (Number(b.qualification.score || 0) !== Number(a.qualification.score || 0)) return Number(b.qualification.score || 0) - Number(a.qualification.score || 0);
      return replyBrainScore(b.model) - replyBrainScore(a.model) || clean(a.model.name).localeCompare(clean(b.model.name));
    });
}

function recommendedReplyRoutes(models = [], existingRoutes = {}) {
  const now = new Date().toISOString();
  const routes = { ...(existingRoutes || {}) };
  const selections = {};
  for (const task of REPLY_TASKS) {
    const candidates = taskCandidates(models, task, { fullOnly: true });
    const trialCandidates = taskCandidates(models, task).filter(row => !row.qualification.full);
    const main = candidates[0] || null;
    const mainDomain = providerDomainAuthority.providerFailureDomain(main?.model || {});
    const backup = candidates.find(row => row.model.id !== main?.model.id
      && providerDomainAuthority.providerFailureDomain(row.model) !== mainDomain) || null;
    const hasPrevious = Boolean(existingRoutes && Object.prototype.hasOwnProperty.call(existingRoutes, task));
    const previous = routes[task] && typeof routes[task] === 'object' ? routes[task] : {};
    const requestedEnabled = hasPrevious
      ? (previous.requestedEnabled !== undefined ? previous.requestedEnabled !== false : previous.enabled !== false)
      : Boolean(main);
    routes[task] = {
      ...previous,
      primary: main?.model.id || '',
      fallback: backup?.model.id || '',
      requestedEnabled,
      enabled: requestedEnabled,
      operational: requestedEnabled && Boolean(main),
      allowExperimental: false,
      allowConditional: false,
      humanReviewRequired: previous.humanReviewRequired === true,
      primarySelection: 'auto',
      fallbackSelection: 'auto',
      autoSelectionReason: main ? `${main.model.name}：${main.qualification.reason}` : '没有可用于该任务的聊天模型',
      maxTokens: taskRuntimePolicy.normalizeMaxTokens(task, previous.maxTokens),
      source: 'reply-brain-benchmark-auto',
      updatedAt: now
    };
    selections[task] = {
      main: main ? { id: main.model.id, name: main.model.name, qualification: main.qualification } : null,
      backup: backup ? { id: backup.model.id, name: backup.model.name, qualification: backup.qualification } : null,
      candidates: candidates.map(row => ({ id: row.model.id, name: row.model.name, qualification: row.qualification })),
      manualTrialCandidates: trialCandidates.map(row => ({ id: row.model.id, name: row.model.name, qualification: row.qualification }))
    };
  }
  const quick = selections.quick_reply;
  const deep = selections.deep_reply;
  return {
    authority: 'ReplyBrainModelAuthority',
    generatedAt: now,
    pass: Boolean(quick?.main && quick?.backup && deep?.main && deep?.backup && selections.director?.main && selections.director?.backup),
    main: quick?.main || null,
    backup: quick?.backup || null,
    selections,
    candidates: taskCandidates(models, 'quick_reply', { fullOnly: true }).map(row => ({ id: row.model.id, name: row.model.name, score: row.model.replyBrainScore, benchmarkScore: row.model.replyBrainBenchmarkScore, qualification: row.qualification })),
    routes,
    userMessage: !quick?.main
      ? '没有通过正式回复专项评估的快速回复模型；条件模型只能由用户手动试运行。'
      : !selections.director?.main
        ? '快速与深度回复已有合格候选，但导演模型尚未通过正式专项评估。'
        : `已为快速回复推荐 ${quick.main.name}，为导演推荐 ${selections.director.main.name}，为深度回复推荐 ${deep?.main?.name || '待配置'}。`
  };
}

function modelById(models = []) { return new Map(models.map(model => [clean(model.id), model])); }
function routeStatus(routes = {}, models = [], task) {
  const route = routes?.[task] || {};
  const byId = modelById(models);
  const primary = byId.get(clean(route.primary));
  const fallback = byId.get(clean(route.fallback));
  const primaryQualification = primary ? taskQualification(primary, task) : { state: TASK_QUALIFICATION.blocked, selectable: false, full: false, score: 0, reason: '未配置' };
  const fallbackQualificationBase = fallback ? taskQualification(fallback, task) : { state: TASK_QUALIFICATION.blocked, selectable: false, full: false, score: 0, reason: '未配置' };
  const fallbackProviderIndependent = Boolean(primary && fallback && providerDomainAuthority.independent(primary, fallback));
  const fallbackQualification = fallback && !fallbackProviderIndependent
    ? { ...fallbackQualificationBase, full: false, reason: '备用模型必须位于独立供应商故障域' }
    : fallbackQualificationBase;
  const allowConditional = route.allowConditional === true;
  const primaryPass = Boolean(primary && primaryQualification.full && taskPassed(primary, task) && primary.userDisabled !== true);
  const fallbackPass = Boolean(fallback && fallbackProviderIndependent && fallbackQualification.full && taskPassed(fallback, task) && fallback.userDisabled !== true && fallback.id !== primary?.id);
  const primaryUsable = Boolean(primary && (primaryPass || (allowConditional && primaryQualification.selectable)) && primary.userDisabled !== true);
  const fallbackUsable = Boolean(fallback && fallbackProviderIndependent && fallback.id !== primary?.id && (fallbackPass || (allowConditional && fallbackQualification.selectable)) && fallback.userDisabled !== true);
  const requestedEnabled = route.requestedEnabled !== undefined ? route.requestedEnabled !== false : route.enabled !== false;
  return {
    task,
    requestedEnabled,
    enabled: requestedEnabled,
    operational: requestedEnabled && primaryUsable,
    primaryModelId: clean(route.primary),
    fallbackModelId: clean(route.fallback),
    primaryName: clean(primary?.name),
    fallbackName: clean(fallback?.name),
    primaryPass,
    fallbackPass,
    primaryUsable,
    fallbackUsable,
    fallbackProviderIndependent,
    primaryQualification,
    fallbackQualification,
    allowConditional,
    humanReviewRequired: route.humanReviewRequired === true || allowConditional,
    primarySelection: clean(route.primarySelection) || 'manual',
    fallbackSelection: clean(route.fallbackSelection) || 'manual',
    autoSelectionReason: clean(route.autoSelectionReason),
    pass: requestedEnabled && primaryPass && fallbackPass,
    usable: requestedEnabled && primaryUsable
  };
}

function translationBenchmarkPass(model = {}) {
  const commercial = model?.lastCommercialBenchmark && typeof model.lastCommercialBenchmark === 'object'
    ? model.lastCommercialBenchmark
    : null;
  const qualifyingTasks = Array.isArray(commercial?.qualifyingTasks) ? commercial.qualifyingTasks.map(clean) : [];
  return Boolean(commercial && commercial.completed !== false && qualifyingTasks.includes('translation'));
}

function translationStatus(routes = {}, models = []) {
  const route = routes?.translation || {};
  const byId = modelById(models);
  const primary = byId.get(clean(route.primary));
  const fallback = byId.get(clean(route.fallback));
  const primaryConnected = Boolean(primary && primary.userDisabled !== true && taskPassed(primary, 'translation'));
  const fallbackConnected = Boolean(fallback && fallback.userDisabled !== true && taskPassed(fallback, 'translation'));
  const primaryQualityPass = translationBenchmarkPass(primary);
  const fallbackQualityPass = translationBenchmarkPass(fallback);
  const fallbackDistinct = Boolean(fallback && primary && clean(fallback.id) !== clean(primary.id));
  const fallbackProviderIndependent = Boolean(fallbackDistinct && providerDomainAuthority.independent(primary, fallback));
  const pass = primaryConnected && primaryQualityPass && fallbackConnected && fallbackQualityPass && fallbackProviderIndependent;
  let reason = '';
  if (!primaryConnected) reason = '翻译主模型未连接或任务类型不匹配';
  else if (!primaryQualityPass) reason = '翻译主模型尚未通过中德商业翻译专项';
  else if (!fallbackConnected) reason = '缺少已连接的独立翻译备用模型';
  else if (!fallbackDistinct) reason = '翻译主模型与备用模型必须是不同模型';
  else if (!fallbackProviderIndependent) reason = '翻译备用模型必须位于独立供应商故障域';
  else if (!fallbackQualityPass) reason = '翻译备用模型尚未通过中德商业翻译专项';
  else reason = '翻译主备模型均已通过中德商业翻译专项且供应商故障域独立';
  return {
    task: 'translation',
    primaryModelId: clean(route.primary),
    fallbackModelId: clean(route.fallback),
    primaryName: clean(primary?.name),
    fallbackName: clean(fallback?.name),
    primaryConnected,
    fallbackConnected,
    connected: primaryConnected,
    primaryQualityPass,
    fallbackQualityPass,
    qualityPass: primaryQualityPass,
    fallbackDistinct,
    fallbackProviderIndependent,
    pass,
    reason
  };
}

function evaluate(models = [], routes = {}) {
  const projected = models.map(model => model.replyBrainAuthority ? model : projectModel(model));
  const quick = routeStatus(routes, projected, 'quick_reply');
  const deep = routeStatus(routes, projected, 'deep_reply');
  const director = routeStatus(routes, projected, 'director');
  const translation = translationStatus(routes, projected);
  const coreCandidates = projected.filter(model => model.replyBrainQualified).sort((a, b) => b.replyBrainScore - a.replyBrainScore);
  const pass = quick.pass && deep.pass && director.pass && translation.pass;
  const candidateGenerationReady = quick.primaryUsable && quick.fallbackUsable
    && deep.primaryUsable && deep.fallbackUsable
    && director.primaryUsable && director.fallbackUsable
    && translation.pass;
  const conditional = candidateGenerationReady && !pass;
  const missing = [];
  if (!quick.primaryUsable) missing.push('快速回复主模型');
  if (!quick.fallbackUsable) missing.push('快速回复备用模型');
  if (!deep.primaryUsable) missing.push('深度回复主模型');
  if (!deep.fallbackUsable) missing.push('深度回复备用模型');
  if (!director.primaryUsable) missing.push('导演主模型');
  if (!director.fallbackUsable) missing.push('导演备用模型');
  if (!translation.primaryConnected || !translation.primaryQualityPass) missing.push('专用翻译主模型');
  if (!translation.fallbackConnected || !translation.fallbackQualityPass || !translation.fallbackDistinct) missing.push('独立专用翻译备用模型');
  return {
    authority: 'ReplyBrainModelAuthority',
    pass,
    candidateGenerationReady,
    conditional,
    state: pass ? 'REPLY_BRAIN_READY' : conditional ? 'REPLY_BRAIN_CONDITIONAL' : 'REPLY_BRAIN_INCOMPLETE',
    coreCandidateCount: coreCandidates.length,
    coreCandidates: coreCandidates.map(model => ({ id: model.id, name: model.name, score: model.replyBrainScore, role: model.replyBrainRole })),
    quick,
    deep,
    director,
    translation,
    missing,
    userMessage: pass
      ? '核心回复、备用回复、导演和翻译模型均已完成真实资格与路由配置。'
      : conditional
        ? 'AI 回复候选已进入条件试运行：所有候选必须人工确认，尚未达到正式自动路由门槛。'
        : `AI 回复大脑尚未就绪：${missing.join('、') || '缺少可用模型或路由'}。`
  };
}

function audit(models = [], routes = {}) {
  const projected = models.map(projectModel);
  const readiness = evaluate(projected, routes);
  return {
    schemaVersion: 1,
    authority: 'ReplyBrainModelAuthority',
    generatedAt: new Date().toISOString(),
    readiness,
    models: projected.map(model => ({
      id: model.id,
      name: model.name,
      provider: model.provider,
      parameterBillions: model.parameterBillions,
      role: model.replyBrainRole,
      roleLabel: model.replyBrainRoleLabel,
      replyBrainScore: model.replyBrainScore,
      replyBrainQualified: model.replyBrainQualified,
      recommendation: model.replyBrainRecommendation,
      benchmark: model.replyBrainBenchmark || null,
      benchmarkPass: model.replyBrainBenchmarkPass === true,
      benchmarkScore: Number(model.replyBrainBenchmarkScore || 0),
      taskQualifications: model.replyTaskQualifications || Object.fromEntries(REPLY_TASKS.map(task => [task, taskQualification(model, task)])),
      manualSelectableTasks: model.manualReplySelectableTasks || REPLY_TASKS.filter(task => manualRouteEligible(model, task)),
      allowedTasks: model.allowedTasks || [],
      routedTasks: routeTasks(model),
      qualification: model.qualification,
      userDisabled: model.userDisabled === true
    }))
  };
}

module.exports = {
  REPLY_TASKS,
  CORE_REPLY_TASKS,
  TASK_QUALIFICATION,
  CONDITIONAL_THRESHOLDS,
  ROLE_LABELS,
  isTranslation,
  isCoder,
  isEmbedding,
  isVision,
  parameterBillions,
  benchmarkResult,
  benchmarkAttempt,
  benchmarkAttemptIncomplete,
  benchmarkPass,
  benchmarkScore,
  benchmarkScenario,
  benchmarkScenarioPass,
  benchmarkChatScenariosExecuted,
  hardBlockingIssueCodes,
  taskBenchmarkScore,
  taskQualification,
  manualRouteEligible,
  translationBenchmarkPass,
  translationStatus,
  baseReplyEligible,
  replyBrainScore,
  replyBrainQualified,
  projectModel,
  recommendedReplyRoutes,
  evaluate,
  audit
};
