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
  function project(snapshot = {}) {
    const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
    const key = source.key && typeof source.key === 'object' ? source.key : {};
    const catalog = Array.isArray(source.catalog) ? source.catalog : [];
    const connected = Boolean(source.credentialConfigured || source.credentialRef || source.connectionState === 'ready' || source.connectionState === 'conditional-ready');
    return Object.freeze({
      connected,
      provider: 'openrouter',
      account: clean(source.account || source.accountId || source.keyLabel),
      credentialConfigured: connected,
      catalogStatus: clean(source.catalogStatus || (catalog.length || source.modelCount ? 'ready' : 'unknown')),
      catalogCount: Number(source.catalogCount || source.modelCount || catalog.length || 0),
      capabilities: Array.isArray(source.capabilities) ? source.capabilities.map(clean).filter(Boolean) : [],
      smokeStatus: clean(source.onboardingSmokeStatus || source.smokeStatus || 'not-run'),
      connectionLabel: connected ? 'OpenRouter 账号与凭据已连接' : 'OpenRouter 尚未连接',
      catalogLabel: Number(source.catalogCount || source.modelCount || catalog.length || 0) ? `目录已读取 · ${Number(source.catalogCount || source.modelCount || catalog.length)} 个模型` : '模型目录待读取',
      smokeLabel: ['passed','success'].includes(clean(source.onboardingSmokeStatus || source.smokeStatus).toLowerCase()) ? 'Model Brain 逻辑烟测已通过' : 'Model Brain 逻辑烟测待运行',
      limitRemaining: key.limitRemaining,
      usageDaily: key.usageDaily,
      limitRemainingLabel: formatMoney(key.limitRemaining),
      usageDailyLabel: formatMoney(key.usageDaily),
      updatedAt: clean(source.balanceRefreshedAt || source.updatedAt)
    });
  }
  return Object.freeze({ formatMoney, project });
});
