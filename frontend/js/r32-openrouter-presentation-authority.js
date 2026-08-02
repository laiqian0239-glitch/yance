(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.YanceOpenRouterPresentationAuthority = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function clean(value) { return String(value == null ? '' : value).trim(); }

  function formatMoney(value) {
    if (value === null || value === undefined || value === '') return '未返回';
    const number = Number(value);
    return Number.isFinite(number) ? `$${number.toFixed(number >= 10 ? 2 : 4)}` : '未返回';
  }

  function label(status, labels, fallback) {
    return labels[clean(status).toLowerCase()] || fallback;
  }

  function project(snapshot = {}) {
    const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
    const key = source.key && typeof source.key === 'object' ? source.key : {};
    const connectionState = clean(source.connectionState || 'not-configured');
    const authenticationStatus = clean(source.authenticationStatus || 'unknown');
    const catalogStatus = clean(source.catalogStatus || 'unknown');
    const smokeStatus = clean(source.onboardingSmokeStatus || 'not-run');
    const routeStatus = clean(source.routeStatus || 'blocked');
    const qualificationStatus = clean(source.formalQualificationStatus || 'pending');
    const benchmarkStatus = clean(source.benchmarkStatus || 'pending');
    const formalStatus = ['running', 'completed', 'failed', 'cancelled'].includes(benchmarkStatus)
      ? benchmarkStatus
      : qualificationStatus;
    const connected = connectionState === 'conditional-ready' || connectionState === 'ready';
    const formalCompleted = ['completed', 'passed', 'qualified', 'ready'].includes(formalStatus);

    return Object.freeze({
      connected,
      connectionState,
      authenticationStatus,
      catalogStatus,
      smokeStatus,
      routeStatus,
      formalStatus,
      formalCompleted,
      connectionLabel: label(connectionState, {
        'conditional-ready': '条件接入已完成',
        ready: '正式接入已完成',
        degraded: '接入未完成',
        'not-configured': '尚未接入'
      }, '接入状态待确认'),
      authenticationLabel: label(authenticationStatus, { passed: '鉴权已通过', success: '鉴权已通过', failed: '鉴权失败' }, '鉴权状态待确认'),
      catalogLabel: label(catalogStatus, { passed: '模型目录已读取', success: '模型目录已读取', failed: '模型目录读取失败' }, '模型目录待读取'),
      smokeLabel: label(smokeStatus, { passed: '双模型真实调用已通过', success: '双模型真实调用已通过', failed: '双模型真实调用失败', 'not-run': '双模型真实调用未运行' }, '双模型实测状态待确认'),
      routeLabel: label(routeStatus, { 'conditional-ready': '人工确认条件路由已建立', ready: '正式路由已建立', blocked: '路由尚未建立' }, '路由状态待确认'),
      formalLabel: label(formalStatus, { running: '正式专项评估运行中', completed: '正式专项评估已完成', passed: '正式专项评估已通过', qualified: '正式专项评估已通过', ready: '正式专项评估已通过', pending: '正式专项评估未运行', 'not-run': '正式专项评估未运行', failed: '正式专项评估未通过', cancelled: '正式专项评估未完成' }, '正式专项评估状态待确认'),
      candidateOnly: !formalCompleted,
      primaryCandidateSlug: clean(source.onboardingPrimaryModelSlug),
      fallbackCandidateSlug: clean(source.onboardingFallbackModelSlug),
      primarySlug: clean(source.onboardingPrimaryModelSlug),
      fallbackSlug: clean(source.onboardingFallbackModelSlug),
      modelCount: Number(source.modelCount || source.catalogCount || 0),
      freeModelCount: Number(source.freeModelCount || 0),
      limitRemaining: key.limitRemaining,
      usageDaily: key.usageDaily,
      limitRemainingLabel: formatMoney(key.limitRemaining),
      usageDailyLabel: formatMoney(key.usageDaily),
      paidHistory: key.isFreeTier === false,
      updatedAt: clean(source.balanceRefreshedAt || source.updatedAt)
    });
  }

  return Object.freeze({ formatMoney, project });
});
