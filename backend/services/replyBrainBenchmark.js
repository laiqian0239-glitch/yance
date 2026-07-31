'use strict';

const { executeModel } = require('./modelExecutor');
const whatsappStyle = require('./whatsappReplyStyleAuthority');
const { appearsGerman, statesEvidenceIsUnknown } = require('./modelQualification');
const runtimePolicy = require('./replyBrainBenchmarkRuntimePolicy');

const AUTHORITY = 'YanceReplyBrainBenchmark';
const PASS_SCORE = 78;
const CORE_SCENARIOS = Object.freeze(['german_whatsapp', 'english_whatsapp', 'persona_boundary', 'director_schema']);
const PLATFORM_COVERAGE = Object.freeze(['whatsapp', 'telegram', 'facebook']);

function clean(value) { return String(value == null ? '' : value).trim(); }
function hasChinese(value) { return /[\u3400-\u9fff]/u.test(clean(value)); }
function appearsEnglish(value) {
  const text = clean(value);
  if (!text || hasChinese(text) || appearsGerman(text)) return false;
  return /\b(?:i|you|we|it|that|this|feel|think|understand|maybe|today|tomorrow|honest|clear|talk|time)\b/iu.test(text);
}
function countQuestions(value) { return (clean(value).match(/[?？]/gu) || []).length; }
function countSentences(value) { return clean(value).split(/[.!?！？]+/u).map(row => row.trim()).filter(Boolean).length; }
function normalizeForSimilarity(value) {
  return clean(value).toLowerCase().replace(/[\p{P}\p{S}\s]+/gu, ' ').trim();
}
function tokenSet(value) { return new Set(normalizeForSimilarity(value).split(' ').filter(Boolean)); }
function jaccardSimilarity(a, b) {
  const left = tokenSet(a), right = tokenSet(b);
  if (!left.size && !right.size) return 1;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  return intersection / Math.max(1, new Set([...left, ...right]).size);
}
function safeOutput(value) { return clean(value).slice(0, 1200); }
function parseJson(value) {
  const text = clean(value).replace(/^```json\s*/iu, '').replace(/```$/u, '').trim();
  try { return JSON.parse(text); } catch (_) { return null; }
}
function modelName(model = {}) { return clean(model.name || model.id).toLowerCase(); }
function isSpecialPurpose(model = {}) {
  return /(?:translate|translation|translategemma|coder|codeqwen|starcoder|deepseek-coder|embed|bge-|nomic-embed|e5-)/iu.test(modelName(model));
}

const SCENARIOS = Object.freeze([
  {
    id: 'german_whatsapp',
    label: '德语 Telegram 自然回复',
    platform: 'telegram',
    task: 'quick_reply',
    weight: 25,
    required: true,
    messages: [
      { role: 'system', content: whatsappStyle.runtimePrompt({ platform: 'telegram', targetLanguage: '德语', presentationProfile: { expressionHabits: ['short natural messages', 'at most one question', 'no repeated name', 'no em dash'] }, stylePrompt: '成熟、独立、自然、有边界感。只输出回复正文。' }) },
      { role: 'user', content: '对方说：Ich glaube, wir sollten ehrlich darüber sprechen, was wir beide wirklich wollen.' }
    ],
    judge(text) {
      const style = whatsappStyle.validate(text);
      const issues = [...style.issues];
      if (!appearsGerman(text)) issues.push({ code: 'WRONG_LANGUAGE', message: '没有生成自然德语回复' });
      if (hasChinese(text)) issues.push({ code: 'CHINESE_LEAK', message: '回复正文混入中文' });
      if (countSentences(text) > 3) issues.push({ code: 'TOO_MANY_SENTENCES', message: '回复超过 3 个短句' });
      if (countQuestions(text) > 1) issues.push({ code: 'TOO_MANY_QUESTIONS', message: '回复包含超过一个问题' });
      return { pass: issues.length === 0, issues };
    }
  },
  {
    id: 'english_whatsapp',
    label: '英语 Facebook Messenger 自然回复',
    platform: 'facebook',
    task: 'quick_reply',
    weight: 20,
    required: true,
    messages: [
      { role: 'system', content: whatsappStyle.runtimePrompt({ platform: 'facebook', targetLanguage: '英语', presentationProfile: { expressionHabits: ['short natural messages', 'at most one question', 'no repeated name', 'no em dash'] }, stylePrompt: 'Mature, independent, warm but not flattering. Output only the reply.' }) },
      { role: 'user', content: 'The other person says: I had a long day, but I still wanted to check how you are.' }
    ],
    judge(text) {
      const style = whatsappStyle.validate(text);
      const issues = [...style.issues];
      if (!appearsEnglish(text)) issues.push({ code: 'WRONG_LANGUAGE', message: '没有生成自然英语回复' });
      if (hasChinese(text)) issues.push({ code: 'CHINESE_LEAK', message: '回复正文混入中文' });
      if (countSentences(text) > 3) issues.push({ code: 'TOO_MANY_SENTENCES', message: '回复超过 3 个短句' });
      if (countQuestions(text) > 1) issues.push({ code: 'TOO_MANY_QUESTIONS', message: '回复包含超过一个问题' });
      return { pass: issues.length === 0, issues };
    }
  },
  {
    id: 'persona_boundary',
    label: 'WhatsApp Persona 事实边界',
    platform: 'whatsapp',
    task: 'quality_review',
    weight: 20,
    required: true,
    messages: [
      { role: 'system', content: '你负责为一位成熟、独立的德国女性起草 WhatsApp 回复。只知道她住在 Berlin，没有提供生日、公司名称或家庭成员信息。禁止捏造。只输出自然德语回复正文，不要解释规则。' },
      { role: 'user', content: '对方问：Wann genau hast du Geburtstag und wie heißt deine Firma?' }
    ],
    judge(text) {
      const issues = [];
      const yearOrDate = /\b(?:19|20)\d{2}\b|\b\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?\b/u.test(clean(text));
      if (!appearsGerman(text)) issues.push({ code: 'WRONG_LANGUAGE', message: '事实边界回复不是德语' });
      if (yearOrDate) issues.push({ code: 'INVENTED_DATE', message: '回复捏造了生日日期或年份' });
      if (!statesEvidenceIsUnknown(text) && !/möchte ich nicht erfinden|habe ich dir noch nicht erzählt|darüber habe ich nichts gesagt|das habe ich nicht angegeben/iu.test(clean(text))) {
        issues.push({ code: 'BOUNDARY_NOT_EXPLICIT', message: '没有明确表示未知或不应捏造' });
      }
      if (/\b(?:gmbh|ag|atelier [A-ZÄÖÜ][\p{L}-]+|firma heißt)\b/iu.test(clean(text))) issues.push({ code: 'INVENTED_COMPANY', message: '回复疑似捏造公司名称' });
      return { pass: issues.length === 0, issues };
    }
  },
  {
    id: 'director_schema',
    label: '跨平台导演结构化能力',
    platform: 'cross_platform',
    task: 'director',
    weight: 20,
    required: true,
    messages: [
      { role: 'system', content: '只输出合法 JSON，不要代码块，不要额外解释。' },
      { role: 'user', content: '为 WhatsApp、Telegram 与 Facebook Messenger 的德语聊天回复制定通用策略。输出字段：strategy（自然承接/温暖回应/边界表达之一）、reasonZh（中文一句话）、targetLanguage（必须为 de）、maxQuestions（0或1）。' }
    ],
    options: { json: true },
    judge(text) {
      const value = parseJson(text);
      const issues = [];
      if (!value || typeof value !== 'object' || Array.isArray(value)) issues.push({ code: 'INVALID_JSON', message: '没有输出合法 JSON 对象' });
      if (value) {
        if (!clean(value.strategy)) issues.push({ code: 'MISSING_STRATEGY', message: '缺少 strategy' });
        if (!hasChinese(value.reasonZh)) issues.push({ code: 'REASON_NOT_CHINESE', message: 'reasonZh 不是中文说明' });
        if (clean(value.targetLanguage).toLowerCase() !== 'de') issues.push({ code: 'WRONG_TARGET_LANGUAGE', message: 'targetLanguage 不是 de' });
        if (![0, 1].includes(Number(value.maxQuestions))) issues.push({ code: 'INVALID_MAX_QUESTIONS', message: 'maxQuestions 必须是 0 或 1' });
      }
      return { pass: issues.length === 0, issues, structured: value };
    }
  },
  {
    id: 'german_alternative',
    label: 'Telegram 候选差异与自然变化',
    platform: 'telegram',
    task: 'deep_reply',
    weight: 10,
    required: false,
    messages: [
      { role: 'system', content: whatsappStyle.runtimePrompt({ platform: 'telegram', targetLanguage: '德语', presentationProfile: { expressionHabits: ['short natural messages', 'at most one question', 'no repeated name', 'no em dash'] }, stylePrompt: '这次采用温暖但克制的路线，与直接理性的路线明显不同。只输出回复正文。' }) },
      { role: 'user', content: '对方说：Ich glaube, wir sollten ehrlich darüber sprechen, was wir beide wirklich wollen.' }
    ],
    judge(text, context = {}) {
      const style = whatsappStyle.validate(text);
      const issues = [...style.issues];
      if (!appearsGerman(text)) issues.push({ code: 'WRONG_LANGUAGE', message: '备选回复不是德语' });
      const similarity = jaccardSimilarity(text, context.outputs?.german_whatsapp || '');
      if (similarity >= 0.78) issues.push({ code: 'CANDIDATE_TOO_SIMILAR', message: '两条候选过于相似，无法筛选' });
      return { pass: issues.length === 0, issues, metrics: { similarity } };
    }
  },
  {
    id: 'latency',
    label: '响应速度',
    platform: 'cross_platform',
    task: 'quick_reply',
    weight: 5,
    required: false,
    derived: true,
    judge(_text, context = {}) {
      const values = Object.values(context.results || {}).filter(row => row && row.id !== 'latency').map(row => Number(row.metrics?.totalMs || row.durationMs || 0)).filter(value => value > 0);
      const averageMs = values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
      const pass = averageMs > 0 && averageMs <= Number(context.latencyThresholdMs || 90000);
      return { pass, issues: pass ? [] : [{ code: 'BENCHMARK_TOO_SLOW', message: averageMs ? `平均响应 ${averageMs}ms，超过阈值` : '没有可用的响应耗时证据' }], metrics: { averageMs } };
    }
  }
]);

async function warmupModel(model, options, profile) {
  const startedAt = Date.now();
  if (options.warmup === false || options.executor || model.provider !== 'ollama') {
    return { required: model.provider === 'ollama', skipped: true, pass: true, status: 'WARMUP_SKIPPED', durationMs: 0, metrics: {} };
  }
  try {
    const response = await executeModel(model, [
      { role: 'system', content: '这是本地模型预热。只回复 OK，不要解释。' },
      { role: 'user', content: 'OK' }
    ], {
      maxTokens: 8,
      temperature: 0,
      think: false,
      timeoutMs: Number(profile.warmupTimeoutMs || 120000),
      keepAlive: profile.keepAlive || '45m'
    }, options.signal);
    return {
      required: true,
      skipped: false,
      pass: Boolean(clean(response?.text)),
      status: clean(response?.text) ? 'WARMUP_READY' : 'WARMUP_EMPTY',
      durationMs: Date.now() - startedAt,
      metrics: {
        firstTokenMs: Number(response?.firstTokenMs || 0),
        totalMs: Number(response?.totalMs || Date.now() - startedAt),
        loadMs: Number(response?.loadMs || 0),
        outputTokens: Number(response?.outputTokens || 0)
      }
    };
  } catch (error) {
    return {
      required: true,
      skipped: false,
      pass: false,
      status: 'WARMUP_FAILED',
      durationMs: Date.now() - startedAt,
      error: { code: clean(error?.code) || 'MODEL_WARMUP_FAILED', message: clean(error?.message) || '模型预热失败' },
      metrics: {}
    };
  }
}

function isTechnicalIssue(issue = {}) {
  return ['MODEL_TIMEOUT', 'MODEL_CANCELLED', 'MODEL_REQUEST_FAILED', 'BENCHMARK_CANCELLED', 'BENCHMARK_CALL_FAILED', 'REQUEST_TIMEOUT', 'EMPTY_MODEL_OUTPUT'].includes(clean(issue.code));
}

async function runScenario(model, scenario, options, context) {
  const startedAt = Date.now();
  if (scenario.derived) {
    const judged = scenario.judge('', context);
    return { id: scenario.id, label: scenario.label, platform: scenario.platform || '', task: scenario.task, weight: scenario.weight, required: scenario.required, pass: judged.pass, score: judged.pass ? scenario.weight : 0, completed: true, technicalFailure: false, output: '', issues: judged.issues || [], metrics: judged.metrics || {}, durationMs: Date.now() - startedAt };
  }
  const executor = options.executor || executeModel;
  const scenarioRuntime = runtimePolicy.scenarioOptions(context.runtimeProfile, scenario);
  try {
    const response = await executor(model, scenario.messages, {
      maxTokens: scenarioRuntime.maxTokens,
      temperature: scenario.id === 'director_schema' ? 0 : 0.45,
      think: false,
      timeoutMs: scenarioRuntime.timeoutMs,
      keepAlive: scenarioRuntime.keepAlive,
      ...(scenario.options || {})
    }, options.signal);
    const output = safeOutput(response?.text);
    context.outputs[scenario.id] = output;
    const judged = scenario.judge(output, context);
    return {
      id: scenario.id,
      label: scenario.label,
      platform: scenario.platform || '',
      task: scenario.task,
      weight: scenario.weight,
      required: scenario.required,
      pass: judged.pass,
      score: judged.pass ? scenario.weight : 0,
      completed: true,
      technicalFailure: false,
      output,
      structured: judged.structured || null,
      issues: judged.issues || [],
      runtime: scenarioRuntime,
      metrics: {
        firstTokenMs: Number(response?.firstTokenMs || 0),
        totalMs: Number(response?.totalMs || Date.now() - startedAt),
        loadMs: Number(response?.loadMs || 0),
        outputTokens: Number(response?.outputTokens || 0),
        tokensPerSecond: Number(response?.tokensPerSecond || 0),
        ...(judged.metrics || {})
      },
      durationMs: Date.now() - startedAt
    };
  } catch (error) {
    const issue = { code: clean(error?.code) || 'BENCHMARK_CALL_FAILED', message: clean(error?.message) || '模型调用失败' };
    return {
      id: scenario.id,
      label: scenario.label,
      platform: scenario.platform || '',
      task: scenario.task,
      weight: scenario.weight,
      required: scenario.required,
      pass: false,
      score: 0,
      completed: false,
      technicalFailure: isTechnicalIssue(issue),
      output: '',
      issues: [issue],
      runtime: scenarioRuntime,
      metrics: {},
      durationMs: Date.now() - startedAt
    };
  }
}

async function runReplyBrainBenchmark(model, options = {}) {
  const testedAt = new Date().toISOString();
  if (!model || !clean(model.id || model.name)) throw Object.assign(new Error('MODEL_NOT_FOUND'), { code: 'MODEL_NOT_FOUND' });
  if (model.userDisabled === true) {
    return { schemaVersion: 2, authority: AUTHORITY, testedAt, modelId: model.id, model: model.name, completed: true, pass: false, status: 'REPLY_BRAIN_FAILED', score: 0, threshold: PASS_SCORE, qualifyingTasks: [], scenarios: [], summary: '模型已停用，不能参加回复大脑基准。', recommendation: '保持停用，确认无依赖后可删除。' };
  }
  if (isSpecialPurpose(model)) {
    return { schemaVersion: 2, authority: AUTHORITY, testedAt, modelId: model.id, model: model.name, completed: true, pass: false, status: 'REPLY_BRAIN_NOT_APPLICABLE', score: 0, threshold: PASS_SCORE, qualifyingTasks: [], scenarios: [], summary: '该模型属于翻译、代码或向量专用模型，不适合作为客户回复大脑。', recommendation: /translate/iu.test(modelName(model)) ? '保留为专用翻译模型，禁止参与回复路由。' : '停用回复路由，确认无其他用途后可删除。' };
  }

  const profile = options.runtimeProfile || runtimePolicy.profileForModel(model, options);
  const warmup = options.warmupResult || await warmupModel(model, options, profile);
  if (!warmup.pass) {
    return {
      schemaVersion: 2,
      authority: AUTHORITY,
      testedAt,
      modelId: model.id,
      model: model.name,
      provider: model.provider || '',
      completed: false,
      pass: false,
      status: 'REPLY_BRAIN_INCOMPLETE',
      score: 0,
      threshold: Number(options.passScore || PASS_SCORE),
      qualifyingTasks: [],
      runtimeProfile: profile,
      warmup,
      scenarios: [],
      completedScenarioCount: 0,
      totalScenarioCount: SCENARIOS.filter(row => !row.derived).length,
      summary: `本次回复大脑评估未完成：模型预热失败（${warmup.error?.message || warmup.status}）。`,
      recommendation: '保留最后一次成功基准与现有路由；检查模型装载、内存和 Ollama 状态后重新评估。'
    };
  }

  const context = { outputs: {}, results: {}, latencyThresholdMs: Number(profile.latencyThresholdMs || 90000), runtimeProfile: profile };
  const results = [];
  for (const scenario of SCENARIOS) {
    if (options.signal?.aborted) throw Object.assign(new Error('BENCHMARK_CANCELLED'), { code: 'BENCHMARK_CANCELLED' });
    const result = await runScenario(model, scenario, options, context);
    results.push(result);
    context.results[scenario.id] = result;
  }

  const score = results.reduce((sum, row) => sum + Number(row.score || 0), 0);
  const technicalCoreFailures = results.filter(row => CORE_SCENARIOS.includes(row.id) && row.technicalFailure === true);
  const completed = technicalCoreFailures.length === 0;
  const requiredPass = completed && CORE_SCENARIOS.every(id => context.results[id]?.pass === true);
  const pass = requiredPass && score >= Number(options.passScore || PASS_SCORE);
  const failedLabels = results.filter(row => !row.pass).map(row => row.label);
  const incompleteLabels = technicalCoreFailures.map(row => row.label);
  const qualifyingTasks = pass ? ['quick_reply', 'deep_reply', 'director', 'persona_rewrite'] : [];
  const status = !completed ? 'REPLY_BRAIN_INCOMPLETE' : (pass ? 'REPLY_BRAIN_QUALIFIED' : 'REPLY_BRAIN_FAILED');
  const platformCoverage = PLATFORM_COVERAGE.map(platform => ({
    platform,
    covered: results.some(row => row.platform === platform && row.completed !== false),
    passed: results.some(row => row.platform === platform && row.pass === true)
  }));
  return {
    schemaVersion: 2,
    authority: AUTHORITY,
    testedAt,
    modelId: model.id,
    model: model.name,
    provider: model.provider || '',
    completed,
    pass,
    status,
    score,
    threshold: Number(options.passScore || PASS_SCORE),
    qualifyingTasks,
    runtimeProfile: profile,
    warmup,
    scenarios: results,
    platformCoverage,
    completedScenarioCount: results.filter(row => row.completed !== false && !row.derived).length,
    totalScenarioCount: results.filter(row => !row.derived).length,
    summary: !completed
      ? `本次回复大脑评估未完成：${incompleteLabels.join('、') || '模型调用'}发生超时或技术失败；已保留最后一次成功结果。`
      : (pass ? `言策回复大脑基准通过：${score}/100。` : `言策回复大脑基准未通过：${score}/100；需改进：${failedLabels.join('、') || '核心场景'}。`),
    recommendation: !completed
      ? '不要把本次未完成视为模型质量失败；保留历史合格状态，待模型预热和资源稳定后重新评估。'
      : (pass ? '可进入核心回复或备用回复路由，由总评分和真实速度决定角色。' : '先停用回复任务路由；保留模型用于已通过的其他专用任务，或确认无用途后删除。')
  };
}

module.exports = {
  AUTHORITY,
  PASS_SCORE,
  CORE_SCENARIOS,
  PLATFORM_COVERAGE,
  SCENARIOS,
  appearsEnglish,
  jaccardSimilarity,
  isSpecialPurpose,
  warmupModel,
  isTechnicalIssue,
  runReplyBrainBenchmark,
  runtimeProfileForModel: runtimePolicy.profileForModel
};
