'use strict';

const STAGES = Object.freeze({
  understanding: '消息理解',
  director: '策略导演',
  candidate_generation: '候选生成',
  candidate_repair: '候选质量修复',
  translation: '中文回译',
  merge: '候选综合'
});

function clean(value) {
  if (value == null || typeof value === 'object') return '';
  const text = String(value).trim();
  return text && text !== '[object Object]' ? text : '';
}

function errorCode(value) {
  return clean(value?.code || value?.reasonCode || value?.errorCode || value?.error || 'MODEL_INVOCATION_FAILED').toUpperCase();
}

function userMessageZh(value = {}) {
  const code = errorCode(value);
  const status = Number(value?.httpStatus || value?.status || 0) || 0;
  const raw = clean(value?.message || value?.detail || value?.reason);
  const signature = `${code} ${status} ${raw}`;
  if (/429|RATE[_ -]?LIMIT|QUOTA|额度|频繁/i.test(signature)) return '请求过于频繁或当前额度不足';
  if (/401|403|AUTH|CREDENTIAL|API[_ -]?KEY|UNAUTHORIZED|FORBIDDEN|凭据|密钥|权限/i.test(signature)) return '模型凭据无效或没有调用权限';
  if (/404|MODEL[_ -]?NOT[_ -]?FOUND|NOT[_ -]?FOUND|模型.*不存在/i.test(signature)) return '模型名称或服务地址不正确';
  if (/TIMEOUT|ETIMEDOUT|ABORT|超时/i.test(signature)) return '模型响应超时';
  if (/CIRCUIT[_ -]?OPEN|熔断/i.test(signature)) return '模型暂时处于保护性熔断状态';
  if (/DISABLED|USER[_ -]?DISABLED|停用/i.test(signature)) return '模型已停用';
  if (/INELIGIBLE|UNQUALIFIED|NOT[_ -]?QUALIFIED|不合格/i.test(signature)) return '模型未通过该任务的资格验证';
  if (/CONTEXT|TOKEN.*LIMIT|上下文|长度/i.test(signature)) return '上下文过长，模型无法完成本次任务';
  if (/QUALITY|LANGUAGE_MISMATCH|PERSONA|REPETITION|QUESTION_COUNT|质量|语言/i.test(signature)) return '模型输出未通过语言、Persona 或 WhatsApp 质量门禁';
  if (/ECONNREFUSED|ENOTFOUND|NETWORK|FETCH|连接|网络/i.test(signature)) return '无法连接模型服务';
  if (/ALL_MODELS_FAILED/i.test(signature)) return '候选生成模型均未完成任务';
  return raw || '模型调用失败';
}

function normalizeAttempt(row = {}, index = 0) {
  const status = clean(row.status) || 'failed';
  return Object.freeze({
    order: index + 1,
    modelId: clean(row.modelId),
    model: clean(row.model || row.name || row.modelId) || `模型 ${index + 1}`,
    status,
    statusLabel: status === 'circuit_open' ? '已跳过（熔断）' : status === 'success' ? '成功' : '失败',
    code: errorCode(row),
    messageZh: userMessageZh(row),
    httpStatus: Number(row.httpStatus || row.statusCode || 0) || 0
  });
}

function projectFailure(error = {}, options = {}) {
  const stage = clean(options.stage || error.stage || error.aiStage || 'candidate_generation') || 'candidate_generation';
  const attempts = (Array.isArray(error.attempts) ? error.attempts : Array.isArray(error?.details?.attempts) ? error.details.attempts : [])
    .map(normalizeAttempt);
  const code = errorCode(error);
  const attemptedModels = attempts.map(row => row.model).filter(Boolean);
  const retryable = error.retryable === true || attempts.some(row => /429|TIMEOUT|CIRCUIT|NETWORK|ECONNREFUSED|ENOTFOUND/u.test(`${row.code} ${row.messageZh}`));
  const fallbackAttempted = attempts.length > 1;
  const messageZh = code === 'ALL_MODELS_FAILED'
    ? (attempts.length ? `候选生成失败：已尝试 ${attempts.length} 个模型，均未完成任务` : '候选生成失败：当前没有可执行的合格回复模型')
    : userMessageZh(error);
  return Object.freeze({
    code,
    stage,
    stageLabel: STAGES[stage] || 'AI 任务',
    task: clean(options.task || error.task || error?.details?.task),
    messageZh,
    retryable,
    fallbackAttempted,
    attemptedModels,
    attempts,
    priorStages: Array.isArray(options.priorStages) ? options.priorStages : [],
    nextAction: /CREDENTIAL|AUTH|401|403/u.test(code)
      ? '检查凭据并重新测试模型'
      : /NO_MODEL|INELIGIBLE|UNQUALIFIED/u.test(code)
        ? '前往 AI 工作台配置合格的回复主模型和备用模型'
        : retryable
          ? '稍后重试，或切换到已验证的备用模型'
          : '打开 AI 工作台查看模型职责、路由和技术详情'
  });
}

function attachFailure(error, options = {}) {
  if (!error || typeof error !== 'object') return error;
  const projection = projectFailure(error, options);
  error.aiStageFailure = projection;
  error.stage = projection.stage;
  error.userMessageZh = projection.messageZh;
  if (!error.code) error.code = projection.code;
  return error;
}

module.exports = { STAGES, clean, errorCode, userMessageZh, normalizeAttempt, projectFailure, attachFailure };
