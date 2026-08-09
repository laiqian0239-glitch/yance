'use strict';

const REPLY_TASKS = Object.freeze(['quick_reply', 'deep_reply', 'director']);
const CORE_REPLY_TASKS = Object.freeze(['quick_reply', 'deep_reply']);
const TASK_QUALIFICATION = Object.freeze({ qualified: 'qualified', experimental: 'experimental', pending: 'pending', blocked: 'blocked', notApplicable: 'not-applicable' });
const CONDITIONAL_THRESHOLDS = Object.freeze({});
const ROLE_LABELS = Object.freeze({ quick_reply: '快速回复', deep_reply: '深度回复', director: '导演' });
const HARD_BLOCKING_ISSUES = new Set(['WRONG_LANGUAGE','CHINESE_LEAK','INVENTED_DATE','INVENTED_COMPANY','BOUNDARY_NOT_EXPLICIT','SYSTEM_PROMPT_LEAK','ANALYSIS_LEAK','EMPTY_REPLY']);
function clean(value) { return String(value == null ? '' : value).trim(); }
function nameOf(model = {}) { return clean(model.name || model.id).toLowerCase(); }
function allowedSet(model = {}) { return new Set(Array.isArray(model.allowedTasks) ? model.allowedTasks.map(clean) : []); }
function isTranslation(model = {}) { return /(?:translate|translation|translategemma)/iu.test(nameOf(model)); }
function isCoder(model = {}) { return /(?:coder|codeqwen|starcoder|deepseek-coder)/iu.test(nameOf(model)); }
function isEmbedding(model = {}) { return /(?:embed|bge-|nomic-embed|e5-)/iu.test(nameOf(model)); }
function isVision(model = {}) {
  const capabilities = new Set(Array.isArray(model.capabilities) ? model.capabilities.map(value => clean(value).toLowerCase()) : []);
  return capabilities.has('vision') || model.capabilities?.vision === true;
}
function parameterBillions(model = {}) {
  const explicit = clean(model.parameterSize || model.details?.parameterSize).match(/([0-9]+(?:\.[0-9]+)?)\s*[bB]/);
  if (explicit) return Number(explicit[1]);
  const named = nameOf(model).match(/(?:^|[:\-_])([0-9]+(?:\.[0-9]+)?)b(?:$|[:\-_])/i);
  return named ? Number(named[1]) : 0;
}
function benchmarkResult(model = {}) {
  if (model.lastReplyBrainBenchmark && typeof model.lastReplyBrainBenchmark === 'object') return model.lastReplyBrainBenchmark;
  return model.lastSuccessfulReplyBrainBenchmark && typeof model.lastSuccessfulReplyBrainBenchmark === 'object' ? model.lastSuccessfulReplyBrainBenchmark : null;
}
function benchmarkAttempt(model = {}) { return model.lastReplyBrainBenchmarkAttempt || benchmarkResult(model); }
function benchmarkAttemptIncomplete(model = {}) { const value = benchmarkAttempt(model); return value?.completed === false || clean(value?.status) === 'REPLY_BRAIN_INCOMPLETE'; }
function benchmarkPass(model = {}) { const value = benchmarkResult(model); return Boolean(value?.pass === true && clean(value?.status || 'REPLY_BRAIN_QUALIFIED') === 'REPLY_BRAIN_QUALIFIED'); }
function benchmarkScore(model = {}) { return Number(benchmarkResult(model)?.score || 0); }
function benchmarkScenario(model = {}, scenarioId = '') { return (benchmarkResult(model)?.scenarios || []).find(row => clean(row?.id) === clean(scenarioId)) || null; }
function benchmarkScenarioPass(model = {}, scenarioId = '') { return benchmarkScenario(model, scenarioId)?.pass === true; }
function benchmarkChatScenariosExecuted(model = {}) { return (benchmarkResult(model)?.scenarios || []).some(row => ['german_whatsapp','english_whatsapp','persona_boundary'].includes(clean(row?.id))); }
function hardBlockingIssueCodes(model = {}) {
  return [...new Set((benchmarkResult(model)?.scenarios || []).flatMap(row => row.issues || []).map(issue => clean(issue?.code)).filter(code => HARD_BLOCKING_ISSUES.has(code)))];
}
function taskBenchmarkScore(model = {}) { return benchmarkScore(model); }
function baseReplyEligible(model = {}) {
  return model.userDisabled !== true && !isTranslation(model) && !isCoder(model) && !isEmbedding(model) && ['verified','experimental'].includes(clean(model.qualification));
}
function replyBrainQualified(model = {}) { return baseReplyEligible(model) && clean(model.qualification) === 'verified' && benchmarkPass(model); }
function taskQualification(model = {}, task = '') {
  const target = clean(task);
  if (!REPLY_TASKS.includes(target)) return { state: TASK_QUALIFICATION.notApplicable, selectable: false, full: false, reason: 'not-reply-task' };
  if (!baseReplyEligible(model)) return { state: TASK_QUALIFICATION.blocked, selectable: false, full: false, reason: 'model-hard-qualification-failed' };
  const blockers = hardBlockingIssueCodes(model);
  if (blockers.length) return { state: TASK_QUALIFICATION.blocked, selectable: false, full: false, blockers, reason: 'benchmark-hard-blocker' };
  const allowed = allowedSet(model).has(target);
  const full = clean(model.qualification) === 'verified' && benchmarkPass(model) && allowed;
  if (full) return { state: TASK_QUALIFICATION.qualified, selectable: true, full: true, reason: 'verified-benchmark-evidence' };
  if (clean(model.qualification) === 'experimental' && allowed) return { state: TASK_QUALIFICATION.experimental, selectable: true, full: false, reason: 'experimental-hard-qualification' };
  return { state: benchmarkAttemptIncomplete(model) ? TASK_QUALIFICATION.pending : TASK_QUALIFICATION.blocked, selectable: false, full: false, reason: allowed ? 'benchmark-evidence-pending' : 'task-capability-not-qualified' };
}
function manualRouteEligible(model = {}, task = '') { return taskQualification(model, task).selectable === true; }
function translationBenchmarkPass(model = {}) { return model.lastCommercialBenchmark?.pass === true && allowedSet(model).has('translation'); }
function translationStatus(model = {}) { return { pass: translationBenchmarkPass(model), qualification: clean(model.qualification), evidence: model.lastCommercialBenchmark || null }; }
function projectModel(model = {}) {
  const qualifications = Object.fromEntries(REPLY_TASKS.map(task => [task, taskQualification(model, task)]));
  return {
    ...model,
    replyBrainQualified: replyBrainQualified(model),
    replyTaskQualifications: qualifications,
    manualReplySelectableTasks: REPLY_TASKS.filter(task => qualifications[task].selectable),
    replyBrainBenchmark: benchmarkResult(model),
    replyBrainBenchmarkPass: benchmarkPass(model)
  };
}
function evaluate(models = []) {
  const rows = (Array.isArray(models) ? models : []).map(projectModel);
  const taskAvailability = Object.fromEntries(REPLY_TASKS.map(task => [task, rows.filter(model => model.replyTaskQualifications[task]?.full === true).length]));
  return {
    authority: 'Model Brain hard qualification evidence',
    models: rows,
    taskAvailability,
    pass: CORE_REPLY_TASKS.every(task => taskAvailability[task] > 0),
    coreCandidateCount: rows.filter(model => CORE_REPLY_TASKS.some(task => model.replyTaskQualifications[task]?.full === true)).length
  };
}
function audit(models = []) { return evaluate(models); }

module.exports = {
  REPLY_TASKS, CORE_REPLY_TASKS, TASK_QUALIFICATION, CONDITIONAL_THRESHOLDS, ROLE_LABELS,
  isTranslation, isCoder, isEmbedding, isVision, parameterBillions,
  benchmarkResult, benchmarkAttempt, benchmarkAttemptIncomplete, benchmarkPass, benchmarkScore,
  benchmarkScenario, benchmarkScenarioPass, benchmarkChatScenariosExecuted, hardBlockingIssueCodes,
  taskBenchmarkScore, taskQualification, manualRouteEligible, translationBenchmarkPass, translationStatus,
  baseReplyEligible, replyBrainQualified, projectModel, evaluate, audit
};
