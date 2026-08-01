'use strict';

const { QUALIFICATION } = require('../../shared/constants');
const { normalizeModelError } = require('./modelErrorNormalizer');
const modelCapabilityAuthority = require('./modelCapabilityAuthority');

const STATES = Object.freeze({
  unconfigured: 'UNCONFIGURED',
  credentialRequired: 'CREDENTIAL_REQUIRED',
  verifying: 'VERIFYING',
  configuredUnverified: 'CONFIGURED_UNVERIFIED',
  verifiedNotCalled: 'VERIFIED_NOT_CALLED',
  available: 'AVAILABLE',
  degradedWithFallback: 'DEGRADED_WITH_FALLBACK',
  temporarilyBlocked: 'TEMPORARILY_BLOCKED',
  unavailable: 'UNAVAILABLE',
  disabled: 'DISABLED'
});

const VALID_QUALIFICATIONS = new Set(Object.values(QUALIFICATION));

function clean(value) { return String(value == null ? '' : value).trim(); }
function normalizeQualification(value) {
  const normalized = clean(value || QUALIFICATION.untested).toLowerCase();
  return VALID_QUALIFICATIONS.has(normalized) ? normalized : QUALIFICATION.untested;
}
function qualificationLabel(value) {
  return ({
    verified: '资格已验证',
    experimental: '实验性资格',
    failed: '资格验证失败',
    blocked: '资格已阻止',
    testing: '资格验证中',
    untested: '尚未验证'
  })[value] || '尚未验证';
}

function userErrorMessage(error = {}) {
  const status = Number(error.status || 0);
  const code = clean(error.code).toLowerCase();
  if (status === 429 || /rate|quota|limit|insufficient_quota/u.test(code)) return '请求过于频繁或额度受限，请稍后重试或检查配额。';
  if ([401, 403].includes(status) || /auth|api[_-]?key|credential|permission|unauthorized|forbidden/u.test(code)) return '模型凭据无效或权限不足，请重新验证安全凭据。';
  if (status === 404 || /model[_-]?not[_-]?found|not[_-]?found/u.test(code)) return '模型名称或服务地址不存在，请检查配置。';
  if ([408, 504].includes(status) || /timeout|timed[_-]?out/u.test(code)) return '模型响应超时，请稍后重试或切换备用模型。';
  if (status >= 500 || /gateway|service[_-]?unavailable|upstream/u.test(code)) return '模型服务暂时不可用，请稍后重试或使用备用模型。';
  return clean(error.message) || '模型调用失败，请查看技术详情后重试。';
}

function normalizeSuccess(model = {}) {
  if (model.lastSuccessfulInvocation && typeof model.lastSuccessfulInvocation === 'object') return model.lastSuccessfulInvocation;
  const at = clean(model.lastSuccessAt || model.lastUsedAt);
  if (!at) return null;
  return {
    at,
    latencyMs: Number(model.lastLatencyMs || 0),
    promptTokens: Number(model.lastPromptTokens || 0),
    outputTokens: Number(model.lastOutputTokens || 0),
    totalTokens: Number(model.lastTotalTokens || 0),
    returnedModel: clean(model.lastReturnedModel)
  };
}

function normalizeQualificationFact(model = {}) {
  const connectivity = model.lastQualificationTest?.connectivity || model.lastTest?.connectivity || null;
  const normalized = normalizeModelError(
    model.qualificationError || connectivity?.error || (connectivity?.pass === false ? model.blockedReason : ''),
    { fallbackMessage: '', fallbackCode: '' }
  );
  return {
    status: clean(model.lastQualificationAttemptStatus || (connectivity ? (connectivity.pass === true ? 'success' : 'failed') : 'never')) || 'never',
    at: clean(model.qualificationTestedAt || model.testedAt || model.lastQualificationTest?.testedAt || model.lastTest?.testedAt),
    connectivityPass: connectivity?.pass === true,
    code: clean(model.qualificationErrorCode || connectivity?.code || normalized.code),
    httpStatus: Number(model.qualificationHttpStatus || connectivity?.status || connectivity?.httpStatus || normalized.status || 0),
    message: clean(model.qualificationError || normalized.message)
  };
}

function normalizeInvocationFact(model = {}) {
  const success = normalizeSuccess(model);
  const status = clean(model.lastInvocationStatus || model.lastAttemptStatus || (model.lastFailedAt ? 'failed' : success ? 'success' : 'never')) || 'never';
  const source = status === 'failed'
    ? (model.lastInvocationError || model.lastError || '')
    : '';
  const normalized = normalizeModelError(source, { fallbackMessage: '', fallbackCode: '' });
  const error = status === 'failed' ? {
    at: clean(model.lastInvocationAt || model.lastFailedAt),
    code: clean(model.lastInvocationErrorCode || model.lastErrorCode || normalized.code),
    status: Number(model.lastInvocationHttpStatus || model.lastHttpStatus || normalized.status || 0),
    message: clean(model.lastInvocationError || normalized.message)
  } : null;
  return { status, success, error };
}

function routeFacts(assignments = [], qualification) {
  const normalized = Array.isArray(assignments) ? assignments.filter(Boolean) : [];
  const routeAssigned = normalized.length > 0;
  const policyEligible = normalized.some(row => qualification === QUALIFICATION.verified || (qualification === QUALIFICATION.experimental && row.allowExperimental === true) || row.allowConditional === true);
  const fallbackCoverage = normalized.some(row => row.role === 'primary' && clean(row.fallbackModelId));
  const conditional = normalized.some(row => row.allowConditional === true);
  const humanReviewRequired = normalized.some(row => row.humanReviewRequired === true || row.allowConditional === true);
  return { assignments: normalized, routeAssigned, policyEligible, fallbackCoverage, conditional, humanReviewRequired };
}

function classify(input = {}) {
  const {
    configured, credentialReady, reachable, qualification, userDisabled,
    qualificationFact, invocationFact, route
  } = input;
  if (userDisabled) return STATES.disabled;
  if (!configured) return STATES.unconfigured;
  if (!credentialReady) return STATES.credentialRequired;
  if (qualification === QUALIFICATION.testing) return STATES.verifying;
  if ([QUALIFICATION.failed, QUALIFICATION.blocked].includes(qualification)) return STATES.unavailable;
  if ([QUALIFICATION.untested].includes(qualification)) return STATES.configuredUnverified;
  if (!reachable) return STATES.unavailable;
  if (invocationFact.status === 'failed') {
    if (invocationFact.success && route.fallbackCoverage) return STATES.degradedWithFallback;
    if (invocationFact.success) return STATES.temporarilyBlocked;
    return STATES.unavailable;
  }
  if (!invocationFact.success) return STATES.verifiedNotCalled;
  return STATES.available;
}

function statePresentation(state, facts = {}) {
  const failure = facts.invocationFact?.error || facts.qualificationFact?.message && {
    message: facts.qualificationFact.message,
    code: facts.qualificationFact.code,
    status: facts.qualificationFact.httpStatus
  };
  const failureMessage = failure ? userErrorMessage(failure) : '';
  const technicalPrefix = failure
    ? [Number(failure.status || 0) ? `HTTP ${Number(failure.status)}` : '', clean(failure.code)].filter(Boolean).join(' · ')
    : '';
  const visibleFailureMessage = [technicalPrefix, failureMessage].filter(Boolean).join(' · ');
  const labels = {
    [STATES.unconfigured]: ['未配置', '模型配置尚未完成。', 'neutral', '配置模型'],
    [STATES.credentialRequired]: ['凭据待恢复', '模型配置已保存，但安全凭据尚未恢复。', 'warning', '重新配置凭据'],
    [STATES.verifying]: ['资格验证中', '正在执行模型资格与最小真实调用测试。', 'progress', '等待验证完成'],
    [STATES.configuredUnverified]: ['已配置，待真实验证', '模型尚未完成资格与真实连接验证。', 'warning', '测试资格'],
    [STATES.verifiedNotCalled]: ['资格通过，等待首次业务调用', facts.route.routeAssigned ? `已分配 ${facts.route.assignments.length} 条任务路由，尚无业务调用成功记录。` : '资格验证通过，尚未分配任务路由，也没有业务调用记录。', 'info', facts.route.routeAssigned ? '等待业务调用' : '配置任务路由'],
    [STATES.available]: ['运行可用', facts.route.routeAssigned ? `业务调用成功，已分配 ${facts.route.assignments.length} 条任务路由。` : '业务调用成功，但尚未分配任务路由。', 'success', facts.route.routeAssigned ? '无需处理' : '配置任务路由'],
    [STATES.degradedWithFallback]: ['运行降级，备用路由可接管', `${visibleFailureMessage}${facts.invocationFact.success ? ' 已保留最后一次成功结果。' : ''}`, 'warning', '重试主模型'],
    [STATES.temporarilyBlocked]: ['最近调用失败，暂时不可用', `${visibleFailureMessage}${facts.invocationFact.success ? ' 已保留最后一次成功结果。' : ''}`, 'error', '重试模型'],
    [STATES.unavailable]: ['不可用', visibleFailureMessage || '模型当前无法执行任务，请检查资格、连接或配置。', 'error', '检查并重试'],
    [STATES.disabled]: ['已停用', '模型已从言策任务路由中停用，不会参与回复、理解或翻译。', 'neutral', '重新启用']
  };
  const [label, summary, severity, actionLabel] = labels[state] || labels[STATES.unavailable];
  return { label, summary: clean(summary), severity, actionLabel };
}

function projectModel(model = {}, state = {}, options = {}) {
  const qualification = normalizeQualification(model.qualification);
  const isLocal = model.provider === 'ollama';
  const configured = isLocal
    ? model.available !== false
    : Boolean(model.configured !== false && model.endpoint && model.name && model.credentialRef);
  const discovered = isLocal ? model.available !== false : configured;
  const credentialReady = isLocal ? true : Boolean(options.credentialReady?.(model));
  const qualificationFact = normalizeQualificationFact(model);
  const invocationFact = normalizeInvocationFact(model);
  const reachable = isLocal
    ? discovered && state.ollamaOnline === true
    : credentialReady && (qualificationFact.connectivityPass || Boolean(invocationFact.success));
  const route = routeFacts(options.routeAssignments || [], qualification);
  const runtimeState = classify({ configured, credentialReady, reachable, qualification, userDisabled: model.userDisabled === true, qualificationFact, invocationFact, route });
  const presentation = statePresentation(runtimeState, { qualificationFact, invocationFact, route });
  const currentFailure = invocationFact.error ? {
    ...invocationFact.error,
    userMessage: userErrorMessage(invocationFact.error),
    technicalMessage: clean(invocationFact.error.message)
  } : null;
  const qualificationFailure = qualificationFact.status === 'failed' ? {
    at: qualificationFact.at,
    code: qualificationFact.code,
    status: qualificationFact.httpStatus,
    userMessage: userErrorMessage({ message: qualificationFact.message, code: qualificationFact.code, status: qualificationFact.httpStatus }),
    technicalMessage: qualificationFact.message
  } : null;
  const routingEligible = route.policyEligible && ![
    STATES.unconfigured, STATES.credentialRequired, STATES.verifying,
    STATES.configuredUnverified, STATES.unavailable, STATES.temporarilyBlocked, STATES.disabled
  ].includes(runtimeState);
  const capabilityProfile = modelCapabilityAuthority.classify(model);
  const modelPurpose = capabilityProfile.batchOnly
    ? 'batch-only'
    : capabilityProfile.interactiveChat
      ? 'interactive-reply'
      : 'background-utility';
  return {
    ...model,
    authority: 'ModelRuntimeAuthority',
    capabilityAuthority: capabilityProfile.authority,
    capabilityProfile,
    modelPurpose,
    batchOnly: capabilityProfile.batchOnly,
    interactiveReplyVisible: capabilityProfile.interactiveChat && !capabilityProfile.batchOnly,
    qualification,
    qualificationLabel: qualificationLabel(qualification),
    qualificationPassed: qualification === QUALIFICATION.verified,
    qualificationFact,
    configured,
    discovered,
    credentialReady,
    reachable,
    runtimeOnline: reachable,
    runtimeState,
    runtimeStateLabel: presentation.label,
    runtimeSeverity: presentation.severity,
    userSummary: presentation.summary,
    actionLabel: presentation.actionLabel,
    routeAssignments: route.assignments,
    routedTasks: [...new Set(route.assignments.map(row => row.task).filter(Boolean))],
    routeAssigned: route.routeAssigned,
    routePolicyEligible: route.policyEligible,
    fallbackCoverage: route.fallbackCoverage,
    routingEligible,
    runtimeAvailable: runtimeState === STATES.available,
    routeContinuityAvailable: [STATES.available, STATES.verifiedNotCalled, STATES.degradedWithFallback].includes(runtimeState) && route.policyEligible,
    lastSuccessfulInvocation: invocationFact.success,
    lastInvocationStatus: invocationFact.status,
    currentFailure,
    qualificationFailure,
    hasRetainedSuccess: Boolean(invocationFact.success && invocationFact.status === 'failed'),
    lastAttemptStatus: invocationFact.status,
    lastTestError: currentFailure?.technicalMessage || qualificationFailure?.technicalMessage || '',
    lastTestCode: currentFailure?.code || qualificationFailure?.code || '',
    lastHttpStatus: Number(currentFailure?.status || qualificationFailure?.status || 0),
    stateLabel: presentation.summary
  };
}

function summarize(models = [], routesTotal = 0) {
  const countState = value => models.filter(model => model.runtimeState === value).length;
  const configuredRoutes = new Set(models.flatMap(model => model.routeAssignments || []).map(row => row.task).filter(Boolean)).size;
  return {
    count: models.length,
    discovered: models.filter(model => model.discovered).length,
    online: models.filter(model => model.reachable).length,
    verified: models.filter(model => model.qualificationPassed).length,
    routingEligible: models.filter(model => model.routingEligible).length,
    available: countState(STATES.available),
    verifiedNotCalled: countState(STATES.verifiedNotCalled),
    degraded: countState(STATES.degradedWithFallback),
    temporarilyBlocked: countState(STATES.temporarilyBlocked),
    unavailable: countState(STATES.unavailable),
    disabled: countState(STATES.disabled),
    configuredUnverified: countState(STATES.configuredUnverified),
    credentialRequired: countState(STATES.credentialRequired),
    experimental: models.filter(model => model.qualification === QUALIFICATION.experimental).length,
    failed: models.filter(model => [QUALIFICATION.failed, QUALIFICATION.blocked].includes(model.qualification)).length,
    testing: models.filter(model => model.qualification === QUALIFICATION.testing).length,
    untested: models.filter(model => model.qualification === QUALIFICATION.untested).length,
    used: models.filter(model => Number(model.callCount || 0) > 0).length,
    totalCalls: models.reduce((sum, model) => sum + Number(model.callCount || 0), 0),
    routesConfigured: configuredRoutes,
    routesTotal,
    routeHealthPercent: Math.round(configuredRoutes / Math.max(1, routesTotal) * 100)
  };
}

module.exports = {
  STATES,
  normalizeQualification,
  qualificationLabel,
  userErrorMessage,
  projectModel,
  summarize
};
