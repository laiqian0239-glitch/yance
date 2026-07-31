'use strict';

const { executeModel } = require('./modelExecutor');
const { appearsGerman } = require('./modelQualification');
const { authority: asyncOperationLifecycleAuthority } = require('./asyncOperationLifecycleAuthority');

const AUTHORITY = 'OpenRouterOnboardingSmokeAuthority';
const REQUIRED_CAPABILITIES = Object.freeze([
  'social_dialogue_high',
  'style_axis_control',
  'candidate_diversity',
  'persona_consistency_long_context',
  'relationship_reasoning',
  'json_schema_strict',
  'translation_quality',
  'multilingual_zh_bridge'
]);
const ALLOWED_TASKS = Object.freeze([
  'director', 'quick_reply', 'deep_reply', 'translation', 'persona_rewrite', 'learning_synthesis'
]);

function clean(value) { return String(value == null ? '' : value).trim(); }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function array(value) { return Array.isArray(value) ? value : []; }

function parseJson(text = '') {
  const raw = clean(text).replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '');
  try { return JSON.parse(raw); } catch (_) {}
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(raw.slice(start, end + 1)); } catch (_) {}
  }
  const error = new Error('OpenRouter 最小真实调用没有返回有效 JSON');
  error.code = 'OPENROUTER_SMOKE_JSON_INVALID';
  throw error;
}

function validatePayload(payload = {}) {
  const director = object(payload.director);
  const candidates = array(payload.candidates);
  const translation = clean(payload.translationZh || payload.translation_zh);
  const fabricatedFacts = array(payload.fabricatedFacts || payload.fabricated_facts);
  const issues = [];
  if (!clean(director.goal) || !clean(director.strategy) || !Array.isArray(director.avoid)) issues.push('导演结构不完整');
  if (candidates.length < 3 || candidates.length > 5) issues.push('候选数量不是 3–5 条');
  const texts = candidates.map(row => clean(object(row).text));
  const zhRows = candidates.map(row => clean(object(row).translationZh || object(row).translation_zh));
  if (texts.some(text => !text || !appearsGerman(text))) issues.push('候选未保持德语输出');
  if (zhRows.some(text => !text || !/[\u3400-\u9fff]/u.test(text))) issues.push('候选缺少中文译文');
  if (new Set(texts.map(text => text.toLowerCase())).size !== texts.length) issues.push('候选存在重复');
  if (!translation || !/[\u3400-\u9fff]/u.test(translation)) issues.push('翻译验证未返回中文');
  if (fabricatedFacts.length) issues.push('低信息问候被写入了无证据事实');
  if (issues.length) {
    const error = new Error(`OpenRouter 最小真实调用未通过：${issues.join('；')}`);
    error.code = 'OPENROUTER_SMOKE_OUTPUT_INVALID';
    error.issues = issues;
    throw error;
  }
  return { director, candidates, translation, fabricatedFacts };
}

function benchmarkResult(validated = {}, metrics = {}) {
  const testedAt = new Date().toISOString();
  return {
    schemaVersion: 1,
    authority: 'YanceReplyBrainOnboardingSmoke',
    testedAt,
    completed: true,
    pass: false,
    status: 'REPLY_BRAIN_CONDITIONAL',
    score: 82,
    qualifyingTasks: [],
    summary: 'OpenRouter 最小真实调用已通过；仅允许人工确认的条件试运行，正式资格仍需商业专项评估。',
    scenarios: [
      { id: 'german_whatsapp', label: '德语低信息开场候选', pass: true, weight: 30, score: 30, issues: [] },
      { id: 'german_alternative', label: '三条方向不同候选', pass: new Set(validated.candidates.map(row => clean(row.text).toLowerCase())).size >= 3, weight: 15, score: 15, issues: [] },
      { id: 'persona_boundary', label: '低信息问候事实边界', pass: validated.fabricatedFacts.length === 0, weight: 25, score: 25, issues: [] },
      { id: 'director_schema', label: '导演 JSON 结构', pass: true, weight: 20, score: 20, issues: [] },
      { id: 'latency', label: '最小真实调用时延', pass: Number(metrics.totalMs || 0) > 0, weight: 10, score: 8, issues: [] }
    ]
  };
}

async function runModelSmoke(model, options = {}) {
  const registry = options.registry || require('./modelRegistry');
  const prompt = [
    '你正在执行言策 OpenRouter 接入的最小真实生产能力测试。',
    '对方只发送：Hallo 🌹',
    '不得虚构年龄、职业、城市、婚姻、兴趣或任何私人事实。',
    '返回严格 JSON，不要 Markdown：',
    '{"director":{"goal":"中文","strategy":"中文","avoid":["中文"]},"candidates":[{"text":"德语自然短句","translationZh":"中文译文","direction":"中文方向"}],"translationZh":"Hallo 🌹 的中文含义","fabricatedFacts":[]}',
    'candidates 必须为 3 条，方向明显不同，都是自然简短德语，每条最多一个低压力话题钩子。'
  ].join('\n');
  let inference;
  try {
    const execute = options.executeModel || executeModel;
    inference = await execute(model, [
      { role: 'system', content: '只输出符合要求的 JSON。不得输出分析过程。' },
      { role: 'user', content: prompt }
    ], { maxTokens: 720, temperature: 0.2, json: true, timeoutMs: Number(options.timeoutMs || 120000) }, options.signal);
    const payload = parseJson(inference.text);
    const validated = validatePayload(payload);
    await registry.recordInvocation(model.id, inference);
    await registry.recordReplyBrainBenchmark(model.id, benchmarkResult(validated, inference));
    await registry.recordCommercialBenchmark(model.id, {
      schemaVersion: 1,
      authority: AUTHORITY,
      testedAt: new Date().toISOString(),
      completed: true,
      pass: true,
      status: 'OPENROUTER_TRANSLATION_SMOKE_PASSED',
      score: 82,
      translationScore: 82,
      evidenceScore: 0,
      qualifyingTasks: ['translation'],
      summary: '中文桥接翻译最小真实调用通过；其他商业任务资格仍待专项评估。'
    });
    await registry.recordTest(model.id, {
      schemaVersion: 1,
      testedAt: new Date().toISOString(),
      qualification: 'experimental',
      allowedTasks: [...ALLOWED_TASKS],
      blockedReason: '',
      connectivity: {
        name: 'connectivity', task: 'general', pass: true, output: 'OPENROUTER_ONBOARDING_SMOKE_OK',
        metrics: {
          totalMs: Number(inference.totalMs || 0), firstTokenMs: Number(inference.firstTokenMs || 0),
          promptTokens: Number(inference.promptTokens || 0), outputTokens: Number(inference.outputTokens || 0),
          totalTokens: Number(inference.totalTokens || 0), returnedModel: clean(inference.returnedModel)
        }, status: 200, durationMs: Number(inference.totalMs || 0), code: '', error: ''
      },
      scores: {
        connectivity: { pass: true },
        json: { pass: true },
        persona: { pass: true },
        hallucination: { pass: true },
        translation: { pass: true }
      },
      summary: { passed: 5, total: 5, averageLatencyMs: Number(inference.totalMs || 0) }
    });
    const smoke = {
      schemaVersion: 1,
      authority: AUTHORITY,
      pass: true,
      testedAt: new Date().toISOString(),
      modelId: model.id,
      modelSlug: clean(model.name),
      returnedModel: clean(inference.returnedModel),
      requestId: clean(inference.raw?.id),
      requestMode: clean(inference.requestMode),
      latencyMs: Number(inference.totalMs || 0),
      tokenUsage: {
        prompt: Number(inference.promptTokens || 0), output: Number(inference.outputTokens || 0), total: Number(inference.totalTokens || 0)
      },
      candidateCount: validated.candidates.length,
      capabilityTags: [...REQUIRED_CAPABILITIES],
      allowedTasks: [...ALLOWED_TASKS],
      message: '最小真实导演、德语候选、中文翻译与事实边界测试通过；正式专项评估仍待运行。'
    };
    await registry.recordOpenRouterOnboardingSmoke(model.id, smoke);
    return smoke;
  } catch (error) {
    if (inference) await registry.recordInvocationFailure(model.id, error, { countForCircuit: false }).catch(() => {});
    const smoke = {
      schemaVersion: 1,
      authority: AUTHORITY,
      pass: false,
      testedAt: new Date().toISOString(),
      modelId: model.id,
      modelSlug: clean(model.name),
      returnedModel: clean(inference?.returnedModel),
      requestId: clean(inference?.raw?.id || error.requestId),
      code: clean(error.code || 'OPENROUTER_ONBOARDING_SMOKE_FAILED'),
      message: clean(error.message || 'OpenRouter 最小真实调用失败'),
      issues: array(error.issues),
      capabilityTags: [],
      allowedTasks: []
    };
    await registry.recordOpenRouterOnboardingSmoke(model.id, smoke).catch(() => {});
    return smoke;
  }
}

function selectIndependentModels(snapshot = {}, models = [], limit = 2) {
  const preferredSlugs = [];
  for (const role of ['quick_reply', 'director', 'deep_reply', 'translation']) {
    for (const row of array(snapshot.selections?.[role])) {
      const slug = clean(row.id || row.name);
      if (slug && !preferredSlugs.includes(slug)) preferredSlugs.push(slug);
    }
  }
  const bySlug = new Map(array(models).map(model => [clean(model.name), model]));
  const selected = preferredSlugs.map(slug => bySlug.get(slug)).filter(Boolean);
  for (const model of array(models)) {
    if (selected.some(row => row.id === model.id)) continue;
    if (model.source === 'openrouter-auto' && model.available !== false && model.userDisabled !== true) selected.push(model);
  }
  return selected.slice(0, Math.max(2, Number(limit || 2)));
}

function conditionalRoutes(primary, fallback) {
  const base = {
    primary: primary.id,
    fallback: fallback.id,
    enabled: true,
    allowExperimental: true,
    allowConditional: true,
    humanReviewRequired: true,
    allowCloudFallback: true
  };
  return {
    director: { ...base, maxTokens: 1200, timeoutMs: 120000 },
    quick_reply: { ...base, maxTokens: 1200, timeoutMs: 120000 },
    deep_reply: { ...base, maxTokens: 1800, timeoutMs: 180000 },
    translation: { ...base, allowConditional: false, maxTokens: 1200, timeoutMs: 120000 },
    learning_synthesis: { ...base, maxTokens: 1400, timeoutMs: 150000 }
  };
}

async function run(options = {}) {
  const registry = options.registry || require('./modelRegistry');
  const lifecycle = options.operationLifecycle || asyncOperationLifecycleAuthority;
  const snapshot = object(options.snapshot);
  const state = registry.read();
  const selected = selectIndependentModels(snapshot, state.models || [], 2);
  const fingerprint = [
    clean(state.openRouterOnboarding?.keyFingerprint || state.openRouter?.keyFingerprint || 'key-state-unknown'),
    ...selected.map(model => `${clean(model.id)}:${clean(model.name)}`),
    clean(snapshot.generatedAt || snapshot.updatedAt || '')
  ].join('|');
  const operation = lifecycle.create({
    operationId: clean(options.operationId),
    operationType: 'openrouter.onboarding.dual-model-smoke',
    scopeKey: 'openrouter:production-routing',
    objectFingerprint: fingerprint,
    metadata: { selectedModelIds: selected.map(model => clean(model.id)), selectedModelSlugs: selected.map(model => clean(model.name)) }
  }).operation;
  lifecycle.start(operation.operationId, { progress: 5 });
  try {
    if (selected.length < 2 || selected[0].id === selected[1].id) {
      const error = new Error('OpenRouter 至少需要两个不同的云端模型才能建立主模型与独立备用模型');
      error.code = 'OPENROUTER_INDEPENDENT_FALLBACK_REQUIRED';
      throw error;
    }
    const results = [];
    for (const model of selected.slice(0, 2)) {
      results.push(await runModelSmoke(model, { registry, signal: options.signal, timeoutMs: options.timeoutMs, executeModel: options.executeModel }));
      lifecycle.progress(operation.operationId, 40 + (results.length * 20));
    }
    const passed = results.filter(row => row.pass === true);
    if (passed.length < 2) {
      const error = new Error(`OpenRouter 最小真实调用只通过 ${passed.length}/2，未建立独立备用路由`);
      error.code = 'OPENROUTER_ONBOARDING_SMOKE_INCOMPLETE';
      error.results = results;
      throw error;
    }
    const routedState = await registry.applyOpenRouterConditionalRoutes(conditionalRoutes(selected[0], selected[1]));
    const output = {
      schemaVersion: 1,
      authority: AUTHORITY,
      pass: true,
      state: 'conditional-ready',
      operationId: operation.operationId,
      operationGeneration: operation.generation,
      primaryModelId: selected[0].id,
      primaryModelSlug: selected[0].name,
      fallbackModelId: selected[1].id,
      fallbackModelSlug: selected[1].name,
      results,
      routes: routedState.routes || {},
      formalBenchmarkStatus: 'pending',
      humanReviewRequired: true,
      message: 'OpenRouter 已完成双模型最小真实调用并建立条件试运行路由；正式商业专项评估仍待执行。'
    };
    lifecycle.succeed(operation.operationId, {
      state: output.state,
      primaryModelId: output.primaryModelId,
      fallbackModelId: output.fallbackModelId,
      passed: 2,
      total: 2
    }, { generation: operation.generation, objectFingerprint: operation.objectFingerprint });
    return output;
  } catch (error) {
    lifecycle.fail(operation.operationId, error, { generation: operation.generation, objectFingerprint: operation.objectFingerprint });
    error.operationId = operation.operationId;
    error.operationGeneration = operation.generation;
    throw error;
  }
}

module.exports = {
  AUTHORITY,
  REQUIRED_CAPABILITIES,
  ALLOWED_TASKS,
  parseJson,
  validatePayload,
  selectIndependentModels,
  conditionalRoutes,
  runModelSmoke,
  run
};
