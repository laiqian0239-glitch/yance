'use strict';

const crypto = require('crypto');
const { normalizeModelResult, parseStructuredText } = require('./modelResultNormalizer');
const { containsHan } = require('./bilingualUnderstandingService');

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value == null ? '' : value)).digest('hex');
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function hasForeignText(value, depth = 0) {
  if (depth > 8 || value == null) return false;
  if (typeof value === 'string') {
    const text = clean(value);
    return Boolean(text) && !containsHan(text) && /[A-Za-zÀ-žА-Яа-яЁё\u0600-\u06ff]/u.test(text);
  }
  if (Array.isArray(value)) return value.some(item => hasForeignText(item, depth + 1));
  if (typeof value === 'object') return Object.values(value).some(item => hasForeignText(item, depth + 1));
  return false;
}

const OMIT_KEYS = new Set([
  'id', 'contactId', 'conversationId', 'messageId', 'externalMessageId', 'modelId', 'modelName',
  'analyzedThroughMessageId', 'sourceMessageIds', 'contextMessageIds', 'rawAnalysis', 'payload',
  'createdAt', 'updatedAt', 'sentAt', 'timestamp', 'url', 'avatarUrl', 'mediaUrl', 'mediaPath',
  'quote', 'sourceText', 'originalText'
]);

function project(value, depth = 0) {
  if (depth > 7 || value == null) return value;
  if (typeof value === 'string') return clean(value).slice(0, 2400);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 40).map(item => project(item, depth + 1));
  if (typeof value !== 'object') return '';
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    if (OMIT_KEYS.has(key) || key.startsWith('_')) continue;
    output[key] = project(child, depth + 1);
  }
  return output;
}

function promptFor(bundle) {
  return [
    '你是言策的中文理解层。',
    '把 JSON 中所有面向用户的外语字符串准确翻译成简体中文。',
    '严格保持 JSON 键、数组顺序、数字、布尔值、null 和层级不变，只翻译字符串值。',
    '姓名、昵称、城市、品牌、金额、日期、电话号码、URL、Emoji、平台 ID 不得误译。',
    '不要增加分析、解释、Markdown 或原文。只输出有效 JSON。',
    JSON.stringify(bundle)
  ].join('\n');
}

function repairPromptFor(bundle, invalidOutput) {
  return [
    '你刚才返回的 JSON 结构不符合源数据。只修复 JSON 结构，不改变翻译含义。',
    '必须与 SOURCE_JSON 保持完全相同的键、数组长度、数字、布尔值、null 和层级。',
    '只允许翻译字符串值。只输出有效 JSON。',
    `SOURCE_JSON=${JSON.stringify(bundle)}`,
    `INVALID_OUTPUT=${String(invalidOutput || '').slice(0, 24000)}`
  ].join('\n');
}

function parseResult(result) {
  const normalized = normalizeModelResult(result, { json: true });
  const direct = object(result?.structured);
  if (Object.keys(direct).length) return direct;
  return object(normalized.structured || parseStructuredText(normalized.text));
}

function validateStructure(source, translated, path = '$', errors = []) {
  if (source === null || typeof source !== 'object') {
    if (typeof source === 'string') {
      if (typeof translated !== 'string') errors.push({ path, code: 'STRING_TYPE_CHANGED' });
      return errors;
    }
    if (!Object.is(source, translated)) errors.push({ path, code: 'SCALAR_CHANGED', expected: source, actual: translated });
    return errors;
  }
  if (Array.isArray(source)) {
    if (!Array.isArray(translated)) {
      errors.push({ path, code: 'ARRAY_TYPE_CHANGED' });
      return errors;
    }
    if (source.length !== translated.length) errors.push({ path, code: 'ARRAY_LENGTH_CHANGED', expected: source.length, actual: translated.length });
    for (let index = 0; index < Math.min(source.length, translated.length); index += 1) {
      validateStructure(source[index], translated[index], `${path}[${index}]`, errors);
    }
    return errors;
  }
  if (!translated || typeof translated !== 'object' || Array.isArray(translated)) {
    errors.push({ path, code: 'OBJECT_TYPE_CHANGED' });
    return errors;
  }
  const sourceKeys = Object.keys(source).sort();
  const translatedKeys = Object.keys(translated).sort();
  if (JSON.stringify(sourceKeys) !== JSON.stringify(translatedKeys)) {
    errors.push({ path, code: 'OBJECT_KEYS_CHANGED', expected: sourceKeys, actual: translatedKeys });
  }
  for (const key of sourceKeys) {
    if (Object.prototype.hasOwnProperty.call(translated, key)) validateStructure(source[key], translated[key], `${path}.${key}`, errors);
  }
  return errors;
}

function attemptProjection(attempts = []) {
  return (Array.isArray(attempts) ? attempts : []).slice(0, 12).map(row => ({
    modelId: clean(row?.modelId),
    model: clean(row?.model),
    role: clean(row?.role),
    status: clean(row?.status),
    code: clean(row?.code || row?.reasonCode),
    httpStatus: Number(row?.httpStatus || 0),
    emergencyMode: row?.emergencyMode === true
  }));
}

function receipt(input = {}) {
  const base = {
    authority: 'YanceStructuredChineseUnderstandingAuthority',
    version: 1,
    status: clean(input.status),
    reasonCode: clean(input.reasonCode),
    requestedModelId: clean(input.requestedModelId),
    selectedModelId: clean(input.selectedModelId),
    selectedModel: clean(input.selectedModel),
    fallbackUsed: input.fallbackUsed === true,
    emergencyMode: input.emergencyMode === true,
    learningEligible: input.learningEligible === true,
    schemaRepairUsed: input.schemaRepairUsed === true,
    schemaRepairModelId: clean(input.schemaRepairModelId),
    sourceSha256: clean(input.sourceSha256),
    translatedSha256: clean(input.translatedSha256),
    structureIntegrity: {
      pass: input.structurePass === true,
      errors: (Array.isArray(input.structureErrors) ? input.structureErrors : []).slice(0, 20)
    },
    attempts: attemptProjection(input.attempts),
    completedAt: clean(input.completedAt || new Date().toISOString())
  };
  return { ...base, receiptSha256: sha256(stableJson(base)) };
}

function assertExecutionCurrent(input = {}) {
  if (input.signal?.aborted) {
    const reason = input.signal.reason instanceof Error
      ? input.signal.reason
      : Object.assign(new Error('AI analysis translation was cancelled'), {
        code: 'AI_ANALYSIS_CANCELLED'
      });
    if (!reason.code) reason.code = 'AI_ANALYSIS_CANCELLED';
    throw reason;
  }
  if (typeof input.assertCurrent === 'function') input.assertCurrent();
}

function isExecutionFenceError(error, input = {}) {
  if (input.signal?.aborted) return true;
  return new Set([
    'AI_ANALYSIS_CANCELLED',
    'AI_STALE_RESULT',
    'AI_STALE_EXECUTION_RESULT',
    'MODEL_CANCELLED',
    'JOB_CANCELLED'
  ]).has(clean(error?.code).toUpperCase());
}

async function executeTranslation(gateway, bundle, input, options = {}) {
  assertExecutionCurrent(input);
  const systemContent = options.repair === true
    ? '只输出与源 JSON 结构完全一致的有效 JSON。只修复结构，只翻译字符串值。'
    : '只输出保持原结构的有效 JSON，所有外语说明翻译为简体中文。';
  const requestedModelId = clean(options.modelId || input.modelId);
  const result = await gateway.execute({
    task: 'translation',
    modelId: requestedModelId,
    messages: [
      { role: 'system', content: systemContent },
      { role: 'user', content: options.repair === true ? repairPromptFor(bundle, options.invalidOutput) : promptFor(bundle) }
    ],
    signal: input.signal || null,
    context: object(input.context),
    options: {
      json: true,
      temperature: options.repair === true ? 0 : 0.05,
      maxTokens: Math.max(600, Math.min(5000, Number(input.maxTokens || 2800))),
      timeoutMs: Math.max(10000, Number(input.timeoutMs || 180000)),
      keepAlive: input.keepAlive || '10m',
      translationProfile: 'realtime',
      onlyRequestedModel: options.onlyRequestedModel === true
    },
    dedupeKey: `${clean(input.dedupeKey) || `social-understanding-zh:${clean(input.contactId)}:${clean(input.conversationId)}`}${options.repair === true ? ':schema-repair' : ''}`,
    fingerprint: `${clean(input.fingerprint) || stableJson(bundle)}:${options.repair === true ? 'repair' : 'translate'}:${requestedModelId}`
  });
  assertExecutionCurrent(input);
  return result;
}

async function translateBundle(input = {}, dependencies = {}) {
  assertExecutionCurrent(input);
  const bundle = project({
    analysis: object(input.analysis),
    profile: object(input.profile),
    insights: object(input.insights)
  });
  const sourceSha256 = sha256(stableJson(bundle));
  if (!hasForeignText(bundle)) {
    const translated = clone(bundle);
    return {
      translationStatus: 'success',
      translationModel: 'identity',
      translatedAt: new Date().toISOString(),
      translated,
      originalPreserved: true,
      safeForDisplayOnly: true,
      translationReceipt: receipt({
        status: 'success', reasonCode: 'IDENTITY_TRANSLATION', selectedModelId: 'identity', selectedModel: 'identity',
        sourceSha256, translatedSha256: sha256(stableJson(translated)), structurePass: true, learningEligible: false
      })
    };
  }
  const gateway = dependencies.aiGateway;
  if (!gateway?.execute) {
    return {
      translationStatus: 'unavailable', translationModel: '', translatedAt: '', translated: {},
      translationErrorCode: 'TRANSLATION_GATEWAY_UNAVAILABLE', translationError: '中文理解模型服务不可用',
      originalPreserved: true, safeForDisplayOnly: true,
      translationReceipt: receipt({ status: 'unavailable', reasonCode: 'TRANSLATION_GATEWAY_UNAVAILABLE', sourceSha256, structurePass: false })
    };
  }

  let firstResult = null;
  let selected = null;
  let structureErrors = [];
  let repairResult = null;
  try {
    firstResult = await executeTranslation(gateway, bundle, input);
    selected = parseResult(firstResult);
    structureErrors = validateStructure(bundle, selected);
    if (!Object.keys(selected).length || structureErrors.length) {
      const invalidOutput = normalizeModelResult(firstResult, { json: true }).text || JSON.stringify(firstResult?.structured || {});
      repairResult = await executeTranslation(gateway, bundle, input, {
        repair: true,
        modelId: clean(firstResult.modelId || input.modelId),
        onlyRequestedModel: true,
        invalidOutput
      });
      selected = parseResult(repairResult);
      structureErrors = validateStructure(bundle, selected);
    }
    if (!Object.keys(selected).length || structureErrors.length) {
      const error = new Error('中文理解模型返回的 JSON 结构与权威原文不一致');
      error.code = 'SOCIAL_TRANSLATION_STRUCTURE_INVALID';
      error.structureErrors = structureErrors;
      throw error;
    }
    const finalResult = repairResult || firstResult;
    const translatedAt = new Date().toISOString();
    return {
      translationStatus: 'success',
      translationModel: clean(finalResult.model || finalResult.modelId),
      translatedAt,
      translated: selected,
      originalPreserved: true,
      safeForDisplayOnly: true,
      translationReceipt: receipt({
        status: 'success', reasonCode: repairResult ? 'SAME_MODEL_SCHEMA_REPAIR_SUCCEEDED' : 'TRANSLATION_SUCCEEDED',
        requestedModelId: input.modelId,
        selectedModelId: finalResult.modelId,
        selectedModel: finalResult.model,
        fallbackUsed: firstResult?.fallbackUsed === true,
        emergencyMode: finalResult.emergencyMode === true,
        learningEligible: false,
        schemaRepairUsed: Boolean(repairResult),
        schemaRepairModelId: repairResult?.modelId,
        sourceSha256,
        translatedSha256: sha256(stableJson(selected)),
        structurePass: true,
        structureErrors: [],
        attempts: [...(firstResult?.attempts || []), ...(repairResult?.attempts || [])],
        completedAt: translatedAt
      })
    };
  } catch (error) {
    if (isExecutionFenceError(error, input)) throw error;
    const attempts = [...(firstResult?.attempts || []), ...(repairResult?.attempts || [])];
    return {
      translationStatus: 'failed',
      translationModel: clean(repairResult?.model || repairResult?.modelId || firstResult?.model || firstResult?.modelId),
      translationErrorCode: clean(error.code || 'SOCIAL_TRANSLATION_FAILED'),
      translationError: clean(error.message),
      translatedAt: '',
      translated: {},
      originalPreserved: true,
      safeForDisplayOnly: true,
      translationReceipt: receipt({
        status: 'failed', reasonCode: error.code || 'SOCIAL_TRANSLATION_FAILED', requestedModelId: input.modelId,
        selectedModelId: repairResult?.modelId || firstResult?.modelId,
        selectedModel: repairResult?.model || firstResult?.model,
        fallbackUsed: firstResult?.fallbackUsed === true,
        emergencyMode: repairResult?.emergencyMode === true || firstResult?.emergencyMode === true,
        learningEligible: false,
        schemaRepairUsed: Boolean(repairResult),
        schemaRepairModelId: repairResult?.modelId,
        sourceSha256,
        translatedSha256: '',
        structurePass: false,
        structureErrors: error.structureErrors || structureErrors,
        attempts
      })
    };
  }
}

module.exports = {
  project,
  hasForeignText,
  promptFor,
  repairPromptFor,
  parseResult,
  validateStructure,
  assertExecutionCurrent,
  translateBundle
};
