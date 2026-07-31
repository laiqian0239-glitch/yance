'use strict';

const crypto = require('node:crypto');
const { normalizeModelResult, parseStructuredText } = require('./modelResultNormalizer');

const AUTHORITY = 'AIAnalysisResultAuthority';
const SCHEMA_VERSION = 1;
const REQUIRED_PRODUCT_FIELDS = Object.freeze([
  'summary',
  'intent',
  'hiddenNeed',
  'dimensions',
  'risk',
  'opportunity',
  'strategy',
  'evidence'
]);

function clean(value) { return String(value == null ? '' : value).trim(); }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function array(value) { return Array.isArray(value) ? value : []; }
function sha256(value) { return crypto.createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex'); }

function parsedDocument(result = {}) {
  const direct = object(result?.structured);
  if (Object.keys(direct).length) return direct;
  const normalized = normalizeModelResult(result, { json: true });
  return object(normalized.structured || parseStructuredText(normalized.text));
}

function meaningfulAnalysis(analysis = {}) {
  const row = object(analysis);
  return Boolean(
    clean(row.summary)
    || clean(row.intent)
    || clean(row.hiddenNeed)
    || Object.keys(object(row.dimensions)).length
    || array(row.evidence).length
    || Object.keys(object(row.strategy)).length
  );
}

function productCompleteness(analysis = {}) {
  const row = object(analysis);
  const checks = {
    summary: Boolean(clean(row.summary)),
    intent: Boolean(clean(row.intent || row.intentLabel)),
    hiddenNeed: Boolean(clean(row.hiddenNeed)),
    dimensions: Object.keys(object(row.dimensions)).length > 0,
    risk: typeof row.risk === 'number' || Object.keys(object(row.risk)).length > 0,
    opportunity: typeof row.opportunity === 'number' || Object.keys(object(row.opportunity)).length > 0,
    strategy: typeof row.strategy === 'string' ? Boolean(clean(row.strategy)) : Object.keys(object(row.strategy)).length > 0,
    evidence: array(row.evidence).length > 0
  };
  const missing = REQUIRED_PRODUCT_FIELDS.filter(field => checks[field] !== true);
  return {
    authority: AUTHORITY,
    schemaVersion: SCHEMA_VERSION,
    valid: meaningfulAnalysis(row),
    complete: missing.length === 0,
    missing,
    checks
  };
}

function invalidResult(message = '模型没有返回有效结构化分析', details = {}) {
  const error = new Error(message);
  error.code = 'INVALID_AI_ANALYSIS_RESULT';
  error.status = 502;
  error.details = details;
  return error;
}

function normalize(result = {}) {
  const parsed = parsedDocument(result);
  if (!Object.keys(parsed).length) throw invalidResult('模型没有返回有效结构化分析', { reason: 'EMPTY_OR_INVALID_JSON' });

  const hasEnvelope = Object.prototype.hasOwnProperty.call(parsed, 'analysis')
    || Object.prototype.hasOwnProperty.call(parsed, 'profile')
    || Object.prototype.hasOwnProperty.call(parsed, 'insights');
  const analysis = hasEnvelope ? object(parsed.analysis) : parsed;
  const profile = hasEnvelope ? object(parsed.profile) : {};
  const insights = hasEnvelope ? object(parsed.insights) : {};
  const completeness = productCompleteness(analysis);
  if (!completeness.valid) {
    throw invalidResult('模型返回了JSON，但没有可用的会话理解内容', {
      reason: 'ANALYSIS_PAYLOAD_EMPTY',
      parsedKeys: Object.keys(parsed),
      analysisKeys: Object.keys(analysis)
    });
  }
  return {
    analysis,
    profile,
    insights,
    completeness,
    envelopeSha256: sha256({ analysis, profile, insights })
  };
}

function repairPrompt(result = {}, error = {}) {
  const normalized = normalizeModelResult(result, { json: false });
  const raw = clean(normalized.text).slice(0, 12000);
  return [
    '上一轮会话理解结果没有通过言策结构化结果门禁。',
    `错误码：${clean(error.code || 'INVALID_AI_ANALYSIS_RESULT')}`,
    `错误原因：${clean(error.message || '结构化结果无效')}`,
    '请只修复格式和缺失字段，不新增输入消息中不存在的事实。',
    '必须只输出有效JSON，根对象必须包含 analysis、profile、insights。',
    'analysis至少包含 summary、intent、hiddenNeed、dimensions、risk、opportunity、strategy、evidence。',
    'profile和insights在没有可靠内容时可以是空对象。不要输出Markdown。',
    `待修复原始结果：${raw || '[empty]'}`
  ].join('\n');
}

function executionReceipt(input = {}) {
  const normalized = input.normalized || {};
  const routeReceipt = object(input.routeReceipt);
  const attempts = array(input.attempts).map(row => ({
    modelId: clean(row?.modelId),
    model: clean(row?.model),
    role: clean(row?.role),
    status: clean(row?.status),
    code: clean(row?.code),
    emergencyMode: row?.emergencyMode === true
  }));
  const document = {
    authority: AUTHORITY,
    schemaVersion: SCHEMA_VERSION,
    runId: clean(input.runId),
    state: clean(input.state || 'completed'),
    transactionCommitted: input.transactionCommitted === true,
    modelId: clean(input.modelId),
    modelName: clean(input.modelName),
    qualityRouteReceiptHash: clean(routeReceipt.receiptHash),
    emergencyMode: input.emergencyMode === true,
    learningEligible: input.learningEligible === true,
    schemaRepair: {
      attempted: input.schemaRepair?.attempted === true,
      succeeded: input.schemaRepair?.succeeded === true,
      requestedModelId: clean(input.schemaRepair?.requestedModelId),
      selectedModelId: clean(input.schemaRepair?.selectedModelId)
    },
    completeness: normalized.completeness || productCompleteness(normalized.analysis),
    envelopeSha256: clean(normalized.envelopeSha256),
    attempts,
    completedAt: clean(input.completedAt)
  };
  return { ...document, receiptSha256: sha256(document) };
}

module.exports = {
  AUTHORITY,
  SCHEMA_VERSION,
  REQUIRED_PRODUCT_FIELDS,
  parsedDocument,
  productCompleteness,
  normalize,
  repairPrompt,
  executionReceipt,
  invalidResult
};
