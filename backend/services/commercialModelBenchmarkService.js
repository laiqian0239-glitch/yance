'use strict';


const AUTHORITY = 'YanceCommercialModelBenchmark';
const SERVICE_VERSION = 1;
const PASS_SCORE = 80;

function clean(value) { return String(value == null ? '' : value).trim(); }
function lower(value) { return clean(value).toLowerCase(); }
function array(value) { return Array.isArray(value) ? value : []; }
function hasChinese(value) { return /[\u3400-\u9fff]/u.test(clean(value)); }
function parseJson(value) {
  const text = clean(value).replace(/^```json\s*/iu, '').replace(/```$/u, '').trim();
  try { return JSON.parse(text); } catch (_) { return null; }
}
function normalizeList(value) {
  return array(value).map(item => clean(item)).filter(Boolean);
}
function containsAny(text, patterns = []) { return patterns.some(pattern => pattern.test(text)); }
function safePreview(value) { return clean(value).slice(0, 900); }
function numericEntityPreserved(text, expected) { return clean(text).replace(/[\s()-]/gu, '').includes(clean(expected).replace(/[\s()-]/gu, '')); }

const SCENARIOS = Object.freeze([
  {
    id: 'de_to_zh_contact_fact_translation',
    task: 'translation',
    weight: 30,
    required: true,
    messages: [
      { role: 'system', content: '把德语私人聊天准确翻译成简体中文。只输出译文，不补充、不推断、不省略年龄、地点和兴趣。' },
      { role: 'user', content: 'Bin 65 und ein lustiger Mann. Meine Hobbys sind Radfahren, Schwimmen, Lesen und Musik. Ich komme aus Österreich und wohne in der Nähe von Wien.' }
    ],
    judge(text) {
      const value = clean(text);
      const issues = [];
      if (!hasChinese(value)) issues.push({ code: 'TARGET_LANGUAGE_MISMATCH', message: '德语没有翻译成中文' });
      if (!/65/u.test(value)) issues.push({ code: 'AGE_LOST', message: '年龄65丢失' });
      if (!/奥地利/u.test(value)) issues.push({ code: 'COUNTRY_LOST', message: '国家奥地利丢失' });
      if (!/维也纳/u.test(value) || !/(附近|周边|近郊)/u.test(value)) issues.push({ code: 'REGION_PRECISION_LOST', message: '没有保留“维也纳附近”的精度' });
      const interestChecks = [/(骑行|骑自行车)/u, /游泳/u, /阅读|读书/u, /音乐/u];
      if (interestChecks.filter(pattern => pattern.test(value)).length < 4) issues.push({ code: 'INTERESTS_LOST', message: '兴趣信息不完整' });
      if (/41岁|柏林|设计师/u.test(value)) issues.push({ code: 'FOREIGN_FACT_INJECTION', message: '混入了原文不存在的用户事实' });
      return { pass: issues.length === 0, issues };
    }
  },
  {
    id: 'zh_to_de_outbound_translation',
    task: 'translation',
    weight: 25,
    required: true,
    messages: [
      { role: 'system', content: '把中文私人聊天翻译成自然、简洁的德语。只输出德语，不补充内容。必须保持否定、时间和电话号码完全不变。使用du。' },
      { role: 'user', content: '我今晚18:30不能视频通话，明天可以。我的WhatsApp号码是 +49 170 2106045。' }
    ],
    judge(text) {
      const value = clean(text);
      const issues = [];
      if (!value || hasChinese(value)) issues.push({ code: 'TARGET_LANGUAGE_MISMATCH', message: '外发译文不是纯德语' });
      if (!/18\s*[:.]\s*30/u.test(value)) issues.push({ code: 'TIME_LOST', message: '时间18:30丢失' });
      if (!numericEntityPreserved(value, '+491702106045')) issues.push({ code: 'PHONE_LOST', message: '电话号码发生变化' });
      if (!containsAny(lower(value), [/\bnicht\b/u, /\bkein(?:e|en|em|er|es)?\b/u, /\bkann\s+.*nicht\b/u])) issues.push({ code: 'NEGATION_LOST', message: '否定含义丢失' });
      if (!containsAny(lower(value), [/\bmorgen\b/u])) issues.push({ code: 'TOMORROW_LOST', message: '“明天可以”丢失' });
      if (!containsAny(lower(value), [/video(?:anruf|chat|telefonat)/u, /video\s*call/u])) issues.push({ code: 'VIDEO_CALL_LOST', message: '视频通话含义丢失' });
      return { pass: issues.length === 0, issues };
    }
  },
  {
    id: 'peer_fact_role_isolation',
    task: 'fact_extraction',
    weight: 30,
    required: true,
    options: { json: true },
    messages: [
      { role: 'system', content: '只输出合法JSON，不要代码块。只提取peer/inbound对方明确说出的客户事实；严禁把self/outbound、平台内部ID、推断或系统字段写成客户事实。输出：{"age":number|null,"country":string,"region":string,"city":string,"interests":string[],"rejected":string[]}。' },
      { role: 'user', content: [
        '[peer/inbound] Bin 65 und ein lustiger Mann. Meine Hobbys sind Radfahren, Schwimmen, Lesen und Musik.',
        '[peer/inbound] Aus Österreich.',
        '[peer/inbound] In der Nähe von Wien.',
        '[self/outbound] Ich bin 41. Ich lebe in Berlin und arbeite als Modedesignerin.',
        '[platform/internal] stableIdentity=28359384636982883'
      ].join('\n') }
    ],
    judge(text) {
      const value = parseJson(text);
      const issues = [];
      if (!value || typeof value !== 'object' || Array.isArray(value)) return { pass: false, issues: [{ code: 'INVALID_JSON', message: '事实提取没有返回合法JSON对象' }] };
      if (Number(value.age) !== 65) issues.push({ code: 'AGE_WRONG', message: '没有提取对方年龄65' });
      if (!/奥地利|austria|österreich/iu.test(clean(value.country))) issues.push({ code: 'COUNTRY_WRONG', message: '没有提取奥地利' });
      if (!/维也纳|wien|vienna/iu.test(clean(value.region))) issues.push({ code: 'REGION_WRONG', message: '没有提取维也纳附近' });
      if (clean(value.city) && !/(未明确|unknown|not specified|null)/iu.test(clean(value.city))) issues.push({ code: 'CITY_OVERINFERRED', message: '把“维也纳附近”错误推成明确城市' });
      const interests = normalizeList(value.interests).join(' ');
      const interestChecks = [/radfahren|cycling|骑/iu, /schwimmen|swimming|游泳/iu, /lesen|reading|阅读/iu, /musik|music|音乐/iu];
      if (interestChecks.filter(pattern => pattern.test(interests)).length < 4) issues.push({ code: 'INTERESTS_WRONG', message: '兴趣提取不完整' });
      const serialized = JSON.stringify(value);
      if (/\b41\b|Berlin|设计师|Modedesignerin|28359384636982883/iu.test(serialized)) issues.push({ code: 'ROLE_OR_INTERNAL_ID_LEAK', message: '把用户事实或内部ID写入客户事实' });
      return { pass: issues.length === 0, issues, structured: value };
    }
  },
  {
    id: 'relationship_evidence_boundary',
    task: 'relationship',
    weight: 15,
    required: false,
    options: { json: true },
    messages: [
      { role: 'system', content: '只输出合法JSON。只能依据给定聊天证据，区分事实和推断，不得把平台ID当事实。字段：facts（数组）、inferences（数组）、evidenceMessageIds（数组）。' },
      { role: 'user', content: 'm1 peer: Ich wohne in der Nähe von Wien.\nm2 self: Ich lebe in Berlin.\nsystem: facebookPsid=28359384636982883' }
    ],
    judge(text) {
      const value = parseJson(text);
      const issues = [];
      if (!value || typeof value !== 'object' || Array.isArray(value)) return { pass: false, issues: [{ code: 'INVALID_JSON', message: '关系分析没有返回合法JSON对象' }] };
      const facts = JSON.stringify(value.facts || []);
      const evidenceIds = normalizeList(value.evidenceMessageIds);
      if (!/维也纳|wien|vienna/iu.test(facts)) issues.push({ code: 'PEER_FACT_MISSING', message: '没有保留对方地点事实' });
      if (/Berlin|28359384636982883/iu.test(facts)) issues.push({ code: 'SELF_OR_INTERNAL_FACT_LEAK', message: '把用户事实或内部ID当成客户事实' });
      if (!evidenceIds.includes('m1')) issues.push({ code: 'EVIDENCE_MISSING', message: '没有返回真实对方消息证据m1' });
      if (evidenceIds.includes('m2')) issues.push({ code: 'SELF_EVIDENCE_LEAK', message: '把用户自己的消息当成客户证据' });
      return { pass: issues.length === 0, issues, structured: value };
    }
  }
]);

function scenarioById(id) { return SCENARIOS.find(row => row.id === id); }
function taskScore(results = [], tasks = []) {
  const selected = results.filter(row => tasks.includes(row.task));
  const maximum = selected.reduce((sum, row) => sum + Number(row.weight || 0), 0);
  const earned = selected.reduce((sum, row) => sum + Number(row.score || 0), 0);
  return maximum ? Math.round(earned / maximum * 100) : 0;
}

async function runScenario(model, scenario, options = {}) {
  const executor = options.executor || require('./modelExecutor').executeModel;
  const startedAt = Date.now();
  try {
    const response = await executor(model, scenario.messages, {
      maxTokens: scenario.task === 'translation' ? 320 : 650,
      temperature: scenario.task === 'translation' ? 0.1 : 0,
      json: scenario.options?.json === true,
      think: false,
      timeoutMs: Number(options.timeoutMs || 180000)
    }, options.signal);
    if (options.registry && typeof options.registry.recordInvocation === 'function') await options.registry.recordInvocation(model.id, response).catch(() => {});
    const judged = scenario.judge(response?.text || '');
    const durationMs = Number(response?.totalMs || Date.now() - startedAt);
    return {
      id: scenario.id,
      task: scenario.task,
      weight: scenario.weight,
      required: scenario.required === true,
      pass: judged.pass === true,
      score: judged.pass === true ? scenario.weight : 0,
      issues: array(judged.issues),
      structured: judged.structured || null,
      preview: safePreview(response?.text),
      metrics: {
        totalMs: durationMs,
        firstTokenMs: Number(response?.firstTokenMs || 0),
        promptTokens: Number(response?.promptTokens || 0),
        outputTokens: Number(response?.outputTokens || 0),
        totalTokens: Number(response?.totalTokens || 0),
        returnedModel: clean(response?.returnedModel || response?.raw?.model)
      }
    };
  } catch (error) {
    if (options.registry && typeof options.registry.recordInvocationFailure === 'function') await options.registry.recordInvocationFailure(model.id, error).catch(() => {});
    return {
      id: scenario.id,
      task: scenario.task,
      weight: scenario.weight,
      required: scenario.required === true,
      pass: false,
      score: 0,
      issues: [{ code: clean(error.code || 'MODEL_REQUEST_FAILED'), message: clean(error.message || error) }],
      structured: null,
      preview: '',
      metrics: { totalMs: Date.now() - startedAt, firstTokenMs: 0, promptTokens: 0, outputTokens: 0, totalTokens: 0, returnedModel: '' }
    };
  }
}

async function benchmarkModel(model, options = {}) {
  const selectedIds = array(options.scenarios).length ? array(options.scenarios) : SCENARIOS.map(row => row.id);
  const scenarios = selectedIds.map(scenarioById).filter(Boolean);
  const results = [];
  for (const scenario of scenarios) {
    if (options.signal?.aborted) throw options.signal.reason || Object.assign(new Error('MODEL_CANCELLED'), { code: 'MODEL_CANCELLED' });
    results.push(await runScenario(model, scenario, options));
  }
  const maximum = results.reduce((sum, row) => sum + Number(row.weight || 0), 0);
  const earned = results.reduce((sum, row) => sum + Number(row.score || 0), 0);
  const score = maximum ? Math.round(earned / maximum * 100) : 0;
  const requiredPassed = results.filter(row => row.required).every(row => row.pass);
  const translationScore = taskScore(results, ['translation']);
  const evidenceScore = taskScore(results, ['fact_extraction', 'relationship']);
  const qualifyingTasks = [];
  if (results.filter(row => row.task === 'translation').length >= 2 && results.filter(row => row.task === 'translation').every(row => row.pass)) qualifyingTasks.push('translation');
  if (results.some(row => row.task === 'fact_extraction' && row.pass) && evidenceScore >= 65) qualifyingTasks.push('fact_extraction', 'memory_extraction', 'understanding', 'summary', 'relationship');
  const pass = requiredPassed && score >= PASS_SCORE;
  return {
    schemaVersion: 1,
    authority: AUTHORITY,
    serviceVersion: SERVICE_VERSION,
    testedAt: new Date().toISOString(),
    completed: true,
    status: pass ? 'COMMERCIAL_MODEL_QUALIFIED' : 'COMMERCIAL_MODEL_FAILED',
    pass,
    score,
    threshold: PASS_SCORE,
    translationScore,
    evidenceScore,
    qualifyingTasks: [...new Set(qualifyingTasks)],
    scenarios: results,
    summary: pass
      ? `商业专项通过：总分${score}，翻译${translationScore}，事实证据${evidenceScore}`
      : `商业专项未通过：总分${score}，翻译${translationScore}，事实证据${evidenceScore}`
  };
}

function modelCost(model = {}) {
  const pricing = model.catalogMetadata?.pricing || {};
  if (pricing.known === false) return Number.POSITIVE_INFINITY;
  const promptKnown = Number.isFinite(Number(pricing.promptPerMillion));
  const completionKnown = Number.isFinite(Number(pricing.completionPerMillion));
  if (!promptKnown || !completionKnown) return Number.POSITIVE_INFINITY;
  return Number(pricing.promptPerMillion || 0) + Number(pricing.completionPerMillion || 0);
}
function modelIsFree(model = {}) {
  if (model.catalogMetadata?.free === true) return true;
  if (model.catalogMetadata?.pricing?.known === false) return false;
  return modelCost(model) === 0;
}
function modelHasUsablePricing(model = {}) {
  return modelIsFree(model) || model.catalogMetadata?.pricing?.known !== false;
}
function benchmarkScore(model = {}, key = 'score') { return Number(model.lastCommercialBenchmark?.[key] || 0); }

function modelTaskEligibility(model = {}, role = '') {
  const catalogEligibility = model.catalogMetadata?.taskEligibility;
  if (catalogEligibility && typeof catalogEligibility === 'object' && Object.prototype.hasOwnProperty.call(catalogEligibility, role)) {
    return catalogEligibility[role] === true;
  }
  const hints = new Set(array(model.taskHints).map(clean));
  const roleTasks = {
    translation: ['translation'],
    memory_extraction: ['memory_extraction', 'fact_extraction'],
    quick_reply: ['quick_reply'],
    director: ['director'],
    deep_reply: ['deep_reply'],
    media_analysis: ['media_analysis', 'material_analysis'],
    persona_rewrite: ['persona_rewrite']
  }[role];
  if (!roleTasks) return false;
  if (hints.size) return roleTasks.some(task => hints.has(task));
  // Legacy OpenRouter rows created before the capability catalog was added are
  // still allowed into a shortlist chosen by an explicit role selection. They
  // will receive the authoritative capability metadata on the next catalog sync.
  return model.source === 'openrouter-auto';
}

function uniqueModels(rows = []) {
  const seen = new Set();
  return rows.filter(model => {
    const id = clean(model?.id);
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function chooseOpenRouterBenchmarkPlan(state = {}, options = {}) {
  const models = array(state.models).filter(model => model.source === 'openrouter-auto' && model.available !== false && model.userDisabled !== true);
  const byName = new Map(models.map(model => [clean(model.name), model]));
  const selections = state.openRouter?.selections || {};
  const rowsForRole = (role, limit) => array(selections[role])
    .slice(0, Math.max(1, limit))
    .map(row => byName.get(clean(row.id)))
    .filter(Boolean)
    .filter(model => modelTaskEligibility(model, role));

  const utilityRequested = [
    ...rowsForRole('translation', Number(options.translationLimit || 4)),
    ...rowsForRole('memory_extraction', Number(options.memoryLimit || 4))
  ];
  const replyRequested = [
    ...rowsForRole('quick_reply', Number(options.quickLimit || 3)),
    ...rowsForRole('director', Number(options.directorLimit || 3)),
    ...rowsForRole('deep_reply', Number(options.deepLimit || 3)),
    ...rowsForRole('persona_rewrite', Number(options.personaLimit || 3))
  ];
  const utilityMaximum = Math.max(1, Math.min(16, Number(options.maxUtilityModels || options.maxModels || 10)));
  const replyMaximum = Math.max(1, Math.min(12, Number(options.maxReplyModels || 8)));
  const utilityCandidates = uniqueModels(utilityRequested).slice(0, utilityMaximum);
  const replyCandidates = uniqueModels(replyRequested).slice(0, replyMaximum);
  const shortlistedIds = new Set([...utilityCandidates, ...replyCandidates].map(model => clean(model.id)));
  const catalogCount = Number(state.openRouter?.modelCount || state.openRouter?.catalogCount || 0);
  return {
    schemaVersion: 1,
    authority: AUTHORITY,
    catalogCount,
    registeredCount: models.length,
    shortlistedCount: shortlistedIds.size,
    utilityCandidateCount: utilityCandidates.length,
    replyCandidateCount: replyCandidates.length,
    unassessedCatalogCount: Math.max(0, catalogCount - shortlistedIds.size),
    utilityCandidates,
    replyCandidates,
    roleCoverage: {
      translation: rowsForRole('translation', 100).length,
      memory_extraction: rowsForRole('memory_extraction', 100).length,
      quick_reply: rowsForRole('quick_reply', 100).length,
      director: rowsForRole('director', 100).length,
      deep_reply: rowsForRole('deep_reply', 100).length,
      persona_rewrite: rowsForRole('persona_rewrite', 100).length,
      media_analysis: rowsForRole('media_analysis', 100).length
    }
  };
}

function chooseOpenRouterBenchmarkModels(state = {}, options = {}) {
  return chooseOpenRouterBenchmarkPlan(state, options).utilityCandidates;
}

function recommendedUtilityRoutes(models = []) {
  const passed = array(models)
    .filter(model => model.lastCommercialBenchmark?.completed !== false)
    .filter(modelHasUsablePricing);
  const translation = passed
    .filter(model => array(model.lastCommercialBenchmark?.qualifyingTasks).includes('translation'))
    .sort((a, b) => Number(modelIsFree(b)) - Number(modelIsFree(a)) || benchmarkScore(b, 'translationScore') - benchmarkScore(a, 'translationScore') || modelCost(a) - modelCost(b));
  const facts = passed
    .filter(model => array(model.lastCommercialBenchmark?.qualifyingTasks).includes('fact_extraction'))
    .sort((a, b) => Number(modelIsFree(b)) - Number(modelIsFree(a)) || benchmarkScore(b, 'evidenceScore') - benchmarkScore(a, 'evidenceScore') || modelCost(a) - modelCost(b));
  const localHistory = array(models)
    .filter(model => model.provider === 'ollama' && model.available !== false && model.userDisabled !== true)
    .filter(model => /translate|translation|translategemma/iu.test(clean(model.name || model.id)) || array(model.allowedTasks).includes('translation'))
    .sort((a, b) => Number(b.callCount || 0) - Number(a.callCount || 0) || clean(a.name).localeCompare(clean(b.name)));
  const route = (rows, source) => ({
    primary: rows[0]?.id || '',
    fallback: rows.find(row => row.id !== rows[0]?.id)?.id || '',
    requestedPrimary: '',
    requestedFallback: '',
    primarySelection: 'auto',
    fallbackSelection: 'auto',
    requestedEnabled: true,
    enabled: Boolean(rows[0]?.id),
    allowExperimental: true,
    allowConditional: false,
    allowCloudFallback: true,
    humanReviewRequired: false,
    source,
    autoSelectionReason: rows[0] ? `商业专项自动选择：${rows[0].displayName || rows[0].name}` : '没有通过商业专项的模型'
  });
  const translationRoute = {
    ...route(translation, 'commercial-benchmark-translation'),
    historyPrimary: clean(localHistory[0]?.id),
    historyFallback: clean(localHistory.find(row => row.id !== localHistory[0]?.id)?.id),
    offlineFallback: clean(localHistory[0]?.id),
    profiles: {
      realtime: 'commercial-qualified-cloud',
      outbound: 'commercial-qualified-cloud',
      history: localHistory[0] ? 'local-low-priority' : 'cloud-fallback',
      offline: localHistory[0] ? 'local-draft-only' : 'unavailable'
    }
  };
  return {
    translation: translationRoute,
    fact_extraction: route(facts, 'commercial-benchmark-fact'),
    memory_extraction: route(facts, 'commercial-benchmark-memory'),
    understanding: route(facts, 'commercial-benchmark-understanding'),
    summary: route(facts, 'commercial-benchmark-summary'),
    relationship: route(facts, 'commercial-benchmark-relationship')
  };
}

async function runAndRecord(model, options = {}) {
  const registry = options.registry || require('./modelRegistry');
  const result = await benchmarkModel(model, { ...options, registry });
  if (typeof registry.recordCommercialBenchmark === 'function') await registry.recordCommercialBenchmark(model.id, result);
  return result;
}

module.exports = {
  AUTHORITY,
  SERVICE_VERSION,
  PASS_SCORE,
  SCENARIOS,
  parseJson,
  runScenario,
  benchmarkModel,
  runAndRecord,
  chooseOpenRouterBenchmarkModels,
  chooseOpenRouterBenchmarkPlan,
  modelTaskEligibility,
  recommendedUtilityRoutes,
  modelIsFree,
  modelCost,
  modelHasUsablePricing
};
